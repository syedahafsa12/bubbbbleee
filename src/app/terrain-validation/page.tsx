
"use client";

import { useState } from "react";
import {
  calculateTerrainHorizon,
} from "@/components/lib/lunar/terrainHorizon";
import {
  loadLolaTerrain,
} from "@/components/lib/lunar/terrainData";

interface ValidationReport {
  directions: number;
  samples: number;
  boundaryLimited: number;
  searchLimitReached: number;
  averageHorizon: number;
  minimumHorizon: number;
  maximumHorizon: number;
  highestDirection: number;
  highestDistance: number;
  highestTerrainElevation: number;
  observerElevation: number;
  runtimeMs: number;
}

export default function TerrainValidationPage() {
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function runValidation() {
    setLoading(true);
    setError("");
    setReport(null);

    try {
      const start = performance.now();

      const terrain = await loadLolaTerrain();

      const result = calculateTerrainHorizon(
        terrain,
        undefined,
  {
  directionCount: 1440,
  sampleStepMeters: 5,
  maxDistanceMeters: 15000,
}
      );

      const angles = result.directions.map(
        (direction) => direction.horizonElevationDeg
      );

      const highest = result.directions.reduce(
        (previous, current) =>
          current.horizonElevationDeg >
          previous.horizonElevationDeg
            ? current
            : previous
      );

      const average =
        angles.reduce((sum, value) => sum + value, 0) /
        angles.length;

      setReport({
        directions: result.calculatedDirections,
        samples: result.totalSamplesChecked,
        boundaryLimited:
          result.rasterBoundaryLimitedDirections,
        searchLimitReached:
          result.searchLimitReachedDirections,
        averageHorizon: average,
        minimumHorizon: Math.min(...angles),
        maximumHorizon: Math.max(...angles),
        highestDirection: highest.azimuthDeg,
        highestDistance: highest.distanceMeters,
        highestTerrainElevation:
          highest.terrainElevationMeters,
        observerElevation: result.observerElevationMeters,
        runtimeMs: performance.now() - start,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unknown validation error"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#111315] text-white p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <p className="text-xs tracking-[0.25em] text-white/50">
          NASA LOLA · TERRAIN VALIDATION
        </p>

        <h1 className="text-3xl font-semibold">
          Shackleton Rim Horizon Check
        </h1>

        <p className="text-sm text-white/60">
          Testing terrain horizon calculations against
          the actual Site04 NASA LOLA elevation raster.
        </p>

        <button
          onClick={runValidation}
          disabled={loading}
          className="rounded-lg bg-white text-black px-5 py-3 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Calculating..." : "Run terrain validation"}
        </button>

        {error && (
          <pre className="whitespace-pre-wrap rounded-lg bg-red-950/40 border border-red-500/30 p-4 text-sm text-red-300">
            {error}
          </pre>
        )}

        {report && (
          <section className="rounded-xl border border-white/10 bg-white/[0.04] p-6 space-y-5">
            <h2 className="text-lg font-medium">
              Calculation results
            </h2>

            <div className="grid grid-cols-2 gap-5">
              <Metric label="Directions" value={report.directions} />
              <Metric label="Terrain samples" value={report.samples} />
              <Metric label="Raster-boundary limited" value={report.boundaryLimited} />
              <Metric label="Search limit reached" value={report.searchLimitReached} />
              <Metric label="Average horizon" value={`${report.averageHorizon.toFixed(4)}°`} />
              <Metric label="Minimum horizon" value={`${report.minimumHorizon.toFixed(4)}°`} />
              <Metric label="Maximum horizon" value={`${report.maximumHorizon.toFixed(4)}°`} />
              <Metric label="Observer elevation" value={`${report.observerElevation.toFixed(3)} m`} />
              <Metric label="Highest direction" value={`${report.highestDirection.toFixed(1)}°`} />
              <Metric label="Peak terrain distance" value={`${report.highestDistance.toFixed(0)} m`} />
              <Metric label="Peak terrain elevation" value={`${report.highestTerrainElevation.toFixed(3)} m`} />
              <Metric label="Runtime" value={`${report.runtimeMs.toFixed(0)} ms`} />
            </div>

            <p className="text-xs text-amber-300 border-t border-white/10 pt-4">
              This is a sampled, raster-limited terrain horizon.
              It is not a verified complete lunar horizon.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div>
      <p className="text-xs text-white/45">{label}</p>
      <p className="mt-1 text-lg font-medium tabular-nums">
        {value}
      </p>
    </div>
  );
}
