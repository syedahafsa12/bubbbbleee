
import { fromFile } from "geotiff";

const inputPath =
  "public/data/site04_shackleton_rim/Site04_final_adj_5mpp_surf.tif";

const tiff = await fromFile(inputPath);
const image = await tiff.getImage();

const directory = image.fileDirectory;

function readTag(name) {
  try {
    return directory.getValue(name) ?? null;
  } catch (error) {
    return `Unavailable: ${error.message}`;
  }
}

console.log("\n=== ORIGINAL NASA LOLA GEOTIFF ===");

console.log({
  width: image.getWidth(),
  height: image.getHeight()
});

console.log("\n=== RAW TIFF TAGS ===");

console.log({
  ModelTiepoint: readTag("ModelTiepoint"),
  ModelPixelScale: readTag("ModelPixelScale"),
  ModelTransformation: readTag("ModelTransformation")
});

console.log("\n=== PARSED TIE POINTS ===");

try {
  const tiePoints = await image.getTiePoints();
  console.dir(tiePoints, { depth: null });
} catch (error) {
  console.log("Tie point inspection failed:", error.message);
}

console.log("\n=== GEOTIFF COORDINATE METADATA ===");

console.log({
  geoKeys: image.getGeoKeys(),
  boundingBox: image.getBoundingBox(),
  origin: image.getOrigin(),
  resolution: image.getResolution()
});

console.log("\n=== END ===");
