"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";

import HorizonScope from "@/components/lunapath/HorizonScope";
import MissionTimeline from "@/components/lunapath/MissionTimeline";
import SiteComparison from "@/components/lunapath/SiteComparison";
import type {
  CelestialTarget,
  HorizonsResponse,
  Product78SiteStatus,
  Product78SitesResponse,
} from "@/components/lunapath/types";
import type { Product78SiteId } from "@/components/lib/lunar/siteRegistry";
import {
  geographicToLolaProjected,
  projectedToLolaPixel,
} from "@/components/lib/lunar/terrainData";
import type { LolaTerrainMetadata } from "@/components/lib/lunar/terrainData";

import styles from "./science.module.css";

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function subscribeToNoExternalChanges() {
  return () => {};
}

function getServerDateSnapshot() {
  return "";
}

const EMPTY_OBSERVATIONS: NonNullable<CelestialTarget["observations"]> = [];
const EMPTY_TARGET: CelestialTarget = {
  available: false,
  observations: EMPTY_OBSERVATIONS,
  visibilityWindows: [],
  limbVisibilityWindows: [],
};

function targetOrEmpty(value: CelestialTarget | undefined): CelestialTarget {
  return value ?? EMPTY_TARGET;
}

function isUsableSiteRecord(site: Product78SiteStatus): boolean {
  return (
    site.assetStatus === "ready" &&
    Number.isFinite(site.observer.latitudeDeg) &&
    Number.isFinite(site.observer.longitudeEastDeg) &&
    Number.isFinite(site.resolutionMeters) &&
    Array.isArray(site.dimensions) &&
    site.dimensions.length === 2
  );
}

/**
 * Verify the registered observer against the site's real Product78 metadata.
 * The API still performs its own full validation before using the raster.
 */
async function verifySiteProjection(
  site: Product78SiteStatus
): Promise<boolean> {
  try {
    const response = await fetch(`/data/${site.dataDirectory}/metadata.json`, {
      cache: "no-store",
    });
    if (!response.ok) return false;

    const metadata = (await response.json()) as LolaTerrainMetadata;
    const projection = metadata.coordinateSystem?.projection
      ?.toLowerCase()
      .replace(/[^a-z]/g, "");
    const referenceFrame = metadata.coordinateSystem?.referenceFrame;
    const pixelRegistration = metadata.coordinateSystem?.pixelRegistration
      ?.toLowerCase()
      .replace(/[^a-z]/g, "");
    const linearUnits = metadata.coordinateSystem?.linearUnits
      ?.toLowerCase()
      .replace(/[^a-z]/g, "");
    const byteOrder = metadata.byteOrder
      ?.toLowerCase()
      .replace(/[^a-z]/g, "");

    if (
      metadata.width !== site.dimensions?.[0] ||
      metadata.height !== site.dimensions?.[1] ||
      metadata.resolutionMeters !== site.resolutionMeters ||
      metadata.dataType?.toLowerCase() !== "float32" ||
      !["littleendian", "le"].includes(byteOrder ?? "") ||
      projection !== "southpolarstereographic" ||
      referenceFrame !== "MOON_ME" ||
      !["pixelarea", "pixelisarea"].includes(pixelRegistration ?? "") ||
      !["meters", "metres", "m"].includes(linearUnits ?? "")
    ) {
      return false;
    }

    const projected = geographicToLolaProjected(site.observer, metadata);
    const pixel = projectedToLolaPixel(projected, metadata);

    return (
      Number.isFinite(pixel.column) &&
      Number.isFinite(pixel.row) &&
      pixel.column >= -0.5 &&
      pixel.row >= -0.5 &&
      pixel.column < metadata.width - 0.5 &&
      pixel.row < metadata.height - 0.5
    );
  } catch {
    return false;
  }
}

