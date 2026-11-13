
import type {
  GeographicCoordinate,
  LolaTerrainMetadata,
  RasterPixelCoordinate,
  ProjectedCoordinate,
} from "./terrainData";

/**
 * Normalize east longitude to [0, 360).
 */
function normalizeEastLongitude(longitudeDeg: number): number {
  return ((longitudeDeg % 360) + 360) % 360;
}

/**
 * Convert a fractional Product 78 raster pixel coordinate
 * into South Polar Stereographic projected coordinates.
 *
 * Product 78 uses PixelIsArea registration. Therefore,
 * the 0.5 pixel offset is required to locate pixel centres.
 */
export function lolaPixelToProjected(
  pixel: RasterPixelCoordinate,
  metadata: LolaTerrainMetadata
): ProjectedCoordinate {
  if (
    !Number.isFinite(pixel.column) ||
    !Number.isFinite(pixel.row)
  ) {
    throw new Error("Raster pixel coordinates must be finite.");
  }

  const tiePoint = metadata.georeferencing.tiePoint;

  const [pixelWidth, pixelHeight, pixelRotation] =
    metadata.pixelResolution;

  if (
    pixelWidth === 0 ||
    pixelHeight === 0 ||
    Math.abs(pixelRotation) > 1e-10
  ) {
    throw new Error("Unsupported raster pixel transform.");
  }

  const xMeters =
    tiePoint.x +
    (pixel.column + 0.5 - tiePoint.column) * pixelWidth;

  const yMeters =
    tiePoint.y +
    (pixel.row + 0.5 - tiePoint.row) * pixelHeight;

  if (!Number.isFinite(xMeters) || !Number.isFinite(yMeters)) {
    throw new Error("Pixel-to-projected conversion failed.");
  }

  return { xMeters, yMeters };
}

/**
 * Convert South Polar Stereographic projected coordinates
 * into lunar geographic coordinates.
 *
 * This reverses the projection used by geographicToLolaProjected()
 * in terrainData.ts.
 *
 * Longitude is returned as east longitude in [0, 360).
 */
export function lolaProjectedToGeographic(
  projected: ProjectedCoordinate,
  metadata: LolaTerrainMetadata
): GeographicCoordinate {
  const { xMeters, yMeters } = projected;

  if (!Number.isFinite(xMeters) || !Number.isFinite(yMeters)) {
    throw new Error("Projected coordinates must be finite.");
  }

  const radius = metadata.georeferencing.lunarRadiusMeters;
  const centralMeridian =
    metadata.georeferencing.centralMeridianDegrees;

  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error("Invalid lunar reference radius.");
  }

  const rho = Math.hypot(xMeters, yMeters);

  // Inverse of:
  // rho = 2 * R * tan((90 + latitude) / 2)
  const angularDistance =
    2 * Math.atan(rho / (2 * radius));

  const latitudeDeg =
    (angularDistance * 180) / Math.PI - 90;

  // Inverse of:
  // x = rho * sin(longitudeDifference)
  // y = rho * cos(longitudeDifference)
  const longitudeDifferenceDeg =
    (Math.atan2(xMeters, yMeters) * 180) / Math.PI;

  // At the South Pole, longitude is mathematically undefined.
  // Use the projection's central meridian as a stable convention.
  const longitudeEastDeg =
    rho < 1e-9
      ? normalizeEastLongitude(centralMeridian)
      : normalizeEastLongitude(
          centralMeridian + longitudeDifferenceDeg
        );

  if (
    !Number.isFinite(latitudeDeg) ||
    latitudeDeg < -90 - 1e-8 ||
    latitudeDeg > 1e-8
  ) {
    throw new Error(
      `Inverse projection produced an invalid southern latitude: ${latitudeDeg}.`
    );
  }

  return {
    latitudeDeg: Math.max(-90, Math.min(0, latitudeDeg)),
    longitudeEastDeg,
  };
}

/**
 * Convert a Product 78 raster pixel directly into
 * geographic coordinates.
 */
export function lolaPixelToGeographic(
  pixel: RasterPixelCoordinate,
  metadata: LolaTerrainMetadata
): GeographicCoordinate {
  const projected = lolaPixelToProjected(pixel, metadata);

  return lolaProjectedToGeographic(projected, metadata);
}
