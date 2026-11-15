import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  decodeLolaTerrain,
  sampleLolaHeightAtLocation,
  type GeographicCoordinate,
  type LolaTerrainData,
} from "@/components/lib/lunar/terrainData";

import {
  DEFAULT_PRODUCT78_SITE_ID,
  getProduct78Site,
  type Product78SiteId,
} from "@/components/lib/lunar/siteRegistry";

import {
  calculateMultiResolutionTerrainHorizon,
} from "@/components/lib/lunar/multiResolutionTerrain.server";

/* =====================================================
   CONFIGURATION
===================================================== */

const HORIZONS_URL =
  "https://ssd.jpl.nasa.gov/api/horizons.api";

const TERRAIN_OPTIONS = {
  // A 1-degree azimuth grid and 10 m radial step provide a responsive
  // sampled skyline while keeping the underlying local DEM at 5 m.
  directionCount: 360,
  sampleStepMeters: 10,
  regionalSampleStepMeters: 20,
  maxDistanceMeters: 15000,
  directionConcurrency: 8,
  // Product90 remains opt-in. Product78 is the reliable baseline.
  enableProduct90: false,
};

const HORIZONS_MAX_ATTEMPTS = 3;
const HORIZONS_REQUEST_TIMEOUT_MS = 30_000;
const TERRAIN_HORIZON_RESPONSE_BUDGET_MS = 18_000;

const JPL_SAMPLE_INTERVAL_MINUTES = 10;
const ALLOWED_DURATION_HOURS = [6, 12, 24, 48, 72] as const;
const ASTRONOMICAL_UNIT_KM = 149_597_870.7;
const SOLAR_IRRADIANCE_AT_1_AU_WM2 = 1361;

// Equatorial diameters from the NASA/JPL planetary fact sheets / IAU values.
// Horizons quantity 13 supplies the observed angular diameter; quantity 20
// supplies the observer range used as an independent geometry cross-check.
const CELESTIAL_EQUATORIAL_DIAMETER_KM = {
  "10": 1_391_400,
  "399": 12_756.2732,
} as const;

const JPL_ANGULAR_DIAMETER_TOLERANCE_PERCENT = 2;

type AngularDiameterSource =
  | "jpl-range-verified"
  | "jpl-only"
  | "range-derived"
  | "unavailable";

type ParsedHorizonsObservation = {
  time: string;
  timeUtc: string;
  azimuthDeg: number;
  elevationDeg: number;
  angularDiameterArcsec: number | null;
  observerRangeKm: number | null;
};

type HorizonsObservation = ParsedHorizonsObservation & {
  jplAngularDiameterArcsec: number | null;
  rangeDerivedAngularDiameterArcsec: number | null;
  angularDiameterSource: AngularDiameterSource;
  angularDiameterCrossCheckPercent: number | null;
  solarIrradianceWm2: number | null;
};

type AssessedHorizonsObservation = HorizonsObservation & {
  terrainVisibility: TerrainVisibility;
};

type VisibilityWindow = {
  state: TerrainVisibilityStatus;
  startTimeUtc: string;
  endTimeUtc: string;
  durationMinutes: number;
  observationCount: number;
};

type HorizonsTarget = Partial<AssessedHorizonsObservation> & {
  observations: AssessedHorizonsObservation[];
  visibilityWindows: VisibilityWindow[];
};

type TerrainVisibilityStatus =
  | "target_disk_below_sampled_terrain"
  | "target_disk_intersects_sampled_terrain"
  | "target_disk_above_sampled_terrain_unconfirmed"
  | "target_disk_size_unavailable"
  | "terrain_horizon_unavailable";

type TerrainVisibility = {
  azimuthDeg: number;
  targetElevationDeg: number;
  terrainHorizonElevationDeg: number | null;
  clearanceDeg: number | null;
  angularDiameterArcsec: number | null;
  status: TerrainVisibilityStatus;

  /*
   * true  = sampled data indicates at least some disk is visible
   * false = sampled data indicates the disk is below terrain
   * null  = visibility cannot be established from available data
   */
  targetDiskVisible: boolean | null;

  /*
   * The current local and regional terrain sampling does not
   * claim a globally complete horizon.
   */
  terrainCoverageComplete: false;
};

type TerrainHorizonResult = Awaited<
  ReturnType<typeof calculateMultiResolutionTerrainHorizon>
>;

/* =====================================================
   IN-MEMORY TERRAIN AND HORIZON CACHES
===================================================== */

const terrainPromises = new Map<
  Product78SiteId,
  Promise<LolaTerrainData>
>();

