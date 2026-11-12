"use client";

import { useEffect, useRef, useState } from "react";
import type { CelestialTarget, HorizonsResponse, Product78SiteStatus } from "./types";
import {
  formatDuration,
  formatUtcTime,
  getWindowLabel,
} from "./types";
import type { Product78SiteId } from "@/components/lib/lunar/siteRegistry";

type ComparisonResult = {
  site: Product78SiteStatus;
  status: string;
  sunObservationCount: number;
  earthObservationCount: number;
  knownDirectionCount: number | null;
  unknownDirectionCount: number | null;
  horizonDirectionCount: number;
  resolutionMeters: number | null;
  observerElevationMeters: number | null;
  sunWindows: NonNullable<NonNullable< HorizonsResponse["targets"]>["sun"]["visibilityWindows"]>;
  earthWindows: NonNullable<NonNullable< HorizonsResponse["targets"]>["earth"]["visibilityWindows"]>;
  error: string | null;
};

type Props = {
  sites: Product78SiteStatus[];
  date: string;
};

function observationCount(target: CelestialTarget | undefined): number {
  return Array.isArray(target?.observations)
    ? target.observations.length
    : 0;
}

function buildComparisonResult(
  site: Product78SiteStatus,
  payload: HorizonsResponse
): ComparisonResult {
  const sun = payload.targets?.sun;
  const earth = payload.targets?.earth;
  const terrain =
    payload.terrainModel?.source === "product78" &&
    payload.terrainModel.siteId === site.id
      ? payload.terrainModel
      : null;
  const profile = terrain?.horizonProfile ?? [];
  const knownDirectionCount = terrain
    ? profile.filter((direction) =>
        direction.coverageStatus === "partial" &&
        direction.source === "product78" &&
        typeof direction.maxTerrainElevationAngleDeg === "number" &&
        Number.isFinite(direction.maxTerrainElevationAngleDeg)
      ).length
    : null;

  return {
    site,
    status: payload.status ?? "partial",
    sunObservationCount: observationCount(sun),
    earthObservationCount: observationCount(earth),
    knownDirectionCount,
    unknownDirectionCount: terrain
      ? Math.max(0, profile.length - (knownDirectionCount ?? 0))
      : null,
    horizonDirectionCount: profile.length,
    resolutionMeters: terrain?.resolutionMeters ?? site.resolutionMeters ?? null,
    observerElevationMeters: payload.observer?.elevationMeters ?? null,
    sunWindows: sun?.visibilityWindows ?? [],
    earthWindows: earth?.visibilityWindows ?? [],
    error: null,
  };
}

function VisibilityWindowList({
  label,
  windows,
}: {
  label: string;
  windows: ComparisonResult["sunWindows"];
}) {
  return (
    <div className="comparison-window-group">
      <span className="eyebrow">{label}</span>
      {windows.length ? (
        <ul>
          {windows.slice(0, 4).map((window, index) => (
            <li key={`${label}-${window.startTimeUtc}-${index}`}>
              <span>{formatUtcTime(window.startTimeUtc)}–{formatUtcTime(window.endTimeUtc)}</span>
              <span>{getWindowLabel(window.state)} · {formatDuration(window.durationMinutes)}</span>
            </li>
          ))}
          {windows.length > 4 && (
            <li className="comparison-window-more">+{windows.length - 4} more sampled windows</li>
          )}
        </ul>
      ) : (
        <p>No visibility windows returned.</p>
      )}
    </div>
  );
}

