
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

const ELEVATION_RANGE_TOLERANCE_METERS = 0.1;
const GEOREFERENCE_TOLERANCE_METERS = 0.1;

export const SITE04_COORDINATES: GeographicCoordinate = {
  latitudeDeg: -89.7668,
  longitudeEastDeg: 188.13,
};

const terrainPromises = new Map<
  Product78SiteId,
  Promise<LolaTerrainData>
>();

export class LolaNoDataError extends Error {
  constructor(message = "Product 78 sample intersects a NoData pixel.") {
    super(message);
    this.name = "LolaNoDataError";
  }
}

/**
 * Validates a finite numeric value.
 */
function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(
      `${name} must be finite. Received: ${value}`
    );
  }
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

// function toDegrees(radians: number): number {
//   return (radians * 180) / Math.PI;
// }

/**
 * Validates an object received from external JSON.
 */
function requireObject(
  value: unknown,
  name: string
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`${name} is missing or invalid.`);
  }

  return value as Record<string, unknown>;
}

/**
 * Validates a number received from external JSON.
 */
function requireNumber(value: unknown, name: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    throw new Error(`${name} is missing or invalid.`);
  }

  return value;
}

/**
 * Validates a non-empty string received from external JSON.
 */
function requireString(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(`${name} is missing or invalid.`);
  }

  return value.trim();
}

/**
 * Normalizes metadata text for comparisons.
 *
 * Examples:
 * "South Polar Stereographic"
 * "south-polar-stereographic"
 *
 * Both become:
 * "southpolarstereographic"
 */
function normalizeMetadataValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Compares two coordinates using a defined tolerance.
 */
function approximatelyEqual(
  actual: number,
  expected: number,
  tolerance: number
): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

/**
 * Checks that the metadata bounding box agrees with
 * its tie point, pixel resolution and raster dimensions.
 *
 * Bounding box order:
 * [minimum X, minimum Y, maximum X, maximum Y]
 *
 * The tie point represents the outer corner of the
 * referenced pixel for PixelIsArea registration.
 */
function validateBoundingBox(
  metadata: LolaTerrainMetadata
): void {
  const { width, height, bbox, pixelResolution } = metadata;

  const tiePoint = metadata.georeferencing.tiePoint;

  const pixelWidth = pixelResolution[0];
  const pixelHeight = pixelResolution[1];

  const xAtLeftEdge =
    tiePoint.x - tiePoint.column * pixelWidth;

  const xAtRightEdge =
    tiePoint.x +
    (width - tiePoint.column) * pixelWidth;

  const yAtTopEdge =
    tiePoint.y - tiePoint.row * pixelHeight;

  const yAtBottomEdge =
    tiePoint.y +
    (height - tiePoint.row) * pixelHeight;

  const expectedBoundingBox = {
    minX: Math.min(xAtLeftEdge, xAtRightEdge),
    minY: Math.min(yAtTopEdge, yAtBottomEdge),
    maxX: Math.max(xAtLeftEdge, xAtRightEdge),
    maxY: Math.max(yAtTopEdge, yAtBottomEdge),
  };

  const [actualMinX, actualMinY, actualMaxX, actualMaxY] =
    bbox;

  const tolerance = GEOREFERENCE_TOLERANCE_METERS;

  const checks = [
    {
      name: "minimum X",
      actual: actualMinX,
      expected: expectedBoundingBox.minX,
    },
    {
      name: "minimum Y",
      actual: actualMinY,
      expected: expectedBoundingBox.minY,
    },
    {
      name: "maximum X",
      actual: actualMaxX,
      expected: expectedBoundingBox.maxX,
    },
    {
      name: "maximum Y",
      actual: actualMaxY,
      expected: expectedBoundingBox.maxY,
    },
  ];

  for (const check of checks) {
    if (
      !approximatelyEqual(
        check.actual,
        check.expected,
        tolerance
      )
    ) {
      throw new Error(
        `Raster bounding box ${check.name} mismatch. ` +
        `Metadata: ${check.actual}; calculated: ${check.expected}.`
      );
    }
  }
}

