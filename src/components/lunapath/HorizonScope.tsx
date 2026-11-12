"use client";

import { useMemo } from "react";
import type { CelestialObservation, TerrainDirection } from "./types";
import { normalizeAzimuth } from "./types";

type Props = {
  profile: TerrainDirection[];
  sun?: CelestialObservation[];
  earth?: CelestialObservation[];
  archiveSite: string;
  siteName: string;
  selectedAzimuth: number;
  onSelectedAzimuthChange: (azimuthDeg: number) => void;
};

function polarPoint(azimuth: number, radius: number, cx: number, cy: number) {
  const angle = ((azimuth - 90) * Math.PI) / 180;
  return {
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius,
  };
}

function hasKnownTerrain(direction: TerrainDirection): boolean {
  return (
    direction.coverageStatus === "partial" &&
    direction.source === "product78" &&
    typeof direction.maxTerrainElevationAngleDeg === "number" &&
    Number.isFinite(direction.maxTerrainElevationAngleDeg)
  );
}

/**
 * Build separate open polylines for consecutive known Product78 samples.
 * Unknown directions break the line; no path is closed or interpolated
 * across missing terrain.
 */
function profilePaths(
  profile: TerrainDirection[],
  cx: number,
  cy: number,
  radius: number
): string[] {
  const sorted = [...profile].sort(
    (a, b) => normalizeAzimuth(a.azimuthDeg) - normalizeAzimuth(b.azimuthDeg)
  );

  if (!sorted.length) return [];

  const expectedSpacing = 360 / sorted.length;
  const groups: TerrainDirection[][] = [];
  let current: TerrainDirection[] = [];

  for (const direction of sorted) {
    if (!hasKnownTerrain(direction)) {
      if (current.length) groups.push(current);
      current = [];
      continue;
    }

    const previous = current[current.length - 1];
    const gap = previous
      ? normalizeAzimuth(direction.azimuthDeg - previous.azimuthDeg)
      : expectedSpacing;

    if (previous && (gap <= 0 || gap > expectedSpacing * 1.5)) {
      groups.push(current);
      current = [];
    }

    current.push(direction);
  }

  if (current.length) groups.push(current);

  return groups
    .filter((group) => group.length >= 2)
    .map((group) =>
      group
        .map((item, index) => {
          const elevation = Math.max(
            -5,
            Math.min(65, item.maxTerrainElevationAngleDeg as number)
          );
          const radial = radius * (0.42 + ((elevation + 5) / 70) * 0.58);
          const point = polarPoint(item.azimuthDeg, radial, cx, cy);
          return `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
        })
        .join(" ")
    );
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

function formatDistance(distanceMeters: number | null): string {
  return typeof distanceMeters === "number" && Number.isFinite(distanceMeters)
    ? `${(distanceMeters / 1000).toFixed(2)} km`
    : "—";
}

function targetTerrainStatus(observation: CelestialObservation | null) {
  if (!observation) return "Not returned";
  if (!observation.terrainVisibility) return "Ephemeris only · terrain unknown";
  return observation.terrainVisibility.blockedBySampledTerrain
    ? "Blocked by known local terrain"
    : "Above sampled terrain · unconfirmed";
}

function targetClearance(observation: CelestialObservation | null) {
  return observation?.terrainVisibility
    ? `${observation.terrainVisibility.clearanceDeg.toFixed(2)}°`
    : "—";
}

export default function HorizonScope({
  profile,
  sun,
  earth,
  archiveSite,
  siteName,
  selectedAzimuth,
  onSelectedAzimuthChange,
}: Props) {
  const cx = 160;
  const cy = 150;
  const radius = 112;

  const paths = useMemo(
    () => profilePaths(profile, cx, cy, radius),
    [profile]
  );

  const selected = useMemo(() => {
    if (!profile.length) return null;
    return profile.reduce((best, item) => {
      const distance = Math.abs((((item.azimuthDeg - selectedAzimuth) + 540) % 360) - 180);
      const bestDistance = Math.abs((((best.azimuthDeg - selectedAzimuth) + 540) % 360) - 180);
      return distance < bestDistance ? item : best;
    }, profile[0]);
  }, [profile, selectedAzimuth]);

  const knownDirectionCount = profile.filter(hasKnownTerrain).length;
  const unknownDirectionCount = Math.max(0, profile.length - knownDirectionCount);
  const sunPoint = latestTargetPoint(sun);
  const earthPoint = latestTargetPoint(earth);

  const selectedIsKnown = selected ? hasKnownTerrain(selected) : false;

  return (
    <div className="scope-layout">
      <div className="scope-visual">
        <svg viewBox="0 0 320 300" role="img" aria-label="Partial polar terrain horizon profile. Known Product78 terrain is shown only where samples exist; all other directions are unknown. North is at top and azimuth increases clockwise.">
          <circle cx={cx} cy={cy} r={radius} className="scope-ring" />
          <circle cx={cx} cy={cy} r={radius * 0.72} className="scope-ring scope-ring-dashed" />
          <circle cx={cx} cy={cy} r={radius * 0.42} className="scope-ring scope-ring-dashed" />
          <line x1={cx} y1={cy - radius} x2={cx} y2={cy + radius} className="scope-axis" />
          <line x1={cx - radius} y1={cy} x2={cx + radius} y2={cy} className="scope-axis" />
          <text x={cx} y="17" textAnchor="middle" className="scope-cardinal">N</text>
          <text x="300" y={cy + 4} textAnchor="middle" className="scope-cardinal">E</text>
          <text x={cx} y="291" textAnchor="middle" className="scope-cardinal">S</text>
          <text x="20" y={cy + 4} textAnchor="middle" className="scope-cardinal">W</text>
          <circle
            cx={cx}
            cy={cy}
            r={radius * 0.94}
            fill="none"
            stroke="#83939a"
            strokeDasharray="3 5"
            strokeWidth="1.4"
            opacity="0.65"
          />
          {paths.map((path, index) => (
            <path
              key={`known-terrain-${index}`}
              d={path}
              className="scope-terrain-path"
              fill="none"
            />
          ))}
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
          <text x={cx} y={cy + 4} textAnchor="middle" className="scope-center-label">{archiveSite.toUpperCase()}</text>
          <text x={cx} y={cy + 19} textAnchor="middle" className="scope-center-sub">{siteName.toUpperCase()}</text>
          <text x={cx} y={cy + 37} textAnchor="middle" fontSize="7" letterSpacing="0.7" fill="#9aa8ae">UNKNOWN OUTSIDE COVERAGE</text>
        </svg>
        <div className="scope-legend">
          <span><i className="legend-terrain" /> Known Product78 terrain</span>
          <span><i className="legend-sun" /> Sun</span>
          <span><i className="legend-earth" /> Earth</span>
          <span><i className="scope-unknown-swatch" /> Unknown coverage</span>
        </div>
      </div>
      <div className="scope-details">
        <div className="scope-warning"><span className="status-dot status-dot-warning" /> PARTIAL LOCAL HORIZON · NOT VERIFIED</div>
        <p className="muted small">Select an azimuth to inspect the nearest Product78 sample direction.</p>
        <input
          aria-label="Inspect horizon azimuth"
          className="azimuth-slider"
          type="range"
          min="0"
          max="359.75"
          step="0.25"
          value={selectedAzimuth}
          onChange={(event) => onSelectedAzimuthChange(Number(event.target.value))}
        />
        <div className="scope-azimuth-row">
          <span>AZIMUTH</span>
          <strong>{selectedAzimuth.toFixed(2)}°</strong>
        </div>
        <div className="scope-target-readings">
          <div className="scope-target-reading">
            <span className="target-symbol sun-symbol">☼</span>
            <div>
              <strong>Sun</strong>
              <small>{sunPoint ? `${sunPoint.azimuthDeg.toFixed(2)}° AZ · ${sunPoint.elevationDeg.toFixed(2)}° EL` : "No selected observation"}</small>
              <small>{targetTerrainStatus(sunPoint)} · clearance {targetClearance(sunPoint)}</small>
            </div>
          </div>
          <div className="scope-target-reading">
            <span className="target-symbol earth-symbol">◉</span>
            <div>
              <strong>Earth</strong>
              <small>{earthPoint ? `${earthPoint.azimuthDeg.toFixed(2)}° AZ · ${earthPoint.elevationDeg.toFixed(2)}° EL` : "No selected observation"}</small>
              <small>{targetTerrainStatus(earthPoint)} · clearance {targetClearance(earthPoint)}</small>
            </div>
          </div>
        </div>
        <div className="scope-stats">
          <div><span>Known directions</span><strong>{knownDirectionCount.toLocaleString()}</strong></div>
          <div><span>Unknown directions</span><strong>{unknownDirectionCount.toLocaleString()}</strong></div>
        </div>
        {selected && selectedIsKnown ? (
          <div className="scope-stats">
            <div><span>Maximum sampled terrain angle</span><strong>{selected.maxTerrainElevationAngleDeg!.toFixed(2)}°</strong></div>
            <div><span>Last known sample</span><strong>{formatDistance(selected.lastKnownSampleDistanceM)}</strong></div>
            <div><span>Terrain source</span><strong>NASA LOLA PRODUCT78</strong></div>
            <div><span>Source resolution</span><strong>5 m</strong></div>
            <div><span>Samples checked</span><strong>{selected.sampleCount.toLocaleString()}</strong></div>
            <div><span>Sampling stopped</span><strong>{selected.terminationReason.replaceAll("_", " ")}</strong></div>
          </div>
        ) : (
          <div className="scope-stats scope-stats-unknown">
            <div><span>Selected direction</span><strong>UNKNOWN</strong></div>
            <p>No valid Product78 terrain samples are available for this direction. This does not mean the horizon is clear.</p>
            {selected && (
              <>
                <div><span>Samples checked</span><strong>{selected.sampleCount.toLocaleString()}</strong></div>
                <div><span>Sampling stopped</span><strong>{selected.terminationReason.replaceAll("_", " ")}</strong></div>
              </>
            )}
          </div>
        )}
        <p className="scope-footnote">Only known Product78 samples are drawn. Uncovered terrain beyond the raster boundary remains UNKNOWN; no continuous horizon is inferred across missing directions.</p>
      </div>
    </div>
  );
}
