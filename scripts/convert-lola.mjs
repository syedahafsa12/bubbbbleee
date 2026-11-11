
import { fromFile } from "geotiff";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

const inputPath = path.join(
  root,
  "public/data/site04_shackleton_rim/Site04_final_adj_5mpp_surf.tif"
);

const outputDir = path.join(
  root,
  "public/data/site04_shackleton_rim"
);

console.log("Reading original NASA LOLA GeoTIFF...");

const tiff = await fromFile(inputPath);
const image = await tiff.getImage();

const width = image.getWidth();
const height = image.getHeight();
const bbox = image.getBoundingBox();
const resolution = image.getResolution();
const origin = image.getOrigin();
const geoKeys = image.getGeoKeys();

const requiredValues = {
  originX: origin?.[0],
  originY: origin?.[1],
  pixelWidth: resolution?.[0],
  pixelHeight: resolution?.[1],
  lunarRadius: geoKeys.GeogSemiMajorAxisGeoKey,
  centralMeridian: geoKeys.ProjStraightVertPoleLongGeoKey,
};

for (const [name, value] of Object.entries(requiredValues)) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing or invalid GeoTIFF value: ${name}`);
  }
}

if (geoKeys.GTRasterTypeGeoKey !== 1) {
  throw new Error("Expected PixelIsArea raster registration.");
}

if (geoKeys.ProjCoordTransGeoKey !== 15) {
  throw new Error("Unexpected projection method.");
}

const rasters = await image.readRasters({ samples: [0] });
const sourceElevations = rasters[0];

if (sourceElevations.length !== width * height) {
  throw new Error("Raster dimensions do not match elevation data.");
}

const elevationBuffer = Buffer.alloc(sourceElevations.length * 4);

let minElevation = Infinity;
let maxElevation = -Infinity;

for (let i = 0; i < sourceElevations.length; i++) {
  const value = sourceElevations[i];

  if (!Number.isFinite(value)) {
    throw new Error(`Invalid elevation at index ${i}.`);
  }

  elevationBuffer.writeFloatLE(value, i * 4);

  minElevation = Math.min(minElevation, value);
  maxElevation = Math.max(maxElevation, value);
}

await mkdir(outputDir, { recursive: true });

await writeFile(
  path.join(outputDir, "elevation.bin"),
  elevationBuffer
);

const metadata = {
  width,
  height,
  minElevation,
  maxElevation,
  resolutionMeters: Math.abs(resolution[0]),
  bbox,
  pixelResolution: resolution,

  coordinateSystem: {
    projection: "South Polar Stereographic",
    referenceFrame: "MOON_ME",
    ephemeris: "DE421",
    linearUnits: "meters",
    pixelRegistration: "pixel area"
  },

  georeferencing: {
    tiePoint: {
      column: 0,
      row: 0,
      x: origin[0],
      y: origin[1]
    },
    centralMeridianDegrees:
      geoKeys.ProjStraightVertPoleLongGeoKey,
    lunarRadiusMeters:
      geoKeys.GeogSemiMajorAxisGeoKey
  },

  dataType: "Float32",
  byteOrder: "little-endian"
};

const metadataPath = path.join(outputDir, "metadata.json");

await writeFile(
  metadataPath,
  JSON.stringify(metadata, null, 2)
);

// Read back the actual file to verify the saved structure.
const savedMetadata = JSON.parse(
  await (await import("node:fs/promises")).readFile(metadataPath, "utf8")
);

if (!savedMetadata.georeferencing?.tiePoint) {
  throw new Error("Saved metadata is missing georeferencing.tiePoint.");
}

console.log("\nConversion and metadata validation successful.");

console.log({
  dimensions: `${width} x ${height}`,
  rasterType: "PixelIsArea",
  origin,
  resolution,
  georeferencing: savedMetadata.georeferencing,
  elevationRange: `${minElevation.toFixed(2)} m to ${maxElevation.toFixed(2)} m`,
  binarySizeMB: (elevationBuffer.byteLength / 1024 / 1024).toFixed(2)
});
