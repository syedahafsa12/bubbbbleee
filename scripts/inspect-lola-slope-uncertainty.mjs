import { fromFile } from "geotiff";

const filePath =
  "public/data/site04_shackleton_rim/Site04_final_adj_5mpp_slp.tif";

const tiff = await fromFile(filePath);
const image = await tiff.getImage();

const directory = image.getFileDirectory();
const geoKeys = image.getGeoKeys();
const tiePoints = await image.getTiePoints();

console.log("\n=== NASA LOLA SLOPE UNCERTAINTY INSPECTION ===\n");

console.log("Dimensions:", {
  width: image.getWidth(),
  height: image.getHeight(),
});

console.log("Bounding box:", image.getBoundingBox());
console.log("Origin:", image.getOrigin());
console.log("Resolution:", image.getResolution());
console.log("Tie points:", tiePoints);

console.log("\n=== TIFF METADATA ===\n");

console.log("Samples per pixel:", directory.SamplesPerPixel);
console.log("Sample format:", directory.SampleFormat);
console.log("Bits per sample:", directory.BitsPerSample);
console.log("NoData:", directory.GDAL_NODATA ?? "Not specified");

console.log("\n=== GEOGRAPHIC METADATA ===\n");

console.log({
  modelType: geoKeys.GTModelTypeGeoKey,
  rasterType: geoKeys.GTRasterTypeGeoKey,
  projectionMethod: geoKeys.ProjCoordTransGeoKey,
  linearUnits: geoKeys.ProjLinearUnitsGeoKey,
  centralMeridian: geoKeys.ProjStraightVertPoleLongGeoKey,
  latitudeOfOrigin: geoKeys.ProjNatOriginLatGeoKey,
});

console.log("\n=== INSPECTION COMPLETE ===\n");
