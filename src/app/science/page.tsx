"use client";

import { useEffect, useMemo, useState } from "react";
import type { Product78SiteId } from "@/components/lib/lunar/siteRegistry";

type SiteRecord = {
  id: Product78SiteId;
  name: string;
  archiveSite: string;
  assetStatus: string;
  resolutionMeters?: number;
  observer: { latitudeDeg: number; longitudeEastDeg: number };
};

type SiteCatalogue = { success: boolean; sites?: SiteRecord[]; error?: string };

type VisibilityWindow = {
  state: string;
  startTimeUtc: string;
  endTimeUtc: string;
  durationMinutes: number;
  observationCount: number;
};

type Target = {
  observations?: Array<{
    timeUtc: string;
    azimuthDeg: number;
    elevationDeg: number;
    terrainVisibility?: {
      clearanceDeg: number;
      assessment: string;
      terrainCoverageComplete: false;
    } | null;
  }>;
  visibilityWindows?: VisibilityWindow[];
};

type MissionPayload = {
  success: boolean;
  status?: "complete" | "partial";
  site?: { id: string; name: string; archiveSite: string };
  observer?: { elevationMeters: number | null };
  targets?: { sun?: Target; earth?: Target };
  terrainModel?: {
    resolutionMeters: number;
    completeHorizonVerified: false;
    horizonProfile: Array<{
      coverageStatus: "partial" | "no_data";
      maxTerrainElevationAngleDeg: number | null;
      lastKnownSampleDistanceM: number | null;
      source: "product78" | null;
    }>;
    product90?: { status: string; error: string | null };
  } | null;
  error?: string;
};

type Comparison = {
  site: SiteRecord;
  payload?: MissionPayload;
  error?: string;
};

function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "—";
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function formatUtc(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(11, 16) + " UTC";
}

function WindowGroup({ title, windows }: { title: string; windows?: VisibilityWindow[] }) {
  return (
    <div className="rounded-lg border border-white/10 p-3">
      <h4 className="text-[10px] font-semibold tracking-[0.15em] text-white/55">{title}</h4>
      {windows?.length ? (
        <ul className="mt-2 space-y-2">
          {windows.slice(0, 5).map((window, index) => (
            <li key={`${window.startTimeUtc}-${index}`} className="flex justify-between gap-2 text-[10px]">
              <span className="text-white/65">{formatUtc(window.startTimeUtc)} – {formatUtc(window.endTimeUtc)}</span>
              <span className="text-white/40">{formatDuration(window.durationMinutes)}</span>
            </li>
          ))}
          {windows.length > 5 && <li className="text-[9px] text-white/35">+{windows.length - 5} more sampled intervals</li>}
        </ul>
      ) : (
        <p className="mt-2 text-[10px] text-white/35">No sampled windows returned.</p>
      )}
    </div>
  );
}

