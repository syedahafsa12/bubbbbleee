"use client";

import {
  Suspense,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import {
  DEFAULT_PRODUCT78_SITE_ID,
  getProduct78Site,
  type Product78SiteId,
} from "@/components/lib/lunar/siteRegistry";

import JointVisibilityPlanner from "./JointVisibilityPlanner";

/* =========================================================
   CONFIGURATION
========================================================= */

const LIVE_REFRESH_INTERVAL_MS = 60_000;

/* =========================================================
   API TYPES
========================================================= */

type TerrainVisibilityStatus =
  | "target_disk_below_sampled_terrain"
  | "target_disk_intersects_sampled_terrain"
  | "target_disk_above_sampled_terrain_unconfirmed"
  | "target_disk_size_unavailable"
  | "terrain_horizon_unavailable";

interface TerrainVisibility {
  azimuthDeg: number;
  targetElevationDeg: number;
  terrainHorizonElevationDeg: number | null;
  clearanceDeg: number | null;
  angularDiameterArcsec: number | null;
  status: TerrainVisibilityStatus;
  targetDiskVisible: boolean | null;
  terrainCoverageComplete: boolean;
}

interface HorizonsObservation {
  time: string;
  azimuthDeg: number;
  elevationDeg: number;
  angularDiameterArcsec: number | null;
  terrainVisibility: TerrainVisibility;
}

interface MissionApiResponse {
  success: boolean;

  site?: {
    id: string;
    archiveSite: string;
    displayName: string;
    dataDirectory: string;
  };

  mission?: {
    date: string;
    time: string;
    startTime: string;
    stopTime: string;
  };

  observer?: {
    latitudeDeg: number;
    longitudeEastDeg: number;
    altitudeKm: number;
    elevationMeters: number;

    pixel: {
      column: number;
      row: number;
    };

    nearestPixel: {
      column: number;
      row: number;
    };
  };

  targets?: {
    sun?: HorizonsObservation;
    earth?: HorizonsObservation;
  };

  terrainModel?: {
    product: string;
    siteId: string;
    siteName: string;
    resolutionMeters: number;
    referenceFrame: string;
    ephemeris: string;
    sampleStepMeters: number;
    maxDistanceMeters: number;
    calculatedDirections: number;
    totalSamplesChecked: number;
    product78SamplesChecked: number;
    rasterBoundaryLimitedDirections: number;
    searchLimitReachedDirections: number;
    completeHorizonVerified: boolean;
  };

  sources?: {
    ephemeris: string;
    localTerrain: string;
  };

  error?: string;
}

interface MissionRequest {
  date: string;
  time: string;
}

interface BearingSnapshot {
  sun: number | null;
  earth: number | null;
  observationKey: string;
}

/* =========================================================
   DESIGN SYSTEM
========================================================= */

const panelClass =
  "rounded-2xl border border-white/[0.085] bg-[#0d0e10] shadow-[0_18px_55px_rgba(0,0,0,0.20)]";

const inputClass =
  "h-12 w-full rounded-xl border border-white/[0.10] bg-[#111214] px-4 text-sm text-white outline-none transition-all duration-200 [color-scheme:dark] hover:border-white/20 focus:border-[#c9b98e]/60 focus:ring-2 focus:ring-[#c9b98e]/10";

const secondaryButtonClass =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.025] px-4 text-xs font-medium text-white/75 transition-all duration-200 hover:border-white/25 hover:bg-white/[0.07] hover:text-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40";

const primaryButtonClass =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#e8e5dc] px-5 text-xs font-semibold text-[#141414] shadow-[0_4px_16px_rgba(255,255,255,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_7px_24px_rgba(255,255,255,0.10)] active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0";

/* =========================================================
   FORMATTERS + QUERY VALIDATION
========================================================= */

function getCurrentUtcRequest(): MissionRequest {
  const now = new Date().toISOString();

  return {
    date: now.slice(0, 10),
    time: now.slice(11, 19),
  };
}

function parseFiniteQueryNumber(
  value: string | null,
): number | null {
  if (value === null || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function isSupportedProduct78Site(
  value: string,
): value is Product78SiteId {
  try {
    getProduct78Site(value as Product78SiteId);
    return true;
  } catch {
    return false;
  }
}

function formatNumber(
  value: number | null | undefined,
  digits = 2,
): string {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return "Unavailable";
  }

  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatAngle(
  value: number | null | undefined,
  digits = 3,
): string {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return "Unavailable";
  }

  return `${formatNumber(value, digits)}°`;
}

function formatCount(
  value: number | null | undefined,
): string {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return "Unavailable";
  }

  return Math.round(value).toLocaleString("en-US");
}

function formatUtcTime12Hour(
  value: string | undefined,
): string {
  if (!value) return "Unavailable";

  const match = value.match(
    /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/,
  );

  if (!match) return value;

  const hour = Number(match[1]);
  const minute = match[2];
  const second = match[3];

  if (hour < 0 || hour > 23) return value;

  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;

  return `${hour12}:${minute}${
    second ? `:${second}` : ""
  } ${period}`;
}

function formatUtcTimestamp(
  value: string | null,
): string {
  if (!value) return "Not yet available";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const iso = date.toISOString();

  return `${iso.slice(0, 10)} · ${formatUtcTime12Hour(
    iso.slice(11, 19),
  )} UTC`;
}

/* =========================================================
   COMPASS CALCULATIONS
========================================================= */

function normalizeAzimuth(azimuthDeg: number): number {
  return ((azimuthDeg % 360) + 360) % 360;
}

function getSignedAngleDifference(
  previous: number,
  current: number,
): number {
  return ((current - previous + 540) % 360) - 180;
}

function formatAngleChange(
  previous: number | null,
  current: number | null,
): string {
  if (
    previous === null ||
    current === null ||
    !Number.isFinite(previous) ||
    !Number.isFinite(current)
  ) {
    return "Waiting for next observation";
  }

  const difference = getSignedAngleDifference(
    previous,
    current,
  );

  if (Math.abs(difference) < 0.0005) {
    return "No measurable change";
  }

  const sign = difference > 0 ? "+" : "−";

  return `${sign}${Math.abs(difference).toFixed(3)}°`;
}

function getCompassPoint(azimuthDeg: number): string {
  const directions = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];

  const normalized = normalizeAzimuth(azimuthDeg);

  return directions[
    Math.round(normalized / 22.5) % 16
  ];
}

/* =========================================================
   VISIBILITY LABELS
========================================================= */

function getVisibilityLabel(
  status: TerrainVisibilityStatus | undefined,
): string {
  switch (status) {
    case "target_disk_below_sampled_terrain":
      return "Below sampled terrain";

    case "target_disk_intersects_sampled_terrain":
      return "Intersects terrain horizon";

    case "target_disk_above_sampled_terrain_unconfirmed":
      return "Above sampled horizon · unconfirmed";

    case "target_disk_size_unavailable":
      return "Angular diameter unavailable";

    case "terrain_horizon_unavailable":
      return "Terrain horizon unavailable";

    default:
      return "No visibility result";
  }
}