/**
 * Validates and converts raw metadata JSON into
 * a strongly typed LOLA metadata object.
 */
function validateMetadata(raw: unknown): LolaTerrainMetadata {
  const root = requireObject(raw, "Root metadata");

  const coordinateSystem = requireObject(
    root.coordinateSystem,
    "coordinateSystem"
  );

  const georeferencing = requireObject(
    root.georeferencing,
    "georeferencing"
  );

  const tiePoint = requireObject(
    georeferencing.tiePoint,
    "georeferencing.tiePoint"
  );

  const pixelResolution = root.pixelResolution;
  const bbox = root.bbox;

  if (
    !Array.isArray(pixelResolution) ||
    pixelResolution.length < 2
  ) {
    throw new Error("Invalid pixelResolution.");
  }

  if (!Array.isArray(bbox) || bbox.length !== 4) {
    throw new Error("Invalid bounding box.");
  }

  const rawNoDataValue = root.noDataValue;
  let noDataValue: number | "NaN" | undefined;

  if (rawNoDataValue === "NaN") {
    noDataValue = "NaN";
  } else if (typeof rawNoDataValue === "number" && Number.isFinite(rawNoDataValue)) {
    noDataValue = rawNoDataValue;
  } else if (rawNoDataValue !== undefined && rawNoDataValue !== null) {
    throw new Error("noDataValue must be a finite number or the string 'NaN'.");
  }

  const noDataPixelCount =
    root.noDataPixelCount === undefined
      ? undefined
      : requireNumber(root.noDataPixelCount, "noDataPixelCount");

  if (
    noDataPixelCount !== undefined &&
    (!Number.isSafeInteger(noDataPixelCount) || noDataPixelCount < 0)
  ) {
    throw new Error("noDataPixelCount must be a non-negative safe integer.");
  }

  if ((noDataValue === undefined) !== (noDataPixelCount === undefined)) {
    throw new Error("noDataValue and noDataPixelCount must be declared together.");
  }

  const metadata: LolaTerrainMetadata = {
    width: requireNumber(root.width, "width"),
    height: requireNumber(root.height, "height"),

    minElevation: requireNumber(
      root.minElevation,
      "minElevation"
    ),

    maxElevation: requireNumber(
      root.maxElevation,
      "maxElevation"
    ),

    resolutionMeters: requireNumber(
      root.resolutionMeters,
      "resolutionMeters"
    ),

    ...(noDataValue !== undefined
      ? { noDataValue, noDataPixelCount }
      : {}),

    bbox: [
      requireNumber(bbox[0], "bbox[0]"),
      requireNumber(bbox[1], "bbox[1]"),
      requireNumber(bbox[2], "bbox[2]"),
      requireNumber(bbox[3], "bbox[3]"),
    ],

    pixelResolution: [
      requireNumber(
        pixelResolution[0],
        "pixelResolution[0]"
      ),
      requireNumber(
        pixelResolution[1],
        "pixelResolution[1]"
      ),
      pixelResolution[2] === undefined
        ? 0
        : requireNumber(
          pixelResolution[2],
          "pixelResolution[2]"
        ),
    ],

    coordinateSystem: {
      projection: requireString(
        coordinateSystem.projection,
        "coordinateSystem.projection"
      ),

      referenceFrame: requireString(
        coordinateSystem.referenceFrame,
        "coordinateSystem.referenceFrame"
      ),

      ephemeris: requireString(
        coordinateSystem.ephemeris,
        "coordinateSystem.ephemeris"
      ),

      linearUnits: requireString(
        coordinateSystem.linearUnits,
        "coordinateSystem.linearUnits"
      ),

      pixelRegistration: requireString(
        coordinateSystem.pixelRegistration,
        "coordinateSystem.pixelRegistration"
      ),
    },

    georeferencing: {
      tiePoint: {
        column: requireNumber(
          tiePoint.column,
          "tiePoint.column"
        ),

        row: requireNumber(
          tiePoint.row,
          "tiePoint.row"
        ),

        x: requireNumber(
          tiePoint.x,
          "tiePoint.x"
        ),

        y: requireNumber(
          tiePoint.y,
          "tiePoint.y"
        ),
      },

      centralMeridianDegrees: requireNumber(
        georeferencing.centralMeridianDegrees,
        "centralMeridianDegrees"
      ),

      lunarRadiusMeters: requireNumber(
        georeferencing.lunarRadiusMeters,
        "lunarRadiusMeters"
      ),
    },

    dataType: requireString(
      root.dataType,
      "dataType"
    ),

    byteOrder: requireString(
      root.byteOrder,
      "byteOrder"
    ),
  };

  // Validate raster dimensions.
  if (
    !Number.isSafeInteger(metadata.width) ||
    metadata.width <= 0 ||
    !Number.isSafeInteger(metadata.height) ||
    metadata.height <= 0
  ) {
    throw new Error(
      `Invalid raster dimensions: ${metadata.width} x ${metadata.height}.`
    );
  }

  // Validate elevation range.
  if (
    metadata.minElevation >= metadata.maxElevation
  ) {
    throw new Error(
      "Minimum elevation must be smaller than maximum elevation."
    );
  }

  // Validate raster resolution.
  if (metadata.resolutionMeters <= 0) {
    throw new Error(
      "resolutionMeters must be greater than zero."
    );
  }

  const [pixelWidth, pixelHeight, pixelRotation] =
    metadata.pixelResolution;

  if (
    pixelWidth === 0 ||
    pixelHeight === 0
  ) {
    throw new Error(
      "Invalid pixel resolution."
    );
  }

  // This implementation assumes a north-up raster without
  // pixel rotation. The third pixelResolution entry is
  // treated as the rotation term.
  if (Math.abs(pixelRotation) > 1e-10) {
    throw new Error(
      `Rotated rasters are not supported. Pixel rotation: ${pixelRotation}.`
    );
  }

  // Product 78 is expected to use square pixels.
  const resolutionTolerance = Math.max(
    1e-6,
    metadata.resolutionMeters * 1e-6
  );

  if (
    !approximatelyEqual(
      Math.abs(pixelWidth),
      metadata.resolutionMeters,
      resolutionTolerance
    ) ||
    !approximatelyEqual(
      Math.abs(pixelHeight),
      metadata.resolutionMeters,
      resolutionTolerance
    )
  ) {
    throw new Error(
      "Pixel resolution does not agree with resolutionMeters."
    );
  }

  // Validate bounding-box ordering.
  const [minX, minY, maxX, maxY] = metadata.bbox;

  if (minX >= maxX || minY >= maxY) {
    throw new Error(
      "Invalid raster bounding box ordering."
    );
  }

  // Validate projection.
  const projection = normalizeMetadataValue(
    metadata.coordinateSystem.projection
  );

  if (projection !== "southpolarstereographic") {
    throw new Error(
      `Unsupported projection: ${metadata.coordinateSystem.projection}.`
    );
  }

  // Validate horizontal units.
  const linearUnits = normalizeMetadataValue(
    metadata.coordinateSystem.linearUnits
  );

  if (
    linearUnits !== "meters" &&
    linearUnits !== "metres" &&
    linearUnits !== "m"
  ) {
    throw new Error(
      `Expected raster coordinates in metres. Received: ${metadata.coordinateSystem.linearUnits}.`
    );
  }

  // Validate pixel registration.
  const pixelRegistration = normalizeMetadataValue(
    metadata.coordinateSystem.pixelRegistration
  );

  if (
    pixelRegistration !== "pixelarea" &&
    pixelRegistration !== "pixelisarea"
  ) {
    throw new Error(
      `Expected PixelIsArea registration. Received: ${metadata.coordinateSystem.pixelRegistration}.`
    );
  }

  // Validate reference geometry.
  if (
    metadata.georeferencing.lunarRadiusMeters <= 0
  ) {
    throw new Error(
      "Invalid lunar radius."
    );
  }

  if (
    metadata.georeferencing.centralMeridianDegrees < -360 ||
    metadata.georeferencing.centralMeridianDegrees > 360
  ) {
    throw new Error(
      "Invalid central meridian."
    );
  }

  if (
    !Number.isSafeInteger(
      metadata.georeferencing.tiePoint.column
    ) ||
    !Number.isSafeInteger(
      metadata.georeferencing.tiePoint.row
    )
  ) {
    throw new Error(
      "Tie point pixel coordinates must be integers."
    );
  }

  // Validate Float32 encoding.
  const dataType = normalizeMetadataValue(
    metadata.dataType
  );

  if (dataType !== "float32") {
    throw new Error(
      `Expected Float32 elevation data. Received: ${metadata.dataType}.`
    );
  }

  // The decoder below explicitly reads little-endian values.
  const byteOrder = normalizeMetadataValue(
    metadata.byteOrder
  );

  if (
    byteOrder !== "littleendian" &&
    byteOrder !== "le"
  ) {
    throw new Error(
      `Expected little-endian elevation data. Received: ${metadata.byteOrder}.`
    );
  }

  // Make sure the advertised bounding box agrees with
  // the georeferencing information.
  validateBoundingBox(metadata);

  return metadata;
}

