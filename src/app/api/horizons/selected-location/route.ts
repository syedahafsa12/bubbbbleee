
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
    maxDistanceMeters: 15000,
    directionConcurrency: 8,
  };

  const DAY_SAMPLE_INTERVAL_MS = 60_000;
  const EPOCH_MATCH_TOLERANCE_MS = 1500;

  const HORIZONS_MAX_RETRIES = 3;

  const HORIZONS_RETRY_DELAYS_MS = [
    2000,
    5000,
    10000,
  ];

  const HORIZONS_USER_AGENT =
    process.env.HORIZONS_USER_AGENT ??
    "LUNAPATH/1.0 (contact: configure-HORIZONS_USER_AGENT)";

  const TERRAIN_HORIZON_COVERAGE_VERIFIED = false;

  const CYCLE_PRE_START_HOURS = 12;
  const CYCLE_COARSE_INTERVAL_MINUTES = 10;
  const CYCLE_REFINEMENT_INTERVAL_MINUTES = 1;
  const CYCLE_REFINEMENT_PADDING_MS = 10 * 60 * 1000;

  /* =====================================================
    TYPES
  ===================================================== */

  type HorizonsObservation = {
    time: string;
    azimuthDeg: number;
    elevationDeg: number;
    angularDiameterArcsec: number | null;
  };

  type SampledDiskVisibility =
    | "below_sampled_horizon"
    | "partially_above_sampled_horizon"
    | "fully_above_sampled_horizon"
    | "unknown";

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
    upperLimbClearanceDeg: number | null;
    lowerLimbClearanceDeg: number | null;
    sampledDiskVisibility: SampledDiskVisibility;
    anyPartAboveSampledHorizon: boolean | null;
    fullDiskAboveSampledHorizon: boolean | null;
    status: TerrainVisibilityStatus;
    targetDiskVisible: boolean | null;
    terrainCoverageComplete: false;
  };

  type TerrainHorizonResult = Awaited<
    ReturnType<typeof calculateMultiResolutionTerrainHorizon>
  >;

  type HorizonDirection =
    TerrainHorizonResult["directions"][number];

  type JointVisibilitySample = {
    epoch: number;
    timeIso: string;
    timeUtc: string;
    sunUpperLimbClearanceDeg: number;
    earthUpperLimbClearanceDeg: number;
    sunLowerLimbClearanceDeg: number;
    earthLowerLimbClearanceDeg: number;
    jointClearanceDeg: number;
    fullDiskJointClearanceDeg: number | null;
    sunSampledDiskVisibility: SampledDiskVisibility;
    earthSampledDiskVisibility: SampledDiskVisibility;
    epochDifferenceMs: number;
  };

  type JointVisibilityWindow = {
    startTimeIso: string;
    endTimeIso: string;
    startTimeUtc: string;
    endTimeUtc: string;
    durationMinutes: number;
    sampleCount: number;
    bestTimeIso: string;
    bestTimeUtc: string;
    bestSunClearanceDeg: number;
    bestEarthClearanceDeg: number;
    bestJointClearanceDeg: number;
    bestSunUpperLimbClearanceDeg: number;
    bestEarthUpperLimbClearanceDeg: number;
    bestSunLowerLimbClearanceDeg: number;
    bestEarthLowerLimbClearanceDeg: number;
    fullDiskJointClearanceDeg: number | null;
  };

  type EpochRange = {
    startEpoch: number;
    stopEpoch: number;
    startTime: string;
    stopTime: string;
  };

  type TimedObservation = {
    observation: HorizonsObservation;
    epoch: number;
  };

  type MatchedObservationPair = {
    sun: TimedObservation;
    earth: TimedObservation;
    epoch: number;
    epochDifferenceMs: number;
  };

  /* =====================================================
    REQUEST QUEUE
  ===================================================== */

  let horizonsRequestQueue: Promise<void> =
    Promise.resolve();

  function withHorizonsRequestLock<T>(
    task: () => Promise<T>,
  ): Promise<T> {
    const current = horizonsRequestQueue.then(
      task,
      task,
    );

    horizonsRequestQueue = current.then(
      () => undefined,
      () => undefined,
    );

    return current;
  }

  function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }

  /* =====================================================
    HORIZONS RETRY HELPERS
  ===================================================== */

  function getRetryAfterMilliseconds(
    value: string | null,
  ): number {
    if (!value) return 0;

    const seconds = Number(value);

    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    const timestamp = Date.parse(value);

    if (!Number.isFinite(timestamp)) {
      return 0;
    }

    return Math.max(0, timestamp - Date.now());
  }

  function cleanErrorResponse(value: string): string {
    return value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 350);
  }

  function isRetryableStatus(status: number): boolean {
    return [
      408,
      429,
      500,
      502,
      503,
      504,
    ].includes(status);
  }

  /* =====================================================
    IN-MEMORY CACHES
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
    longitude: number,
  ): number {
    return ((longitude % 360) + 360) % 360;
  }

  function normalizeHorizonsLongitude(
    longitude: number,
  ): number {
    const normalized = normalizeLongitudeEast(longitude);

    return normalized > 180
      ? normalized - 360
      : normalized;
  }

  function normalizeAzimuth(
    azimuth: number,
  ): number {
    return ((azimuth % 360) + 360) % 360;
  }

  /* =====================================================
    QUERY VALIDATION
  ===================================================== */

  function parseFiniteParameter(
    value: string | null,
    name: string,
  ): number | null {
    if (value === null || value.trim() === "") {
      return null;
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      throw new Error(
        `${name} must be a finite number.`,
      );
    }

    return parsed;
  }

  function parseOptionalPixel(
    value: string | null,
    name: string,
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
        `${name} must be a valid numeric pixel coordinate.`,
      );
    }

    return parsed;
  }

  function getSelectedSite(
    siteIdValue: string | null,
  ): {
    id: Product78SiteId;
    site: ReturnType<typeof getProduct78Site>;
  } {
    const requestedId =
      siteIdValue ?? DEFAULT_PRODUCT78_SITE_ID;

    const validSiteIds: Product78SiteId[] = [
      "site04_shackleton_rim",
      "site11_de_gerlache_rim",
      "site23_malapert_massif",
    ];

    if (
      !validSiteIds.includes(
        requestedId as Product78SiteId,
      )
    ) {
      throw new Error(
        `Unknown landing site "${requestedId}".`,
      );
    }

    const id = requestedId as Product78SiteId;

    return {
      id,
      site: getProduct78Site(id),
    };
  }

  /* =====================================================
    UTC DATE AND TIME
  ===================================================== */

  function validateDate(
    dateValue: string | null,
  ): string {
    if (
      !dateValue ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)
    ) {
      throw new Error(
        "A valid UTC date is required in YYYY-MM-DD format. Accepted parameter names: date or startDate.",
      );
    }

    const parsed = new Date(
      `${dateValue}T00:00:00.000Z`,
    );

    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== dateValue
    ) {
      throw new Error(
        "The selected UTC date is invalid.",
      );
    }

    return dateValue;
  }

  function normalizeClockTime(
    rawValue: string,
  ): string {
    const value = rawValue.trim();

    const meridiemMatch = value.match(
      /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i,
    );

    if (meridiemMatch) {
      let hours = Number(meridiemMatch[1]);

      const minutes = Number(meridiemMatch[2]);
      const seconds = Number(meridiemMatch[3] ?? 0);

      const meridiem =
        meridiemMatch[4].toUpperCase();

      if (
        hours < 1 ||
        hours > 12 ||
        minutes > 59 ||
        seconds > 59
      ) {
        throw new Error(
          `Invalid clock time "${rawValue}".`,
        );
      }

      if (meridiem === "AM") {
        if (hours === 12) hours = 0;
      } else if (hours !== 12) {
        hours += 12;
      }

      return [
        String(hours).padStart(2, "0"),
        String(minutes).padStart(2, "0"),
        String(seconds).padStart(2, "0"),
      ].join(":");
    }

    const match = value.match(
      /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/,
    );

    if (!match) {
      throw new Error(
        `Invalid UTC time "${rawValue}". Expected HH:mm, HH:mm:ss, or a 12-hour time such as 2:30 PM.`,
      );
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3] ?? 0);

    if (
      hours > 23 ||
      minutes > 59 ||
      seconds > 59
    ) {
      throw new Error(
        `Invalid UTC time "${rawValue}".`,
      );
    }

    return [
      String(hours).padStart(2, "0"),
      String(minutes).padStart(2, "0"),
      String(seconds).padStart(2, "0"),
    ].join(":");
  }

  function parseCompleteDateTime(
    rawValue: string,
  ): number | null {
    const value = rawValue.trim();

    const match = value.match(
      /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)(Z|[+-]\d{2}:?\d{2})?$/i,
    );

    if (!match) {
      return null;
    }

    const date = match[1];
    const clock = match[2];
    const timezone = match[3] ?? "Z";

    const normalized =
      `${date}T${clock}${timezone}`;

    const epoch = Date.parse(normalized);

    if (!Number.isFinite(epoch)) {
      return null;
    }

    const dateCheck = new Date(
      `${date}T00:00:00.000Z`,
    );

    if (
      Number.isNaN(dateCheck.getTime()) ||
      dateCheck.toISOString().slice(0, 10) !== date
    ) {
      return null;
    }

    return epoch;
  }

  function createMissionFromEpoch(epoch: number) {
    const iso = new Date(epoch).toISOString();

    const date = iso.slice(0, 10);
    const time = iso.slice(11, 19);

    const stop = new Date(epoch + 60_000);

    return {
      date,
      time,
      timeScale: "UTC" as const,
      epoch,
      startTime: `${date} ${time}`,
      stopTime:
        `${stop.toISOString().slice(0, 10)} ${stop.toISOString().slice(11, 19)}`,
    };
  }

  function getDateAndTimeFromParams(
    params: URLSearchParams,
  ) {
    const completeDateTimeParameters = [
      "startDateTime",
      "startDatetime",
      "missionStart",
      "missionStartTime",
      "datetime",
      "start",
    ];

    for (const name of completeDateTimeParameters) {
      const rawValue = params.get(name);

      if (!rawValue?.trim()) continue;

      const epoch = parseCompleteDateTime(rawValue);

      if (epoch === null) {
        throw new Error(
          `Parameter "${name}" must be a complete date-time, such as 2026-11-15T12:00:00Z.`,
        );
      }

      return createMissionFromEpoch(epoch);
    }

    const dateValue =
      params.get("date") ??
      params.get("startDate") ??
      params.get("utcDate") ??
      params.get("start_date");

    const timeValue =
      params.get("time") ??
      params.get("startTime") ??
      params.get("utcTime") ??
      params.get("start_time");

    if (timeValue?.trim()) {
      const completeEpoch =
        parseCompleteDateTime(timeValue);

      if (completeEpoch !== null) {
        return createMissionFromEpoch(completeEpoch);
      }
    }

    if (!dateValue || !timeValue) {
      throw new Error(
        "Mission start date and time are required. Accepted inputs are date + time, startDate + startTime, or a complete startDateTime ISO timestamp.",
      );
    }

    const date = validateDate(dateValue);
    const normalizedTime = normalizeClockTime(timeValue);

    const epoch = Date.parse(
      `${date}T${normalizedTime}.000Z`,
    );

    if (!Number.isFinite(epoch)) {
      throw new Error(
        "The selected UTC date and time are invalid.",
      );
    }

    return createMissionFromEpoch(epoch);
  }

  function getUtcDayRange(
    dateValue: string | null,
  ): EpochRange & {
    date: string;
  } {
    const date = validateDate(dateValue);

    const start = new Date(
      `${date}T00:00:00.000Z`,
    );

    const stop = new Date(
      start.getTime() + 24 * 60 * 60 * 1000,
    );

    return {
      date,
      startEpoch: start.getTime(),
      stopEpoch: stop.getTime(),
      startTime: `${date} 00:00:00`,
      stopTime:
        `${stop.toISOString().slice(0, 10)} 00:00:00`,
    };
  }

  /* =====================================================
    EMISSION DURATION
  ===================================================== */

  function parseEmissionDurationHours(
    params: URLSearchParams,
  ): number {
    const rawValue =
      params.get("durationHours") ??
      params.get("emissionDurationHours") ??
      params.get("missionDurationHours") ??
      params.get("emissionDuration") ??
      params.get("duration") ??
      params.get("hours");

    if (
      rawValue === null ||
      rawValue.trim() === ""
    ) {
      throw new Error(
        "Emission duration is required. Pass durationHours, emissionDurationHours, or emissionDuration.",
      );
    }

    const normalized = rawValue.toLowerCase().trim();

    const hourMatch = normalized.match(
      /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)?$/,
    );

    const dayMatch = normalized.match(
      /^(\d+(?:\.\d+)?)\s*(?:d|day|days)$/,
    );

    const minuteMatch = normalized.match(
      /^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)$/,
    );

    let hours: number;

    if (hourMatch) {
      hours = Number(hourMatch[1]);
    } else if (dayMatch) {
      hours = Number(dayMatch[1]) * 24;
    } else if (minuteMatch) {
      hours = Number(minuteMatch[1]) / 60;
    } else {
      throw new Error(
        `Invalid emission duration "${rawValue}". Use 24, 24h, 24 hours, or 1 day.`,
      );
    }

    if (
      !Number.isFinite(hours) ||
      hours <= 0 ||
      hours > 168
    ) {
      throw new Error(
        "Emission duration must be greater than 0 and no more than 168 hours.",
      );
    }

    return hours;
  }

  /* =====================================================
    TIME FORMATTING
  ===================================================== */

  const MONTHS: Record<string, number> = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };

  function horizonsTimeToEpoch(
    value: string,
  ): number {
    const match = value.match(
      /^(\d{4})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/,
    );

    if (!match) {
      return Number.NaN;
    }

    const year = Number(match[1]);
    const month = MONTHS[match[2]];
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6] ?? 0);

    const fraction = match[7] ?? "";

    const milliseconds =
      fraction.length > 0
        ? Number(
            `0.${fraction.padEnd(3, "0").slice(0, 3)}`,
          ) * 1000
        : 0;

    if (month === undefined) {
      return Number.NaN;
    }

    return Date.UTC(
      year,
      month,
      day,
      hour,
      minute,
      second,
      Math.floor(milliseconds),
    );
  }

  function toIsoTime(epoch: number): string {
    return new Date(epoch).toISOString();
  }

  function toUtcClock(epoch: number): string {
    return toIsoTime(epoch).slice(11, 19);
  }

  function formatHorizonsEpoch(epoch: number): string {
    const iso = toIsoTime(epoch);

    return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
  }

  /* =====================================================
    PRODUCT 78 TERRAIN LOADING
  ===================================================== */

  async function loadTerrainForSite(
    siteId: Product78SiteId,
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
        site.dataDirectory,
      );

      const [metadataText, binary] = await Promise.all([
        readFile(
          path.join(directory, "metadata.json"),
          "utf8",
        ),
        readFile(
          path.join(directory, "elevation.bin"),
        ),
      ]);

      const rawMetadata: unknown =
        JSON.parse(metadataText);

      const terrain = decodeLolaTerrain(
        rawMetadata,
        new Uint8Array(binary),
      );

      console.info(
        "[Horizons] Loaded Product 78 terrain:",
        {
          siteId,
          archiveSite: site.archiveSite,
          dimensions:
            `${terrain.width} x ${terrain.height}`,
          resolutionMeters: terrain.resolutionMeters,
        },
      );

      return terrain;
    })();

    terrainPromises.set(siteId, pending);

    try {
      return await pending;
    } catch (error) {
      if (terrainPromises.get(siteId) === pending) {
        terrainPromises.delete(siteId);
      }

      throw error;
    }
  }

  /* =====================================================
    PRODUCT 78 TERRAIN HORIZON
  ===================================================== */

  async function getTerrainHorizon(
    siteId: Product78SiteId,
    terrain: LolaTerrainData,
    observer: GeographicCoordinate,
  ): Promise<TerrainHorizonResult> {
    const cacheKey = [
      siteId,
      observer.latitudeDeg.toFixed(7),
      observer.longitudeEastDeg.toFixed(7),
    ].join(":");

    const cached = horizonPromises.get(cacheKey);

    if (cached) {
      return cached;
    }

    const pending =
      calculateMultiResolutionTerrainHorizon(
        terrain,
        observer,
        TERRAIN_OPTIONS,
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
    JPL HORIZONS RESPONSE PARSER
  ===================================================== */

  function parseHorizonsObservations(
    responseText: string,
  ): HorizonsObservation[] {
    const startIndex = responseText.indexOf("$$SOE");
    const endIndex = responseText.indexOf("$$EOE");

    if (
      startIndex === -1 ||
      endIndex === -1 ||
      endIndex <= startIndex
    ) {
      throw new Error(
        "JPL Horizons did not return an observation table.",
      );
    }

    const table = responseText.slice(
      startIndex + "$$SOE".length,
      endIndex,
    );

    const observations: HorizonsObservation[] = [];

    for (const rawLine of table.split(/\r?\n/)) {
      const line = rawLine.trim();

      if (!line) continue;

      const timeMatch = line.match(
        /^(\d{4}-[A-Za-z]{3}-\d{2}\s+\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)/,
      );

      if (!timeMatch) continue;

      const remaining = line.slice(
        timeMatch[0].length,
      );

      const values = remaining.match(
        /[-+]?\d+(?:\.\d+)?(?:[Ee][-+]?\d+)?/g,
      );

      if (!values || values.length < 2) {
        continue;
      }

      const azimuthDeg = Number(values[0]);
      const elevationDeg = Number(values[1]);

      const angularDiameter =
        values.length >= 3
          ? Number(values[2])
          : Number.NaN;

      if (
        !Number.isFinite(azimuthDeg) ||
        !Number.isFinite(elevationDeg) ||
        elevationDeg < -90 ||
        elevationDeg > 90
      ) {
        continue;
      }

      observations.push({
        time: timeMatch[1],

        azimuthDeg: normalizeAzimuth(azimuthDeg),

        elevationDeg,

        angularDiameterArcsec:
          Number.isFinite(angularDiameter) &&
          angularDiameter > 0
            ? angularDiameter
            : null,
      });
    }

    if (observations.length === 0) {
      throw new Error(
        "JPL Horizons returned no parseable observations. Check the Horizons table format.",
      );
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
    stopTime: string,
    stepSize = "1m",
    timeoutMs = 120_000,
  ): Promise<HorizonsObservation[]> {
    return withHorizonsRequestLock(async () => {
      const params = new URLSearchParams({
        format: "text",

        COMMAND: `'${targetId}'`,

        OBJ_DATA: "NO",
        MAKE_EPHEM: "YES",
        EPHEM_TYPE: "OBSERVER",

        CENTER: "'coord@301'",
        COORD_TYPE: "GEODETIC",

        SITE_COORD: `'${normalizeHorizonsLongitude(
          observer.longitudeEastDeg,
        )},${observer.latitudeDeg},${altitudeKm}'`,

        START_TIME: `'${startTime}'`,
        STOP_TIME: `'${stopTime}'`,
        STEP_SIZE: `'${stepSize}'`,

        QUANTITIES: "'4,13'",

        TIME_TYPE: "UT",
        TIME_DIGITS: "SECONDS",

        CSV_FORMAT: "NO",
        ANG_FORMAT: "DEG",

        APPARENT: "AIRLESS",
        EXTRA_PREC: "YES",
      });

      const url =
        `${HORIZONS_URL}?${params.toString()}`;

      let lastError = "Unknown Horizons error.";

      for (
        let attempt = 0;
        attempt <= HORIZONS_MAX_RETRIES;
        attempt++
      ) {
        console.info("[Horizons] Request:", {
          targetId,
          startTime,
          stopTime,
          stepSize,
          attempt: attempt + 1,
        });

        let response: Response;

        try {
          response = await fetch(url, {
            method: "GET",
            cache: "no-store",

            headers: {
              "User-Agent": HORIZONS_USER_AGENT,
              Accept: "text/plain",
            },

            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error) {
          lastError =
            error instanceof Error
              ? error.message
              : "Network request failed.";

          if (attempt >= HORIZONS_MAX_RETRIES) {
            throw new Error(
              `Unable to reach JPL Horizons after ${attempt + 1} attempts for target ${targetId}: ${lastError}`,
            );
          }

          const delay =
            HORIZONS_RETRY_DELAYS_MS[attempt];

          console.warn(
            `[Horizons] Network failure. Retrying target ${targetId} in ${delay}ms.`,
          );

          await sleep(delay);
          continue;
        }

        if (!response.ok) {
          const responseText = await response.text();

          lastError =
            `HTTP ${response.status}: ${cleanErrorResponse(responseText)}`;

          if (
            !isRetryableStatus(response.status) ||
            attempt >= HORIZONS_MAX_RETRIES
          ) {
            throw new Error(
              `JPL Horizons request failed for target ${targetId} after ${attempt + 1} attempts. ${lastError}`,
            );
          }

          const serverRetryAfter =
            getRetryAfterMilliseconds(
              response.headers.get("Retry-After"),
            );

          const localBackoff =
            HORIZONS_RETRY_DELAYS_MS[attempt];

          const delay = Math.max(
            serverRetryAfter,
            localBackoff,
          );

          console.warn(
            `[Horizons] HTTP ${response.status}. Retrying target ${targetId} in ${delay}ms.`,
          );

          await sleep(delay);
          continue;
        }

        const responseText = await response.text();

        if (
          responseText.includes("INPUT ERROR") ||
          responseText.includes("$$SOF")
        ) {
          throw new Error(
            `JPL Horizons rejected target ${targetId}: ${cleanErrorResponse(responseText)}`,
          );
        }

        return parseHorizonsObservations(
          responseText,
        );
      }

      throw new Error(
        `JPL Horizons request failed for target ${targetId}: ${lastError}`,
      );
    });
  }

  /* =====================================================
    TERRAIN HORIZON INTERPOLATION
  ===================================================== */

  function getTerrainHorizonAtAzimuth(
    directions: readonly HorizonDirection[],
    azimuthDeg: number,
  ): number | null {
    if (directions.length === 0) {
      return null;
    }

    const azimuth = normalizeAzimuth(azimuthDeg);

    let lower = directions[directions.length - 1];
    let upper = directions[0];

    for (
      let index = 0;
      index < directions.length;
      index++
    ) {
      const current = directions[index];

      const next = directions[
        (index + 1) % directions.length
      ];

      const lowerAzimuth = current.azimuthDeg;

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

    const lowerAzimuth = lower.azimuthDeg;

    let upperAzimuth = upper.azimuthDeg;
    let targetAzimuth = azimuth;

    if (upperAzimuth <= lowerAzimuth) {
      upperAzimuth += 360;
    }

    if (targetAzimuth < lowerAzimuth) {
      targetAzimuth += 360;
    }

    const span = upperAzimuth - lowerAzimuth;

    if (span <= 0) {
      return lowerHorizon;
    }

    const amount =
      (targetAzimuth - lowerAzimuth) / span;

    return (
      lowerHorizon +
      (upperHorizon - lowerHorizon) * amount
    );
  }

  /* =====================================================
    TARGET DISK VISIBILITY
  ===================================================== */

  function assessTargetVisibility(
    observation: HorizonsObservation,
    directions: readonly HorizonDirection[],
  ): TerrainVisibility {
    const terrainHorizonElevationDeg =
      getTerrainHorizonAtAzimuth(
        directions,
        observation.azimuthDeg,
      );

    if (terrainHorizonElevationDeg === null) {
      return {
        azimuthDeg: observation.azimuthDeg,
        targetElevationDeg: observation.elevationDeg,
        terrainHorizonElevationDeg: null,
        clearanceDeg: null,
        angularDiameterArcsec:
          observation.angularDiameterArcsec,
        upperLimbClearanceDeg: null,
        lowerLimbClearanceDeg: null,
        sampledDiskVisibility: "unknown",
        anyPartAboveSampledHorizon: null,
        fullDiskAboveSampledHorizon: null,
        status: "terrain_horizon_unavailable",
        targetDiskVisible: null,
        terrainCoverageComplete: false,
      };
    }

    const clearanceDeg =
      observation.elevationDeg -
      terrainHorizonElevationDeg;

    if (
      observation.angularDiameterArcsec === null
    ) {
      return {
        azimuthDeg: observation.azimuthDeg,
        targetElevationDeg: observation.elevationDeg,
        terrainHorizonElevationDeg,
        clearanceDeg,
        angularDiameterArcsec: null,
        upperLimbClearanceDeg: null,
        lowerLimbClearanceDeg: null,
        sampledDiskVisibility: "unknown",
        anyPartAboveSampledHorizon: null,
        fullDiskAboveSampledHorizon: null,
        status: "target_disk_size_unavailable",
        targetDiskVisible: null,
        terrainCoverageComplete: false,
      };
    }

    const angularRadiusDeg =
      observation.angularDiameterArcsec / 7200;

    const upperLimbClearanceDeg =
      clearanceDeg + angularRadiusDeg;

    const lowerLimbClearanceDeg =
      clearanceDeg - angularRadiusDeg;

    if (upperLimbClearanceDeg <= 0) {
      return {
        azimuthDeg: observation.azimuthDeg,
        targetElevationDeg: observation.elevationDeg,
        terrainHorizonElevationDeg,
        clearanceDeg,
        angularDiameterArcsec:
          observation.angularDiameterArcsec,
        upperLimbClearanceDeg,
        lowerLimbClearanceDeg,
        sampledDiskVisibility: "below_sampled_horizon",
        anyPartAboveSampledHorizon: false,
        fullDiskAboveSampledHorizon: false,
        status: "target_disk_below_sampled_terrain",
        targetDiskVisible: false,
        terrainCoverageComplete: false,
      };
    }

    if (lowerLimbClearanceDeg <= 0) {
      return {
        azimuthDeg: observation.azimuthDeg,
        targetElevationDeg: observation.elevationDeg,
        terrainHorizonElevationDeg,
        clearanceDeg,
        angularDiameterArcsec:
          observation.angularDiameterArcsec,
        upperLimbClearanceDeg,
        lowerLimbClearanceDeg,
        sampledDiskVisibility:
          "partially_above_sampled_horizon",
        anyPartAboveSampledHorizon: true,
        fullDiskAboveSampledHorizon: false,
        status:
          "target_disk_intersects_sampled_terrain",
        targetDiskVisible: null,
        terrainCoverageComplete: false,
      };
    }

    return {
      azimuthDeg: observation.azimuthDeg,
      targetElevationDeg: observation.elevationDeg,
      terrainHorizonElevationDeg,
      clearanceDeg,
      angularDiameterArcsec:
        observation.angularDiameterArcsec,
      upperLimbClearanceDeg,
      lowerLimbClearanceDeg,
      sampledDiskVisibility:
        "fully_above_sampled_horizon",
      anyPartAboveSampledHorizon: true,
      fullDiskAboveSampledHorizon: true,
      status:
        "target_disk_above_sampled_terrain_unconfirmed",
      targetDiskVisible: null,
      terrainCoverageComplete: false,
    };
  }

  /* =====================================================
    MATCH HORIZONS OBSERVATIONS BY EPOCH
  ===================================================== */

  function getTimedObservations(
    observations: HorizonsObservation[],
  ): TimedObservation[] {
    return observations
      .map((observation) => ({
        observation,
        epoch: horizonsTimeToEpoch(
          observation.time,
        ),
      }))
      .filter(
        (item) => Number.isFinite(item.epoch),
      )
      .sort(
        (a, b) => a.epoch - b.epoch,
      );
  }

  function getNearestTimedObservation(
    records: TimedObservation[],
    targetEpoch: number,
  ): TimedObservation | null {
    if (records.length === 0) {
      return null;
    }

    let best: TimedObservation | null = null;
    let bestDifference = Infinity;

    for (const record of records) {
      const difference = Math.abs(
        record.epoch - targetEpoch,
      );

      if (difference < bestDifference) {
        best = record;
        bestDifference = difference;
      }
    }

    if (
      best === null ||
      bestDifference > EPOCH_MATCH_TOLERANCE_MS
    ) {
      return null;
    }

    return best;
  }

  function buildMatchedObservationPairs(
    sunObservations: HorizonsObservation[],
    earthObservations: HorizonsObservation[],
    range: {
      startEpoch: number;
      stopEpoch: number;
    },
  ): MatchedObservationPair[] {
    const sunRecords =
      getTimedObservations(sunObservations);

    const earthRecords =
      getTimedObservations(earthObservations);

    const usedEarthEpochs = new Set<number>();

    const pairs: MatchedObservationPair[] = [];

    for (const sun of sunRecords) {
      if (
        sun.epoch < range.startEpoch ||
        sun.epoch >= range.stopEpoch
      ) {
        continue;
      }

      const earth = getNearestTimedObservation(
        earthRecords,
        sun.epoch,
      );

      if (!earth) continue;

      if (usedEarthEpochs.has(earth.epoch)) {
        continue;
      }

      const epochDifferenceMs = Math.abs(
        sun.epoch - earth.epoch,
      );

      if (
        epochDifferenceMs >
        EPOCH_MATCH_TOLERANCE_MS
      ) {
        continue;
      }

      usedEarthEpochs.add(earth.epoch);

      const epoch = Math.round(
        (sun.epoch + earth.epoch) / 2,
      );

      pairs.push({
        sun,
        earth,
        epoch,
        epochDifferenceMs,
      });
    }

    return pairs.sort(
      (a, b) => a.epoch - b.epoch,
    );
  }

  /* =====================================================
    BUILD JOINT VISIBILITY SAMPLES
  ===================================================== */

  function buildJointSamples(
    sunObservations: HorizonsObservation[],
    earthObservations: HorizonsObservation[],
    directions: readonly HorizonDirection[],
    range: {
      startEpoch: number;
      stopEpoch: number;
    },
  ): JointVisibilitySample[] {
    const pairs = buildMatchedObservationPairs(
      sunObservations,
      earthObservations,
      range,
    );

    const samples: JointVisibilitySample[] = [];

    for (const pair of pairs) {
      const sunVisibility =
        assessTargetVisibility(
          pair.sun.observation,
          directions,
        );

      const earthVisibility =
        assessTargetVisibility(
          pair.earth.observation,
          directions,
        );

      const sunUpper =
        sunVisibility.upperLimbClearanceDeg;

      const earthUpper =
        earthVisibility.upperLimbClearanceDeg;

      const sunLower =
        sunVisibility.lowerLimbClearanceDeg;

      const earthLower =
        earthVisibility.lowerLimbClearanceDeg;

      if (
        sunUpper === null ||
        earthUpper === null ||
        sunLower === null ||
        earthLower === null
      ) {
        continue;
      }

      samples.push({
        epoch: pair.epoch,
        timeIso: toIsoTime(pair.epoch),
        timeUtc: toUtcClock(pair.epoch),

        sunUpperLimbClearanceDeg: sunUpper,
        earthUpperLimbClearanceDeg: earthUpper,

        sunLowerLimbClearanceDeg: sunLower,
        earthLowerLimbClearanceDeg: earthLower,

        jointClearanceDeg: Math.min(
          sunUpper,
          earthUpper,
        ),

        fullDiskJointClearanceDeg: Math.min(
          sunLower,
          earthLower,
        ),

        sunSampledDiskVisibility:
          sunVisibility.sampledDiskVisibility,

        earthSampledDiskVisibility:
          earthVisibility.sampledDiskVisibility,

        epochDifferenceMs:
          pair.epochDifferenceMs,
      });
    }

    return samples.sort(
      (a, b) => a.epoch - b.epoch,
    );
  }

  /* =====================================================
    BUILD CONTIGUOUS VISIBILITY WINDOWS
  ===================================================== */

  function buildVisibilityWindows(
    availableSamples: JointVisibilitySample[],
    range: {
      startEpoch: number;
      stopEpoch: number;
    },
    sampleIntervalMs: number,
  ): JointVisibilityWindow[] {
    const windows: JointVisibilityWindow[] = [];

    let currentGroup: JointVisibilitySample[] = [];

    function finishWindow() {
      if (currentGroup.length === 0) return;

      const best = currentGroup.reduce(
        (currentBest, sample) =>
          sample.jointClearanceDeg >
          currentBest.jointClearanceDeg
            ? sample
            : currentBest,
      );

      const firstEpoch = currentGroup[0].epoch;

      const endEpoch =
        currentGroup[currentGroup.length - 1].epoch +
        sampleIntervalMs;

      const boundedEndEpoch = Math.min(
        endEpoch,
        range.stopEpoch,
      );

      windows.push({
        startTimeIso: toIsoTime(firstEpoch),
        endTimeIso: toIsoTime(boundedEndEpoch),

        startTimeUtc: toUtcClock(firstEpoch),
        endTimeUtc: toUtcClock(boundedEndEpoch),

        durationMinutes: Math.round(
          (boundedEndEpoch - firstEpoch) / 60_000,
        ),

        sampleCount: currentGroup.length,

        bestTimeIso: best.timeIso,
        bestTimeUtc: best.timeUtc,

        bestSunClearanceDeg:
          best.sunUpperLimbClearanceDeg,

        bestEarthClearanceDeg:
          best.earthUpperLimbClearanceDeg,

        bestJointClearanceDeg:
          best.jointClearanceDeg,

        bestSunUpperLimbClearanceDeg:
          best.sunUpperLimbClearanceDeg,

        bestEarthUpperLimbClearanceDeg:
          best.earthUpperLimbClearanceDeg,

        bestSunLowerLimbClearanceDeg:
          best.sunLowerLimbClearanceDeg,

        bestEarthLowerLimbClearanceDeg:
          best.earthLowerLimbClearanceDeg,

        fullDiskJointClearanceDeg:
          best.fullDiskJointClearanceDeg,
      });

      currentGroup = [];
    }

    for (const sample of availableSamples) {
      const previous =
        currentGroup[currentGroup.length - 1];

      if (
        previous &&
        sample.epoch - previous.epoch >
          sampleIntervalMs * 1.5
      ) {
        finishWindow();
      }

      currentGroup.push(sample);
    }

    finishWindow();

    return windows;
  }

  /* =====================================================
    DAILY JOINT VISIBILITY ANALYSIS

    IMPORTANT TYPE FIX:
    This function only needs startEpoch, stopEpoch,
    and date. It does NOT need startTime or stopTime.
  ===================================================== */

  function calculateJointVisibility(
    sunObservations: HorizonsObservation[],
    earthObservations: HorizonsObservation[],
    directions: readonly HorizonDirection[],
    dayRange: {
      startEpoch: number;
      stopEpoch: number;
      date: string;
    },
  ) {
    const samples = buildJointSamples(
      sunObservations,
      earthObservations,
      directions,
      dayRange,
    );

    const candidateSamples = samples.filter(
      (sample) =>
        sample.sunUpperLimbClearanceDeg > 0 &&
        sample.earthUpperLimbClearanceDeg > 0,
    );

    const fullDiskCandidateSamples =
      samples.filter(
        (sample) =>
          sample.sunLowerLimbClearanceDeg > 0 &&
          sample.earthLowerLimbClearanceDeg > 0,
      );

    const partialDiskCandidateSamples =
      candidateSamples.filter(
        (sample) =>
          sample.sunLowerLimbClearanceDeg <= 0 ||
          sample.earthLowerLimbClearanceDeg <= 0,
      );

    const candidateWindows =
      buildVisibilityWindows(
        candidateSamples,
        dayRange,
        DAY_SAMPLE_INTERVAL_MS,
      );

    const verifiedWindows =
      TERRAIN_HORIZON_COVERAGE_VERIFIED
        ? candidateWindows
        : [];

    const bestCandidate =
      candidateWindows.length > 0
        ? candidateWindows.reduce(
            (best, window) =>
              window.bestJointClearanceDeg >
              best.bestJointClearanceDeg
                ? window
                : best,
          )
        : null;

    const recommendation =
      verifiedWindows.length > 0
        ? verifiedWindows.reduce(
            (best, window) =>
              window.bestJointClearanceDeg >
              best.bestJointClearanceDeg
                ? window
                : best,
          )
        : null;

    const closestApproach =
      samples.length > 0
        ? samples.reduce((best, sample) =>
            sample.jointClearanceDeg >
            best.jointClearanceDeg
              ? sample
              : best,
          )
        : null;

    let status:
      | "verified_joint_visibility_found"
      | "provisional_joint_visibility_found"
      | "no_joint_visibility_found"
      | "no_matching_observations";

    if (verifiedWindows.length > 0) {
      status = "verified_joint_visibility_found";
    } else if (candidateWindows.length > 0) {
      status = "provisional_joint_visibility_found";
    } else if (samples.length > 0) {
      status = "no_joint_visibility_found";
    } else {
      status = "no_matching_observations";
    }

    const averageEpochDifferenceMs =
      samples.length > 0
        ? samples.reduce(
            (total, sample) =>
              total + sample.epochDifferenceMs,
            0,
          ) / samples.length
        : null;

    return {
      date: dayRange.date,
      timeScale: "UTC",

      samplingIntervalMinutes: 1,

      status,

      criterion:
        "A provisional joint candidate requires the upper limb of both apparent disks to be above the interpolated sampled Product 78 terrain horizon at the same matched observation epoch.",

      sampleCount: samples.length,
      matchedObservationCount: samples.length,

      sunObservationCount: sunObservations.length,
      earthObservationCount: earthObservations.length,

      epochMatchToleranceMs:
        EPOCH_MATCH_TOLERANCE_MS,

      averageEpochDifferenceMs,

      candidateSampleCount:
        candidateSamples.length,

      availableSampleCount:
        candidateSamples.length,

      partialDiskCandidateSampleCount:
        partialDiskCandidateSamples.length,

      fullDiskCandidateSampleCount:
        fullDiskCandidateSamples.length,

      candidateWindowCount:
        candidateWindows.length,

      verifiedWindowCount:
        verifiedWindows.length,

      windowCount:
        verifiedWindows.length,

      windows: verifiedWindows,

      candidateRecommendation: bestCandidate
        ? {
            timeIso: bestCandidate.bestTimeIso,
            timeUtc: bestCandidate.bestTimeUtc,

            sunClearanceDeg:
              bestCandidate.bestSunClearanceDeg,

            earthClearanceDeg:
              bestCandidate.bestEarthClearanceDeg,

            jointClearanceDeg:
              bestCandidate.bestJointClearanceDeg,
          }
        : null,

      recommendation: recommendation
        ? {
            timeIso: recommendation.bestTimeIso,
            timeUtc: recommendation.bestTimeUtc,

            sunClearanceDeg:
              recommendation.bestSunClearanceDeg,

            earthClearanceDeg:
              recommendation.bestEarthClearanceDeg,

            jointClearanceDeg:
              recommendation.bestJointClearanceDeg,
          }
        : null,

      candidateWindows,
      verifiedWindows,

      closestApproach: closestApproach
        ? {
            timeIso: closestApproach.timeIso,
            timeUtc: closestApproach.timeUtc,

            sunClearanceDeg:
              closestApproach.sunUpperLimbClearanceDeg,

            earthClearanceDeg:
              closestApproach.earthUpperLimbClearanceDeg,

            jointClearanceDeg:
              closestApproach.jointClearanceDeg,

            fullDiskJointClearanceDeg:
              closestApproach.fullDiskJointClearanceDeg,
          }
        : null,

      terrainConfidence: {
        level: TERRAIN_HORIZON_COVERAGE_VERIFIED
          ? "verified"
          : "incomplete",

        terrainCoverageComplete:
          TERRAIN_HORIZON_COVERAGE_VERIFIED,

        interpretation:
          "The available Product 78 terrain does not establish a complete horizon around the observer. Positive clearances are provisional candidates only.",

        limitation:
          "Terrain outside the available raster may obstruct either target. Positive clearance does not establish verified visibility, solar power generation, communications performance, or mission suitability.",
      },

      boundaryResolution:
        "Window boundaries are estimated from one-minute samples.",

      terrainCoverageComplete:
        TERRAIN_HORIZON_COVERAGE_VERIFIED,
    };
  }

  /* =====================================================
    AUTOMATIC VISIBILITY CYCLE
  ===================================================== */

  function mergeEpochRanges(
    ranges: Array<{
      startEpoch: number;
      stopEpoch: number;
    }>,
  ): Array<{
    startEpoch: number;
    stopEpoch: number;
  }> {
    if (ranges.length === 0) return [];

    const sorted = [...ranges].sort(
      (a, b) => a.startEpoch - b.startEpoch,
    );

    const merged: Array<{
      startEpoch: number;
      stopEpoch: number;
    }> = [];

    for (const range of sorted) {
      const previous = merged[merged.length - 1];

      if (
        previous &&
        range.startEpoch <= previous.stopEpoch
      ) {
        previous.stopEpoch = Math.max(
          previous.stopEpoch,
          range.stopEpoch,
        );
      } else {
        merged.push({ ...range });
      }
    }

    return merged;
  }

  function uniqueObservations(
    observations: HorizonsObservation[],
  ): HorizonsObservation[] {
    const byEpoch = new Map<
      number,
      HorizonsObservation
    >();

    for (const observation of observations) {
      const epoch = horizonsTimeToEpoch(
        observation.time,
      );

      if (Number.isFinite(epoch)) {
        byEpoch.set(epoch, observation);
      }
    }

    return [...byEpoch.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, observation]) => observation);
  }

  async function calculateAutomaticVisibilityCycle(
    observer: GeographicCoordinate,
    altitudeKm: number,
    directions: readonly HorizonDirection[],
    startEpoch: number,
    durationHours: number,
  ) {
    const searchStartEpoch =
      startEpoch -
      CYCLE_PRE_START_HOURS * 60 * 60 * 1000;

    const searchStopEpoch =
      startEpoch +
      durationHours * 60 * 60 * 1000;

    const searchStartTime =
      formatHorizonsEpoch(searchStartEpoch);

    const searchStopTime =
      formatHorizonsEpoch(searchStopEpoch);

    const searchRange = {
      startEpoch: searchStartEpoch,
      stopEpoch: searchStopEpoch,
    };

    const totalSearchHours =
      (searchStopEpoch - searchStartEpoch) /
      3_600_000;

    console.info(
      "[Visibility Cycle] Starting automatic joint analysis.",
      {
        enteredStartTime: toIsoTime(startEpoch),
        searchStartTime,
        searchStopTime,
        durationHours,
        totalSearchHours,
      },
    );

    /* -----------------------------------------------
      STAGE 1 — 10-MINUTE SCREENING
    ------------------------------------------------ */

    const coarseSunObservations =
      await requestHorizonsTarget(
        "10",
        observer,
        altitudeKm,
        searchStartTime,
        searchStopTime,
        `${CYCLE_COARSE_INTERVAL_MINUTES}m`,
        120_000,
      );

    const coarseEarthObservations =
      await requestHorizonsTarget(
        "399",
        observer,
        altitudeKm,
        searchStartTime,
        searchStopTime,
        `${CYCLE_COARSE_INTERVAL_MINUTES}m`,
        120_000,
      );

    const coarsePairs =
      buildMatchedObservationPairs(
        coarseSunObservations,
        coarseEarthObservations,
        searchRange,
      );

    const coarseSamples: JointVisibilitySample[] = [];

    for (const pair of coarsePairs) {
      const sunVisibility =
        assessTargetVisibility(
          pair.sun.observation,
          directions,
        );

      const earthVisibility =
        assessTargetVisibility(
          pair.earth.observation,
          directions,
        );

      const sunUpper =
        sunVisibility.upperLimbClearanceDeg;

      const earthUpper =
        earthVisibility.upperLimbClearanceDeg;

      const sunLower =
        sunVisibility.lowerLimbClearanceDeg;

      const earthLower =
        earthVisibility.lowerLimbClearanceDeg;

      if (
        sunUpper === null ||
        earthUpper === null ||
        sunLower === null ||
        earthLower === null
      ) {
        continue;
      }

      coarseSamples.push({
        epoch: pair.epoch,
        timeIso: toIsoTime(pair.epoch),
        timeUtc: toUtcClock(pair.epoch),

        sunUpperLimbClearanceDeg: sunUpper,
        earthUpperLimbClearanceDeg: earthUpper,

        sunLowerLimbClearanceDeg: sunLower,
        earthLowerLimbClearanceDeg: earthLower,

        jointClearanceDeg: Math.min(
          sunUpper,
          earthUpper,
        ),

        fullDiskJointClearanceDeg: Math.min(
          sunLower,
          earthLower,
        ),

        sunSampledDiskVisibility:
          sunVisibility.sampledDiskVisibility,

        earthSampledDiskVisibility:
          earthVisibility.sampledDiskVisibility,

        epochDifferenceMs:
          pair.epochDifferenceMs,
      });
    }

    const coarseCandidates = coarseSamples.filter(
      (sample) =>
        sample.sunUpperLimbClearanceDeg > 0 &&
        sample.earthUpperLimbClearanceDeg > 0,
    );

    const refinementRanges = mergeEpochRanges(
      coarseCandidates.map((sample) => ({
        startEpoch: Math.max(
          searchStartEpoch,
          sample.epoch - CYCLE_REFINEMENT_PADDING_MS,
        ),

        stopEpoch: Math.min(
          searchStopEpoch,
          sample.epoch + CYCLE_REFINEMENT_PADDING_MS,
        ),
      })),
    );

    /* -----------------------------------------------
      STAGE 2 — ONE-MINUTE REFINEMENT
    ------------------------------------------------ */

    const refinedSunObservations: HorizonsObservation[] = [];
    const refinedEarthObservations: HorizonsObservation[] = [];

    for (const range of refinementRanges) {
      const refinementStart =
        formatHorizonsEpoch(range.startEpoch);

      const refinementStop =
        formatHorizonsEpoch(range.stopEpoch);

      const sunObservations =
        await requestHorizonsTarget(
          "10",
          observer,
          altitudeKm,
          refinementStart,
          refinementStop,
          `${CYCLE_REFINEMENT_INTERVAL_MINUTES}m`,
          120_000,
        );

      const earthObservations =
        await requestHorizonsTarget(
          "399",
          observer,
          altitudeKm,
          refinementStart,
          refinementStop,
          `${CYCLE_REFINEMENT_INTERVAL_MINUTES}m`,
          120_000,
        );

      refinedSunObservations.push(
        ...sunObservations,
      );

      refinedEarthObservations.push(
        ...earthObservations,
      );
    }

    const uniqueSun =
      uniqueObservations(refinedSunObservations);

    const uniqueEarth =
      uniqueObservations(refinedEarthObservations);

    /*
    * The object passed here intentionally contains only
    * the three properties required by calculateJointVisibility.
    *
    * This is the corrected call that removes the TypeScript
    * EpochRange requirement for startTime and stopTime.
    */
    const refinedAvailability =
      calculateJointVisibility(
        uniqueSun,
        uniqueEarth,
        directions,
        {
          startEpoch: searchStartEpoch,
          stopEpoch: searchStopEpoch,
          date: new Date(startEpoch)
            .toISOString()
            .slice(0, 10),
        },
      );

    const selectedWindow =
      refinedAvailability.candidateWindows.length > 0
        ? refinedAvailability.candidateWindows.reduce(
            (best, current) =>
              current.bestJointClearanceDeg >
              best.bestJointClearanceDeg
                ? current
                : best,
          )
        : null;

    const selectedTime = selectedWindow
      ? {
          timeIso: selectedWindow.bestTimeIso,
          timeUtc: selectedWindow.bestTimeUtc,

          startTimeIso:
            selectedWindow.startTimeIso,

          endTimeIso:
            selectedWindow.endTimeIso,

          startTimeUtc:
            selectedWindow.startTimeUtc,

          endTimeUtc:
            selectedWindow.endTimeUtc,

          durationMinutes:
            selectedWindow.durationMinutes,

          sunClearanceDeg:
            selectedWindow.bestSunUpperLimbClearanceDeg,

          earthClearanceDeg:
            selectedWindow.bestEarthUpperLimbClearanceDeg,

          jointClearanceDeg:
            selectedWindow.bestJointClearanceDeg,

          fullDiskJointClearanceDeg:
            selectedWindow.fullDiskJointClearanceDeg,

          confidence: "provisional" as const,
        }
      : null;

    const automaticSelection = {
      enabled: true,

      selected: selectedTime !== null,

      status: selectedTime
        ? "provisional_candidate_selected"
        : "no_simultaneous_candidate_found",

      selectedTime,

      reason: selectedTime
        ? "Automatically selected the refined window with the greatest simultaneous Sun-and-Earth upper-limb clearance."
        : "No sampled time showed both the Sun and Earth clearing the sampled Product 78 terrain horizon simultaneously.",

      selectionCriterion:
        "Maximize the minimum of the Sun and Earth upper-limb clearances at matched UTC observation epochs.",

      verified: false,

      confidence: "provisional",

      terrainCoverageComplete: false,
    };

    const analysis = {
      enteredStartTime: toIsoTime(startEpoch),

      searchStart: toIsoTime(searchStartEpoch),
      searchStop: toIsoTime(searchStopEpoch),

      emissionDurationHours: durationHours,

      preStartSearchHours:
        CYCLE_PRE_START_HOURS,

      totalSearchHours,

      timeScale: "UTC",

      coarseSamplingIntervalMinutes:
        CYCLE_COARSE_INTERVAL_MINUTES,

      refinementSamplingIntervalMinutes:
        CYCLE_REFINEMENT_INTERVAL_MINUTES,

      coarseSunObservationCount:
        coarseSunObservations.length,

      coarseEarthObservationCount:
        coarseEarthObservations.length,

      coarseMatchedSampleCount:
        coarseSamples.length,

      coarseCandidateSampleCount:
        coarseCandidates.length,

      refinementRangeCount:
        refinementRanges.length,

      refinedSunObservationCount:
        uniqueSun.length,

      refinedEarthObservationCount:
        uniqueEarth.length,

      refinedMatchedSampleCount:
        refinedAvailability.sampleCount,

      candidateWindowCount:
        refinedAvailability.candidateWindowCount,

      verifiedWindowCount: 0,

      status: selectedTime
        ? "provisional_joint_visibility_found"
        : "no_joint_visibility_candidate_found",

      automaticSelection: true,

      selectionMethod:
        "Screen at 10-minute intervals, refine candidate periods at one-minute intervals, and select the refined window with the greatest simultaneous upper-limb clearance.",

      screeningLimitation:
        "A brief candidate that occurs entirely between two 10-minute screening samples may be missed.",

      terrainLimitation:
        "Positive refined candidates remain provisional because the available Product 78 terrain does not establish a complete horizon.",
    };

    return {
      analysis,

      automaticSelection,

      availability: {
        ...refinedAvailability,

        status: selectedTime
          ? "provisional_joint_visibility_found"
          : refinedAvailability.status,

        searchStart: toIsoTime(searchStartEpoch),
        searchStop: toIsoTime(searchStopEpoch),

        emissionDurationHours: durationHours,

        automaticSelection,

        candidateRecommendation: selectedTime
          ? {
              timeIso: selectedTime.timeIso,
              timeUtc: selectedTime.timeUtc,

              startTimeIso:
                selectedTime.startTimeIso,

              endTimeIso:
                selectedTime.endTimeIso,

              durationMinutes:
                selectedTime.durationMinutes,

              sunClearanceDeg:
                selectedTime.sunClearanceDeg,

              earthClearanceDeg:
                selectedTime.earthClearanceDeg,

              jointClearanceDeg:
                selectedTime.jointClearanceDeg,

              fullDiskJointClearanceDeg:
                selectedTime.fullDiskJointClearanceDeg,

              confidence: "provisional",
            }
          : null,

        recommendation: null,

        selectedCandidate: selectedWindow,

        verifiedWindows: [],
        windows: [],

        verifiedWindowCount: 0,

        terrainCoverageComplete: false,

        automaticSelectionExplanation:
          "The API selects the strongest simultaneous Sun-and-Earth candidate automatically. No manual target selection is required.",
      },
    };
  }

  /* =====================================================
    SINGLE-EPOCH OBSERVATION MATCHING
  ===================================================== */

  function getObservationAtEpoch(
    observations: HorizonsObservation[],
    requestedEpoch: number,
    targetName: string,
  ): TimedObservation {
    const records = getTimedObservations(
      observations,
    );

    const match = getNearestTimedObservation(
      records,
      requestedEpoch,
    );

    if (!match) {
      throw new Error(
        `JPL Horizons did not return a ${targetName} observation within ${EPOCH_MATCH_TOLERANCE_MS} ms of the requested UTC epoch.`,
      );
    }

    return match;
  }

  /* =====================================================
    SINGLE-EPOCH JOINT VISIBILITY
  ===================================================== */

  function calculateSingleEpochJointVisibility(
    sunObservation: HorizonsObservation,
    earthObservation: HorizonsObservation,
    sunVisibility: TerrainVisibility,
    earthVisibility: TerrainVisibility,
    epochDifferenceMs: number,
    requestedEpoch: number,
  ) {
    const sunUpper =
      sunVisibility.upperLimbClearanceDeg;

    const earthUpper =
      earthVisibility.upperLimbClearanceDeg;

    const sunLower =
      sunVisibility.lowerLimbClearanceDeg;

    const earthLower =
      earthVisibility.lowerLimbClearanceDeg;

    const canEvaluate =
      sunUpper !== null &&
      earthUpper !== null &&
      sunLower !== null &&
      earthLower !== null;

    const bothHaveVisiblePortion =
      canEvaluate &&
      sunUpper > 0 &&
      earthUpper > 0;

    const bothHaveFullDiskAboveSampledHorizon =
      canEvaluate &&
      sunLower > 0 &&
      earthLower > 0;

    const partialDiskAtLeastOneTarget =
      bothHaveVisiblePortion &&
      (
        sunLower <= 0 ||
        earthLower <= 0
      );

    let status:
      | "provisional_both_targets_above_sampled_horizon"
      | "not_both_targets_above_sampled_horizon"
      | "terrain_horizon_unavailable";

    if (!canEvaluate) {
      status = "terrain_horizon_unavailable";
    } else if (bothHaveVisiblePortion) {
      status =
        "provisional_both_targets_above_sampled_horizon";
    } else {
      status =
        "not_both_targets_above_sampled_horizon";
    }

    return {
      status,

      timeIso: toIsoTime(requestedEpoch),
      timeUtc: toUtcClock(requestedEpoch),
      timeScale: "UTC",

      hasJointVisibilityCandidate:
        Boolean(bothHaveVisiblePortion),

      bothHaveVisiblePortion:
        Boolean(bothHaveVisiblePortion),

      bothHaveFullDiskAboveSampledHorizon:
        Boolean(bothHaveFullDiskAboveSampledHorizon),

      partialDiskAtLeastOneTarget:
        Boolean(partialDiskAtLeastOneTarget),

      sunUpperLimbClearanceDeg: sunUpper,
      earthUpperLimbClearanceDeg: earthUpper,

      sunLowerLimbClearanceDeg: sunLower,
      earthLowerLimbClearanceDeg: earthLower,

      jointUpperLimbClearanceDeg:
        canEvaluate
          ? Math.min(sunUpper, earthUpper)
          : null,

      fullDiskJointClearanceDeg:
        canEvaluate
          ? Math.min(sunLower, earthLower)
          : null,

      epochDifferenceMs,

      epochMatchToleranceMs:
        EPOCH_MATCH_TOLERANCE_MS,

      terrainCoverageComplete: false,

      verified: false,

      interpretation:
        bothHaveVisiblePortion
          ? bothHaveFullDiskAboveSampledHorizon
            ? "Both complete apparent disks clear the sampled Product 78 terrain horizon. This remains provisional because the complete surrounding terrain is not available."
            : "Some portion of both apparent disks clears the sampled Product 78 terrain horizon. At least one target is only partially clear. This remains provisional because the complete surrounding terrain is not available."
          : canEvaluate
            ? "The sampled Product 78 horizon does not show both apparent disks clearing simultaneously at this instant."
            : "The sampled terrain horizon was unavailable for at least one target, so joint visibility cannot be evaluated.",
    };
  }

  /* =====================================================
    TERRAIN MODEL RESPONSE
  ===================================================== */

  function createTerrainModelResponse(
    terrain: LolaTerrainData,
    horizon: TerrainHorizonResult,
    siteId: Product78SiteId,
    siteName: string,
  ) {
    return {
      product: "NASA LOLA Product 78",

      siteId,
      siteName,

      resolutionMeters: terrain.resolutionMeters,

      referenceFrame:
        terrain.metadata.coordinateSystem.referenceFrame,

      ephemeris:
        terrain.metadata.coordinateSystem.ephemeris,

      sampleStepMeters: horizon.sampleStepMeters,
      maxDistanceMeters: horizon.maxDistanceMeters,

      calculatedDirections:
        horizon.calculatedDirections,

      totalSamplesChecked:
        horizon.totalSamplesChecked,

      product78SamplesChecked:
        horizon.product78SamplesChecked,

      rasterBoundaryLimitedDirections:
        horizon.rasterBoundaryLimitedDirections,

      product78NoDataTerminatedDirections:
        horizon.product78NoDataTerminatedDirections,

      searchLimitReachedDirections:
        horizon.searchLimitReachedDirections,

      completeHorizonVerified:
        TERRAIN_HORIZON_COVERAGE_VERIFIED,

      coverageStatus: "incomplete",

      coverageExplanation:
        "The terrain horizon is limited by incomplete Product 78 raster coverage. Visibility results are provisional.",
    };
  }

  /* =====================================================
    ERROR HANDLING
  ===================================================== */

  function getErrorMessage(
    error: unknown,
  ): string {
    return error instanceof Error
      ? error.message
      : "Unknown selected-location calculation error.";
  }

  /* =====================================================
    API ROUTE
  ===================================================== */

  export async function GET(
    request: NextRequest,
  ) {
    try {
      const params =
        request.nextUrl.searchParams;

      const mode =
        params.get("mode") ?? "observation";

      if (
        mode !== "observation" &&
        mode !== "joint-visibility-day" &&
        mode !== "visibility-cycle"
      ) {
        throw new Error(
          `Unsupported analysis mode "${mode}". Use "observation", "joint-visibility-day", or "visibility-cycle".`,
        );
      }

      /* -----------------------------------------------
        Resolve selected landing site
      ------------------------------------------------ */

      const { id: siteId, site } =
        getSelectedSite(
          params.get("siteId"),
        );

      const mission =
        mode === "observation" ||
        mode === "visibility-cycle"
          ? getDateAndTimeFromParams(params)
          : null;

      const dayRange =
        mode === "joint-visibility-day"
          ? getUtcDayRange(
              params.get("date") ??
              params.get("startDate"),
            )
          : null;

      const emissionDurationHours =
        mode === "visibility-cycle"
          ? parseEmissionDurationHours(params)
          : null;

      /* -----------------------------------------------
        Resolve selected observer coordinate
      ------------------------------------------------ */

      const requestedLatitude =
        parseFiniteParameter(
          params.get("lat"),
          "Latitude",
        );

      const requestedLongitude =
        parseFiniteParameter(
          params.get("lon"),
          "Longitude",
        );

      if (
        requestedLatitude === null ||
        requestedLongitude === null
      ) {
        throw new Error(
          "No local landing position selected. Select a position on the Product 78 terrain map before requesting visibility analysis. Both latitude and longitude are required.",
        );
      }

      const latitudeDeg = requestedLatitude;

      const longitudeEastDeg =
        normalizeLongitudeEast(
          requestedLongitude,
        );

      if (
        latitudeDeg < -90 ||
        latitudeDeg > 0
      ) {
        throw new Error(
          "The selected lunar position must use a valid southern latitude.",
        );
      }

      const observer: GeographicCoordinate = {
        latitudeDeg,
        longitudeEastDeg,
      };

      const suppliedPixelColumn =
        parseOptionalPixel(
          params.get("pixelColumn"),
          "pixelColumn",
        );

      const suppliedPixelRow =
        parseOptionalPixel(
          params.get("pixelRow"),
          "pixelRow",
        );

      if (
        (suppliedPixelColumn === null) !==
        (suppliedPixelRow === null)
      ) {
        throw new Error(
          "Both pixelColumn and pixelRow must be supplied together.",
        );
      }

      /* -----------------------------------------------
        Load actual Product 78 terrain
      ------------------------------------------------ */

      const terrain =
        await loadTerrainForSite(siteId);

      const observerSample =
        sampleLolaHeightAtLocation(
          terrain,
          observer,
        );

      if (
        suppliedPixelColumn !== null &&
        suppliedPixelRow !== null
      ) {
        const pixelDifference = Math.hypot(
          suppliedPixelColumn -
            observerSample.pixel.column,
          suppliedPixelRow -
            observerSample.pixel.row,
        );

        if (pixelDifference > 1.5) {
          throw new Error(
            "The supplied raster pixel does not match the selected geographic coordinate for this site.",
          );
        }
      }

      /* -----------------------------------------------
        Calculate terrain horizon for this observer
      ------------------------------------------------ */

      const terrainHorizon =
        await getTerrainHorizon(
          siteId,
          terrain,
          observer,
        );

      const sortedHorizonDirections = [
        ...terrainHorizon.directions,
      ].sort(
        (a, b) => a.azimuthDeg - b.azimuthDeg,
      );

      const altitudeKm =
        observerSample.elevationMeters / 1000;

      const observerResponse = {
        latitudeDeg: observer.latitudeDeg,
        longitudeEastDeg: observer.longitudeEastDeg,

        altitudeKm,
        elevationMeters:
          observerSample.elevationMeters,

        pixel: observerSample.pixel,
        nearestPixel: observerSample.nearestPixel,
      };

      const terrainModel =
        createTerrainModelResponse(
          terrain,
          terrainHorizon,
          siteId,
          site.displayName,
        );

      /* =================================================
        MODE 1 — FULL UTC DAY JOINT VISIBILITY
      ================================================= */

      if (
        mode === "joint-visibility-day" &&
        dayRange
      ) {
        const sunObservations =
          await requestHorizonsTarget(
            "10",
            observer,
            altitudeKm,
            dayRange.startTime,
            dayRange.stopTime,
            "1m",
            120_000,
          );

        const earthObservations =
          await requestHorizonsTarget(
            "399",
            observer,
            altitudeKm,
            dayRange.startTime,
            dayRange.stopTime,
            "1m",
            120_000,
          );

        const availability =
          calculateJointVisibility(
            sunObservations,
            earthObservations,
            sortedHorizonDirections,
            dayRange,
          );

        return NextResponse.json(
          {
            success: true,

            mode: "joint-visibility-day",

            timeScale: "UTC",

            site: {
              id: siteId,
              archiveSite: site.archiveSite,
              displayName: site.displayName,
              dataDirectory: site.dataDirectory,
            },

            observer: observerResponse,

            terrainModel,

            availability,

            sources: {
              ephemeris: "NASA/JPL Horizons",
              localTerrain: "NASA LOLA Product 78",
            },
          },
          {
            headers: {
              "Cache-Control": "no-store, max-age=0",
            },
          },
        );
      }

      /* =================================================
        MODE 2 — AUTOMATIC VISIBILITY CYCLE
      ================================================= */

      if (
        mode === "visibility-cycle" &&
        mission &&
        emissionDurationHours !== null
      ) {
        const cycle =
          await calculateAutomaticVisibilityCycle(
            observer,
            altitudeKm,
            sortedHorizonDirections,
            mission.epoch,
            emissionDurationHours,
          );

        return NextResponse.json(
          {
            success: true,

            mode: "visibility-cycle",

            site: {
              id: siteId,
              archiveSite: site.archiveSite,
              displayName: site.displayName,
              dataDirectory: site.dataDirectory,
            },

            mission: {
              ...mission,
              requestedTimeIso:
                toIsoTime(mission.epoch),
              emissionDurationHours,
            },

            observer: observerResponse,

            terrainModel,

            analysis: cycle.analysis,

            availability: cycle.availability,

            automaticSelection:
              cycle.automaticSelection,

            sources: {
              ephemeris: "NASA/JPL Horizons",
              localTerrain: "NASA LOLA Product 78",
            },
          },
          {
            headers: {
              "Cache-Control": "no-store, max-age=0",
            },
          },
        );
      }

      /* =================================================
        MODE 3 — SINGLE UTC OBSERVATION
      ================================================= */

      if (!mission) {
        throw new Error(
          "A mission UTC date and time are required.",
        );
      }

      const sunObservations =
        await requestHorizonsTarget(
          "10",
          observer,
          altitudeKm,
          mission.startTime,
          mission.stopTime,
          "1m",
        );

      const earthObservations =
        await requestHorizonsTarget(
          "399",
          observer,
          altitudeKm,
          mission.startTime,
          mission.stopTime,
          "1m",
        );

      const sunTimed =
        getObservationAtEpoch(
          sunObservations,
          mission.epoch,
          "Sun",
        );

      const earthTimed =
        getObservationAtEpoch(
          earthObservations,
          mission.epoch,
          "Earth",
        );

      const epochDifferenceMs = Math.abs(
        sunTimed.epoch - earthTimed.epoch,
      );

      if (
        epochDifferenceMs >
        EPOCH_MATCH_TOLERANCE_MS
      ) {
        throw new Error(
          `Sun and Earth observations do not represent the same UTC instant. Their timestamps differ by ${epochDifferenceMs} ms.`,
        );
      }

      const sunObservation =
        sunTimed.observation;

      const earthObservation =
        earthTimed.observation;

      const sunVisibility =
        assessTargetVisibility(
          sunObservation,
          sortedHorizonDirections,
        );

      const earthVisibility =
        assessTargetVisibility(
          earthObservation,
          sortedHorizonDirections,
        );

      const jointVisibility =
        calculateSingleEpochJointVisibility(
          sunObservation,
          earthObservation,
          sunVisibility,
          earthVisibility,
          epochDifferenceMs,
          mission.epoch,
        );

      return NextResponse.json(
        {
          success: true,

          mode: "observation",

          site: {
            id: siteId,
            archiveSite: site.archiveSite,
            displayName: site.displayName,
            dataDirectory: site.dataDirectory,
          },

          mission: {
            ...mission,
            requestedTimeIso:
              toIsoTime(mission.epoch),
          },

          observer: observerResponse,

          targets: {
            sun: {
              ...sunObservation,
              terrainVisibility: sunVisibility,
            },

            earth: {
              ...earthObservation,
              terrainVisibility: earthVisibility,
            },
          },

          jointVisibility,

          terrainModel,

          sources: {
            ephemeris: "NASA/JPL Horizons",
            localTerrain: "NASA LOLA Product 78",
          },
        },
        {
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        },
      );
    } catch (error) {
      const message = getErrorMessage(error);

      console.error(
        "[Selected Location API]",
        message,
      );

      return NextResponse.json(
        {
          success: false,
          error: message,
        },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        },
      );
    }
  }
