
import fs from "node:fs/promises";
import { fromUrl } from "geotiff";

const PRODUCT90_URL =
  "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF";

const SITE04_DIR = "public/data/site04_shackleton_rim";

const SITE04_WIDTH = 3200;
const SITE04_HEIGHT = 3200;
const SITE04_PIXEL_SIZE = 5;
const SITE04_ORIGIN_X = -9000;
const SITE04_ORIGIN_Y = 1000;

const PRODUCT90_ORIGIN_X = -304000;
const PRODUCT90_ORIGIN_Y = 304000;
const PRODUCT90_PIXEL_SIZE = 20;

const FRACTIONS = [0.1, 0.3, 0.5, 0.7, 0.9];
const MAX_ATTEMPTS = 5;

function bilinear(a, b, c, d, fx, fy) {
  return (
    a * (1 - fx) * (1 - fy) +
    b * fx * (1 - fy) +
    c * (1 - fx) * fy +
    d * fx * fy
  );
}

function sampleSite04(buffer, col, row) {
  const x0 = Math.floor(col);
  const y0 = Math.floor(row);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  if (
    x0 < 0 || y0 < 0 ||
    x1 >= SITE04_WIDTH ||
    y1 >= SITE04_HEIGHT
  ) return NaN;

  const read = (x, y) =>
    buffer.readFloatLE((y * SITE04_WIDTH + x) * 4);

  const values = [
    read(x0, y0),
    read(x1, y0),
    read(x0, y1),
    read(x1, y1),
  ];

  if (!values.every(Number.isFinite)) return NaN;

  return bilinear(...values, col - x0, row - y0);
}

function projectedToProductPixel(x, y) {
  return {
    col:
      (x - PRODUCT90_ORIGIN_X) /
      PRODUCT90_PIXEL_SIZE - 0.5,
    row:
      (PRODUCT90_ORIGIN_Y - y) /
      PRODUCT90_PIXEL_SIZE - 0.5,
  };
}

function getPixel(tiles, col, row, tileSize) {
  const tx = Math.floor(col / tileSize);
  const ty = Math.floor(row / tileSize);

  const tile = tiles.get(`${tx},${ty}`);

  if (!tile) {
    throw new Error(`Missing tile ${tx},${ty}`);
  }

  const localX = col - tx * tileSize;
  const localY = row - ty * tileSize;

  return tile[localY * tileSize + localX];
}

function sampleProduct90(tiles, col, row, tileSize) {
  const x0 = Math.floor(col);
  const y0 = Math.floor(row);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const values = [
    getPixel(tiles, x0, y0, tileSize),
    getPixel(tiles, x1, y0, tileSize),
    getPixel(tiles, x0, y1, tileSize),
    getPixel(tiles, x1, y1, tileSize),
  ];

  if (!values.every(Number.isFinite)) return NaN;

  return bilinear(...values, col - x0, row - y0);
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadTileWithRetry(image, tx, ty, attempts = MAX_ATTEMPTS) {
  const tileWidth = image.getTileWidth();
  const tileHeight = image.getTileHeight();

  const x0 = tx * tileWidth;
  const y0 = ty * tileHeight;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      console.log(
        `Loading tile (${tx}, ${ty}) — attempt ${attempt}/${attempts}`
      );

      const raster = await image.readRasters({
        window: [
          x0,
          y0,
          x0 + tileWidth,
          y0 + tileHeight,
        ],
        interleave: true,
      });

      if (raster.length !== tileWidth * tileHeight) {
        throw new Error(
          `Unexpected tile size: ${raster.length}`
        );
      }

      console.log(
        `SUCCESS: Tile (${tx}, ${ty}), ${raster.length} samples`
      );

      return raster;
    } catch (error) {
      console.error(
        `Tile (${tx}, ${ty}) attempt ${attempt} failed:`,
        error.message
      );

      if (attempt === attempts) {
        throw new Error(
          `Tile (${tx}, ${ty}) failed after ${attempts} attempts. ${error.message}`
        );
      }

      const delay = attempt * 3000;

      console.log(`Waiting ${delay / 1000}s before retry...`);
      await wait(delay);
    }
  }

  throw new Error(`Unable to load tile (${tx}, ${ty})`);
}

