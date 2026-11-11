
import fs from "node:fs";
import { fromFile } from "geotiff";

const buffer = fs.readFileSync("scripts/Site04_final_adj.xyzi");

const RECORD_SIZE = 32;
const RECORD_COUNT = buffer.length / RECORD_SIZE;

const rasterPath =
  "public/data/site04_shackleton_rim/Site04_final_adj_5mpp_surf.tif";

const WIDTH = 3200;
const HEIGHT = 3200;

const ORIGIN_X = -9000;
const ORIGIN_Y = 1000;
const PIXEL_WIDTH = 5;
const PIXEL_HEIGHT = -5;

const targetX = -1000.0366057189;
const targetY = -7000.3455652705;

const MAX_DISTANCE_METERS = 1000;
const UNIT_SCALE = 1000;

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

  if (
    col0 < 0 ||
    row0 < 0 ||
    col0 + 1 >= WIDTH ||
    row0 + 1 >= HEIGHT
  ) {
    return null;
  }

  const dx = column - col0;
  const dy = row - row0;

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

let compared = 0;
let skipped = 0;
let sumAbsolute = 0;
let sumSquared = 0;
let sumSigned = 0;
let maximumAbsolute = 0;

const absoluteDifferences = [];

for (let i = 0; i < RECORD_COUNT; i++) {
  const offset = i * RECORD_SIZE;

  const x = buffer.readDoubleLE(offset) * UNIT_SCALE;
  const y = buffer.readDoubleLE(offset + 8) * UNIT_SCALE;
  const z = buffer.readDoubleLE(offset + 16) * UNIT_SCALE;

  const distance = Math.hypot(
    x - targetX,
    y - targetY
  );

  if (distance > MAX_DISTANCE_METERS) continue;

  const rasterElevation = sampleBilinear(x, y);

  if (rasterElevation === null) {
    skipped++;
    continue;
  }

  const difference = z - rasterElevation;
  const absolute = Math.abs(difference);

  compared++;
  sumAbsolute += absolute;
  sumSquared += difference * difference;
  sumSigned += difference;

  if (absolute > maximumAbsolute) {
    maximumAbsolute = absolute;
  }

  absoluteDifferences.push(absolute);
}

absoluteDifferences.sort((a, b) => a - b);

function percentile(sorted, p) {
  if (sorted.length === 0) return null;

  const index = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

console.log("\n=== EXPANDED NASA LOLA VALIDATION ===\n");

console.log("Total point-cloud records:", RECORD_COUNT);
console.log("Search radius:", MAX_DISTANCE_METERS, "m");
console.log("Points compared:", compared);
console.log("Points skipped:", skipped);

if (compared === 0) {
  throw new Error("No points could be compared.");
}

console.log("\n=== ELEVATION DIFFERENCE STATISTICS ===\n");

console.table({
  meanAbsoluteError_m: sumAbsolute / compared,
  rootMeanSquareError_m: Math.sqrt(sumSquared / compared),
  meanSignedError_m: sumSigned / compared,
  maximumAbsoluteError_m: maximumAbsolute,
  percentile95AbsoluteError_m: percentile(absoluteDifferences, 0.95),
  medianAbsoluteError_m: percentile(absoluteDifferences, 0.50),
});

console.log("\n=== VALIDATION COMPLETE ===\n");
