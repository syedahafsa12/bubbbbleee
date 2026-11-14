    import {
  DEFAULT_PRODUCT78_SITE_ID,
  getProduct78Site,
  type Product78SiteId,
} from "./siteRegistry";
import type { LolaTerrainData } from "./terrainData";

export interface LolaScienceLayerMetadata {
  key: string;
  source: string;
  output: string;
  description: string;
  minimum: number;
  maximum: number;
  noDataCount: number;
  byteLength: number;
}

export interface LolaScienceMetadata {
  product: string;
  archiveSite: string;
  siteName: string;
  dimensions: {
    width: number;
    height: number;
  };
  resolutionMeters: number;
  bbox: [number, number, number, number];
  pixelResolution: [number, number, number];
  georeferencing: {
    tiePoint: { column: number; row: number; x: number; y: number };
    centralMeridianDegrees: number;
    lunarRadiusMeters: number;
  };
  coordinateSystem: {
    projection: string;
    referenceFrame: string;
    ephemeris: string;
    linearUnits: string;
    pixelRegistration: string;
  };
  dataType: string;
  byteOrder: string;
  layers: LolaScienceLayerMetadata[];
}

export interface LolaScienceData {
  metadata: LolaScienceMetadata;
  slope: Float32Array;
  slopeUncertainty: Float32Array;
  elevationUncertainty: Float32Array;
  observationCount: Float32Array;
}

interface ExpectedLayer {
  output: string;
  description: string;
}

const EXPECTED_LAYERS = {
  slope: {
    output: "slope.bin",
    description: "NASA Product 78 slope in degrees",
  },
  slopeUncertainty: {
    output: "slope-uncertainty.bin",
    description: "NASA RMS slope uncertainty in degrees",
  },
  elevationUncertainty: {
    output: "elevation-uncertainty.bin",
    description: "NASA RMS elevation uncertainty in metres",
  },
  observationCount: {
    output: "observation-count.bin",
    description: "Number of LOLA observations contributing to each pixel",
  },
} satisfies Record<string, ExpectedLayer>;

type ScienceLayerKey = keyof typeof EXPECTED_LAYERS;

const sciencePromises = new Map<
  Product78SiteId,
  Promise<LolaScienceData>
>();

const FLOAT_RANGE_TOLERANCE = 1e-4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`NASA science metadata: ${name} is missing or invalid.`);
  }
  return value.trim();
}

function requireFiniteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`NASA science metadata: ${name} is missing or invalid.`);
  }
  return value;
}

