
import { fromFile } from "geotiff";

const filePath =
  "public/data/site04_shackleton_rim/Site04_final_adj_5mpp_toterr.tif";

const tiff = await fromFile(filePath);
const image = await tiff.getImage();

const directory = image.getFileDirectory();
const geoKeys = image.getGeoKeys();
const tiePoints = await image.getTiePoints();

console.log("\n=== NASA LOLA UNCERTAINTY RASTER ===\n");

console.log("Dimensions:", {
  width: image.getWidth(),
  height: image.getHeight(),
});

console.log("Bounding box:", image.getBoundingBox());
console.log("Origin:", image.getOrigin());
console.log("Resolution:", image.getResolution());

console.log("\n=== RAW TIFF TAGS ===\n");

console.log("ModelTiepoint:", directory.getValue("ModelTiepoint"));
console.log("ModelPixelScale:", directory.getValue("ModelPixelScale"));
console.log("ModelTransformation:", directory.getValue("ModelTransformation"));

console.log("\n=== GEOREFERENCING ===\n");

console.log("Parsed tie points:", tiePoints);
console.log("GeoKeys:", geoKeys);

console.log("\n=== RASTER DATA TYPE ===\n");

console.log("Samples per pixel:", image.getSamplesPerPixel());
console.log("Sample format:", directory.getValue("SampleFormat"));
console.log("Bits per sample:", directory.getValue("BitsPerSample"));

console.log("\nInspection complete.");
