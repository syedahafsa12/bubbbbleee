import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  geographicToLolaProjected,
  projectedToLolaPixel,
  type LolaTerrainMetadata,
} from "@/components/lib/lunar/terrainData";
import { getProduct78Site } from "@/components/lib/lunar/siteRegistry";

export const maxDuration = 30;

const LUNASERV_WMS_URL = "https://wms.im-ldi.com/";
const LROC_LAYER = "luna_nac_pole_control_south";
const LROC_SOUTH_POLAR_SRS = "IAU2000:30120";
const IMAGE_HALF_SPAN_METERS = 12_000;
const IMAGE_SIZE_PIXELS = 2048;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

function parseFiniteParameter(
  value: string | null,
  name: string
): number {
  if (value === null || value.trim() === "") {
    throw new Error(`${name} is required.`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number.`);
  }
  return parsed;
}

function isMetadata(value: unknown): value is LolaTerrainMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<LolaTerrainMetadata>;
  const tiePoint = candidate.georeferencing?.tiePoint;
  const coordinateSystem = candidate.coordinateSystem;

  return (
    Number.isSafeInteger(candidate.width) &&
    Number.isSafeInteger(candidate.height) &&
    candidate.width! > 0 &&
    candidate.height! > 0 &&
    candidate.resolutionMeters === 5 &&
    Array.isArray(candidate.pixelResolution) &&
    candidate.pixelResolution.length >= 3 &&
    candidate.pixelResolution.every(Number.isFinite) &&
    Array.isArray(candidate.bbox) &&
    candidate.bbox.length === 4 &&
    candidate.bbox.every(Number.isFinite) &&
    typeof candidate.georeferencing === "object" &&
    candidate.georeferencing !== null &&
    typeof tiePoint === "object" &&
    tiePoint !== null &&
    Number.isFinite(tiePoint.column) &&
    Number.isFinite(tiePoint.row) &&
    Number.isFinite(tiePoint.x) &&
    Number.isFinite(tiePoint.y) &&
    Number.isFinite(candidate.georeferencing.centralMeridianDegrees) &&
    Number.isFinite(candidate.georeferencing.lunarRadiusMeters) &&
    (candidate.georeferencing.lunarRadiusMeters ?? 0) > 0 &&
    typeof coordinateSystem === "object" &&
    coordinateSystem !== null &&
    typeof coordinateSystem.projection === "string" &&
    coordinateSystem.projection.toLowerCase().includes("south polar stereographic") &&
    typeof coordinateSystem.referenceFrame === "string" &&
    coordinateSystem.referenceFrame.toUpperCase() === "MOON_ME" &&
    typeof coordinateSystem.ephemeris === "string" &&
    coordinateSystem.ephemeris.toUpperCase() === "DE421" &&
    typeof coordinateSystem.linearUnits === "string" &&
    ["m", "meter", "meters", "metre", "metres"].includes(coordinateSystem.linearUnits.toLowerCase()) &&
    typeof coordinateSystem.pixelRegistration === "string" &&
    coordinateSystem.pixelRegistration.toLowerCase().replace(/[^a-z]/g, "") === "pixelarea"
  );
}

function jsonError(message: string, status: number) {
  return NextResponse.json(
    {
      success: false,
      source: "LROC NAC controlled South Pole average mosaic",
      error: message,
    },
    { status }
  );
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const siteId = params.get("siteId") ?? "site04_shackleton_rim";
    const site = getProduct78Site(siteId);

    const latitudeDeg = parseFiniteParameter(params.get("lat"), "Latitude");
    const longitudeEastDeg = parseFiniteParameter(params.get("lon"), "Longitude");
    const pixelColumn = parseFiniteParameter(params.get("col"), "Pixel column");
    const pixelRow = parseFiniteParameter(params.get("row"), "Pixel row");

    if (latitudeDeg < -90 || latitudeDeg > -84) {
      return jsonError(
        "The controlled South Pole NAC mosaic covers 84°S to 90°S only.",
        422
      );
    }
    if (longitudeEastDeg < 0 || longitudeEastDeg >= 360) {
      throw new Error("Longitude must use east-positive degrees in [0, 360).");
    }
    if (
      !Number.isFinite(pixelColumn) ||
      !Number.isFinite(pixelRow) ||
      pixelColumn < 0 ||
      pixelRow < 0
    ) {
      throw new Error("Selected Product78 pixel coordinates are invalid.");
    }

    const metadataPath = path.join(
      process.cwd(),
      "public",
      "data",
      site.dataDirectory,
      "metadata.json"
    );
    const metadataValue: unknown = JSON.parse(
      await readFile(metadataPath, "utf8")
    );

    if (!isMetadata(metadataValue)) {
      throw new Error("Product78 georeferencing metadata is invalid.");
    }

    const metadata = metadataValue;
    if (
      pixelColumn >= metadata.width ||
      pixelRow >= metadata.height ||
      metadata.resolutionMeters !== 5
    ) {
      throw new Error("Selected pixel is outside the prepared 5 m Product78 raster.");
    }

    const projected = geographicToLolaProjected(
      { latitudeDeg, longitudeEastDeg },
      metadata
    );
    const projectedPixel = projectedToLolaPixel(projected, metadata);

    if (Math.hypot(
      projectedPixel.column - pixelColumn,
      projectedPixel.row - pixelRow
    ) > 1.5) {
      throw new Error(
        "Selected latitude/longitude does not match the supplied Product78 pixel."
      );
    }

    const halfSpan = IMAGE_HALF_SPAN_METERS;
    const bbox = [
      projected.xMeters - halfSpan,
      projected.yMeters - halfSpan,
      projected.xMeters + halfSpan,
      projected.yMeters + halfSpan,
    ];

    const wmsUrl = new URL(LUNASERV_WMS_URL);
    wmsUrl.searchParams.set("SERVICE", "WMS");
    wmsUrl.searchParams.set("VERSION", "1.1.1");
    wmsUrl.searchParams.set("REQUEST", "GetMap");
    wmsUrl.searchParams.set("LAYERS", LROC_LAYER);
    wmsUrl.searchParams.set("STYLES", "");
    wmsUrl.searchParams.set("SRS", LROC_SOUTH_POLAR_SRS);
    wmsUrl.searchParams.set("BBOX", bbox.map((value) => value.toFixed(3)).join(","));
    wmsUrl.searchParams.set("WIDTH", String(IMAGE_SIZE_PIXELS));
    wmsUrl.searchParams.set("HEIGHT", String(IMAGE_SIZE_PIXELS));
    wmsUrl.searchParams.set("FORMAT", "image/png");
    wmsUrl.searchParams.set("TRANSPARENT", "TRUE");
    wmsUrl.searchParams.set("BGCOLOR", "0x111111");

    let upstream: Response;
    try {
      upstream = await fetch(wmsUrl, {
        method: "GET",
        cache: "force-cache",
        headers: {
          Accept: "image/png",
          "User-Agent": "LunaPath/1.0 (NASA lunar terrain visualization)",
        },
        signal: AbortSignal.timeout(25_000),
      });
    } catch (error) {
      return jsonError(
        `Could not retrieve LROC imagery from Lunaserv: ${error instanceof Error ? error.message : "network request failed"}`,
        502
      );
    }

    if (!upstream.ok) {
      const detail = (await upstream.text().catch(() => "")).slice(0, 600);
      return jsonError(
        `Lunaserv WMS returned HTTP ${upstream.status}.${detail ? ` ${detail}` : ""}`,
        502
      );
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("image/png")) {
      const detail = (await upstream.text().catch(() => "")).slice(0, 600);
      return jsonError(
        `Lunaserv did not return a PNG image.${detail ? ` ${detail}` : ""}`,
        502
      );
    }

    const imageBytes = await upstream.arrayBuffer();
    if (imageBytes.byteLength === 0 || imageBytes.byteLength > MAX_IMAGE_BYTES) {
      return jsonError(
        `LROC image response size is invalid (${imageBytes.byteLength} bytes).`,
        502
      );
    }

    return new NextResponse(imageBytes, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(imageBytes.byteLength),
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
        "X-LunaPath-Imagery": "LROC controlled South Pole NAC average mosaic",
        "X-LunaPath-Imagery-Layer": LROC_LAYER,
        "X-LunaPath-Imagery-Projection": LROC_SOUTH_POLAR_SRS,
        "X-LunaPath-Imagery-Use": "Average image texture only; not calibrated albedo, live illumination or elevation",
      },
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Unknown LROC imagery request error.";
    return jsonError(message, 400);
  }
}
