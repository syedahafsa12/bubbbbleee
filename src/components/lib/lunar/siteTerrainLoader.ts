import {
  decodeLolaTerrain,
  type LolaTerrainData,
} from "./terrainData";

import {
  DEFAULT_PRODUCT78_SITE_ID,
  getProduct78Site,
  type Product78SiteId,
} from "./siteRegistry";

const terrainPromises = new Map<
  Product78SiteId,
  Promise<LolaTerrainData>
>();

/**
 * Loads the selected site's own NASA LOLA Product 78 terrain.
 *
 * Each site is cached independently. A failed request is removed
 * from the cache so the user can retry it.
 */
export async function loadLolaTerrainForSite(
  siteId: Product78SiteId = DEFAULT_PRODUCT78_SITE_ID
): Promise<LolaTerrainData> {
  const cached = terrainPromises.get(siteId);

  if (cached) {
    return cached;
  }

  const site = getProduct78Site(siteId);

  const pending = (async (): Promise<LolaTerrainData> => {
    const dataPath = `/data/${site.dataDirectory}`;

    console.info("[LOLA] Loading selected site:", {
      siteId,
      dataDirectory: site.dataDirectory,
    });

    const [metadataResponse, elevationResponse] =
      await Promise.all([
        fetch(`${dataPath}/metadata.json`, {
          cache: "force-cache",
        }),
        fetch(`${dataPath}/elevation.bin`, {
          cache: "force-cache",
        }),
      ]);

    if (!metadataResponse.ok) {
      throw new Error(
        `NASA Product 78 metadata request failed for ${site.displayName}: HTTP ${metadataResponse.status}.`
      );
    }

    if (!elevationResponse.ok) {
      throw new Error(
        `NASA Product 78 elevation request failed for ${site.displayName}: HTTP ${elevationResponse.status}.`
      );
    }

    const rawMetadata: unknown =
      await metadataResponse.json();

    const elevationBuffer =
      await elevationResponse.arrayBuffer();

    const terrain = decodeLolaTerrain(
      rawMetadata,
      new Uint8Array(elevationBuffer)
    );

    console.info("[LOLA] Selected site terrain loaded:", {
      siteId,
      archiveSite: site.archiveSite,
      dimensions: `${terrain.width} x ${terrain.height}`,
      resolutionMeters: terrain.resolutionMeters,
      referenceFrame:
        terrain.metadata.coordinateSystem.referenceFrame,
      ephemeris:
        terrain.metadata.coordinateSystem.ephemeris,
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

    console.error(
      `[LOLA] Failed to load terrain for ${siteId}:`,
      error
    );

    throw error;
  }
}

/**
 * Clears one site's cached terrain, or all cached terrain.
 * Useful when replacing local raster files during development.
 */
export function clearLolaTerrainCache(
  siteId?: Product78SiteId
): void {
  if (siteId) {
    terrainPromises.delete(siteId);
    return;
  }

  terrainPromises.clear();
}