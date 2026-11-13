/**
 * @typedef {Object} TerrainHorizonDirection
 * @property {number} azimuthDeg
 * @property {number | null} horizonElevationDeg
 * @property {"partial" | "no_data"} coverageStatus
 * @property {string} terminationReason
 */

/**
 * Interpolates the sampled terrain horizon at an arbitrary azimuth.
 *
 * A missing or non-finite neighbouring direction remains unknown. In
 * particular, this function never substitutes zero degrees for NoData.
 *
 * @param {number} azimuthDeg
 * @param {TerrainHorizonDirection[]} profile
 * @returns {{
 *   horizonElevationDeg: number,
 *   lowerAzimuthDeg: number,
 *   upperAzimuthDeg: number,
 *   lowerTerminationReason: string,
 *   upperTerminationReason: string
 * } | null}
 */
export function getTerrainHorizonAtAzimuth(azimuthDeg, profile) {
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
  const lowerElevation = lower.horizonElevationDeg;
  const upperElevation = upper.horizonElevationDeg;

  // A direction with missing or non-finite terrain remains unknown.
  // Narrow the values before interpolation so null can never enter the math.
  if (
    typeof lowerElevation !== "number" ||
    typeof upperElevation !== "number" ||
    lower.coverageStatus === "no_data" ||
    upper.coverageStatus === "no_data" ||
    !Number.isFinite(lowerElevation) ||
    !Number.isFinite(upperElevation)
  ) {
    return null;
  }

  const horizonElevationDeg =
    lowerElevation +
    (upperElevation - lowerElevation) *
      fraction;

  return {
    horizonElevationDeg,
    lowerAzimuthDeg: lower.azimuthDeg,
    upperAzimuthDeg: upper.azimuthDeg,
    lowerTerminationReason: lower.terminationReason,
    upperTerminationReason: upper.terminationReason,
  };
}
