
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { connection } from "next/server";

import {
  decodeLolaTerrain,
  sampleLolaHeightAtPixel,
  type LolaTerrainData,
} from "../../../../components/lib/lunar/terrainData";

import {
  getProduct90Diagnostics,
  sampleProduct90Elevation,
  getProduct90CacheStats,
} from "../../../../components/lib/lunar/product90Terrain.server";

/**
 * Temporary Product 78 vs Product 90 comparison API.
 *
 * Compares both NASA terrain datasets at identical
 * projected lunar coordinates inside their overlap.
 *
 * Product 78:
 *   High-resolution local terrain (5 m/pixel).
 *
 * Product 90:
 *   Regional terrain (20 m/pixel).
 *
 * This endpoint measures elevation differences.
 * It does not assume both elevation models must
 * return identical values.
 */

let product78TerrainPromise: Promise<LolaTerrainData> | null = null;

/**
 * Loads the existing Product 78 files directly from public/.
 *
 * Uses Node filesystem access because the existing
 * loadLolaTerrain() function uses browser-relative fetch URLs.
 *
 * The original terrainData.ts implementation is preserved.
 */
async function getProduct78Terrain(): Promise<LolaTerrainData> {
  if (!product78TerrainPromise) {
    product78TerrainPromise = (async () => {
      const dataDirectory = join(
        process.cwd(),
        "public",
        "data",
        "site04_shackleton_rim"
      );

      const [metadataText, elevationBytes] = await Promise.all([
        readFile(join(dataDirectory, "metadata.json"), "utf8"),

        readFile(join(dataDirectory, "elevation.bin")),
      ]);

      const rawMetadata: unknown = JSON.parse(metadataText);

      return decodeLolaTerrain(
        rawMetadata,
        elevationBytes
      );
    })();
  }

  try {
    return await product78TerrainPromise;
  } catch (error) {
    product78TerrainPromise = null;
    throw error;
  }
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Checks whether the complete Product 78 bounding box
 * fits inside the Product 90 bounding box.
 */
function isProduct78InsideProduct90(
  product78BBox: [number, number, number, number],
  product90BBox: number[]
): boolean {
  if (product90BBox.length !== 4) {
    return false;
  }

  const [p78MinX, p78MinY, p78MaxX, p78MaxY] =
    product78BBox;

  const [p90MinX, p90MinY, p90MaxX, p90MaxY] =
    product90BBox;

  return (
    p78MinX >= p90MinX &&
    p78MinY >= p90MinY &&
    p78MaxX <= p90MaxX &&
    p78MaxY <= p90MaxY
  );
}

export async function GET() {
  // Run only when an actual request arrives.
  // Keep outside try/catch so Next.js can handle
  // prerendering interruptions correctly.
  await connection();

  try {
    console.log("[Terrain Overlap] Starting comparison...");

    // TEST 1: Load and validate Product 78.
    const product78 = await getProduct78Terrain();

    console.log("[Terrain Overlap] Product 78 loaded.");

    // TEST 2: Inspect the actual Product 90 source.
    const product90Diagnostics =
      await getProduct90Diagnostics();

    console.log("[Terrain Overlap] Product 90 validated.");

    const product78Metadata =
      product78.metadata;

    const product90Metadata =
      product90Diagnostics.dataset;

    // TEST 3: Compare the published coordinate metadata.
    const projectionMatches =
      normalizeText(
        product78Metadata.coordinateSystem.projection
      ) ===
      normalizeText(product90Metadata.projection);

    const referenceFrameMatches =
      normalizeText(
        product78Metadata.coordinateSystem.referenceFrame
      ) ===
      normalizeText(product90Metadata.referenceFrame);

    const ephemerisMatches =
      normalizeText(
        product78Metadata.coordinateSystem.ephemeris
      ) ===
      normalizeText(product90Metadata.ephemeris);

    const unitsMatches = [
      "m",
      "meter",
      "meters",
      "metre",
      "metres",
    ].includes(
      normalizeText(
        product78Metadata.coordinateSystem.linearUnits
      )
    ) &&
    [
      "m",
      "meter",
      "meters",
      "metre",
      "metres",
    ].includes(
      normalizeText(product90Metadata.linearUnits)
    );

    const pixelRegistrationMatches =
      [
        "pixelarea",
        "pixelisarea",
      ].includes(
        normalizeText(
          product78Metadata.coordinateSystem.pixelRegistration
        )
      ) &&
      product90Diagnostics.raster.pixelIsArea;

    // TEST 4: Verify that Product 78 is inside Product 90.
    const product78InsideProduct90 =
      isProduct78InsideProduct90(
        product78Metadata.bbox,
        product90Diagnostics.raster.boundingBox
      );

    // TEST 5: Choose nine interior Product 78 pixels.
    const columns = [400, 1600, 2800];
    const rows = [400, 1600, 2800];

    const tiePoint =
      product78Metadata.georeferencing.tiePoint;

    const [
      pixelWidth,
      pixelHeight,
    ] = product78Metadata.pixelResolution;

    const sampleLocations = rows.flatMap((row) =>
      columns.map((column) => ({
        column,
        row,
      }))
    );

    // TEST 6: Sample the same projected locations
    // from both datasets.
    const samples = await Promise.all(
      sampleLocations.map(async ({ column, row }) => {
        // Sample Product 78 at its original pixel centre.
        const product78Elevation =
          sampleLolaHeightAtPixel(
            product78,
            {
              column,
              row,
            }
          );

        // Convert the Product 78 pixel centre into
        // projected lunar coordinates.
        // PixelIsArea requires a half-pixel offset.
        const xMeters =
          tiePoint.x +
          (column - tiePoint.column + 0.5) *
          pixelWidth;

        const yMeters =
          tiePoint.y +
          (row - tiePoint.row + 0.5) *
          pixelHeight;

        // Sample Product 90 at the exact same
        // projected coordinates.
        const product90Elevation =
          await sampleProduct90Elevation(
            xMeters,
            yMeters
          );

        const difference =
          product90Elevation === null
            ? null
            : product78Elevation - product90Elevation;

        const absoluteDifference =
          difference === null
            ? null
            : Math.abs(difference);

        return {
          product78Pixel: {
            column,
            row,
          },

          projectedCoordinates: {
            xMeters,
            yMeters,
          },

          product78ElevationMeters:
            product78Elevation,

          product90ElevationMeters:
            product90Elevation,

          differenceMeters:
            difference,

          absoluteDifferenceMeters:
            absoluteDifference,

          valid: product90Elevation !== null,
        };
      })
    );

    // TEST 7: Calculate comparison statistics.
    const validSamples = samples.filter(
      (sample) =>
        sample.valid &&
        sample.differenceMeters !== null &&
        sample.absoluteDifferenceMeters !== null
    );

    const differences = validSamples.map(
      (sample) => sample.differenceMeters as number
    );

    const absoluteDifferences = validSamples.map(
      (sample) => sample.absoluteDifferenceMeters as number
    );

    const meanAbsoluteDifference =
      absoluteDifferences.length > 0
        ? absoluteDifferences.reduce(
            (sum, value) => sum + value,
            0
          ) / absoluteDifferences.length
        : null;

    const meanSignedDifference =
      differences.length > 0
        ? differences.reduce(
            (sum, value) => sum + value,
            0
          ) / differences.length
        : null;

    const maximumAbsoluteDifference =
      absoluteDifferences.length > 0
        ? Math.max(...absoluteDifferences)
        : null;

    const minimumSignedDifference =
      differences.length > 0
        ? Math.min(...differences)
        : null;

    const maximumSignedDifference =
      differences.length > 0
        ? Math.max(...differences)
        : null;

    // TEST 8: Inspect the Product 90 tile cache.
    const cacheStats = getProduct90CacheStats();

    const metadataCompatibility = {
      projectionMatches,
      referenceFrameMatches,
      ephemerisMatches,
      unitsMatch: unitsMatches,
      pixelRegistrationMatches,

      allChecksPass:
        projectionMatches &&
        referenceFrameMatches &&
        ephemerisMatches &&
        unitsMatches &&
        pixelRegistrationMatches,
    };

    const comparisonComplete =
      validSamples.length === sampleLocations.length;

    // A successful response requires all essential checks.
    const allPassed =
      metadataCompatibility.allChecksPass &&
      product78InsideProduct90 &&
      comparisonComplete;

    console.log("[Terrain Overlap] Completed:", {
      metadataCompatibility,
      product78InsideProduct90,
      validSamples: validSamples.length,
      totalSamples: samples.length,
      meanAbsoluteDifference,
      maximumAbsoluteDifference,
      allPassed,
    });

    return Response.json(
      {
        success: allPassed,

        message: allPassed
          ? "Product 78 and Product 90 overlap comparison completed successfully."
          : "Product 78 and Product 90 comparison needs further investigation.",

        datasets: {
          product78: {
            name: "NASA LOLA Product 78 - Site04",
            dimensions: [
              product78.width,
              product78.height,
            ],
            resolutionMeters:
              product78.resolutionMeters,
            boundingBox:
              product78Metadata.bbox,
            referenceFrame:
              product78Metadata.coordinateSystem.referenceFrame,
            ephemeris:
              product78Metadata.coordinateSystem.ephemeris,
          },

          product90: {
            name: "NASA LOLA Product 90",
            dimensions: [
              product90Diagnostics.raster.width,
              product90Diagnostics.raster.height,
            ],
            resolutionMeters: 20,
            boundingBox:
              product90Diagnostics.raster.boundingBox,
            referenceFrame:
              product90Metadata.referenceFrame,
            ephemeris:
              product90Metadata.ephemeris,
          },
        },

        coverage: {
          product78InsideProduct90,
          comparisonLocationsInsideOverlap:
            product78InsideProduct90,
        },

        metadataCompatibility,

        comparison: {
          totalSamples: samples.length,
          validSamples: validSamples.length,
          comparisonComplete,

          differenceDefinition:
            "Product 78 elevation minus Product 90 elevation.",

          statistics: {
            meanAbsoluteDifferenceMeters:
              meanAbsoluteDifference,

            maximumAbsoluteDifferenceMeters:
              maximumAbsoluteDifference,

            meanSignedDifferenceMeters:
              meanSignedDifference,

            minimumSignedDifferenceMeters:
              minimumSignedDifference,

            maximumSignedDifferenceMeters:
              maximumSignedDifference,
          },

          samples,
        },

        cache: cacheStats,

        scientificNotes: [
          "Both elevation datasets are sampled at the same projected coordinates.",
          "Product 78 samples use original raster pixel centres.",
          "Product 90 uses bilinear interpolation at those coordinates.",
          "Elevation differences are measurements, not automatic validation failures.",
          "No arbitrary pass/fail elevation-difference threshold has been applied.",
          "Product 90 reference-frame and projection labels are based on the published dataset description, not all independently encoded GeoTIFF CRS parameters.",
          "Nine samples provide an initial overlap spot-check, not complete scientific validation.",
        ],
      },
      {
        status: allPassed ? 200 : 500,
      }
    );
  } catch (error) {
    console.error(
      "[Terrain Overlap] Comparison failed:",
      error
    );

    return Response.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500 }
    );
  }
}