const horizonPromises = new Map<
  string,
  Promise<TerrainHorizonResult>
>();

/* =====================================================
   COORDINATE HELPERS
===================================================== */

function normalizeLongitudeEast(
  longitude: number
): number {
  return (
    ((longitude % 360) + 360) % 360
  );
}

function normalizeHorizonsLongitude(
  longitude: number
): number {
  const normalized =
    normalizeLongitudeEast(longitude);

  return normalized > 180
    ? normalized - 360
    : normalized;
}

/* =====================================================
   QUERY PARAMETER VALIDATION
===================================================== */

function parseFiniteParameter(
  value: string | null,
  name: string
): number | null {
  if (
    value === null ||
    value.trim() === ""
  ) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(
      `${name} must be a finite number.`
    );
  }

  return parsed;
}

function parseOptionalPixel(
  value: string | null,
  name: string
): number | null {
  if (
    value === null ||
    value.trim() === "" ||
    value === "undefined" ||
    value === "null"
  ) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(
      `${name} must be a valid numeric pixel coordinate.`
    );
  }

  return parsed;
}

function getSelectedSite(
  siteIdValue: string | null
): {
  id: Product78SiteId;
  site: ReturnType<typeof getProduct78Site>;
} {
  const siteId = (
    siteIdValue ??
    DEFAULT_PRODUCT78_SITE_ID
  ) as Product78SiteId;

  const site = getProduct78Site(siteId);

  return {
    id: siteId,
    site,
  };
}

/* =====================================================
   NASA LOLA TERRAIN LOADING
===================================================== */

async function loadTerrainForSite(
  siteId: Product78SiteId
): Promise<LolaTerrainData> {
  const cached = terrainPromises.get(siteId);

  if (cached) {
    return cached;
  }

  const site = getProduct78Site(siteId);

  const pending = (async () => {
    const directory = path.join(
      process.cwd(),
      "public",
      "data",
      site.dataDirectory
    );

    const [
      metadataText,
      binary,
    ] = await Promise.all([
      readFile(
        path.join(directory, "metadata.json"),
        "utf8"
      ),

      readFile(
        path.join(directory, "elevation.bin")
      ),
    ]);

    const rawMetadata: unknown =
      JSON.parse(metadataText);

    const terrain = decodeLolaTerrain(
      rawMetadata,
      new Uint8Array(binary)
    );

    console.info(
      "[Horizons] Loaded site terrain:",
      {
        siteId,
        archiveSite: site.archiveSite,
        directory,
        dimensions:
          `${terrain.width} x ${terrain.height}`,
        resolutionMeters:
          terrain.resolutionMeters,
      }
    );

    return terrain;
  })();

  terrainPromises.set(siteId, pending);

  try {
    return await pending;
  } catch (error) {
    if (
      terrainPromises.get(siteId) === pending
    ) {
      terrainPromises.delete(siteId);
    }

    throw error;
  }
}

/* =====================================================
   MULTI-RESOLUTION TERRAIN HORIZON
===================================================== */

async function getTerrainHorizon(
  siteId: Product78SiteId,
  terrain: LolaTerrainData,
  observer: GeographicCoordinate,
  includeProduct90 = false
): Promise<TerrainHorizonResult> {
  const cacheKey = [
    siteId,
    observer.latitudeDeg.toFixed(7),
    observer.longitudeEastDeg.toFixed(7),
    includeProduct90 ? "product90" : "product78",
  ].join(":");

  const cached = horizonPromises.get(cacheKey);
  if (cached) return cached;

  const pending = calculateMultiResolutionTerrainHorizon(
    terrain,
    observer,
    {
      ...TERRAIN_OPTIONS,
      enableProduct90: includeProduct90,
    }
  );

  horizonPromises.set(cacheKey, pending);

  try {
    return await pending;
  } catch (error) {
    if (horizonPromises.get(cacheKey) === pending) {
      horizonPromises.delete(cacheKey);
    }
    throw error;
  }
}

/* =====================================================
   MISSION DATE AND TIME
===================================================== */

