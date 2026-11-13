
import { fromUrl, type GeoTIFFImage } from "geotiff";

/**
 * NASA LOLA Product 90
 *
 * Source:
 * https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF
 *
 * Official NASA PGDA dataset description:
 * - Coverage: 80°S to 90°S
 * - Raster dimensions: expected 30,400 × 30,400
 * - Pixel spacing: 20 metres
 * - Data: surface elevation in metres
 * - Projection: South Polar Stereographic
 * - Horizontal reference frame: MOON_ME
 * - Ephemeris: DE421
 *
 * This is a server-only module because it retrieves a large
 * remote Cloud Optimized GeoTIFF and performs tile sampling.
 *
 * IMPORTANT:
 * Pixel spacing is not necessarily the same as effective
 * terrain resolution. Use NASA's effective-resolution and
 * uncertainty products when evaluating terrain quality.
 */

const PRODUCT90_URL =
  "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF";

const EXPECTED_WIDTH = 30_400;
const EXPECTED_HEIGHT = 30_400;
const EXPECTED_PIXEL_SIZE_METERS = 20;

const EXPECTED_ORIGIN_X = -304_000;
const EXPECTED_ORIGIN_Y = 304_000;

const EXPECTED_BBOX = {
  minX: -304_000,
  minY: -304_000,
  maxX: 304_000,
  maxY: 304_000,
};

const GEOREFERENCE_TOLERANCE_METERS = 1;

const MAX_CACHED_TILES = 24;
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 500;

type Product90Tile = {
  x: number;
  y: number;
  width: number;
  height: number;
  elevations: Float32Array;
};

type PixelCoordinate = {
  column: number;
  row: number;
};

type Product90RasterInfo = {
  originX: number;
  originY: number;

  pixelWidth: number;
  pixelHeight: number;

  minX: number;
  minY: number;
  maxX: number;
  maxY: number;

  tileWidth: number;
  tileHeight: number;

  samplesPerPixel: number;
  sampleFormat: number;
  bitsPerSample: number;

  noData: number | null;

  pixelIsArea: boolean;

  modelTypeGeoKey: number | undefined;
  rasterTypeGeoKey: number | undefined;
  linearUnitsGeoKey: number | undefined;
};

type TileCacheEntry = {
  promise: Promise<Product90Tile>;
  status: "pending" | "fulfilled";
};

let imagePromise: Promise<GeoTIFFImage> | null = null;

let rasterInfo: Product90RasterInfo | null = null;

/**
 * Tile cache.
 *
 * Each entry stores a promise so simultaneous requests for
 * the same tile share one remote download.
 *
 * Pending tiles are not evicted. The cache can temporarily
 * exceed its configured size when many different tiles are
 * downloading concurrently. It is trimmed when downloads
 * finish.
 */
const tileCache = new Map<string, TileCacheEntry>();

function assertFinite(
  value: number,
  name: string
): void {
  if (!Number.isFinite(value)) {
    throw new Error(
      `${name} must be finite. Received: ${value}`
    );
  }
}

function approximatelyEqual(
  actual: number,
  expected: number,
  tolerance = GEOREFERENCE_TOLERANCE_METERS
): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Validates the actual GeoTIFF metadata.
 *
 * We do not trust hard-coded dimensions and coordinates
 * without comparing them against the opened TIFF.
 */