function validateScienceMetadata(
  raw: unknown,
  siteId: Product78SiteId,
  expectedTerrain?: LolaTerrainData
): LolaScienceMetadata {
  if (!isRecord(raw)) {
    throw new Error("NASA science metadata is not a valid JSON object.");
  }

  const site = getProduct78Site(siteId);
  const dimensions = raw.dimensions;
  const coordinateSystem = raw.coordinateSystem;
  const georeferencing = raw.georeferencing;

  if (
    !isRecord(dimensions) ||
    !isRecord(coordinateSystem) ||
    !isRecord(georeferencing) ||
    !isRecord(georeferencing.tiePoint)
  ) {
    throw new Error(
      "NASA science metadata is missing dimensions, coordinate system or georeferencing."
    );
  }

  const width = requireFiniteNumber(dimensions.width, "dimensions.width");
  const height = requireFiniteNumber(dimensions.height, "dimensions.height");

  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("NASA science raster dimensions must be positive integers.");
  }

  if (
    expectedTerrain &&
    (width !== expectedTerrain.width || height !== expectedTerrain.height)
  ) {
    throw new Error(
      `Science raster dimensions ${width}x${height} do not match elevation raster ${expectedTerrain.width}x${expectedTerrain.height}.`
    );
  }

  const product = requireString(raw.product, "product");
  const archiveSite = requireString(raw.archiveSite, "archiveSite");
  const siteName = requireString(raw.siteName, "siteName");
  const resolutionMeters = requireFiniteNumber(
    raw.resolutionMeters,
    "resolutionMeters"
  );
  const dataType = requireString(raw.dataType, "dataType");
  const byteOrder = requireString(raw.byteOrder, "byteOrder");

  const projection = requireString(
    coordinateSystem.projection,
    "coordinateSystem.projection"
  );
  const referenceFrame = requireString(
    coordinateSystem.referenceFrame,
    "coordinateSystem.referenceFrame"
  );
  const ephemeris = requireString(
    coordinateSystem.ephemeris,
    "coordinateSystem.ephemeris"
  );
  const linearUnits = requireString(
    coordinateSystem.linearUnits,
    "coordinateSystem.linearUnits"
  );
  const pixelRegistration = requireString(
    coordinateSystem.pixelRegistration,
    "coordinateSystem.pixelRegistration"
  );

  if (!Array.isArray(raw.bbox) || raw.bbox.length !== 4) {
    throw new Error("NASA science metadata bbox must contain four numbers.");
  }
  if (!Array.isArray(raw.pixelResolution) || raw.pixelResolution.length < 2) {
    throw new Error("NASA science metadata pixelResolution is invalid.");
  }

  const bbox: [number, number, number, number] = [
    requireFiniteNumber(raw.bbox[0], "bbox[0]"),
    requireFiniteNumber(raw.bbox[1], "bbox[1]"),
    requireFiniteNumber(raw.bbox[2], "bbox[2]"),
    requireFiniteNumber(raw.bbox[3], "bbox[3]"),
  ];

  const pixelResolution: [number, number, number] = [
    requireFiniteNumber(raw.pixelResolution[0], "pixelResolution[0]"),
    requireFiniteNumber(raw.pixelResolution[1], "pixelResolution[1]"),
    raw.pixelResolution[2] === undefined
      ? 0
      : requireFiniteNumber(raw.pixelResolution[2], "pixelResolution[2]"),
  ];

  const tiePoint = {
    column: requireFiniteNumber(
      georeferencing.tiePoint.column,
      "georeferencing.tiePoint.column"
    ),
    row: requireFiniteNumber(
      georeferencing.tiePoint.row,
      "georeferencing.tiePoint.row"
    ),
    x: requireFiniteNumber(
      georeferencing.tiePoint.x,
      "georeferencing.tiePoint.x"
    ),
    y: requireFiniteNumber(
      georeferencing.tiePoint.y,
      "georeferencing.tiePoint.y"
    ),
  };

  const centralMeridianDegrees = requireFiniteNumber(
    georeferencing.centralMeridianDegrees,
    "georeferencing.centralMeridianDegrees"
  );

  const lunarRadiusMeters = requireFiniteNumber(
    georeferencing.lunarRadiusMeters,
    "georeferencing.lunarRadiusMeters"
  );

  if (product !== "NASA LOLA Product 78") {
    throw new Error(`Unexpected science product: ${product}.`);
  }

  if (archiveSite !== site.archiveSite) {
    throw new Error(
      `Science archive site ${archiveSite} does not match selected site ${site.archiveSite}.`
    );
  }

  if (resolutionMeters !== 5) {
    throw new Error(
      `Expected 5 m/pixel science data; received ${resolutionMeters} m/pixel.`
    );
  }

  if (
    projection !== "South Polar Stereographic" ||
    referenceFrame !== "MOON_ME" ||
    ephemeris !== "DE421" ||
    linearUnits !== "meters" ||
    pixelRegistration !== "pixel area"
  ) {
    throw new Error(
      "Science raster coordinate metadata does not match the expected Site04 Product 78 specification."
    );
  }

  if (dataType !== "Float32" || byteOrder !== "little-endian") {
    throw new Error(
      `Unsupported science raster encoding: ${dataType}, ${byteOrder}.`
    );
  }

  if (!Array.isArray(raw.layers)) {
    throw new Error("NASA science metadata does not contain a layers array.");
  }

  const expectedBytes = width * height * Float32Array.BYTES_PER_ELEMENT;

  if (!Number.isSafeInteger(expectedBytes)) {
    throw new Error("Science raster dimensions exceed the safe binary size limit.");
  }

  const layerByKey = new Map<string, LolaScienceLayerMetadata>();

  for (const rawLayer of raw.layers) {
    if (!isRecord(rawLayer)) {
      throw new Error("Science metadata contains an invalid layer entry.");
    }

    const key = requireString(rawLayer.key, "layers[].key");

    if (layerByKey.has(key)) {
      throw new Error(`Science metadata contains duplicate layer key ${key}.`);
    }

    const expected = EXPECTED_LAYERS[key as ScienceLayerKey];

    if (!expected) {
      throw new Error(`Unexpected NASA science layer key: ${key}.`);
    }

    const output = requireString(rawLayer.output, `${key}.output`);

    if (output !== expected.output) {
      throw new Error(`Unexpected output file for ${key}: ${output}.`);
    }

    const minimum = requireFiniteNumber(rawLayer.minimum, `${key}.minimum`);
    const maximum = requireFiniteNumber(rawLayer.maximum, `${key}.maximum`);
    const noDataCount = requireFiniteNumber(
      rawLayer.noDataCount,
      `${key}.noDataCount`
    );
    const byteLength = requireFiniteNumber(
      rawLayer.byteLength,
      `${key}.byteLength`
    );

    if (minimum > maximum) {
      throw new Error(`${key} metadata minimum exceeds maximum.`);
    }

    if (!Number.isSafeInteger(noDataCount) || noDataCount !== 0) {
      throw new Error(
        `${key} declares ${noDataCount} NoData pixels. This viewer currently requires the prepared Site04 science rasters to contain zero NoData pixels.`
      );
    }

    if (!Number.isSafeInteger(byteLength) || byteLength !== expectedBytes) {
      throw new Error(
        `${key} declares ${byteLength} bytes; expected ${expectedBytes}.`
      );
    }

    layerByKey.set(key, {
      key,
      source: requireString(rawLayer.source, `${key}.source`),
      output,
      description:
        typeof rawLayer.description === "string" && rawLayer.description.trim()
          ? rawLayer.description.trim()
          : expected.description,
      minimum,
      maximum,
      noDataCount,
      byteLength,
    });
  }

  const expectedKeys = Object.keys(EXPECTED_LAYERS) as ScienceLayerKey[];

  if (layerByKey.size !== expectedKeys.length) {
    const missing = expectedKeys.filter((key) => !layerByKey.has(key));

    throw new Error(
      `Science metadata is missing required layers: ${missing.join(", ")}.`
    );
  }

  const metadata: LolaScienceMetadata = {
    product,
    archiveSite,
    siteName,
    dimensions: { width, height },
    resolutionMeters,
    bbox,
    pixelResolution,
    georeferencing: {
      tiePoint,
      centralMeridianDegrees,
      lunarRadiusMeters,
    },
    coordinateSystem: {
      projection,
      referenceFrame,
      ephemeris,
      linearUnits,
      pixelRegistration,
    },
    dataType,
    byteOrder,
    layers: expectedKeys.map((key) => layerByKey.get(key)!),
  };

  if (expectedTerrain) {
    validateScienceRasterAlignment(metadata, expectedTerrain);
  }

  return metadata;
}

