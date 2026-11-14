
"use client";

import {
  Suspense,
  useEffect,
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
    product90SamplesChecked: number;
    rasterBoundaryLimitedDirections: number;
    searchLimitReachedDirections: number;
    completeHorizonVerified: boolean;
  };

  sources?: {
    ephemeris: string;
    localTerrain: string;
    regionalTerrain: string;
  };

  error?: string;
}

interface MissionRequest {
  date: string;
  time: string;
}

/* =========================================================
   DESIGN SYSTEM
========================================================= */

const panelClass =
  "rounded-2xl border border-white/[0.085] bg-[#0d0e10] shadow-[0_18px_55px_rgba(0,0,0,0.20)]";

const inputClass =
  "h-12 w-full rounded-xl border border-white/[0.10] bg-[#111214] px-4 text-sm text-white outline-none transition-all duration-200 [color-scheme:dark] hover:border-white/20 focus:border-[#c9b98e]/60 focus:ring-2 focus:ring-[#c9b98e]/10";

const secondaryButtonClass =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.025] px-4 text-xs font-medium text-white/75 transition-all duration-200 hover:border-white/25 hover:bg-white/[0.07] hover:text-white active:scale-[0.98]";

const primaryButtonClass =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#e8e5dc] px-5 text-xs font-semibold text-[#141414] shadow-[0_4px_16px_rgba(255,255,255,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_7px_24px_rgba(255,255,255,0.10)] active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0";

/* =========================================================
   FORMATTERS
========================================================= */

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

function formatCount(value: number | null | undefined): string {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return "Unavailable";
  }

  return Math.round(value).toLocaleString("en-US");
}

/* =========================================================
   COMPASS CALCULATIONS
========================================================= */

function normalizeAzimuth(azimuthDeg: number): number {
  return ((azimuthDeg % 360) + 360) % 360;
}

