
import { fromFile } from "geotiff";

const filePath =
  "public/data/site04_shackleton_rim/Site04_final_adj_5mpp_toterr.tif";

const tiff = await fromFile(filePath);
const image = await tiff.getImage();

const width = image.getWidth();
const height = image.getHeight();

const raster = await image.readRasters({ interleave: true });

const column = 1599.4926788562125;
const row = 1599.5691130540986;

const x0 = Math.floor(column);
const y0 = Math.floor(row);
const x1 = x0 + 1;
const y1 = y0 + 1;

function getValue(x, y) {
  return raster[y * width + x];
}

const v00 = getValue(x0, y0);
const v10 = getValue(x1, y0);
const v01 = getValue(x0, y1);
const v11 = getValue(x1, y1);

const dx = column - x0;
const dy = row - y0;

const top = v00 * (1 - dx) + v10 * dx;
const bottom = v01 * (1 - dx) + v11 * dx;

const interpolated = top * (1 - dy) + bottom * dy;

console.log("\n=== NASA LOLA POINT UNCERTAINTY ===\n");

console.log("Raster dimensions:", `${width} x ${height}`);
console.log("Sample column:", column);
console.log("Sample row:", row);

console.log("\n=== FOUR SURROUNDING PIXELS ===\n");

console.log(`(${x0}, ${y0}):`, v00);
console.log(`(${x1}, ${y0}):`, v10);
console.log(`(${x0}, ${y1}):`, v01);
console.log(`(${x1}, ${y1}):`, v11);

console.log("\n=== BILINEAR INTERPOLATION ===\n");

console.log("Interpolated uncertainty:", interpolated);

console.log("\n=== VALIDATION ===\n");

console.log(
  "All four values finite:",
  [v00, v10, v01, v11].every(Number.isFinite)
);

console.log(
  "All four values non-negative:",
  [v00, v10, v01, v11].every(
    (value) => Number.isFinite(value) && value >= 0
  )
);
