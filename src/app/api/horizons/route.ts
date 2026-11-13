
import { connection, NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  type LolaTerrainData,
  sampleLolaHeightAtLocation,
} from "@/components/lib/lunar/terrainData";

import {
  calculateMultiResolutionTerrainHorizon,
} from "@/components/lib/lunar/multiResolutionTerrain.server";

type TerrainHorizonResult =
  Awaited<ReturnType<typeof calculateMultiResolutionTerrainHorizon>>;

type TerrainHorizonDirections = TerrainHorizonResult["directions"];

const HORIZONS_URL =
  "https://ssd.jpl.nasa.gov/api/horizons.api";

const BASE_OBSERVER = {
  name: "Site04 — Shackleton Rim",
  longitudeEast: 188.13,
  latitude: -89.7668,
};

const STEP_SIZE = "10m";
const OBSERVATION_INTERVAL_MS = 10 * 60 * 1000;
const EXPECTED_OBSERVATIONS_PER_DAY = 145;

const TERRAIN_OPTIONS = {
  directionCount: 1440,

  // Product 78: local high-resolution terrain.
  sampleStepMeters: 5,

  // Product 90: regional terrain.
  regionalSampleStepMeters: 20,

  maxDistanceMeters: 15000,

  // Bound concurrent directional calculations.
  directionConcurrency: 8,
};

const HORIZONS_MAX_ATTEMPTS = 3;

type HorizonsPayload = {
  result?: string;
  error?: string;
  signature?: {
    source?: string;
    version?: string;
  };
};

type Observation = {
  time: string;
  timeUtc: string;
  azimuthDeg: number;
  elevationDeg: number;

  // JPL Horizons quantity 13.
  // Returned in arcseconds.
  angularDiameterArcsec: number | null;

  // Preserves JPL's presence/event marker text.
  horizonsMarker: string | null;
};

type ParsedObservations = {
  observations: Observation[];
  totalParsed: number;
  totalUnparsed: number;
  unparsedLines: string[];
};

type Observer = typeof BASE_OBSERVER & {
  altitudeKm: number;
};

type VisibilityState =
  | "blocked_by_sampled_terrain"
  | "above_sampled_terrain_unconfirmed";

type LimbVisibilityState =
  | "target_disk_below_sampled_terrain"
  | "target_disk_intersects_sampled_terrain"
  | "target_disk_above_sampled_terrain_unconfirmed"
  | "target_disk_size_unavailable";

type TerrainVisibility = {
  terrainHorizonElevationDeg: number;

  // Centre of the target disk relative to the terrain horizon.
  clearanceDeg: number;

  blockedBySampledTerrain: boolean;

  assessment: VisibilityState;

  angularDiameterArcsec: number | null;
  semiDiameterDeg: number | null;

  upperLimbClearanceDeg: number | null;
  lowerLimbClearanceDeg: number | null;

  limbAssessment: LimbVisibilityState;

  // Deliberately conservative: this is not a claim of complete
  // lunar horizon or full-disk visibility.
  terrainCoverageComplete: false;
};

type TerrainVisibilityObservation = Observation & {
  terrainVisibility: TerrainVisibility;
};

type VisibilityWindow<TState extends string = VisibilityState> = {
  state: TState;
  startTimeUtc: string;
  endTimeUtc: string;
  durationMinutes: number;
  observationCount: number;
  startClearanceDeg: number;
  endClearanceDeg: number;
};

let terrainPromise: Promise<LolaTerrainData> | null = null;

/**
 * The Site04 terrain horizon does not depend on the requested date.
 *
 * Cache the calculation for this server process so a request for
 * another date does not calculate the same 1,440 directions again.
 *
 * Restart the server after changing the observer, dataset selection,
 * terrain options, or source raster files.
 */
let terrainHorizonPromise: Promise<TerrainHorizonResult> | null = null;

/**
 * Converts a JPL Horizons timestamp into a Unix timestamp.
 *
 * Expected format:
 * 2026-Nov-09T00:00:00Z
 */