function assertNearlyEqual(
  actual: number,
  expected: number,
  name: string
): void {
  if (Math.abs(actual - expected) > 1e-6) {
    throw new Error(
      `Science/elevation georeferencing mismatch for ${name}: science=${actual}, elevation=${expected}.`
    );
  }
}

function validateScienceRasterAlignment(
  science: LolaScienceMetadata,
  terrain: LolaTerrainData
): void {
  const elevation = terrain.metadata;

  if (science.resolutionMeters !== terrain.resolutionMeters) {
    throw new Error("NASA science and elevation raster resolutions do not match.");
  }

  const scienceSystem = science.coordinateSystem;
  const elevationSystem = elevation.coordinateSystem;

  for (const key of [
    "projection",
    "referenceFrame",
    "ephemeris",
    "linearUnits",
    "pixelRegistration",
  ] as const) {
    if (scienceSystem[key] !== elevationSystem[key]) {
      throw new Error(`NASA science/elevation coordinate-system mismatch: ${key}.`);
    }
  }

  for (let index = 0; index < 4; index++) {
    assertNearlyEqual(
      science.bbox[index],
      elevation.bbox[index],
      `bbox[${index}]`
    );
  }

  for (let index = 0; index < 3; index++) {
    assertNearlyEqual(
      science.pixelResolution[index],
      elevation.pixelResolution[index],
      `pixelResolution[${index}]`
    );
  }

  const scienceTie = science.georeferencing.tiePoint;
  const elevationTie = elevation.georeferencing.tiePoint;

  for (const key of ["column", "row", "x", "y"] as const) {
    assertNearlyEqual(
      scienceTie[key],
      elevationTie[key],
      `tiePoint.${key}`
    );
  }

  assertNearlyEqual(
    science.georeferencing.centralMeridianDegrees,
    elevation.georeferencing.centralMeridianDegrees,
    "centralMeridianDegrees"
  );

  assertNearlyEqual(
    science.georeferencing.lunarRadiusMeters,
    elevation.georeferencing.lunarRadiusMeters,
    "lunarRadiusMeters"
  );
}

function decodeScienceRaster(
  buffer: ArrayBuffer,
  metadata: LolaScienceLayerMetadata,
  expectedPixels: number
): Float32Array {
  const expectedBytes =
    expectedPixels * Float32Array.BYTES_PER_ELEMENT;

  if (
    buffer.byteLength !== expectedBytes ||
    buffer.byteLength !== metadata.byteLength
  ) {
    throw new Error(
      `${metadata.output} binary size mismatch. Expected ${expectedBytes} bytes; received ${buffer.byteLength}.`
    );
  }

  const view = new DataView(buffer);
  const values = new Float32Array(expectedPixels);

  let actualMinimum = Number.POSITIVE_INFINITY;
  let actualMaximum = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < expectedPixels; index++) {
    const value = view.getFloat32(
      index * Float32Array.BYTES_PER_ELEMENT,
      true
    );

    if (!Number.isFinite(value)) {
      throw new Error(
        `${metadata.output} contains a non-finite value at raster index ${index}.`
      );
    }

    if (
      metadata.key === "observationCount" &&
      Math.abs(value - Math.round(value)) > 1e-4
    ) {
      throw new Error(
        `${metadata.output} contains a non-integer observation count at raster index ${index}.`
      );
    }

    values[index] = value;

    if (value < actualMinimum) actualMinimum = value;
    if (value > actualMaximum) actualMaximum = value;
  }

  if (
    Math.abs(actualMinimum - metadata.minimum) > FLOAT_RANGE_TOLERANCE ||
    Math.abs(actualMaximum - metadata.maximum) > FLOAT_RANGE_TOLERANCE
  ) {
    throw new Error(
      `${metadata.output} actual range ${actualMinimum}–${actualMaximum} does not match declared range ${metadata.minimum}–${metadata.maximum}.`
    );
  }

  return values;
}

