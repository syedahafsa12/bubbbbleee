
import {
  DEFAULT_PRODUCT78_SITE_ID,
  getProduct78Site,
  type Product78SiteId,
} from "./siteRegistry";

export interface GeographicCoordinate {
  latitudeDeg: number;
  longitudeEastDeg: number;
}

export interface ProjectedCoordinate {
  xMeters: number;
  yMeters: number;
}

export interface RasterPixelCoordinate {
  column: number;
  row: number;
}

export interface LolaTerrainMetadata {
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
  resolutionMeters: number;
  noDataValue?: number | "NaN";
  noDataPixelCount?: number;
  bbox: [number, number, number, number];
  pixelResolution: [number, number, number];
  coordinateSystem: {
    projection: string;
    referenceFrame: string;
    ephemeris: string;
    linearUnits: string;
    pixelRegistration: string;
  };
  georeferencing: {
    tiePoint: {
      column: number;
      row: number;
      x: number;
      y: number;
    };
    centralMeridianDegrees: number;
    lunarRadiusMeters: number;
  };
  dataType: string;
  byteOrder: string;
}

export interface LolaTerrainData {
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
  resolutionMeters: number;
  metadata: LolaTerrainMetadata;
  elevations: Float32Array;
}

export interface LolaSample {
  geographic: GeographicCoordinate;
  projected: ProjectedCoordinate;
  pixel: RasterPixelCoordinate;
  nearestPixel: {
    column: number;
    row: number;
  };
  elevationMeters: number;
}

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
  coordinateSystem: LolaTerrainMetadata["coordinateSystem"];
  georeferencing: LolaTerrainMetadata["georeferencing"];
  pixelResolution: [number, number, number];
  bbox: [number, number, number, number];
  dataType: string;
  byteOrder: string;
  layers: LolaScienceLayerMetadata[];
  sourceDirectory: string;
}

export interface LolaScienceData {
  metadata: LolaScienceMetadata;
  slope: Float32Array;
  slopeUncertainty: Float32Array;
  elevationUncertainty: Float32Array;
  observationCount: Float32Array;
}

export interface LolaScienceSample {
  slopeDegrees: number;
  slopeUncertaintyDegrees: number;
  elevationUncertaintyMeters: number;
  observationCount: number;
  column: number;
  row: number;
}

const ELEVATION_RANGE_TOLERANCE_METERS = 0.1;
const GEOREFERENCE_TOLERANCE_METERS = 0.1;

export const SITE04_COORDINATES: GeographicCoordinate = {
  latitudeDeg: -89.7668,
  longitudeEastDeg: 188.13,
};

const terrainPromises = new Map<Product78SiteId, Promise<LolaTerrainData>>();
const sciencePromises = new Map<Product78SiteId, Promise<LolaScienceData>>();

export class LolaNoDataError extends Error {
  constructor(message = "Product 78 sample intersects a NoData pixel.") {
    super(message);
    this.name = "LolaNoDataError";
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite. Received: ${value}`);
  }
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} is missing or invalid.`);
  }
  return value as Record<string, unknown>;
}

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} is missing or invalid.`);
  }
  return value;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is missing or invalid.`);
  }
  return value.trim();
}

