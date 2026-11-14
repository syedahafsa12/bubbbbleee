
import { fromFile } from "geotiff";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

const DATA_DIR = path.join(
  ROOT,
  "public",
  "data",
  "site04_shackleton_rim"
);

const BASE_METADATA_PATH = path.join(
  DATA_DIR,
  "metadata.json"
);

const BASE_SURFACE_TIFF = path.join(
  DATA_DIR,
  "Site04_final_adj_5mpp_surf.tif"
);

const LAYERS = [
  {
    key: "slope",
    source: "Site04_final_adj_5mpp_slp.tif",
    output: "slope.bin",
    description: "NASA Product 78 slope in degrees",
  },
  {
    key: "slopeUncertainty",
    source: "Site04_final_adj_5mpp_slperr.tif",
    output: "slope-uncertainty.bin",
    description: "NASA RMS slope uncertainty in degrees",
  },
  {
    key: "elevationUncertainty",
    source: "Site04_final_adj_5mpp_toterr.tif",
    output: "elevation-uncertainty.bin",
    description: "NASA RMS elevation uncertainty in metres",
  },
  {
    key: "observationCount",
    source: "Site04_final_adj_5mpp_ldec.tif",
    output: "observation-count.bin",
    description: "Number of LOLA observations contributing to each pixel",
  },
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function approximatelyEqual(a, b, tolerance = 0.001) {
  return (
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.abs(a - b) <= tolerance
  );
}

function validateSameGrid(
  image,
  reference,
  metadata,
  filename
) {
  const width = image.getWidth();
  const height = image.getHeight();

  assert(
    width === reference.width &&
      height === reference.height,
    `${filename}: raster dimensions do not match the reference DEM.`
  );

  const bbox = image.getBoundingBox();
  const resolution = image.getResolution();
  const origin = image.getOrigin();

  for (let i = 0; i < 4; i++) {
    assert(
      approximatelyEqual(
        bbox[i],
        reference.bbox[i]
      ),
      `${filename}: bounding box differs from the reference DEM.`
    );
  }

  assert(
    approximatelyEqual(
      resolution[0],
      reference.pixelResolution[0]
    ) &&
      approximatelyEqual(
        resolution[1],
        reference.pixelResolution[1]
      ),
    `${filename}: pixel resolution or orientation differs from the reference DEM.`
  );

  assert(
    approximatelyEqual(
      origin[0],
      metadata.georeferencing.tiePoint.x
    ) &&
      approximatelyEqual(
        origin[1],
        metadata.georeferencing.tiePoint.y
      ),
    `${filename}: georeferencing origin differs from metadata.json.`
  );

  const geoKeys = image.getGeoKeys();

  assert(
    geoKeys.GTRasterTypeGeoKey === 1,
    `${filename}: expected PixelIsArea registration.`
  );

  assert(
    geoKeys.ProjCoordTransGeoKey === 15,
    `${filename}: expected polar stereographic projection.`
  );

  assert(
    geoKeys.ProjLinearUnitsGeoKey === undefined ||
      geoKeys.ProjLinearUnitsGeoKey === 9001,
    `${filename}: expected metre-based projected coordinates.`
  );

  assert(
    image.getSamplesPerPixel() === 1,
    `${filename}: expected exactly one raster band.`
  );
}

async function readReference(metadata) {
  const tiff = await fromFile(BASE_SURFACE_TIFF);
  const image = await tiff.getImage();

  const reference = {
    width: image.getWidth(),
    height: image.getHeight(),
    bbox: image.getBoundingBox(),
    pixelResolution: image.getResolution(),
  };

  assert(
    reference.width === metadata.width &&
      reference.height === metadata.height,
    "Reference TIFF dimensions disagree with metadata.json."
  );

  assert(
    approximatelyEqual(
      reference.pixelResolution[0],
      metadata.pixelResolution[0]
    ) &&
      approximatelyEqual(
        reference.pixelResolution[1],
        metadata.pixelResolution[1]
      ),
    "Reference TIFF pixel resolution disagrees with metadata.json."
  );

  return reference;
}

function isNoData(value, noDataValue) {
  if (!Number.isFinite(value)) {
    return true;
  }

  if (typeof noDataValue !== "number") {
    return false;
  }

  if (Number.isNaN(noDataValue)) {
    return Number.isNaN(value);
  }

  return value === Math.fround(noDataValue);
}

async function convertLayer(
  layer,
  reference,
  metadata
) {
  const sourcePath = path.join(
    DATA_DIR,
    layer.source
  );

  const tiff = await fromFile(sourcePath);
  const image = await tiff.getImage();

  validateSameGrid(
    image,
    reference,
    metadata,
    layer.source
  );

  const noDataValue = image.getGDALNoData();

  const rasterResult = await image.readRasters({
    samples: [0],
  });

  const source = rasterResult[0];

  assert(
    source.length === reference.width * reference.height,
    `${layer.source}: invalid raster sample count.`
  );

  const output = Buffer.alloc(source.length * 4);

  let minimum = Infinity;
  let maximum = -Infinity;
  let noDataCount = 0;

  for (let index = 0; index < source.length; index++) {
    const value = Number(source[index]);
    const offset = index * 4;

    if (isNoData(value, noDataValue)) {
      output.writeFloatLE(Number.NaN, offset);
      noDataCount++;
      continue;
    }

    assert(
      Number.isFinite(value),
      `${layer.source}: invalid value at pixel ${index}.`
    );

    output.writeFloatLE(value, offset);

    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }

  assert(
    Number.isFinite(minimum) &&
      Number.isFinite(maximum),
    `${layer.source}: no valid raster values found.`
  );

  const outputPath = path.join(
    DATA_DIR,
    layer.output
  );

  await writeFile(outputPath, output);

  const saved = await readFile(outputPath);

  assert(
    saved.byteLength === reference.width * reference.height * 4,
    `${layer.output}: output size verification failed.`
  );

  return {
    key: layer.key,
    source: layer.source,
    output: layer.output,
    description: layer.description,
    minimum,
    maximum,
    noDataCount,
    byteLength: saved.byteLength,
  };
}

async function main() {
  const metadata = JSON.parse(
    await readFile(BASE_METADATA_PATH, "utf8")
  );

  assert(
    metadata.width === 3200 &&
      metadata.height === 3200 &&
      metadata.resolutionMeters === 5,
    "Unexpected Site04 Product 78 raster dimensions or resolution."
  );

  assert(
    metadata.coordinateSystem?.referenceFrame === "MOON_ME" &&
      metadata.coordinateSystem?.ephemeris === "DE421",
    "Unexpected lunar reference frame or ephemeris."
  );

  const reference = await readReference(metadata);

  const results = [];

  for (const layer of LAYERS) {
    console.log(`Converting ${layer.source}...`);

    results.push(
      await convertLayer(
        layer,
        reference,
        metadata
      )
    );
  }

  const scienceMetadata = {
    product: "NASA LOLA Product 78",
    archiveSite: "Site04",
    siteName: "Shackleton Rim",
    dimensions: {
      width: reference.width,
      height: reference.height,
    },
    resolutionMeters: 5,
    coordinateSystem: metadata.coordinateSystem,
    georeferencing: metadata.georeferencing,
    pixelResolution: metadata.pixelResolution,
    bbox: metadata.bbox,
    dataType: "Float32",
    byteOrder: "little-endian",
    layers: results,
    sourceDirectory:
      "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site04/",
  };

  await writeFile(
    path.join(DATA_DIR, "science-metadata.json"),
    JSON.stringify(scienceMetadata, null, 2)
  );

  console.log("\nNASA science-layer conversion complete.");
  console.table(
    results.map((result) => ({
      layer: result.key,
      min: result.minimum,
      max: result.maximum,
      noData: result.noDataCount,
      MB: (
        result.byteLength /
        1024 /
        1024
      ).toFixed(2),
    }))
  );
}

main().catch((error) => {
  console.error("\nSCIENCE DATA CONVERSION FAILED");
  console.error(error);
  process.exitCode = 1;
});
