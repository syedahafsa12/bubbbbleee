
import {
  getProduct90Diagnostics,
  sampleProduct90Elevation,
  getProduct90CacheStats,
  clearProduct90TileCache,
} from "../../../../components/lib/lunar/product90Terrain.server";
import { connection } from "next/server";


export async function GET() {
  // Ensure this test runs only when an actual request arrives.
  // Keep outside try/catch so Next.js can handle its own
  // prerendering interruption.
  await connection();

  try {
    console.log("[Product 90 Test] Starting extended tests...");

    // Test 1: Inspect the actual NASA GeoTIFF.
    const diagnostics = await getProduct90Diagnostics();

    // Start with an empty tile cache.
    clearProduct90TileCache();

    // Test 2: Request the same location concurrently.
    const concurrentSamples = await Promise.all([
      sampleProduct90Elevation(0, 0),
      sampleProduct90Elevation(0, 0),
      sampleProduct90Elevation(0, 0),
    ]);

    const centerElevation = concurrentSamples[0];

    const afterConcurrent = getProduct90CacheStats();

    const concurrentPassed =
      centerElevation !== null &&
      concurrentSamples.every(
        (value) => value === centerElevation
      ) &&
      afterConcurrent.cachedTiles === 1 &&
      afterConcurrent.pendingTiles === 0;

    // Test 3: Request a coordinate outside the raster.
    const outsideBefore = getProduct90CacheStats();

    const outsideElevation =
      await sampleProduct90Elevation(400000, 0);

    const outsideAfter = getProduct90CacheStats();

    const outsidePassed =
      outsideElevation === null &&
      outsideAfter.cachedTiles === outsideBefore.cachedTiles;

    // Test 4: Sample a different region and load another tile.
    const beforeSecondTile = getProduct90CacheStats();

    const secondTileElevation =
      await sampleProduct90Elevation(50000, 0);

    const afterSecondTile = getProduct90CacheStats();

    const secondTilePassed =
      secondTileElevation !== null &&
      afterSecondTile.cachedTiles ===
        beforeSecondTile.cachedTiles + 1;

    // Test 5: Read the original location again.
    const repeatedElevation =
      await sampleProduct90Elevation(0, 0);

    const afterRepeat = getProduct90CacheStats();

    const cacheReusePassed =
      repeatedElevation === centerElevation &&
      afterRepeat.cachedTiles === afterSecondTile.cachedTiles;

    // Test 6: Verify that cache clearing works.
    clearProduct90TileCache();

    const afterClear = getProduct90CacheStats();

    const cacheClearPassed =
      afterClear.cachedTiles === 0 &&
      afterClear.pendingTiles === 0;

    const tests = {
      diagnostics: {
        passed: true,
        result: diagnostics,
      },

      concurrentSampling: {
        passed: concurrentPassed,
        requests: concurrentSamples.length,
        elevations: concurrentSamples,
        cache: afterConcurrent,
      },

      outsideCoverage: {
        passed: outsidePassed,
        coordinates: {
          x: 400000,
          y: 0,
        },
        elevationMeters: outsideElevation,
        expected: null,
      },

      secondTileLoading: {
        passed: secondTilePassed,
        coordinates: {
          x: 50000,
          y: 0,
        },
        elevationMeters: secondTileElevation,
        cache: afterSecondTile,
      },

      cacheReuse: {
        passed: cacheReusePassed,
        originalElevation: centerElevation,
        repeatedElevation,
        cache: afterRepeat,
      },

      cacheClearing: {
        passed: cacheClearPassed,
        result: afterClear,
      },
    };

    const allPassed = Object.values(tests).every(
      (test) => test.passed
    );

    console.log("[Product 90 Test] Results:", tests);

    return Response.json(
      {
        success: allPassed,
        message: allPassed
          ? "All Product 90 backend tests passed."
          : "Some Product 90 tests need investigation.",
        tests,
      },
      {
        status: allPassed ? 200 : 500,
      }
    );
  } catch (error) {
    console.error("[Product 90 Test] Failed:", error);

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

