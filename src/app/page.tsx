"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Site04Terrain from "@/components/lunapath/Site04Terrain";
import HorizonScope from "@/components/lunapath/HorizonScope";
import MissionTimeline from "@/components/lunapath/MissionTimeline";
import GlobalMoonOverview from "@/components/lunapath/GlobalMoonOverview";
import type {
  HorizonsResponse,
  CelestialTarget,
  Product78SiteStatus,
  Product78SitesResponse,
} from "@/components/lunapath/types";
import type { Product78SiteId } from "@/components/lib/lunar/siteRegistry";

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function targetOrEmpty(value: CelestialTarget | undefined): CelestialTarget {
  return value ?? {
    available: false,
    observations: [],
    visibilityWindows: [],
    limbVisibilityWindows: [],
  };
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="stat-card">
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
      {detail && <span className="stat-detail">{detail}</span>}
    </div>
  );
}

function isUsableSite(site: Product78SiteStatus): boolean {
  return (
    site.assetStatus === "ready" &&
    Number.isFinite(site.observer?.latitudeDeg) &&
    Number.isFinite(site.observer?.longitudeEastDeg) &&
    Number.isFinite(site.resolutionMeters) &&
    Array.isArray(site.dimensions) &&
    site.dimensions.length === 2
  );
}