export default function SciencePage() {
  // Keep the server and hydration snapshots identical; read the browser's
  // UTC date only after hydration.
  const browserUtcDate = useSyncExternalStore(
    subscribeToNoExternalChanges,
    utcToday,
    getServerDateSnapshot
  );

  const [dateOverride, setDateOverride] = useState<string | null>(null);
  const date = dateOverride ?? browserUtcDate;

  const [readySites, setReadySites] = useState<Product78SiteStatus[]>([]);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<Product78SiteId | "">("");

  const [data, setData] = useState<HorizonsResponse | null>(null);
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [azimuthBySite, setAzimuthBySite] = useState<
    Partial<Record<Product78SiteId, number>>
  >({});

  const requestSequence = useRef(0);

  const load = useCallback(async (
    requestedDate: string,
    requestedSiteId: Product78SiteId
  ) => {
    if (!requestedDate || !requestedSiteId) return;

    const requestId = ++requestSequence.current;
    setLoading(true);
    setRequestError(null);
    setData(null);
    setLoadedQueryKey(null);
    setSelectedIndex(0);

    try {
      const query = new URLSearchParams({
        date: requestedDate,
        siteId: requestedSiteId,
      });
      const response = await fetch(`/api/horizons?${query.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as HorizonsResponse;

      if (requestId !== requestSequence.current) return;

      if (!response.ok || payload.success !== true) {
        throw new Error(
          payload.error ?? `Horizons request failed (${response.status}).`
        );
      }

      setData(payload);
      setLoadedQueryKey(`${requestedDate}:${requestedSiteId}`);
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      setRequestError(
        error instanceof Error
          ? error.message
          : "Could not retrieve mission data."
      );
      setData(null);
      setLoadedQueryKey(null);
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
      }
    }
  }, []);

  // Load only sites the backend marks ready, then independently verify that
  // each observer falls inside its own raster using its real projection.
  useEffect(() => {
    let active = true;

    async function loadSiteCatalogue() {
      setSitesLoading(true);
      setSitesError(null);

      try {
        const response = await fetch("/api/product78/sites", {
          cache: "no-store",
        });
        const payload = (await response.json()) as Product78SitesResponse;

        if (
          !response.ok ||
          payload.success !== true ||
          !Array.isArray(payload.sites)
        ) {
          throw new Error("The Product78 site catalogue could not be loaded.");
        }

        const candidates = payload.sites.filter(isUsableSiteRecord);
        const verification = await Promise.all(
          candidates.map(async (site) => ({
            site,
            valid: await verifySiteProjection(site),
          }))
        );
        const usable = verification
          .filter((item) => item.valid)
          .map((item) => item.site);

        if (!active) return;

        setReadySites(usable);
        setSelectedSiteId((current) => {
          if (usable.some((site) => site.id === current)) return current;
          const defaultSite = usable.find(
            (site) => site.id === "site04_shackleton_rim"
          );
          return defaultSite?.id ?? usable[0]?.id ?? "";
        });
      } catch (error) {
        if (!active) return;
        setSitesError(
          error instanceof Error
            ? error.message
            : "Could not check local Product78 assets."
        );
        setReadySites([]);
        setSelectedSiteId("");
      } finally {
        if (active) setSitesLoading(false);
      }
    }

    void loadSiteCatalogue();

    return () => {
      active = false;
    };
  }, []);

  // A request sequence prevents slow responses for an old site/date from
  // replacing the currently selected site's data.
  useEffect(() => {
    let active = true;

    queueMicrotask(() => {
      if (!active || !date || !selectedSiteId) return;
      void load(date, selectedSiteId);
    });

    return () => {
      active = false;
      requestSequence.current += 1;
    };
  }, [date, selectedSiteId, load]);

  const selectedSite = readySites.find(
    (site) => site.id === selectedSiteId
  ) ?? null;

  const queryKey = selectedSiteId ? `${date}:${selectedSiteId}` : "";
  const missionData =
    loadedQueryKey === queryKey && data ? data : null;

  const sun = useMemo(
    () => targetOrEmpty(missionData?.targets?.sun),
    [missionData?.targets?.sun]
  );
  const earth = useMemo(
    () => targetOrEmpty(missionData?.targets?.earth),
    [missionData?.targets?.earth]
  );

  // A terrain payload must explicitly match the selected site. A mismatched
  // or missing profile remains unavailable; it is never treated as clear sky.
  const terrainModel =
    missionData?.terrainModel?.source === "product78" &&
    missionData.terrainModel.siteId === selectedSiteId
      ? missionData.terrainModel
      : null;
  const profile = terrainModel?.horizonProfile ?? [];

  const sunObservations = sun.observations ?? EMPTY_OBSERVATIONS;
  const earthObservations = earth.observations ?? EMPTY_OBSERVATIONS;
  const timelineObservations = sunObservations.length
    ? sunObservations
    : earthObservations;
  const safeSelectedIndex = Math.min(
    selectedIndex,
    Math.max(0, timelineObservations.length - 1)
  );
  const selectedObservation = timelineObservations[safeSelectedIndex];

  const selectedSun = useMemo(
    () => selectedObservation
      ? sunObservations.filter(
          (item) => item.timeUtc === selectedObservation.timeUtc
        )
      : [],
    [selectedObservation, sunObservations]
  );
  const selectedEarth = useMemo(
    () => selectedObservation
      ? earthObservations.filter(
          (item) => item.timeUtc === selectedObservation.timeUtc
        )
      : [],
    [selectedObservation, earthObservations]
  );

  const selectedAzimuth = selectedSiteId
    ? azimuthBySite[selectedSiteId] ?? 0
    : 0;

  const setSelectedAzimuth = useCallback((azimuthDeg: number) => {
    if (!selectedSiteId) return;
    setAzimuthBySite((current) => ({
      ...current,
      [selectedSiteId]: azimuthDeg,
    }));
  }, [selectedSiteId]);

  const statusLabel =
    missionData?.status === "complete"
      ? "DATA RETURNED"
      : missionData?.status === "partial"
        ? "PARTIAL DATA"
        : loading
          ? "LOADING MISSION DATA"
          : "WAITING FOR DATA";

  return (
    <main className={`${styles.page} sciencePage`}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label="LunaPath home">
          <span className={styles.brandMark} aria-hidden="true" />
          <span>LUNAPATH</span>
          <span className={styles.brandDivider}>/</span>
          <span className={styles.brandSection}>SCIENCE CONSOLE</span>
        </Link>
        <Link className={styles.mapLink} href="/map">
          OPEN 3D MISSION MAP ↗
        </Link>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.kicker}>LUNAR SOUTH POLE · SCIENTIFIC DATA</p>
          <h1>Know the horizon.</h1>
          <p className={styles.subtitle}>
            Inspect real JPL Horizons observations against the locally prepared
            NASA LOLA Product78 terrain for each verified landing site.
          </p>
        </div>

        <div className={styles.controls}>
          <label className={styles.field}>
            <span>LANDING SITE</span>
            <select
              value={selectedSiteId}
              onChange={(event) =>
                setSelectedSiteId(event.target.value as Product78SiteId | "")
              }
              disabled={sitesLoading || readySites.length === 0}
            >
              {sitesLoading && <option value="">Checking local terrain…</option>}
              {!sitesLoading && readySites.length === 0 && (
                <option value="">No prepared sites</option>
              )}
              {readySites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name} · {site.archiveSite}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>MISSION DATE · UTC</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDateOverride(event.target.value)}
            />
          </label>

          <button
            className={styles.reloadButton}
            type="button"
            onClick={() => {
              if (selectedSiteId) void load(date, selectedSiteId);
            }}
            disabled={!date || !selectedSiteId || loading}
          >
            {loading ? "LOADING…" : "RELOAD DATA ↗"}
          </button>
        </div>
      </section>

      <section className={styles.statusStrip}>
        <div className={styles.statusMain}>
          <span
            className={
              missionData?.status === "complete"
                ? styles.statusGood
                : styles.statusWarning
            }
          />
          <strong>{statusLabel}</strong>
        </div>
        <div>
          <span className={styles.statusLabel}>SELECTED OBSERVER</span>
          <strong>{selectedSite?.name ?? "NO VERIFIED SITE"}</strong>
        </div>
        <div>
          <span className={styles.statusLabel}>READY PRODUCT78 SITES</span>
          <strong>
            {sitesLoading ? "CHECKING…" : readySites.length}
          </strong>
        </div>
        <div>
          <span className={styles.statusLabel}>DATA SOURCES</span>
          <strong>NASA LOLA PRODUCT78 + JPL HORIZONS</strong>
        </div>
      </section>

      {sitesError && (
        <div className={styles.errorPanel}>
          <strong>Site catalogue unavailable</strong>
          <span>{sitesError}</span>
        </div>
      )}

      {requestError && (
        <div className={styles.errorPanel}>
          <strong>Mission data unavailable</strong>
          <span>{requestError}</span>
        </div>
      )}

      {!sitesLoading && readySites.length === 0 && !sitesError && (
        <div className={styles.emptyPanel}>
          No locally prepared Product78 datasets passed validation.
        </div>
      )}

      <section className={styles.dashboardGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.panelKicker}>01 / LOCAL TERRAIN</p>
              <h2>Horizon scope</h2>
            </div>
            <span className={styles.partialBadge}>PARTIAL COVERAGE</span>
          </div>

          {selectedSite ? (
            <HorizonScope
              profile={profile}
              sun={selectedSun}
              earth={selectedEarth}
              archiveSite={selectedSite.archiveSite}
              siteName={selectedSite.name}
              selectedAzimuth={selectedAzimuth}
              onSelectedAzimuthChange={setSelectedAzimuth}
            />
          ) : (
            <div className={styles.emptyPanel}>Waiting for a verified landing site.</div>
          )}
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.panelKicker}>02 / ACTUAL OBSERVATIONS</p>
              <h2>Mission timeline</h2>
            </div>
            <span className={styles.sampleBadge}>JPL · 10 MIN SAMPLES</span>
          </div>

          <MissionTimeline
            sun={sun}
            earth={earth}
            selectedIndex={safeSelectedIndex}
            onSelectedIndexChange={setSelectedIndex}
          />
        </article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.panelKicker}>03 / MULTI-SITE ANALYSIS</p>
            <h2>Compare landing sites</h2>
          </div>
          <span className={styles.sampleBadge}>2–3 VERIFIED SITES</span>
        </div>

        <SiteComparison
          key={`${date}:${readySites.map((site) => site.id).join(",")}`}
          sites={readySites}
          date={date}
        />
      </section>

      <footer className={styles.footer}>
        <p>
          Terrain beyond known Product78 coverage remains UNKNOWN. “Above
          sampled terrain” is not a guarantee of complete visibility.
        </p>
        <p>
          This science console is additive: the existing 3D map, Moon model,
          Earth/Sun scene, and starfield remain untouched.
        </p>
      </footer>
    </main>
  );
}
