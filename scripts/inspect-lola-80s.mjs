
import { fromUrl } from "geotiff";
import { readFile } from "node:fs/promises";
import path from "node:path";

const URL =
  "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF";

const ROOT = process.cwd();

const SITE04 = {
  path: path.join(
    ROOT,
    "public",
    "data",
    "site04_shackleton_rim",
    "elevation.bin"
  ),
  width: 3200,
  height: 3200,
  originX: -9000,
  originY: 1000,
  pixelSize: 5,
};

const OBSERVER = {
  x: -1000.0366057,
  y: -7000.3455653,
};

function getTag(directory, name) {
  if (typeof directory.getValue === "function") {
    return directory.getValue(name);
  }

  return directory[name];
}

function bilinear(values, fx, fy) {
  if (values.length !== 4 || values.some((v) => !Number.isFinite(v))) {
    return null;
  }

  const top = values[0] + (values[1] - values[0]) * fx;
  const bottom = values[2] + (values[3] - values[2]) * fx;

  return top + (bottom - top) * fy;
}

function interpolateGrid(x, y, originX, originY, pixelSize) {
  // PixelIsArea: coordinates refer to pixel centres.
  const col = (x - originX) / pixelSize - 0.5;
  const row = (originY - y) / pixelSize - 0.5;

  const col0 = Math.floor(col);
  const row0 = Math.floor(row);

  return {
    col,
    row,
    col0,
    row0,
    fx: col - col0,
    fy: row - row0,
  };
}

function readLocalFour(buffer, width, col, row) {
  if (
    col < 0 ||
    row < 0 ||
    col + 1 >= width ||
    row + 1 >= SITE04.height
  ) {
    throw new Error("Site04 observer window is outside the raster.");
  }

  const offset = (row * width + col) * 4;
  const rowOffset = width * 4;

  return [
    buffer.readFloatLE(offset),
    buffer.readFloatLE(offset + 4),
    buffer.readFloatLE(offset + rowOffset),
    buffer.readFloatLE(offset + rowOffset + 4),
  ];
}

async function main() {
  console.log("=== NASA LOLA PRODUCT 90 ===");
  console.log("Remote range reading only.");
  console.log("No full DEM download.\n");

  const tiff = await fromUrl(URL, {
    allowFullFile: false,
    maxRanges: 8,
  });

  const image = await tiff.getImage(0);
  const directory = image.getFileDirectory();

  const width = image.getWidth();
  const height = image.getHeight();

  console.log("BigTIFF:", tiff.bigTiff);
  console.log("Raster:", width, "x", height);
  console.log("Tile:", image.getTileWidth(), "x", image.getTileHeight());

  // Use the same metadata accessor as the original successful inspection.
  const scale = getTag(directory, "ModelPixelScale");
  const tiepoint = getTag(directory, "ModelTiepoint");

  if (!scale || !tiepoint) {
    console.log("\nAvailable TIFF directory keys:");
    console.log(Object.keys(directory));

    throw new Error(
      "ModelPixelScale or ModelTiepoint could not be read."
    );
  }

  const pixelSizeX = Number(scale[0]);
  const pixelSizeY = Number(scale[1]);

  const originX = Number(tiepoint[3]);
  const originY = Number(tiepoint[4]);

  if (
    !Number.isFinite(pixelSizeX) ||
    !Number.isFinite(pixelSizeY) ||
    !Number.isFinite(originX) ||
    !Number.isFinite(originY)
  ) {
    throw new Error("Invalid TIFF grid metadata.");
  }

  console.log("\n=== GRID METADATA ===");
  console.log("Pixel scale:", Array.from(scale));
  console.log("Tiepoint:", Array.from(tiepoint));
  console.log("Origin:", originX, originY);
  console.log("Pixel size:", pixelSizeX, pixelSizeY);

  const grid = interpolateGrid(
    OBSERVER.x,
    OBSERVER.y,
    originX,
    originY,
    pixelSizeX
  );

  console.log("\n=== PRODUCT 90 OBSERVER PIXEL ===");
  console.log("Column:", grid.col);
  console.log("Row:", grid.row);
  console.log("2x2 window:", [
    grid.col0,
    grid.row0,
    grid.col0 + 2,
    grid.row0 + 2,
  ]);

  if (
    grid.col0 < 0 ||
    grid.row0 < 0 ||
    grid.col0 + 1 >= width ||
    grid.row0 + 1 >= height
  ) {
    throw new Error("Observer is outside Product 90 raster.");
  }

  // Read only four remote elevation pixels.
  const raster = await image.readRasters({
    window: [
      grid.col0,
      grid.row0,
      grid.col0 + 2,
      grid.row0 + 2,
    ],
    interleave: true,
  });

  const product90Values = Array.from(raster).slice(0, 4);

  console.log("\n=== PRODUCT 90 ELEVATIONS ===");
  console.log("Four surrounding pixels (m):", product90Values);

  const product90Elevation = bilinear(
    product90Values,
    grid.fx,
    grid.fy
  );

  console.log("Product 90 bilinear elevation:", product90Elevation);

  // Read existing local Site04 terrain.
  console.log("\n=== SITE04 COMPARISON ===");

  const site04Grid = interpolateGrid(
    OBSERVER.x,
    OBSERVER.y,
    SITE04.originX,
    SITE04.originY,
    SITE04.pixelSize
  );

  console.log("Site04 column:", site04Grid.col);
  console.log("Site04 row:", site04Grid.row);

  const site04Buffer = await readFile(SITE04.path);

  const expectedBytes =
    SITE04.width *
    SITE04.height *
    Float32Array.BYTES_PER_ELEMENT;

  if (site04Buffer.length !== expectedBytes) {
    throw new Error(
      `Unexpected Site04 binary size: ${site04Buffer.length}; expected ${expectedBytes}`
    );
  }

  const site04Values = readLocalFour(
    site04Buffer,
    SITE04.width,
    site04Grid.col0,
    site04Grid.row0
  );

  console.log("Site04 four surrounding pixels (m):", site04Values);

  const site04Elevation = bilinear(
    site04Values,
    site04Grid.fx,
    site04Grid.fy
  );

  console.log("Site04 bilinear elevation:", site04Elevation);

  console.log("\n=== ELEVATION COMPARISON ===");

  if (
    product90Elevation === null ||
    site04Elevation === null
  ) {
    console.log("Comparison unavailable: invalid or NoData elevation.");
  } else {
    const difference = product90Elevation - site04Elevation;

    console.log("Product 90:", product90Elevation, "m");
    console.log("Site04:", site04Elevation, "m");
    console.log("Difference:", difference, "m");
    console.log("Absolute difference:", Math.abs(difference), "m");
  }

  console.log("\n=== RESULT ===");
  console.log("Remote elevation window read completed.");
  console.log("No full raster download requested.");
}

main().catch((error) => {
  console.error("\nINSPECTION FAILED:");
  console.error(error);
  process.exitCode = 1;
});