function validateProduct90Image(
  image: GeoTIFFImage
): Product90RasterInfo {
  const width = image.getWidth();
  const height = image.getHeight();

  if (
    width !== EXPECTED_WIDTH ||
    height !== EXPECTED_HEIGHT
  ) {
    throw new Error(
      `Unexpected Product 90 dimensions: ` +
      `${width} × ${height}. Expected: ` +
      `${EXPECTED_WIDTH} × ${EXPECTED_HEIGHT}.`
    );
  }

  const origin = image.getOrigin();
  const resolution = image.getResolution();
  const bbox = image.getBoundingBox();

  if (
    origin.length < 2 ||
    resolution.length < 2 ||
    bbox.length !== 4
  ) {
    throw new Error(
      "Product 90 GeoTIFF has incomplete georeferencing metadata."
    );
  }

  const originX = origin[0];
  const originY = origin[1];

  const pixelWidth = resolution[0];
  const pixelHeight = resolution[1];

  const [minX, minY, maxX, maxY] = bbox;

  assertFinite(originX, "Product 90 origin X");
  assertFinite(originY, "Product 90 origin Y");

  assertFinite(pixelWidth, "Product 90 pixel width");
  assertFinite(pixelHeight, "Product 90 pixel height");

  for (const [name, value] of [
    ["minimum X", minX],
    ["minimum Y", minY],
    ["maximum X", maxX],
    ["maximum Y", maxY],
  ] as const) {
    assertFinite(value, `Product 90 bounding box ${name}`);
  }

  // Verify the expected upper-left coordinate.
  if (
    !approximatelyEqual(originX, EXPECTED_ORIGIN_X) ||
    !approximatelyEqual(originY, EXPECTED_ORIGIN_Y)
  ) {
    throw new Error(
      "Product 90 origin does not match the expected " +
      `South Polar Stereographic grid. Received: ` +
      `(${originX}, ${originY}).`
    );
  }

  // Verify pixel spacing and orientation.
  if (
    !approximatelyEqual(
      pixelWidth,
      EXPECTED_PIXEL_SIZE_METERS,
      0.001
    ) ||
    !approximatelyEqual(
      pixelHeight,
      -EXPECTED_PIXEL_SIZE_METERS,
      0.001
    )
  ) {
    throw new Error(
      "Product 90 pixel resolution or orientation is unexpected. " +
      `Received: (${pixelWidth}, ${pixelHeight}).`
    );
  }

  // Verify that the actual bounding box agrees with
  // the raster origin, dimensions and resolution.
  const expectedMinX =
    originX;

  const expectedMaxX =
    originX + width * pixelWidth;

  const expectedMaxY =
    originY;

  const expectedMinY =
    originY + height * pixelHeight;

  const bboxChecks = [
    {
      name: "minimum X",
      actual: minX,
      expected: expectedMinX,
    },
    {
      name: "minimum Y",
      actual: minY,
      expected: expectedMinY,
    },
    {
      name: "maximum X",
      actual: maxX,
      expected: expectedMaxX,
    },
    {
      name: "maximum Y",
      actual: maxY,
      expected: expectedMaxY,
    },
  ];

  for (const check of bboxChecks) {
    if (!approximatelyEqual(check.actual, check.expected)) {
      throw new Error(
        `Product 90 bounding box ${check.name} mismatch. ` +
        `Received ${check.actual}; expected ${check.expected}.`
      );
    }
  }

  // Also compare against the expected published grid.
  if (
    !approximatelyEqual(minX, EXPECTED_BBOX.minX) ||
    !approximatelyEqual(minY, EXPECTED_BBOX.minY) ||
    !approximatelyEqual(maxX, EXPECTED_BBOX.maxX) ||
    !approximatelyEqual(maxY, EXPECTED_BBOX.maxY)
  ) {
    throw new Error(
      "Product 90 extent does not match the configured dataset grid."
    );
  }

  // Verify PixelIsArea registration.
  const pixelIsArea = image.pixelIsArea();

  if (!pixelIsArea) {
    throw new Error(
      "Product 90 is not registered as PixelIsArea."
    );
  }

  // Check the actual GeoTIFF sample layout.
  const samplesPerPixel = image.getSamplesPerPixel();

  const sampleFormat = image.getSampleFormat(0);
  const bitsPerSample = image.getBitsPerSample(0);

  // TIFF SampleFormat:
  // 1 = unsigned integer
  // 2 = signed integer
  // 3 = floating point
  if (samplesPerPixel !== 1) {
    throw new Error(
      `Expected one Product 90 elevation band. Received ${samplesPerPixel}.`
    );
  }

  if (sampleFormat !== 3 || bitsPerSample !== 32) {
    throw new Error(
      "Product 90 is not encoded as single-band Float32. " +
      `SampleFormat=${sampleFormat}, BitsPerSample=${bitsPerSample}.`
    );
  }

  // Check GeoTIFF coordinate-system keys when available.
  const geoKeys = image.getGeoKeys();

  const modelTypeGeoKey =
    geoKeys?.GTModelTypeGeoKey as number | undefined;

  const rasterTypeGeoKey =
    geoKeys?.GTRasterTypeGeoKey as number | undefined;

  const linearUnitsGeoKey =
    geoKeys?.ProjLinearUnitsGeoKey as number | undefined;

  // GeoTIFF ModelTypeProjected = 1.
  if (
    modelTypeGeoKey !== undefined &&
    modelTypeGeoKey !== 1
  ) {
    throw new Error(
      `Expected projected GeoTIFF coordinates. ` +
      `GTModelTypeGeoKey=${modelTypeGeoKey}.`
    );
  }

  // GeoTIFF RasterPixelIsArea = 1.
  if (
    rasterTypeGeoKey !== undefined &&
    rasterTypeGeoKey !== 1
  ) {
    throw new Error(
      `Expected PixelIsArea GeoTIFF registration. ` +
      `GTRasterTypeGeoKey=${rasterTypeGeoKey}.`
    );
  }

  // Linear units code 9001 means metres.
  if (
    linearUnitsGeoKey !== undefined &&
    linearUnitsGeoKey !== 9001
  ) {
    throw new Error(
      `Expected projected coordinates in metres. ` +
      `ProjLinearUnitsGeoKey=${linearUnitsGeoKey}.`
    );
  }

  const tileWidth = image.getTileWidth();
  const tileHeight = image.getTileHeight();

  if (
    !Number.isSafeInteger(tileWidth) ||
    !Number.isSafeInteger(tileHeight) ||
    tileWidth <= 0 ||
    tileHeight <= 0
  ) {
    throw new Error(
      `Invalid Product 90 TIFF tile dimensions: ` +
      `${tileWidth} × ${tileHeight}.`
    );
  }

  // Read the actual GDAL NoData value.
  const noData = image.getGDALNoData();

  // The TIFF may legitimately have no explicit NoData tag.
  // Non-finite elevation samples will still be rejected.
  if (
    noData !== null &&
    typeof noData !== "number"
  ) {
    throw new Error(
      "Product 90 NoData metadata is invalid."
    );
  }

  return {
    originX,
    originY,

    pixelWidth,
    pixelHeight,

    minX,
    minY,
    maxX,
    maxY,

    tileWidth,
    tileHeight,

    samplesPerPixel,
    sampleFormat,
    bitsPerSample,

    noData,

    pixelIsArea,

    modelTypeGeoKey,
    rasterTypeGeoKey,
    linearUnitsGeoKey,
  };
}

