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
  directionCount: 720,
  sampleStepMeters: 5,
  regionalSampleStepMeters: 20,
  maxDistanceMeters: 15000,
  directionConcurrency: 8,
  // Product90 is optional: the sampler preserves the Product78 baseline
  // if metadata, compatibility checks, COG access or tile sampling fail.
  enableProduct90: true,
};

const JPL_SAMPLE_INTERVAL_MINUTES = 10;
const ALLOWED_DURATION_HOURS = [6, 12, 24, 48, 72] as const;

type HorizonsObservation = {
  time: string;
  timeUtc: string;
  azimuthDeg: number;
  elevationDeg: number;
  angularDiameterArcsec: number | null;
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
  observer: GeographicCoordinate
): Promise<TerrainHorizonResult> {
  const cacheKey = [
    siteId,
    observer.latitudeDeg.toFixed(7),
    observer.longitudeEastDeg.toFixed(7),
  ].join(":");

  const cached =
    horizonPromises.get(cacheKey);

  if (cached) {
    return cached;
  }

  const pending =
    calculateMultiResolutionTerrainHorizon(
      terrain,
      observer,
      TERRAIN_OPTIONS
    );

  horizonPromises.set(
    cacheKey,
    pending
  );

  try {
    return await pending;
  } catch (error) {
    if (
      horizonPromises.get(cacheKey) === pending
    ) {
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
 * Quantity 13 = target angular diameter
 *
 * Horizons returns the selected quantities in the same order.
 *
 * Quantity 13 is in arcseconds.
 */
function parseHorizonsObservations(
  responseText: string
): HorizonsObservation[] {
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
  const observations: HorizonsObservation[] = [];

  for (const rawLine of table.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const timeMatch = line.match(
      /^(\d{4})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/
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
  const params = new URLSearchParams({
    format: "text",

    COMMAND: `'${targetId}'`,

    OBJ_DATA: "NO",
    MAKE_EPHEM: "YES",
    EPHEM_TYPE: "OBSERVER",

    CENTER: "'coord@301'",
    COORD_TYPE: "GEODETIC",

    SITE_COORD:
      `'${normalizeHorizonsLongitude(
        observer.longitudeEastDeg
      )},${observer.latitudeDeg},${altitudeKm}'`,

    START_TIME: `'${startTime}'`,
    STOP_TIME: `'${stopTime}'`,

    STEP_SIZE: "'10m'",

    /*
     * 4  = apparent AZ/EL
     * 13 = target angular diameter
     */
    QUANTITIES: "'4,13'",

    /*
     * Make the time basis explicit. The mission time passed
     * to this route is interpreted as UT.
     */
    TIME_TYPE: "UT",
    TIME_DIGITS: "SECONDS",

    CSV_FORMAT: "NO",
    ANG_FORMAT: "DEG",
    APPARENT: "AIRLESS",
    EXTRA_PREC: "YES",
  });

  const response = await fetch(
    `${HORIZONS_URL}?${params.toString()}`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    }
  );

  const responseText =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `JPL Horizons request failed for target ${targetId}: HTTP ${response.status}. ${responseText.slice(0, 500)}`
    );
  }

  if (
    responseText.includes("INPUT ERROR") ||
    responseText.includes("$$SOF")
  ) {
    throw new Error(
      `JPL Horizons rejected target ${targetId}: ${responseText.slice(0, 800)}`
    );
  }

  return parseHorizonsObservations(responseText);
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
  horizon: TerrainHorizonResult
): HorizonsTarget {
  const assessed = observations.map((observation) => ({
    ...observation,
    terrainVisibility: assessTargetVisibility(observation, horizon),
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

export async function GET(
  request: NextRequest
) {
  try {
    const params =
      request.nextUrl.searchParams;

    const {
      id: siteId,
      site,
    } = getSelectedSite(
      params.get("siteId")
    );

    const mission = getDateAndTime(
      params.get("date"),
      params.get("time"),
      params.get("durationHours")
    );

    const requestedLatitude =
      parseFiniteParameter(
        params.get("lat"),
        "Latitude"
      );

    const requestedLongitude =
      parseFiniteParameter(
        params.get("lon"),
        "Longitude"
      );

    /*
     * Product 78 sites in this route are southern lunar
     * landing sites. Preserve the site's hemisphere.
     */
    const latitudeDeg =
      requestedLatitude === null
        ? site.observer.latitudeDeg
        : Math.sign(
          site.observer.latitudeDeg
        ) *
        Math.abs(requestedLatitude);

    const longitudeEastDeg =
      normalizeLongitudeEast(
        requestedLongitude ??
        site.observer.longitudeEastDeg
      );

    if (
      latitudeDeg < -90 ||
      latitudeDeg > 0
    ) {
      throw new Error(
        "The selected site must use a valid southern lunar latitude."
      );
    }

    const observer: GeographicCoordinate = {
      latitudeDeg,
      longitudeEastDeg,
    };

    const suppliedPixelColumn =
      parseOptionalPixel(
        params.get("pixelColumn"),
        "pixelColumn"
      );

    const suppliedPixelRow =
      parseOptionalPixel(
        params.get("pixelRow"),
        "pixelRow"
      );

    if (
      (suppliedPixelColumn === null) !==
      (suppliedPixelRow === null)
    ) {
      throw new Error(
        "Both pixelColumn and pixelRow must be supplied together."
      );
    }

    /* -----------------------------------------------
       Load the actual selected site's Product 78 data.
    ------------------------------------------------ */

    const terrain =
      await loadTerrainForSite(siteId);

    const observerSample =
      sampleLolaHeightAtLocation(
        terrain,
        observer
      );

    /*
     * Confirm that the planner's selected pixel and
     * geographic coordinate refer to the same location.
     */
    if (
      suppliedPixelColumn !== null &&
      suppliedPixelRow !== null
    ) {
      const pixelDifference =
        Math.hypot(
          suppliedPixelColumn -
          observerSample.pixel.column,

          suppliedPixelRow -
          observerSample.pixel.row
        );

      if (pixelDifference > 1.5) {
        throw new Error(
          "The supplied raster pixel does not match the selected geographic coordinate for this site."
        );
      }
    }

    /* -----------------------------------------------
       Calculate the local terrain horizon.
    ------------------------------------------------ */

    const terrainHorizon =
      await getTerrainHorizon(
        siteId,
        terrain,
        observer
      );

    /*
     * JPL accepts the observer's lunar elevation in km.
     * The elevation comes from the selected LOLA sample.
     */
    const altitudeKm =
      observerSample.elevationMeters / 1000;

    /* -----------------------------------------------
       Fetch actual JPL apparent positions.
    ------------------------------------------------ */

    const [
      sunObservations,
      earthObservations,
    ] = await Promise.all([
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

    /* -----------------------------------------------
       Assess both disks against the sampled terrain.
    ------------------------------------------------ */

    const sunTarget = buildTarget(sunObservations, terrainHorizon);
    const earthTarget = buildTarget(earthObservations, terrainHorizon);

    /* -----------------------------------------------
       Return flat target objects.

       This is the exact shape consumed by
       Lunar360Explorer.tsx:

       targets.sun.azimuthDeg
       targets.sun.elevationDeg
       targets.sun.terrainVisibility.status
    ------------------------------------------------ */

    return NextResponse.json({
      success: true,

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
      horizonProfile: terrainHorizon.directions,

      observer: {
        latitudeDeg:
          observer.latitudeDeg,

        longitudeEastDeg:
          observer.longitudeEastDeg,

        altitudeKm,

        elevationMeters:
          observerSample.elevationMeters,

        pixel:
          observerSample.pixel,

        nearestPixel:
          observerSample.nearestPixel,
      },

      targets: {
        sun: sunTarget,
        earth: earthTarget,
      },

      terrainModel: {
        product: "NASA LOLA Product 78",
        siteId,
        siteName: site.displayName,

        resolutionMeters:
          terrain.resolutionMeters,

        referenceFrame:
          terrain.metadata.coordinateSystem.referenceFrame,

        ephemeris:
          terrain.metadata.coordinateSystem.ephemeris,

        sampleStepMeters:
          terrainHorizon.sampleStepMeters,

        maxDistanceMeters:
          terrainHorizon.maxDistanceMeters,

        calculatedDirections:
          terrainHorizon.calculatedDirections,

        totalSamplesChecked:
          terrainHorizon.totalSamplesChecked,

        product78SamplesChecked:
          terrainHorizon.product78SamplesChecked,

        product90SamplesChecked:
          terrainHorizon.product90SamplesChecked,

        product90Status: terrainHorizon.product90Status,
        product90Error: terrainHorizon.product90Error,
        regionalResolutionMeters:
          terrainHorizon.product90SamplesChecked > 0
            ? terrainHorizon.product90ResolutionMeters
            : null,

        rasterBoundaryLimitedDirections:
          terrainHorizon.rasterBoundaryLimitedDirections,

        searchLimitReachedDirections:
          terrainHorizon.searchLimitReachedDirections,

        completeHorizonVerified: false,
      },

      sources: {
        ephemeris: "NASA/JPL Horizons",
        localTerrain: "NASA LOLA Product 78",
        regionalTerrain:
          terrainHorizon.product90SamplesChecked > 0
            ? "NASA LOLA Product 90 (20 m pixel spacing; optional regional samples)"
            : "Not used — regional terrain samples unavailable or not required",
      },

      interpretation: {
        horizonProfile:
          "Each azimuth reports the highest sampled terrain elevation angle within known coverage. Terrain beyond the last known sample or coverage boundary remains unknown.",
        sunVisibility:
          "Each observation is assessed against the sampled terrain profile. Above-sampled-terrain status is not proof of complete visibility.",
        earthVisibility:
          "Earth terrain visibility is a geometric line-of-sight screening only. No radio-frequency link budget, antenna gain, transmit power, pointing loss, or data-rate analysis is included.",
        visibilityWindows:
          "10-minute sampled windows. Boundaries are observation timestamps, not exact interpolated crossings.",
      },
    });
  } catch (error) {
    const message =
      getErrorMessage(error);

    console.error(
      "[Selected Location API]",
      message
    );

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      {
        status: 400,
      }
    );
  }
}