/**
 * Decodes the raw Float32 little-endian LOLA raster.
 *
 * This is the single decoding implementation used by
 * both direct binary decoding and asynchronous loading.
 */
export function decodeLolaTerrain(
  rawMetadata: unknown,
  bytes: Uint8Array
): LolaTerrainData {
  const metadata = validateMetadata(rawMetadata);

  const expectedPixels =
    metadata.width * metadata.height;

  if (!Number.isSafeInteger(expectedPixels)) {
    throw new Error(
      "Terrain dimensions exceed the maximum safe pixel count."
    );
  }

  const bytesPerElevation =
    Float32Array.BYTES_PER_ELEMENT;

  const expectedBytes =
    expectedPixels * bytesPerElevation;

  if (
    !Number.isSafeInteger(expectedBytes) ||
    bytes.byteLength !== expectedBytes
  ) {
    throw new Error(
      `LOLA raster size mismatch. Expected ${expectedBytes} bytes, received ${bytes.byteLength}.`
    );
  }

  // DataView allows explicit little-endian decoding,
  // independent of the host machine's native byte order.
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  );

  const elevations = new Float32Array(expectedPixels);

  let actualMin = Infinity;
  let actualMax = -Infinity;
  let actualNoDataCount = 0;

  for (
    let index = 0;
    index < expectedPixels;
    index++
  ) {
    const byteOffset =
      index * bytesPerElevation;

    const elevation = view.getFloat32(
      byteOffset,
      true
    );

    const isDeclaredNoData =
      metadata.noDataValue === "NaN"
        ? Number.isNaN(elevation)
        : typeof metadata.noDataValue === "number"
          ? elevation === Math.fround(metadata.noDataValue)
          : false;

    if (isDeclaredNoData) {
      actualNoDataCount++;
      elevations[index] = Number.NaN;
      continue;
    }

    if (!Number.isFinite(elevation)) {
      throw new Error(
        `Invalid elevation at binary index ${index}; non-finite values must match an explicitly declared NoData value.`
      );
    }

    elevations[index] = elevation;

    if (elevation < actualMin) {
      actualMin = elevation;
    }

    if (elevation > actualMax) {
      actualMax = elevation;
    }
  }

  if (
    actualNoDataCount !== (metadata.noDataPixelCount ?? 0)
  ) {
    throw new Error(
      `NoData count mismatch. Metadata declares ${metadata.noDataPixelCount ?? 0}, raster contains ${actualNoDataCount}.`
    );
  }

  if (!Number.isFinite(actualMin) || !Number.isFinite(actualMax)) {
    throw new Error("Terrain raster contains no valid finite elevations.");
  }

  if (
    actualMin < metadata.minElevation -
    ELEVATION_RANGE_TOLERANCE_METERS ||
    actualMax > metadata.maxElevation +
    ELEVATION_RANGE_TOLERANCE_METERS
  ) {
    throw new Error(
      "Actual raster elevation values fall outside the metadata elevation range. " +
      `Actual: ${actualMin} to ${actualMax}; ` +
      `metadata: ${metadata.minElevation} to ${metadata.maxElevation}.`
    );
  }

  console.info("[LOLA] Binary decoded:", {
    dimensions: `${metadata.width} x ${metadata.height}`,
    pixelCount: expectedPixels,
    actualMin,
    actualMax,
    metadataMin: metadata.minElevation,
    metadataMax: metadata.maxElevation,
    byteOrder: metadata.byteOrder,
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

/**
 * Loads one registered Product78 site's metadata and elevation raster.
 *
 * Concurrent callers for the same site share a promise. Failed loads are
 * removed from the cache so later requests can retry.
 */
export async function loadLolaTerrainForSite(
  siteId: Product78SiteId = DEFAULT_PRODUCT78_SITE_ID
): Promise<LolaTerrainData> {
  const site = getProduct78Site(siteId);
  const cached = terrainPromises.get(siteId);

  if (cached) return cached;

  const pending = (async () => {
    console.info(`[LOLA] Loading Product78 ${site.archiveSite}...`);

    const dataPath = `/data/${site.dataDirectory}`;
    const [metadataResponse, elevationResponse] = await Promise.all([
      fetch(`${dataPath}/metadata.json`, { cache: "no-store" }),
      fetch(`${dataPath}/elevation.bin`, { cache: "no-store" }),
    ]);

    if (!metadataResponse.ok) {
      throw new Error(
        `Product78 ${site.archiveSite} metadata HTTP error: ${metadataResponse.status}`
      );
    }

    if (!elevationResponse.ok) {
      throw new Error(
        `Product78 ${site.archiveSite} elevation HTTP error: ${elevationResponse.status}`
      );
    }

    const rawMetadata: unknown = await metadataResponse.json();
    const buffer = await elevationResponse.arrayBuffer();
    const terrain = decodeLolaTerrain(rawMetadata, new Uint8Array(buffer));

    console.info("[LOLA] Product78 site loaded:", {
      siteId,
      archiveSite: site.archiveSite,
      dimensions: `${terrain.width} x ${terrain.height}`,
      resolutionMeters: terrain.resolutionMeters,
      noDataPixelCount: terrain.metadata.noDataPixelCount ?? 0,
      binarySizeBytes: buffer.byteLength,
    });

    return terrain;
  })();

  terrainPromises.set(siteId, pending);

  try {
    return await pending;
  } catch (error) {
    if (terrainPromises.get(siteId) === pending) {
      terrainPromises.delete(siteId);
    }
    console.error(`[LOLA] Product78 ${site.archiveSite} load failed:`, error);
    throw error;
  }
}

/**
 * Backwards-compatible Site04 loader.
 */
export async function loadLolaTerrain(): Promise<LolaTerrainData> {
  return loadLolaTerrainForSite(DEFAULT_PRODUCT78_SITE_ID);
}

/**
 * Normalizes east longitude to [0, 360).
 */
function normalizeEastLongitude(
  longitudeDeg: number
): number {
  return ((longitudeDeg % 360) + 360) % 360;
}

/**
 * Converts geographic coordinates to South Polar
 * Stereographic projected coordinates.
 *
 * Assumptions:
 * - Southern lunar polar projection.
 * - Spherical lunar reference radius from metadata.
 * - East longitude.
 * - Central meridian from metadata.
 *
 * Returned coordinates are in metres.
 */
export function geographicToLolaProjected(
  coordinate: GeographicCoordinate,
  metadata: LolaTerrainMetadata
): ProjectedCoordinate {
  const latitude = coordinate.latitudeDeg;
  const longitude = coordinate.longitudeEastDeg;

  assertFinite(latitude, "Latitude");
  assertFinite(longitude, "Longitude");

  if (latitude < -90 || latitude > 0) {
    throw new Error(
      "Latitude must be between -90 and 0 degrees."
    );
  }

  const radius =
    metadata.georeferencing.lunarRadiusMeters;

  const centralMeridian =
    metadata.georeferencing.centralMeridianDegrees;

  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error(
      "Invalid lunar radius in terrain metadata."
    );
  }

  const latitudeFromSouthPole =
    toRadians(90 + latitude);

  const longitudeDifference = toRadians(
    normalizeEastLongitude(longitude) -
    normalizeEastLongitude(centralMeridian)
  );

  // Polar stereographic radial distance.
  const rho =
    2 *
    radius *
    Math.tan(latitudeFromSouthPole / 2);

  const xMeters =
    rho * Math.sin(longitudeDifference);

  const yMeters =
    rho * Math.cos(longitudeDifference);

  if (
    !Number.isFinite(xMeters) ||
    !Number.isFinite(yMeters)
  ) {
    throw new Error(
      "Geographic projection produced invalid coordinates."
    );
  }

  return {
    xMeters,
    yMeters,
  };
}

/**
 * Converts projected coordinates to fractional raster
 * pixel-centre indices.
 *
 * PixelIsArea means the tie point represents an outer
 * pixel corner, while array positions represent pixel
 * centres. The half-pixel offset is therefore required.
 *
 * This implementation assumes the north-up raster
 * rotation term is zero.
 */
export function projectedToLolaPixel(
  projected: ProjectedCoordinate,
  metadata: LolaTerrainMetadata
): RasterPixelCoordinate {
  assertFinite(projected.xMeters, "Projected X");
  assertFinite(projected.yMeters, "Projected Y");

  const tiePoint =
    metadata.georeferencing.tiePoint;

  const [
    pixelWidth,
    pixelHeight,
    pixelRotation,
  ] = metadata.pixelResolution;

  if (
    pixelWidth === 0 ||
    pixelHeight === 0 ||
    Math.abs(pixelRotation) > 1e-10
  ) {
    throw new Error(
      "Unsupported raster pixel transform."
    );
  }

  const column =
    tiePoint.column +
    (projected.xMeters - tiePoint.x) /
    pixelWidth -
    0.5;

  const row =
    tiePoint.row +
    (projected.yMeters - tiePoint.y) /
    pixelHeight -
    0.5;

  if (
    !Number.isFinite(column) ||
    !Number.isFinite(row)
  ) {
    throw new Error(
      "Projected-to-pixel conversion produced invalid coordinates."
    );
  }

  return {
    column,
    row,
  };
}

/**
 * Checks whether a fractional pixel coordinate lies
 * inside the actual PixelIsArea raster footprint.
 *
 * Pixel array centres range from 0 to width - 1.
 * The physical raster footprint extends half a pixel
 * beyond the first and last pixel centres.
 *
 * The maximum boundary is exclusive.
 */
export function isLolaPixelInsideRaster(
  pixel: RasterPixelCoordinate,
  terrain: LolaTerrainData
): boolean {
  if (
    !Number.isFinite(pixel.column) ||
    !Number.isFinite(pixel.row) ||
    !Number.isSafeInteger(terrain.width) ||
    !Number.isSafeInteger(terrain.height) ||
    terrain.width <= 0 ||
    terrain.height <= 0
  ) {
    return false;
  }

  return (
    pixel.column >= -0.5 &&
    pixel.row >= -0.5 &&
    pixel.column < terrain.width - 0.5 &&
    pixel.row < terrain.height - 0.5
  );
}

function lerp(
  a: number,
  b: number,
  t: number
): number {
  return a + (b - a) * t;
}

/**
 * Samples terrain elevation using bilinear interpolation.
 *
 * For locations inside the outer half-pixel edge region,
 * interpolation is clamped to the nearest edge pixel.
 */
export function sampleLolaHeightAtPixel(
  terrain: LolaTerrainData,
  pixel: RasterPixelCoordinate
): number {
  assertFinite(pixel.column, "Pixel column");
  assertFinite(pixel.row, "Pixel row");

  if (!isLolaPixelInsideRaster(pixel, terrain)) {
    throw new Error(
      `Pixel outside raster: column=${pixel.column.toFixed(4)}, ` +
      `row=${pixel.row.toFixed(4)}.`
    );
  }

  if (
    terrain.elevations.length !==
    terrain.width * terrain.height
  ) {
    throw new Error(
      "Elevation array dimensions do not match the terrain raster."
    );
  }

  // Convert footprint coordinates to valid pixel-centre
  // coordinates before interpolation.
  const sampleColumn = Math.max(
    0,
    Math.min(terrain.width - 1, pixel.column)
  );

  const sampleRow = Math.max(
    0,
    Math.min(terrain.height - 1, pixel.row)
  );

  const x0 = Math.floor(sampleColumn);
  const y0 = Math.floor(sampleRow);

  const x1 = Math.min(
    x0 + 1,
    terrain.width - 1
  );

  const y1 = Math.min(
    y0 + 1,
    terrain.height - 1
  );

  const tx = sampleColumn - x0;
  const ty = sampleRow - y0;

  const topLeft =
    terrain.elevations[y0 * terrain.width + x0];

  const topRight =
    terrain.elevations[y0 * terrain.width + x1];

  const bottomLeft =
    terrain.elevations[y1 * terrain.width + x0];

  const bottomRight =
    terrain.elevations[y1 * terrain.width + x1];

  const neighbours = [topLeft, topRight, bottomLeft, bottomRight];

  if (neighbours.some(Number.isNaN)) {
    if (
      terrain.metadata.noDataValue === undefined ||
      terrain.metadata.noDataPixelCount === undefined
    ) {
      throw new Error(
        "Unexpected NaN elevation: the Product78 metadata does not declare a NoData value."
      );
    }

    throw new LolaNoDataError();
  }

  if (!neighbours.every(Number.isFinite)) {
    throw new Error(
      "Invalid non-finite elevation during bilinear interpolation."
    );
  }

  const top = lerp(
    topLeft,
    topRight,
    tx
  );

  const bottom = lerp(
    bottomLeft,
    bottomRight,
    tx
  );

  const elevation = lerp(
    top,
    bottom,
    ty
  );

  if (!Number.isFinite(elevation)) {
    throw new Error(
      "Elevation interpolation produced a non-finite result."
    );
  }

  return elevation;
}

/**
 * Samples LOLA terrain at a geographic location.
 *
 * Returns the original geographic position, projected
 * coordinates, fractional pixel coordinates, nearest
 * pixel and interpolated elevation.
 */
export function sampleLolaHeightAtLocation(
  terrain: LolaTerrainData,
  coordinate: GeographicCoordinate
): LolaSample {
  const projected = geographicToLolaProjected(
    coordinate,
    terrain.metadata
  );

  const pixel = projectedToLolaPixel(
    projected,
    terrain.metadata
  );

  if (!isLolaPixelInsideRaster(pixel, terrain)) {
    throw new Error(
      `Location outside raster: ` +
      `column=${pixel.column.toFixed(4)}, ` +
      `row=${pixel.row.toFixed(4)}.`
    );
  }

  const elevationMeters =
    sampleLolaHeightAtPixel(terrain, pixel);

  const nearestColumn = Math.max(
    0,
    Math.min(
      terrain.width - 1,
      Math.round(pixel.column)
    )
  );

  const nearestRow = Math.max(
    0,
    Math.min(
      terrain.height - 1,
      Math.round(pixel.row)
    )
  );

  return {
    geographic: coordinate,
    projected,
    pixel,

    nearestPixel: {
      column: nearestColumn,
      row: nearestRow,
    },

    elevationMeters,
  };
}

/**
 * Samples the predefined Site04 observer location.
 */
export function sampleSite04Elevation(
  terrain: LolaTerrainData
): LolaSample {
  return sampleLolaHeightAtLocation(
    terrain,
    SITE04_COORDINATES
  );
}