/**
 * Opens the NASA Product 90 GeoTIFF.
 *
 * The source is opened only once. If opening or metadata
 * validation fails, the promise is reset so a later request
 * can retry.
 */
function getImage(): Promise<GeoTIFFImage> {
  if (imagePromise) {
    return imagePromise;
  }

  imagePromise = (async () => {
    console.info("[Product 90] Opening NASA GeoTIFF...");

    const tiff = await fromUrl(PRODUCT90_URL, {
      // Do not combine multiple byte ranges into one request.
      // This keeps remote COG requests predictable.
      maxRanges: 0,
    });

    // Let our own 24-tile LRU cache manage decoded tiles.
    tiff.cache = false;

    const image = await tiff.getImage();

    const validatedInfo =
      validateProduct90Image(image);

    rasterInfo = validatedInfo;

    console.info("[Product 90] GeoTIFF validated:", {
      dimensions: `${image.getWidth()} × ${image.getHeight()}`,
      resolution: [
        validatedInfo.pixelWidth,
        validatedInfo.pixelHeight,
      ],
      origin: [
        validatedInfo.originX,
        validatedInfo.originY,
      ],
      boundingBox: [
        validatedInfo.minX,
        validatedInfo.minY,
        validatedInfo.maxX,
        validatedInfo.maxY,
      ],
      pixelRegistration: "PixelIsArea",
      sampleFormat: validatedInfo.sampleFormat,
      bitsPerSample: validatedInfo.bitsPerSample,
      noData: validatedInfo.noData,
      tileDimensions: [
        validatedInfo.tileWidth,
        validatedInfo.tileHeight,
      ],
      referenceFrame: "MOON_ME",
      ephemeris: "DE421",
    });

    return image;
  })().catch((error) => {
    imagePromise = null;
    rasterInfo = null;

    console.error(
      "[Product 90] GeoTIFF initialization failed:",
      error
    );

    throw error;
  });

  return imagePromise;
}