function getCompassPoint(azimuthDeg: number): string {
  const directions = [
    "N", "NNE", "NE", "ENE",
    "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW",
    "W", "WNW", "NW", "NNW",
  ];

  const normalized = normalizeAzimuth(azimuthDeg);

  return directions[Math.round(normalized / 22.5) % 16];
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
        <Eyebrow>{number} / {eyebrow}</Eyebrow>

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
    <section className={`${panelClass} min-w-0 p-5 sm:p-6 ${className}`}>
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
      <span className="text-xs text-white/40">{label}</span>

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
    neutral: "border-white/15 bg-white/[0.04] text-white/65",
    amber: "border-amber-300/25 bg-amber-300/[0.06] text-amber-200",
    red: "border-red-300/25 bg-red-300/[0.06] text-red-200",
    green: "border-emerald-300/20 bg-emerald-300/[0.05] text-emerald-200",
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
  const radius = 103;

  function getPoint(target?: HorizonsObservation) {
    if (
      !target ||
      !Number.isFinite(target.azimuthDeg) ||
      !Number.isFinite(target.elevationDeg)
    ) {
      return null;
    }

    const azimuth = normalizeAzimuth(target.azimuthDeg);
    const radians = (azimuth * Math.PI) / 180;

    return {
      x: center + Math.sin(radians) * radius,
      y: center - Math.cos(radians) * radius,
      azimuth,
      elevation: target.elevationDeg,
      direction: getCompassPoint(azimuth),
      belowHorizon: target.elevationDeg < 0,
    };
  }

  const sunPoint = getPoint(sun);
  const earthPoint = getPoint(earth);

  const ticks = Array.from({ length: 72 }, (_, index) => {
    const azimuth = index * 5;
    const radians = (azimuth * Math.PI) / 180;

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
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Eyebrow>Directional reference</Eyebrow>

          <h3 className="mt-2 text-base font-medium text-white">
            Celestial bearing
          </h3>

          <p className="mt-1 text-[10px] text-white/35">
            Clockwise from lunar north · Azimuth reference
          </p>
        </div>

        <StatusPill>360° reference</StatusPill>
      </div>

      <div className="mx-auto mt-6 w-full max-w-[390px]">
        <svg
          viewBox="0 0 300 300"
          className="h-auto w-full overflow-visible"
          role="img"
          aria-label="Compass showing Sun and Earth azimuth positions from mission data"
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
            r="75"
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.11"
            strokeDasharray="2 6"
          />

          <circle
            cx={center}
            cy={center}
            r="39"
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.09"
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
              stroke={tick.major ? "#d0cec6" : "#777777"}
              strokeOpacity={tick.major ? 0.8 : 0.32}
              strokeWidth={tick.major ? 1.4 : 0.7}
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

          <circle cx={center} cy={center} r="5" fill="#dedbd1" />

          <circle
            cx={center}
            cy={center}
            r="11"
            fill="none"
            stroke="#dedbd1"
            strokeOpacity="0.2"
          />

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
                  sunPoint.belowHorizon ? "5 5" : undefined
                }
              />

              <circle
                cx={sunPoint.x}
                cy={sunPoint.y}
                r="11"
                fill="#d6b66f"
                fillOpacity="0.12"
              />

              <circle
                cx={sunPoint.x}
                cy={sunPoint.y}
                r="6"
                fill={sunPoint.belowHorizon ? "#705d37" : "#d6b66f"}
                stroke="#f3dfb0"
                strokeWidth="1.5"
              />

              <text
                x={sunPoint.x + (sunPoint.x >= center ? 12 : -12)}
                y={sunPoint.y - 12}
                textAnchor={sunPoint.x >= center ? "start" : "end"}
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
                  earthPoint.belowHorizon ? "5 5" : undefined
                }
              />

              <circle
                cx={earthPoint.x}
                cy={earthPoint.y}
                r="11"
                fill="#d0d0d0"
                fillOpacity="0.1"
              />

              <circle
                cx={earthPoint.x}
                cy={earthPoint.y}
                r="6"
                fill={earthPoint.belowHorizon ? "#555555" : "#bdbdbd"}
                stroke="#f0f0f0"
                strokeWidth="1.5"
              />

              <text
                x={earthPoint.x + (earthPoint.x >= center ? 12 : -12)}
                y={earthPoint.y + 15}
                textAnchor={earthPoint.x >= center ? "start" : "end"}
                fill="#e0e0e0"
                fontSize="9"
                fontWeight="700"
              >
                EARTH
              </text>
            </g>
          )}
        </svg>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-amber-200/15 bg-amber-200/[0.035] p-4">
          <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-amber-200">
            <span className="h-2 w-2 rounded-full bg-amber-300" />
            Sun
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

              <p className="mt-3 text-[9px] text-white/55">
                {sunPoint.belowHorizon
                  ? "Below geometric horizon"
                  : "Above geometric horizon"}
              </p>
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
            Earth
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

              <p className="mt-3 text-[9px] text-white/55">
                {earthPoint.belowHorizon
                  ? "Below geometric horizon"
                  : "Above geometric horizon"}
              </p>
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
          Sun bearing
        </span>

        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full border border-white bg-[#999]" />
          Earth bearing
        </span>

        <span className="text-white/30">
          Dashed line = below geometric horizon
        </span>
      </div>

      <p className="mt-4 text-center text-[9px] leading-5 text-white/30">
        Compass marker position uses azimuth only. Marker radius is
        fixed. Elevation and terrain visibility are assessed independently.
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
              isSun ? "text-amber-200" : "text-white/85"
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
              value={formatNumber(target.angularDiameterArcsec, 3)}
              unit="arcsec"
            />

            <Metric
              label="Terrain clearance"
              value={formatAngle(visibility?.clearanceDeg ?? null)}
            />
          </div>

          <div className="mt-5">
            <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/35">
              Geometric horizon
            </p>

            <StatusPill
              tone={target.elevationDeg < 0 ? "red" : "neutral"}
            >
              {getGeometricHorizonLabel(target.elevationDeg)}
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
                visibility?.targetElevationDeg ?? target.elevationDeg,
              )}
            />

            <DetailRow
              label="Terrain clearance"
              value={formatAngle(visibility?.clearanceDeg ?? null)}
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
              value={visibility?.status ?? "Unavailable"}
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

  const siteId = (
    searchParams.get("siteId") || DEFAULT_PRODUCT78_SITE_ID
  ) as Product78SiteId;

  const latitudeParam = searchParams.get("lat");
  const longitudeParam = searchParams.get("lon");
  const pixelColumnParam = searchParams.get("pixelColumn");
  const pixelRowParam = searchParams.get("pixelRow");

  const dateParam = searchParams.get("date") || "";
  const timeParam = searchParams.get("time") || "";

  const [dateDraft, setDateDraft] = useState("");
  const [timeDraft, setTimeDraft] = useState("");

  const [request, setRequest] = useState<MissionRequest | null>(null);
  const [data, setData] = useState<MissionApiResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const now = new Date();

    const initialDate =
      dateParam || now.toISOString().slice(0, 10);

    const initialTime =
      timeParam || now.toISOString().slice(11, 19);

    setDateDraft(initialDate);
    setTimeDraft(initialTime);

    setRequest({
      date: initialDate,
      time: initialTime,
    });
  }, [dateParam, timeParam]);

  useEffect(() => {
    if (request === null) return;

    const activeRequest: MissionRequest = request;
    const controller = new AbortController();

    async function loadMissionData() {
      setLoading(true);
      setError(null);
      setData(null);

      try {
        getProduct78Site(siteId);

        if (!/^\d{4}-\d{2}-\d{2}$/.test(activeRequest.date)) {
          throw new Error("Mission date must use YYYY-MM-DD format.");
        }

        if (!/^\d{2}:\d{2}(?::\d{2})?$/.test(activeRequest.time)) {
          throw new Error("Mission time must use HH:mm or HH:mm:ss format.");
        }

        const query = new URLSearchParams({
          siteId,
          date: activeRequest.date,
          time: activeRequest.time,
        });

        function appendFiniteParameter(
          name: string,
          value: string | null,
        ) {
          if (value === null || value.trim() === "") return;

          const parsed = Number(value);

          if (!Number.isFinite(parsed)) {
            throw new Error(`${name} is not a valid number.`);
          }

          query.set(name, String(parsed));
        }

        appendFiniteParameter("lat", latitudeParam);
        appendFiniteParameter("lon", longitudeParam);

        const normalizedPixelColumn =
          pixelColumnParam === "undefined" ||
          pixelColumnParam === "null"
            ? null
            : pixelColumnParam;

        const normalizedPixelRow =
          pixelRowParam === "undefined" ||
          pixelRowParam === "null"
            ? null
            : pixelRowParam;

        const hasColumn =
          normalizedPixelColumn !== null &&
          normalizedPixelColumn.trim() !== "";

        const hasRow =
          normalizedPixelRow !== null &&
          normalizedPixelRow.trim() !== "";

        if (hasColumn !== hasRow) {
          throw new Error(
            "The URL must provide both pixelColumn and pixelRow.",
          );
        }

        if (hasColumn && hasRow) {
          appendFiniteParameter("pixelColumn", normalizedPixelColumn);
          appendFiniteParameter("pixelRow", normalizedPixelRow);
        }

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

        if (result.site?.id && result.site.id !== siteId) {
          throw new Error(
            `Site mismatch. Requested ${siteId}, received ${result.site.id}.`,
          );
        }

        setData(result);
      } catch (caughtError) {
        if (
          caughtError instanceof DOMException &&
          caughtError.name === "AbortError"
        ) {
          return;
        }

        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to load mission data.",
        );
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
    latitudeParam,
    longitudeParam,
    pixelColumnParam,
    pixelRowParam,
  ]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDraft)) {
      setFormError("Enter a valid mission date.");
      return;
    }

    if (!/^\d{2}:\d{2}(?::\d{2})?$/.test(timeDraft)) {
      setFormError("Enter a valid mission time.");
      return;
    }

    setRequest({
      date: dateDraft,
      time: timeDraft,
    });
  }

  const sun = data?.targets?.sun;
  const earth = data?.targets?.earth;
  const observer = data?.observer;
  const terrain = data?.terrainModel;

  const originalQuery = searchParams.toString();

  const explorerHref = originalQuery
    ? `/explorer?${originalQuery}`
    : "/explorer";

  const isReady = Boolean(data && !loading && !error);

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
                  LUNA<span className="font-light text-white/40">PATH</span>
                </span>
              </Link>

              <div className="mt-8">
                <Eyebrow>Mission intelligence / telemetry</Eyebrow>

                <h1 className="mt-3 text-3xl font-medium tracking-[-0.045em] text-white sm:text-4xl lg:text-5xl">
                  Mission data
                </h1>

                <p className="mt-3 max-w-xl text-sm leading-6 text-white/40">
                  Ephemeris, observer coordinates and terrain-horizon
                  analysis for your selected lunar landing location.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link href="/map" className={secondaryButtonClass}>
                <span aria-hidden="true">←</span>
                Landing planner
              </Link>

              <Link href={explorerHref} className={primaryButtonClass}>
                Open 360° explorer
                <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
            <div className="flex items-center gap-2">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  loading
                    ? "animate-pulse bg-amber-300"
                    : error
                      ? "bg-red-400"
                      : isReady
                        ? "bg-emerald-300"
                        : "bg-white/30"
                }`}
              />

              <span className="text-[9px] font-semibold uppercase tracking-[0.17em] text-white/45">
                {loading
                  ? "Processing mission request"
                  : error
                    ? "Mission request failed"
                    : isReady
                      ? "Mission data received"
                      : "Awaiting mission data"}
              </span>
            </div>

            <span className="text-[9px] uppercase tracking-[0.14em] text-white/25">
              NASA LOLA · JPL HORIZONS
            </span>
          </div>
        </header>

        {/* OBSERVATION CONFIGURATION */}

        <section className="mb-10">
          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Eyebrow>Observation configuration</Eyebrow>

                <h2 className="mt-3 text-lg font-medium text-white">
                  Mission time
                </h2>

                <p className="mt-1 text-xs text-white/40">
                  Set the observation epoch for celestial calculations.
                </p>
              </div>

              <StatusPill>UTC / Universal Time</StatusPill>
            </div>

            <form onSubmit={handleSubmit} className="mt-6">
              <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label className="block">
                  <span className="mb-2 block text-[9px] font-semibold uppercase tracking-[0.15em] text-white/40">
                    Mission date
                  </span>

                  <input
                    type="date"
                    value={dateDraft}
                    onChange={(event) => setDateDraft(event.target.value)}
                    required
                    className={inputClass}
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-[9px] font-semibold uppercase tracking-[0.15em] text-white/40">
                    Mission time
                  </span>

                  <input
                    type="time"
                    step="1"
                    value={timeDraft}
                    onChange={(event) => setTimeDraft(event.target.value)}
                    required
                    className={inputClass}
                  />
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className={`${primaryButtonClass} w-full sm:w-auto`}
                >
                  {loading ? (
                    <>
                      <span className="h-3 w-3 animate-spin rounded-full border border-black/25 border-t-black" />
                      Calculating
                    </>
                  ) : (
                    <>
                      Refresh data
                      <span aria-hidden="true">↗</span>
                    </>
                  )}
                </button>
              </div>

              {formError && (
                <p className="mt-3 text-xs text-red-300">
                  {formError}
                </p>
              )}

              <p className="mt-5 border-t border-white/[0.06] pt-4 text-[10px] leading-5 text-white/30">
                The selected date and time are sent to JPL Horizons
                as Universal Time. A new observation requests fresh
                ephemeris and terrain-visibility calculations.
              </p>
            </form>
          </Panel>
        </section>

        {/* REQUEST STATUS */}

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.018] px-4 py-3">
          <div className="flex items-center gap-3">
            <span
              className={`h-2 w-2 rounded-full ${
                loading
                  ? "animate-pulse bg-amber-300"
                  : error
                    ? "bg-red-400"
                    : data
                      ? "bg-emerald-300"
                      : "bg-white/30"
              }`}
            />

            <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/55">
              {loading
                ? "Requesting NASA / JPL data"
                : error
                  ? "Request failed"
                  : data
                    ? "Mission data received"
                    : "Waiting for mission data"}
            </span>
          </div>

          {data?.mission && (
            <span className="font-mono text-[10px] text-white/35">
              {data.mission.date} · {data.mission.time} UT
            </span>
          )}
        </div>

        {/* ERROR */}

        {error && (
          <div className="mb-6 rounded-2xl border border-red-300/20 bg-red-300/[0.035] p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-300/15 bg-red-300/[0.06] text-sm text-red-200">
                !
              </span>

              <div className="text-sm font-semibold text-red-200">
                Unable to retrieve mission data
              </div>
            </div>

            <p className="mt-3 break-words text-xs leading-6 text-red-100/60">
              {error}
            </p>
          </div>
        )}

        {/* LOADING */}

        {loading && !data && (
          <Panel className="mb-8 py-16 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.035]">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/15 border-t-[#d6c18e]" />
            </div>

            <p className="mt-5 text-sm font-medium text-white/75">
              Calculating lunar observation data
            </p>

            <p className="mt-2 text-[10px] text-white/35">
              JPL Horizons · LOLA terrain · Horizon analysis
            </p>
          </Panel>
        )}

        {data && (
          <>
            {/* 01 — CELESTIAL ORIENTATION */}

            <section className="mb-10">
              <SectionHeading
                number="01"
                eyebrow="Celestial orientation"
                title="Sun and Earth positioning"
                description="Ephemeris bearings, angular dimensions and terrain-relative visibility for the selected observer and mission time."
              />

              <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
                <Panel>
                  <SkyPositionPlot sun={sun} earth={earth} />
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
                description="Geographic and raster coordinates used by the selected-location API request."
              />

              <Panel>
                {observer ? (
                  <>
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                      <Eyebrow>Observer reference</Eyebrow>

                      <StatusPill tone="green">
                        Position resolved
                      </StatusPill>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Metric
                        label="Latitude"
                        value={formatNumber(observer.latitudeDeg, 6)}
                        unit="°"
                      />

                      <Metric
                        label="Longitude east"
                        value={formatNumber(observer.longitudeEastDeg, 6)}
                        unit="°"
                      />

                      <Metric
                        label="LOLA elevation"
                        value={formatNumber(observer.elevationMeters, 3)}
                        unit="m"
                      />

                      <Metric
                        label="Observer altitude"
                        value={formatNumber(observer.altitudeKm, 6)}
                        unit="km"
                      />

                      <Metric
                        label="Raster column"
                        value={formatNumber(observer.pixel.column, 3)}
                      />

                      <Metric
                        label="Raster row"
                        value={formatNumber(observer.pixel.row, 3)}
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
                    Observer data was not returned.
                  </p>
                )}
              </Panel>
            </section>

            <SectionDivider />

            {/* 03 — TERRAIN HORIZON MODEL */}

            <section className="mb-10">
              <SectionHeading
                number="03"
                eyebrow="Terrain analysis"
                title="Multi-resolution horizon model"
                description="Sampling configuration, elevation coverage and directional analysis statistics returned by the selected-location API."
              />

              <Panel>
                {terrain ? (
                  <>
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                      <Eyebrow>Terrain computation</Eyebrow>

                      <StatusPill tone="neutral">
                        {terrain.product}
                      </StatusPill>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Metric
                        label="Raster resolution"
                        value={formatNumber(terrain.resolutionMeters, 2)}
                        unit="m"
                      />

                      <Metric
                        label="Horizon sample step"
                        value={formatNumber(terrain.sampleStepMeters, 2)}
                        unit="m"
                      />

                      <Metric
                        label="Maximum search distance"
                        value={formatNumber(terrain.maxDistanceMeters, 0)}
                        unit="m"
                      />

                      <Metric
                        label="Calculated directions"
                        value={formatCount(terrain.calculatedDirections)}
                      />

                      <Metric
                        label="Total samples checked"
                        value={formatCount(terrain.totalSamplesChecked)}
                      />

                      <Metric
                        label="Product 78 samples"
                        value={formatCount(terrain.product78SamplesChecked)}
                      />

                      <Metric
                        label="Product 90 samples"
                        value={formatCount(terrain.product90SamplesChecked)}
                      />

                      <Metric
                        label="Boundary-limited directions"
                        value={formatCount(terrain.rasterBoundaryLimitedDirections)}
                      />

                      <Metric
                        label="Search-limit directions"
                        value={formatCount(terrain.searchLimitReachedDirections)}
                      />
                    </div>

                    {/* HORIZON QUALIFICATION */}

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
                          : "The complete lunar horizon has NOT been verified. Visibility results describe the sampled terrain coverage only and must not be presented as globally confirmed."}
                      </p>

                      {!terrain.completeHorizonVerified && (
                        <p className="mt-4 border-t border-amber-300/10 pt-4 text-[10px] leading-6 text-white/40">
                          Data qualification: sampled-terrain assessment
                          only. Unsampled terrain, raster boundaries and
                          unavailable elevation data may affect the actual
                          line of sight. An above-sampled-horizon result is
                          not proof of unobstructed global visibility.
                        </p>
                      )}
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
                        value={terrain.completeHorizonVerified ? "Yes" : "No"}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-white/40">
                    Terrain model information was not returned.
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
                description="Source identifiers returned by the mission API."
              />

              <div className="grid gap-3 md:grid-cols-3">
                <Panel>
                  <Eyebrow>Ephemeris</Eyebrow>

                  <p className="mt-4 break-words text-sm font-medium text-white">
                    {data.sources?.ephemeris ?? "Unavailable"}
                  </p>

                  <p className="mt-3 text-[10px] leading-5 text-white/35">
                    Sun and Earth apparent-position calculations.
                  </p>
                </Panel>

                <Panel>
                  <Eyebrow>Local terrain</Eyebrow>

                  <p className="mt-4 break-words text-sm font-medium text-white">
                    {data.sources?.localTerrain ?? "Unavailable"}
                  </p>

                  <p className="mt-3 text-[10px] leading-5 text-white/35">
                    Selected landing-site elevation model.
                  </p>
                </Panel>

                <Panel>
                  <Eyebrow>Regional terrain</Eyebrow>

                  <p className="mt-4 break-words text-sm font-medium text-white">
                    {data.sources?.regionalTerrain ?? "Unavailable"}
                  </p>

                  <p className="mt-3 text-[10px] leading-5 text-white/35">
                    Regional terrain contribution to horizon analysis.
                  </p>
                </Panel>
              </div>
            </section>

            {/* RAW API RESPONSE */}

            <details className="mb-10 overflow-hidden rounded-2xl border border-white/[0.085] bg-[#0d0e10]">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-5 py-5 text-xs font-semibold text-white/75 transition-colors duration-200 hover:bg-white/[0.025] hover:text-white">
                <span>Complete raw API response</span>

                <span className="text-[9px] font-normal uppercase tracking-[0.14em] text-white/30">
                  JSON · All returned fields
                </span>
              </summary>

              <div className="border-t border-white/[0.07] p-4">
                <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/[0.06] bg-black p-4 font-mono text-[10px] leading-5 text-white/65">
                  {JSON.stringify(data, null, 2)}
                </pre>
              </div>
            </details>
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
            <span>NASA LOLA</span>
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
