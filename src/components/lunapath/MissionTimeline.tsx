"use client";

import { useEffect, useState } from "react";
import type { CelestialObservation, CelestialTarget, VisibilityWindow } from "./types";
import { formatDuration, formatUtcTime, getWindowLabel, parseUtcTimestamp } from "./types";

type Props = {
  sun: CelestialTarget;
  earth: CelestialTarget;
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
};

function statusFor(observation: CelestialObservation | undefined) {
  if (!observation) return { label: "No observation", className: "state-unknown" };
  if (!observation.terrainVisibility) return { label: "Ephemeris only · terrain unavailable", className: "state-unknown" };
  if (observation.terrainVisibility.blockedBySampledTerrain) {
    return { label: "Blocked by sampled terrain", className: "state-blocked" };
  }
  return { label: "Above sampled terrain · unconfirmed", className: "state-unconfirmed" };
}

function WindowList({ title, windows }: { title: string; windows?: VisibilityWindow[] }) {
  if (!windows?.length) {
    return <div className="window-empty"><span>{title}</span><p>No visibility windows returned.</p></div>;
  }

  return (
    <div className="window-group">
      <div className="window-group-title">{title}</div>
      {windows.map((window, index) => (
        <div className="window-row" key={`${title}-${window.startTimeUtc}-${index}`}>
          <div>
            <strong>{formatUtcTime(window.startTimeUtc)}–{formatUtcTime(window.endTimeUtc)}</strong>
            <span>{getWindowLabel(window.state)}</span>
          </div>
          <b>{formatDuration(window.durationMinutes)}</b>
        </div>
      ))}
    </div>
  );
}

