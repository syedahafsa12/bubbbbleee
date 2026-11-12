"use client";

import { useMemo, useState } from "react";
import type { CelestialObservation, HorizonDirection } from "./types";
import { normalizeAzimuth } from "./types";

type Props = {
  profile: HorizonDirection[];
  sun?: CelestialObservation[];
  earth?: CelestialObservation[];
};

function polarPoint(azimuth: number, radius: number, cx: number, cy: number) {
  const angle = ((azimuth - 90) * Math.PI) / 180;
  return {
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius,
  };
}

function profilePath(profile: HorizonDirection[], cx: number, cy: number, radius: number) {
  const sorted = [...profile].sort((a, b) => normalizeAzimuth(a.azimuthDeg) - normalizeAzimuth(b.azimuthDeg));
  if (!sorted.length) return "";
  const points = sorted.map((item) => {
    const elevation = Math.max(-5, Math.min(65, item.horizonElevationDeg));
    const radial = radius * (0.42 + ((elevation + 5) / 70) * 0.58);
    return polarPoint(item.azimuthDeg, radial, cx, cy);
  });
  // Explicitly close the 0°/360° seam to avoid a visual gap at North.
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ") + " Z";
}

function latestTargetPoint(observations: CelestialObservation[] | undefined) {
  if (!observations?.length) return null;
  const observation = observations[0];
  const elevation = Math.max(-5, Math.min(65, observation.elevationDeg));
  return {
    ...observation,
    radial: 0.42 + ((elevation + 5) / 70) * 0.58,
  };
}

export default function HorizonScope({ profile, sun, earth }: Props) {
  const [selectedAzimuth, setSelectedAzimuth] = useState(0);
  const cx = 160;
  const cy = 150;
  const radius = 112;

  const path = useMemo(() => profilePath(profile, cx, cy, radius), [profile]);
  const selected = useMemo(() => {
    if (!profile.length) return null;
    return profile.reduce((best, item) => {
      const distance = Math.abs((((item.azimuthDeg - selectedAzimuth) + 540) % 360) - 180);
      const bestDistance = Math.abs((((best.azimuthDeg - selectedAzimuth) + 540) % 360) - 180);
      return distance < bestDistance ? item : best;
    }, profile[0]);
  }, [profile, selectedAzimuth]);

  const sunPoint = latestTargetPoint(sun);
  const earthPoint = latestTargetPoint(earth);
  const coverageComplete = false;

  return (
    <div className="scope-layout">
      <div className="scope-visual">
        <svg viewBox="0 0 320 300" role="img" aria-label="Polar terrain horizon profile, north at top and azimuth increasing clockwise">
          <circle cx={cx} cy={cy} r={radius} className="scope-ring" />
          <circle cx={cx} cy={cy} r={radius * 0.72} className="scope-ring scope-ring-dashed" />
          <circle cx={cx} cy={cy} r={radius * 0.42} className="scope-ring scope-ring-dashed" />
          <line x1={cx} y1={cy - radius} x2={cx} y2={cy + radius} className="scope-axis" />
          <line x1={cx - radius} y1={cy} x2={cx + radius} y2={cy} className="scope-axis" />
          <text x={cx} y="17" textAnchor="middle" className="scope-cardinal">N</text>
          <text x="300" y={cy + 4} textAnchor="middle" className="scope-cardinal">E</text>
          <text x={cx} y="291" textAnchor="middle" className="scope-cardinal">S</text>
          <text x="20" y={cy + 4} textAnchor="middle" className="scope-cardinal">W</text>
          {path && <path d={path} className="scope-terrain-path" />}
          {sunPoint && (() => {
            const p = polarPoint(sunPoint.azimuthDeg, radius * sunPoint.radial, cx, cy);
            return <circle cx={p.x} cy={p.y} r="5.5" className="scope-sun-point" />;
          })()}
          {earthPoint && (() => {
            const p = polarPoint(earthPoint.azimuthDeg, radius * earthPoint.radial, cx, cy);
            return <circle cx={p.x} cy={p.y} r="5.5" className="scope-earth-point" />;
          })()}
          <circle
            cx={polarPoint(selectedAzimuth, radius, cx, cy).x}
            cy={polarPoint(selectedAzimuth, radius, cx, cy).y}
            r="4"
            className="scope-cursor-point"
          />
          <text x={cx} y={cy + 4} textAnchor="middle" className="scope-center-label">SITE04</text>
          <text x={cx} y={cy + 19} textAnchor="middle" className="scope-center-sub">SHACKLETON RIM</text>
        </svg>
        <div className="scope-legend">
          <span><i className="legend-terrain" /> Terrain horizon</span>
          <span><i className="legend-sun" /> Sun</span>
          <span><i className="legend-earth" /> Earth</span>
        </div>
      </div>
      <div className="scope-details">
        <div className="scope-warning"><span className="status-dot status-dot-warning" /> SAMPLED HORIZON · NOT FULLY VERIFIED</div>
        <p className="muted small">Select an azimuth to inspect the nearest sampled terrain direction.</p>
        <input
          aria-label="Inspect horizon azimuth"
          className="azimuth-slider"
          type="range"
          min="0"
          max="359.75"
          step="0.25"
          value={selectedAzimuth}
          onChange={(event) => setSelectedAzimuth(Number(event.target.value))}
        />
        <div className="scope-azimuth-row">
          <span>AZIMUTH</span>
          <strong>{selectedAzimuth.toFixed(2)}°</strong>
        </div>
        {selected ? (
          <div className="scope-stats">
            <div><span>Horizon angle</span><strong>{selected.horizonElevationDeg.toFixed(2)}°</strong></div>
            <div><span>Distance sampled</span><strong>{(selected.distanceMeters / 1000).toFixed(2)} km</strong></div>
            <div><span>Terrain source</span><strong>{selected.horizonSource.toUpperCase()}</strong></div>
            <div><span>Source resolution</span><strong>{selected.horizonResolutionMeters} m</strong></div>
            <div><span>Samples checked</span><strong>{selected.samplesChecked.toLocaleString()}</strong></div>
            <div><span>Termination</span><strong>{selected.terminationReason.replaceAll("_", " ")}</strong></div>
          </div>
        ) : (
          <p className="muted small">No horizon profile was returned.</p>
        )}
        <p className="scope-footnote">The polar ring is a directional profile, not a camera view. A missing or limited terrain direction is never interpreted as open sky.</p>
      </div>
    </div>
  );
}
