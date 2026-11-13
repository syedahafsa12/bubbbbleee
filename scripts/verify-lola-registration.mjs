
import { fromFile } from "geotiff";
import path from "node:path";

const filePath = path.join(
  process.cwd(),
  "public/data/site04_shackleton_rim/Site04_final_adj_5mpp_surf.tif"
);

const tiff = await fromFile(filePath);
const image = await tiff.getImage();

const directory = image.getFileDirectory();
const geoKeys = image.getGeoKeys();

console.log("\n=== ORIGINAL NASA LOLA GEOTIFF ===");

console.log("Dimensions:", {
  width: image.getWidth(),
  height: image.getHeight()
});

console.log("\n=== RAW GEOREFERENCING TAGS ===");

console.log("ModelTiepoint:", directory.ModelTiepoint);
console.log("ModelPixelScale:", directory.ModelPixelScale);
console.log("ModelTransformation:", directory.ModelTransformation);

console.log("\n=== GEOTIFF COORDINATE METADATA ===");

console.log("Raster type:", geoKeys.GTRasterTypeGeoKey);
console.log("Projection method:", geoKeys.ProjCoordTransGeoKey);
console.log("Origin latitude:", geoKeys.ProjNatOriginLatGeoKey);
console.log("Central meridian:", geoKeys.ProjStraightVertPoleLongGeoKey);
console.log("Lunar radius:", geoKeys.GeogSemiMajorAxisGeoKey);

console.log("\n=== LIBRARY INTERPRETATION ===");

console.log("Bounding box:", image.getBoundingBox());
console.log("Origin:", image.getOrigin());
console.log("Resolution:", image.getResolution());

console.log("\n=== REGISTRATION INTERPRETATION ===");

if (geoKeys.GTRasterTypeGeoKey === 1) {
  console.log("GeoTIFF declares PixelIsArea.");
  console.log("The tie point describes the outer pixel corner.");
  console.log("Pixel centres are offset by half a pixel.");
} else if (geoKeys.GTRasterTypeGeoKey === 2) {
  console.log("GeoTIFF declares PixelIsPoint.");
  console.log("The tie point represents a pixel centre.");
} else {
  console.log("Raster registration is undefined or unexpected.");
}

console.log("\n=== END ===");