export default function Home() {
  // Keep the first server/client render deterministic. The browser date is set after mount.
  const [date, setDate] = useState("");
  const [data, setData] = useState<HorizonsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedAzimuth, setSelectedAzimuth] = useState(0);

  const [readySites, setReadySites] = useState<Product78SiteStatus[]>([]);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<Product78SiteId | "">("");
  const [refreshVersion, setRefreshVersion] = useState(0);

  const requestSequence = useRef(0);

  const load = useCallback(async (
    requestedDate: string,
    requestedSiteId: Product78SiteId
  ) => {
    if (!requestedDate || !requestedSiteId) return;

    const requestId = ++requestSequence.current;
    setLoading(true);
    setRequestError(null);
    // Never leave an old site's observations beside a new site's error.
    setData(null);
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

      // Ignore an older response if the user has already selected another site/date.
      if (requestId !== requestSequence.current) return;

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? `Horizons request failed (${response.status}).`);
      }

      setData(payload);
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      setRequestError(
        error instanceof Error
          ? error.message
          : "Could not retrieve mission data."
      );
      setData(null);
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
      }
    }
  }, []);

  // Read the backend's local-asset catalogue. Only assetStatus=ready sites
  // with valid observer coordinates are exposed as selectable.
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

        if (!response.ok || payload.success !== true || !Array.isArray(payload.sites)) {
          throw new Error("The Product78 site catalogue could not be loaded.");
        }

        const usable = payload.sites.filter(isUsableSite);
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

  // Date is intentionally derived only in the browser after hydration.
  useEffect(() => {
    setDate(utcToday());
  }, []);

  // Selecting a different prepared site or date loads that site's real API data.
  useEffect(() => {
    if (!date || !selectedSiteId) return;
    void load(date, selectedSiteId);
  }, [load, date, selectedSiteId, refreshVersion]);

  useEffect(() => {
    setSelectedAzimuth(0);
  }, [selectedSiteId]);

  const selectedSite = readySites.find(
    (site) => site.id === selectedSiteId
  ) ?? null;

  const isDataForSelectedSite =
    Boolean(selectedSite) &&
    data?.observer?.name === selectedSite?.name;
  const missionData = isDataForSelectedSite ? data : null;
  const observer = missionData?.observer;

  const sun = targetOrEmpty(missionData?.targets?.sun);
  const earth = targetOrEmpty(missionData?.targets?.earth);
  // A terrain result must match the currently selected site. Old or mismatched
  // payloads are not silently displayed under another site's label.
  const terrainModel =
    missionData?.terrainModel?.source === "product78" &&
    missionData.terrainModel.siteId === selectedSiteId
      ? missionData.terrainModel
      : null;
  const profile = terrainModel?.horizonProfile ?? [];

  const sunObservations = sun.observations ?? [];
  const earthObservations = earth.observations ?? [];
  const timelineObservations = sunObservations.length
    ? sunObservations
    : earthObservations;
  const selectedObservation = timelineObservations[
    Math.min(selectedIndex, Math.max(0, timelineObservations.length - 1))
  ];

  const selectedSun = useMemo(
    () => selectedObservation
      ? sunObservations.filter((item) => item.timeUtc === selectedObservation.timeUtc)
      : [],
    [selectedObservation, sunObservations]
  );
  const selectedEarth = useMemo(
    () => selectedObservation
      ? earthObservations.filter((item) => item.timeUtc === selectedObservation.timeUtc)
      : [],
    [selectedObservation, earthObservations]
  );

  const statusLabel =
    missionData?.status === "complete"
      ? "DATA RETURNED"
      : missionData?.status === "partial"
        ? "PARTIAL DATA"
        : loading
          ? "LOADING MISSION DATA"
          : "WAITING FOR DATA";

  const comparisonReady = readySites.length >= 2;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="LunaPath home">
          <span className="brand-mark"><span /></span>
          <span>LUNAPATH</span>
        </a>
        <div className="topbar-center">
          <span className="live-indicator" /> NASA SPACE APPS · CHALLENGE 10
        </div>
        <div className="topbar-right">
          <span className="topbar-label">MISSION CONSOLE</span>
          <span className="topbar-version">PRODUCT78 · BUILD 0.2</span>
        </div>
      </header>

      <section className="page-heading">
        <div>
          <div className="eyebrow page-kicker">LUNAR SOUTH POLE · LANDING SITE ANALYSIS</div>
          <h1>Find the light.<br /><em>Know the horizon.</em></h1>
          <p className="page-subtitle">
            Explore verified Product78 landing-site terrain and inspect the Sun and Earth against the known local horizon.
          </p>
        </div>

        <div className="mission-controls">
          <label htmlFor="mission-site">LANDING SITE <span>PRODUCT78</span></label>
          <select
            id="mission-site"
            className="mission-site-select"
            value={selectedSiteId}
            onChange={(event) => setSelectedSiteId(event.target.value as Product78SiteId | "")}
            disabled={sitesLoading || readySites.length === 0}
          >
            {sitesLoading && <option value="">Checking local terrain assets…</option>}
            {!sitesLoading && readySites.length === 0 && (
              <option value="">No prepared Product78 sites</option>
            )}
            {readySites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name} · {site.archiveSite}
              </option>
            ))}
          </select>

          <label htmlFor="mission-date">MISSION DATE <span>UTC</span></label>
          <div className="date-control">
            <input
              id="mission-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            <button
              type="button"
              onClick={() => setRefreshVersion((version) => version + 1)}
              disabled={loading || !date || !selectedSiteId}
            >
              {loading
                ? <><span className="button-spinner" /> LOADING</>
                : "LOAD DAY ↗"}
            </button>
          </div>
          <div className="control-note">
            24-hour window · 10-minute observations · {sitesLoading
              ? "Checking terrain readiness…"
              : `${readySites.length} locally ready ${readySites.length === 1 ? "site" : "sites"}`}
          </div>
        </div>
      </section>

      <section className="status-strip">
        <div className="status-main">
          <span className={`status-dot ${data?.status === "complete" ? "status-dot-good" : "status-dot-warning"}`} />
          {statusLabel}
        </div>
        <div className="status-item">
          <span>OBSERVER</span>
          <strong>{selectedSite ? `${selectedSite.name.toUpperCase()} · ${selectedSite.archiveSite}` : "NO VERIFIED SITE"}</strong>
        </div>
        <div className="status-item">
          <span>COORDINATES</span>
          <strong>
            {selectedSite
              ? `${Math.abs(selectedSite.observer.latitudeDeg).toFixed(4)}° ${selectedSite.observer.latitudeDeg < 0 ? "S" : "N"} / ${selectedSite.observer.longitudeEastDeg.toFixed(2)}°E`
              : "—"}
          </strong>
        </div>
        <div className="status-item">
          <span>DATA SOURCES</span>
          <strong>NASA LOLA PRODUCT78 + JPL HORIZONS</strong>
        </div>
      </section>

      {sitesError && (
        <div className="request-error">
          <strong>Site availability unavailable</strong>
          <span>{sitesError}</span>
          <button type="button" onClick={() => window.location.reload()}>RETRY</button>
        </div>
      )}

      {!sitesLoading && readySites.length === 0 && !sitesError && (
        <div className="request-error">
          <strong>No local Product78 terrain is prepared</strong>
          <span>Prepare and validate at least one site's metadata and elevation binary before selecting it.</span>
        </div>
      )}

      {requestError && (
        <div className="request-error">
          <strong>Mission data unavailable</strong>
          <span>{requestError}</span>
          <button type="button" onClick={() => setRefreshVersion((version) => version + 1)}>
            RETRY
          </button>
        </div>
      )}

      {missionData?.status === "partial" && (
        <div className="partial-banner">
          <span className="status-dot status-dot-warning" />
          <div>
            <strong>Partial mission data</strong>
            <span>
              Some target or terrain samples are unavailable. Unknown terrain is not treated as open sky.
            </span>
          </div>
          <span className="partial-tag">PARTIAL</span>
        </div>
      )}

      <section className="stats-grid">
        <Stat
          label="SUN OBSERVATIONS"
          value={sunObservations.length ? sunObservations.length.toString() : "—"}
          detail={sunObservations.length ? "10-minute JPL samples" : "Not returned"}
        />
        <Stat
          label="EARTH OBSERVATIONS"
          value={earthObservations.length ? earthObservations.length.toString() : "—"}
          detail={earthObservations.length ? "10-minute JPL samples" : "Not returned"}
        />
        <Stat
          label="HORIZON DIRECTIONS"
          value={profile.length ? profile.length.toLocaleString() : "—"}
          detail={profile.length ? `${(360 / profile.length).toFixed(2)}° azimuth spacing` : "Terrain unavailable"}
        />
        <Stat
          label="HORIZON STATUS"
          value={terrainModel ? "PARTIAL / UNKNOWN" : "UNAVAILABLE"}
          detail="Complete 360° horizon is not verified"
        />
      </section>

      <GlobalMoonOverview sites={readySites} selectedSite={selectedSite} />

      <div className="dashboard-grid">
        <section className="panel terrain-panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">01 / LOCAL TOPOGRAPHY</div>
              <h2>{selectedSite?.name ?? "Product78 terrain"} <span>· 3D terrain</span></h2>
            </div>
            <span className="panel-badge">PRODUCT 78</span>
          </div>
          {selectedSite ? (
            <Site04Terrain
              key={selectedSite.id}
              siteId={selectedSite.id}
              sun={selectedSun[0]}
              earth={selectedEarth[0]}
              selectedAzimuthDeg={selectedAzimuth}
            />
          ) : (
            <div className="empty-panel">
              <span className="empty-icon">◌</span>
              <strong>Terrain viewer waiting for a verified site</strong>
              <p>Only locally prepared Product78 datasets can be opened.</p>
            </div>
          )}
        </section>

        <section className="panel scope-panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">02 / 360° OBSTRUCTION PROFILE</div>
              <h2>Horizon Scope</h2>
            </div>
            <span className="panel-badge panel-badge-warning">INCOMPLETE</span>
          </div>
          {profile.length && selectedSite ? (
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
            <div className="empty-panel">
              <span className="empty-icon">◌</span>
              <strong>Partial terrain horizon not available</strong>
              <p>JPL observations can remain available while local terrain coverage is unavailable.</p>
            </div>
          )}
        </section>

        <section className="panel timeline-panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">03 / 24-HOUR OBSERVATION WINDOW</div>
              <h2>Mission timeline <span>· UTC</span></h2>
            </div>
            <span className="panel-badge">10 MIN STEP</span>
          </div>
          <MissionTimeline
            sun={sun}
            earth={earth}
            selectedIndex={selectedIndex}
            onSelectedIndexChange={setSelectedIndex}
          />
        </section>

        <section className="panel provenance-panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">04 / DATA TRACEABILITY</div>
              <h2>Scientific provenance</h2>
            </div>
            <span className="panel-badge">SOURCE NOTES</span>
          </div>
          <div className="provenance-grid">
            <div className="provenance-item">
              <span>LOCAL TERRAIN</span>
              <strong>NASA LOLA · Product 78</strong>
              <small>{selectedSite ? `${selectedSite.archiveSite} · ${selectedSite.resolutionMeters} m source pixels` : "No prepared site selected"}</small>
            </div>
            <div className="provenance-item">
              <span>EPHEMERIS</span>
              <strong>NASA / JPL Horizons</strong>
              <small>Airless apparent coordinates</small>
            </div>
            <div className="provenance-item">
              <span>REFERENCE FRAME</span>
              <strong>{terrainModel?.referenceFrame ?? "MOON_ME (terrain metadata)"}</strong>
              <small>Ephemeris reference: {terrainModel?.ephemeris ?? "DE421"}</small>
            </div>
            <div className="provenance-item">
              <span>OBSERVER ELEVATION</span>
              <strong>
                {observer?.elevationMeters !== null && observer?.elevationMeters !== undefined
                  ? `${observer.elevationMeters.toFixed(2)} m`
                  : "Unavailable"}
              </strong>
              <small>{observer?.elevationSource ?? "Awaiting terrain metadata"}</small>
            </div>
            <div className="provenance-item">
              <span>TERRAIN SAMPLING</span>
              <strong>{terrainModel ? `${terrainModel.resolutionMeters} m source raster` : selectedSite ? `${selectedSite.resolutionMeters} m source raster` : "Unavailable"}</strong>
              <small>Only directions with valid Product78 samples are drawn</small>
            </div>
          </div>
          <div className="coverage-summary">
            <div className="coverage-summary-head">
              <strong>Directional horizon sampling</strong>
              <span>{profile.length ? `${profile.length} azimuth directions` : "No profile"}</span>
            </div>
            <p>
              Known terrain is shown only where valid Product78 samples exist. All uncovered directions remain UNKNOWN; missing terrain is never treated as open sky. The complete 360° horizon is not verified.
            </p>
          </div>
          <details className="source-notes">
            <summary>Backend interpretation notes</summary>
            <ul>
              {(missionData?.notes ?? ["Load a mission date to retrieve backend calculation notes."]).map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          </details>
        </section>

        <section className="panel site-comparison-panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">05 / RESULTS</div>
              <h2>Site comparison</h2>
            </div>
            <span className="panel-badge">{comparisonReady ? "READY FOR 2+ SITES" : "WAITING FOR DATASETS"}</span>
          </div>
          {comparisonReady ? (
            <div className="comparison-placeholder">
              <strong>{readySites.length} locally prepared sites are available.</strong>
              <p>Multi-site ephemeris and terrain comparison can be run against these verified datasets. The current mission result above belongs only to {selectedSite?.name ?? "the selected site"}.</p>
            </div>
          ) : (
            <div className="comparison-placeholder">
              <strong>One verified site is currently available.</strong>
              <p>Prepare and validate at least one more local Product78 raster to enable a real 2–3 site comparison. No placeholder metrics are shown.</p>
            </div>
          )}
        </section>
      </div>

      <footer className="footer">
        <div>
          <span className="brand-mark brand-mark-small"><span /></span>
          <strong>LUNAPATH</strong>
          <span>NASA SPACE APPS CHALLENGE 2026</span>
        </div>
        <p>Decision support visualization · Not a landing safety certification</p>
      </footer>
    </main>
  );
}
