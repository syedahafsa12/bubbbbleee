
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import LunarMap from "@/components/canvas/LunarMap";
import MoonTrekMap, {
  type MoonGeographicCoordinate,
} from "@/components/canvas/MoonTrekMap";

import type {
  GeographicCoordinate,
  RasterPixelCoordinate,
} from "@/components/lib/lunar/terrainData";

import type { Product78SiteId } from "@/components/lib/lunar/siteRegistry";

const LANDING_SITES = [
  {
    id: "site04_shackleton_rim",
    name: "Shackleton Rim",
    region: "Lunar South Pole",
    number: "04",
  },
  {
    id: "site11_de_gerlache_rim",
    name: "de Gerlache Rim",
    region: "Lunar South Pole",
    number: "11",
  },
  {
    id: "site23_malapert_massif",
    name: "Malapert Massif",
    region: "Lunar South Pole",
    number: "23",
  },
] as const satisfies readonly {
  id: Product78SiteId;
  name: string;
  region: string;
  number: string;
}[];

type LandingSiteId = Product78SiteId;

const MISSION_DURATIONS = [
  { label: "6 hours", value: "6" },
  { label: "12 hours", value: "12" },
  { label: "24 hours", value: "24" },
  { label: "48 hours", value: "48" },
  { label: "72 hours", value: "72" },
] as const;

