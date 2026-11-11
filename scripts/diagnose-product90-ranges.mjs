import { fromUrl } from "geotiff";

const URL =
  "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF";

const WINDOW = {
  x0: 14828,
  y0: 15228,
  x1: 15472,
  y1: 15872,
};

async function main() {
  console.log("=== PRODUCT 90 TIFF RANGE DIAGNOSTIC ===");

  const tiff = await fromUrl(URL, { maxRanges: 0 });
  const image = await tiff.getImage();
  const directory = image.fileDirectory;

  const tileWidth = image.getTileWidth();
  const tileHeight = image.getTileHeight();
  const imageWidth = image.getWidth();

  console.log("\n=== LOADING DEFERRED TIFF ARRAYS ===");

  const offsets = await directory.loadValue("TileOffsets");
  const byteCounts = await directory.loadValue("TileByteCounts");

  console.log({
    imageWidth,
    imageHeight: image.getHeight(),
    tileWidth,
    tileHeight,
    totalOffsets: offsets.length,
    totalByteCounts: byteCounts.length,
  });

  const tilesAcross = Math.ceil(imageWidth / tileWidth);

  const minTileX = Math.floor(WINDOW.x0 / tileWidth);
  const maxTileX = Math.floor((WINDOW.x1 - 1) / tileWidth);
  const minTileY = Math.floor(WINDOW.y0 / tileHeight);
  const maxTileY = Math.floor((WINDOW.y1 - 1) / tileHeight);

  console.log("\n=== REQUIRED TILE COORDINATES ===");
  console.log({ minTileX, maxTileX, minTileY, maxTileY });

  for (let ty = minTileY; ty <= maxTileY; ty++) {
    for (let tx = minTileX; tx <= maxTileX; tx++) {
      const index = ty * tilesAcross + tx;

      const start = Number(offsets[index]);
      const byteCount = Number(byteCounts[index]);
      const end = start + byteCount - 1;

      console.log(`\n--- Tile (${tx}, ${ty}), index ${index} ---`);
      console.log({ start, end, byteCount });

      if (!Number.isSafeInteger(start) ||
          !Number.isSafeInteger(byteCount) ||
          start < 0 ||
          byteCount <= 0) {
        console.log("INVALID TILE RANGE");
        continue;
      }

      try {
        const response = await fetch(URL, {
          headers: {
            Range: `bytes=${start}-${end}`,
          },
        });

        console.log("HTTP status:", response.status);
        console.log(
          "Content-Range:",
          response.headers.get("content-range")
        );
        console.log(
          "Content-Length:",
          response.headers.get("content-length")
        );

        if (response.status !== 206) {
          await response.body?.cancel();
          console.log("RESULT: SERVER DID NOT RETURN PARTIAL CONTENT");
          continue;
        }

        const data = await response.arrayBuffer();

        console.log("Received bytes:", data.byteLength);
        console.log("Expected bytes:", byteCount);
        console.log(
          data.byteLength === byteCount
            ? "RESULT: RANGE OK"
            : "RESULT: BYTE COUNT MISMATCH"
        );
      } catch (error) {
        console.log("FETCH ERROR:", error.message);
      }
    }
  }

  console.log("\n=== DIAGNOSTIC COMPLETE ===");
}

main().catch((error) => {
  console.error("\nDIAGNOSTIC FAILED:");
  console.error(error);
  process.exitCode = 1;
}); 