function normalizeMetadataValue(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function approximatelyEqual(
  actual: number,
  expected: number,
  tolerance: number,
): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function validateBoundingBox(metadata: LolaTerrainMetadata): void {
  const { width, height, bbox, pixelResolution } = metadata;
  const tie = metadata.georeferencing.tiePoint;
  const [pixelWidth, pixelHeight] = pixelResolution;

  const x1 = tie.x - tie.column * pixelWidth;
  const x2 = tie.x + (width - tie.column) * pixelWidth;
  const y1 = tie.y - tie.row * pixelHeight;
  const y2 = tie.y + (height - tie.row) * pixelHeight;

  const expected = [
    Math.min(x1, x2),
    Math.min(y1, y2),
    Math.max(x1, x2),
    Math.max(y1, y2),
  ];

  bbox.forEach((value, index) => {
    if (!approximatelyEqual(value, expected[index], GEOREFERENCE_TOLERANCE_METERS)) {
      throw new Error(
        `Raster bounding box mismatch at index ${index}. ` +
        `Metadata: ${value}; calculated: ${expected[index]}.`,
      );
    }
  });
}

function validateMetadata(raw: unknown): LolaTerrainMetadata {
  const root = requireObject(raw, "Root metadata");
  const cs = requireObject(root.coordinateSystem, "coordinateSystem");
  const geo = requireObject(root.georeferencing, "georeferencing");
  const tie = requireObject(geo.tiePoint, "georeferencing.tiePoint");

  if (!Array.isArray(root.pixelResolution) || root.pixelResolution.length < 2) {
    throw new Error("Invalid pixelResolution.");
  }

  if (!Array.isArray(root.bbox) || root.bbox.length !== 4) {
    throw new Error("Invalid bounding box.");
  }

  const rawNoData = root.noDataValue;
  let noDataValue: number | "NaN" | undefined;

  if (rawNoData === "NaN") {
    noDataValue = "NaN";
  } else if (typeof rawNoData === "number" && Number.isFinite(rawNoData)) {
    noDataValue = rawNoData;
  } else if (rawNoData !== undefined && rawNoData !== null) {
    throw new Error("Invalid noDataValue.");
  }

  const noDataPixelCount =
    root.noDataPixelCount === undefined
      ? undefined
      : requireNumber(root.noDataPixelCount, "noDataPixelCount");

  if (
    noDataPixelCount !== undefined &&
    (!Number.isSafeInteger(noDataPixelCount) || noDataPixelCount < 0)
  ) {
    throw new Error("Invalid noDataPixelCount.");
  }

  if ((noDataValue === undefined) !== (noDataPixelCount === undefined)) {
    throw new Error("noDataValue and noDataPixelCount must be declared together.");
  }

  const metadata: LolaTerrainMetadata = {
    width: requireNumber(root.width, "width"),
    height: requireNumber(root.height, "height"),
    minElevation: requireNumber(root.minElevation, "minElevation"),
    maxElevation: requireNumber(root.maxElevation, "maxElevation"),
    resolutionMeters: requireNumber(root.resolutionMeters, "resolutionMeters"),
    ...(noDataValue !== undefined ? { noDataValue, noDataPixelCount } : {}),
    bbox: [
      requireNumber(root.bbox[0], "bbox[0]"),
      requireNumber(root.bbox[1], "bbox[1]"),
      requireNumber(root.bbox[2], "bbox[2]"),
      requireNumber(root.bbox[3], "bbox[3]"),
    ],
    pixelResolution: [
      requireNumber(root.pixelResolution[0], "pixelResolution[0]"),
      requireNumber(root.pixelResolution[1], "pixelResolution[1]"),
      root.pixelResolution[2] === undefined
        ? 0
        : requireNumber(root.pixelResolution[2], "pixelResolution[2]"),
    ],
    coordinateSystem: {
      projection: requireString(cs.projection, "coordinateSystem.projection"),
      referenceFrame: requireString(cs.referenceFrame, "coordinateSystem.referenceFrame"),
      ephemeris: requireString(cs.ephemeris, "coordinateSystem.ephemeris"),
      linearUnits: requireString(cs.linearUnits, "coordinateSystem.linearUnits"),
      pixelRegistration: requireString(cs.pixelRegistration, "coordinateSystem.pixelRegistration"),
    },
    georeferencing: {
      tiePoint: {
        column: requireNumber(tie.column, "tiePoint.column"),
        row: requireNumber(tie.row, "tiePoint.row"),
        x: requireNumber(tie.x, "tiePoint.x"),
        y: requireNumber(tie.y, "tiePoint.y"),
      },
      centralMeridianDegrees: requireNumber(
        geo.centralMeridianDegrees,
        "centralMeridianDegrees",
      ),
      lunarRadiusMeters: requireNumber(geo.lunarRadiusMeters, "lunarRadiusMeters"),
    },
    dataType: requireString(root.dataType, "dataType"),
    byteOrder: requireString(root.byteOrder, "byteOrder"),
  };

  if (
    !Number.isSafeInteger(metadata.width) ||
    !Number.isSafeInteger(metadata.height) ||
    metadata.width <= 0 ||
    metadata.height <= 0
  ) {
    throw new Error("Invalid raster dimensions.");
  }

  if (metadata.minElevation >= metadata.maxElevation) {
    throw new Error("Invalid elevation range.");
  }

  if (metadata.resolutionMeters <= 0) {
    throw new Error("Invalid raster resolution.");
  }

  const [pw, ph, rotation] = metadata.pixelResolution;

  if (pw === 0 || ph === 0 || Math.abs(rotation) > 1e-10) {
    throw new Error("Unsupported raster pixel transform.");
  }

  const tolerance = Math.max(1e-6, metadata.resolutionMeters * 1e-6);

  if (
    !approximatelyEqual(Math.abs(pw), metadata.resolutionMeters, tolerance) ||
    !approximatelyEqual(Math.abs(ph), metadata.resolutionMeters, tolerance)
  ) {
    throw new Error("Pixel resolution does not match metadata.");
  }

  const [minX, minY, maxX, maxY] = metadata.bbox;

  if (minX >= maxX || minY >= maxY) {
    throw new Error("Invalid raster bounding box ordering.");
  }

  if (
    normalizeMetadataValue(metadata.coordinateSystem.projection) !==
    "southpolarstereographic"
  ) {
    throw new Error("Unsupported projection.");
  }

  const units = normalizeMetadataValue(metadata.coordinateSystem.linearUnits);

  if (!["meters", "metres", "m"].includes(units)) {
    throw new Error("Expected metre coordinate units.");
  }

  const registration = normalizeMetadataValue(
    metadata.coordinateSystem.pixelRegistration,
  );

  if (!["pixelarea", "pixelisarea"].includes(registration)) {
    throw new Error("Expected PixelIsArea registration.");
  }

  if (metadata.georeferencing.lunarRadiusMeters <= 0) {
    throw new Error("Invalid lunar radius.");
  }

  if (
    !Number.isSafeInteger(metadata.georeferencing.tiePoint.column) ||
    !Number.isSafeInteger(metadata.georeferencing.tiePoint.row)
  ) {
    throw new Error("Tie point pixel coordinates must be integers.");
  }

  if (normalizeMetadataValue(metadata.dataType) !== "float32") {
    throw new Error("Expected Float32 raster data.");
  }

  if (!["littleendian", "le"].includes(normalizeMetadataValue(metadata.byteOrder))) {
    throw new Error("Expected little-endian raster data.");
  }

  validateBoundingBox(metadata);
  return metadata;
}

function decodeFloat32(bytes: Uint8Array, expectedPixels: number, name: string): Float32Array {
  const expectedBytes = expectedPixels * Float32Array.BYTES_PER_ELEMENT;

  if (bytes.byteLength !== expectedBytes) {
    throw new Error(
      `${name} size mismatch. Expected ${expectedBytes} bytes; received ${bytes.byteLength}.`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = new Float32Array(expectedPixels);

  for (let i = 0; i < expectedPixels; i++) {
    const value = view.getFloat32(i * 4, true);

    if (!Number.isFinite(value)) {
      throw new Error(`${name} contains a non-finite value at pixel ${i}.`);
    }

    result[i] = value;
  }

  return result;
}

export function decodeLolaTerrain(
  rawMetadata: unknown,
  bytes: Uint8Array,
): LolaTerrainData {
  const metadata = validateMetadata(rawMetadata);
  const expectedPixels = metadata.width * metadata.height;

  if (!Number.isSafeInteger(expectedPixels)) {
    throw new Error("Terrain dimensions exceed safe pixel count.");
  }

  if (bytes.byteLength !== expectedPixels * 4) {
    throw new Error(
      `LOLA raster size mismatch. Expected ${expectedPixels * 4}; received ${bytes.byteLength}.`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const elevations = new Float32Array(expectedPixels);

  let actualMin = Infinity;
  let actualMax = -Infinity;
  let actualNoDataCount = 0;

  for (let i = 0; i < expectedPixels; i++) {
    const value = view.getFloat32(i * 4, true);

    const isNoData =
      metadata.noDataValue === "NaN"
        ? Number.isNaN(value)
        : typeof metadata.noDataValue === "number"
          ? value === Math.fround(metadata.noDataValue)
          : false;

    if (isNoData) {
      actualNoDataCount++;
      elevations[i] = Number.NaN;
      continue;
    }

    if (!Number.isFinite(value)) {
      throw new Error(`Invalid elevation at binary index ${i}.`);
    }

    elevations[i] = value;
    actualMin = Math.min(actualMin, value);
    actualMax = Math.max(actualMax, value);
  }

  if (actualNoDataCount !== (metadata.noDataPixelCount ?? 0)) {
    throw new Error("Elevation NoData count does not match metadata.");
  }

  if (!Number.isFinite(actualMin) || !Number.isFinite(actualMax)) {
    throw new Error("Terrain contains no valid elevations.");
  }

  if (
    actualMin < metadata.minElevation - ELEVATION_RANGE_TOLERANCE_METERS ||
    actualMax > metadata.maxElevation + ELEVATION_RANGE_TOLERANCE_METERS
  ) {
    throw new Error("Elevation values fall outside the declared metadata range.");
  }

  console.info("[LOLA] DEM decoded:", {
    dimensions: `${metadata.width} x ${metadata.height}`,
    resolutionMeters: metadata.resolutionMeters,
    actualMin,
    actualMax,
    noDataCount: actualNoDataCount,
  });

  return {
    width: metadata.width,
    height: metadata.height,
    minElevation: metadata.minElevation,
    maxElevation: metadata.maxElevation,
    resolutionMeters: metadata.resolutionMeters,
    metadata,
    elevations,
  };
}

function validateScienceMetadata(raw: unknown): LolaScienceMetadata {
  const root = requireObject(raw, "Science metadata");
  const dimensions = requireObject(root.dimensions, "Science dimensions");

  if (!Array.isArray(root.layers)) {
    throw new Error("Science metadata layers are missing.");
  }

  const layers = root.layers.map((item, index) => {
    const layer = requireObject(item, `layers[${index}]`);

    const result: LolaScienceLayerMetadata = {
      key: requireString(layer.key, `layers[${index}].key`),
      source: requireString(layer.source, `layers[${index}].source`),
      output: requireString(layer.output, `layers[${index}].output`),
      description: requireString(layer.description, `layers[${index}].description`),
      minimum: requireNumber(layer.minimum, `layers[${index}].minimum`),
      maximum: requireNumber(layer.maximum, `layers[${index}].maximum`),
      noDataCount: requireNumber(layer.noDataCount, `layers[${index}].noDataCount`),
      byteLength: requireNumber(layer.byteLength, `layers[${index}].byteLength`),
    };

    if (
      result.minimum > result.maximum ||
      result.noDataCount !== 0 ||
      result.byteLength !== 3200 * 3200 * 4
    ) {
      throw new Error(`Invalid science layer metadata: ${result.key}.`);
    }

    return result;
  });

  const expectedKeys = [
    "slope",
    "slopeUncertainty",
    "elevationUncertainty",
    "observationCount",
  ];

  for (const key of expectedKeys) {
    if (!layers.some((layer) => layer.key === key)) {
      throw new Error(`Science metadata is missing the ${key} layer.`);
    }
  }

  const metadata: LolaScienceMetadata = {
    product: requireString(root.product, "product"),
    archiveSite: requireString(root.archiveSite, "archiveSite"),
    siteName: requireString(root.siteName, "siteName"),
    dimensions: {
      width: requireNumber(dimensions.width, "dimensions.width"),
      height: requireNumber(dimensions.height, "dimensions.height"),
    },
    resolutionMeters: requireNumber(root.resolutionMeters, "resolutionMeters"),
    coordinateSystem: root.coordinateSystem as LolaTerrainMetadata["coordinateSystem"],
    georeferencing: root.georeferencing as LolaTerrainMetadata["georeferencing"],
    pixelResolution: root.pixelResolution as [number, number, number],
    bbox: root.bbox as [number, number, number, number],
    dataType: requireString(root.dataType, "dataType"),
    byteOrder: requireString(root.byteOrder, "byteOrder"),
    layers,
    sourceDirectory: requireString(root.sourceDirectory, "sourceDirectory"),
  };

  if (
    metadata.dimensions.width !== 3200 ||
    metadata.dimensions.height !== 3200 ||
    metadata.resolutionMeters !== 5 ||
    normalizeMetadataValue(metadata.dataType) !== "float32" ||
    !["littleendian", "le"].includes(normalizeMetadataValue(metadata.byteOrder))
  ) {
    throw new Error("Science raster dimensions, resolution, or encoding are unexpected.");
  }

  return metadata;
}

function validateScienceArray(
  values: Float32Array,
  layer: LolaScienceLayerMetadata,
): void {
  let actualMin = Infinity;
  let actualMax = -Infinity;

  for (let i = 0; i < values.length; i++) {
    const value = values[i];

    if (!Number.isFinite(value)) {
      throw new Error(`${layer.key} contains an invalid value at pixel ${i}.`);
    }

    actualMin = Math.min(actualMin, value);
    actualMax = Math.max(actualMax, value);
  }

  const tolerance = 0.001;

  if (
    actualMin < layer.minimum - tolerance ||
    actualMax > layer.maximum + tolerance
  ) {
    throw new Error(
      `${layer.key} values do not match science metadata. ` +
      `Actual ${actualMin}–${actualMax}; expected ${layer.minimum}–${layer.maximum}.`,
    );
  }
}

async function fetchBinary(path: string): Promise<Uint8Array> {
  const response = await fetch(path, { cache: "force-cache" });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} loading ${path}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

export async function loadLolaTerrainForSite(
  siteId: Product78SiteId = DEFAULT_PRODUCT78_SITE_ID,
): Promise<LolaTerrainData> {
  const cached = terrainPromises.get(siteId);
  if (cached) return cached;

  const pending = (async () => {
    const site = getProduct78Site(siteId);
    const base = `/data/${site.dataDirectory}`;

    const [metadataResponse, elevationBytes] = await Promise.all([
      fetch(`${base}/metadata.json`, { cache: "force-cache" }),
      fetchBinary(`${base}/elevation.bin`),
    ]);

    if (!metadataResponse.ok) {
      throw new Error(`Terrain metadata HTTP error: ${metadataResponse.status}`);
    }

    const metadata: unknown = await metadataResponse.json();
    return decodeLolaTerrain(metadata, elevationBytes);
  })();

  terrainPromises.set(siteId, pending);

  try {
    return await pending;
  } catch (error) {
    if (terrainPromises.get(siteId) === pending) terrainPromises.delete(siteId);
    throw error;
  }
}

export async function loadLolaTerrain(): Promise<LolaTerrainData> {
  return loadLolaTerrainForSite(DEFAULT_PRODUCT78_SITE_ID);
}

export async function loadLolaScienceLayersForSite(
  siteId: Product78SiteId = DEFAULT_PRODUCT78_SITE_ID,
): Promise<LolaScienceData> {
  const cached = sciencePromises.get(siteId);
  if (cached) return cached;

  const pending = (async () => {
    const site = getProduct78Site(siteId);
    const base = `/data/${site.dataDirectory}`;

    const metadataResponse = await fetch(
      `${base}/science-metadata.json`,
      { cache: "force-cache" },
    );

    if (!metadataResponse.ok) {
      throw new Error(
        `NASA science metadata HTTP error: ${metadataResponse.status}`,
      );
    }

    const metadata = validateScienceMetadata(await metadataResponse.json());

    const expectedPixels =
      metadata.dimensions.width * metadata.dimensions.height;

    const layerByKey = (key: string) => {
      const layer = metadata.layers.find((item) => item.key === key);
      if (!layer) throw new Error(`Missing science layer: ${key}`);
      return layer;
    };

    const [slopeBytes, slopeErrorBytes, elevationErrorBytes, countBytes] =
      await Promise.all([
        fetchBinary(`${base}/${layerByKey("slope").output}`),
        fetchBinary(`${base}/${layerByKey("slopeUncertainty").output}`),
        fetchBinary(`${base}/${layerByKey("elevationUncertainty").output}`),
        fetchBinary(`${base}/${layerByKey("observationCount").output}`),
      ]);

    const slope = decodeFloat32(slopeBytes, expectedPixels, "NASA slope");
    const slopeUncertainty = decodeFloat32(
      slopeErrorBytes,
      expectedPixels,
      "NASA slope uncertainty",
    );
    const elevationUncertainty = decodeFloat32(
      elevationErrorBytes,
      expectedPixels,
      "NASA elevation uncertainty",
    );
    const observationCount = decodeFloat32(
      countBytes,
      expectedPixels,
      "LOLA observation count",
    );

    validateScienceArray(slope, layerByKey("slope"));
    validateScienceArray(slopeUncertainty, layerByKey("slopeUncertainty"));
    validateScienceArray(elevationUncertainty, layerByKey("elevationUncertainty"));
    validateScienceArray(observationCount, layerByKey("observationCount"));

    console.info("[NASA Product 78] Science layers loaded:", {
      siteId,
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
    return await pending;
  } catch (error) {
    if (sciencePromises.get(siteId) === pending) sciencePromises.delete(siteId);
    throw error;
  }
}

export async function loadLolaScienceLayers(): Promise<LolaScienceData> {
  return loadLolaScienceLayersForSite(DEFAULT_PRODUCT78_SITE_ID);
}

function normalizeEastLongitude(longitudeDeg: number): number {
  return ((longitudeDeg % 360) + 360) % 360;
}

export function geographicToLolaProjected(
  coordinate: GeographicCoordinate,
  metadata: LolaTerrainMetadata,
): ProjectedCoordinate {
  const latitude = coordinate.latitudeDeg;
  const longitude = coordinate.longitudeEastDeg;

  assertFinite(latitude, "Latitude");
  assertFinite(longitude, "Longitude");

  if (latitude < -90 || latitude > 0) {
    throw new Error("Latitude must be between -90 and 0 degrees.");
  }

  const radius = metadata.georeferencing.lunarRadiusMeters;
  const centralMeridian = metadata.georeferencing.centralMeridianDegrees;
  const latitudeFromSouthPole = toRadians(90 + latitude);

  const longitudeDifference = toRadians(
    normalizeEastLongitude(longitude) -
    normalizeEastLongitude(centralMeridian),
  );

  const rho = 2 * radius * Math.tan(latitudeFromSouthPole / 2);

  return {
    xMeters: rho * Math.sin(longitudeDifference),
    yMeters: rho * Math.cos(longitudeDifference),
  };
}

export function projectedToLolaPixel(
  projected: ProjectedCoordinate,
  metadata: LolaTerrainMetadata,
): RasterPixelCoordinate {
  const tie = metadata.georeferencing.tiePoint;
  const [pixelWidth, pixelHeight, rotation] = metadata.pixelResolution;

  if (pixelWidth === 0 || pixelHeight === 0 || Math.abs(rotation) > 1e-10) {
    throw new Error("Unsupported raster pixel transform.");
  }

  return {
    column:
      tie.column + (projected.xMeters - tie.x) / pixelWidth - 0.5,
    row:
      tie.row + (projected.yMeters - tie.y) / pixelHeight - 0.5,
  };
}

export function isLolaPixelInsideRaster(
  pixel: RasterPixelCoordinate,
  terrain: LolaTerrainData,
): boolean {
  return (
    Number.isFinite(pixel.column) &&
    Number.isFinite(pixel.row) &&
    pixel.column >= -0.5 &&
    pixel.row >= -0.5 &&
    pixel.column < terrain.width - 0.5 &&
    pixel.row < terrain.height - 0.5
  );
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function sampleLolaHeightAtPixel(
  terrain: LolaTerrainData,
  pixel: RasterPixelCoordinate,
): number {
  if (!isLolaPixelInsideRaster(pixel, terrain)) {
    throw new Error(
      `Pixel outside raster: ${pixel.column.toFixed(4)}, ${pixel.row.toFixed(4)}.`,
    );
  }

  const column = Math.max(0, Math.min(terrain.width - 1, pixel.column));
  const row = Math.max(0, Math.min(terrain.height - 1, pixel.row));

  const x0 = Math.floor(column);
  const y0 = Math.floor(row);
  const x1 = Math.min(x0 + 1, terrain.width - 1);
  const y1 = Math.min(y0 + 1, terrain.height - 1);

  const tx = column - x0;
  const ty = row - y0;

  const a = terrain.elevations[y0 * terrain.width + x0];
  const b = terrain.elevations[y0 * terrain.width + x1];
  const c = terrain.elevations[y1 * terrain.width + x0];
  const d = terrain.elevations[y1 * terrain.width + x1];

  if (![a, b, c, d].every(Number.isFinite)) {
    throw new LolaNoDataError();
  }

  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

export function sampleLolaScienceAtPixel(
  science: LolaScienceData,
  terrain: LolaTerrainData,
  pixel: RasterPixelCoordinate,
): LolaScienceSample {
  if (!isLolaPixelInsideRaster(pixel, terrain)) {
    throw new Error("Science sample is outside raster coverage.");
  }

  const column = Math.max(
    0,
    Math.min(terrain.width - 1, Math.round(pixel.column)),
  );
  const row = Math.max(
    0,
    Math.min(terrain.height - 1, Math.round(pixel.row)),
  );

  const index = row * terrain.width + column;

  return {
    slopeDegrees: science.slope[index],
    slopeUncertaintyDegrees: science.slopeUncertainty[index],
    elevationUncertaintyMeters: science.elevationUncertainty[index],
    observationCount: science.observationCount[index],
    column,
    row,
  };
}

export function sampleLolaHeightAtLocation(
  terrain: LolaTerrainData,
  coordinate: GeographicCoordinate,
): LolaSample {
  const projected = geographicToLolaProjected(coordinate, terrain.metadata);
  const pixel = projectedToLolaPixel(projected, terrain.metadata);

  if (!isLolaPixelInsideRaster(pixel, terrain)) {
    throw new Error("Location is outside raster coverage.");
  }

  const elevationMeters = sampleLolaHeightAtPixel(terrain, pixel);

  return {
    geographic: coordinate,
    projected,
    pixel,
    nearestPixel: {
      column: Math.max(0, Math.min(terrain.width - 1, Math.round(pixel.column))),
      row: Math.max(0, Math.min(terrain.height - 1, Math.round(pixel.row))),
    },
    elevationMeters,
  };
}

export function sampleSite04Elevation(terrain: LolaTerrainData): LolaSample {
  return sampleLolaHeightAtLocation(terrain, SITE04_COORDINATES);
}
