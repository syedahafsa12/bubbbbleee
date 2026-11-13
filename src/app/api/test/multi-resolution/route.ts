
import { connection } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  decodeLolaTerrain,
  SITE04_COORDINATES,
  type LolaTerrainData,
} from "../../../../components/lib/lunar/terrainData";

import {
  calculateMultiResolutionTerrainHorizon,
} from "../../../../components/lib/lunar/multiResolutionTerrain.server";

let terrainPromise: Promise<LolaTerrainData> | null = null;

async function loadProduct78(): Promise<LolaTerrainData> {
  if (!terrainPromise) {
    terrainPromise = (async () => {
      const directory = path.join(
        process.cwd(),
        "public",
        "data",
        "site04_shackleton_rim"
      );

      const [metadataText, binary] = await Promise.all([
        readFile(path.join(directory, "metadata.json"), "utf8"),
        readFile(path.join(directory, "elevation.bin")),
      ]);

      return decodeLolaTerrain(
        JSON.parse(metadataText) as unknown,
        binary
      );
    })().catch((error: unknown) => {
      terrainPromise = null;
      throw error;
    });
  }

  return terrainPromise;
}

export async function GET() {
  await connection();

  try {
    console.log("[Multi-resolution Test] Starting...");

    // Load the existing high-resolution Product 78 dataset.
    const product78 = await loadProduct78();

    // Test 16 directions before running the full calculation.
    const result =
      await calculateMultiResolutionTerrainHorizon(
        product78,
        SITE04_COORDINATES,
        {
          directionCount: 16,
          sampleStepMeters: 5,
          regionalSampleStepMeters: 20,
          maxDistanceMeters: 15000,
          directionConcurrency: 2,
        }
      );

    const bothDatasetsUsed =
      result.product78SamplesChecked > 0 &&
      result.product90SamplesChecked > 0;

    const allDirectionsCalculated =
      result.calculatedDirections === 16 &&
      result.directions.every(
        (direction) => direction.samplesChecked > 0
      );

    const finiteResults =
      result.directions.every(
        (direction) =>
          Number.isFinite(direction.horizonElevationDeg) &&
          Number.isFinite(direction.distanceMeters) &&
          Number.isFinite(direction.terrainElevationMeters)
      );

    const success =
      bothDatasetsUsed &&
      allDirectionsCalculated &&
      finiteResults;

    return Response.json(
      {
        success,

        message: success
          ? "Multi-resolution terrain smoke test passed."
          : "Multi-resolution terrain test needs investigation.",

        observer: {
          geographic: result.observer,
          projected: result.observerProjected,
          elevationMeters: result.observerElevationMeters,
        },

        configuration: {
          directionsRequested: 16,
          localSampleStepMeters: 5,
          regionalSampleStepMeters: 20,
          maximumDistanceMeters: 15000,
          directionConcurrency: 2,
        },

        results: {
          calculatedDirections: result.calculatedDirections,
          totalSamplesChecked: result.totalSamplesChecked,

          product78SamplesChecked:
            result.product78SamplesChecked,

          product90SamplesChecked:
            result.product90SamplesChecked,

          bothDatasetsUsed,

          rasterBoundaryLimitedDirections:
            result.rasterBoundaryLimitedDirections,

          product90CoverageBoundaryLimitedDirections:
            result.product90CoverageBoundaryLimitedDirections,

          product90NoDataTerminatedDirections:
            result.product90NoDataTerminatedDirections,

          searchLimitReachedDirections:
            result.searchLimitReachedDirections,

          completeHorizonVerified:
            result.completeHorizonVerified,

          finiteResults,
          allDirectionsCalculated,
        },

        directions: result.directions.map((direction) => ({
          azimuthDeg: direction.azimuthDeg,

          horizonElevationDeg:
            direction.horizonElevationDeg,

          distanceMeters:
            direction.distanceMeters,

          horizonSource:
            direction.horizonSource,

          horizonResolutionMeters:
            direction.horizonResolutionMeters,

          product78SamplesChecked:
            direction.product78SamplesChecked,

          product90SamplesChecked:
            direction.product90SamplesChecked,

          terminationReason:
            direction.terminationReason,
        })),
      },
      {
        status: success ? 200 : 500,
      }
    );
  } catch (error) {
    console.error(
      "[Multi-resolution Test] Failed:",
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
