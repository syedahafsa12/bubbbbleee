import { fromFile } from "geotiff";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const TEMP_ROOT = await mkdtemp(path.join(os.tmpdir(), "lunapath-product78-"));

const SITES = [
  { archiveSite: "Site01", dataDirectory: "site01_connecting_ridge" },
  { archiveSite: "Site06", dataDirectory: "site06_nobile_rim_1" },
  { archiveSite: "Site07", dataDirectory: "site07_peak_near_shackleton" },
  { archiveSite: "Site11", dataDirectory: "site11_de_gerlache_rim" },
  { archiveSite: "Site20", dataDirectory: "site20_leibnitz_beta_plateau" },
  { archiveSite: "Site23", dataDirectory: "site23_malapert_massif" },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function prepareSite(site) {
  const fileName = `${site.archiveSite}_final_adj_5mpp_surf.tif`;
  const url = `https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/${site.archiveSite}/${fileName}`;
  const sourcePath = path.join(TEMP_ROOT, fileName);

  console.log(`\nDownloading ${site.archiveSite} Product78 LDEM...`);
  const response = await fetch(url, { redirect: "follow" });
  assert(response.ok, `${site.archiveSite} download failed: HTTP ${response.status}`);

  const contentType = response.headers.get("content-type") ?? "";
  assert(
    contentType.includes("image/tiff") || contentType.includes("application/octet-stream"),
    `${site.archiveSite} returned unexpected Content-Type: ${contentType}`
  );

  const sourceBytes = Buffer.from(await response.arrayBuffer());
  assert(sourceBytes.length > 16_384, `${site.archiveSite} response is too small to be a valid DEM.`);

  const signature = sourceBytes.subarray(0, 4).toString("hex").toLowerCase();
  assert(
    signature === "49492a00" || signature === "4d4d002a",
    `${site.archiveSite} response is not a TIFF (signature ${signature}).`
  );

  await writeFile(sourcePath, sourceBytes);

  const tiff = await fromFile(sourcePath);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const bbox = image.getBoundingBox();
  const resolution = image.getResolution();
  const origin = image.getOrigin();
  const geoKeys = image.getGeoKeys();

  assert(width > 0 && height > 0, `${site.archiveSite} has invalid dimensions.`);
  assert(geoKeys.GTRasterTypeGeoKey === 1, `${site.archiveSite} is not PixelIsArea.`);
  assert(geoKeys.ProjCoordTransGeoKey === 15, `${site.archiveSite} is not polar stereographic.`);
  assert(Math.abs(Math.abs(resolution[0]) - 5) < 0.001, `${site.archiveSite} X resolution is not 5 m.`);
  assert(Math.abs(Math.abs(resolution[1]) - 5) < 0.001, `${site.archiveSite} Y resolution is not 5 m.`);
  assert(
    Number.isFinite(origin[0]) &&
    Number.isFinite(origin[1]) &&
    Number.isFinite(geoKeys.GeogSemiMajorAxisGeoKey) &&
    Number.isFinite(geoKeys.ProjStraightVertPoleLongGeoKey),
    `${site.archiveSite} is missing required georeferencing tags.`
  );

  const noDataTag = image.getGDALNoData();
  const hasNaNNoDataTag = Number.isNaN(noDataTag);
  const rasters = await image.readRasters({ samples: [0] });
  const source = rasters[0];
  assert(source.length === width * height, `${site.archiveSite} raster dimensions do not match sample count.`);

  const outputDir = path.join(ROOT, "public", "data", site.dataDirectory);
  await mkdir(outputDir, { recursive: true });

  const elevationBuffer = Buffer.alloc(source.length * 4);
  let minElevation = Infinity;
  let maxElevation = -Infinity;
  let noDataPixelCount = 0;

  for (let index = 0; index < source.length; index++) {
    const value = source[index];

    if (Number.isNaN(value) && hasNaNNoDataTag) {
      noDataPixelCount++;
      elevationBuffer.writeFloatLE(Number.NaN, index * 4);
      continue;
    }

    if (!Number.isFinite(value)) {
      throw new Error(
        `${site.archiveSite} has undeclared/non-finite value at pixel ${index}; refusing conversion.`
      );
    }

    elevationBuffer.writeFloatLE(value, index * 4);
    minElevation = Math.min(minElevation, value);
    maxElevation = Math.max(maxElevation, value);
  }

  assert(Number.isFinite(minElevation) && Number.isFinite(maxElevation) && minElevation < maxElevation,
    `${site.archiveSite} has no usable finite elevation range.`);

  const metadata = {
    width,
    height,
    minElevation,
    maxElevation,
    resolutionMeters: Math.abs(resolution[0]),
    bbox,
    pixelResolution: [resolution[0], resolution[1], resolution[2] ?? 0],
    coordinateSystem: {
      projection: "South Polar Stereographic",
      referenceFrame: "MOON_ME",
      ephemeris: "DE421",
      linearUnits: "meters",
      pixelRegistration: "pixel area",
    },
    georeferencing: {
      tiePoint: { column: 0, row: 0, x: origin[0], y: origin[1] },
      centralMeridianDegrees: geoKeys.ProjStraightVertPoleLongGeoKey,
      lunarRadiusMeters: geoKeys.GeogSemiMajorAxisGeoKey,
    },
    dataType: "Float32",
    byteOrder: "little-endian",
    ...(hasNaNNoDataTag ? { noDataValue: "NaN", noDataPixelCount } : {}),
    source: {
      provider: "NASA PDS Geosciences Node / PGDA",
      product: "78",
      archiveSite: site.archiveSite,
      sourceFile: fileName,
      sourceUrl: url,
    },
  };

  await writeFile(path.join(outputDir, "elevation.bin"), elevationBuffer);
  await writeFile(
    path.join(outputDir, "metadata.json"),
    JSON.stringify(metadata, null, 2)
  );

  const savedMetadata = JSON.parse(
    await readFile(path.join(outputDir, "metadata.json"), "utf8")
  );
  const savedBinary = await readFile(path.join(outputDir, "elevation.bin"));
  assert(savedBinary.byteLength === width * height * 4, `${site.archiveSite} output binary size mismatch.`);
  assert(savedMetadata.width === width && savedMetadata.height === height, `${site.archiveSite} output metadata mismatch.`);

  console.log({
    site: site.archiveSite,
    dimensions: `${width} × ${height}`,
    resolutionMeters: metadata.resolutionMeters,
    bbox,
    elevationRangeMeters: [minElevation, maxElevation],
    noDataPixelCount,
    binaryMiB: Number((savedBinary.byteLength / 1024 / 1024).toFixed(2)),
    outputDir,
  });
}

try {
  for (const site of SITES) {
    await prepareSite(site);
  }

  console.log("\nAll six additional standard Product78 sites were converted successfully.");
  console.log("Original TIFF downloads were stored only in the OS temporary directory.");
} finally {
  await rm(TEMP_ROOT, { recursive: true, force: true });
}
