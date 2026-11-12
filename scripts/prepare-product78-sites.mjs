import { fromFile } from "geotiff";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const TEMP_ROOT = await mkdtemp(path.join(os.tmpdir(), "lunapath-product78-"));

const ALL_SITES = [
  { archiveSite: "Site01", dataDirectory: "site01_connecting_ridge" },
  { archiveSite: "Site06", dataDirectory: "site06_nobile_rim_1" },
  { archiveSite: "Site07", dataDirectory: "site07_peak_near_shackleton" },
  { archiveSite: "Site11", dataDirectory: "site11_de_gerlache_rim" },
  { archiveSite: "Site20", dataDirectory: "site20_leibnitz_beta_plateau" },
  { archiveSite: "Site23", dataDirectory: "site23_malapert_massif" },
  { archiveSite: "Site20v2", dataDirectory: "site20v2_leibnitz_beta_plateau_extended" },
  { archiveSite: "Site42", dataDirectory: "site42_de_gerlache_kocher_massif" },
  { archiveSite: "Haworth", dataDirectory: "haworth" },
  { archiveSite: "Shoemaker", dataDirectory: "shoemaker" },
  { archiveSite: "DM1", dataDirectory: "dm1_amundsen_rim" },
  { archiveSite: "DM2", dataDirectory: "dm2_nobile_rim_2" },
  { archiveSite: "SL2", dataDirectory: "sl2_de_gerlache_rim_2" },
  { archiveSite: "SL3", dataDirectory: "sl3_connecting_ridge_extension" },
  { archiveSite: "NPA", dataDirectory: "npa_cabeus_exterior_wall_1" },
  { archiveSite: "NPB", dataDirectory: "npb_amundsen_1" },
  { archiveSite: "NPC", dataDirectory: "npc_idelson_l_crater_1" },
  { archiveSite: "NPD", dataDirectory: "npd_malapert_crater_1" },
  { archiveSite: "LM1", dataDirectory: "lm1_shackleton_rim_b" },
  { archiveSite: "LM2", dataDirectory: "lm2_shoemaker_rim_a" },
  { archiveSite: "LM3", dataDirectory: "lm3_shoemaker_rim_b" },
  { archiveSite: "LM4", dataDirectory: "lm4_shoemaker_rim_c" },
  { archiveSite: "LM5", dataDirectory: "lm5_shoemaker_rim_d" },
  { archiveSite: "LM6", dataDirectory: "lm6_shoemaker_rim_e" },
  { archiveSite: "LM7", dataDirectory: "lm7_faustini_rim_a" },
  { archiveSite: "LM8", dataDirectory: "lm8_shoemaker_rim_f" },
];

const DEFAULT_SITES = ALL_SITES.filter((site) =>
  ["Site01", "Site06", "Site07", "Site11", "Site20", "Site23"].includes(site.archiveSite)
);

const requestedSites = process.argv.slice(2);
const selectedSites =
  requestedSites.length === 0
    ? DEFAULT_SITES
    : requestedSites.includes("--all")
      ? ALL_SITES
      : ALL_SITES.filter((site) =>
          requestedSites.includes(site.archiveSite) ||
          requestedSites.includes(site.dataDirectory)
        );

const unknownSiteArguments = requestedSites.filter(
  (argument) =>
    argument !== "--all" &&
    !ALL_SITES.some(
      (site) =>
        site.archiveSite === argument ||
        site.dataDirectory === argument
    )
);

if (unknownSiteArguments.length > 0) {
  throw new Error(
    `Unknown Product78 site argument(s): ${unknownSiteArguments.join(", ")}. Use an archive site code (e.g. Site11), a data directory ID, or --all.`
  );
}

assert(
  selectedSites.length > 0,
  "No Product78 sites selected. Pass --all or one or more archive site codes."
);

console.log(
  `Preparing ${selectedSites.length} Product78 site(s): ${selectedSites.map((site) => site.archiveSite).join(", ")}`
);

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
  const samplesPerPixel = image.getSamplesPerPixel();
  const sampleFormat = image.getSampleFormat(0);
  const bitsPerSample = image.getBitsPerSample(0);

  assert(width > 0 && height > 0, `${site.archiveSite} has invalid dimensions.`);
  assert(samplesPerPixel === 1, `${site.archiveSite} must contain exactly one elevation band.`);
  assert(
    sampleFormat === 3 && bitsPerSample === 32,
    `${site.archiveSite} must be single-band Float32 (SampleFormat=3, BitsPerSample=32).`
  );
  assert(
    geoKeys.GTModelTypeGeoKey === undefined || geoKeys.GTModelTypeGeoKey === 1,
    `${site.archiveSite} does not use projected coordinates.`
  );
  assert(geoKeys.GTRasterTypeGeoKey === 1, `${site.archiveSite} is not PixelIsArea.`);
  assert(
    geoKeys.ProjLinearUnitsGeoKey === undefined || geoKeys.ProjLinearUnitsGeoKey === 9001,
    `${site.archiveSite} projected coordinates are not in metres.`
  );
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
  const hasDeclaredNoData =
    typeof noDataTag === "number" &&
    (Number.isNaN(noDataTag) || Number.isFinite(noDataTag));
  const normalizedNoDataValue =
    Number.isNaN(noDataTag) ? "NaN" : noDataTag;
  const isDeclaredNoData = (value) => {
    if (!hasDeclaredNoData) return false;
    return normalizedNoDataValue === "NaN"
      ? Number.isNaN(value)
      : value === normalizedNoDataValue;
  };

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

    if (isDeclaredNoData(value)) {
      noDataPixelCount++;
      // Normalize every declared NoData sentinel to IEEE NaN in the binary.
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
    ...(hasDeclaredNoData
      ? { noDataValue: "NaN", noDataPixelCount }
      : {}),
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
  for (const site of selectedSites) {
    await prepareSite(site);
  }

  console.log(`\nAll ${selectedSites.length} selected Product78 site(s) were converted successfully.`);
  console.log("Original TIFF downloads were stored only in the OS temporary directory.");
} finally {
  await rm(TEMP_ROOT, { recursive: true, force: true });
}
