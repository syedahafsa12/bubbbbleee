
import {
  type GeographicCoordinate,
  type LolaTerrainData,
  type ProjectedCoordinate,
  SITE04_COORDINATES,
  geographicToLolaProjected,
  projectedToLolaPixel,
  isLolaPixelInsideRaster,
  sampleLolaHeightAtPixel,
  sampleLolaHeightAtLocation,
} from "./terrainData";

export type TerrainHorizonTermination =
  | "raster_boundary"
  | "search_limit";

export interface TerrainHorizonDirection {
  azimuthDeg: number;

  // Maximum sampled terrain elevation angle.
  horizonElevationDeg: number;

  // Distance to the sampled terrain point producing
  // the maximum elevation angle.
  distanceMeters: number;

  // Elevation of the sampled terrain point producing
  // the maximum elevation angle.
  terrainElevationMeters: number;

  samplesChecked: number;

  // Why sampling stopped in this direction.
  terminationReason: TerrainHorizonTermination;

  // The result is limited by either raster coverage
  // or the configured maximum search distance.
  coverageLimited: true;
}

export interface TerrainHorizonResult {
  observer: GeographicCoordinate;
  observerProjected: ProjectedCoordinate;
  observerElevationMeters: number;
  lunarRadiusMeters: number;
  sampleStepMeters: number;
  maxDistanceMeters: number;

  directions: TerrainHorizonDirection[];
  calculatedDirections: number;
  totalSamplesChecked: number;

  rasterBoundaryLimitedDirections: number;
  searchLimitReachedDirections: number;

  // A finite raster and search distance cannot establish
  // the complete lunar horizon.
  completeHorizonVerified: false;
}

export interface TerrainHorizonOptions {
  directionCount?: number;
  sampleStepMeters?: number;
  maxDistanceMeters?: number;
}

const DEFAULT_DIRECTION_COUNT = 360;
const DEFAULT_SAMPLE_STEP_METERS = 5;
const DEFAULT_MAX_DISTANCE_METERS = 15000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Normalizes east longitude to the range [0, 360).
 *
 * This supports lunar coordinates such as 188.13° east
 * and equivalent negative longitude representations.
 */
function normalizeEastLongitude(longitudeDeg: number): number {
  return ((longitudeDeg % 360) + 360) % 360;
}

/**
 * Calculates a destination coordinate on a spherical Moon.
 *
 * Bearing convention:
 * 0° = North
 * 90° = East
 * 180° = South
 * 270° = West
 */
function destinationCoordinate(
  start: GeographicCoordinate,
  bearingDeg: number,
  distanceMeters: number,
  lunarRadiusMeters: number
): GeographicCoordinate {
  const latitude1 = toRadians(start.latitudeDeg);

  const longitude1 = toRadians(
    normalizeEastLongitude(start.longitudeEastDeg)
  );

  const bearing = toRadians(bearingDeg);

  const angularDistance = distanceMeters / lunarRadiusMeters;

  const sinLatitude2 =
    Math.sin(latitude1) * Math.cos(angularDistance) +
    Math.cos(latitude1) *
    Math.sin(angularDistance) *
    Math.cos(bearing);

  const latitude2 = Math.asin(
    Math.max(-1, Math.min(1, sinLatitude2))
  );

  const longitude2 =
    longitude1 +
    Math.atan2(
      Math.sin(bearing) *
      Math.sin(angularDistance) *
      Math.cos(latitude1),
      Math.cos(angularDistance) -
      Math.sin(latitude1) * Math.sin(latitude2)
    );

  return {
    latitudeDeg: toDegrees(latitude2),
    longitudeEastDeg: normalizeEastLongitude(
      toDegrees(longitude2)
    ),
  };
}

/**
 * Calculates apparent terrain elevation relative to the
 * observer's local horizontal plane.
 *
 * Lunar curvature is included using the lunar radius,
 * observer elevation and sampled terrain elevation.
 */
