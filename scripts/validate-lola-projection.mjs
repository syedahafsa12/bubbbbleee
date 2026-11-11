
import { readFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.join(
  process.cwd(),
  "public/data/site04_shackleton_rim"
);

const metadata = JSON.parse(
  await readFile(path.join(dataDir, "metadata.json"), "utf8")
);

const latitude = -89.7668;
const longitudeEast = 188.13;

const radius = metadata.georeferencing.lunarRadiusMeters;
const centralMeridian =
  metadata.georeferencing.centralMeridianDegrees;

const toRadians = (degrees) => degrees * Math.PI / 180;
const toDegrees = (radians) => radians * 180 / Math.PI;

// Forward projection.
const latitudeRadians = toRadians(latitude);
const longitudeDifference = toRadians(
  longitudeEast - centralMeridian
);

const rho =
  2 * radius *
  Math.tan((Math.PI / 2 + latitudeRadians) / 2);

const projectedX = rho * Math.sin(longitudeDifference);
const projectedY = rho * Math.cos(longitudeDifference);

// Independent inverse projection.
const inverseRho = Math.hypot(projectedX, projectedY);

const recoveredLatitude =
  -90 + toDegrees(
    2 * Math.atan(inverseRho / (2 * radius))
  );

let recoveredLongitude =
  centralMeridian +
  toDegrees(Math.atan2(projectedX, projectedY));

recoveredLongitude =
  ((recoveredLongitude % 360) + 360) % 360;

// Compare the recovered geographic coordinates.
const latitudeError = recoveredLatitude - latitude;

// Normalize longitude difference to [-180, 180].
const longitudeError =
  ((recoveredLongitude - longitudeEast + 540) % 360) - 180;

// Convert projected coordinates into raster pixel indices.
const originX = metadata.georeferencing.tiePoint.x;
const originY = metadata.georeferencing.tiePoint.y;

const pixelWidth = metadata.pixelResolution[0];
const pixelHeight = Math.abs(metadata.pixelResolution[1]);

const column =
  (projectedX - originX) / pixelWidth - 0.5;

const row =
  (originY - projectedY) / pixelHeight - 0.5;

console.log("\n=== INDEPENDENT PROJECTION ROUND-TRIP ===");

console.log({
  inputLatitude: latitude,
  inputLongitudeEast: longitudeEast,
  projectedX,
  projectedY,
  recoveredLatitude,
  recoveredLongitude,
  latitudeErrorDegrees: latitudeError,
  longitudeErrorDegrees: longitudeError
});

console.log("\n=== RASTER POSITION ===");

console.log({
  fractionalColumn: column,
  fractionalRow: row,
  insideRaster:
    column >= 0 &&
    row >= 0 &&
    column < metadata.width - 1 &&
    row < metadata.height - 1
});

const passed =
  Math.abs(latitudeError) < 1e-10 &&
  Math.abs(longitudeError) < 1e-10;

console.log("\n=== RESULT ===");

console.log(
  passed
    ? "PASS: Forward and inverse spherical projections agree."
    : "FAIL: Geographic round-trip mismatch."
);

if (!passed) {
  process.exitCode = 1;
}