/**
 * Converts projected lunar coordinates into Product 90
 * fractional pixel-centre coordinates.
 *
 * Uses the actual validated GeoTIFF origin and resolution.
 *
 * PixelIsArea requires a half-pixel offset because the
 * GeoTIFF origin identifies the outer corner of the
 * upper-left pixel.
 */
function projectedToPixel(
  x: number,
  y: number
): PixelCoordinate {
  if (!rasterInfo) {
    throw new Error(
      "Product 90 raster metadata has not been initialized."
    );
  }

  assertFinite(x, "Projected X");
  assertFinite(y, "Projected Y");

  return {
    column:
      (x - rasterInfo.originX) /
      rasterInfo.pixelWidth -
      0.5,

    row:
      (y - rasterInfo.originY) /
      rasterInfo.pixelHeight -
      0.5,
  };
}

/**
 * Checks whether a fractional pixel coordinate falls
 * inside the physical PixelIsArea raster footprint.
 *
 * The raster extends half a pixel beyond its first and
 * last pixel centres.
 */
function isInsideRasterFootprint(
  column: number,
  row: number
): boolean {
  return (
    Number.isFinite(column) &&
    Number.isFinite(row) &&
    column >= -0.5 &&
    row >= -0.5 &&
    column < EXPECTED_WIDTH - 0.5 &&
    row < EXPECTED_HEIGHT - 0.5
  );
}

/**
 * Validates an elevation against both finite-value and
 * actual TIFF NoData conditions.
 */
function isValidElevation(value: number): boolean {
  if (!Number.isFinite(value)) {
    return false;
  }

  if (!rasterInfo || rasterInfo.noData === null) {
    return true;
  }

  const noData = rasterInfo.noData;

  if (Number.isNaN(noData)) {
    return true;
  }

  return value !== noData;
}

/**
 * Removes the oldest completed cache entries until the
 * configured maximum is reached.
 *
 * Pending entries are deliberately not removed.
 */
function trimTileCache(): void {
  while (tileCache.size > MAX_CACHED_TILES) {
    let removedEntry = false;

    for (const [key, entry] of tileCache) {
      if (entry.status === "fulfilled") {
        tileCache.delete(key);
        removedEntry = true;
        break;
      }
    }

    // All remaining entries are still downloading.
    // Keep them until they finish.
    if (!removedEntry) {
      break;
    }
  }
}

/**
 * Moves a cache entry to the newest position.
 */
function touchCacheEntry(
  key: string,
  entry: TileCacheEntry
): void {
  tileCache.delete(key);
  tileCache.set(key, entry);
}

/**
 * Loads one actual GeoTIFF tile.
 *
 * Tile dimensions are obtained from the actual TIFF,
 * rather than being assumed to be 512 × 512.
 *
 * Remote read failures are retried with exponential
 * backoff. Invalid data returned by the TIFF reader is
 * rejected rather than retried as a network failure.
 */