function calculateTerrainElevationAngle(
  observerElevationMeters: number,
  terrainElevationMeters: number,
  distanceMeters: number,
  lunarRadiusMeters: number
): number {
  if (
    !Number.isFinite(observerElevationMeters) ||
    !Number.isFinite(terrainElevationMeters) ||
    !Number.isFinite(distanceMeters) ||
    distanceMeters <= 0 ||
    !Number.isFinite(lunarRadiusMeters) ||
    lunarRadiusMeters <= 0
  ) {
    throw new Error(
      "Invalid values supplied to terrain elevation angle calculation."
    );
  }

  const observerRadius =
    lunarRadiusMeters + observerElevationMeters;

  const terrainRadius =
    lunarRadiusMeters + terrainElevationMeters;

  if (observerRadius <= 0 || terrainRadius <= 0) {
    throw new Error(
      "Observer or terrain radius is invalid."
    );
  }

  const angularDistance = distanceMeters / lunarRadiusMeters;

  const vertical =
    terrainRadius * Math.cos(angularDistance) -
    observerRadius;

  const horizontal =
    terrainRadius * Math.sin(angularDistance);

  const elevationAngle = toDegrees(
    Math.atan2(vertical, horizontal)
  );

  if (!Number.isFinite(elevationAngle)) {
    throw new Error(
      "Terrain elevation angle calculation produced a non-finite result."
    );
  }

  return elevationAngle;
}

/**
 * Calculates the terrain horizon along one azimuth.
 *
 * Sampling stops when either:
 * 1. The path leaves the available LOLA raster.
 * 2. The configured maximum search distance is reached.
 *
 * A direction with zero valid samples throws an error.
 * It must never be interpreted as an unobstructed -90° horizon.
 *
 * Neither the raster boundary nor the search limit proves
 * that terrain beyond the sampled area cannot produce a
 * higher horizon.
 */
function calculateDirectionHorizon(
  terrain: LolaTerrainData,
  observer: GeographicCoordinate,
  observerElevationMeters: number,
  azimuthDeg: number,
  sampleStepMeters: number,
  maxDistanceMeters: number,
  lunarRadiusMeters: number
): TerrainHorizonDirection {
  let maximumAngle = -Infinity;
  let maximumDistance = 0;
  let maximumTerrainElevation = 0;

  let samplesChecked = 0;

  let terminationReason: TerrainHorizonTermination =
    "search_limit";

  // Calculate the number of samples needed to include
  // the exact maximum search distance, even when it is
  // not divisible by sampleStepMeters.
  const sampleCount = Math.ceil(
    maxDistanceMeters / sampleStepMeters
  );

  if (!Number.isSafeInteger(sampleCount) || sampleCount < 1) {
    throw new Error(
      `Invalid terrain sample count for azimuth ${azimuthDeg}°.`
    );
  }

  for (
    let sampleIndex = 1;
    sampleIndex <= sampleCount;
    sampleIndex++
  ) {
    const distance = Math.min(
      sampleIndex * sampleStepMeters,
      maxDistanceMeters
    );

    const coordinate = destinationCoordinate(
      observer,
      azimuthDeg,
      distance,
      lunarRadiusMeters
    );

    const projected = geographicToLolaProjected(
      coordinate,
      terrain.metadata
    );

    const pixel = projectedToLolaPixel(
      projected,
      terrain.metadata
    );

    // Stop when the ray leaves the available raster.
    // Never extrapolate terrain beyond its actual coverage.
    if (!isLolaPixelInsideRaster(pixel, terrain)) {
      terminationReason = "raster_boundary";
      break;
    }

    const terrainElevation = sampleLolaHeightAtPixel(
      terrain,
      pixel
    );

    if (!Number.isFinite(terrainElevation)) {
      throw new Error(
        `Invalid terrain elevation at azimuth ${azimuthDeg}°, distance ${distance}m.`
      );
    }

    const elevationAngle = calculateTerrainElevationAngle(
      observerElevationMeters,
      terrainElevation,
      distance,
      lunarRadiusMeters
    );

    samplesChecked++;

    if (elevationAngle > maximumAngle) {
      maximumAngle = elevationAngle;
      maximumDistance = distance;
      maximumTerrainElevation = terrainElevation;
    }

    // The exact configured endpoint has been sampled.
    if (distance >= maxDistanceMeters) {
      terminationReason = "search_limit";
      break;
    }
  }

  // Fail closed: an uncovered direction must not be
  // represented as a -90° unobstructed horizon.
  if (samplesChecked === 0) {
    throw new Error(
      `No valid LOLA terrain samples found at azimuth ${azimuthDeg}°. ` +
      "The observer may be outside the usable raster coverage " +
      "or too close to its boundary."
    );
  }

  if (
    !Number.isFinite(maximumAngle) ||
    !Number.isFinite(maximumDistance) ||
    !Number.isFinite(maximumTerrainElevation)
  ) {
    throw new Error(
      `Invalid terrain horizon result at azimuth ${azimuthDeg}°.`
    );
  }

  return {
    azimuthDeg,
    horizonElevationDeg: maximumAngle,
    distanceMeters: maximumDistance,
    terrainElevationMeters: maximumTerrainElevation,
    samplesChecked,
    terminationReason,
    coverageLimited: true,
  };
}

