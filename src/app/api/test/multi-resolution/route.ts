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
        new Uint8Array(binary)
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
    const product78 = await loadProduct78();
    const commonOptions = {
      directionCount: 16,
      sampleStepMeters: 5,
      regionalSampleStepMeters: 20,
      maxDistanceMeters: 15000,
      directionConcurrency: 2,
    };

    // Acceptance test 1: Product78 must run without touching Product90.
    const localOnly = await calculateMultiResolutionTerrainHorizon(
      product78,
      SITE04_COORDINATES,
      {
        ...commonOptions,
        enableProduct90: false,
      }
    );

    // Acceptance test 2: deliberately fail the Product90 raster batch after
    // its metadata has been validated. The completed Product78 baseline must
    // be returned rather than rejecting the entire horizon calculation.
    const fallback = await calculateMultiResolutionTerrainHorizon(
      product78,
      SITE04_COORDINATES,
      {
        ...commonOptions,
        enableProduct90: true,
      },
      {
        sampleElevations: async () => {
          throw new Error("Synthetic Product90 tile 28,31 socket failure");
        },
      }
    );

    const localOnlyPassed =
      localOnly.calculatedDirections === commonOptions.directionCount &&
      localOnly.product90SamplesChecked === 0 &&
      localOnly.product90Status === "disabled" &&
      localOnly.product78SamplesChecked > 0 &&
      localOnly.directions.every(
        (direction) =>
          direction.samplesChecked > 0 &&
          direction.coverageStatus === "partial" &&
          direction.terrainBeyondKnownCoverageUnknown === true &&
          direction.terminationReason === "product78_boundary"
      );

    const failureIsolationPassed =
      fallback.calculatedDirections === commonOptions.directionCount &&
      fallback.product90Status === "unavailable" &&
      fallback.product90Error?.includes("Synthetic Product90 tile") === true &&
      fallback.product90SamplesChecked === 0 &&
      fallback.product78SamplesChecked > 0 &&
      fallback.directions.every(
        (direction) =>
          direction.samplesChecked > 0 &&
          direction.terrainBeyondKnownCoverageUnknown === true
      );

    const completeHorizonRemainsUnverified =
      localOnly.completeHorizonVerified === false &&
      fallback.completeHorizonVerified === false;

    const success =
      localOnlyPassed &&
      failureIsolationPassed &&
      completeHorizonRemainsUnverified;

    return Response.json(
      {
        success,
        message: success
          ? "Product78-only and Product90 failure-isolation tests passed."
          : "Product78 fallback tests need investigation.",
        checks: {
          localOnlyPassed,
          failureIsolationPassed,
          completeHorizonRemainsUnverified,
        },
        product78Only: {
          calculatedDirections: localOnly.calculatedDirections,
          totalSamplesChecked: localOnly.totalSamplesChecked,
          product78SamplesChecked: localOnly.product78SamplesChecked,
          product90SamplesChecked: localOnly.product90SamplesChecked,
          product90Status: localOnly.product90Status,
          product78BoundaryLimitedDirections:
            localOnly.product78BoundaryLimitedDirections,
          product78NoDataTerminatedDirections:
            localOnly.product78NoDataTerminatedDirections,
          searchLimitReachedDirections:
            localOnly.searchLimitReachedDirections,
          completeHorizonVerified: localOnly.completeHorizonVerified,
          directions: localOnly.directions,
        },
        simulatedProduct90Failure: {
          product90Status: fallback.product90Status,
          product90Error: fallback.product90Error,
          product78SamplesChecked: fallback.product78SamplesChecked,
          product90SamplesChecked: fallback.product90SamplesChecked,
          calculatedDirections: fallback.calculatedDirections,
          completeHorizonVerified: fallback.completeHorizonVerified,
          directions: fallback.directions,
        },
      },
      { status: success ? 200 : 500 }
    );
  } catch (error) {
    console.error("[Product78 fallback tests] Failed:", error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
