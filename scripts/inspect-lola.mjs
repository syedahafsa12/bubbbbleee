
import { fromFile } from "geotiff";
import path from "node:path";

const filePath = path.resolve(
  process.cwd(),
  "public/data/site04_shackleton_rim/Site04_final_adj_5mpp_surf.tif"
);

const tiff = await fromFile(filePath);
const image = await tiff.getImage();

const width = image.getWidth();
const height = image.getHeight();

const bbox = image.getBoundingBox();
const resolution = image.getResolution();

// Resolve tie points before inspecting them
const tiePoints = await image.getTiePoints();

const geoKeys = image.getGeoKeys();

const raster = await image.readRasters({ samples: [0] });
const elevations = raster[0];

let minElevation = Infinity;
let maxElevation = -Infinity;
let validCount = 0;

for (const value of elevations) {
  if (Number.isFinite(value)) {
    minElevation = Math.min(minElevation, value);
    maxElevation = Math.max(maxElevation, value);
    validCount++;
  }
}

console.log(
  JSON.stringify(
    {
      width,
      height,
      bbox,
      resolution,
      tiePoints,
      geoKeys,
      minElevation,
      maxElevation,
      validCount,
      totalPixels: width * height,
    },
    null,
    2
  )
);
