"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Site04Terrain from "@/components/lunapath/Site04Terrain";
import HorizonScope from "@/components/lunapath/HorizonScope";
import MissionTimeline from "@/components/lunapath/MissionTimeline";
import type { HorizonsResponse, CelestialTarget } from "@/components/lunapath/types";

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function targetOrEmpty(value: CelestialTarget | undefined): CelestialTarget {
  return value ?? { available: false, observations: [], visibilityWindows: [], limbVisibilityWindows: [] };
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="stat-card">
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
      {detail && <span className="stat-detail">{detail}</span>}
    </div>
  );
}

export default function Home() {
  // Keep the first server/client render deterministic. The browser date is set after mount.\n  const [date, setDate] = useState("");
  const [data, setData] = useState<HorizonsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const requestSequence = useRef(0);

  const load = useCallback(async (requestedDate: string) => {
    if (!requestedDate) return;

    const requestId = ++requestSequence.current;
    setLoading(true);
    setRequestError(null);
    // Do not leave observations from a previous date beside a new request error.
    setData(null);
    setSelectedIndex(0);

    try {
      const response = await fetch(`/api/horizons?date=${encodeURIComponent(requestedDate)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as HorizonsResponse;

      // Ignore an older response if the user has already requested another date.
      if (requestId !== requestSequence.current) return;

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? `Horizons request failed (${response.status}).`);
      }

      setData(payload);
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      setRequestError(error instanceof Error ? error.message : "Could not retrieve mission data.");
      setData(null);
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
      }
    }
  }, []);

  // Date is intentionally derived only in the browser after hydration.
  useEffect(() => {
    setDate(utcToday());
  }, []);

  useEffect(() => {
    if (!date) return;
    void load(date);
  }, [load, date]);

  const sun = targetOrEmpty(data?.targets?.sun);
  const earth = targetOrEmpty(data?.targets?.earth);
  const profile = data?.terrainModel?.horizonProfile ?? [];
  const sunObservations = sun.observations ?? [];
  const earthObservations = earth.observations ?? [];
  const timelineObservations = sunObservations.length ? sunObservations : earthObservations;
  const selectedObservation = timelineObservations[Math.min(selectedIndex, Math.max(0, timelineObservations.length - 1))];

  const selectedSun = useMemo(
    () => selectedObservation ? sunObservations.filter((item) => item.timeUtc === selectedObservation.timeUtc) : [],
    [selectedObservation, sunObservations]
  );
  const selectedEarth = useMemo(
    () => selectedObservation ? earthObservations.filter((item) => item.timeUtc === selectedObservation.timeUtc) : [],
    [selectedObservation, earthObservations]
  );

  const statusLabel = data?.status === "complete" ? "DATA RETURNED" : data?.status === "partial" ? "PARTIAL DATA" : "WAITING FOR DATA";
  const observer = data?.observer;
  const terrainModel = data?.terrainModel;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="LunaPath home">
          <span className="brand-mark"><span /></span>
          <span>LUNAPATH</span>
        </a>
        <div className="topbar-center"><span className="live-indicator" /> NASA SPACE APPS · CHALLENGE 10</div>
        <div className="topbar-right"><span className="topbar-label">MISSION CONSOLE</span><span className="topbar-version">SITE04 / BUILD 0.1</span></div>
      </header>

      <section className="page-heading">
        <div>
          <div className="eyebrow page-kicker">LUNAR SOUTH POLE · LANDING SITE ANALYSIS</div>
          <h1>Find the light.<br /><em>Know the horizon.</em></h1>
          <p className="page-subtitle">Explore Shackleton Rim terrain and inspect when the Sun and Earth rise above the sampled local horizon.</p>
        </div>
        <div className="mission-controls">
          <label htmlFor="mission-date">MISSION DATE <span>UTC</span></label>
          <div className="date-control">
            <input id="mission-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            <button type="button" onClick={() => void load(date)} disabled={loading || !date}>
              {loading ? <><span className="button-spinner" /> LOADING</> : "LOAD DAY ↗"}
            </button>
          </div>
          <div className="control-note">24-hour window · 10-minute observations</div>
        </div>
      </section>

      <section className="status-strip">
        <div className="status-main"><span className={`status-dot ${data?.status === "complete" ? "status-dot-good" : "status-dot-warning"}`} />{statusLabel}</div>
        <div className="status-item"><span>OBSERVER</span><strong>SHACKLETON RIM · SITE04</strong></div>
        <div className="status-item"><span>COORDINATES</span><strong>{observer ? `${observer.latitude.toFixed(4)}° / ${observer.longitudeEast.toFixed(2)}°E` : "—"}</strong></div>
        <div className="status-item"><span>DATA SOURCES</span><strong>NASA LOLA + JPL HORIZONS</strong></div>
      </section>

      {requestError && (
        <div className="request-error"><strong>Mission data unavailable</strong><span>{requestError}</span><button onClick={() => void load(date)}>RETRY</button></div>
      )}

      {data?.status === "partial" && (
        <div className="partial-banner">
          <span className="status-dot status-dot-warning" />
          <div><strong>Partial mission data</strong><span>Some target or terrain data is unavailable. The panels below show only the observations actually returned.</span></div>
          <span className="partial-tag">PARTIAL</span>
        </div>
      )}

      <section className="stats-grid">
        <Stat label="SUN OBSERVATIONS" value={sunObservations.length ? sunObservations.length.toString() : "—"} detail={sunObservations.length ? "10-minute samples" : "Not returned"} />
        <Stat label="EARTH OBSERVATIONS" value={earthObservations.length ? earthObservations.length.toString() : "—"} detail={earthObservations.length ? "10-minute samples" : "Not returned"} />
        <Stat label="HORIZON DIRECTIONS" value={profile.length ? profile.length.toLocaleString() : "—"} detail={terrainModel ? `${terrainModel.directionSpacingDegrees.toFixed(2)}° spacing` : "Terrain unavailable"} />
        <Stat label="HORIZON STATUS" value={terrainModel?.completeHorizonVerified ? "VERIFIED" : "INCOMPLETE"} detail="Sampled terrain only" />
      </section>

      <div className="dashboard-grid">
        <section className="panel terrain-panel">
          <div className="panel-header">
            <div><div className="eyebrow">01 / LOCAL TOPOGRAPHY</div><h2>Shackleton Rim <span>· 3D terrain</span></h2></div>
            <span className="panel-badge">PRODUCT 78</span>
          </div>
          <Site04Terrain />
        </section>

        <section className="panel scope-panel">
          <div className="panel-header">
            <div><div className="eyebrow">02 / 360° OBSTRUCTION PROFILE</div><h2>Horizon Scope</h2></div>
            <span className="panel-badge panel-badge-warning">INCOMPLETE</span>
          </div>
          {profile.length ? (
            <HorizonScope profile={profile} sun={selectedSun} earth={selectedEarth} />
          ) : (
            <div className="empty-panel"><span className="empty-icon">◌</span><strong>Terrain horizon not available</strong><p>Ephemeris observations may still be available without terrain obstruction assessment.</p></div>
          )}
        </section>

        <section className="panel timeline-panel">
          <div className="panel-header">
            <div><div className="eyebrow">03 / 24-HOUR OBSERVATION WINDOW</div><h2>Mission timeline <span>· UTC</span></h2></div>
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
            <div><div className="eyebrow">04 / DATA TRACEABILITY</div><h2>Scientific provenance</h2></div>
            <span className="panel-badge">SOURCE NOTES</span>
          </div>
          <div className="provenance-grid">
            <div className="provenance-item"><span>LOCAL TERRAIN</span><strong>NASA LOLA · Product 78</strong><small>Site04 · 5 m source pixels</small></div>
            <div className="provenance-item"><span>REGIONAL TERRAIN</span><strong>NASA LOLA · Product 90</strong><small>20 m sampling interval</small></div>
            <div className="provenance-item"><span>EPHEMERIS</span><strong>NASA / JPL Horizons</strong><small>Airless apparent coordinates</small></div>
            <div className="provenance-item"><span>REFERENCE FRAME</span><strong>{terrainModel?.referenceFrame ?? "MOON_ME (terrain metadata)"}</strong><small>Ephemeris reference: {terrainModel?.ephemeris ?? "DE421"}</small></div>
            <div className="provenance-item"><span>OBSERVER ELEVATION</span><strong>{observer?.elevationMeters !== null && observer?.elevationMeters !== undefined ? `${observer.elevationMeters.toFixed(2)} m` : "Unavailable"}</strong><small>{observer?.elevationSource ?? "Awaiting terrain metadata"}</small></div>
            <div className="provenance-item"><span>TERRAIN SAMPLING</span><strong>{terrainModel ? `${terrainModel.sampleStepMeters} m local / ${terrainModel.regionalSampleStepMeters} m regional` : "Unavailable"}</strong><small>Maximum search distance: 15 km</small></div>
          </div>
          <div className="coverage-summary">
            <div className="coverage-summary-head"><strong>Directional horizon sampling</strong><span>{terrainModel ? `${terrainModel.directionCount} directions returned` : "No profile"}</span></div>
            <p>All returned directions are sampled calculations only. Full lunar horizon coverage is not verified, and raster boundaries or NoData may limit individual directions.</p>
          </div>
          <details className="source-notes">
            <summary>Backend interpretation notes</summary>
            <ul>{(data?.notes ?? ["Load a mission date to retrieve backend calculation notes."]).map((note, index) => <li key={index}>{note}</li>)}</ul>
          </details>
        </section>
      </div>

      <footer className="footer">
        <div><span className="brand-mark brand-mark-small"><span /></span><strong>LUNAPATH</strong><span>NASA SPACE APPS CHALLENGE 2026</span></div>
        <p>Decision support visualization · Not a landing safety certification</p>
      </footer>
    </main>
  );
}
