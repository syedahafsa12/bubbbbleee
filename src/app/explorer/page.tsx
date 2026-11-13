
import Link from "next/link";

import Lunar360Explorer from "@/components/canvas/Lunar360Explorer";

// This route depends on runtime URL search parameters.
export const instant = false;

interface ExplorerSearchParams {
  lat?: string;
  lon?: string;
  col?: string;
  row?: string;
  date?: string;
  time?: string;
}

const RASTER_WIDTH = 3200;
const RASTER_HEIGHT = 3200;

function InvalidSelection() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#030406] px-6 text-center text-white">
      <div className="max-w-md">
        <p className="text-[10px] tracking-[0.3em] text-red-300/70">
          INVALID OBSERVATION LOCATION
        </p>

        <p className="mt-4 text-sm leading-6 text-white/55">
          A valid Product 78 location is required. Return to the
          mission planner and select a point inside the Shackleton
          Rim terrain dataset.
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

export default async function ExplorerPage({
  searchParams,
}: {
  searchParams: Promise<ExplorerSearchParams>;
}) {
  const params = await searchParams;

  const latitude = Number(params.lat);
  const longitude = Number(params.lon);
  const pixelColumn = Number(params.col);
  const pixelRow = Number(params.row);

  const valid =
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
    pixelColumn < RASTER_WIDTH &&
    pixelRow >= 0 &&
    pixelRow < RASTER_HEIGHT;

  if (!valid) {
    return <InvalidSelection />;
  }

  return (
    <Lunar360Explorer
      latitude={latitude}
      longitude={longitude}
      pixelColumn={pixelColumn}
      pixelRow={pixelRow}
      missionDate={params.date || "NOT SET"}
      missionTime={params.time || "12:00"}
    />
  );
}
