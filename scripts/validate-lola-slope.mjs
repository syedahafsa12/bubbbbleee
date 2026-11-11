import { fromFile } from "geotiff";

const filePath =
  "public/data/site04_shackleton_rim/Site04_final_adj_5mpp_slp.tif";

const latitude = -89.7668;
const longitude = 188.13;

const radius = 1737400;
const centralMeridian = 0;

const tiff = await fromFile(filePath);
const image = await tiff.getImage();

// Convert lunar coordinates to south-polar stereographic coordinates.
const latitudeFromSouthPole = ((90 + latitude) * Math.PI) / 180;
const longitudeDifference =
  ((longitude - centralMeridian) * Math.PI) / 180;

const rho =
  2 * radius * Math.tan(latitudeFromSouthPole / 2);

const xMeters = rho * Math.sin(longitudeDifference);
const yMeters = rho * Math.cos(longitudeDifference);

// Convert projected coordinates to raster pixel coordinates.
// The -0.5 correction accounts for PixelIsArea.
const origin = image.getOrigin();
const resolution = image.getResolution();

const column = (xMeters - origin[0]) / resolution[0] - 0.5;
const row = (yMeters - origin[1]) / resolution[1] - 0.5;

const col0 = Math.floor(column);
const row0 = Math.floor(row);

// Read the four surrounding pixels.
const raster = await image.readRasters({
  window: [col0, row0, col0 + 2, row0 + 2],
});

const values = [
  { pixel: `(${col0}, ${row0})`, value: Number(raster[0][0]) },
  { pixel: `(${col0 + 1}, ${row0})`, value: Number(raster[0][1]) },
  { pixel: `(${col0}, ${row0 + 1})`, value: Number(raster[0][2]) },
  { pixel: `(${col0 + 1}, ${row0 + 1})`, value: Number(raster[0][3]) },
];

const dx = column - col0;
const dy = row - row0;

const [v00, v10, v01, v11] = values.map((item) => item.value);

const allValid = values.every(
  (item) => Number.isFinite(item.value)
);

let interpolatedSlope = null;

if (allValid) {
  interpolatedSlope =
    v00 * (1 - dx) * (1 - dy) +
    v10 * dx * (1 - dy) +
    v01 * (1 - dx) * dy +
    v11 * dx * dy;
}

console.log("\n=== NASA LOLA SLOPE VALIDATION ===\n");

console.log("Observation point:", { latitude, longitude });
console.log("Projected coordinates:", { xMeters, yMeters });
console.log("Fractional pixel:", { column, row });

console.log("\n=== FOUR SURROUNDING PIXELS ===\n");

for (const item of values) {
  console.log(`${item.pixel}: ${item.value}`);
}

console.log("\n=== VALIDATION RESULT ===\n");

console.log("All four values finite:", allValid);
console.log("Bilinear interpolated value:", interpolatedSlope);

console.log("\n=== VALIDATION COMPLETE ===\n");