export default function SciencePage() {
  const [date, setDate] = useState("");
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<Product78SiteId[]>([]);
  const [results, setResults] = useState<Comparison[]>([]);
  const [loadingSites, setLoadingSites] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/product78/sites", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as SiteCatalogue;
        if (!response.ok || payload.success !== true || !Array.isArray(payload.sites)) {
          throw new Error(payload.error ?? "Product78 site catalogue unavailable.");
        }
        return payload.sites.filter((site) => site.assetStatus === "ready");
      })
      .then((ready) => {
        if (!active) return;
        setSites(ready);
        setSelectedIds(ready.slice(0, 3).map((site) => site.id));
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load site catalogue.");
      })
      .finally(() => {
        if (active) {
          setDate((current) => current || new Date().toISOString().slice(0, 10));
          setLoadingSites(false);
        }
      });
    return () => { active = false; };
  }, []);

  const selectedSites = useMemo(
    () => selectedIds.map((id) => sites.find((site) => site.id === id)).filter((site): site is SiteRecord => Boolean(site)),
    [selectedIds, sites]
  );

  function toggleSite(id: Product78SiteId) {
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 3) return current;
      return [...current, id];
    });
    setResults([]);
  }

  async function compare() {
    if (!date || selectedSites.length < 2) return;
    setLoading(true);
    setError(null);
    setResults([]);
    const settled = await Promise.all(selectedSites.map(async (site): Promise<Comparison> => {
      try {
        const query = new URLSearchParams({ date, siteId: site.id });
        const response = await fetch(`/api/horizons?${query.toString()}`, { cache: "no-store" });
        const payload = (await response.json()) as MissionPayload;
        if (!response.ok || payload.success !== true) {
          throw new Error(payload.error ?? `HTTP ${response.status}`);
        }
        if (payload.site?.id !== site.id) throw new Error("Returned site does not match the requested dataset.");
        return { site, payload };
      } catch (caught) {
        return { site, error: caught instanceof Error ? caught.message : "Comparison request failed." };
      }
    }));
    setResults(settled);
    setLoading(false);
  }

  return (
    <main className="min-h-screen bg-[#08090b] px-5 py-8 text-[#f4f2ed] sm:px-8">
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] tracking-[0.24em] text-white/35">LUNAPATH / SCIENCE</p>
            <h1 className="mt-2 text-3xl font-light">Landing-site comparison</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/45">
              Compare only locally prepared Product78 sites using their registered reference observers and the same UTC date.
            </p>
          </div>
          <a href="/map" className="border border-white/15 px-4 py-3 text-[10px] tracking-[0.15em] text-white/70 hover:border-white/40">BACK TO PLANNER</a>
        </header>

        <section className="mb-7 rounded-xl border border-white/10 bg-white/[0.025] p-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
            <label className="block">
              <span className="mb-2 block text-[10px] tracking-wider text-white/40">MISSION DATE · UTC</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-11 w-full rounded-lg border border-white/10 bg-[#111316] px-3 text-sm text-white [color-scheme:dark]" />
            </label>
            <div>
              <p className="mb-2 text-[10px] tracking-wider text-white/40">READY PRODUCT78 DATASETS · SELECT 2–3</p>
              {loadingSites ? <p className="text-xs text-white/45">Checking prepared site assets…</p> : (
                <div className="flex flex-wrap gap-2">
                  {sites.map((site) => (
                    <label key={site.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${selectedIds.includes(site.id) ? "border-[#d6c18e]/50 bg-[#d6c18e]/10 text-[#e9d9b6]" : "border-white/10 text-white/50"}`}>
                      <input type="checkbox" checked={selectedIds.includes(site.id)} disabled={!selectedIds.includes(site.id) && selectedIds.length >= 3} onChange={() => toggleSite(site.id)} />
                      {site.archiveSite} · {site.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <button type="button" disabled={loading || selectedSites.length < 2 || !date} onClick={() => void compare()} className="h-11 rounded-lg bg-[#e8e5dc] px-5 text-[10px] font-semibold tracking-wider text-black disabled:opacity-40">{loading ? "COMPARING…" : "COMPARE SITES"}</button>
          </div>
          {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
          {!loadingSites && sites.length < 2 && <p className="mt-3 text-xs text-amber-100/70">At least two local Product78 datasets must be prepared before a measured comparison is possible.</p>}
        </section>

        {loading && <p className="py-12 text-center text-sm text-white/45">Retrieving JPL observations and sampled terrain profiles for each selected site…</p>}

        <section className="grid gap-4 xl:grid-cols-3">
          {results.map(({ site, payload, error: siteError }) => {
            const terrain = payload?.terrainModel;
            const profile = terrain?.horizonProfile ?? [];
            const known = profile.filter((direction) => direction.coverageStatus === "partial" && typeof direction.maxTerrainElevationAngleDeg === "number").length;
            const unknown = profile.length - known;
            return (
              <article key={site.id} className="min-w-0 rounded-xl border border-white/10 bg-[#0d0f11] p-5">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-[9px] tracking-[0.16em] text-white/35">{site.archiveSite} · NASA LOLA PRODUCT78</p><h2 className="mt-1 text-lg font-medium">{site.name}</h2></div>
                  <span className={`rounded-md border px-2 py-1 text-[9px] ${siteError ? "border-red-300/20 text-red-200" : "border-amber-200/20 text-amber-100"}`}>{siteError ? "UNAVAILABLE" : "PARTIAL MODEL"}</span>
                </div>
                {siteError ? <p className="mt-4 text-xs text-red-200/75">{siteError}</p> : (
                  <>
                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <div className="rounded-lg border border-white/10 p-3"><p className="text-[9px] text-white/40">Sun samples</p><strong className="text-xl">{payload?.targets?.sun?.observations?.length ?? 0}</strong></div>
                      <div className="rounded-lg border border-white/10 p-3"><p className="text-[9px] text-white/40">Earth samples</p><strong className="text-xl">{payload?.targets?.earth?.observations?.length ?? 0}</strong></div>
                      <div className="rounded-lg border border-white/10 p-3"><p className="text-[9px] text-white/40">Known directions</p><strong className="text-xl">{known}</strong></div>
                      <div className="rounded-lg border border-white/10 p-3"><p className="text-[9px] text-white/40">Unknown directions</p><strong className="text-xl">{unknown}</strong></div>
                      <div className="rounded-lg border border-white/10 p-3"><p className="text-[9px] text-white/40">Observer elevation</p><strong className="text-sm">{payload?.observer?.elevationMeters?.toFixed(1) ?? "—"} m</strong></div>
                      <div className="rounded-lg border border-white/10 p-3"><p className="text-[9px] text-white/40">Raster spacing</p><strong className="text-sm">{terrain?.resolutionMeters ?? site.resolutionMeters ?? "—"} m</strong></div>
                    </div>
                    <div className="mt-4 grid gap-3">
                      <WindowGroup title="SUN · SAMPLED TERRAIN WINDOWS" windows={payload?.targets?.sun?.visibilityWindows} />
                      <WindowGroup title="EARTH · GEOMETRIC LINE OF SIGHT" windows={payload?.targets?.earth?.visibilityWindows} />
                    </div>
                    <div className="mt-4 rounded-lg border border-amber-200/15 bg-amber-200/[0.035] p-3 text-[10px] leading-5 text-amber-100/65">
                      Reference observer: registered site centre. Complete horizon is not verified. Earth windows are geometric screening only, not a radio-frequency link budget. No overall safety score is calculated.
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </section>
        <p className="mt-8 text-[10px] leading-5 text-white/30">
          All metrics are measured from each site&apos;s own prepared Product78 raster and JPL Horizons response. A missing horizon direction remains unknown. Windows are based on 10-minute observations, not exact crossing times.
        </p>
      </div>
    </main>
  );
}