async function fetchAndDecodeLayer(
  dataPath: string,
  metadata: LolaScienceLayerMetadata,
  expectedPixels: number
): Promise<Float32Array> {
  const response = await fetch(`${dataPath}/${metadata.output}`, {
    cache: "force-cache",
  });

  if (!response.ok) {
    throw new Error(
      `NASA Product 78 ${metadata.key} raster request failed: HTTP ${response.status}.`
    );
  }

  const buffer = await response.arrayBuffer();

  return decodeScienceRaster(buffer, metadata, expectedPixels);
}

/**
 * Loads the four official NASA Product 78 science rasters for a registered site.
 * The optional elevation raster is used to cross-check dimensions and the full
 * georeferencing transform before science data is used for display.
 */
export async function loadLolaScienceLayersForSite(
  siteId: Product78SiteId = DEFAULT_PRODUCT78_SITE_ID,
  expectedTerrain?: LolaTerrainData
): Promise<LolaScienceData> {
  const cached = sciencePromises.get(siteId);

  if (cached) {
    const data = await cached;

    if (expectedTerrain) {
      validateScienceRasterAlignment(data.metadata, expectedTerrain);

      if (
        data.metadata.dimensions.width !== expectedTerrain.width ||
        data.metadata.dimensions.height !== expectedTerrain.height
      ) {
        throw new Error(
          "Cached science raster dimensions do not match the selected elevation raster."
        );
      }
    }

    return data;
  }

  const site = getProduct78Site(siteId);

  const pending = (async (): Promise<LolaScienceData> => {
    const dataPath = `/data/${site.dataDirectory}`;

    const metadataResponse = await fetch(
      `${dataPath}/science-metadata.json`,
      { cache: "force-cache" }
    );

    if (!metadataResponse.ok) {
      throw new Error(
        `NASA Product 78 science metadata request failed: HTTP ${metadataResponse.status}.`
      );
    }

    const rawMetadata: unknown = await metadataResponse.json();

    const metadata = validateScienceMetadata(
      rawMetadata,
      siteId,
      expectedTerrain
    );

    const expectedPixels =
      metadata.dimensions.width * metadata.dimensions.height;

    const layers = new Map<string, LolaScienceLayerMetadata>(
      metadata.layers.map((layer) => [layer.key, layer] as const)
    );

    // Decode sequentially so four 40 MB response buffers are not all held at once.
    const slope = await fetchAndDecodeLayer(
      dataPath,
      layers.get("slope")!,
      expectedPixels
    );

    const slopeUncertainty = await fetchAndDecodeLayer(
      dataPath,
      layers.get("slopeUncertainty")!,
      expectedPixels
    );

    const elevationUncertainty = await fetchAndDecodeLayer(
      dataPath,
      layers.get("elevationUncertainty")!,
      expectedPixels
    );

    const observationCount = await fetchAndDecodeLayer(
      dataPath,
      layers.get("observationCount")!,
      expectedPixels
    );

    console.info("[LOLA] NASA Product 78 science layers loaded:", {
      siteId,
      archiveSite: metadata.archiveSite,
      dimensions: `${metadata.dimensions.width} x ${metadata.dimensions.height}`,
      resolutionMeters: metadata.resolutionMeters,
      layers: metadata.layers.map((layer) => layer.key),
    });

    return {
      metadata,
      slope,
      slopeUncertainty,
      elevationUncertainty,
      observationCount,
    };
  })();

  sciencePromises.set(siteId, pending);

  try {
    const data = await pending;
    return data;
  } catch (error) {
    if (sciencePromises.get(siteId) === pending) {
      sciencePromises.delete(siteId);
    }

    console.error(
      `[LOLA] Product 78 science-layer load failed for ${site.archiveSite}:`,
      error
    );

    throw error;
  }
}

/** Backwards-friendly Site04 convenience loader. */
export async function loadLolaScienceLayers(
  expectedTerrain?: LolaTerrainData
): Promise<LolaScienceData> {
  return loadLolaScienceLayersForSite(
    DEFAULT_PRODUCT78_SITE_ID,
    expectedTerrain
  );
}