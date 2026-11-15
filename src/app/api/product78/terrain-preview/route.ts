import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

import {
  DEFAULT_PRODUCT78_SITE_ID,
  getProduct78Site,
  type Product78SiteId,
} from "@/components/lib/lunar/siteRegistry";

export const maxDuration = 60;

const PREVIEW_DOWNSAMPLE_FACTOR = 8;

type PreviewMetadata = {
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
  resolutionMeters: number;
  noDataValue?: number | "NaN";
  noDataPixelCount?: number;
  bbox: [number, number, number, number];
  pixelResolution: [number, number, number];
  coordinateSystem: {
    projection: string;
    referenceFrame: string;
    ephemeris: string;
    linearUnits: string;
    pixelRegistration: string;
  };
  georeferencing: {
    tiePoint: {
      column: number;
      row: number;
      x: number;
      y: number;
    };
    centralMeridianDegrees: number;
    lunarRadiusMeters: number;
  };
  dataType: string;
  byteOrder: string;
};

type PreviewAsset = {
  metadata: PreviewMetadata;
  bytes: Uint8Array;
};

const previewCache = new Map<Product78SiteId, Promise<PreviewAsset>>();

function isNoData(value: number, metadata: PreviewMetadata): boolean {
  return metadata.noDataValue === "NaN"
    ? Number.isNaN(value)
    : typeof metadata.noDataValue === "number" &&
        value === Math.fround(metadata.noDataValue);
}

function getPreviewBoundingBox(metadata: PreviewMetadata): [number, number, number, number] {
  const { width, height, pixelResolution } = metadata;
  const tie = metadata.georeferencing.tiePoint;
  const [pixelWidth, pixelHeight] = pixelResolution;
  const x1 = tie.x - tie.column * pixelWidth;
  const x2 = tie.x + (width - tie.column) * pixelWidth;
  const y1 = tie.y - tie.row * pixelHeight;
  const y2 = tie.y + (height - tie.row) * pixelHeight;

  return [
    Math.min(x1, x2),
    Math.min(y1, y2),
    Math.max(x1, x2),
    Math.max(y1, y2),
  ];
}