function getVisibilityStyle(
  status: TerrainVisibilityStatus | undefined,
): string {
  switch (status) {
    case "target_disk_below_sampled_terrain":
      return "border-red-300/20 bg-red-300/[0.05] text-red-200";

    case "target_disk_intersects_sampled_terrain":
      return "border-amber-300/25 bg-amber-300/[0.05] text-amber-200";

    case "target_disk_above_sampled_terrain_unconfirmed":
      return "border-white/20 bg-white/[0.045] text-white/80";

    default:
      return "border-white/10 bg-white/[0.025] text-white/45";
  }
}

function getGeometricHorizonLabel(
  elevationDeg: number | null | undefined,
): string {
  if (
    elevationDeg === null ||
    elevationDeg === undefined ||
    !Number.isFinite(elevationDeg)
  ) {
    return "Geometric horizon unavailable";
  }

  if (elevationDeg < 0) {
    return "Below geometric lunar horizon";
  }

  if (elevationDeg === 0) {
    return "At geometric lunar horizon";
  }

  return "Above geometric lunar horizon";
}

/* =========================================================
   SHARED COMPONENTS
========================================================= */

function Eyebrow({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.2em] text-white/40">
      <span className="h-1 w-1 rounded-full bg-[#c9b98e]" />
      {children}
    </div>
  );
}

