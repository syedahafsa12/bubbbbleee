
"use client";

import { useEffect, useState } from "react";

import {
  loadLolaTerrain,
  sampleSite04Elevation,
  type LolaSample,
} from "@/components/lib/lunar/terrainData";

interface CheckResult {
  sample: LolaSample;
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
  referenceFrame: string;
  ephemeris: string;
  projection: string;
}

export default function TerrainCheckPage() {
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function runCheck() {
      try {
        setLoading(true);
        setError(null);

        const terrain = await loadLolaTerrain();
        const sample = sampleSite04Elevation(terrain);

        if (cancelled) return;

        setResult({
          sample,
          width: terrain.width,
          height: terrain.height,
          minElevation: terrain.minElevation,
          maxElevation: terrain.maxElevation,
          referenceFrame: terrain.metadata.coordinateSystem.referenceFrame,
          ephemeris: terrain.metadata.coordinateSystem.ephemeris,
          projection: terrain.metadata.coordinateSystem.projection,
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unknown terrain error."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    runCheck();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main
      className="relative w-full min-h-screen overflow-x-hidden overflow-y-auto bg-neutral-950 text-neutral-100"
      style={{
        height: "auto",
        maxHeight: "none",
        overscrollBehaviorY: "auto",
      }}
    >
      <div className="mx-auto w-full max-w-4xl space-y-8 px-5 py-12 sm:px-8 sm:py-16">

        <header className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-neutral-500">
            NASA LOLA · Data validation
          </p>

          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Shackleton Rim Terrain Check
          </h1>

          <p className="max-w-2xl text-sm leading-7 text-neutral-400">
            Validating geographic coordinates against the NASA LOLA elevation
            raster.
          </p>
        </header>

        {loading && (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
            <div className="flex items-center gap-3">
              <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-blue-400" />
              <p className="text-sm text-neutral-300">
                Loading NASA elevation data and calculating the Site04 position...
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-900 bg-red-950/30 p-6">
            <h2 className="font-semibold text-red-400">
              Terrain validation failed
            </h2>

            <p className="mt-3 break-words text-sm leading-6 text-red-200">
              {error}
            </p>

            <button
              onClick={() => window.location.reload()}
              className="mt-5 rounded-lg border border-red-800 px-4 py-2 text-sm text-red-200 transition hover:bg-red-900/40"
            >
              Retry validation
            </button>
          </div>
        )}

        {result && (
          <>
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
              <SectionHeading
                number="01"
                title="Geographic observation point"
              />

              <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
                <Metric
                  label="Latitude"
                  value={`${result.sample.geographic.latitudeDeg}°`}
                />

                <Metric
                  label="Longitude East"
                  value={`${result.sample.geographic.longitudeEastDeg}°`}
                />

                <Metric
                  label="Projected X"
                  value={`${result.sample.projected.xMeters.toFixed(3)} m`}
                />

                <Metric
                  label="Projected Y"
                  value={`${result.sample.projected.yMeters.toFixed(3)} m`}
                />
              </div>
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
              <SectionHeading
                number="02"
                title="Raster position"
              />

              <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
                <Metric
                  label="Fractional column"
                  value={result.sample.pixel.column.toFixed(4)}
                />

                <Metric
                  label="Fractional row"
                  value={result.sample.pixel.row.toFixed(4)}
                />

                <Metric
                  label="Nearest column"
                  value={String(result.sample.nearestPixel.column)}
                />

                <Metric
                  label="Nearest row"
                  value={String(result.sample.nearestPixel.row)}
                />
              </div>

              <div className="mt-6 rounded-xl border border-emerald-900/60 bg-emerald-950/20 p-4">
                <p className="text-sm text-emerald-400">
                  Site04 maps inside the available raster.
                </p>
              </div>
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
              <SectionHeading
                number="03"
                title="Elevation at Site04"
              />

              <p className="mt-6 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
                {result.sample.elevationMeters.toFixed(3)}
                <span className="ml-2 text-lg font-normal text-neutral-500">
                  metres
                </span>
              </p>

              <p className="mt-3 text-sm leading-6 text-neutral-500">
                Bilinear interpolation using the four surrounding DEM pixels.
              </p>
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
              <SectionHeading
                number="04"
                title="Raster information"
              />

              <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
                <Metric
                  label="Dimensions"
                  value={`${result.width} × ${result.height}`}
                />

                <Metric
                  label="Resolution"
                  value="5 metres / pixel"
                />

                <Metric
                  label="Minimum elevation"
                  value={`${result.minElevation.toFixed(2)} m`}
                />

                <Metric
                  label="Maximum elevation"
                  value={`${result.maxElevation.toFixed(2)} m`}
                />

                <Metric
                  label="Reference frame"
                  value={result.referenceFrame}
                />

                <Metric
                  label="Source ephemeris"
                  value={result.ephemeris}
                />
              </div>

              <p className="mt-6 text-sm text-neutral-500">
                Projection: {result.projection}
              </p>
            </section>

            <section className="rounded-2xl border border-amber-900/60 bg-amber-950/20 p-6">
              <h2 className="font-semibold text-amber-400">
                Scientific validation still required
              </h2>

              <p className="mt-3 text-sm leading-7 text-neutral-300">
                This test verifies the implemented coordinate transformation
                and raster lookup. It does not independently establish that
                the DEM and Horizons observer coordinates use perfectly
                aligned lunar reference frames.
              </p>
            </section>
          </>
        )}

        <footer className="border-t border-neutral-800 py-8 text-xs text-neutral-600">
          NASA LOLA · Site04 · Shackleton Rim
          <span className="float-right">Terrain validation</span>
        </footer>
      </div>
    </main>
  );
}

function SectionHeading({
  number,
  title,
}: {
  number: string;
  title: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-mono text-neutral-600">{number}</span>
      <h2 className="text-lg font-semibold">{title}</h2>
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </p>

      <p className="mt-2 break-words text-base font-medium tabular-nums text-neutral-100">
        {value}
      </p>
    </div>
  );
}