function parseHorizonsUtc(timeUtc: string): number {
  const match = timeUtc.match(
    /^(\d{4})-([A-Za-z]{3})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/
  );

  if (!match) {
    throw new Error(
      `Invalid Horizons UTC timestamp: ${timeUtc}`
    );
  }

  const months: Record<string, number> = {
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

  const [
    ,
    year,
    monthName,
    day,
    hour,
    minute,
    second,
    fraction = "",
  ] = match;

  const month = months[monthName];

  if (month === undefined) {
    throw new Error(
      `Invalid month in Horizons timestamp: ${timeUtc}`
    );
  }

  const milliseconds = Number(
    fraction.padEnd(3, "0").slice(0, 3) || "0"
  );

  return Date.UTC(
    Number(year),
    month,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    milliseconds
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown server error";
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Loads the NASA LOLA Site04 elevation raster.
 *
 * The original filesystem loader and in-memory cache are preserved.
 */
async function loadTerrainFromDisk(): Promise<LolaTerrainData> {
  if (terrainPromise) {
    return terrainPromise;
  }

  const pending: Promise<LolaTerrainData> = (async () => {
    const directory = path.join(
      process.cwd(),
      "public",
      "data",
      "site04_shackleton_rim"
    );

    const [metadataText, binary] = await Promise.all([
      readFile(path.join(directory, "metadata.json"), "utf8"),
      readFile(path.join(directory, "elevation.bin")),
    ]);

    const metadata = JSON.parse(
      metadataText
    ) as LolaTerrainData["metadata"];

    const expectedBytes =
      metadata.width *
      metadata.height *
      Float32Array.BYTES_PER_ELEMENT;

    if (binary.byteLength !== expectedBytes) {
      throw new Error(
        `LOLA raster size mismatch. Expected ${expectedBytes} bytes, received ${binary.byteLength}.`
      );
    }

    // Copy Buffer data into an independent, aligned ArrayBuffer.
    const copiedBytes = Uint8Array.from(binary);

    // NASA raster values are little-endian Float32 values.
    const elevations = new Float32Array(copiedBytes.buffer);

    return {
      width: metadata.width,
      height: metadata.height,
      minElevation: metadata.minElevation,
      maxElevation: metadata.maxElevation,
      resolutionMeters: metadata.resolutionMeters,
      metadata,
      elevations,
    };
  })();

  terrainPromise = pending;

  try {
    return await pending;
  } catch (error) {
    terrainPromise = null;
    throw error;
  }
}

/**
 * Calculates the fixed Site04 terrain horizon only once per process.
 *
 * If calculation fails, the rejected promise is cleared so a later
 * request can retry after the underlying data/network issue is fixed.
 */
async function getCachedTerrainHorizon(
  terrain: LolaTerrainData
): Promise<TerrainHorizonResult> {
  if (!terrainHorizonPromise) {
    const pending = calculateMultiResolutionTerrainHorizon(
      terrain,
      {
        latitudeDeg: BASE_OBSERVER.latitude,
        longitudeEastDeg: BASE_OBSERVER.longitudeEast,
      },
      TERRAIN_OPTIONS
    ).then((result) => {
      if (
        result.directions.length !==
        TERRAIN_OPTIONS.directionCount
      ) {
        throw new Error(
          `Terrain horizon profile is incomplete. Expected ${TERRAIN_OPTIONS.directionCount} directions, received ${result.directions.length}.`
        );
      }

      return result;
    });

    terrainHorizonPromise = pending;
  }

  const pending = terrainHorizonPromise;

  try {
    return await pending;
  } catch (error) {
    if (terrainHorizonPromise === pending) {
      terrainHorizonPromise = null;
    }

    throw error;
  }
}

/**
 * Parses the Horizons observer table.
 *
 * Instead of assuming the presence marker is always "*",
 * this parser reads the numeric columns independently.
 *
 * Requested quantities:
 *   4  = apparent azimuth and elevation
 *   13 = target angular diameter
 */
function parseHorizonsTable(table: string): ParsedObservations {
  const observations: Observation[] = [];
  const unparsedLines: string[] = [];

  const lines = table
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const numberPattern =
    "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][+-]?\\d+)?";

  const rowPrefixRegex =
    /^(\d{4}-[A-Za-z]{3}-\d{2})\s+(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(.*)$/;

  const numericRegex = new RegExp(numberPattern, "g");

  for (const line of lines) {
    if (!/^\d{4}-[A-Za-z]{3}-\d{2}\s+\d{2}:\d{2}/.test(line)) {
      continue;
    }

    const prefixMatch = line.match(rowPrefixRegex);

    if (!prefixMatch) {
      unparsedLines.push(line);
      continue;
    }

    const [, date, time, remainingColumns] = prefixMatch;

    const numericMatches = [
      ...remainingColumns.matchAll(numericRegex),
    ];

    if (numericMatches.length < 2) {
      unparsedLines.push(line);
      continue;
    }

    const azimuthDeg = Number(numericMatches[0][0]);
    const elevationDeg = Number(numericMatches[1][0]);

    const angularDiameterArcsec =
      numericMatches.length >= 3
        ? Number(numericMatches[2][0])
        : null;

    if (
      !Number.isFinite(azimuthDeg) ||
      !Number.isFinite(elevationDeg) ||
      azimuthDeg < 0 ||
      azimuthDeg > 360 ||
      elevationDeg < -90 ||
      elevationDeg > 90
    ) {
      unparsedLines.push(line);
      continue;
    }

    const normalizedTime =
      time.length === 5 ? `${time}:00` : time;

    // Keep all non-numeric marker text preceding the AZ column.
    const firstNumericIndex =
      numericMatches[0].index ?? 0;

    const horizonsMarker =
      remainingColumns
        .slice(0, firstNumericIndex)
        .trim() || null;

    observations.push({
      time: `${date} ${time}`,
      timeUtc: `${date}T${normalizedTime}Z`,
      azimuthDeg,
      elevationDeg,

      angularDiameterArcsec:
        angularDiameterArcsec !== null &&
        Number.isFinite(angularDiameterArcsec) &&
        angularDiameterArcsec > 0
          ? angularDiameterArcsec
          : null,

      horizonsMarker,
    });
  }

  if (observations.length === 0) {
    throw new Error(
      "Could not parse any Horizons observations. Check the raw Horizons table format."
    );
  }

  return {
    observations,
    totalParsed: observations.length,
    totalUnparsed: unparsedLines.length,
    unparsedLines,
  };
}

/**
 * Performs a JPL request with retries for temporary network/server
 * failures. Invalid query responses are not blindly retried.
 */
async function requestHorizonsPayload(
  targetId: "10" | "399",
  params: URLSearchParams
): Promise<HorizonsPayload> {
  const url = `${HORIZONS_URL}?${params.toString()}`;

  for (
    let attempt = 1;
    attempt <= HORIZONS_MAX_ATTEMPTS;
    attempt++
  ) {
    let response: Response;

    try {
      response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(60000),
      });
    } catch (error) {
      if (attempt === HORIZONS_MAX_ATTEMPTS) {
        throw new Error(
          `Horizons network request failed for target ${targetId} after ${attempt} attempts: ${getErrorMessage(error)}`
        );
      }

      await sleep(750 * attempt);
      continue;
    }

    if (!response.ok) {
      const retryable =
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500;

      if (
        retryable &&
        attempt < HORIZONS_MAX_ATTEMPTS
      ) {
        await sleep(750 * attempt);
        continue;
      }

      throw new Error(
        `Horizons HTTP error for target ${targetId}: ${response.status}`
      );
    }

    return (await response.json()) as HorizonsPayload;
  }

  throw new Error(
    `Horizons request exhausted retries for target ${targetId}.`
  );
}

/**
 * Requests one celestial target from JPL Horizons.
 */
async function getTargetEphemeris(
  targetId: "10" | "399",
  startTime: string,
  stopTime: string,
  observer: Observer
) {
  const params = new URLSearchParams({
    format: "json",
    COMMAND: `'${targetId}'`,
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    OBJ_DATA: "'NO'",
    CENTER: "'coord@301'",
    COORD_TYPE: "'GEODETIC'",
    SITE_COORD: `'${observer.longitudeEast},${observer.latitude},${observer.altitudeKm}'`,
    START_TIME: `'${startTime}'`,
    STOP_TIME: `'${stopTime}'`,
    STEP_SIZE: `'${STEP_SIZE}'`,
    QUANTITIES: "'4,13'",
    TIME_TYPE: "'UT'",
    TIME_DIGITS: "'MINUTES'",
    APPARENT: "'AIRLESS'",
  });

  const payload = await requestHorizonsPayload(
    targetId,
    params
  );

  if (payload.error) {
    throw new Error(
      `Horizons error for target ${targetId}: ${payload.error}`
    );
  }

  if (!payload.result) {
    throw new Error(
      `Horizons returned no result for target ${targetId}.`
    );
  }

  const tableMatch = payload.result.match(
    /\$\$SOE([\s\S]*?)\$\$EOE/
  );

  if (!tableMatch) {
    throw new Error(
      `Horizons observation table is missing for target ${targetId}.`
    );
  }

  const table = tableMatch[1].trim();
  const parsed = parseHorizonsTable(table);

  const isComplete =
    parsed.totalUnparsed === 0 &&
    parsed.totalParsed === EXPECTED_OBSERVATIONS_PER_DAY;

  return {
    targetId,
    observations: parsed.observations,

    parsing: {
      totalParsed: parsed.totalParsed,
      expectedObservations: EXPECTED_OBSERVATIONS_PER_DAY,

      totalUnparsed: parsed.totalUnparsed,

      missingObservations: Math.max(
        0,
        EXPECTED_OBSERVATIONS_PER_DAY - parsed.totalParsed
      ),

      unexpectedExtraObservations: Math.max(
        0,
        parsed.totalParsed - EXPECTED_OBSERVATIONS_PER_DAY
      ),

      isComplete,
      unparsedLines: parsed.unparsedLines,
    },

    raw: {
      table,
      result: payload.result,
      signature: payload.signature ?? null,
    },
  };
}

/**
 * Interpolates the terrain horizon at an arbitrary azimuth.
 *
 * Handles the wrap from the final direction back to 0 degrees.
 */
function getTerrainHorizonAtAzimuth(
  azimuthDeg: number,
  profile: TerrainHorizonDirections
) {
  if (profile.length < 2) {
    throw new Error(
      "Terrain horizon profile does not contain enough directions."
    );
  }

  const normalizedAzimuth =
    ((azimuthDeg % 360) + 360) % 360;

  const angularStep = 360 / profile.length;
  const position = normalizedAzimuth / angularStep;

  const lowerIndex =
    Math.floor(position) % profile.length;

  const upperIndex =
    (lowerIndex + 1) % profile.length;

  const fraction =
    position - Math.floor(position);

  const lower = profile[lowerIndex];
  const upper = profile[upperIndex];

  if (
    !Number.isFinite(lower.horizonElevationDeg) ||
    !Number.isFinite(upper.horizonElevationDeg)
  ) {
    throw new Error(
      `Invalid terrain horizon elevation near azimuth ${azimuthDeg}.`
    );
  }

  const horizonElevationDeg =
    lower.horizonElevationDeg +
    (upper.horizonElevationDeg -
      lower.horizonElevationDeg) *
      fraction;

  return {
    horizonElevationDeg,
    lowerAzimuthDeg: lower.azimuthDeg,
    upperAzimuthDeg: upper.azimuthDeg,
    lowerTerminationReason: lower.terminationReason,
    upperTerminationReason: upper.terminationReason,
  };
}

/**
 * Adds terrain obstruction and target-disk screening to observations.
 *
 * The centre assessment preserves the previous API meaning.
 *
 * The limb assessment is an additional first-order check using the
 * target's angular diameter. It does not perform full 2D disk-to-
 * terrain intersection across every point on the celestial disk.
 */
function addTerrainVisibility(
  target: Awaited<ReturnType<typeof getTargetEphemeris>>,
  profile: TerrainHorizonDirections
) {
  return {
    ...target,

    observations: target.observations.map((observation) => {
      const terrain = getTerrainHorizonAtAzimuth(
        observation.azimuthDeg,
        profile
      );

      const clearanceDeg =
        observation.elevationDeg -
        terrain.horizonElevationDeg;

      const blockedBySampledTerrain =
        clearanceDeg <= 0;

      const semiDiameterDeg =
        observation.angularDiameterArcsec !== null
          ? observation.angularDiameterArcsec / 7200
          : null;

      const upperLimbClearanceDeg =
        semiDiameterDeg !== null
          ? clearanceDeg + semiDiameterDeg
          : null;

      const lowerLimbClearanceDeg =
        semiDiameterDeg !== null
          ? clearanceDeg - semiDiameterDeg
          : null;

      let limbAssessment: LimbVisibilityState;

      if (
        upperLimbClearanceDeg === null ||
        lowerLimbClearanceDeg === null
      ) {
        limbAssessment = "target_disk_size_unavailable";
      } else if (upperLimbClearanceDeg <= 0) {
        limbAssessment =
          "target_disk_below_sampled_terrain";
      } else if (lowerLimbClearanceDeg <= 0) {
        limbAssessment =
          "target_disk_intersects_sampled_terrain";
      } else {
        limbAssessment =
          "target_disk_above_sampled_terrain_unconfirmed";
      }

      return {
        ...observation,

        terrainVisibility: {
          terrainHorizonElevationDeg:
            terrain.horizonElevationDeg,

          clearanceDeg,

          blockedBySampledTerrain,

          assessment: blockedBySampledTerrain
            ? "blocked_by_sampled_terrain" as const
            : "above_sampled_terrain_unconfirmed" as const,

          angularDiameterArcsec:
            observation.angularDiameterArcsec,

          semiDiameterDeg,

          upperLimbClearanceDeg,
          lowerLimbClearanceDeg,

          limbAssessment,

          terrainCoverageComplete: false as const,
        },
      };
    }),
  };
}

/**
 * Calculates contiguous observation windows.
 *
 * A missing 10-minute observation breaks a window. This prevents
 * the code from claiming continuous visibility across a data gap.
 */
function calculateVisibilityWindows<TState extends string>(
  observations: TerrainVisibilityObservation[],
  getState: (
    observation: TerrainVisibilityObservation
  ) => TState
): VisibilityWindow<TState>[] {
  if (observations.length === 0) {
    return [];
  }

  const sortedObservations = [...observations].sort(
    (a, b) =>
      parseHorizonsUtc(a.timeUtc) -
      parseHorizonsUtc(b.timeUtc)
  );

  const windows: VisibilityWindow<TState>[] = [];

  let currentState: TState | null = null;
  let windowStartIndex = 0;

  function closeWindow(endIndex: number) {
    if (currentState === null) {
      return;
    }

    const startObservation =
      sortedObservations[windowStartIndex];

    const endObservation =
      sortedObservations[endIndex];

    const startTime = parseHorizonsUtc(
      startObservation.timeUtc
    );

    const endTime = parseHorizonsUtc(
      endObservation.timeUtc
    );

    windows.push({
      state: currentState,

      startTimeUtc: startObservation.timeUtc,
      endTimeUtc: endObservation.timeUtc,

      durationMinutes: Math.max(
        0,
        (endTime - startTime) / 60000
      ),

      observationCount:
        endIndex - windowStartIndex + 1,

      startClearanceDeg:
        startObservation.terrainVisibility.clearanceDeg,

      endClearanceDeg:
        endObservation.terrainVisibility.clearanceDeg,
    });
  }

  for (
    let index = 0;
    index < sortedObservations.length;
    index++
  ) {
    const observation = sortedObservations[index];

    // A non-contiguous time gap starts a new window.
    if (index > 0) {
      const previousTime = parseHorizonsUtc(
        sortedObservations[index - 1].timeUtc
      );

      const currentTime = parseHorizonsUtc(
        observation.timeUtc
      );

      const gap = currentTime - previousTime;

      if (
        gap <= 0 ||
        gap > OBSERVATION_INTERVAL_MS + 1000
      ) {
        closeWindow(index - 1);
        currentState = null;
      }
    }

    const state = getState(observation);

    if (currentState === null) {
      currentState = state;
      windowStartIndex = index;
      continue;
    }

    if (state !== currentState) {
      closeWindow(index - 1);

      currentState = state;
      windowStartIndex = index;
    }
  }

  closeWindow(sortedObservations.length - 1);

  return windows;
}

/**
 * Validates and builds a one-day UTC date range.
 */
function getDateRange(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid date. Use YYYY-MM-DD.");
  }

  const start = new Date(`${date}T00:00:00.000Z`);

  if (
    Number.isNaN(start.getTime()) ||
    start.toISOString().slice(0, 10) !== date
  ) {
    throw new Error("Invalid calendar date.");
  }

  const stop = new Date(start);
  stop.setUTCDate(stop.getUTCDate() + 1);

  return {
    startTime: `${date} 00:00`,
    stopTime: `${stop.toISOString().slice(0, 10)} 00:00`,
  };
}

/**
 * Main API endpoint.
 *
 * JPL ephemerides and terrain analysis are treated as separate
 * capabilities. A terrain failure does not erase valid JPL data.
 */
export async function GET(request: NextRequest) {
  // Required for this Next.js 16 Cache Components route.
  await connection();

  const requestedDate =
    request.nextUrl.searchParams.get("date") ??
    new Date().toISOString().slice(0, 10);

  let dateRange: ReturnType<typeof getDateRange>;

  try {
    dateRange = getDateRange(requestedDate);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error),
        expectedDateFormat: "YYYY-MM-DD",
      },
      { status: 400 }
    );
  }

  try {
    let terrain: LolaTerrainData | null = null;

    let observerSample:
      ReturnType<typeof sampleLolaHeightAtLocation> | null = null;

    let terrainError: string | null = null;

    // 1. Load Product 78 and derive the Site04 observer altitude.
    //
    // If this local dataset is unavailable, JPL can still return
    // ephemerides using a clearly disclosed 0 km fallback altitude.
    try {
      terrain = await loadTerrainFromDisk();

      observerSample = sampleLolaHeightAtLocation(
        terrain,
        {
          latitudeDeg: BASE_OBSERVER.latitude,
          longitudeEastDeg: BASE_OBSERVER.longitudeEast,
        }
      );

      if (
        !Number.isFinite(observerSample.elevationMeters)
      ) {
        throw new Error(
          "Product 78 returned an invalid observer elevation."
        );
      }
    } catch (error) {
      terrain = null;
      observerSample = null;
      terrainError = getErrorMessage(error);

      console.error(
        "Could not load the local Site04 terrain raster:",
        terrainError
      );
    }

    const observer: Observer = {
      ...BASE_OBSERVER,

      altitudeKm:
        (observerSample?.elevationMeters ?? 0) / 1000,
    };

    // 2. Fetch Sun and Earth independently.
    //
    // One failed target no longer discards the other target.
    const [sunResult, earthResult] =
      await Promise.allSettled([
        getTargetEphemeris(
          "10",
          dateRange.startTime,
          dateRange.stopTime,
          observer
        ),

        getTargetEphemeris(
          "399",
          dateRange.startTime,
          dateRange.stopTime,
          observer
        ),
      ]);

    const sun =
      sunResult.status === "fulfilled"
        ? sunResult.value
        : null;

    const earth =
      earthResult.status === "fulfilled"
        ? earthResult.value
        : null;

    const sunError =
      sunResult.status === "rejected"
        ? getErrorMessage(sunResult.reason)
        : null;

    const earthError =
      earthResult.status === "rejected"
        ? getErrorMessage(earthResult.reason)
        : null;

    // If neither JPL target is available, this is a genuine
    // ephemeris failure. There is no useful target result to return.
    if (!sun && !earth) {
      return NextResponse.json(
        {
          success: false,
          source: "NASA/JPL Horizons",
          error: "Both celestial target requests failed.",
          targetErrors: {
            sun: sunError,
            earth: earthError,
          },
        },
        { status: 502 }
      );
    }

    // 3. Calculate or reuse the fixed terrain horizon.
    //
    // This calculation is independent of the requested date.
    let terrainHorizon: TerrainHorizonResult | null = null;

    let terrainHorizonCache:
      | "computed_and_cached_in_memory"
      | "reused_in_memory"
      | "unavailable" = "unavailable";

    if (terrain) {
      try {
        const wasAlreadyCached =
          terrainHorizonPromise !== null;

        terrainHorizon =
          await getCachedTerrainHorizon(terrain);

        terrainHorizonCache = wasAlreadyCached
          ? "reused_in_memory"
          : "computed_and_cached_in_memory";
      } catch (error) {
        terrainError = getErrorMessage(error);

        console.error(
          "Terrain horizon calculation failed; returning JPL ephemerides without terrain assessment:",
          terrainError
        );
      }
    }

    // 4. Add terrain visibility only when the complete profile
    // calculation succeeded.
    const sunWithTerrain =
      sun && terrainHorizon
        ? addTerrainVisibility(
            sun,
            terrainHorizon.directions
          )
        : null;

    const earthWithTerrain =
      earth && terrainHorizon
        ? addTerrainVisibility(
            earth,
            terrainHorizon.directions
          )
        : null;

    const sunTarget =
      sunWithTerrain
        ? {
            ...sunWithTerrain,

            // Existing centre-based windows are preserved.
            visibilityWindows:
              calculateVisibilityWindows(
                sunWithTerrain.observations,
                (observation) =>
                  observation.terrainVisibility.assessment
              ),

            // New disk-aware windows are supplementary.
            limbVisibilityWindows:
              calculateVisibilityWindows(
                sunWithTerrain.observations,
                (observation) =>
                  observation.terrainVisibility.limbAssessment
              ),
          }
        : sun ?? {
            available: false,
            error: sunError,
          };

    const earthTarget =
      earthWithTerrain
        ? {
            ...earthWithTerrain,

            visibilityWindows:
              calculateVisibilityWindows(
                earthWithTerrain.observations,
                (observation) =>
                  observation.terrainVisibility.assessment
              ),

            limbVisibilityWindows:
              calculateVisibilityWindows(
                earthWithTerrain.observations,
                (observation) =>
                  observation.terrainVisibility.limbAssessment
              ),
          }
        : earth ?? {
            available: false,
            error: earthError,
          };

    const terrainAvailable =
      terrainHorizon !== null;

    const bothTargetsAvailable =
      sun !== null && earth !== null;

    const isPartial =
      !terrainAvailable || !bothTargetsAvailable;

    const sources = [
      "NASA/JPL Horizons",
    ];

    if (terrainAvailable) {
      sources.push(
        "NASA LOLA Product 78 — Site04 local terrain",
        "NASA LOLA Product 90 — regional terrain"
      );
    }

    const terrainModel = terrainHorizon && terrain
      ? {
          source:
            "NASA LOLA Product 78 + Product 90 multi-resolution terrain",

          cache: terrainHorizonCache,

          sources: {
            local: {
              name: "NASA LOLA Product 78 — Site04",

              resolutionMeters:
                terrainHorizon.product78ResolutionMeters,
            },

            regional: {
              name: "NASA LOLA Product 90",

              resolutionMeters:
                terrainHorizon.product90ResolutionMeters,
            },
          },

          referenceFrame:
            terrain.metadata.coordinateSystem.referenceFrame,

          ephemeris:
            terrain.metadata.coordinateSystem.ephemeris,

          observerElevationMeters:
            observerSample?.elevationMeters ?? null,

          sampleStepMeters:
            terrainHorizon.sampleStepMeters,

          regionalSampleStepMeters:
            terrainHorizon.regionalSampleStepMeters,

          directionCount:
            terrainHorizon.calculatedDirections,

          directionSpacingDegrees:
            360 / terrainHorizon.directions.length,

          totalSamplesChecked:
            terrainHorizon.totalSamplesChecked,

          product78SamplesChecked:
            terrainHorizon.product78SamplesChecked,

          product90SamplesChecked:
            terrainHorizon.product90SamplesChecked,

          rasterBoundaryLimitedDirections:
            terrainHorizon.rasterBoundaryLimitedDirections,

          product90CoverageBoundaryLimitedDirections:
            terrainHorizon.product90CoverageBoundaryLimitedDirections,

          product90NoDataTerminatedDirections:
            terrainHorizon.product90NoDataTerminatedDirections,

          searchLimitReachedDirections:
            terrainHorizon.searchLimitReachedDirections,

          completeHorizonVerified:
            terrainHorizon.completeHorizonVerified,

          horizonProfile:
            terrainHorizon.directions.map((direction) => ({
              azimuthDeg: direction.azimuthDeg,

              horizonElevationDeg:
                direction.horizonElevationDeg,

              distanceMeters:
                direction.distanceMeters,

              terrainElevationMeters:
                direction.terrainElevationMeters,

              horizonSource:
                direction.horizonSource,

              horizonResolutionMeters:
                direction.horizonResolutionMeters,

              samplesChecked:
                direction.samplesChecked,

              product78SamplesChecked:
                direction.product78SamplesChecked,

              product90SamplesChecked:
                direction.product90SamplesChecked,

              terminationReason:
                direction.terminationReason,
            })),
        }
      : null;

    const notes = [
      "Sun and Earth observations are retrieved independently from NASA/JPL Horizons.",

      "Horizons uses airless apparent azimuth and elevation for the lunar observer.",

      "Both targets are requested every 10 minutes over a 24-hour UTC period.",

      "Each target is expected to return 145 observations, including both endpoints.",

      "JPL target requests are retried for temporary network and server failures.",

      "Target angular diameter is requested to support first-order disk-limb screening.",

      "Angular diameter is reported in arcseconds and converted to angular semi-diameter for limb screening.",

      "The limb assessment uses the terrain horizon at the target centre azimuth. It is not a full two-dimensional disk-to-terrain intersection.",

      "Horizons presence/event marker text is preserved separately and is not interpreted as terrain-adjusted visibility.",

      "Observer altitude is derived from Product 78 when available.",

      "If Product 78 cannot be loaded, a 0 km altitude fallback is sent to JPL and the result must be treated as approximate.",

      "The Product 78 vertical datum must be confirmed compatible with the altitude-above-reference-ellipsoid convention used by JPL Horizons before interpreting very small angular differences as final.",
    ];

    if (terrainAvailable) {
      notes.push(
        "Product 78 supplies local high-resolution Shackleton Rim terrain.",

        "Product 90 supplies wider regional terrain outside Product 78 coverage.",

        "Product 78 is sampled at 5 metre intervals.",

        "Product 90 is sampled at 20 metre intervals.",

        "No elevation averaging is performed between the datasets.",

        "Lunar curvature is included in terrain elevation-angle calculations.",

        "The fixed terrain horizon profile is cached in memory and reused for later date requests.",

        "Terrain obstruction is evaluated independently for every available Sun and Earth observation.",

        "Visibility windows are split when an observation time gap exceeds the expected sampling interval.",

        "Visibility-window boundaries are observation timestamps, not exact interpolated astronomical crossing times.",

        "Complete lunar horizon visibility has not been established."
      );
    } else {
      notes.push(
        `Terrain visibility was not calculated: ${terrainError ?? "terrain profile unavailable"}.`,

        "The returned JPL ephemerides do not contain terrain-adjusted visibility values.",

        "Missing terrain data is never interpreted as an unobstructed horizon."
      );
    }

    if (!bothTargetsAvailable) {
      notes.push(
        "At least one celestial target request failed. The other successful target is still returned."
      );
    }

    notes.push(
      "These results do not yet calculate solar panel power, thermal behaviour, or radio link performance."
    );

    return NextResponse.json({
      success: true,

      status: isPartial ? "partial" : "complete",
      partial: isPartial,

      source: sources,

      observer: {
        ...observer,

        elevationSource: observerSample
          ? "NASA LOLA Product 78 — Site04"
          : "Fallback altitude — 0 km",

        elevationMeters:
          observerSample?.elevationMeters ?? null,

        altitudeQuality: observerSample
          ? "lola_derived"
          : "fallback_approximate",
      },

      coordinateConvention: {
        longitude: "East-positive degrees",

        latitude:
          "Geodetic latitude supplied to JPL Horizons.",

        altitude:
          "Kilometres above the reference ellipsoid expected by JPL Horizons.",

        ephemeris:
          "Universal Time (UT), with UTC-formatted timestamps.",
      },

      timeRange: {
        start: dateRange.startTime,
        stop: dateRange.stopTime,

        timeScale: "UT",
        interval: "10 minutes",

        expectedObservationsPerTarget:
          EXPECTED_OBSERVATIONS_PER_DAY,
      },

      quantities: {
        codes: ["4", "13"],

        description:
          "Airless apparent azimuth, elevation, and target angular diameter.",

        angleUnit: "Degrees for azimuth/elevation",

        angularDiameterUnit: "Arcseconds",
      },

      targetStatus: {
        sun: sun
          ? "available"
          : "unavailable",

        earth: earth
          ? "available"
          : "unavailable",

        terrain: terrainAvailable
          ? "available"
          : "unavailable",
      },

      targetErrors: {
        sun: sunError,
        earth: earthError,
      },

      targets: {
        sun: sunTarget,
        earth: earthTarget,
      },

      terrainAnalysis: {
        status: terrainAvailable
          ? "available"
          : "unavailable",

        cache: terrainHorizonCache,

        error: terrainAvailable
          ? null
          : terrainError,
      },

      terrainModel,

      interpretation: {
        azimuth:
          "Degrees clockwise from North.",

        elevation:
          "Degrees above or below the local plane perpendicular to the zenith direction.",

        blockedBySampledTerrain:
          "The target centre is at or below the interpolated sampled terrain obstruction angle.",

        aboveSampledTerrainUnconfirmed:
          "The target centre is above sampled terrain at its azimuth, but complete visibility cannot be confirmed because terrain coverage and sampling are limited.",

        targetDiskBelowSampledTerrain:
          "The target's upper limb is at or below the sampled terrain horizon.",

        targetDiskIntersectsSampledTerrain:
          "The target's angular disk intersects the sampled terrain horizon in the first-order limb check.",

        targetDiskAboveSampledTerrainUnconfirmed:
          "The target's lower limb is above the sampled terrain horizon, but complete visibility remains unconfirmed.",

        limbAssessment:
          "A first-order vertical disk-limb screening using JPL angular diameter and the horizon at the target centre azimuth. It is not a complete two-dimensional terrain occultation calculation.",

        visibilityWindows:
          "Continuous intervals of sampled terrain-obstruction states. Missing observation intervals break a window. Window boundaries are sampled timestamps, not exact interpolated crossing times.",

        completeVisibility:
          "Not established by this calculation. The sampled horizon does not prove complete lunar horizon coverage.",

        horizonsMarker:
          "Preserved from the original Horizons table. It is not interpreted as terrain-adjusted visibility.",
      },

      notes,
    });
  } catch (error) {
    const message = getErrorMessage(error);

    console.error(
      "JPL Horizons API failed:",
      message
    );

    return NextResponse.json(
      {
        success: false,
        source: "NASA/JPL Horizons",
        error: message,
      },
      { status: 502 }
    );
  }
}