async function main() {
  console.log("=== NASA LOLA SEQUENTIAL OVERLAP VALIDATION ===");
  console.log("Site04 5 m/pixel vs Product 90 20 m/pixel");
  console.log("Remote tile reading with automatic retries.\n");

  // Load Site04 elevation data.
  const buffer = await fs.readFile(
    `${SITE04_DIR}/elevation.bin`
  );

  const expectedSize =
    SITE04_WIDTH * SITE04_HEIGHT * 4;

  if (buffer.length !== expectedSize) {
    throw new Error(
      `Site04 binary size mismatch: ${buffer.length}; expected ${expectedSize}`
    );
  }

  console.log(
    "Site04 binary verified:",
    buffer.length,
    "bytes"
  );

  // Open Product 90.
  const tiff = await fromUrl(PRODUCT90_URL, {
    maxRanges: 0,
  });

  const image = await tiff.getImage();

  const tileSize = image.getTileWidth();

  console.log(
    "Product 90:",
    image.getWidth(),
    "x",
    image.getHeight()
  );

  console.log(
    "Tile size:",
    tileSize,
    "x",
    image.getTileHeight()
  );

  // Generate 25 matching sample locations.
  const samples = [];

  for (const fy of FRACTIONS) {
    for (const fx of FRACTIONS) {
      const col = fx * (SITE04_WIDTH - 1);
      const row = fy * (SITE04_HEIGHT - 1);

      const siteElevation =
        sampleSite04(buffer, col, row);

      // Site04 pixel-centre coordinates.
      const x =
        SITE04_ORIGIN_X +
        (col + 0.5) * SITE04_PIXEL_SIZE;

      const y =
        SITE04_ORIGIN_Y -
        (row + 0.5) * SITE04_PIXEL_SIZE;

      const productPixel =
        projectedToProductPixel(x, y);

      samples.push({
        x,
        y,
        siteElevation,
        productCol: productPixel.col,
        productRow: productPixel.row,
      });
    }
  }

  // Determine all Product 90 tiles needed.
  const requiredTiles = new Map();

  for (const sample of samples) {
    const x0 = Math.floor(sample.productCol);
    const y0 = Math.floor(sample.productRow);

    for (const [x, y] of [
      [x0, y0],
      [x0 + 1, y0],
      [x0, y0 + 1],
      [x0 + 1, y0 + 1],
    ]) {
      const tx = Math.floor(x / tileSize);
      const ty = Math.floor(y / image.getTileHeight());

      requiredTiles.set(`${tx},${ty}`, { tx, ty });
    }
  }

  console.log("\n=== REQUIRED PRODUCT 90 TILES ===");
  console.log([...requiredTiles.values()]);

  // Sequential tile downloads with retry.
  const tiles = new Map();

  let tileNumber = 0;

  for (const { tx, ty } of requiredTiles.values()) {
    tileNumber++;

    console.log(
      `\n=== TILE ${tileNumber}/${requiredTiles.size} ===`
    );

    const raster = await loadTileWithRetry(
      image,
      tx,
      ty
    );

    tiles.set(`${tx},${ty}`, raster);
  }

  console.log("\nAll required tiles loaded successfully.");

  // Compare elevations.
  const results = [];

  for (const sample of samples) {
    const productElevation = sampleProduct90(
      tiles,
      sample.productCol,
      sample.productRow,
      tileSize
    );

    if (
      !Number.isFinite(sample.siteElevation) ||
      !Number.isFinite(productElevation)
    ) {
      continue;
    }

    const difference =
      productElevation - sample.siteElevation;

    results.push({
      x_m: Number(sample.x.toFixed(1)),
      y_m: Number(sample.y.toFixed(1)),
      site04_m: Number(sample.siteElevation.toFixed(3)),
      product90_m: Number(productElevation.toFixed(3)),
      difference_m: Number(difference.toFixed(3)),
    });
  }

  console.log("\n=== 25-POINT ELEVATION COMPARISON ===");
  console.table(results);

  if (results.length < 20) {
    throw new Error(
      `Insufficient valid comparisons: ${results.length}/25`
    );
  }

  const differences = results.map(
    (result) => result.difference_m
  );

  const mean =
    differences.reduce((sum, value) => sum + value, 0) /
    differences.length;

  const mae =
    differences.reduce(
      (sum, value) => sum + Math.abs(value),
      0
    ) / differences.length;

  const rmse = Math.sqrt(
    differences.reduce(
      (sum, value) => sum + value * value,
      0
    ) / differences.length
  );

  console.log("\n=== OVERLAP STATISTICS ===");

  console.log({
    validComparisons: results.length,
    signedMeanDifference_m: Number(mean.toFixed(3)),
    meanAbsoluteError_m: Number(mae.toFixed(3)),
    rootMeanSquareError_m: Number(rmse.toFixed(3)),
    minimumDifference_m: Number(
      Math.min(...differences).toFixed(3)
    ),
    maximumDifference_m: Number(
      Math.max(...differences).toFixed(3)
    ),
  });

  console.log("\n=== VALIDATION COMPLETE ===");
}

main().catch((error) => {
  console.error("\nVALIDATION FAILED:");
  console.error(error);
  process.exitCode = 1;
});