function getDateAndTime(
  dateValue: string | null,
  timeValue: string | null,
  durationValue: string | null
): {
  date: string;
  time: string;
  durationHours: number;
  sampleIntervalMinutes: number;
  startTime: string;
  stopTime: string;
} {
  if (!dateValue || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    throw new Error("A valid date is required in YYYY-MM-DD format.");
  }

  if (!timeValue || !/^\d{2}:\d{2}(?::\d{2})?$/.test(timeValue)) {
    throw new Error("A valid time is required in HH:mm or HH:mm:ss format.");
  }

  const normalizedTime = timeValue.length === 5 ? `${timeValue}:00` : timeValue;
  const start = new Date(`${dateValue}T${normalizedTime}.000Z`);
  if (
    Number.isNaN(start.getTime()) ||
    start.toISOString().slice(0, 10) !== dateValue ||
    start.toISOString().slice(11, 19) !== normalizedTime
  ) {
    throw new Error("The selected date or time is invalid.");
  }

  const requestedDuration = durationValue === null || durationValue.trim() === ""
    ? 24
    : Number(durationValue);

  if (
    !Number.isSafeInteger(requestedDuration) ||
    !ALLOWED_DURATION_HOURS.includes(requestedDuration as (typeof ALLOWED_DURATION_HOURS)[number])
  ) {
    throw new Error("Duration must be one of 6, 12, 24, 48 or 72 hours.");
  }

  const stop = new Date(start.getTime() + requestedDuration * 60 * 60 * 1000);
  return {
    date: dateValue,
    time: normalizedTime,
    durationHours: requestedDuration,
    sampleIntervalMinutes: JPL_SAMPLE_INTERVAL_MINUTES,
    startTime: `${dateValue} ${normalizedTime}`,
    stopTime: `${stop.toISOString().slice(0, 10)} ${stop.toISOString().slice(11, 19)}`,
  };
}

/* =====================================================
   JPL HORIZONS TEXT PARSER
===================================================== */

/*
 * The request selects:
 *
 * Quantity 4  = apparent azimuth and elevation
 * Quantity 13 = target angular diameter (arcseconds)
 * Quantity 20 = apparent observer range and range-rate (km and km/s)
 *
 * Horizons returns the selected quantities in the same order. The range is
 * retained to independently verify the apparent disk size before rendering.
 */
