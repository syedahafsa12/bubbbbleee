import { fromFile } from "geotiff";

const filePath =
  "public/data/site04_shackleton_rim/Site04_final_adj_5mpp_slperr.tif";

const latitude = -89.7668;
const longitude = 188.13;

const radius = 1737400;
const centralMeridian = 0;

const tiff = await fromFile(filePath);
const image = await tiff.getImage();

const latitudeFromSouthPole = ((90 + latitude) * Math.PI) / 180;
const longitudeDifference =
  ((longitude - centralMeridian) * Math.PI) / 180;

const rho =
  2 * radius * Math.tan(latitudeFromSouthPole / 2);

const xMeters = rho * Math.sin(longitudeDifference);
const yMeters = rho * Math.cos(longitudeDifference);

const origin = image.getOrigin();
const resolution = image.getResolution();

const column =
  (xMeters - origin[0]) / resolution[0] - 0.5;

const row =
  (yMeters - origin[1]) / resolution[1] - 0.5;

const col0 = Math.floor(column);
const row0 = Math.floor(row);

const raster = await image.readRasters({
  window: [col0, row0, col0 + 2, row0 + 2],
});

const values = [
  Number(raster[0][0]),
  Number(raster[0][1]),
  Number(raster[0][2]),
  Number(raster[0][3]),
];

const dx = column - col0;
const dy = row - row0;

const [v00, v10, v01, v11] = values;

const allValid = values.every(
  (value) => Number.isFinite(value) && value >= 0
);

const interpolated = allValid
  ? v00 * (1 - dx) * (1 - dy) +
    v10 * dx * (1 - dy) +
    v01 * (1 - dx) * dy +
    v11 * dx * dy
  : null;

console.log("\n=== NASA LOLA SLOPE UNCERTAINTY ===\n");

console.log("Observation:", { latitude, longitude });
console.log("Fractional pixel:", { column, row });

console.log("\nFour surrounding pixels:");
console.log(`(${col0}, ${row0}):`, values[0]);
console.log(`(${col0 + 1}, ${row0}):`, values[1]);
console.log(`(${col0}, ${row0 + 1}):`, values[2]);
console.log(`(${col0 + 1}, ${row0 + 1}):`, values[3]);

console.log("\n=== RESULT ===\n");
console.log("All values finite and non-negative:", allValid);
console.log("Interpolated uncertainty:", interpolated);

console.log("\n=== VALIDATION COMPLETE ===\n");