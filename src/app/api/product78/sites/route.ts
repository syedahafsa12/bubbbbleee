
import { connection, NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  PRODUCT78_SITE_REGISTRY,
  type Product78SiteId,
} from "@/components/lib/lunar/siteRegistry";

const EXPECTED_SCIENCE_LAYERS = {
  slope: {
    output: "slope.bin",
    description: "NASA Product 78 slope in degrees",
  },
  slopeUncertainty: {
    output: "slope-uncertainty.bin",
    description: "NASA RMS slope uncertainty in degrees",
  },
  elevationUncertainty: {
    output: "elevation-uncertainty.bin",
    description: "NASA RMS elevation uncertainty in metres",
  },
  observationCount: {
    output: "observation-count.bin",
    description: "Number of LOLA observations contributing to each pixel",
  },
} as const;

type ScienceLayerKey = keyof typeof EXPECTED_SCIENCE_LAYERS;

type ScienceLayerStatus = "ready" | "invalid" | "not_prepared";

interface ScienceLayerInspection {
  status: ScienceLayerStatus;
  error?: string;
  expectedFile?: string;
  expectedBytes?: number;
  actualBytes?: number;
  file?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  noDataCount?: number;
  byteLength?: number;
}

interface ElevationMetadata {
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
}

interface ScienceLayerMetadata {
  key: string;
  source: string;
  output: string;
  description?: string;
  minimum: number;
  maximum: number;
  noDataCount: number;
  byteLength: number;
}