function parseHorizonsObservations(
  responseText: string
): ParsedHorizonsObservation[] {
  const startIndex = responseText.indexOf("$$SOE");
  const endIndex = responseText.indexOf("$$EOE");

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error("JPL Horizons did not return an observation table.");
  }

  const table = responseText.slice(startIndex + "$$SOE".length, endIndex);
  const monthIndex: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04",
    May: "05", Jun: "06", Jul: "07", Aug: "08",
    Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const numericPattern = /[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?/g;
  const observations: ParsedHorizonsObservation[] = [];

  for (const rawLine of table.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const timeMatch = line.match(
      /^(\d{4})-([A-Za-z]{3})-(\d{2})[ T]+(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/
    );
    if (!timeMatch) continue;

    const [, year, monthName, day, hour, minute, second = "00", fraction = ""] = timeMatch;
    const month = monthIndex[monthName];
    if (!month) continue;

    const remaining = line.slice(timeMatch[0].length);
    const numericValues = [...remaining.matchAll(numericPattern)].map((match) => Number(match[0]));
    if (numericValues.length < 2) continue;

    const azimuthDeg = numericValues[0];
    const elevationDeg = numericValues[1];
    const angularDiameter = numericValues.length >= 3
      ? numericValues[2]
      : Number.NaN;
    const observerRangeKm = numericValues.length >= 4
      ? numericValues[3]
      : Number.NaN;

    if (
      !Number.isFinite(azimuthDeg) ||
      azimuthDeg < 0 ||
      azimuthDeg > 360 ||
      !Number.isFinite(elevationDeg) ||
      elevationDeg < -90 ||
      elevationDeg > 90
    ) {
      continue;
    }

    const milliseconds = (fraction + "000").slice(0, 3);
    const timeUtc = `${year}-${month}-${day}T${hour}:${minute}:${second}.${milliseconds}Z`;

    observations.push({
      time: `${year}-${monthName}-${day} ${hour}:${minute}:${second}`,
      timeUtc,
      azimuthDeg: normalizeLongitudeEast(azimuthDeg),
      elevationDeg,
      angularDiameterArcsec:
        Number.isFinite(angularDiameter) && angularDiameter > 0
          ? angularDiameter
          : null,
      observerRangeKm:
        Number.isFinite(observerRangeKm) && observerRangeKm > 0
          ? observerRangeKm
          : null,
    });
  }

  observations.sort((left, right) =>
    Date.parse(left.timeUtc) - Date.parse(right.timeUtc)
  );

  if (observations.length === 0) {
    throw new Error("JPL Horizons returned no parseable observations.");
  }

  return observations;
}

function calculateAngularDiameterArcsec(
  equatorialDiameterKm: number,
  observerRangeKm: number
): number | null {
  if (
    !Number.isFinite(equatorialDiameterKm) ||
    equatorialDiameterKm <= 0 ||
    !Number.isFinite(observerRangeKm) ||
    observerRangeKm <= 0
  ) {
    return null;
  }

  const angularDiameterRadians = 2 * Math.atan2(
    equatorialDiameterKm / 2,
    observerRangeKm
  );
  const angularDiameterArcsec =
    angularDiameterRadians * (180 / Math.PI) * 3600;

  return Number.isFinite(angularDiameterArcsec) && angularDiameterArcsec > 0
    ? angularDiameterArcsec
    : null;
}

function verifyCelestialAngularSize(
  targetId: "10" | "399",
  observation: ParsedHorizonsObservation
): HorizonsObservation {
  const jplAngularDiameterArcsec = observation.angularDiameterArcsec;
  const rangeDerivedAngularDiameterArcsec =
    observation.observerRangeKm === null
      ? null
      : calculateAngularDiameterArcsec(
          CELESTIAL_EQUATORIAL_DIAMETER_KM[targetId],
          observation.observerRangeKm
        );

  const angularDiameterCrossCheckPercent =
    jplAngularDiameterArcsec !== null &&
    rangeDerivedAngularDiameterArcsec !== null
      ? (
          Math.abs(
            jplAngularDiameterArcsec -
            rangeDerivedAngularDiameterArcsec
          ) / rangeDerivedAngularDiameterArcsec
        ) * 100
      : null;

  const jplRangeVerified =
    jplAngularDiameterArcsec !== null &&
    rangeDerivedAngularDiameterArcsec !== null &&
    angularDiameterCrossCheckPercent !== null &&
    angularDiameterCrossCheckPercent <= JPL_ANGULAR_DIAMETER_TOLERANCE_PERCENT;

  const angularDiameterArcsec = jplRangeVerified
    ? jplAngularDiameterArcsec
    : rangeDerivedAngularDiameterArcsec ?? jplAngularDiameterArcsec;

  const angularDiameterSource: AngularDiameterSource =
    jplRangeVerified
      ? "jpl-range-verified"
      : rangeDerivedAngularDiameterArcsec !== null
        ? "range-derived"
        : jplAngularDiameterArcsec !== null
          ? "jpl-only"
          : "unavailable";

  const solarIrradianceWm2 =
    targetId === "10" && observation.observerRangeKm !== null
      ? SOLAR_IRRADIANCE_AT_1_AU_WM2 *
        Math.pow(ASTRONOMICAL_UNIT_KM / observation.observerRangeKm, 2)
      : null;

  return {
    ...observation,
    angularDiameterArcsec,
    jplAngularDiameterArcsec,
    rangeDerivedAngularDiameterArcsec,
    angularDiameterSource,
    angularDiameterCrossCheckPercent,
    solarIrradianceWm2,
  };
}

/* =====================================================
   JPL HORIZONS REQUEST
===================================================== */

async function requestHorizonsTarget(
  targetId: "10" | "399",
  observer: GeographicCoordinate,
  altitudeKm: number,
  startTime: string,
  stopTime: string
): Promise<HorizonsObservation[]> {
  // Follow the documented Horizons API value syntax. Enum/boolean
  // values and coordinate triplets are quoted.
  const params = new URLSearchParams({
    format: "json",
    COMMAND: `'${targetId}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'coord@301'",
    COORD_TYPE: "'GEODETIC'",
    SITE_COORD: `'${normalizeHorizonsLongitude(observer.longitudeEastDeg)},${observer.latitudeDeg},${altitudeKm}'`,
    START_TIME: `'${startTime}'`,
    STOP_TIME: `'${stopTime}'`,
    STEP_SIZE: "'10m'",
    QUANTITIES: "'4,13,20'",
    RANGE_UNITS: "'KM'",
    TIME_TYPE: "'UT'",
    TIME_DIGITS: "'SECONDS'",
    CSV_FORMAT: "'NO'",
    ANG_FORMAT: "'DEG'",
    APPARENT: "'AIRLESS'",
    EXTRA_PREC: "'YES'",
  });

  const url = `${HORIZONS_URL}?${params.toString()}`;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= HORIZONS_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;

    try {
      response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(HORIZONS_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = error;
      if (attempt < HORIZONS_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
        continue;
      }
      break;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const retryable =
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500;

      lastError = new Error(
        `JPL Horizons HTTP ${response.status} for target ${targetId}: ${body.slice(0, 500)}`
      );

      if (retryable && attempt < HORIZONS_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
        continue;
      }

      throw lastError;
    }

    let payload: { result?: string; error?: string };
    try {
      payload = await response.json() as { result?: string; error?: string };
    } catch (error) {
      throw new Error(
        `JPL Horizons returned invalid JSON for target ${targetId}: ${error instanceof Error ? error.message : "unknown parse error"}`
      );
    }

    if (payload.error) {
      throw new Error(`JPL Horizons rejected target ${targetId}: ${payload.error}`);
    }

    if (typeof payload.result !== "string" || payload.result.length === 0) {
      throw new Error(`JPL Horizons returned no ephemeris result for target ${targetId}.`);
    }

    try {
      return parseHorizonsObservations(payload.result).map((observation) =>
        verifyCelestialAngularSize(targetId, observation)
      );
    } catch (error) {
      throw new Error(
        `Could not parse JPL target ${targetId}: ${error instanceof Error ? error.message : "unknown table error"}`
      );
    }
  }

  throw new Error(
    `JPL Horizons network request failed for target ${targetId} after ${HORIZONS_MAX_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : "unknown network error"}`
  );
}

/* =====================================================
   TERRAIN HORIZON INTERPOLATION
===================================================== */

function normalizeAzimuth(
  azimuth: number
): number {
  return (
    ((azimuth % 360) + 360) % 360
  );
}

/*
 * Returns null when either neighboring direction has no
 * valid horizon measurement.
 *
 * It does not interpolate through missing horizon data.
 */
function getTerrainHorizonAtAzimuth(
  horizon: TerrainHorizonResult,
  azimuthDeg: number
): number | null {
  const directions = [
    ...horizon.directions,
  ].sort(
    (a, b) =>
      a.azimuthDeg - b.azimuthDeg
  );

  if (directions.length === 0) {
    return null;
  }

  const azimuth =
    normalizeAzimuth(azimuthDeg);

  let lower =
    directions[directions.length - 1];

  let upper =
    directions[0];

  for (
    let index = 0;
    index < directions.length;
    index++
  ) {
    const current =
      directions[index];

    const next =
      directions[
      (index + 1) % directions.length
      ];

    const lowerAzimuth =
      current.azimuthDeg;

    const upperAzimuth =
      index === directions.length - 1
        ? next.azimuthDeg + 360
        : next.azimuthDeg;

    const adjustedAzimuth =
      azimuth < lowerAzimuth
        ? azimuth + 360
        : azimuth;

    if (
      adjustedAzimuth >= lowerAzimuth &&
      adjustedAzimuth <= upperAzimuth
    ) {
      lower = current;
      upper = next;
      break;
    }
  }

  const lowerHorizon =
    lower.horizonElevationDeg;

  const upperHorizon =
    upper.horizonElevationDeg;

  if (
    lowerHorizon === null ||
    upperHorizon === null ||
    !Number.isFinite(lowerHorizon) ||
    !Number.isFinite(upperHorizon)
  ) {
    return null;
  }

  const lowerAzimuth =
    lower.azimuthDeg;

  let upperAzimuth =
    upper.azimuthDeg;

  let targetAzimuth =
    azimuth;

  if (upperAzimuth <= lowerAzimuth) {
    upperAzimuth += 360;
  }

  if (targetAzimuth < lowerAzimuth) {
    targetAzimuth += 360;
  }

  const span =
    upperAzimuth - lowerAzimuth;

  if (span <= 0) {
    return lowerHorizon;
  }

  const amount =
    (targetAzimuth - lowerAzimuth) /
    span;

  return (
    lowerHorizon +
    (upperHorizon - lowerHorizon) *
    amount
  );
}

/* =====================================================
   TARGET DISK VISIBILITY ASSESSMENT
===================================================== */

function assessTargetVisibility(
  observation: HorizonsObservation,
  horizon: TerrainHorizonResult
): TerrainVisibility {
  const terrainHorizonElevationDeg =
    getTerrainHorizonAtAzimuth(
      horizon,
      observation.azimuthDeg
    );

  /*
   * No terrain horizon value means we cannot claim the
   * target is visible or blocked by terrain.
   */
  if (
    terrainHorizonElevationDeg === null
  ) {
    return {
      azimuthDeg:
        observation.azimuthDeg,

      targetElevationDeg:
        observation.elevationDeg,

      terrainHorizonElevationDeg: null,
      clearanceDeg: null,

      angularDiameterArcsec:
        observation.angularDiameterArcsec,

      status:
        "terrain_horizon_unavailable",

      targetDiskVisible: null,
      terrainCoverageComplete: false,
    };
  }

  const clearanceDeg =
    observation.elevationDeg -
    terrainHorizonElevationDeg;

  /*
   * We know the target centre's clearance, but without its
   * angular diameter we cannot calculate its visible limb.
   */
  if (
    observation.angularDiameterArcsec === null
  ) {
    return {
      azimuthDeg:
        observation.azimuthDeg,

      targetElevationDeg:
        observation.elevationDeg,

      terrainHorizonElevationDeg,

      clearanceDeg,

      angularDiameterArcsec: null,

      status:
        "target_disk_size_unavailable",

      targetDiskVisible: null,
      terrainCoverageComplete: false,
    };
  }

  const angularRadiusDeg =
    observation.angularDiameterArcsec / 7200;

  const upperLimbDeg =
    observation.elevationDeg +
    angularRadiusDeg;

  const lowerLimbDeg =
    observation.elevationDeg -
    angularRadiusDeg;

  /*
   * Entire disk is below the sampled terrain horizon.
   */
  if (
    upperLimbDeg <
    terrainHorizonElevationDeg
  ) {
    return {
      azimuthDeg:
        observation.azimuthDeg,

      targetElevationDeg:
        observation.elevationDeg,

      terrainHorizonElevationDeg,

      clearanceDeg,

      angularDiameterArcsec:
        observation.angularDiameterArcsec,

      status:
        "target_disk_below_sampled_terrain",

      targetDiskVisible: false,
      terrainCoverageComplete: false,
    };
  }

  /*
   * The disk crosses the sampled horizon.
   * Its visible fraction can be estimated by the Explorer.
   */
  if (
    lowerLimbDeg <=
    terrainHorizonElevationDeg
  ) {
    return {
      azimuthDeg:
        observation.azimuthDeg,

      targetElevationDeg:
        observation.elevationDeg,

      terrainHorizonElevationDeg,

      clearanceDeg,

      angularDiameterArcsec:
        observation.angularDiameterArcsec,

      status:
        "target_disk_intersects_sampled_terrain",

      targetDiskVisible: true,
      terrainCoverageComplete: false,
    };
  }

  /*
   * Entire disk is above the sampled terrain horizon.
   * This remains explicitly unconfirmed because the
   * complete horizon has not been globally verified.
   */
  return {
    azimuthDeg:
      observation.azimuthDeg,

    targetElevationDeg:
      observation.elevationDeg,

    terrainHorizonElevationDeg,

    clearanceDeg,

    angularDiameterArcsec:
      observation.angularDiameterArcsec,

    status:
      "target_disk_above_sampled_terrain_unconfirmed",

    targetDiskVisible: true,
    terrainCoverageComplete: false,
  };
}

function buildVisibilityWindows(
  observations: AssessedHorizonsObservation[]
): VisibilityWindow[] {
  if (observations.length === 0) return [];

  const windows: VisibilityWindow[] = [];
  const sorted = [...observations].sort(
    (left, right) => Date.parse(left.timeUtc) - Date.parse(right.timeUtc)
  );

  let currentState: TerrainVisibilityStatus | null = null;
  let startIndex = 0;

  const closeWindow = (endIndex: number) => {
    if (currentState === null) return;
    const first = sorted[startIndex];
    const last = sorted[endIndex];
    const elapsed = Math.max(
      0,
      (Date.parse(last.timeUtc) - Date.parse(first.timeUtc)) / 60_000
    );

    windows.push({
      state: currentState,
      startTimeUtc: first.timeUtc,
      endTimeUtc: last.timeUtc,
      durationMinutes: elapsed + JPL_SAMPLE_INTERVAL_MINUTES,
      observationCount: endIndex - startIndex + 1,
    });
  };

  for (let index = 0; index < sorted.length; index += 1) {
    const observation = sorted[index];
    const state = observation.terrainVisibility.status;
    const previous = sorted[index - 1];
    const hasTimeGap = previous
      ? Date.parse(observation.timeUtc) - Date.parse(previous.timeUtc) >
        JPL_SAMPLE_INTERVAL_MINUTES * 60_000 + 1_000
      : false;

    if (index === 0) {
      currentState = state;
      startIndex = 0;
      continue;
    }

    if (state !== currentState || hasTimeGap) {
      closeWindow(index - 1);
      currentState = state;
      startIndex = index;
    }
  }

  closeWindow(sorted.length - 1);
  return windows;
}

function buildTarget(
  observations: HorizonsObservation[],
  horizon: TerrainHorizonResult | null
): HorizonsTarget {
  const assessed = observations.map((observation) => ({
    ...observation,
    terrainVisibility: horizon
      ? assessTargetVisibility(observation, horizon)
      : {
          azimuthDeg: observation.azimuthDeg,
          targetElevationDeg: observation.elevationDeg,
          terrainHorizonElevationDeg: null,
          clearanceDeg: null,
          angularDiameterArcsec: observation.angularDiameterArcsec,
          status: "terrain_horizon_unavailable" as const,
          targetDiskVisible: null,
          terrainCoverageComplete: false as const,
        },
  }));

  return {
    ...(assessed[0] ?? {}),
    observations: assessed,
    visibilityWindows: buildVisibilityWindows(assessed),
  };
}

/* =====================================================
   ERROR HANDLING
===================================================== */

function getErrorMessage(
  error: unknown
): string {
  return error instanceof Error
    ? error.message
    : "Unknown selected-location calculation error.";
}

/* =====================================================
   API ROUTE
===================================================== */

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const { id: siteId, site } = getSelectedSite(params.get("siteId"));
    const mission = getDateAndTime(
      params.get("date"),
      params.get("time"),
      params.get("durationHours")
    );

    const requestedLatitude = parseFiniteParameter(params.get("lat"), "Latitude");
    const requestedLongitude = parseFiniteParameter(params.get("lon"), "Longitude");

    if (requestedLatitude !== null && (requestedLatitude < -90 || requestedLatitude > 90)) {
      throw new Error("Latitude must be between -90 and 90 degrees.");
    }
    if (requestedLongitude !== null && (requestedLongitude < -360 || requestedLongitude > 360)) {
      throw new Error("Longitude must be between -360 and 360 degrees.");
    }

    // Product78 candidate sites are in the lunar south-polar region.
    const latitudeDeg = requestedLatitude === null
      ? site.observer.latitudeDeg
      : Math.sign(site.observer.latitudeDeg || -1) * Math.abs(requestedLatitude);
    const longitudeEastDeg = normalizeLongitudeEast(
      requestedLongitude ?? site.observer.longitudeEastDeg
    );

    const observer: GeographicCoordinate = {
      latitudeDeg,
      longitudeEastDeg,
    };

    const suppliedPixelColumn = parseOptionalPixel(params.get("pixelColumn"), "pixelColumn");
    const suppliedPixelRow = parseOptionalPixel(params.get("pixelRow"), "pixelRow");

    if ((suppliedPixelColumn === null) !== (suppliedPixelRow === null)) {
      throw new Error("Both pixelColumn and pixelRow must be supplied together.");
    }

    // Load Product78 and verify that the exact map coordinate and pixel agree.
    const terrain = await loadTerrainForSite(siteId);
    const observerSample = sampleLolaHeightAtLocation(terrain, observer);

    if (suppliedPixelColumn !== null && suppliedPixelRow !== null) {
      const pixelDifference = Math.hypot(
        suppliedPixelColumn - observerSample.pixel.column,
        suppliedPixelRow - observerSample.pixel.row
      );

      if (pixelDifference > 1.5) {
        throw new Error(
          "The supplied raster pixel does not match the selected geographic coordinate for this site."
        );
      }
    }

    const altitudeKm = observerSample.elevationMeters / 1000;

    // Request the exact observer's ephemerides before doing the more expensive
    // local horizon calculation. Sun and Earth failures are isolated.
    const [sunResult, earthResult] = await Promise.allSettled([
      requestHorizonsTarget(
        "10",
        observer,
        altitudeKm,
        mission.startTime,
        mission.stopTime
      ),
      requestHorizonsTarget(
        "399",
        observer,
        altitudeKm,
        mission.startTime,
        mission.stopTime
      ),
    ]);

    const sunObservations = sunResult.status === "fulfilled" ? sunResult.value : null;
    const earthObservations = earthResult.status === "fulfilled" ? earthResult.value : null;
    const targetErrors = {
      sun: sunResult.status === "rejected"
        ? getErrorMessage(sunResult.reason)
        : null,
      earth: earthResult.status === "rejected"
        ? getErrorMessage(earthResult.reason)
        : null,
    };

    if (!sunObservations && !earthObservations) {
      return NextResponse.json(
        {
          success: false,
          status: "unavailable",
          source: "NASA/JPL Horizons",
          error: "Both exact-observer JPL Horizons requests failed.",
          targetErrors,
          observer: {
            latitudeDeg: observer.latitudeDeg,
            longitudeEastDeg: observer.longitudeEastDeg,
            altitudeKm,
            elevationMeters: observerSample.elevationMeters,
            pixel: observerSample.pixel,
            nearestPixel: observerSample.nearestPixel,
          },
          mission,
        },
        { status: 502 }
      );
    }

    // Product90 is optional and opt-in via ?includeProduct90=true. The
    // Product78-only horizon is the fast baseline for the normal explorer.
    const includeProduct90 = params.get("includeProduct90") === "true";
    let terrainHorizon: TerrainHorizonResult | null = null;
    let terrainError: string | null = null;

    try {
      terrainHorizon = await withTimeout(
        getTerrainHorizon(siteId, terrain, observer, includeProduct90),
        TERRAIN_HORIZON_RESPONSE_BUDGET_MS,
        `Terrain horizon calculation exceeded the ${TERRAIN_HORIZON_RESPONSE_BUDGET_MS / 1000}-second response budget. Exact-observer JPL data is still available; retry to reuse the in-progress terrain calculation.`
      );
    } catch (error) {
      terrainError = getErrorMessage(error);
      console.warn("[Selected Location API] Terrain horizon unavailable:", terrainError);
    }

    const sunTarget = sunObservations
      ? buildTarget(sunObservations, terrainHorizon)
      : null;
    const earthTarget = earthObservations
      ? buildTarget(earthObservations, terrainHorizon)
      : null;

    const status =
      sunTarget && earthTarget && terrainHorizon
        ? "complete"
        : "partial";

    return NextResponse.json({
      success: true,
      status,
      site: {
        id: siteId,
        archiveSite: site.archiveSite,
        displayName: site.displayName,
        dataDirectory: site.dataDirectory,
      },
      mission: {
        ...mission,
        sampleIntervalMinutes: JPL_SAMPLE_INTERVAL_MINUTES,
      },
      horizonProfile: terrainHorizon?.directions ?? [],
      observer: {
        latitudeDeg: observer.latitudeDeg,
        longitudeEastDeg: observer.longitudeEastDeg,
        altitudeKm,
        elevationMeters: observerSample.elevationMeters,
        pixel: observerSample.pixel,
        nearestPixel: observerSample.nearestPixel,
      },
      targets: {
        ...(sunTarget ? { sun: sunTarget } : {}),
        ...(earthTarget ? { earth: earthTarget } : {}),
      },
      targetErrors,
      terrainError,
      terrainModel: {
        product: "NASA LOLA Product78",
        siteId,
        siteName: site.displayName,
        resolutionMeters: terrain.resolutionMeters,
        sampleStepMeters: terrainHorizon?.sampleStepMeters ?? TERRAIN_OPTIONS.sampleStepMeters,
        maxDistanceMeters: terrainHorizon?.maxDistanceMeters ?? TERRAIN_OPTIONS.maxDistanceMeters,
        calculatedDirections: terrainHorizon?.calculatedDirections ?? 0,
        totalSamplesChecked: terrainHorizon?.totalSamplesChecked ?? 0,
        product78SamplesChecked: terrainHorizon?.product78SamplesChecked ?? 0,
        product90SamplesChecked: terrainHorizon?.product90SamplesChecked ?? 0,
        product90Status: terrainHorizon?.product90Status ?? (includeProduct90 ? "unavailable" : "disabled"),
        product90Error: terrainHorizon?.product90Error ?? null,
        regionalResolutionMeters: terrainHorizon && terrainHorizon.product90SamplesChecked > 0
          ? terrainHorizon.product90ResolutionMeters
          : null,
        rasterBoundaryLimitedDirections: terrainHorizon?.rasterBoundaryLimitedDirections ?? 0,
        searchLimitReachedDirections: terrainHorizon?.searchLimitReachedDirections ?? 0,
        completeHorizonVerified: false,
        status: terrainHorizon ? "partial" : "unavailable",
        error: terrainError,
      },
      sources: {
        ephemeris: "NASA/JPL Horizons",
        localTerrain: "NASA LOLA Product78",
        regionalTerrain: terrainHorizon && terrainHorizon.product90SamplesChecked > 0
          ? "NASA LOLA Product90 (20 m pixel spacing; optional regional samples)"
          : "Not used — Product78 baseline only or regional samples unavailable",
      },
      interpretation: {
        horizonProfile:
          "Each azimuth reports the highest sampled terrain elevation angle within known coverage. Terrain beyond the last known sample or coverage boundary remains unknown.",
        sunVisibility:
          "Above-sampled-terrain is a provisional result from the available local profile; it is not proof of a globally complete horizon.",
        earthVisibility:
          "Earth terrain visibility is geometric line-of-sight screening only. No radio-frequency link budget, antenna gain, transmit power, pointing loss, or data-rate analysis is included.",
        visibilityWindows:
          "10-minute sampled windows. Boundaries are observation timestamps, not exact interpolated crossings.",
      },
    });
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Selected Location API]", message);
    return NextResponse.json(
      {
        success: false,
        status: "error",
        error: message,
      },
      { status: 500 }
    );
  }
}
