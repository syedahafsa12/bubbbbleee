import { connection, NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  PRODUCT78_SITE_REGISTRY,
  type Product78SiteId,
} from "@/components/lib/lunar/siteRegistry";

async function inspectSiteAssets(siteId: Product78SiteId) {
  const site = PRODUCT78_SITE_REGISTRY[siteId];
  const directory = path.join(
    process.cwd(),
    "public",
    "data",
    site.dataDirectory
  );

  try {
    const [metadataText, binaryStats] = await Promise.all([
      readFile(path.join(directory, "metadata.json"), "utf8"),
      stat(path.join(directory, "elevation.bin")),
    ]);

    const raw: unknown = JSON.parse(metadataText);
    if (
      raw === null ||
      typeof raw !== "object" ||
      !("width" in raw) ||
      !("height" in raw) ||
      !("resolutionMeters" in raw) ||
      !("dataType" in raw) ||
      !("byteOrder" in raw)
    ) {
      return {
        assetStatus: "invalid_metadata" as const,
        error: "Metadata is missing required raster fields.",
      };
    }

    const metadata = raw as {
      width: number;
      height: number;
      resolutionMeters: number;
      dataType: string;
      byteOrder: string;
      minElevation?: number;
      maxElevation?: number;
      bbox?: number[];
      noDataPixelCount?: number;
      coordinateSystem?: {
        referenceFrame?: string;
        ephemeris?: string;
        projection?: string;
      };
    };

    if (
      !Number.isSafeInteger(metadata.width) ||
      metadata.width <= 0 ||
      !Number.isSafeInteger(metadata.height) ||
      metadata.height <= 0 ||
      !Number.isFinite(metadata.resolutionMeters) ||
      metadata.resolutionMeters <= 0 ||
      metadata.dataType.toLowerCase() !== "float32" ||
      !["little-endian", "le"].includes(metadata.byteOrder.toLowerCase())
    ) {
      return {
        assetStatus: "invalid_metadata" as const,
        error: "Metadata contains unsupported dimensions, resolution, type or byte order.",
      };
    }

    const expectedBytes =
      metadata.width * metadata.height * Float32Array.BYTES_PER_ELEMENT;

    if (
      !Number.isSafeInteger(expectedBytes) ||
      binaryStats.size !== expectedBytes
    ) {
      return {
        assetStatus: "invalid_binary_size" as const,
        error: `Expected ${expectedBytes} binary bytes; found ${binaryStats.size}.`,
        expectedBytes,
        actualBytes: binaryStats.size,
      };
    }

    return {
      assetStatus: "ready" as const,
      dimensions: [metadata.width, metadata.height],
      resolutionMeters: metadata.resolutionMeters,
      binaryBytes: binaryStats.size,
      elevationRangeMeters: [
        metadata.minElevation ?? null,
        metadata.maxElevation ?? null,
      ],
      noDataPixelCount: metadata.noDataPixelCount ?? 0,
      referenceFrame: metadata.coordinateSystem?.referenceFrame ?? null,
      ephemeris: metadata.coordinateSystem?.ephemeris ?? null,
      projection: metadata.coordinateSystem?.projection ?? null,
    };
  } catch (error) {
    const code =
      error !== null &&
      typeof error === "object" &&
      "code" in error
        ? String(error.code)
        : null;

    if (code === "ENOENT") {
      return {
        assetStatus: "not_prepared" as const,
        error: "This site's local Product78 assets have not been prepared.",
      };
    }

    return {
      assetStatus: "invalid_metadata" as const,
      error: error instanceof Error
        ? error.message
        : "Unknown Product78 asset inspection error.",
    };
  }
}

export async function GET() {
  await connection();

  const siteIds = Object.keys(
    PRODUCT78_SITE_REGISTRY
  ) as Product78SiteId[];

  const sites = await Promise.all(
    siteIds.map(async (siteId) => {
      const site = PRODUCT78_SITE_REGISTRY[siteId];
      const assets = await inspectSiteAssets(siteId);

      return {
        id: site.id,
        archiveSite: site.archiveSite,
        name: site.displayName,
        dataDirectory: site.dataDirectory,
        observer: site.observer,
        source: site.sourceUrl,
        ...assets,
      };
    })
  );

  const readyCount = sites.filter(
    (site) => site.assetStatus === "ready"
  ).length;

  return NextResponse.json({
    success: true,
    source: "NASA PGDA Product78 catalogue",
    totalSites: sites.length,
    readySites: readyCount,
    sites,
    notes: [
      "A site is marked ready when its metadata exists and its Float32 binary size matches the declared dimensions.",
      "The horizons API performs full metadata and raster validation before using a site's elevation data.",
      "Product90 is not required by the Product78 visualization path.",
    ],
  });
}