function SectionHeading({
  number,
  eyebrow,
  title,
  description,
}: {
  number: string;
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <Eyebrow>
          {number} / {eyebrow}
        </Eyebrow>

        <h2 className="mt-3 text-xl font-medium tracking-tight text-white sm:text-2xl">
          {title}
        </h2>

        {description && (
          <p className="mt-2 max-w-2xl text-xs leading-6 text-white/40">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`${panelClass} min-w-0 p-5 sm:p-6 ${className}`}
    >
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  unit,
  large = false,
}: {
  label: string;
  value: string;
  unit?: string;
  large?: boolean;
}) {
  return (
    <div className="group min-w-0 rounded-xl border border-white/[0.07] bg-[#090a0b] p-4 transition-all duration-200 hover:border-white/[0.15] hover:bg-[#101113]">
      <div className="text-[9px] font-medium uppercase tracking-[0.16em] text-white/40">
        {label}
      </div>

      <div
        className={`mt-3 break-words font-semibold tracking-tight text-white ${
          large ? "text-2xl sm:text-3xl" : "text-lg"
        }`}
      >
        {value}

        {unit && value !== "Unavailable" && (
          <span className="ml-1.5 text-xs font-normal text-white/35">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | number | boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-5 border-b border-white/[0.055] py-3 last:border-0">
      <span className="text-xs text-white/40">
        {label}
      </span>

      <span className="max-w-[65%] break-all text-right text-xs font-medium text-white/75">
        {String(value)}
      </span>
    </div>
  );
}

function StatusPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "amber" | "red" | "green";
}) {
  const styles = {
    neutral:
      "border-white/15 bg-white/[0.04] text-white/65",
    amber:
      "border-amber-300/25 bg-amber-300/[0.06] text-amber-200",
    red:
      "border-red-300/25 bg-red-300/[0.06] text-red-200",
    green:
      "border-emerald-300/20 bg-emerald-300/[0.05] text-emerald-200",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${styles[tone]}`}
    >
      {children}
    </span>
  );
}

function SectionDivider() {
  return <div className="my-10 h-px bg-white/[0.06]" />;
}

/* =========================================================
   CELESTIAL COMPASS
========================================================= */

function SkyPositionPlot({
  sun,
  earth,
}: {
  sun?: HorizonsObservation;
  earth?: HorizonsObservation;
}) {
  const center = 150;
  const markerRadius = 91;

  const previousSnapshotRef =
    useRef<BearingSnapshot | null>(null);

  const [previousSnapshot, setPreviousSnapshot] =
    useState<BearingSnapshot | null>(null);

  useEffect(() => {
    if (!sun && !earth) return;

    const nextSnapshot: BearingSnapshot = {
      sun:
        sun && Number.isFinite(sun.azimuthDeg)
          ? normalizeAzimuth(sun.azimuthDeg)
          : null,

      earth:
        earth && Number.isFinite(earth.azimuthDeg)
          ? normalizeAzimuth(earth.azimuthDeg)
          : null,

      observationKey: `${sun?.time ?? "no-sun"}|${earth?.time ?? "no-earth"}`,
    };

    const previous = previousSnapshotRef.current;

    if (
      previous &&
      previous.observationKey !== nextSnapshot.observationKey
    ) {
      setPreviousSnapshot(previous);
    }

    previousSnapshotRef.current = nextSnapshot;
  }, [sun, earth]);

  function getPoint(target?: HorizonsObservation) {
    if (
      !target ||
      !Number.isFinite(target.azimuthDeg) ||
      !Number.isFinite(target.elevationDeg)
    ) {
      return null;
    }

    const azimuth = normalizeAzimuth(
      target.azimuthDeg,
    );

    const radians = (azimuth * Math.PI) / 180;

    return {
      x: center + Math.sin(radians) * markerRadius,
      y: center - Math.cos(radians) * markerRadius,
      azimuth,
      elevation: target.elevationDeg,
      direction: getCompassPoint(azimuth),
      belowHorizon: target.elevationDeg < 0,
    };
  }

  function getBearingPoint(
    azimuth: number | null,
  ) {
    if (
      azimuth === null ||
      !Number.isFinite(azimuth)
    ) {
      return null;
    }

    const radians =
      (normalizeAzimuth(azimuth) * Math.PI) / 180;

    return {
      x: center + Math.sin(radians) * markerRadius,
      y: center - Math.cos(radians) * markerRadius,
    };
  }

  const sunPoint = getPoint(sun);
  const earthPoint = getPoint(earth);

  const previousSunPoint = getBearingPoint(
    previousSnapshot?.sun ?? null,
  );

  const previousEarthPoint = getBearingPoint(
    previousSnapshot?.earth ?? null,
  );

  const sunChange = formatAngleChange(
    previousSnapshot?.sun ?? null,
    sunPoint?.azimuth ?? null,
  );

  const earthChange = formatAngleChange(
    previousSnapshot?.earth ?? null,
    earthPoint?.azimuth ?? null,
  );

  const ticks = Array.from(
    { length: 72 },
    (_, index) => {
      const azimuth = index * 5;
      const radians =
        (azimuth * Math.PI) / 180;

      const major = azimuth % 30 === 0;
      const medium = azimuth % 10 === 0;
      const inner = major ? 119 : medium ? 123 : 126;

      return {
        azimuth,
        x1: center + Math.sin(radians) * inner,
        y1: center - Math.cos(radians) * inner,
        x2: center + Math.sin(radians) * 132,
        y2: center - Math.cos(radians) * 132,
        major,
      };
    },
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Eyebrow>Directional reference</Eyebrow>

          <h3 className="mt-2 text-base font-medium text-white">
            Celestial bearing compass
          </h3>

          <p className="mt-1 text-[10px] text-white/35">
            0° lunar north · Bearings increase clockwise
          </p>
        </div>

        <StatusPill>360° reference</StatusPill>
      </div>

      <div className="mx-auto mt-6 w-full max-w-[390px]">
        <svg
          viewBox="0 0 300 300"
          className="h-auto w-full overflow-visible"
          role="img"
          aria-label="Compass showing actual Sun and Earth azimuths returned by the mission API"
        >
          <defs>
            <radialGradient id="compassCore">
              <stop offset="0%" stopColor="#202226" />
              <stop offset="100%" stopColor="#0b0c0e" />
            </radialGradient>
          </defs>

          <circle
            cx={center}
            cy={center}
            r="139"
            fill="#090a0b"
            stroke="#ffffff"
            strokeOpacity="0.11"
          />

          <circle
            cx={center}
            cy={center}
            r="112"
            fill="url(#compassCore)"
            stroke="#ffffff"
            strokeOpacity="0.13"
          />

          <circle
            cx={center}
            cy={center}
            r={markerRadius}
            fill="none"
            stroke="#e5e0d2"
            strokeWidth="1.2"
            strokeOpacity="0.35"
          />

          <circle
            cx={center}
            cy={center}
            r="45.5"
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.13"
            strokeDasharray="3 5"
          />

          <circle
            cx={center}
            cy={center}
            r="126"
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.15"
            strokeDasharray="3 6"
          />

          <path
            d={`M ${center} ${center - 112} V ${center + 112} M ${center - 112} ${center} H ${center + 112}`}
            stroke="#ffffff"
            strokeOpacity="0.08"
            strokeDasharray="3 6"
          />

          {ticks.map((tick) => (
            <line
              key={tick.azimuth}
              x1={tick.x1}
              y1={tick.y1}
              x2={tick.x2}
              y2={tick.y2}
              stroke={
                tick.major ? "#d0cec6" : "#777777"
              }
              strokeOpacity={
                tick.major ? 0.8 : 0.32
              }
              strokeWidth={
                tick.major ? 1.4 : 0.7
              }
            />
          ))}

          <text
            x={center}
            y="14"
            textAnchor="middle"
            fill="#f4f2ed"
            fontSize="12"
            fontWeight="700"
          >
            N
          </text>

          <text
            x="286"
            y={center + 4}
            textAnchor="middle"
            fill="#a8a8a8"
            fontSize="10"
            fontWeight="600"
          >
            E
          </text>

          <text
            x={center}
            y="295"
            textAnchor="middle"
            fill="#a8a8a8"
            fontSize="10"
            fontWeight="600"
          >
            S
          </text>

          <text
            x="14"
            y={center + 4}
            textAnchor="middle"
            fill="#a8a8a8"
            fontSize="10"
            fontWeight="600"
          >
            W
          </text>

          {previousSunPoint && (
            <circle
              cx={previousSunPoint.x}
              cy={previousSunPoint.y}
              r="8"
              fill="none"
              stroke="#d6b66f"
              strokeWidth="1.3"
              strokeDasharray="2 2"
              opacity="0.55"
            />
          )}

          {previousEarthPoint && (
            <circle
              cx={previousEarthPoint.x}
              cy={previousEarthPoint.y}
              r="8"
              fill="none"
              stroke="#d0d0d0"
              strokeWidth="1.3"
              strokeDasharray="2 2"
              opacity="0.55"
            />
          )}

          {sunPoint && (
            <g>
              <line
                x1={center}
                y1={center}
                x2={sunPoint.x}
                y2={sunPoint.y}
                stroke="#d6b66f"
                strokeWidth="1.8"
                strokeOpacity="0.9"
                strokeDasharray={
                  sunPoint.belowHorizon
                    ? "5 5"
                    : undefined
                }
              />

              <circle
                cx={sunPoint.x}
                cy={sunPoint.y}
                r="12"
                fill="#d6b66f"
                fillOpacity="0.12"
              />

              <circle
                cx={sunPoint.x}
                cy={sunPoint.y}
                r="6"
                fill="#d6b66f"
                stroke="#f3dfb0"
                strokeWidth="1.5"
                style={{
                  transition:
                    "cx 700ms ease, cy 700ms ease",
                }}
              />

              <text
                x={
                  sunPoint.x >= center
                    ? sunPoint.x + 12
                    : sunPoint.x - 12
                }
                y={sunPoint.y - 12}
                textAnchor={
                  sunPoint.x >= center ? "start" : "end"
                }
                fill="#e6c985"
                fontSize="9"
                fontWeight="700"
              >
                SUN
              </text>
            </g>
          )}

          {earthPoint && (
            <g>
              <line
                x1={center}
                y1={center}
                x2={earthPoint.x}
                y2={earthPoint.y}
                stroke="#d0d0d0"
                strokeWidth="1.8"
                strokeOpacity="0.8"
                strokeDasharray={
                  earthPoint.belowHorizon
                    ? "5 5"
                    : undefined
                }
              />

              <circle
                cx={earthPoint.x}
                cy={earthPoint.y}
                r="12"
                fill="#d0d0d0"
                fillOpacity="0.1"
              />

              <circle
                cx={earthPoint.x}
                cy={earthPoint.y}
                r="6"
                fill="#bdbdbd"
                stroke="#f0f0f0"
                strokeWidth="1.5"
                style={{
                  transition:
                    "cx 700ms ease, cy 700ms ease",
                }}
              />

              <text
                x={
                  earthPoint.x >= center
                    ? earthPoint.x + 12
                    : earthPoint.x - 12
                }
                y={earthPoint.y + 15}
                textAnchor={
                  earthPoint.x >= center
                    ? "start"
                    : "end"
                }
                fill="#e0e0e0"
                fontSize="9"
                fontWeight="700"
              >
                EARTH
              </text>
            </g>
          )}

          <circle
            cx={center}
            cy={center}
            r="5"
            fill="#dedbd1"
          />

          <circle
            cx={center}
            cy={center}
            r="11"
            fill="none"
            stroke="#dedbd1"
            strokeOpacity="0.2"
          />
        </svg>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-amber-200/15 bg-amber-200/[0.035] p-4">
          <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-amber-200">
            <span className="h-2 w-2 rounded-full bg-amber-300" />
            Sun · Current
          </div>

          {sunPoint ? (
            <>
              <p className="mt-3 text-xl font-semibold text-white">
                {formatNumber(sunPoint.azimuth, 3)}°
              </p>

              <p className="mt-1 text-[10px] text-white/45">
                {sunPoint.direction} · Elevation{" "}
                {formatAngle(sunPoint.elevation)}
              </p>

              <div className="mt-3 border-t border-amber-200/10 pt-3">
                <p className="text-[8px] uppercase tracking-[0.14em] text-white/35">
                  Change from previous observation
                </p>

                <p className="mt-1 text-sm font-semibold text-amber-200">
                  {sunChange}
                </p>
              </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-white/40">
              Bearing unavailable
            </p>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
          <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-white/70">
            <span className="h-2 w-2 rounded-full bg-white/75" />
            Earth · Current
          </div>

          {earthPoint ? (
            <>
              <p className="mt-3 text-xl font-semibold text-white">
                {formatNumber(earthPoint.azimuth, 3)}°
              </p>

              <p className="mt-1 text-[10px] text-white/45">
                {earthPoint.direction} · Elevation{" "}
                {formatAngle(earthPoint.elevation)}
              </p>

              <div className="mt-3 border-t border-white/10 pt-3">
                <p className="text-[8px] uppercase tracking-[0.14em] text-white/35">
                  Change from previous observation
                </p>

                <p className="mt-1 text-sm font-semibold text-white/80">
                  {earthChange}
                </p>
              </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-white/40">
              Bearing unavailable
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap justify-center gap-4 text-[9px] text-white/40">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-300" />
          Current Sun
        </span>

        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full border border-white bg-[#999]" />
          Current Earth
        </span>

        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full border border-dashed border-white/50" />
          Previous bearing
        </span>
      </div>

      <p className="mt-4 text-center text-[9px] leading-5 text-white/30">
        Compass markers use actual JPL Horizons azimuths.
        Previous markers represent the preceding successful
        observation. Elevation is reported separately.
      </p>
    </div>
  );
}

/* =========================================================
   SUN / EARTH TELEMETRY
========================================================= */

function TargetPanel({
  name,
  target,
  accent,
}: {
  name: "SUN" | "EARTH";
  target?: HorizonsObservation;
  accent: "sun" | "earth";
}) {
  const visibility = target?.terrainVisibility;
  const isSun = accent === "sun";

  return (
    <Panel className="h-full">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              isSun ? "bg-amber-300" : "bg-white/75"
            }`}
          />

          <h3
            className={`text-sm font-semibold tracking-[0.16em] ${
              isSun
                ? "text-amber-200"
                : "text-white/85"
            }`}
          >
            {name}
          </h3>
        </div>

        <span className="text-[9px] text-white/30">
          {target?.time ?? "No observation"}
        </span>
      </div>

      {!target ? (
        <div className="mt-5 rounded-xl border border-white/10 p-4 text-xs text-white/40">
          No observation was returned for this target.
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Metric
              label="Azimuth"
              value={formatAngle(target.azimuthDeg)}
            />

            <Metric
              label="Elevation"
              value={formatAngle(target.elevationDeg)}
            />

            <Metric
              label="Angular diameter"
              value={formatNumber(
                target.angularDiameterArcsec,
                3,
              )}
              unit="arcsec"
            />

            <Metric
              label="Terrain clearance"
              value={formatAngle(
                visibility?.clearanceDeg ?? null,
              )}
            />
          </div>

          <div className="mt-5">
            <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/35">
              Geometric horizon
            </p>

            <StatusPill
              tone={
                target.elevationDeg < 0
                  ? "red"
                  : "neutral"
              }
            >
              {getGeometricHorizonLabel(
                target.elevationDeg,
              )}
            </StatusPill>
          </div>

          <div className="mt-5">
            <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/35">
              Terrain visibility
            </p>

            <span
              className={`inline-flex rounded-lg border px-3 py-2 text-xs leading-5 ${getVisibilityStyle(
                visibility?.status,
              )}`}
            >
              {getVisibilityLabel(visibility?.status)}
            </span>
          </div>

          <div className="mt-5 border-t border-white/[0.07] pt-2">
            <DetailRow
              label="Terrain horizon elevation"
              value={formatAngle(
                visibility?.terrainHorizonElevationDeg ?? null,
              )}
            />

            <DetailRow
              label="Target centre elevation"
              value={formatAngle(
                visibility?.targetElevationDeg ??
                  target.elevationDeg,
              )}
            />

            <DetailRow
              label="Terrain clearance"
              value={formatAngle(
                visibility?.clearanceDeg ?? null,
              )}
            />

            <DetailRow
              label="Target disk visible"
              value={
                visibility?.targetDiskVisible === null ||
                visibility?.targetDiskVisible === undefined
                  ? "Undetermined"
                  : visibility.targetDiskVisible
                    ? "Yes, according to sampled terrain"
                    : "No, below sampled terrain"
              }
            />

            <DetailRow
              label="Terrain coverage complete"
              value={
                visibility?.terrainCoverageComplete === true
                  ? "Yes"
                  : "No"
              }
            />

            <DetailRow
              label="Visibility status code"
              value={
                visibility?.status ?? "Unavailable"
              }
            />
          </div>
        </>
      )}
    </Panel>
  );
}