export default function MissionTimeline({ sun, earth, selectedIndex, onSelectedIndexChange }: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const sunObservations = sun.observations ?? [];
  const earthObservations = earth.observations ?? [];
  const observations = sunObservations.length ? sunObservations : earthObservations;
  const maxIndex = Math.max(0, observations.length - 1);
  const safeIndex = Math.min(selectedIndex, maxIndex);
  const selected = observations[safeIndex];
  const sunAtTime = selected
    ? sunObservations.find((item) => item.timeUtc === selected.timeUtc)
    : undefined;
  const earthAtTime = selected
    ? earthObservations.find((item) => item.timeUtc === selected.timeUtc)
    : undefined;
  const expectedIntervalMs = 10 * 60 * 1000;
  const hasGaps = observations.some((item, index) => {
    if (index === 0) return false;
    const currentTime = parseUtcTimestamp(item.timeUtc)?.getTime();
    const previousTime = parseUtcTimestamp(observations[index - 1].timeUtc)?.getTime();

    // An unparseable timestamp is a data-quality gap, not continuous time.
    if (currentTime === undefined || previousTime === undefined) return true;
    return currentTime - previousTime > expectedIntervalMs + 1000;
  });

  // Each playback step advances by one actual JPL observation. It does not
  // synthesize intermediate timestamps or celestial positions.
  useEffect(() => {
    if (!isPlaying || observations.length < 2) return;

    const timeoutId = window.setTimeout(() => {
      if (safeIndex >= maxIndex) {
        setIsPlaying(false);
        return;
      }

      onSelectedIndexChange(safeIndex + 1);
    }, 800);

    return () => window.clearTimeout(timeoutId);
  }, [isPlaying, observations.length, safeIndex, maxIndex, onSelectedIndexChange]);

  function togglePlayback() {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }

    if (observations.length < 2) return;
    if (safeIndex >= maxIndex) onSelectedIndexChange(0);
    setIsPlaying(true);
  }

  function resetTimeline() {
    setIsPlaying(false);
    onSelectedIndexChange(0);
  }

  function handleSliderChange(nextIndex: number) {
    setIsPlaying(false);
    onSelectedIndexChange(nextIndex);
  }

  return (
    <div className="timeline-content">
      <div className="timeline-scrubber-head">
        <div>
          <span className="eyebrow">MISSION CLOCK · UTC</span>
          <strong className="timeline-time">{selected ? formatUtcTime(selected.timeUtc, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "No observations"}</strong>
          <span className="muted small">{selected?.timeUtc ?? "Waiting for observation data"}</span>
        </div>
        <div className="timeline-count">
          <strong>{observations.length}</strong>
          <span>observations</span>
        </div>
      </div>

      {observations.length > 0 ? (
        <>
          <input
            className="timeline-slider"
            aria-label="Select mission observation time"
            type="range"
            min="0"
            max={maxIndex}
            step="1"
            value={safeIndex}
            onChange={(event) => handleSliderChange(Number(event.target.value))}
          />
          <div className="timeline-range-labels">
            <span>{formatUtcTime(observations[0].timeUtc)}</span>
            <span>{formatUtcTime(observations[maxIndex].timeUtc)}</span>
          </div>
          <div className="timeline-transport" aria-label="Timeline playback controls">
            <button
              type="button"
              className="timeline-transport-primary"
              onClick={togglePlayback}
              disabled={observations.length < 2}
              aria-label={isPlaying ? "Pause timeline" : "Play timeline"}
            >
              <span aria-hidden="true">{isPlaying ? "Ⅱ" : "▶"}</span>
              {isPlaying ? "PAUSE" : "PLAY"}
            </button>
            <button
              type="button"
              className="timeline-transport-secondary"
              onClick={resetTimeline}
              disabled={observations.length === 0 || (safeIndex === 0 && !isPlaying)}
              aria-label="Reset timeline to first observation"
            >
              <span aria-hidden="true">↺</span>
              RESET
            </button>
            <span className="timeline-playback-note">
              {isPlaying ? "Advancing through actual JPL samples" : "10-minute observation steps"}
            </span>
          </div>
        </>
      ) : (
        <div className="empty-inline">No timeline data is available for this target.</div>
      )}

      {hasGaps && (
        <div className="timeline-gap-warning">
          <span className="status-dot status-dot-warning" />
          Data gaps detected. Gaps are not drawn as continuous visibility.
        </div>
      )}

      <div className="timeline-target-grid">
        <div className="timeline-target-card">
          <div className="target-card-heading"><span className="target-symbol sun-symbol">☼</span><strong>Sun</strong></div>
          <div className="target-reading"><span>Azimuth</span><b>{sunAtTime ? `${sunAtTime.azimuthDeg.toFixed(2)}°` : "—"}</b></div>
          <div className="target-reading"><span>Elevation</span><b>{sunAtTime ? `${sunAtTime.elevationDeg.toFixed(2)}°` : "—"}</b></div>
          <div className="target-reading"><span>Terrain clearance</span><b>{sunAtTime?.terrainVisibility ? `${sunAtTime.terrainVisibility.clearanceDeg.toFixed(2)}°` : "—"}</b></div>
          <div className={`target-state ${statusFor(sunAtTime).className}`}>{statusFor(sunAtTime).label}</div>
        </div>
        <div className="timeline-target-card">
          <div className="target-card-heading"><span className="target-symbol earth-symbol">◉</span><strong>Earth</strong></div>
          <div className="target-reading"><span>Azimuth</span><b>{earthAtTime ? `${earthAtTime.azimuthDeg.toFixed(2)}°` : "—"}</b></div>
          <div className="target-reading"><span>Elevation</span><b>{earthAtTime ? `${earthAtTime.elevationDeg.toFixed(2)}°` : "—"}</b></div>
          <div className="target-reading"><span>Terrain clearance</span><b>{earthAtTime?.terrainVisibility ? `${earthAtTime.terrainVisibility.clearanceDeg.toFixed(2)}°` : "—"}</b></div>
          <div className={`target-state ${statusFor(earthAtTime).className}`}>{statusFor(earthAtTime).label}</div>
        </div>
      </div>

      <div className="window-lists">
        <WindowList title="SUN · CENTRE VISIBILITY" windows={sun.visibilityWindows} />
        <WindowList title="EARTH · CENTRE VISIBILITY" windows={earth.visibilityWindows} />
      </div>
      <p className="timeline-disclaimer">
        Visibility windows are grouped from 10-minute samples. Their endpoints are observation times, not exact astronomical rise/set crossings.
        “Above sampled terrain” is not a guarantee of complete visibility.
      </p>
    </div>
  );
}