async function loadTile(
  tileX: number,
  tileY: number
): Promise<Product90Tile> {
  const image = await getImage();

  if (!rasterInfo) {
    throw new Error(
      "Product 90 metadata is unavailable."
    );
  }

  if (
    !Number.isSafeInteger(tileX) ||
    !Number.isSafeInteger(tileY) ||
    tileX < 0 ||
    tileY < 0
  ) {
    throw new Error(
      `Invalid Product 90 tile coordinates: ${tileX}, ${tileY}.`
    );
  }

  const tileWidth = rasterInfo.tileWidth;
  const tileHeight = rasterInfo.tileHeight;

  const x0 = tileX * tileWidth;
  const y0 = tileY * tileHeight;

  if (
    x0 < 0 ||
    y0 < 0 ||
    x0 >= EXPECTED_WIDTH ||
    y0 >= EXPECTED_HEIGHT
  ) {
    throw new Error(
      `Product 90 tile is outside the raster: ${tileX}, ${tileY}.`
    );
  }

  const x1 = Math.min(
    x0 + tileWidth,
    EXPECTED_WIDTH
  );

  const y1 = Math.min(
    y0 + tileHeight,
    EXPECTED_HEIGHT
  );

  const expectedWidth = x1 - x0;
  const expectedHeight = y1 - y0;

  const expectedValues =
    expectedWidth * expectedHeight;

  let raster: unknown;
  let lastError: unknown;

  let successfulRead = false;

  for (
    let attempt = 1;
    attempt <= MAX_RETRIES;
    attempt++
  ) {
    try {
      raster = await image.readRasters({
        window: [x0, y0, x1, y1],
        samples: [0],
        interleave: true,
      });

      successfulRead = true;
      break;
    } catch (error) {
      lastError = error;

      if (attempt < MAX_RETRIES) {
        const waitMilliseconds =
          INITIAL_RETRY_DELAY_MS *
          2 ** (attempt - 1);

        console.warn(
          `[Product 90] Tile ${tileX},${tileY} read failed. ` +
          `Retry ${attempt}/${MAX_RETRIES - 1} in ` +
          `${waitMilliseconds} ms.`,
          error
        );

        await delay(waitMilliseconds);
      }
    }
  }

  if (!successfulRead) {
    throw new Error(
      `Failed to load Product 90 tile ${tileX},${tileY} ` +
      `after ${MAX_RETRIES} attempts: ` +
      `${lastError instanceof Error
        ? lastError.message
        : String(lastError)
      }`
    );
  }

  // Product 90 is required to be single-band Float32.
  if (!(raster instanceof Float32Array)) {
    throw new Error(
      `Tile ${tileX},${tileY} did not return Float32Array data.`
    );
  }

  if (raster.length !== expectedValues) {
    throw new Error(
      `Tile ${tileX},${tileY}: expected ` +
      `${expectedValues} values, received ${raster.length}.`
    );
  }

  return {
    x: x0,
    y: y0,
    width: expectedWidth,
    height: expectedHeight,
    elevations: raster,
  };
}

/**
 * Returns a cached tile or loads it remotely.
 *
 * Requests for the same tile share a single promise.
 * Failed requests are removed from the cache so they can
 * be attempted again later.
 */


async function getTile(
  tileX: number,
  tileY: number
): Promise<Product90Tile> {
  const key = `${tileX}:${tileY}`;

  const cached = tileCache.get(key);

  if (cached) {
    touchCacheEntry(key, cached);
    return cached.promise;
  }

  const entry: TileCacheEntry = {
    status: "pending",

    promise: loadTile(tileX, tileY).then(
      (tile) => {
        if (tileCache.get(key) === entry) {
          entry.status = "fulfilled";
          trimTileCache();
        }

        return tile;
      },

      (error: unknown) => {
        if (tileCache.get(key) === entry) {
          tileCache.delete(key);
        }

        throw error;
      }
    ),
  };

  tileCache.set(key, entry);

  return entry.promise;
}


/**
 * Reads one elevation value using integer pixel coordinates.
 *
 * Returns null if:
 * - The pixel is outside the raster.
 * - The value is non-finite.
 * - The value matches the GeoTIFF NoData value.
 *
 * Remote tile failures throw errors instead of being
 * silently interpreted as missing terrain.
 */
