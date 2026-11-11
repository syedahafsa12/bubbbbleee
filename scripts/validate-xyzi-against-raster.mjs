
import fs from "node:fs";
import { fromFile } from "geotiff";

const pointCloudPath = "scripts/Site04_final_adj.xyzi";
const rasterPath =
  "public/data/site04_shackleton_rim/Site04_final_adj_5mpp_surf.tif";

const buffer = fs.readFileSync(pointCloudPath);
const RECORD_SIZE = 32;
const RECORD_COUNT = buffer.length / RECORD_SIZE;

const WIDTH = 3200;
const HEIGHT = 3200;

// Raster georeferencing already verified against its original TIFF.
const ORIGIN_X = -9000;
const ORIGIN_Y = 1000;
const PIXEL_WIDTH = 5;
const PIXEL_HEIGHT = -5;

// Provisional XYZI unit conversion: kilometres to metres.
const UNIT_SCALE = 1000;

const targetX = -1000.0366057189;
const targetY = -7000.3455652705;

const points = [];

for (let i = 0; i < RECORD_COUNT; i++) {
  const offset = i * RECORD_SIZE;

  const x = buffer.readDoubleLE(offset) * UNIT_SCALE;
  const y = buffer.readDoubleLE(offset + 8) * UNIT_SCALE;
  const z = buffer.readDoubleLE(offset + 16) * UNIT_SCALE;

  const distance = Math.hypot(x - targetX, y - targetY);

  if (points.length < 10 || distance < points[9].distance) {
    points.push({ record: i, x, y, z, distance });

    points.sort((a, b) => a.distance - b.distance);

    if (points.length > 10) points.pop();
  }
}

const tiff = await fromFile(rasterPath);
const image = await tiff.getImage();
const rasterData = await image.readRasters();

const elevation = rasterData[0];

function sampleBilinear(x, y) {
  const column =
    (x - ORIGIN_X) / PIXEL_WIDTH - 0.5;

  const row =
    (y - ORIGIN_Y) / PIXEL_HEIGHT - 0.5;

  const col0 = Math.floor(column);
  const row0 = Math.floor(row);

  const dx = column - col0;
  const dy = row - row0;

  if (
    col0 < 0 ||
    row0 < 0 ||
    col0 + 1 >= WIDTH ||
    row0 + 1 >= HEIGHT
  ) {
    return null;
  }

  const get = (col, r) => elevation[r * WIDTH + col];

  const v00 = get(col0, row0);
  const v10 = get(col0 + 1, row0);
  const v01 = get(col0, row0 + 1);
  const v11 = get(col0 + 1, row0 + 1);

  if (![v00, v10, v01, v11].every(Number.isFinite)) {
    return null;
  }

  return (
    v00 * (1 - dx) * (1 - dy) +
    v10 * dx * (1 - dy) +
    v01 * (1 - dx) * dy +
    v11 * dx * dy
  );
}

console.log("\n=== XYZI POINTS VS NASA LDEM ===\n");

console.log("Raster dimensions:", image.getWidth(), "x", image.getHeight());
console.log("Points compared:", points.length);
console.log("Assumed XYZI scale:", UNIT_SCALE, "metres per coordinate unit");

const results = points.map((point) => {
  const rasterElevation = sampleBilinear(point.x, point.y);

  return {
    record: point.record,
    distanceFromTarget_m: Number(point.distance.toFixed(3)),
    pointElevation_m: Number(point.z.toFixed(3)),
    rasterElevation_m:
      rasterElevation === null
        ? null
        : Number(rasterElevation.toFixed(3)),
    difference_m:
      rasterElevation === null
        ? null
        : Number((point.z - rasterElevation).toFixed(3)),
  };
});

console.table(results);

const valid = results.filter(
  (item) => item.difference_m !== null
);

if (valid.length > 0) {
  const meanAbsoluteDifference =
    valid.reduce(
      (sum, item) => sum + Math.abs(item.difference_m),
      0
    ) / valid.length;

  console.log(
    "\nMean absolute elevation difference:",
    meanAbsoluteDifference.toFixed(3),
    "m"
  );
}

console.log("\n=== VALIDATION COMPLETE ===\n");