/**
 * Calculates a sampled terrain horizon around the observer.
 *
 * IMPORTANT:
 * This is a terrain horizon estimate within the available
 * LOLA raster and configured search distance.
 *
 * It is not proof of the complete lunar horizon.
 *
 * Every requested direction must have at least one valid
 * terrain sample. An uncovered direction causes an explicit
 * error instead of being treated as unobstructed.
 */
export function calculateTerrainHorizon(
  terrain: LolaTerrainData,
  observer: GeographicCoordinate = SITE04_COORDINATES,
  options: TerrainHorizonOptions = {}
): TerrainHorizonResult {
  const directionCount =
    options.directionCount ?? DEFAULT_DIRECTION_COUNT;

  const sampleStepMeters =
    options.sampleStepMeters ?? DEFAULT_SAMPLE_STEP_METERS;

  const maxDistanceMeters =
    options.maxDistanceMeters ?? DEFAULT_MAX_DISTANCE_METERS;

  // Validate direction count.
  if (
    !Number.isSafeInteger(directionCount) ||
    directionCount < 4
  ) {
    throw new Error(
      "directionCount must be a safe integer of at least 4."
    );
  }

  // Validate sampling distance.
  if (
    !Number.isFinite(sampleStepMeters) ||
    sampleStepMeters <= 0
  ) {
    throw new Error(
      "sampleStepMeters must be a finite number greater than zero."
    );
  }

  // Validate maximum search distance.
  if (
    !Number.isFinite(maxDistanceMeters) ||
    maxDistanceMeters <= 0
  ) {
    throw new Error(
      "maxDistanceMeters must be a finite number greater than zero."
    );
  }

  // Validate observer coordinates.
  if (
    !Number.isFinite(observer.latitudeDeg) ||
    observer.latitudeDeg < -90 ||
    observer.latitudeDeg > 90 ||
    !Number.isFinite(observer.longitudeEastDeg) ||
    observer.longitudeEastDeg < -360 ||
    observer.longitudeEastDeg > 360
  ) {
    throw new Error(
      "Invalid observer geographic coordinates."
    );
  }

  // Read and validate the lunar reference radius.
  const lunarRadius =
    terrain.metadata.georeferencing.lunarRadiusMeters;

  if (!Number.isFinite(lunarRadius) || lunarRadius <= 0) {
    throw new Error(
      `Invalid lunar radius: ${lunarRadius}.`
    );
  }

  // A single bearing is not meaningful beyond half
  // the circumference of the spherical body.
  if (maxDistanceMeters >= Math.PI * lunarRadius) {
    throw new Error(
      "maxDistanceMeters must be less than half the lunar circumference."
    );
  }

  // Validate the observer's location against the raster
  // and obtain its terrain elevation.
  const observerSample = sampleLolaHeightAtLocation(
    terrain,
    observer
  );

  if (!Number.isFinite(observerSample.elevationMeters)) {
    throw new Error(
      "Observer terrain elevation is invalid."
    );
  }

  const directions: TerrainHorizonDirection[] = [];

  let totalSamplesChecked = 0;
  let rasterBoundaryLimitedDirections = 0;
  let searchLimitReachedDirections = 0;

  for (let i = 0; i < directionCount; i++) {
    const azimuthDeg = (i * 360) / directionCount;

    const result = calculateDirectionHorizon(
      terrain,
      observer,
      observerSample.elevationMeters,
      azimuthDeg,
      sampleStepMeters,
      maxDistanceMeters,
      lunarRadius
    );

    directions.push(result);

    totalSamplesChecked += result.samplesChecked;

    if (result.terminationReason === "raster_boundary") {
      rasterBoundaryLimitedDirections++;
    } else {
      searchLimitReachedDirections++;
    }
  }

  return {
    observer,
    observerProjected: observerSample.projected,
    observerElevationMeters: observerSample.elevationMeters,
    lunarRadiusMeters: lunarRadius,
    sampleStepMeters,
    maxDistanceMeters,

    directions,
    calculatedDirections: directions.length,
    totalSamplesChecked,

    rasterBoundaryLimitedDirections,
    searchLimitReachedDirections,

    completeHorizonVerified: false,
  };
}
