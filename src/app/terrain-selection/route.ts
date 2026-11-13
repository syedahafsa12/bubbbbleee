
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  type GeographicCoordinate,
  type LolaTerrainData,
  decodeLolaTerrain,
  geographicToLolaProjected,
} from "@/components/lib/lunar/terrainData";

import {
  sampleMultiResolutionElevation,
} from "@/components/lib/lunar/multiResolutionTerrain.server";

type TerrainCache = {
  promise: Promise<LolaTerrainData> | null;
};

const terrainCache: TerrainCache = {
  promise: null,
};

async function loadProduct78(): Promise<LolaTerrainData> {
  if (terrainCache.promise) {
    return terrainCache.promise;
  }

  const pending = (async () => {
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

    const metadata: unknown = JSON.parse(metadataText);

    return decodeLolaTerrain(
      metadata,
      new Uint8Array(
        binary.buffer,
        binary.byteOffset,
        binary.byteLength
      )
    );
  })();

  terrainCache.promise = pending;

  try {
    return await pending;
  } catch (error) {
    if (terrainCache.promise === pending) {
      terrainCache.promise = null;
    }

    throw error;
  }
}

function isObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export async function POST(request: Request) {
  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Request body must contain valid JSON.",
        },
        { status: 400 }
      );
    }

    if (!isObject(body)) {
      return NextResponse.json(
        {
          success: false,
          error: "Request body must be a JSON object.",
        },
        { status: 400 }
      );
    }

    const latitude = body.latitudeDeg;
    const longitude = body.longitudeEastDeg;

    if (
      typeof latitude !== "number" ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 0 ||
      typeof longitude !== "number" ||
      !Number.isFinite(longitude) ||
      longitude < -360 ||
      longitude > 360
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid lunar coordinates.",
        },
        { status: 400 }
      );
    }

    const observer: GeographicCoordinate = {
      latitudeDeg: latitude,
      longitudeEastDeg: longitude,
    };

    const terrain = await loadProduct78();

    const projected = geographicToLolaProjected(
      observer,
      terrain.metadata
    );

    const sample = await sampleMultiResolutionElevation(
      terrain,
      projected
    );

    if (!sample) {
      return NextResponse.json(
        {
          success: false,
          supported: false,
          coordinate: observer,
          projected,
          error:
            "No valid elevation sample exists at this coordinate in the available terrain datasets.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      supported: true,
      coordinate: observer,
      projected,

      terrain: {
        elevationMeters: sample.elevationMeters,
        source: sample.source,
        resolutionMeters: sample.resolutionMeters,
      },

      limitations: [
        "An elevation sample does not establish landing safety.",
        "Terrain horizon analysis has not yet been performed.",
        "Illumination and Earth visibility have not yet been assessed.",
      ],
    });
  } catch (error) {
    console.error("[Terrain Selection API]", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown terrain selection error.",
      },
      { status: 500 }
    );
  }
}