/* =========================================================
   MAIN DASHBOARD
========================================================= */

function MissionDataDashboardContent() {
  const searchParams = useSearchParams();

  const requestedSiteId =
    searchParams.get("siteId") ||
    DEFAULT_PRODUCT78_SITE_ID;

  const siteId = requestedSiteId as Product78SiteId;
  const hasValidSite = isSupportedProduct78Site(requestedSiteId);

  const latitudeParam = searchParams.get("lat");
  const longitudeParam = searchParams.get("lon");
  const pixelColumnParam = searchParams.get("pixelColumn");
  const pixelRowParam = searchParams.get("pixelRow");

  const latitudeValue =
    parseFiniteQueryNumber(latitudeParam);

  const longitudeValue =
    parseFiniteQueryNumber(longitudeParam);

  const pixelColumnValue =
    parseFiniteQueryNumber(pixelColumnParam);

  const pixelRowValue =
    parseFiniteQueryNumber(pixelRowParam);

  const hasValidCoordinates =
    latitudeValue !== null &&
    latitudeValue >= -90 &&
    latitudeValue <= 90 &&
    longitudeValue !== null &&
    longitudeValue >= 0 &&
    longitudeValue < 360;

  const hasValidPixelSelection =
    pixelColumnValue !== null &&
    pixelColumnValue >= 0 &&
    pixelRowValue !== null &&
    pixelRowValue >= 0;

  const hasValidObserverSelection =
    hasValidSite &&
    hasValidCoordinates &&
    hasValidPixelSelection;

  const dateParam = searchParams.get("date") || "";
  const timeParam = searchParams.get("time") || "";

  const [dateDraft, setDateDraft] = useState("");
  const [timeDraft, setTimeDraft] = useState("");

  const [request, setRequest] =
    useState<MissionRequest | null>(null);

  const [data, setData] =
    useState<MissionApiResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [liveMode, setLiveMode] = useState(false);

  const [lastSuccessfulFetchAt, setLastSuccessfulFetchAt] =
    useState<string | null>(null);

  const observerSelectionMessage = !hasValidSite
    ? "The requested landing site is not a supported NASA Product 78 site."
    : !hasValidCoordinates
      ? "A valid latitude and east longitude were not passed to Mission Data. Return to the Map Planner and select a position directly on the Product 78 terrain map."
      : !hasValidPixelSelection
        ? "The Product 78 raster pixel coordinates are missing or invalid. Return to the Map Planner and select a terrain position again."
        : null;

  const hasValidPlannerDate =
    /^\d{4}-\d{2}-\d{2}$/.test(dateDraft);

  /* =======================================================
     INITIALIZE MISSION EPOCH
  ======================================================= */

  useEffect(() => {
    const currentUtc = getCurrentUtcRequest();

    const initialRequest: MissionRequest = {
      date: dateParam || currentUtc.date,
      time: timeParam || currentUtc.time,
    };

    setDateDraft(initialRequest.date);
    setTimeDraft(initialRequest.time);
    setRequest(initialRequest);

    /*
     * Do not automatically start live mode when this page
     * has not received a complete selected observer position.
     */
    setLiveMode(
      hasValidObserverSelection &&
      !dateParam &&
      !timeParam,
    );
  }, [
    dateParam,
    timeParam,
    hasValidObserverSelection,
  ]);

  /* =======================================================
     FETCH SINGLE-TIME MISSION OBSERVATION
  ======================================================= */

  useEffect(() => {
    /*
     * This guard runs before fetch construction.
     * No site default, map centre or fabricated observer
     * position can be substituted for the selected location.
     */
    if (!hasValidObserverSelection) {
      setData(null);
      setError(null);
      setLoading(false);
      setLastSuccessfulFetchAt(null);
      return;
    }

    if (
      request === null ||
      latitudeValue === null ||
      longitudeValue === null ||
      pixelColumnValue === null ||
      pixelRowValue === null
    ) {
      return;
    }

    const activeRequest = request;
    const controller = new AbortController();

    async function loadMissionData() {
      setLoading(true);
      setError(null);

      try {
        getProduct78Site(siteId);

        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(activeRequest.date)
        ) {
          throw new Error(
            "Mission date must use YYYY-MM-DD format.",
          );
        }

        if (
          !/^\d{2}:\d{2}(?::\d{2})?$/.test(activeRequest.time)
        ) {
          throw new Error(
            "Mission time must use HH:mm or HH:mm:ss format.",
          );
        }

        const query = new URLSearchParams({
          siteId,
          date: activeRequest.date,
          time: activeRequest.time,
          lat: String(latitudeValue),
          lon: String(longitudeValue),
          pixelColumn: String(pixelColumnValue),
          pixelRow: String(pixelRowValue),
        });

        const response = await fetch(
          `/api/horizons/selected-location?${query.toString()}`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          },
        );

        const result =
          (await response.json()) as MissionApiResponse;

        if (!response.ok || !result.success) {
          throw new Error(
            result.error ||
              `Mission data request failed with HTTP ${response.status}.`,
          );
        }

        if (
          result.site?.id &&
          result.site.id !== siteId
        ) {
          throw new Error(
            `Site mismatch. Requested ${siteId}, received ${result.site.id}.`,
          );
        }

        setData(result);
        setLastSuccessfulFetchAt(
          new Date().toISOString(),
        );
      } catch (caughtError) {
        if (
          caughtError instanceof DOMException &&
          caughtError.name === "AbortError"
        ) {
          return;
        }

        if (!controller.signal.aborted) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to load mission data.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadMissionData();

    return () => controller.abort();
  }, [
    request,
    siteId,
    hasValidObserverSelection,
    latitudeValue,
    longitudeValue,
    pixelColumnValue,
    pixelRowValue,
  ]);

  /* =======================================================
     LIVE MODE REFRESH
  ======================================================= */

  useEffect(() => {
    if (
      !hasValidObserverSelection ||
      !liveMode ||
      loading ||
      request === null
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const currentUtc = getCurrentUtcRequest();

      setDateDraft(currentUtc.date);
      setTimeDraft(currentUtc.time);
      setRequest(currentUtc);
    }, LIVE_REFRESH_INTERVAL_MS);

    return () => window.clearTimeout(timeoutId);
  }, [
    hasValidObserverSelection,
    liveMode,
    loading,
    request,
  ]);

  /* =======================================================
     MANUAL OBSERVATION
  ======================================================= */

  function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    setFormError(null);

    if (!hasValidObserverSelection) {
      setFormError(
        "Select a valid Product 78 landing position in the Map Planner before requesting mission data.",
      );
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDraft)) {
      setFormError("Enter a valid mission date.");
      return;
    }

    if (!/^\d{2}:\d{2}(?::\d{2})?$/.test(timeDraft)) {
      setFormError("Enter a valid mission time.");
      return;
    }

    setLiveMode(false);

    setRequest({
      date: dateDraft,
      time: timeDraft,
    });
  }

  /* =======================================================
     LIVE MODE BUTTON
  ======================================================= */

  function handleLiveModeToggle() {
    if (!hasValidObserverSelection) {
      setFormError(
        "Select a valid Product 78 landing position before enabling live updates.",
      );
      return;
    }

    if (liveMode) {
      setLiveMode(false);
      return;
    }

    const currentUtc = getCurrentUtcRequest();

    setDateDraft(currentUtc.date);
    setTimeDraft(currentUtc.time);

    setError(null);
    setFormError(null);
    setLiveMode(true);
    setRequest(currentUtc);
  }

  /* =======================================================
     APPLY PLANNER RECOMMENDATION
  ======================================================= */

  function handleUseRecommendedTime(
    timeUtc: string,
  ) {
    if (!hasValidObserverSelection) {
      setFormError(
        "Select a valid Product 78 landing position before applying a recommendation.",
      );
      return;
    }

    if (!/^\d{2}:\d{2}:\d{2}$/.test(timeUtc)) {
      setFormError(
        "The planner returned an invalid UTC time.",
      );
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDraft)) {
      setFormError(
        "Select a valid mission date before applying a recommendation.",
      );
      return;
    }

    setLiveMode(false);
    setFormError(null);
    setError(null);

    setTimeDraft(timeUtc);

    setRequest({
      date: dateDraft,
      time: timeUtc,
    });
  }

  /* =======================================================
     CURRENT DATA REFERENCES
  ======================================================= */

  const sun = data?.targets?.sun;
  const earth = data?.targets?.earth;
  const observer = data?.observer;
  const terrain = data?.terrainModel;

  /*
   * The Explorer link is built from the validated observer
   * parameters and the currently selected mission epoch.
   * Explorer expects "col" and "row" for raster coordinates.
   */
  const explorerDate =
    request?.date || dateDraft || dateParam;

  const explorerTime =
    request?.time || timeDraft || timeParam;

  const explorerHref = (() => {
    if (
      !hasValidObserverSelection ||
      latitudeValue === null ||
      longitudeValue === null ||
      pixelColumnValue === null ||
      pixelRowValue === null ||
      !/^\d{4}-\d{2}-\d{2}$/.test(explorerDate) ||
      !/^\d{2}:\d{2}(?::\d{2})?$/.test(explorerTime)
    ) {
      return null;
    }

    const query = new URLSearchParams({
      siteId,
      lat: String(latitudeValue),
      lon: String(longitudeValue),
      col: String(pixelColumnValue),
      row: String(pixelRowValue),
      date: explorerDate,
      time: explorerTime,
      target: "both",
    });

    return `/explorer?${query.toString()}`;
  })();

  const isReady = Boolean(
    hasValidObserverSelection &&
    data &&
    !loading &&
    !error,
  );

  /* =======================================================
     PAGE
  ======================================================= */

  return (
    <main className="min-h-screen overflow-hidden bg-[#08090a] text-[#f4f2ed] selection:bg-[#c9b98e]/25 selection:text-white">
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_50%_-20%,rgba(185,171,133,0.09),transparent_55%)]" />

      <div className="relative z-10 mx-auto max-w-[1500px] px-4 pb-12 pt-5 sm:px-6 lg:px-10">

        {/* HEADER */}

        <header className="mb-10 border-b border-white/[0.08] pb-6">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
            <div>
              <Link
                href="/"
                className="group inline-flex items-center gap-3 transition-opacity duration-200 hover:opacity-75"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/[0.045]">
                  <span className="h-3 w-3 rounded-full border border-[#d7c89f] bg-[#d7c89f]/20 shadow-[0_0_18px_rgba(215,200,159,0.22)]" />
                </span>

                <span className="text-sm font-semibold tracking-[0.19em]">
                  LUNA
                  <span className="font-light text-white/40">
                    PATH
                  </span>
                </span>
              </Link>

              <div className="mt-8">
                <Eyebrow>
                  Mission intelligence / telemetry
                </Eyebrow>

                <h1 className="mt-3 text-3xl font-medium tracking-[-0.045em] text-white sm:text-4xl lg:text-5xl">
                  Mission data
                </h1>

                <p className="mt-3 max-w-xl text-sm leading-6 text-white/40">
                  Ephemeris, observer coordinates and
                  terrain-horizon analysis for your selected
                  lunar landing location.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/map"
                className={secondaryButtonClass}
              >
                <span aria-hidden="true">←</span>
                Landing planner
              </Link>

              {explorerHref ? (
                <Link
                  href={explorerHref}
                  className={primaryButtonClass}
                >
                  Open 360° explorer
                  <span aria-hidden="true">↗</span>
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  className={primaryButtonClass}
                  title="Select a valid landing position in the Map Planner first"
                >
                  Open 360° explorer
                  <span aria-hidden="true">↗</span>
                </button>
              )}
            </div>
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    !hasValidObserverSelection
                      ? "bg-amber-300"
                      : loading
                        ? "animate-pulse bg-amber-300"
                        : error
                          ? "bg-red-400"
                          : isReady
                            ? "bg-emerald-300"
                            : "bg-white/30"
                  }`}
                />

                <span className="text-[9px] font-semibold uppercase tracking-[0.17em] text-white/45">
                  {!hasValidObserverSelection
                    ? "Landing position required"
                    : loading
                      ? "Processing mission request"
                      : error
                        ? "Mission request failed"
                        : isReady
                          ? "Mission data received"
                          : data
                            ? "Previous successful observation"
                            : "Awaiting mission data"}
                </span>
              </div>

              {liveMode && hasValidObserverSelection && (
                <StatusPill tone="green">
                  <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
                  Live updates on
                </StatusPill>
              )}
            </div>

            <span className="text-[9px] uppercase tracking-[0.14em] text-white/25">
              NASA LOLA Product 78 · JPL HORIZONS
            </span>
          </div>
        </header>

        {/* OBSERVATION CONFIGURATION */}

        <section className="mb-10">
          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Eyebrow>
                  Observation configuration
                </Eyebrow>

                <h2 className="mt-3 text-lg font-medium text-white">
                  Mission time
                </h2>

                <p className="mt-1 text-xs text-white/40">
                  Set a historical epoch or track the current
                  UTC epoch automatically.
                </p>
              </div>

              <StatusPill>
                UTC / Universal Time
              </StatusPill>
            </div>

            <form
              onSubmit={handleSubmit}
              className="mt-6"
            >
              <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label className="block">
                  <span className="mb-2 block text-[9px] font-semibold uppercase tracking-[0.15em] text-white/40">
                    Mission date
                  </span>

                  <input
                    type="date"
                    value={dateDraft}
                    onChange={(event) => {
                      setLiveMode(false);
                      setDateDraft(event.target.value);
                    }}
                    required
                    className={inputClass}
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-[9px] font-semibold uppercase tracking-[0.15em] text-white/40">
                    Mission time (UTC)
                  </span>

                  <input
                    type="time"
                    step="1"
                    value={timeDraft}
                    onChange={(event) => {
                      setLiveMode(false);
                      setTimeDraft(event.target.value);
                    }}
                    required
                    className={inputClass}
                  />
                </label>

                <button
                  type="submit"
                  disabled={loading || !hasValidObserverSelection}
                  className={`${primaryButtonClass} w-full sm:w-auto`}
                >
                  {loading ? (
                    <>
                      <span className="h-3 w-3 animate-spin rounded-full border border-black/25 border-t-black" />
                      Calculating
                    </>
                  ) : (
                    <>
                      Use selected time
                      <span aria-hidden="true">↗</span>
                    </>
                  )}
                </button>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleLiveModeToggle}
                  disabled={
                    !hasValidObserverSelection ||
                    (loading && !liveMode)
                  }
                  className={
                    liveMode
                      ? secondaryButtonClass
                      : primaryButtonClass
                  }
                >
                  {liveMode
                    ? "Pause live updates"
                    : "Start live updates"}
                </button>

                <span className="text-[10px] text-white/35">
                  {liveMode
                    ? `Automatically requests a new JPL Horizons epoch every ${LIVE_REFRESH_INTERVAL_MS / 1000} seconds after the previous request finishes.`
                    : "Live refresh is paused. The selected date and time remain fixed until you submit or start live updates."}
                </span>
              </div>

              {formError && (
                <p className="mt-3 text-xs text-red-300">
                  {formError}
                </p>
              )}

              <p className="mt-5 border-t border-white/[0.06] pt-4 text-[10px] leading-5 text-white/30">
                The selected date and time are sent to the
                mission API as Universal Time. In live mode,
                the page obtains a fresh UTC epoch and requests
                new ephemeris. Celestial positions are not
                invented or interpolated by the frontend.
              </p>
            </form>
          </Panel>
        </section>

        {/* OBSERVER POSITION REQUIREMENT */}

        {!hasValidObserverSelection && (
          <section className="mb-10 rounded-2xl border border-amber-200/20 bg-amber-200/[0.035] p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="max-w-2xl">
                <Eyebrow>
                  Observer position required
                </Eyebrow>

                <h2 className="mt-3 text-lg font-medium text-white">
                  Select a Product 78 landing position first
                </h2>

                <p className="mt-2 text-xs leading-6 text-white/55">
                  {observerSelectionMessage}
                </p>

                <p className="mt-3 text-[10px] leading-5 text-white/35">
                  Mission Data requires the selected site,
                  latitude, east longitude and raster pixel
                  coordinates. It will not substitute default
                  coordinates or request visibility data
                  without that complete selection.
                </p>
              </div>

              <Link
                href="/map"
                className={primaryButtonClass}
              >
                Return to landing planner
                <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </section>
        )}

        {/* FULL-DAY JOINT VISIBILITY PLANNER */}

        {hasValidObserverSelection && hasValidPlannerDate ? (
          <JointVisibilityPlanner
            date={dateDraft}
            siteId={siteId}
            latitude={String(latitudeValue)}
            longitude={String(longitudeValue)}
            pixelColumn={String(pixelColumnValue)}
            pixelRow={String(pixelRowValue)}
            onUseTime={handleUseRecommendedTime}
          />
        ) : hasValidObserverSelection ? (
          <Panel className="mb-10">
            <Eyebrow>
              Daily visibility planner
            </Eyebrow>

            <p className="mt-3 text-sm text-white/55">
              Waiting for a valid mission date before starting
              the daily visibility analysis.
            </p>
          </Panel>
        ) : null}

        {/* REQUEST STATUS */}

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.018] px-4 py-3">
          <div className="flex items-center gap-3">
            <span
              className={`h-2 w-2 rounded-full ${
                !hasValidObserverSelection
                  ? "bg-amber-300"
                  : loading
                    ? "animate-pulse bg-amber-300"
                    : error
                      ? "bg-red-400"
                      : data
                        ? "bg-emerald-300"
                        : "bg-white/30"
              }`}
            />

            <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/55">
              {!hasValidObserverSelection
                ? "Waiting for landing position"
                : loading
                  ? "Requesting NASA / JPL data"
                  : error
                    ? "Request failed"
                    : data
                      ? "Mission data received"
                      : "Waiting for mission data"}
            </span>
          </div>

          <div className="flex flex-col items-start gap-1 text-left sm:items-end sm:text-right">
            {data?.mission && (
              <span className="font-mono text-[10px] text-white/45">
                API epoch: {data.mission.date} ·{" "}
                {formatUtcTime12Hour(data.mission.time)} UTC
              </span>
            )}

            {lastSuccessfulFetchAt && (
              <span className="text-[9px] text-white/25">
                Last successful response received:{" "}
                {formatUtcTimestamp(lastSuccessfulFetchAt)}
              </span>
            )}
          </div>
        </div>

        {liveMode && hasValidObserverSelection && (
          <div className="mb-6 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.025] px-4 py-3 text-[10px] leading-5 text-emerald-100/65">
            Live mode requests new observations automatically.
            Do not expect large marker jumps: celestial bearings
            can change slowly at a fixed lunar location.
          </div>
        )}

        {data && loading && (
          <div className="mb-6 rounded-xl border border-amber-300/15 bg-amber-300/[0.035] px-4 py-3 text-[10px] leading-5 text-amber-100/70">
            A new observation is being calculated. The
            dashboard is showing the last successful API
            response until the new response arrives.
          </div>
        )}

        {data && error && (
          <div className="mb-6 rounded-xl border border-red-300/15 bg-red-300/[0.035] px-4 py-3 text-[10px] leading-5 text-red-100/70">
            The latest request failed. The dashboard below
            still shows the last successful observation, not
            fabricated or estimated replacement data.
          </div>
        )}

        {error && hasValidObserverSelection && (
          <div className="mb-6 rounded-2xl border border-red-300/20 bg-red-300/[0.035] p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-300/15 bg-red-300/[0.06] text-sm text-red-200">
                !
              </span>

              <div className="text-sm font-semibold text-red-200">
                Unable to retrieve the latest mission data
              </div>
            </div>

            <p className="mt-3 break-words text-xs leading-6 text-red-100/60">
              {error}
            </p>
          </div>
        )}

        {loading && !data && hasValidObserverSelection && (
          <Panel className="mb-8 py-16 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.035]">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/15 border-t-[#d6c18e]" />
            </div>

            <p className="mt-5 text-sm font-medium text-white/75">
              Calculating lunar observation data
            </p>

            <p className="mt-2 text-[10px] text-white/35">
              JPL Horizons · Product 78 terrain · Horizon analysis
            </p>
          </Panel>
        )}

        {data && hasValidObserverSelection && (
          <>
            {/* 01 — CELESTIAL ORIENTATION */}

            <section className="mb-10">
              <SectionHeading
                number="01"
                eyebrow="Celestial orientation"
                title="Sun and Earth positioning"
                description="Actual ephemeris bearings, angular dimensions and terrain-relative visibility for the selected observer and mission time."
              />

              <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
                <Panel>
                  <SkyPositionPlot
                    sun={sun}
                    earth={earth}
                  />
                </Panel>

                <div className="grid gap-4 md:grid-cols-2">
                  <TargetPanel
                    name="SUN"
                    target={sun}
                    accent="sun"
                  />

                  <TargetPanel
                    name="EARTH"
                    target={earth}
                    accent="earth"
                  />
                </div>
              </div>
            </section>

            <SectionDivider />

            {/* 02 — OBSERVER POSITION */}

            <section className="mb-10">
              <SectionHeading
                number="02"
                eyebrow="Observer coordinates"
                title="Selected landing position"
                description="Geographic and raster coordinates returned by the selected-location API request."
              />

              <Panel>
                {observer ? (
                  <>
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                      <Eyebrow>
                        Observer reference
                      </Eyebrow>

                      <StatusPill tone="green">
                        Position resolved
                      </StatusPill>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Metric
                        label="Latitude"
                        value={formatNumber(
                          observer.latitudeDeg,
                          6,
                        )}
                        unit="°"
                      />

                      <Metric
                        label="Longitude east"
                        value={formatNumber(
                          observer.longitudeEastDeg,
                          6,
                        )}
                        unit="°"
                      />

                      <Metric
                        label="LOLA elevation"
                        value={formatNumber(
                          observer.elevationMeters,
                          3,
                        )}
                        unit="m"
                      />

                      <Metric
                        label="Observer altitude"
                        value={formatNumber(
                          observer.altitudeKm,
                          6,
                        )}
                        unit="km"
                      />

                      <Metric
                        label="Raster column"
                        value={formatNumber(
                          observer.pixel.column,
                          3,
                        )}
                      />

                      <Metric
                        label="Raster row"
                        value={formatNumber(
                          observer.pixel.row,
                          3,
                        )}
                      />
                    </div>

                    <div className="mt-5 border-t border-white/[0.07] pt-3">
                      <div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/35">
                        Nearest raster pixel
                      </div>

                      <DetailRow
                        label="Pixel column"
                        value={observer.nearestPixel.column}
                      />

                      <DetailRow
                        label="Pixel row"
                        value={observer.nearestPixel.row}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-white/40">
                    Observer data was not returned by the API.
                  </p>
                )}
              </Panel>
            </section>

            <SectionDivider />

            {/* 03 — PRODUCT 78 TERRAIN MODEL */}

            <section className="mb-10">
              <SectionHeading
                number="03"
                eyebrow="Terrain analysis"
                title="Product 78 terrain horizon model"
                description="NASA LOLA Product 78 elevation sampling configuration, raster coverage and directional horizon analysis statistics."
              />

              <Panel>
                {terrain ? (
                  <>
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                      <Eyebrow>
                        Terrain computation
                      </Eyebrow>

                      <StatusPill>
                        {terrain.product}
                      </StatusPill>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Metric
                        label="Raster resolution"
                        value={formatNumber(
                          terrain.resolutionMeters,
                          2,
                        )}
                        unit="m"
                      />

                      <Metric
                        label="Horizon sample step"
                        value={formatNumber(
                          terrain.sampleStepMeters,
                          2,
                        )}
                        unit="m"
                      />

                      <Metric
                        label="Maximum search distance"
                        value={formatNumber(
                          terrain.maxDistanceMeters,
                          0,
                        )}
                        unit="m"
                      />

                      <Metric
                        label="Calculated directions"
                        value={formatCount(
                          terrain.calculatedDirections,
                        )}
                      />

                      <Metric
                        label="Total samples checked"
                        value={formatCount(
                          terrain.totalSamplesChecked,
                        )}
                      />

                      <Metric
                        label="Product 78 samples"
                        value={formatCount(
                          terrain.product78SamplesChecked,
                        )}
                      />

                      <Metric
                        label="Boundary-limited directions"
                        value={formatCount(
                          terrain.rasterBoundaryLimitedDirections,
                        )}
                      />

                      <Metric
                        label="Search-limit directions"
                        value={formatCount(
                          terrain.searchLimitReachedDirections,
                        )}
                      />
                    </div>

                    <div className="mt-6 rounded-xl border border-amber-300/20 bg-amber-300/[0.035] p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-300/15 bg-amber-300/[0.06] text-amber-200">
                            !
                          </span>

                          <div>
                            <div className="text-xs font-semibold text-amber-200">
                              Horizon coverage qualification
                            </div>

                            <p className="mt-1 text-[9px] text-white/40">
                              Scientific interpretation constraint
                            </p>
                          </div>
                        </div>

                        <StatusPill
                          tone={
                            terrain.completeHorizonVerified
                              ? "green"
                              : "amber"
                          }
                        >
                          {terrain.completeHorizonVerified
                            ? "Complete horizon verified"
                            : "Sampled coverage only"}
                        </StatusPill>
                      </div>

                      <p className="mt-4 text-xs leading-6 text-white/65">
                        {terrain.completeHorizonVerified
                          ? "The API reports that the complete horizon was verified."
                          : "Terrain horizon calculated from directional samples using NASA LOLA Product 78. Coverage is limited to the available elevation raster. Results describe sampled terrain and do not establish visibility beyond that coverage."}
                      </p>
                    </div>

                    <div className="mt-6 border-t border-white/[0.07] pt-3">
                      <div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/35">
                        Model metadata
                      </div>

                      <DetailRow
                        label="Terrain product"
                        value={terrain.product}
                      />

                      <DetailRow
                        label="Terrain site"
                        value={terrain.siteName}
                      />

                      <DetailRow
                        label="Reference frame"
                        value={terrain.referenceFrame}
                      />

                      <DetailRow
                        label="Ephemeris"
                        value={terrain.ephemeris}
                      />

                      <DetailRow
                        label="Complete horizon verified"
                        value={
                          terrain.completeHorizonVerified
                            ? "Yes"
                            : "No"
                        }
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-white/40">
                    Terrain model information was not returned by the API.
                  </p>
                )}
              </Panel>
            </section>

            <SectionDivider />

            {/* 04 — DATA PROVENANCE */}

            <section className="mb-10">
              <SectionHeading
                number="04"
                eyebrow="Data provenance"
                title="Scientific data sources"
                description="The ephemeris and local elevation data sources used by the selected-location calculation."
              />

              <div className="grid gap-3 md:grid-cols-2">
                <Panel>
                  <Eyebrow>Ephemeris</Eyebrow>

                  <p className="mt-4 break-words text-sm font-medium text-white">
                    {data.sources?.ephemeris ?? "Unavailable"}
                  </p>

                  <p className="mt-3 text-[10px] leading-5 text-white/35">
                    NASA/JPL Horizons provides the Sun and Earth
                    apparent-position observations for the
                    requested mission epoch.
                  </p>
                </Panel>

                <Panel>
                  <Eyebrow>Local terrain</Eyebrow>

                  <p className="mt-4 break-words text-sm font-medium text-white">
                    {data.sources?.localTerrain ?? "Unavailable"}
                  </p>

                  <p className="mt-3 text-[10px] leading-5 text-white/35">
                    NASA LOLA Product 78 supplies the selected
                    landing site's elevation data for observer
                    positioning and sampled terrain-horizon
                    analysis.
                  </p>
                </Panel>
              </div>
            </section>
          </>
        )}

        {/* FOOTER */}

        <footer className="flex flex-col justify-between gap-4 border-t border-white/[0.08] pt-6 sm:flex-row sm:items-center">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.18em] text-white/55">
              LUNAPATH
            </p>

            <p className="mt-1 text-[9px] text-white/25">
              Lunar Landing Site Navigator
            </p>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-2 text-[9px] uppercase tracking-[0.12em] text-white/30">
            <span>NASA LOLA Product 78</span>
            <span>JPL HORIZONS</span>
            <span>Terrain visibility analysis</span>
          </div>
        </footer>
      </div>
    </main>
  );
}

/* =========================================================
   PAGE — SEARCH PARAMS SUSPENSE
========================================================= */

export default function MissionDataPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[#08090a] text-white">
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.035]">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/15 border-t-[#d6c18e]" />
            </div>

            <p className="mt-5 text-sm text-white/55">
              Preparing mission data dashboard...
            </p>
          </div>
        </main>
      }
    >
      <MissionDataDashboardContent />
    </Suspense>
  );
}