async function readPixel(
  column: number,
  row: number
): Promise<number | null> {
  if (
    !Number.isInteger(column) ||
    !Number.isInteger(row) ||
    column < 0 ||
    row < 0 ||
    column >= EXPECTED_WIDTH ||
    row >= EXPECTED_HEIGHT
  ) {
    return null;
  }

  if (!rasterInfo) {
    throw new Error(
      "Product 90 raster metadata has not been initialized."
    );
  }

  const tileX = Math.floor(
    column / rasterInfo.tileWidth
  );

  const tileY = Math.floor(
    row / rasterInfo.tileHeight
  );

  const tile = await getTile(tileX, tileY);

  const localX = column - tile.x;
  const localY = row - tile.y;

  if (
    localX < 0 ||
    localY < 0 ||
    localX >= tile.width ||
    localY >= tile.height
  ) {
    throw new Error(
      "Product 90 tile indexing produced an invalid local pixel."
    );
  }

  const index =
    localY * tile.width + localX;

  const elevation = tile.elevations[index];

  return isValidElevation(elevation)
    ? elevation
    : null;
}

/**
 * Samples Product 90 elevation at projected Moon coordinates.
 *
 * Uses bilinear interpolation between four surrounding
 * raster pixel centres.
 *
 * The sample is returned in metres.
 *
 * Returns null when the position is outside raster coverage
 * or any required interpolation pixel is NoData.
 *
 * Remote read failures are propagated as errors.
 */
export async function sampleProduct90Elevation(
  x: number,
  y: number
): Promise<number | null> {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  // Initialize and validate the real GeoTIFF before sampling.
  await getImage();

  if (!rasterInfo) {
    throw new Error(
      "Product 90 raster metadata is unavailable."
    );
  }

  const pixel = projectedToPixel(x, y);

  if (
    !isInsideRasterFootprint(
      pixel.column,
      pixel.row
    )
  ) {
    return null;
  }

  // Clamp positions within the outer half-pixel footprint
  // to the nearest available pixel centre.
  const sampleColumn = Math.max(
    0,
    Math.min(
      EXPECTED_WIDTH - 1,
      pixel.column
    )
  );

  const sampleRow = Math.max(
    0,
    Math.min(
      EXPECTED_HEIGHT - 1,
      pixel.row
    )
  );

  const column0 = Math.floor(sampleColumn);
  const row0 = Math.floor(sampleRow);

  const column1 = Math.min(
    column0 + 1,
    EXPECTED_WIDTH - 1
  );

  const row1 = Math.min(
    row0 + 1,
    EXPECTED_HEIGHT - 1
  );

  const tx = sampleColumn - column0;
  const ty = sampleRow - row0;

  const [
    topLeft,
    topRight,
    bottomLeft,
    bottomRight,
  ] = await Promise.all([
    readPixel(column0, row0),
    readPixel(column1, row0),
    readPixel(column0, row1),
    readPixel(column1, row1),
  ]);

  // Do not interpolate across NoData gaps.
  if (
    topLeft === null ||
    topRight === null ||
    bottomLeft === null ||
    bottomRight === null
  ) {
    return null;
  }

  const top =
    topLeft * (1 - tx) +
    topRight * tx;

  const bottom =
    bottomLeft * (1 - tx) +
    bottomRight * tx;

  const elevation =
    top * (1 - ty) +
    bottom * ty;

  return Number.isFinite(elevation)
    ? elevation
    : null;
}



/**
 * Batch-samples Product 90 elevations at projected
 * lunar coordinates.
 *
 * Loads each unique TIFF tile needed by the batch once,
 * then performs bilinear interpolation using the loaded tiles.
 *
 * The result order matches the input coordinate order.
 */