export default function MapPage() {
  const [selectedSite, setSelectedSite] = useState<LandingSiteId>(
    LANDING_SITES[0].id,
  );

  const [missionDate, setMissionDate] = useState("");
  const [missionTime, setMissionTime] = useState("12:00");
  const [missionDuration, setMissionDuration] = useState("24");

  const [regionalCoordinate, setRegionalCoordinate] =
    useState<MoonGeographicCoordinate | null>(null);

  const [localLocation, setLocalLocation] = useState<{
    siteId: LandingSiteId;
    coordinate: GeographicCoordinate;
    pixel: RasterPixelCoordinate;
  } | null>(null);

  const activeSite = LANDING_SITES.find(
    (site) => site.id === selectedSite,
  )!;

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setMissionDate(new Date().toISOString().slice(0, 10));
    });

    return () => window.cancelAnimationFrame(frameId);
  }, []);

  const handleRegionalSelection = useCallback(
    (coordinate: MoonGeographicCoordinate) => {
      setRegionalCoordinate(coordinate);
    },
    [],
  );

  const handleLocalSelection = useCallback(
    (
      siteId: LandingSiteId,
      coordinate: GeographicCoordinate,
      pixel: RasterPixelCoordinate,
    ) => {
      setSelectedSite(siteId);
      setLocalLocation({
        siteId,
        coordinate,
        pixel,
      });
    },
    [],
  );

  const handleSiteChange = (siteId: LandingSiteId) => {
    setSelectedSite(siteId);
    setLocalLocation(null);
  };

  const formatLatitude = (value: number) =>
    `${Math.abs(value).toFixed(5)}° ${value < 0 ? "S" : "N"}`;

  const formatLongitude = (value: number) =>
    `${value.toFixed(5)}° E`;

  const explorerHref =
    localLocation && localLocation.siteId === selectedSite
      ? `/explorer?${new URLSearchParams({
          siteId: localLocation.siteId,
          lat: String(localLocation.coordinate.latitudeDeg),
          lon: String(localLocation.coordinate.longitudeEastDeg),
          col: String(localLocation.pixel.column),
          row: String(localLocation.pixel.row),
          date: missionDate,
          time: missionTime,
        }).toString()}`
      : null;

  return (
    <main className="min-h-screen bg-[#08090b] text-[#f4f2ed]">
      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#08090b]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[1600px] items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3">
            <div className="h-7 w-7 rounded-full border border-[#c8c5ba]/60 bg-gradient-to-br from-[#d8d6cd] to-[#454641]" />
            <span className="text-sm font-semibold tracking-[0.18em]">
              LUNA<span className="font-light text-white/45">PATH</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-8 text-xs text-white/45 md:flex">
            <a href="#mission" className="hover:text-white">
              Mission planner
            </a>
            <a href="#regional-map" className="hover:text-white">
              Moon Trek
            </a>
            <a href="#local-terrain" className="hover:text-white">
              Local terrain
            </a>
          </nav>

          <div className="flex items-center gap-2 text-[10px] tracking-wider text-white/40">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            NASA SPACE APPS
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-5 py-8 sm:px-8">
        <section className="mb-8">
          <p className="text-[10px] font-medium tracking-[0.28em] text-[#aaa99f]/65">
            LUNAR LANDING INTELLIGENCE / MISSION 01
          </p>

          <div className="mt-3 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <h1 className="text-3xl font-light tracking-tight sm:text-4xl">
                Mission planner
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-white/40">
                Configure a lunar landing scenario and explore candidate
                locations across the lunar South Pole.
              </p>
            </div>

            <div className="text-xs text-white/35">
              TARGET REGION · LUNAR SOUTH POLE
            </div>
          </div>
        </section>

        <section
          id="mission"
          className="mb-10 rounded-xl border border-white/10 bg-white/[0.025] p-5"
        >
          <div className="mb-5">
            <p className="text-[10px] tracking-[0.2em] text-white/35">
              MISSION CONFIGURATION
            </p>
            <h2 className="mt-1 text-base font-medium">
              Mission parameters
            </h2>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <label className="block">
              <span className="mb-2 block text-xs text-white/45">
                Landing site
              </span>

              <select
                value={selectedSite}
                onChange={(event) => {
                  const nextSite = LANDING_SITES.find(
                    (site) => site.id === event.target.value,
                  );

                  if (nextSite) {
                    handleSiteChange(nextSite.id);
                  }
                }}
                className="h-11 w-full rounded-lg border border-white/10 bg-[#111316] px-3 text-sm text-white outline-none focus:border-[#aaa99f]/60"
              >
                {LANDING_SITES.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>

              <span className="mt-2 block text-[10px] text-white/25">
                {activeSite.region}
              </span>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs text-white/45">
                Mission date (UTC)
              </span>
              <input
                type="date"
                value={missionDate}
                onChange={(event) => setMissionDate(event.target.value)}
                className="h-11 w-full rounded-lg border border-white/10 bg-[#111316] px-3 text-sm text-white outline-none [color-scheme:dark]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs text-white/45">
                Start time (UTC)
              </span>
              <input
                type="time"
                value={missionTime}
                onChange={(event) => setMissionTime(event.target.value)}
                className="h-11 w-full rounded-lg border border-white/10 bg-[#111316] px-3 text-sm text-white outline-none [color-scheme:dark]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs text-white/45">
                Mission duration
              </span>
              <select
                value={missionDuration}
                onChange={(event) => setMissionDuration(event.target.value)}
                className="h-11 w-full rounded-lg border border-white/10 bg-[#111316] px-3 text-sm text-white outline-none"
              >
                {MISSION_DURATIONS.map((duration) => (
                  <option key={duration.value} value={duration.value}>
                    {duration.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section id="regional-map" className="mb-12 space-y-4">
          <div>
            <p className="text-[10px] tracking-[0.2em] text-white/35">
              01 / REGIONAL NAVIGATION
            </p>
            <h2 className="mt-1 text-xl font-medium">
              Explore the lunar South Pole
            </h2>
            <p className="mt-1 text-sm text-white/40">
              NASA Moon Trek regional imagery. Select a location to inspect
              its lunar coordinates.
            </p>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#0d0f11] p-3 sm:p-5">
            <MoonTrekMap onLocationSelect={handleRegionalSelection} />
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.025] p-5">
            <p className="text-[10px] tracking-[0.18em] text-white/35">
              REGIONAL MAP SELECTION
            </p>

            {regionalCoordinate ? (
              <div className="mt-3 flex flex-wrap gap-8">
                <div>
                  <p className="text-[10px] text-white/35">LATITUDE</p>
                  <p className="mt-1 font-mono text-sm">
                    {formatLatitude(regionalCoordinate.latitudeDeg)}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] text-white/35">LONGITUDE</p>
                  <p className="mt-1 font-mono text-sm">
                    {formatLongitude(regionalCoordinate.longitudeEastDeg)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-white/40">
                No regional location selected.
              </p>
            )}
          </div>
        </section>

        <section id="local-terrain" className="space-y-5">
          <div>
            <p className="text-[10px] tracking-[0.2em] text-white/35">
              02 / HIGH-RESOLUTION TERRAIN
            </p>

            <h2 className="mt-1 text-xl font-medium">
              Compare lunar landing sites
            </h2>

            <p className="mt-1 max-w-2xl text-sm leading-6 text-white/40">
              Three separate NASA Product 78 LOLA elevation datasets.
              Select a terrain map to choose your landing site and then
              click inside it to select your exact landing coordinates.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {LANDING_SITES.map((site) => {
              const isActive = selectedSite === site.id;

              return (
                <article
                  key={site.id}
                  className={`min-w-0 rounded-xl border p-3 transition-colors sm:p-4 ${
                    isActive
                      ? "border-[#d6c18e]/60 bg-[#d6c18e]/[0.055]"
                      : "border-white/10 bg-[#0d0f11]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSiteChange(site.id)}
                    className="mb-3 flex w-full items-center justify-between gap-2 text-left"
                  >
                    <span>
                      <span className="block text-[9px] tracking-[0.2em] text-white/35">
                        PRODUCT 78 · SITE {site.number}
                      </span>
                      <span className="mt-1 block text-sm font-medium text-white">
                        {site.name}
                      </span>
                    </span>

                    <span
                      className={`rounded-md border px-2 py-1 text-[9px] tracking-wider ${
                        isActive
                          ? "border-[#d6c18e]/50 bg-[#d6c18e]/10 text-[#e4d3a9]"
                          : "border-white/10 text-white/40"
                      }`}
                    >
                      {isActive ? "ACTIVE SITE" : "SELECT SITE"}
                    </span>
                  </button>

                  <LunarMap
                    siteId={site.id}
                    compact
                    onLocationSelect={(coordinate, pixel) =>
                      handleLocalSelection(site.id, coordinate, pixel)
                    }
                  />
                </article>
              );
            })}
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.025] p-5">
            <p className="text-[10px] tracking-[0.18em] text-white/35">
              PRODUCT 78 LOCAL SELECTION
            </p>

            {localLocation && localLocation.siteId === selectedSite ? (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-[#d6c18e]/30 bg-[#d6c18e]/[0.07] px-3 py-1.5 text-xs text-[#e4d3a9]">
                    {activeSite.name}
                  </span>
                  <span className="text-[10px] text-emerald-400">
                    LANDING LOCATION SELECTED
                  </span>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-[10px] text-white/35">LATITUDE</p>
                    <p className="mt-1 font-mono text-sm">
                      {formatLatitude(localLocation.coordinate.latitudeDeg)}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] text-white/35">LONGITUDE</p>
                    <p className="mt-1 font-mono text-sm">
                      {formatLongitude(localLocation.coordinate.longitudeEastDeg)}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] text-white/35">RASTER PIXEL</p>
                    <p className="mt-1 font-mono text-sm">
                      {localLocation.pixel.column.toFixed(2)},{" "}
                      {localLocation.pixel.row.toFixed(2)}
                    </p>
                  </div>
                </div>

                <div className="mt-6 border-t border-white/[0.08] pt-5">
                  <p className="mb-4 text-xs leading-5 text-white/40">
                    Your observation location is selected from the actual
                    Product 78 elevation dataset for {activeSite.name}.
                    Open the 360° explorer to inspect the surrounding lunar
                    surface from this position.
                  </p>

                  {explorerHref && (
                    <Link
                      href={explorerHref}
                      className="inline-flex items-center gap-4 border border-white/20 bg-white/[0.04] px-5 py-4 text-[10px] tracking-[0.18em] text-white/80 transition hover:border-white/50 hover:bg-white/[0.08]"
                    >
                      OPEN 360° SURFACE EXPLORER
                      <span aria-hidden="true">↗</span>
                    </Link>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-white/40">
                Select a point inside one of the three Product 78 terrain
                maps to choose your landing site and enable the 360° surface
                explorer.
              </p>
            )}
          </div>
        </section>

        <section className="mt-8 flex flex-wrap justify-between gap-3 border-t border-white/[0.07] pt-5 text-[10px] text-white/30">
          <span>SITE: {selectedSite}</span>
          <span>
            MISSION START: {missionDate || "NOT SET"} {missionTime} UTC
          </span>
          <span>DURATION: {missionDuration} HOURS</span>
        </section>
      </div>
    </main>
  );
}
