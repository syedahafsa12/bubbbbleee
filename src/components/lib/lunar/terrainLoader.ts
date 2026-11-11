export interface TerrainMetadata {
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
  resolutionMeters: number;
  centerLatitude: number;
  centerLongitude: number;
}

export interface TerrainData {
  metadata: TerrainMetadata;
  elevationBuffer: Float32Array;
}

/**
 * Loads authentic NASA LOLA elevation data and metadata.
 * Throws an error if assets are missing, ensuring scientific integrity.
 */
export async function loadLolaTerrainData(siteId: string = "site04_shackleton_rim"): Promise<TerrainData> {
  const metaRes = await fetch(`/data/${siteId}/metadata.json`);
  if (!metaRes.ok) {
    throw new Error(`NASA LOLA metadata.json not found for ${siteId}. Dataset pre-processing required.`);
  }
  const metadata: TerrainMetadata = await metaRes.json();

  const binRes = await fetch(`/data/${siteId}/elevation.bin`);
  if (!binRes.ok) {
    throw new Error(`NASA LOLA elevation.bin binary buffer not found for ${siteId}.`);
  }
  const buffer = await binRes.arrayBuffer();
  const elevationBuffer = new Float32Array(buffer);

  return { metadata, elevationBuffer };
}