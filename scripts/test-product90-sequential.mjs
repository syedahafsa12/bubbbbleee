
import fs from "node:fs/promises";
import { fromUrl } from "geotiff";

const PRODUCT90_URL =
  "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF";

const SITE04_PATH =
  "public/data/site04_shackleton_rim/elevation.bin";

const SITE04_WIDTH = 3200;
const SITE04_HEIGHT = 3200;
const SITE04_PIXEL_SIZE = 5;

// Site04 upper-left pixel corner in projected coordinates.
const SITE04_ORIGIN_X = -9000;
const SITE04_ORIGIN_Y = 1000;

// Product 90 upper-left pixel corner.
const PRODUCT90_ORIGIN_X = -304000;
const PRODUCT90_ORIGIN_Y = 304000;
const PRODUCT90_PIXEL_SIZE = 20;

const TILE_SIZE = 512;
const FRACTIONS = [0.1, 0.3, 0.5, 0.7, 0.9];

function bilinear(a, b, c, d, fx, fy) {
  return (
    a * (1 - fx) * (1 - fy) +
    b * fx * (1 - fy) +
    c * (1 - fx) * fy +
    d * fx * fy
  );
}

function sampleLocal(buffer, col, row) {
  const x0 = Math.floor(col);
  const y0 = Math.floor(row);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  if (
    x0 < 0 ||
    y0 < 0 ||
    x1 >= SITE04_WIDTH ||
    y1 >= SITE04_HEIGHT
  ) {
    return NaN;
  }

  const a = buffer.readFloatLE(
    (y0 * SITE04_WIDTH + x0) * 4
  );

  const b = buffer.readFloatLE(
    (y0 * SITE04_WIDTH + x1) * 4
  );

  const c = buffer.readFloatLE(
    (y1 * SITE04_WIDTH + x0) * 4
  );

  const d = buffer.readFloatLE(
    (y1 * SITE04_WIDTH + x1) * 4
  );

  if (![a, b, c, d].every(Number.isFinite)) {
    return NaN;
  }

  return bilinear(
    a, b, c, d,
    col - x0,
    row - y0
  );
}

function productPixelFromProjected(x, y) {
  return {
    col:
      (x - PRODUCT90_ORIGIN_X) /
        PRODUCT90_PIXEL_SIZE -
      0.5,

    row:
      (PRODUCT90_ORIGIN_Y - y) /
        PRODUCT90_PIXEL_SIZE -
      0.5,
  };
}

function tileKey(tx, ty) {
  return `${tx},${ty}`;
}

function getProductPixel(tiles, col, row) {
  const tx = Math.floor(col / TILE_SIZE);
  const ty = Math.floor(row / TILE_SIZE);

  const tile = tiles.get(tileKey(tx, ty));

  if (!tile) {
    throw new Error(`Tile not loaded: ${tx}, ${ty}`);
  }

  const localX = col - tx * TILE_SIZE;
  const localY = row - ty * TILE_SIZE;

  return tile[localY * TILE_SIZE + localX];
}

function sampleProduct90(tiles, col, row) {
  const x0 = Math.floor(col);
  const y0 = Math.floor(row);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const a = getProductPixel(tiles, x0, y0);
  const b = getProductPixel(tiles, x1, y0);
  const c = getProductPixel(tiles, x0, y1);
  const d = getProductPixel(tiles, x1, y1);

  if (![a, b, c, d].every(Number.isFinite)) {
    return NaN;
  }

  return bilinear(
    a, b, c, d,
    col - x0,
    row - y0
  );
}