export async function sampleProduct90Elevations(
  coordinates: readonly {
    x: number;
    y: number;
  }[]
): Promise<Array<number | null>> {
  if (coordinates.length === 0) {
    return [];
  }

  // Initialize the GeoTIFF once for the whole batch.
  await getImage();

  if (!rasterInfo) {
    throw new Error(
      "Product 90 raster metadata is unavailable."
    );
  }

  type PreparedSample = {
    column0: number;
    row0: number;
    column1: number;
    row1: number;
    tx: number;
    ty: number;
  } | null;

  const preparedSamples: PreparedSample[] = [];

  const requiredTiles = new Map<
    string,
    { tileX: number; tileY: number }
  >();

  const tileWidth = rasterInfo.tileWidth;
  const tileHeight = rasterInfo.tileHeight;

  function registerPixel(
    column: number,
    row: number
  ): void {
    const tileX = Math.floor(column / tileWidth);
    const tileY = Math.floor(row / tileHeight);
    const key = `${tileX}:${tileY}`;

    if (!requiredTiles.has(key)) {
      requiredTiles.set(key, { tileX, tileY });
    }
  }

  // Phase 1: Prepare pixel coordinates and identify
  // all unique TIFF tiles required by this batch.
  for (const coordinate of coordinates) {
    if (
      !Number.isFinite(coordinate.x) ||
      !Number.isFinite(coordinate.y)
    ) {
      preparedSamples.push(null);
      continue;
    }

    const pixel = projectedToPixel(
      coordinate.x,
      coordinate.y
    );

    if (
      !isInsideRasterFootprint(
        pixel.column,
        pixel.row
      )
    ) {
      preparedSamples.push(null);
      continue;
    }

    const sampleColumn = Math.max(
      0,
      Math.min(EXPECTED_WIDTH - 1, pixel.column)
    );

    const sampleRow = Math.max(
      0,
      Math.min(EXPECTED_HEIGHT - 1, pixel.row)
    );

    const column0 = Math.floor(sampleColumn);
    const row0 = Math.floor(sampleRow);

    const column1 = Math.min(
      column0 + 1,
      EXPECTED_WIDTH - 1
    );

    const row1 = Math.min(
      row0 + 1,
      EXPECTED_HEIGHT - 1
    );

    const tx = sampleColumn - column0;
    const ty = sampleRow - row0;

    preparedSamples.push({
      column0,
      row0,
      column1,
      row1,
      tx,
      ty,
    });

    registerPixel(column0, row0);
    registerPixel(column1, row0);
    registerPixel(column0, row1);
    registerPixel(column1, row1);
  }

  // Phase 2: Load unique tiles through the existing
  // shared cache, with controlled concurrency.
  const requiredTileEntries = Array.from(
    requiredTiles.entries()
  );

  const loadedTiles = new Map<string, Product90Tile>();

  let nextTileIndex = 0;
  let tileLoadFailed = false;
  let firstTileLoadError: unknown;

  // Maximum simultaneous tile loads for this batch.
  const TILE_LOAD_CONCURRENCY = 2;

  const workerCount = Math.min(
    TILE_LOAD_CONCURRENCY,
    requiredTileEntries.length
  );

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (!tileLoadFailed) {
        const currentIndex = nextTileIndex++;

        if (
          currentIndex >= requiredTileEntries.length
        ) {
          return;
        }

        const [key, tileCoordinates] =
          requiredTileEntries[currentIndex];

        try {
          const tile = await getTile(
            tileCoordinates.tileX,
            tileCoordinates.tileY
          );

          loadedTiles.set(key, tile);
        } catch (error: unknown) {
          if (!tileLoadFailed) {
            tileLoadFailed = true;
            firstTileLoadError = error;
          }

          return;
        }
      }
    })
  );

  // Do not return incomplete elevation results after
  // a failed remote tile request.
  if (tileLoadFailed) {
    throw firstTileLoadError;
  }

  // Read a pixel directly from an already-loaded tile.
  function readLoadedPixel(
    column: number,
    row: number
  ): number | null {
    const tileX = Math.floor(column / tileWidth);
    const tileY = Math.floor(row / tileHeight);

    const key = `${tileX}:${tileY}`;
    const tile = loadedTiles.get(key);

    if (!tile) {
      throw new Error(
        `Product 90 batch is missing tile ${key}.`
      );
    }

    const localX = column - tile.x;
    const localY = row - tile.y;

    if (
      localX < 0 ||
      localY < 0 ||
      localX >= tile.width ||
      localY >= tile.height
    ) {
      throw new Error(
        `Invalid local pixel coordinates in tile ${key}.`
      );
    }

    const index = localY * tile.width + localX;
    const elevation = tile.elevations[index];

    return isValidElevation(elevation)
      ? elevation
      : null;
  }

  // Phase 3: Perform bilinear interpolation without
  // additional asynchronous pixel reads.
  return preparedSamples.map((sample) => {
    if (sample === null) {
      return null;
    }

    const {
      column0,
      row0,
      column1,
      row1,
      tx,
      ty,
    } = sample;

    const topLeft = readLoadedPixel(
      column0,
      row0
    );

    const topRight = readLoadedPixel(
      column1,
      row0
    );

    const bottomLeft = readLoadedPixel(
      column0,
      row1
    );

    const bottomRight = readLoadedPixel(
      column1,
      row1
    );

    // Do not interpolate across invalid or NoData pixels.
    if (
      topLeft === null ||
      topRight === null ||
      bottomLeft === null ||
      bottomRight === null
    ) {
      return null;
    }

    const top =
      topLeft * (1 - tx) + topRight * tx;

    const bottom =
      bottomLeft * (1 - tx) + bottomRight * tx;

    const elevation =
      top * (1 - ty) + bottom * ty;

    return Number.isFinite(elevation)
      ? elevation
      : null;
  });
}