async function buildPreview(siteId: Product78SiteId): Promise<PreviewAsset> {
  const site = getProduct78Site(siteId);
  const directory = path.join(process.cwd(), "public", "data", site.dataDirectory);
  const [metadataText, sourceBytes] = await Promise.all([
    readFile(path.join(directory, "metadata.json"), "utf8"),
    readFile(path.join(directory, "elevation.bin")),
  ]);
  const sourceMetadata = JSON.parse(metadataText) as PreviewMetadata;
  const factor = PREVIEW_DOWNSAMPLE_FACTOR;

  if (
    !Number.isSafeInteger(sourceMetadata.width) ||
    !Number.isSafeInteger(sourceMetadata.height) ||
    sourceMetadata.width <= 0 ||
    sourceMetadata.height <= 0 ||
    sourceMetadata.width % factor !== 0 ||
    sourceMetadata.height % factor !== 0 ||
    !Number.isSafeInteger(sourceMetadata.georeferencing?.tiePoint?.column) ||
    !Number.isSafeInteger(sourceMetadata.georeferencing?.tiePoint?.row) ||
    sourceMetadata.georeferencing.tiePoint.column % factor !== 0 ||
    sourceMetadata.georeferencing.tiePoint.row % factor !== 0 ||
    sourceBytes.byteLength !== sourceMetadata.width * sourceMetadata.height * 4
  ) {
    throw new Error(
      `Unsupported ${site.archiveSite} preview dimensions, georeferencing or binary length.`
    );
  }

  const previewMetadata: PreviewMetadata = {
    ...sourceMetadata,
    width: sourceMetadata.width / factor,
    height: sourceMetadata.height / factor,
    resolutionMeters: sourceMetadata.resolutionMeters * factor,
    pixelResolution: [
      sourceMetadata.pixelResolution[0] * factor,
      sourceMetadata.pixelResolution[1] * factor,
      sourceMetadata.pixelResolution[2] ?? 0,
    ],
    georeferencing: {
      ...sourceMetadata.georeferencing,
      tiePoint: {
        ...sourceMetadata.georeferencing.tiePoint,
        column: sourceMetadata.georeferencing.tiePoint.column / factor,
        row: sourceMetadata.georeferencing.tiePoint.row / factor,
      },
    },
    noDataPixelCount: 0,
    bbox: [0, 0, 0, 0],
  };
  previewMetadata.bbox = getPreviewBoundingBox(previewMetadata);

  const sourceView = new DataView(
    sourceBytes.buffer,
    sourceBytes.byteOffset,
    sourceBytes.byteLength
  );
  const previewPixels = previewMetadata.width * previewMetadata.height;
  const previewBytes = new Uint8Array(previewPixels * 4);
  const previewView = new DataView(previewBytes.buffer);
  let noDataBlocks = 0;

  for (let previewRow = 0; previewRow < previewMetadata.height; previewRow += 1) {
    for (let previewColumn = 0; previewColumn < previewMetadata.width; previewColumn += 1) {
      let sum = 0;
      let validCount = 0;
      const sourceStartRow = previewRow * factor;
      const sourceStartColumn = previewColumn * factor;

      for (let rowOffset = 0; rowOffset < factor; rowOffset += 1) {
        const sourceRow = sourceStartRow + rowOffset;
        const sourceRowOffset = sourceRow * sourceMetadata.width;

        for (let columnOffset = 0; columnOffset < factor; columnOffset += 1) {
          const sourceColumn = sourceStartColumn + columnOffset;
          const value = sourceView.getFloat32(
            (sourceRowOffset + sourceColumn) * 4,
            true
          );

          if (isNoData(value, sourceMetadata)) continue;
          if (!Number.isFinite(value)) {
            throw new Error(
              `Invalid Product78 elevation at ${sourceColumn}, ${sourceRow}.`
            );
          }

          sum += value;
          validCount += 1;
        }
      }

      const previewIndex = previewRow * previewMetadata.width + previewColumn;
      if (validCount === 0) {
        if (sourceMetadata.noDataValue === undefined) {
          throw new Error("A fully empty preview block has no declared NoData value.");
        }

        noDataBlocks += 1;
        previewView.setFloat32(
          previewIndex * 4,
          sourceMetadata.noDataValue === "NaN"
            ? Number.NaN
            : sourceMetadata.noDataValue,
          true
        );
      } else {
        previewView.setFloat32(previewIndex * 4, sum / validCount, true);
      }
    }
  }

  if (sourceMetadata.noDataValue !== undefined) {
    previewMetadata.noDataPixelCount = noDataBlocks;
  } else {
    delete previewMetadata.noDataValue;
    delete previewMetadata.noDataPixelCount;
  }

  return { metadata: previewMetadata, bytes: previewBytes };
}

function getPreview(siteId: Product78SiteId): Promise<PreviewAsset> {
  const cached = previewCache.get(siteId);
  if (cached) return cached;

  const pending = buildPreview(siteId);
  previewCache.set(siteId, pending);
  void pending.catch(() => {
    if (previewCache.get(siteId) === pending) {
      previewCache.delete(siteId);
    }
  });
  return pending;
}

export async function GET(request: NextRequest) {
  try {
    const requestedSite = request.nextUrl.searchParams.get("siteId");
    const siteId = (
      requestedSite ?? DEFAULT_PRODUCT78_SITE_ID
    ) as Product78SiteId;

    getProduct78Site(siteId);
    const preview = await getPreview(siteId);

    const responseBody = new ArrayBuffer(preview.bytes.byteLength);
    new Uint8Array(responseBody).set(preview.bytes);

    return new NextResponse(responseBody, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-LunaPath-Terrain-Metadata": encodeURIComponent(
          JSON.stringify(preview.metadata)
        ),
        "X-LunaPath-Terrain-Preview": "true",
        "X-LunaPath-Terrain-Downsample-Factor": String(PREVIEW_DOWNSAMPLE_FACTOR),
      },
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Unknown Product78 preview error.";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