export default function SiteComparison({ sites, date }: Props) {
  // The parent keys this component by date and verified-site list, so the
  // initial selection is derived directly from the currently available sites.
  const [selectedIds, setSelectedIds] = useState<Product78SiteId[]>(
    () => sites.slice(0, Math.min(2, sites.length)).map((site) => site.id)
  );
  const [results, setResults] = useState<ComparisonResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    return () => {
      requestSequence.current += 1;
    };
  }, []);

  function toggleSite(siteId: Product78SiteId) {
    requestSequence.current += 1;
    setLoading(false);
    setSelectedIds((current) => {
      if (current.includes(siteId)) {
        return current.filter((id) => id !== siteId);
      }
      if (current.length >= 3) return current;
      return [...current, siteId];
    });
    setResults([]);
    setError(null);
  }

  async function compareSelectedSites() {
    if (!date || selectedIds.length < 2) return;

    const requestId = ++requestSequence.current;
    const selectedSites = selectedIds
      .map((id) => sites.find((site) => site.id === id))
      .filter((site): site is Product78SiteStatus => Boolean(site));

    if (selectedSites.length < 2) return;

    setLoading(true);
    setError(null);
    setResults([]);

    const settled = await Promise.all(
      selectedSites.map(async (site): Promise<ComparisonResult> => {
        try {
          const query = new URLSearchParams({
            date,
            siteId: site.id,
          });
          const response = await fetch(`/api/horizons?${query.toString()}`, {
            cache: "no-store",
          });
          const payload = (await response.json()) as HorizonsResponse;

          if (!response.ok || payload.success !== true) {
            throw new Error(payload.error ?? `HTTP ${response.status}`);
          }

          return buildComparisonResult(site, payload);
        } catch (requestError) {
          return {
            site,
            status: "unavailable",
            sunObservationCount: 0,
            earthObservationCount: 0,
            knownDirectionCount: null,
            unknownDirectionCount: null,
            horizonDirectionCount: 0,
            resolutionMeters: site.resolutionMeters ?? null,
            observerElevationMeters: null,
            sunWindows: [],
            earthWindows: [],
            error: requestError instanceof Error
              ? requestError.message
              : "Could not retrieve comparison data.",
          };
        }
      })
    );

    if (requestId === requestSequence.current) {
      setResults(settled);
      setLoading(false);
    }
  }

  const selectedCount = selectedIds.length;
  const canCompare = selectedCount >= 2 && selectedCount <= 3 && Boolean(date);

  return (
    <section className="site-comparison">
      <div className="site-comparison-controls">
        <div>
          <div className="eyebrow">COMPARE VERIFIED DATASETS</div>
          <p>Select two or three locally prepared Product78 sites. Each comparison is fetched from the same date-specific JPL and terrain API.</p>
        </div>
        <button
          type="button"
          className="site-comparison-run"
          onClick={() => void compareSelectedSites()}
          disabled={!canCompare || loading}
        >
          {loading ? "COMPARING…" : "COMPARE SELECTED SITES"}
        </button>
      </div>

      {sites.length >= 2 ? (
        <div className="site-comparison-picker">
          {sites.map((site) => {
            const checked = selectedIds.includes(site.id);
            return (
              <label
                key={site.id}
                className={checked ? "site-comparison-option is-selected" : "site-comparison-option"}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSite(site.id)}
                  disabled={!checked && selectedCount >= 3}
                />
                <span>
                  <strong>{site.name}</strong>
                  <small>{site.archiveSite} · {site.resolutionMeters} m · READY</small>
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="comparison-placeholder">
          <strong>{sites.length === 1 ? "One verified site is currently available." : "No local Product78 datasets are ready."}</strong>
          <p>Prepare and validate at least one more site&apos;s metadata and elevation binary to enable a real 2–3 site comparison. Unprepared registry entries are not included.</p>
        </div>
      )}

      {error && <p className="comparison-error">{error}</p>}

      {results.length > 0 && (
        <div className="site-comparison-results">
          {results.map((result) => (
            <article className="site-comparison-card" key={result.site.id}>
              <div className="site-comparison-card-heading">
                <div>
                  <span className="eyebrow">{result.site.archiveSite} · PRODUCT78</span>
                  <h3>{result.site.name}</h3>
                </div>
                <span className={result.error ? "comparison-status is-error" : "comparison-status"}>
                  {result.error ? "UNAVAILABLE" : result.status.toUpperCase()}
                </span>
              </div>

              {result.error ? (
                <p className="comparison-error">{result.error}</p>
              ) : (
                <>
                  <div className="comparison-metrics">
                    <div><span>Sun samples</span><strong>{result.sunObservationCount}</strong></div>
                    <div><span>Earth samples</span><strong>{result.earthObservationCount}</strong></div>
                    <div><span>Known / unknown directions</span><strong>{result.knownDirectionCount ?? "—"} / {result.unknownDirectionCount ?? "—"}</strong></div>
                    <div><span>Source resolution</span><strong>{result.resolutionMeters ?? "—"} m</strong></div>
                    <div><span>Observer elevation</span><strong>{result.observerElevationMeters === null ? "—" : `${result.observerElevationMeters.toFixed(1)} m`}</strong></div>
                  </div>
                  <div className="comparison-window-columns">
                    <VisibilityWindowList label="SUN WINDOWS" windows={result.sunWindows} />
                    <VisibilityWindowList label="EARTH WINDOWS" windows={result.earthWindows} />
                  </div>
                  {!result.horizonDirectionCount && (
                    <p className="comparison-note">No terrain horizon profile was returned for this site/date. Missing terrain is not interpreted as open sky.</p>
                  )}
                </>
              )}
            </article>
          ))}
        </div>
      )}

      <p className="comparison-footnote">
        Comparison values come directly from each selected site&apos;s API response. Visibility windows use sampled observation times, not exact interpolated crossing times. A partial horizon is not a complete visibility guarantee.
      </p>
    </section>
  );
}
