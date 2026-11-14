import { NextRequest, NextResponse } from "next/server";
import { open, readFile } from "node:fs/promises";
import path from "node:path";

import { getProduct78Site } from "@/components/lib/lunar/siteRegistry";

const EXPECTED_LAYERS = [
  { key: "slope", output: "slope.bin" },
  { key: "slopeUncertainty", output: "slope-uncertainty.bin" },
  { key: "elevationUncertainty", output: "elevation-uncertainty.bin" },
  { key: "observationCount", output: "observation-count.bin" },
] as const;

function finiteInteger(value: string | null, name: string): number {
  if (value === null || value.trim() === "") {
    throw new Error(`${name} is required.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

async function readFloat32At(filePath: string, offset: number): Promise<number> {
  const handle = await open(filePath, "r");
  try {
    const bytes = Buffer.alloc(4);
    const result = await handle.read(bytes, 0, 4, offset);
    if (result.bytesRead !== 4) {
      throw new Error(`Science raster ended before byte offset ${offset}.`);
    }
    const value = bytes.readFloatLE(0);
    if (!Number.isFinite(value)) {
      throw new Error(`Science raster contains a non-finite value at byte offset ${offset}.`);
    }
    return value;
  } finally {
    await handle.close();
  }
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const siteId = params.get("siteId") ?? "site04_shackleton_rim";
    const site = getProduct78Site(siteId);
    const column = finiteInteger(params.get("col"), "col");
    const row = finiteInteger(params.get("row"), "row");

    const directory = path.join(
      process.cwd(),
      "public",
      "data",
      site.dataDirectory
    );

    let rawMetadata: unknown;
    try {
      rawMetadata = JSON.parse(
        await readFile(path.join(directory, "science-metadata.json"), "utf8")
      );
    } catch {
      return NextResponse.json({
        success: true,
        available: false,
        siteId,
        reason: "Science layers are not prepared for this site.",
      });
    }

    if (
      rawMetadata === null ||
      typeof rawMetadata !== "object" ||
      !("dimensions" in rawMetadata) ||
      !("layers" in rawMetadata)
    ) {
      throw new Error("Science metadata is invalid.");
    }

    const metadata = rawMetadata as {
      dimensions: { width: number; height: number };
      resolutionMeters: number;
      layers: Array<{
        key: string;
        output: string;
        byteLength: number;
        noDataCount: number;
        minimum: number;
        maximum: number;
      }>;
    };

    const { width, height } = metadata.dimensions;
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      column >= width ||
      row >= height
    ) {
      throw new Error("Selected raster pixel is outside the science dataset.");
    }

    if (metadata.resolutionMeters !== 5) {
      throw new Error("Science raster resolution does not match the Product78 5 m dataset.");
    }

    const index = row * width + column;
    const offset = index * Float32Array.BYTES_PER_ELEMENT;
    const elevationMeters = await readFloat32At(
      path.join(directory, "elevation.bin"),
      offset
    );
    const values: Record<string, number> = {
      elevationMeters,
    };

    for (const expected of EXPECTED_LAYERS) {
      const layer = metadata.layers.find((item) => item.key === expected.key);
      if (!layer || layer.output !== expected.output) {
        throw new Error(`Science metadata is missing the expected ${expected.key} layer.`);
      }

      const expectedBytes = width * height * Float32Array.BYTES_PER_ELEMENT;
      if (
        layer.byteLength !== expectedBytes ||
        layer.noDataCount !== 0 ||
        !Number.isFinite(layer.minimum) ||
        !Number.isFinite(layer.maximum) ||
        layer.minimum > layer.maximum
      ) {
        throw new Error(`Science layer metadata failed validation: ${expected.key}.`);
      }

      const value = await readFloat32At(path.join(directory, expected.output), offset);
      if (value < layer.minimum - 0.001 || value > layer.maximum + 0.001) {
        throw new Error(`Science value is outside declared range: ${expected.key}.`);
      }
      values[expected.key] = value;
    }

    return NextResponse.json({
      success: true,
      available: true,
      siteId,
      pixel: { column, row },
      resolutionMeters: metadata.resolutionMeters,
      values: {
        elevationMeters: values.elevationMeters,
        elevationUncertaintyMeters: values.elevationUncertainty,
        slopeDegrees: values.slope,
        slopeUncertaintyDegrees: values.slopeUncertainty,
        observationCount: values.observationCount,
      },
      source: "NASA LOLA Product78",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Science sample failed.",
      },
      { status: 400 }
    );
  }
}
