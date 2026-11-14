
import Link from "next/link";
import { readFile } from "node:fs/promises";
import path from "node:path";

import Lunar360Explorer from "@/components/canvas/Lunar360Explorer";

import {
  DEFAULT_PRODUCT78_SITE_ID,
  getProduct78Site,
  type Product78SiteId,
} from "@/components/lib/lunar/siteRegistry";

// Allow this route to wait for request-time data during rendering.
export const instant = false;

interface ExplorerSearchParams {
  siteId?: string;
  lat?: string;
  lon?: string;
  col?: string;
  row?: string;
  date?: string;
  time?: string;
}

interface RasterMetadata {
  width: number;
  height: number;
}

function InvalidSelection() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#030406] px-6 text-center text-white">
      <div className="max-w-md">
        <p className="text-[10px] tracking-[0.3em] text-red-300/70">
          INVALID OBSERVATION LOCATION
        </p>

        <p className="mt-4 text-sm leading-6 text-white/55">
          A valid Product 78 location is required. Return to the mission
          planner, select a landing site, and choose a point inside that
          site's terrain dataset.
        </p>

        <Link
          href="/map"
          className="mt-6 inline-flex border border-white/20 px-5 py-3 text-[10px] tracking-[0.2em] text-white/75 hover:border-white/50"
        >
          RETURN TO MISSION PLANNER
        </Link>
      </div>
    </main>
  );
}

async function getRasterDimensions(
  siteId: Product78SiteId
): Promise<RasterMetadata | null> {
  const site = getProduct78Site(siteId);

  if (!site) {
    return null;
  }

  try {
    const metadataPath = path.join(
      process.cwd(),
      "public",
      "data",
      site.dataDirectory,
      "metadata.json"
    );

    const metadataContents = await readFile(
      metadataPath,
      "utf8"
    );

    const metadata = JSON.parse(metadataContents) as {
      width?: number;
      height?: number;
      raster?: {
        width?: number;
        height?: number;
      };
    };

    const width =
      metadata.width ?? metadata.raster?.width;

    const height =
      metadata.height ?? metadata.raster?.height;

    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      !width ||
      !height ||
      width <= 0 ||
      height <= 0
    ) {
      console.error(
        `[LUNAPATH] Invalid raster dimensions for ${siteId}.`,
        metadata
      );

      return null;
    }

    return { width, height };
  } catch (error) {
    console.error(
      `[LUNAPATH] Could not read raster metadata for ${siteId}:`,
      error
    );

    return null;
  }
}

export default async function ExplorerPage({
  searchParams,
}: {
  searchParams: Promise<ExplorerSearchParams>;
}) {
  const params = await searchParams;

  const requestedSiteId =
    params.siteId || DEFAULT_PRODUCT78_SITE_ID;

  const site = getProduct78Site(requestedSiteId);

  if (!site) {
    return <InvalidSelection />;
  }

  const selectedSiteId: Product78SiteId = site.id;

  const latitude = Number(params.lat);
  const longitude = Number(params.lon);
  const pixelColumn = Number(params.col);
  const pixelRow = Number(params.row);

  const dimensions = await getRasterDimensions(
    selectedSiteId
  );

  const valid =
    dimensions !== null &&
    params.lat !== undefined &&
    params.lon !== undefined &&
    params.col !== undefined &&
    params.row !== undefined &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Number.isFinite(pixelColumn) &&
    Number.isFinite(pixelRow) &&
    latitude >= -90 &&
    latitude <= 0 &&
    longitude >= 0 &&
    longitude < 360 &&
    pixelColumn >= 0 &&
    pixelColumn < dimensions.width &&
    pixelRow >= 0 &&
    pixelRow < dimensions.height;

  if (!valid) {
    return <InvalidSelection />;
  }

  return (
    <Lunar360Explorer
      siteId={selectedSiteId}
      latitude={latitude}
      longitude={longitude}
      pixelColumn={pixelColumn}
      pixelRow={pixelRow}
      missionDate={params.date || "NOT SET"}
      missionTime={params.time || "12:00"}
    />
  );
}