/**
 * Returns validated Product 90 source diagnostics.
 *
 * Use this to test the remote GeoTIFF before running
 * thousands of terrain samples.
 */
export async function getProduct90Diagnostics() {
  const image = await getImage();

  if (!rasterInfo) {
    throw new Error(
      "Product 90 raster metadata is unavailable."
    );
  }

  return {
    source: PRODUCT90_URL,

    dataset: {
      name: "NASA LOLA Product 90",
      referenceFrame: "MOON_ME",
      ephemeris: "DE421",
      projection: "South Polar Stereographic",
      linearUnits: "metres",
    },

    raster: {
      width: image.getWidth(),
      height: image.getHeight(),

      originX: rasterInfo.originX,
      originY: rasterInfo.originY,

      pixelWidth: rasterInfo.pixelWidth,
      pixelHeight: rasterInfo.pixelHeight,

      boundingBox: [
        rasterInfo.minX,
        rasterInfo.minY,
        rasterInfo.maxX,
        rasterInfo.maxY,
      ],

      pixelIsArea: rasterInfo.pixelIsArea,

      samplesPerPixel: rasterInfo.samplesPerPixel,
      sampleFormat: rasterInfo.sampleFormat,
      bitsPerSample: rasterInfo.bitsPerSample,

      noData: rasterInfo.noData,

      tileWidth: rasterInfo.tileWidth,
      tileHeight: rasterInfo.tileHeight,
    },

    geoKeys: {
      modelType: rasterInfo.modelTypeGeoKey,
      rasterType: rasterInfo.rasterTypeGeoKey,
      linearUnits: rasterInfo.linearUnitsGeoKey,
    },

    validation: {
      dimensions: true,
      origin: true,
      resolution: true,
      boundingBox: true,
      pixelRegistration: true,
      float32Encoding: true,
    },
  };
}

/**
 * Returns useful cache diagnostics.
 */
export function getProduct90CacheStats() {
  let pendingTiles = 0;
  let completedTiles = 0;

  for (const entry of tileCache.values()) {
    if (entry.status === "pending") {
      pendingTiles++;
    } else {
      completedTiles++;
    }
  }

  return {
    cachedTiles: tileCache.size,
    pendingTiles,
    completedTiles,

    maximumCachedTiles: MAX_CACHED_TILES,

    rasterWidth: EXPECTED_WIDTH,
    rasterHeight: EXPECTED_HEIGHT,

    resolutionMeters: EXPECTED_PIXEL_SIZE_METERS,

    validatedSource: rasterInfo !== null,

    tileWidth: rasterInfo?.tileWidth ?? null,
    tileHeight: rasterInfo?.tileHeight ?? null,
  };
}

/**
 * Clears cached tile promises and completed tile data.
 *
 * Does not close the GeoTIFF source or discard its
 * validated metadata.
 */
export function clearProduct90TileCache(): void {
  tileCache.clear();
}