interface ScienceMetadata {
  product: string;
  archiveSite: string;
  siteName: string;
  dimensions: {
    width: number;
    height: number;
  };
  resolutionMeters: number;
  coordinateSystem: {
    projection: string;
    referenceFrame: string;
    ephemeris: string;
    linearUnits: string;
    pixelRegistration: string;
  };
  dataType: string;
  byteOrder: string;
  layers: ScienceLayerMetadata[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateElevationMetadata(raw: unknown): {
  valid: boolean;
  metadata?: ElevationMetadata;
  error?: string;
} {
  if (!isRecord(raw)) {
    return { valid: false, error: "Elevation metadata is not an object." };
  }

  const metadata = raw as unknown as ElevationMetadata;

  if (
    !Number.isSafeInteger(metadata.width) ||
    metadata.width <= 0 ||
    !Number.isSafeInteger(metadata.height) ||
    metadata.height <= 0 ||
    !isFiniteNumber(metadata.resolutionMeters) ||
    metadata.resolutionMeters <= 0 ||
    typeof metadata.dataType !== "string" ||
    metadata.dataType.toLowerCase() !== "float32" ||
    typeof metadata.byteOrder !== "string" ||
    !["little-endian", "le"].includes(metadata.byteOrder.toLowerCase())
  ) {
    return {
      valid: false,
      error:
        "Elevation metadata contains unsupported dimensions, resolution, type or byte order.",
    };
  }

  return { valid: true, metadata };
}

async function inspectElevationAssets(siteId: Product78SiteId) {
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

    const parsed: unknown = JSON.parse(metadataText);
    const validation = validateElevationMetadata(parsed);

    if (!validation.valid || !validation.metadata) {
      return {
        assetStatus: "invalid_metadata" as const,
        error: validation.error,
      };
    }

    const metadata = validation.metadata;

    const expectedBytes =
      metadata.width *
      metadata.height *
      Float32Array.BYTES_PER_ELEMENT;

    if (
      !Number.isSafeInteger(expectedBytes) ||
      binaryStats.size !== expectedBytes
    ) {
      return {
        assetStatus: "invalid_binary_size" as const,
        error: `Expected ${expectedBytes} elevation bytes; found ${binaryStats.size}.`,
        expectedBytes,
        actualBytes: binaryStats.size,
      };
    }

    return {
      assetStatus: "ready" as const,
      dimensions: [metadata.width, metadata.height] as [number, number],
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
      isRecord(error) && "code" in error ? String(error.code) : null;

    if (code === "ENOENT") {
      return {
        assetStatus: "not_prepared" as const,
        error: "This site's local elevation assets have not been prepared.",
      };
    }

    return {
      assetStatus: "invalid_metadata" as const,
      error:
        error instanceof Error
          ? error.message
          : "Unknown elevation asset inspection error.",
    };
  }
}

function validateScienceMetadata(
  raw: unknown,
  expectedWidth: number,
  expectedHeight: number,
  expectedArchiveSite: string
): {
  valid: boolean;
  metadata?: ScienceMetadata;
  error?: string;
} {
  if (!isRecord(raw)) {
    return { valid: false, error: "Science metadata is not an object." };
  }

  const metadata = raw as unknown as ScienceMetadata;

  if (
    metadata.product !== "NASA LOLA Product 78" ||
    metadata.archiveSite !== expectedArchiveSite ||
    !isRecord(metadata.dimensions) ||
    metadata.dimensions.width !== expectedWidth ||
    metadata.dimensions.height !== expectedHeight ||
    metadata.resolutionMeters !== 5 ||
    !isRecord(metadata.coordinateSystem) ||
    metadata.coordinateSystem.projection !== "South Polar Stereographic" ||
    metadata.coordinateSystem.referenceFrame !== "MOON_ME" ||
    metadata.coordinateSystem.ephemeris !== "DE421" ||
    metadata.coordinateSystem.linearUnits !== "meters" ||
    metadata.coordinateSystem.pixelRegistration !== "pixel area" ||
    metadata.dataType !== "Float32" ||
    metadata.byteOrder !== "little-endian" ||
    !Array.isArray(metadata.layers)
  ) {
    return {
      valid: false,
      error:
        "Science metadata does not match the expected Product 78 raster specification.",
    };
  }

  return { valid: true, metadata };
}

async function inspectScienceLayers(
  siteId: Product78SiteId,
  elevationDimensions?: [number, number]
) {
  const site = PRODUCT78_SITE_REGISTRY[siteId];

  const directory = path.join(
    process.cwd(),
    "public",
    "data",
    site.dataDirectory
  );

  if (!elevationDimensions) {
    return {
      scienceLayersStatus: "blocked" as const,
      error:
        "Science layers cannot be validated without valid elevation dimensions.",
      layers: {},
    };
  }

  try {
    const metadataText = await readFile(
      path.join(directory, "science-metadata.json"),
      "utf8"
    );

    const parsed: unknown = JSON.parse(metadataText);

    const validation = validateScienceMetadata(
      parsed,
      elevationDimensions[0],
      elevationDimensions[1],
      site.archiveSite
    );

    if (!validation.valid || !validation.metadata) {
      return {
        scienceLayersStatus: "invalid" as const,
        error: validation.error,
        layers: {},
      };
    }

    const metadata = validation.metadata;

    const expectedByteLength =
      metadata.dimensions.width *
      metadata.dimensions.height *
      Float32Array.BYTES_PER_ELEMENT;

    const metadataByKey = new Map(
      metadata.layers.map((layer) => [layer.key, layer])
    );

    const layerResults = await Promise.all(
      (Object.keys(EXPECTED_SCIENCE_LAYERS) as ScienceLayerKey[]).map(
        async (key): Promise<readonly [ScienceLayerKey, ScienceLayerInspection]> => {
          const expected = EXPECTED_SCIENCE_LAYERS[key];
          const layer = metadataByKey.get(key);

          if (!layer) {
            return [
              key,
              {
                status: "invalid",
                error: "Layer is missing from science-metadata.json.",
                expectedFile: expected.output,
              },
            ];
          }

          if (
            layer.output !== expected.output ||
            !isFiniteNumber(layer.minimum) ||
            !isFiniteNumber(layer.maximum) ||
            layer.minimum > layer.maximum ||
            !isFiniteNumber(layer.noDataCount) ||
            layer.noDataCount < 0 ||
            !Number.isSafeInteger(layer.byteLength) ||
            layer.byteLength !== expectedByteLength
          ) {
            return [
              key,
              {
                status: "invalid",
                error:
                  "Layer metadata contains invalid values or an unexpected output file.",
                expectedFile: expected.output,
              },
            ];
          }

          try {
            const binaryStats = await stat(
              path.join(directory, expected.output)
            );

            if (
              binaryStats.size !== expectedByteLength ||
              binaryStats.size !== layer.byteLength
            ) {
              return [
                key,
                {
                  status: "invalid",
                  error: `Expected ${expectedByteLength} bytes; found ${binaryStats.size}.`,
                  expectedBytes: expectedByteLength,
                  actualBytes: binaryStats.size,
                  file: expected.output,
                },
              ];
            }

            return [
              key,
              {
                status: "ready",
                file: expected.output,
                description: expected.description,
                minimum: layer.minimum,
                maximum: layer.maximum,
                noDataCount: layer.noDataCount,
                byteLength: binaryStats.size,
              },
            ];
          } catch (error) {
            const code =
              isRecord(error) && "code" in error
                ? String(error.code)
                : null;

            return [
              key,
              {
                status: code === "ENOENT" ? "not_prepared" : "invalid",
                error:
                  code === "ENOENT"
                    ? `Missing file: ${expected.output}`
                    : error instanceof Error
                      ? error.message
                      : "Unknown science-layer inspection error.",
                file: expected.output,
              },
            ];
          }
        }
      )
    );

    const layers = Object.fromEntries(
      layerResults
    ) as Record<ScienceLayerKey, ScienceLayerInspection>;

    const statuses = Object.values(layers).map((layer) => layer.status);

    const scienceLayersStatus = statuses.every(
      (status) => status === "ready"
    )
      ? "ready"
      : statuses.some((status) => status === "invalid")
        ? "invalid"
        : "not_prepared";

    return {
      scienceLayersStatus,
      scienceMetadata: {
        product: metadata.product,
        archiveSite: metadata.archiveSite,
        dimensions: metadata.dimensions,
        resolutionMeters: metadata.resolutionMeters,
        projection: metadata.coordinateSystem.projection,
        referenceFrame: metadata.coordinateSystem.referenceFrame,
        ephemeris: metadata.coordinateSystem.ephemeris,
        pixelRegistration: metadata.coordinateSystem.pixelRegistration,
      },
      layers,
    };
  } catch (error) {
    const code =
      isRecord(error) && "code" in error ? String(error.code) : null;

    if (code === "ENOENT") {
      return {
        scienceLayersStatus: "not_prepared" as const,
        error:
          "This site's local NASA science-layer assets have not been prepared.",
        layers: {},
      };
    }

    return {
      scienceLayersStatus: "invalid" as const,
      error:
        error instanceof Error
          ? error.message
          : "Unknown science metadata inspection error.",
      layers: {},
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

      const elevation = await inspectElevationAssets(siteId);

      const dimensions: [number, number] | undefined =
        elevation.assetStatus === "ready"
          ? elevation.dimensions
          : undefined;

      const science = await inspectScienceLayers(siteId, dimensions);

      return {
        id: site.id,
        archiveSite: site.archiveSite,
        name: site.displayName,
        dataDirectory: site.dataDirectory,
        observer: site.observer,
        source: site.sourceUrl,
        ...elevation,
        ...science,
      };
    })
  );

  const readyCount = sites.filter(
    (site) => site.assetStatus === "ready"
  ).length;

  const scienceReadyCount = sites.filter(
    (site) => site.scienceLayersStatus === "ready"
  ).length;

  return NextResponse.json({
    success: true,
    source: "NASA PGDA Product 78 catalogue",
    totalSites: sites.length,
    readySites: readyCount,
    scienceReadySites: scienceReadyCount,
    sites,
    notes: [
      "Elevation readiness and science-layer readiness are validated independently.",
      "Science-layer readiness requires all four NASA Product 78 Float32 rasters and matching metadata.",
      "Binary validation checks file sizes; it does not independently verify every raster value.",
      "A registry entry does not imply that its local raster assets have been prepared.",
      "Product 90 is not required by the Product 78 visualization path.",
    ],
  });
}