async function main() {
  console.log("=== NASA LOLA SEQUENTIAL OVERLAP VALIDATION ===");
  console.log("Site04 5 m/pixel vs Product 90 20 m/pixel");
  console.log("Remote tiles loaded sequentially.\n");

  const localBuffer = await fs.readFile(SITE04_PATH);

  const expectedBytes =
    SITE04_WIDTH * SITE04_HEIGHT * 4;

  if (localBuffer.length !== expectedBytes) {
    throw new Error(
      `Site04 binary size mismatch. Expected ${expectedBytes}, got ${localBuffer.length}`
    );
  }

  console.log("Site04 binary:", localBuffer.length, "bytes");

  const tiff = await fromUrl(PRODUCT90_URL, {
    maxRanges: 0,
  });

  const image = await tiff.getImage();

  console.log("Product 90:", image.getWidth(), "x", image.getHeight());
  console.log(
    "Tile size:",
    image.getTileWidth(),
    "x",
    image.getTileHeight()
  );

  // Build 25 matching geographic/projected sample locations.
  const samples = [];

  for (const fy of FRACTIONS) {
    for (const fx of FRACTIONS) {
      const siteCol = fx * (SITE04_WIDTH - 1);
      const siteRow = fy * (SITE04_HEIGHT - 1);

      const siteElevation = sampleLocal(
        localBuffer,
        siteCol,
        siteRow
      );

      // Convert Site04 pixel centre to projected coordinates.
      const projectedX =
        SITE04_ORIGIN_X +
        (siteCol + 0.5) * SITE04_PIXEL_SIZE;

      const projectedY =
        SITE04_ORIGIN_Y -
        (siteRow + 0.5) * SITE04_PIXEL_SIZE;

      const productPixel = productPixelFromProjected(
        projectedX,
        projectedY
      );

      samples.push({
        fx,
        fy,
        siteCol,
        siteRow,
        projectedX,
        projectedY,
        siteElevation,
        productCol: productPixel.col,
        productRow: productPixel.row,
      });
    }
  }

  // Identify every Product 90 tile needed by the 25 samples.
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
      const tx = Math.floor(x / TILE_SIZE);
      const ty = Math.floor(y / TILE_SIZE);

      requiredTiles.set(tileKey(tx, ty), { tx, ty });
    }
  }

  console.log("\n=== REQUIRED PRODUCT 90 TILES ===");
  console.log([...requiredTiles.values()]);

  // Fetch and decode each tile sequentially.
  const tiles = new Map();

  for (const { tx, ty } of requiredTiles.values()) {
    const x0 = tx * TILE_SIZE;
    const y0 = ty * TILE_SIZE;

    console.log(`\nLoading tile (${tx}, ${ty})...`);

    const raster = await image.readRasters({
      window: [
        x0,
        y0,
        x0 + TILE_SIZE,
        y0 + TILE_SIZE,
      ],
      interleave: true,
    });

    tiles.set(tileKey(tx, ty), raster);

    console.log({
      samples: raster.length,
      result: "SUCCESS",
    });
  }

  // Compare elevations.
  const results = [];

  for (const sample of samples) {
    const productElevation = sampleProduct90(
      tiles,
      sample.productCol,
      sample.productRow
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
      x: Math.round(sample.projectedX),
      y: Math.round(sample.projectedY),
      site04: Number(sample.siteElevation.toFixed(3)),
      product90: Number(productElevation.toFixed(3)),
      difference: Number(difference.toFixed(3)),
    });
  }

  console.log("\n=== ELEVATION COMPARISON ===");
  console.table(results);

  if (results.length < 20) {
    throw new Error(
      `Insufficient valid comparisons: ${results.length}/25`
    );
  }

  const differences = results.map((r) => r.difference);

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
    signedMeanDifferenceMeters: Number(mean.toFixed(3)),
    meanAbsoluteErrorMeters: Number(mae.toFixed(3)),
    rootMeanSquareErrorMeters: Number(rmse.toFixed(3)),
    minimumDifferenceMeters: Math.min(...differences),
    maximumDifferenceMeters: Math.max(...differences),
  });

  console.log("\n=== VALIDATION COMPLETE ===");
}

main().catch((error) => {
  console.error("\nVALIDATION FAILED:");
  console.error(error);
  process.exitCode = 1;
});
