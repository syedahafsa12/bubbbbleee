"use client";

import { useEffect, useMemo, useState } from "react";
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

/* =========================================================
   LANDING SITES
========================================================= */

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

/* =========================================================
   API TYPES
========================================================= */

type SampledDiskVisibility =
  | "below_sampled_horizon"
  | "partially_above_sampled_horizon"
  | "fully_above_sampled_horizon"
  | "unknown";

interface TargetTerrainVisibility {
  sampledDiskVisibility: SampledDiskVisibility;
  anyPartAboveSampledHorizon: boolean | null;
  fullDiskAboveSampledHorizon: boolean | null;
  targetDiskVisible: boolean | null;
  terrainCoverageComplete: boolean;
}

interface VisibilityWindow {
  startTimeIso: string;
  endTimeIso: string;
  durationMinutes: number;
  sampleCount: number;
  bestTimeIso: string;
  bestTimeUtc?: string;
  bestSunClearanceDeg: number;
  bestEarthClearanceDeg: number;
  bestJointClearanceDeg: number;
}

interface DailyAvailability {
  date: string;
  status: string;
  sampleCount: number;
  matchedObservationCount?: number;
  candidateWindows?: VisibilityWindow[];
  verifiedWindows?: VisibilityWindow[];
  windows?: VisibilityWindow[];
  terrainCoverageComplete: boolean;
  terrainConfidence?: {
    level?: string;
  };
  candidateSampleCount?: number;
}

interface DailyResponse {
  success: boolean;
  site?: {
    id: string;
    displayName: string;
  };
  terrainModel?: {
    completeHorizonVerified?: boolean;
  };
  availability?: DailyAvailability;
  error?: string;
}

interface JointVisibilityResult {
  status: string;
  hasJointVisibilityCandidate: boolean;
  bothHaveVisiblePortion: boolean;
  bothHaveFullDiskAboveSampledHorizon: boolean;
  partialDiskAtLeastOneTarget: boolean;
  terrainCoverageComplete: boolean;
  verified: boolean;
  interpretation: string;
}

interface ObservationResponse {
  success: boolean;
  site?: {
    id: string;
    displayName: string;
  };
  targets?: {
    sun?: {
      terrainVisibility: TargetTerrainVisibility;
    };
    earth?: {
      terrainVisibility: TargetTerrainVisibility;
    };
  };
  jointVisibility?: JointVisibilityResult;
  terrainModel?: {
    completeHorizonVerified?: boolean;
  };
  error?: string;
}

interface LoadedVisibilityWindow {
  window: VisibilityWindow;
  date: string;
}

type TargetAssessmentState =
  | "confirmed"
  | "blocked"
  | "provisional"
  | "unknown";

interface TargetAssessment {
  state: TargetAssessmentState;
  label: string;
  description: string;
}

/* =========================================================
   DATE UTILITIES
========================================================= */

function getMissionRange(
  date: string,
  time: string,
  duration: string,
): {
  startMs: number;
  endMs: number;
} | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  if (!/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }

  const hours = Number(duration);

  if (![6, 12, 24, 48, 72].includes(hours)) {
    return null;
  }

  const start = new Date(`${date}T${time}:00.000Z`);

  if (
    Number.isNaN(start.getTime()) ||
    start.toISOString().slice(0, 10) !== date ||
    start.toISOString().slice(11, 16) !== time
  ) {
    return null;
  }

  return {
    startMs: start.getTime(),
    endMs: start.getTime() + hours * 3_600_000,
  };
}

/*
 * Return only UTC calendar dates actually touched by
 * the configured mission interval.
 *
 * Mission end is exclusive.
 */
function getUtcDatesForMission(
  date: string,
  time: string,
  duration: string,
): string[] {
  const range = getMissionRange(date, time, duration);

  if (!range) {
    return [];
  }

  const firstDate = new Date(range.startMs);
  const lastDate = new Date(range.endMs - 1);

  const dates: string[] = [];

  const cursor = new Date(
    Date.UTC(
      firstDate.getUTCFullYear(),
      firstDate.getUTCMonth(),
      firstDate.getUTCDate(),
    ),
  );

  const lastDateStart = Date.UTC(
    lastDate.getUTCFullYear(),
    lastDate.getUTCMonth(),
    lastDate.getUTCDate(),
  );

  while (cursor.getTime() <= lastDateStart) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function formatUtcClock(date: Date): string {
  const hour = date.getUTCHours();

  const minute = String(date.getUTCMinutes()).padStart(2, "0");

  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;

  return `${hour12}:${minute} ${period}`;
}

function formatUtcDateTime(
  value: string | number,
): string {
  const date =
    typeof value === "number"
      ? new Date(value)
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unavailable";
  }

  return (
    `${date.toISOString().slice(0, 10)} · ` +
    `${formatUtcClock(date)} UTC`
  );
}

/* =========================================================
   TARGET CLASSIFICATION
========================================================= */

function assessTarget(
  visibility: TargetTerrainVisibility | undefined,
  completeHorizonVerified: boolean,
): TargetAssessment {
  if (!visibility) {
    return {
      state: "unknown",
      label: "Not evaluated",
      description: "No target visibility result was returned.",
    };
  }

  const diskIsBelowSampledHorizon =
    visibility.anyPartAboveSampledHorizon === false ||
    visibility.sampledDiskVisibility ===
      "below_sampled_horizon";

  if (diskIsBelowSampledHorizon) {
    return {
      state: "blocked",
      label: "Below sampled terrain horizon",
      description:
        "The available terrain samples show an obstruction in this target's direction.",
    };
  }

  const hasPositiveSampledResult =
    visibility.anyPartAboveSampledHorizon === true ||
    visibility.sampledDiskVisibility ===
      "partially_above_sampled_horizon" ||
    visibility.sampledDiskVisibility ===
      "fully_above_sampled_horizon";

  const isConfirmed =
    completeHorizonVerified &&
    visibility.terrainCoverageComplete === true &&
    visibility.targetDiskVisible === true;

  if (isConfirmed) {
    return {
      state: "confirmed",
      label: "Visibility confirmed",
      description:
        "The target clears a verified complete terrain horizon.",
    };
  }

  if (hasPositiveSampledResult) {
    return {
      state: "provisional",
      label: "Potential visibility — unverified",
      description:
        "The target clears the available terrain samples, but missing terrain means actual visibility cannot be confirmed.",
    };
  }

  return {
    state: "unknown",
    label: "Visibility undetermined",
    description:
      "There is insufficient information to establish whether this target is visible.",
  };
}

/* =========================================================
   API HELPERS
========================================================= */

function addObserverParameters(
  query: URLSearchParams,
  location: {
    coordinate: GeographicCoordinate;
    pixel: RasterPixelCoordinate;
  },
): void {
  query.set("lat", String(location.coordinate.latitudeDeg));
  query.set("lon", String(location.coordinate.longitudeEastDeg));
  query.set("pixelColumn", String(location.pixel.column));
  query.set("pixelRow", String(location.pixel.row));
}

function isTerrainVerified(
  response: DailyResponse,
): boolean {
  return (
    response.availability?.terrainCoverageComplete === true &&
    response.terrainModel?.completeHorizonVerified === true &&
    response.availability?.terrainConfidence?.level === "verified"
  );
}

/* =========================================================
   EXPLORER URL
========================================================= */

function createExplorerHref(
  siteId: LandingSiteId,
  date: string,
  time: string,
  location: {
    coordinate: GeographicCoordinate;
    pixel: RasterPixelCoordinate;
  },
  target: "sun" | "earth" | "both",
): string {
  const query = new URLSearchParams({
    siteId,
    date,
    time,
    target,
  });

  query.set("lat", String(location.coordinate.latitudeDeg));
  query.set("lon", String(location.coordinate.longitudeEastDeg));
  query.set("col", String(location.pixel.column));
  query.set("row", String(location.pixel.row));

  return `/explorer?${query.toString()}`;
}

/* =========================================================
   MISSION DATA URL
========================================================= */

function createMissionDataHref(
  siteId: LandingSiteId,
  date: string,
  time: string,
  location: {
    coordinate: GeographicCoordinate;
    pixel: RasterPixelCoordinate;
  },
): string | null {
  const latitude = location.coordinate.latitudeDeg;
  const longitude = location.coordinate.longitudeEastDeg;
  const pixelColumn = location.pixel.column;
  const pixelRow = location.pixel.row;

  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < 0 ||
    longitude >= 360 ||
    !Number.isFinite(pixelColumn) ||
    pixelColumn < 0 ||
    !Number.isFinite(pixelRow) ||
    pixelRow < 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^\d{2}:\d{2}$/.test(time)
  ) {
    return null;
  }

  const query = new URLSearchParams({
    siteId,
    lat: String(latitude),
    lon: String(longitude),
    pixelColumn: String(pixelColumn),
    pixelRow: String(pixelRow),
    date,
    time,
  });

  return `/mission-data?${query.toString()}`;
}

/* =========================================================
   TARGET CARD
========================================================= */

function TargetCard({
  icon,
  name,
  assessment,
  href,
}: {
  icon: string;
  name: string;
  assessment: TargetAssessment;
  href: string | null;
}) {
  const containerStyle =
    assessment.state === "confirmed"
      ? "border-emerald-300/25 bg-emerald-300/[0.045]"
      : assessment.state === "provisional"
        ? "border-amber-200/20 bg-amber-200/[0.035]"
        : "border-white/[0.09] bg-white/[0.025]";

  const statusStyle =
    assessment.state === "confirmed"
      ? "text-emerald-200"
      : assessment.state === "provisional"
        ? "text-amber-200"
        : assessment.state === "blocked"
          ? "text-white/50"
          : "text-white/35";

  const cardContent = (
    <>
      <div className="flex items-center gap-3">
        <span
          className="text-2xl"
          aria-hidden="true"
        >
          {icon}
        </span>

        <div>
          <p className="text-xs font-medium text-white">
            {name}
          </p>

          <p className={`mt-1 text-[10px] ${statusStyle}`}>
            {assessment.label}
          </p>
        </div>
      </div>

      <p className="mt-3 text-[10px] leading-5 text-white/40">
        {assessment.description}
      </p>

      {href && (
        <p className="mt-3 text-[9px] font-semibold tracking-[0.12em] text-[#d9c89d]/80">
          OPEN 360° VISUALIZATION ↗
        </p>
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        aria-label={`Open 360 degree visualization for ${name}`}
        className={`block rounded-lg border p-4 transition hover:border-[#d6c18e]/50 hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d6c18e]/70 ${containerStyle}`}
      >
        {cardContent}
      </Link>
    );
  }

  return (
    <div className={`rounded-lg border p-4 ${containerStyle}`}>
      {cardContent}
    </div>
  );
}

/* =========================================================
   SUN + EARTH VISIBILITY
========================================================= */

function SunEarthVisibility({
  siteId,
  missionDate,
  missionTime,
  missionDuration,
  localLocation,
}: {
  siteId: LandingSiteId;
  missionDate: string;
  missionTime: string;
  missionDuration: string;

  localLocation: {
    siteId: LandingSiteId;
    coordinate: GeographicCoordinate;
    pixel: RasterPixelCoordinate;
  } | null;
}) {
  const selectedLocation = useMemo(() => {
    if (localLocation?.siteId !== siteId) {
      return null;
    }

    return {
      coordinate: localLocation.coordinate,
      pixel: localLocation.pixel,
    };
  }, [localLocation, siteId]);

  const hasSelection = selectedLocation !== null;

  /* -------------------------------------------------------
     MISSION RANGE
  ------------------------------------------------------- */

  const missionRange = useMemo(
    () => getMissionRange(missionDate, missionTime, missionDuration),
    [missionDate, missionTime, missionDuration],
  );

  const missionDates = useMemo(
    () => getUtcDatesForMission(missionDate, missionTime, missionDuration),
    [missionDate, missionTime, missionDuration],
  );

  const datesKey = missionDates.join(",");

  /* -------------------------------------------------------
     EXACT-TIME STATE
  ------------------------------------------------------- */

  const [instantResult, setInstantResult] =
    useState<ObservationResponse | null>(null);

  const [instantLoading, setInstantLoading] = useState(false);
  const [instantError, setInstantError] = useState<string | null>(null);

  /* -------------------------------------------------------
     MISSION-WINDOW STATE
  ------------------------------------------------------- */

  const [windows, setWindows] = useState<LoadedVisibilityWindow[]>([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [dailyLoaded, setDailyLoaded] = useState(false);
  const [terrainComplete, setTerrainComplete] = useState(false);

  /* =======================================================
     EXACT-TIME CHECK

     No map selection = no request.
  ======================================================= */

  useEffect(() => {
    if (!selectedLocation) {
      setInstantResult(null);
      setInstantError(null);
      setInstantLoading(false);
      return;
    }

    const observerLocation = selectedLocation;

    if (!missionRange) {
      setInstantResult(null);
      setInstantError("Select a valid UTC mission date and time.");
      setInstantLoading(false);
      return;
    }

    const controller = new AbortController();

    async function loadInstantVisibility() {
      setInstantLoading(true);
      setInstantError(null);
      setInstantResult(null);

      try {
        const query = new URLSearchParams({
          mode: "observation",
          siteId,
          date: missionDate,
          time: missionTime,
        });

        addObserverParameters(query, observerLocation);

        const response = await fetch(
          `/api/horizons/selected-location?${query.toString()}`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          },
        );

        const data =
          (await response.json()) as ObservationResponse;

        if (!response.ok || !data.success) {
          throw new Error(
            data.error ||
              `Exact-time visibility check failed (HTTP ${response.status}).`,
          );
        }

        if (!data.jointVisibility) {
          throw new Error(
            "The API returned no exact-time visibility result.",
          );
        }

        if (data.site?.id !== siteId) {
          throw new Error(
            `Site mismatch. Requested ${siteId}, received ${data.site?.id ?? "unknown"}.`,
          );
        }

        setInstantResult(data);
      } catch (caughtError) {
        if (
          caughtError instanceof DOMException &&
          caughtError.name === "AbortError"
        ) {
          return;
        }

        if (!controller.signal.aborted) {
          setInstantError(
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to check the selected mission time.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setInstantLoading(false);
        }
      }
    }

    void loadInstantVisibility();

    return () => controller.abort();
  }, [
    siteId,
    missionDate,
    missionTime,
    missionRange,
    selectedLocation,
  ]);

  /* =======================================================
     MISSION-WINDOW SEARCH

     No map selection = no request.
  ======================================================= */

  useEffect(() => {
    if (!selectedLocation) {
      setWindows([]);
      setDailyError(null);
      setDailyLoading(false);
      setDailyLoaded(false);
      setTerrainComplete(false);
      return;
    }

    const observerLocation = selectedLocation;

    const dates = datesKey ? datesKey.split(",") : [];

    if (!dates.length) {
      setWindows([]);
      setDailyError("Select a valid mission date, time and duration.");
      setDailyLoading(false);
      setDailyLoaded(false);
      return;
    }

    const controller = new AbortController();

    async function loadMissionVisibility() {
      setDailyLoading(true);
      setDailyError(null);
      setWindows([]);
      setDailyLoaded(false);
      setTerrainComplete(false);

      try {
        const loaded: LoadedVisibilityWindow[] = [];

        let everyDateVerified = true;

        for (const date of dates) {
          if (controller.signal.aborted) {
            return;
          }

          const query = new URLSearchParams({
            mode: "joint-visibility-day",
            siteId,
            date,
          });

          addObserverParameters(query, observerLocation);

          const response = await fetch(
            `/api/horizons/selected-location?${query.toString()}`,
            {
              method: "GET",
              cache: "no-store",
              signal: controller.signal,
            },
          );

          const data = (await response.json()) as DailyResponse;

          if (!response.ok || !data.success) {
            throw new Error(
              data.error ||
                `Visibility calculation failed for ${date}.`,
            );
          }

          if (!data.availability) {
            throw new Error(
              `No daily visibility data was returned for ${date}.`,
            );
          }

          if (data.availability.date !== date) {
            throw new Error(
              `The API returned the wrong date for ${date}.`,
            );
          }

          if (data.site?.id !== siteId) {
            throw new Error(
              `Site mismatch. Requested ${siteId}, received ${data.site?.id ?? "unknown"}.`,
            );
          }

          const verified = isTerrainVerified(data);

          if (!verified) {
            everyDateVerified = false;
          }

          const dailyWindows = verified
            ? (
                data.availability.verifiedWindows ??
                data.availability.candidateWindows ??
                data.availability.windows ??
                []
              )
            : (
                data.availability.candidateWindows ??
                data.availability.windows ??
                []
              );

          for (const window of dailyWindows) {
            loaded.push({
              window,
              date,
            });
          }
        }

        if (controller.signal.aborted) {
          return;
        }

        loaded.sort(
          (a, b) =>
            Date.parse(a.window.startTimeIso) -
            Date.parse(b.window.startTimeIso),
        );

        setWindows(loaded);
        setTerrainComplete(everyDateVerified);
        setDailyLoaded(true);
      } catch (caughtError) {
        if (
          caughtError instanceof DOMException &&
          caughtError.name === "AbortError"
        ) {
          return;
        }

        if (!controller.signal.aborted) {
          setDailyError(
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to load mission-interval visibility.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setDailyLoading(false);
        }
      }
    }

    void loadMissionVisibility();

    return () => controller.abort();
  }, [
    siteId,
    datesKey,
    selectedLocation,
  ]);

  /* =======================================================
     IGNORE STALE RESULTS WHEN SITE SELECTION CHANGES
  ======================================================= */

  const activeInstantResult =
    hasSelection && instantResult?.site?.id === siteId
      ? instantResult
      : null;

  const activeWindows = hasSelection ? windows : [];

  /* =======================================================
     FILTER WINDOWS TO MISSION
  ======================================================= */

  const missionWindows = useMemo(() => {
    if (!missionRange) {
      return [];
    }

    return activeWindows.filter(({ window }) => {
      const start = Date.parse(window.startTimeIso);
      const end = Date.parse(window.endTimeIso);

      return (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        start < missionRange.endMs &&
        end > missionRange.startMs
      );
    });
  }, [activeWindows, missionRange]);

  /* =======================================================
     TARGET VISIBILITY CLASSIFICATION
  ======================================================= */

  const completeHorizonVerified =
    activeInstantResult?.terrainModel?.completeHorizonVerified === true;

  const sunVisibility =
    activeInstantResult?.targets?.sun?.terrainVisibility;

  const earthVisibility =
    activeInstantResult?.targets?.earth?.terrainVisibility;

  const sunAssessment = assessTarget(
    sunVisibility,
    completeHorizonVerified,
  );

  const earthAssessment = assessTarget(
    earthVisibility,
    completeHorizonVerified,
  );

  const sunConfirmed =
    sunAssessment.state === "confirmed";

  const earthConfirmed =
    earthAssessment.state === "confirmed";

  const bothConfirmed =
    sunConfirmed && earthConfirmed;

  const atLeastOneConfirmed =
    sunConfirmed || earthConfirmed;

  /*
   * A provisional result is inspectable, but it is NOT
   * classified as confirmed visibility.
   */
  const sunCanExplore =
    sunAssessment.state === "confirmed" ||
    sunAssessment.state === "provisional";

  const earthCanExplore =
    earthAssessment.state === "confirmed" ||
    earthAssessment.state === "provisional";

  const atLeastOneCanExplore =
    sunCanExplore || earthCanExplore;

  /* =======================================================
     TARGET-SPECIFIC EXPLORER URLS
  ======================================================= */

  const sunExplorerHref =
    selectedLocation && missionDate && sunCanExplore
      ? createExplorerHref(
          siteId,
          missionDate,
          missionTime,
          selectedLocation,
          "sun",
        )
      : null;

  const earthExplorerHref =
    selectedLocation && missionDate && earthCanExplore
      ? createExplorerHref(
          siteId,
          missionDate,
          missionTime,
          selectedLocation,
          "earth",
        )
      : null;

  const visualizationTarget:
    | "sun"
    | "earth"
    | "both"
    | null =
    sunCanExplore && earthCanExplore
      ? "both"
      : sunCanExplore
        ? "sun"
        : earthCanExplore
          ? "earth"
          : null;

  const explorerHref =
    selectedLocation &&
    missionDate &&
    visualizationTarget
      ? createExplorerHref(
          siteId,
          missionDate,
          missionTime,
          selectedLocation,
          visualizationTarget,
        )
      : null;

  /* =======================================================
     EXACT-TIME SUMMARY
  ======================================================= */

  const exactTimeStatus = useMemo(() => {
    if (!hasSelection) {
      return {
        title: "Select a landing position first",
        description:
          "Click a point inside the active NASA Product 78 terrain map. Visibility analysis will begin only after you select your coordinates.",
      };
    }

    if (instantError) {
      return {
        title: "Visibility check unavailable",
        description: instantError,
      };
    }

    if (instantLoading) {
      return {
        title: "Checking the lunar sky",
        description:
          "Calculating the Sun and Earth positions for your selected coordinates.",
      };
    }

    if (!activeInstantResult?.jointVisibility) {
      return {
        title: "Waiting for visibility result",
        description:
          "The selected lunar position has not returned a visibility result yet.",
      };
    }

    if (bothConfirmed) {
      return {
        title: "Sun and Earth visibility confirmed",
        description:
          "Both targets have cleared the verified terrain horizon at this mission time.",
      };
    }

    if (sunConfirmed) {
      return {
        title: "Sun visibility confirmed",
        description:
          "The Sun clears the verified terrain horizon. Earth is not confirmed visible at this mission time.",
      };
    }

    if (earthConfirmed) {
      return {
        title: "Earth visibility confirmed",
        description:
          "Earth clears the verified terrain horizon. The Sun is not confirmed visible at this mission time.",
      };
    }

    if (
      sunAssessment.state === "provisional" ||
      earthAssessment.state === "provisional"
    ) {
      return {
        title: "Visibility is not yet verified",
        description:
          "The available terrain samples suggest a possible opening, but the surrounding terrain coverage is incomplete.",
      };
    }

    if (
      sunAssessment.state === "blocked" &&
      earthAssessment.state === "blocked"
    ) {
      return {
        title: "Neither target clears the sampled horizon",
        description:
          "The available terrain samples show obstructions in both target directions.",
      };
    }

    return {
      title: "Visibility could not be determined",
      description:
        "The available terrain and ephemeris results are insufficient to confirm either target.",
    };
  }, [
    hasSelection,
    instantError,
    instantLoading,
    activeInstantResult,
    bothConfirmed,
    sunConfirmed,
    earthConfirmed,
    sunAssessment,
    earthAssessment,
  ]);

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <section
      id="sun-earth-status"
      className="mt-6 overflow-hidden rounded-xl border border-white/[0.09] bg-[#0b0d0f]"
    >
      {/* HEADER */}

      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.17em] text-[#c9b98e]/75">
            Mission visibility analysis
          </p>

          <h3 className="mt-1 text-sm font-medium text-white">
            Sun + Earth visibility
          </h3>

          <p className="mt-1 text-[10px] text-white/40">
            Select a landing position to begin the analysis.
          </p>
        </div>

        {!hasSelection ? (
          <span className="rounded-full border border-white/10 px-3 py-1.5 text-[9px] text-white/45">
            Selection required
          </span>
        ) : instantLoading ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-[9px] text-white/50">
            <span className="h-2.5 w-2.5 animate-spin rounded-full border border-white/20 border-t-[#c9b98e]" />
            Checking
          </span>
        ) : instantError ? (
          <span className="rounded-full border border-red-300/20 bg-red-300/[0.05] px-3 py-1.5 text-[9px] text-red-200">
            Unavailable
          </span>
        ) : bothConfirmed ? (
          <span className="rounded-full border border-emerald-300/25 bg-emerald-300/[0.07] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-200">
            Both confirmed
          </span>
        ) : sunConfirmed ? (
          <span className="rounded-full border border-amber-200/25 bg-amber-200/[0.07] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-amber-200">
            Sun confirmed
          </span>
        ) : earthConfirmed ? (
          <span className="rounded-full border border-blue-300/25 bg-blue-300/[0.07] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-blue-200">
            Earth confirmed
          </span>
        ) : (
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-white/45">
            Not verified
          </span>
        )}
      </div>

      {/* REQUIRE MAP SELECTION */}

      {!hasSelection ? (
        <div className="mx-4 mb-4 rounded-lg border border-[#c9b98e]/20 bg-[#c9b98e]/[0.04] p-5 sm:mx-5">
          <div className="flex items-start gap-3">
            <span className="text-xl" aria-hidden="true">
              ⌖
            </span>

            <div>
              <h4 className="text-sm font-medium text-white">
                Select your exact landing position
              </h4>

              <p className="mt-2 text-xs leading-5 text-white/45">
                Choose{" "}
                {LANDING_SITES.find(
                  (site) => site.id === siteId,
                )?.name}{" "}
                below and click directly on its high-resolution Product 78 terrain map.
              </p>

              <p className="mt-2 text-[10px] leading-5 text-[#d9c89d]/70">
                No default coordinates are used. No Sun or Earth visibility data will be requested or displayed until you select a point.
              </p>

              <a
                href="#local-terrain"
                className="mt-4 inline-flex items-center gap-2 border border-[#d9c89d]/30 px-4 py-2.5 text-[10px] font-semibold tracking-[0.12em] text-[#e4d3a9] transition hover:bg-[#d9c89d]/[0.08]"
              >
                SELECT ON TERRAIN MAP
                <span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* SELECTED POSITION */}

          <div className="mx-4 mb-4 rounded-lg border border-white/[0.07] bg-black/20 p-3 sm:mx-5">
            <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/40">
              Selected observation position
            </p>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-white">
                {LANDING_SITES.find(
                  (site) => site.id === siteId,
                )?.name}
              </span>

              <span className="text-[9px] text-emerald-300/75">
                LOCATION SELECTED
              </span>
            </div>

            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <p className="font-mono text-[10px] text-white/45">
                LAT: {selectedLocation.coordinate.latitudeDeg.toFixed(6)}°
              </p>

              <p className="font-mono text-[10px] text-white/45">
                LON: {selectedLocation.coordinate.longitudeEastDeg.toFixed(6)}° E
              </p>
            </div>
          </div>

          {/* EXACT-TIME RESULT */}

          <div className="mx-4 mb-4 rounded-lg border border-white/[0.07] bg-black/20 p-4 sm:mx-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/40">
                Selected mission time
              </p>

              <span className="font-mono text-[10px] text-white/60">
                {missionRange
                  ? formatUtcDateTime(missionRange.startMs)
                  : "Invalid time"}
              </span>
            </div>

            <div className="mt-3">
              <h4 className="text-lg font-medium text-white">
                {exactTimeStatus.title}
              </h4>

              <p className="mt-1 text-xs leading-5 text-white/45">
                {exactTimeStatus.description}
              </p>
            </div>

            {/* TARGET CARDS */}

            {!instantLoading &&
              !instantError &&
              activeInstantResult?.jointVisibility && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <TargetCard
                    icon="☀"
                    name="Sun"
                    assessment={sunAssessment}
                    href={sunExplorerHref}
                  />

                  <TargetCard
                    icon="🌍"
                    name="Earth"
                    assessment={earthAssessment}
                    href={earthExplorerHref}
                  />
                </div>
              )}

            {/* TARGET-SPECIFIC VISUALIZATION */}

            {atLeastOneCanExplore && explorerHref && (
              <div
                className={`mt-4 rounded-lg border p-4 ${
                  atLeastOneConfirmed
                    ? "border-emerald-300/20 bg-emerald-300/[0.045]"
                    : "border-amber-200/20 bg-amber-200/[0.035]"
                }`}
              >
                <p
                  className={`text-xs font-medium ${
                    atLeastOneConfirmed
                      ? "text-emerald-100"
                      : "text-amber-100"
                  }`}
                >
                  {bothConfirmed
                    ? "Sun and Earth are ready to explore"
                    : sunCanExplore && earthCanExplore
                      ? "Potential Sun and Earth views are ready to inspect"
                      : sunCanExplore
                        ? sunConfirmed
                          ? "The Sun is ready to explore"
                          : "Potential Sun visibility is ready to inspect"
                        : earthConfirmed
                          ? "Earth is ready to explore"
                          : "Potential Earth visibility is ready to inspect"}
                </p>

                <p className="mt-1 text-[10px] leading-5 text-white/45">
                  Open the 360° surface explorer at your selected landing position and mission time. Unverified targets remain unverified during inspection.
                </p>

                <Link
                  href={explorerHref}
                  className={`mt-4 inline-flex w-full items-center justify-center gap-3 rounded-lg px-5 py-3.5 text-xs font-bold tracking-[0.12em] transition sm:w-auto ${
                    atLeastOneConfirmed
                      ? "bg-emerald-200 text-[#0b1510] hover:bg-emerald-100"
                      : "bg-amber-200 text-[#17130a] hover:bg-amber-100"
                  }`}
                >
                  CHECK 360° VISUALIZATION
                  <span aria-hidden="true">↗</span>
                </Link>
              </div>
            )}

            {/* NOTHING VISIBLE */}

            {!instantLoading &&
              !instantError &&
              activeInstantResult?.jointVisibility &&
              !atLeastOneCanExplore &&
              sunAssessment.state === "blocked" &&
              earthAssessment.state === "blocked" && (
                <p className="mt-4 rounded-lg border border-white/[0.07] bg-white/[0.025] p-3 text-[10px] leading-5 text-white/40">
                  Neither target clears the available sampled terrain horizon. The 360° visualization is unavailable at this mission time.
                </p>
              )}
          </div>

          {/* MISSION INTERVAL */}

          <div className="border-t border-white/[0.07] p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/40">
                  Mission duration
                </p>

                <p className="mt-1 text-xs text-white/65">
                  Potential simultaneous-visibility periods
                </p>
              </div>

              {dailyLoading ? (
                <span className="inline-flex items-center gap-2 text-[9px] text-white/40">
                  <span className="h-2.5 w-2.5 animate-spin rounded-full border border-white/20 border-t-[#c9b98e]" />
                  Searching
                </span>
              ) : dailyError ? (
                <span className="text-[9px] text-red-200">
                  Search unavailable
                </span>
              ) : (
                <span className="text-[9px] text-white/35">
                  {missionDates.length} UTC date
                  {missionDates.length === 1 ? "" : "s"} checked
                </span>
              )}
            </div>

            {dailyError ? (
              <p className="mt-3 rounded-lg border border-red-300/15 bg-red-300/[0.035] p-3 text-xs leading-5 text-red-100/70">
                {dailyError}
              </p>
            ) : dailyLoading ? (
              <p className="mt-3 text-xs leading-5 text-white/45">
                Searching the selected landing position for potential simultaneous visibility.
              </p>
            ) : missionWindows.length > 0 ? (
              <div className="mt-4 space-y-3">
                {missionWindows.slice(0, 3).map(
                  ({ window, date }, index) => (
                    <div
                      key={`${date}-${window.startTimeIso}-${index}`}
                      className="rounded-lg border border-amber-200/15 bg-amber-200/[0.035] p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[9px] font-semibold uppercase tracking-[0.13em] text-amber-200">
                          Potential visibility period
                        </span>

                        <span className="text-[9px] text-white/35">
                          Unverified
                        </span>
                      </div>

                      <p className="mt-2 text-sm font-semibold text-white">
                        {formatUtcDateTime(window.startTimeIso)}
                      </p>

                      <p className="mt-1 text-[10px] text-white/40">
                        Ends {formatUtcDateTime(window.endTimeIso)}
                      </p>
                    </div>
                  ),
                )}

                {missionWindows.length > 3 && (
                  <p className="text-[10px] text-white/35">
                    {missionWindows.length - 3} additional potential periods found.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 rounded-lg border border-white/[0.07] bg-white/[0.025] p-3 text-xs leading-5 text-white/45">
                {dailyLoaded
                  ? "No potential simultaneous-visibility period was detected in the sampled mission interval."
                  : "Waiting for the mission-interval search."}
              </p>
            )}
          </div>

          {/* SCIENTIFIC QUALIFICATION */}

          {!instantLoading &&
            !dailyLoading &&
            !instantError &&
            !dailyError && (
              <div className="border-t border-white/[0.07] px-4 py-3 sm:px-5">
                <p className="text-[9px] leading-5 text-white/35">
                  {terrainComplete
                    ? "The API reports complete terrain-horizon coverage for the checked dates."
                    : "Product 78 terrain coverage is incomplete. Positive terrain-clearance results are provisional and are not treated as confirmed visibility."}
                  {" "}
                  No target is marked available until its complete terrain horizon is verified.
                </p>
              </div>
            )}
        </>
      )}
    </section>
  );
}

/* =========================================================
   MAIN MAP PAGE
========================================================= */

export default function MapPage() {
  const [selectedSite, setSelectedSite] =
    useState<LandingSiteId>(LANDING_SITES[0].id);

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

  /* -------------------------------------------------------
     INITIAL UTC DATE
  ------------------------------------------------------- */

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setMissionDate(new Date().toISOString().slice(0, 10));
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  /* -------------------------------------------------------
     SITE SELECTION
  ------------------------------------------------------- */

  const handleSiteChange = (siteId: LandingSiteId) => {
    setSelectedSite(siteId);
    setLocalLocation(null);
  };

  const handleLocalSelection = (
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
  };

  /* -------------------------------------------------------
     FORMATTING
  ------------------------------------------------------- */

  const formatLatitude = (value: number) =>
    `${Math.abs(value).toFixed(5)}° ${value < 0 ? "S" : "N"}`;

  const formatLongitude = (value: number) =>
    `${value.toFixed(5)}° E`;

  const activeLocalLocation =
    localLocation?.siteId === selectedSite
      ? localLocation
      : null;

  /* -------------------------------------------------------
     EXPLORER + MISSION DATA LINKS
  ------------------------------------------------------- */

  const activeLocation = activeLocalLocation
    ? {
        coordinate: activeLocalLocation.coordinate,
        pixel: activeLocalLocation.pixel,
      }
    : null;

  const generalExplorerHref =
    activeLocation && missionDate
      ? createExplorerHref(
          selectedSite,
          missionDate,
          missionTime,
          activeLocation,
          "both",
        )
      : null;

  const missionDataHref =
    activeLocation && missionDate
      ? createMissionDataHref(
          selectedSite,
          missionDate,
          missionTime,
          activeLocation,
        )
      : null;

  /* =======================================================
     PAGE
  ======================================================= */

  return (
    <main className="min-h-screen bg-[#08090b] text-[#f4f2ed]">
      {/* HEADER */}

      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#08090b]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[1600px] items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3">
            <div className="h-7 w-7 rounded-full border border-[#c8c5ba]/60 bg-gradient-to-br from-[#d8d6cd] to-[#454641]" />

            <span className="text-sm font-semibold tracking-[0.18em]">
              LUNA
              <span className="font-light text-white/45">
                PATH
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-7 text-xs text-white/45 md:flex">
            <a href="#mission" className="hover:text-white">
              Mission planner
            </a>

            <a href="#regional-map" className="hover:text-white">
              Moon Trek
            </a>

            <a href="#local-terrain" className="hover:text-white">
              Local terrain
            </a>

            <a href="#sun-earth-status" className="hover:text-white">
              Sun + Earth
            </a>
          </nav>

          <div className="flex items-center gap-2 text-[10px] tracking-wider text-white/40">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            NASA SPACE APPS
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-5 py-8 sm:px-8">
        {/* PAGE INTRODUCTION */}

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
                Configure a lunar landing scenario and evaluate Sun and Earth visibility at an exact selected landing position.
              </p>
            </div>

            <div className="text-xs text-white/35">
              TARGET REGION · LUNAR SOUTH POLE
            </div>
          </div>
        </section>

        {/* MISSION CONFIGURATION */}

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

          <p className="mt-5 border-t border-white/[0.07] pt-4 text-[10px] leading-5 text-white/35">
            All mission times use UTC. Select a point on the active high-resolution terrain map before visibility analysis begins.
          </p>

          <SunEarthVisibility
            siteId={selectedSite}
            missionDate={missionDate}
            missionTime={missionTime}
            missionDuration={missionDuration}
            localLocation={localLocation}
          />
        </section>

        {/* REGIONAL NAVIGATION */}

        <section
          id="regional-map"
          className="mb-12 space-y-4"
        >
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[#c9b98e]/75">
              01 / Regional navigation
            </p>

            <h2 className="mt-2 text-xl font-medium text-white">
              Explore the lunar South Pole
            </h2>

            <p className="mt-2 max-w-3xl text-xs leading-6 text-white/40">
              NASA Moon Trek regional imagery. Select a location to inspect its lunar coordinates. Regional selection does not replace the high-resolution landing-position selection below.
            </p>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#0d0f11] p-3 sm:p-5">
            <MoonTrekMap
              onLocationSelect={(coordinate) =>
                setRegionalCoordinate(coordinate)
              }
            />
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.025] p-5">
            <p className="text-[10px] tracking-[0.18em] text-white/35">
              REGIONAL MAP SELECTION
            </p>

            {regionalCoordinate ? (
              <div className="mt-3 flex flex-wrap gap-8">
                <div>
                  <p className="text-[10px] text-white/35">
                    LATITUDE
                  </p>

                  <p className="mt-1 font-mono text-sm">
                    {formatLatitude(regionalCoordinate.latitudeDeg)}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] text-white/35">
                    LONGITUDE
                  </p>

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

        {/* HIGH-RESOLUTION TERRAIN */}

        <section
          id="local-terrain"
          className="space-y-5"
        >
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[#c9b98e]/75">
              02 / High-resolution terrain
            </p>

            <h2 className="mt-2 text-xl font-medium text-white">
              Select your exact landing position
            </h2>

            <p className="mt-2 max-w-3xl text-xs leading-6 text-white/40">
              Select a site, then click directly inside its NASA Product 78 terrain map. Visibility analysis requires a selected position from this map.
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
                      handleLocalSelection(
                        site.id,
                        coordinate,
                        pixel,
                      )
                    }
                  />
                </article>
              );
            })}
          </div>

          {/* LOCAL SELECTION */}

          <div className="rounded-xl border border-white/10 bg-white/[0.025] p-5">
            <p className="text-[10px] tracking-[0.18em] text-white/35">
              PRODUCT 78 LOCAL SELECTION
            </p>

            {activeLocalLocation ? (
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
                    <p className="text-[10px] text-white/35">
                      LATITUDE
                    </p>

                    <p className="mt-1 font-mono text-sm">
                      {formatLatitude(
                        activeLocalLocation.coordinate.latitudeDeg,
                      )}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] text-white/35">
                      LONGITUDE
                    </p>

                    <p className="mt-1 font-mono text-sm">
                      {formatLongitude(
                        activeLocalLocation.coordinate.longitudeEastDeg,
                      )}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] text-white/35">
                      RASTER PIXEL
                    </p>

                    <p className="mt-1 font-mono text-sm">
                      {activeLocalLocation.pixel.column.toFixed(2)}
                      {", "}
                      {activeLocalLocation.pixel.row.toFixed(2)}
                    </p>
                  </div>
                </div>

                <div className="mt-6 border-t border-white/[0.08] pt-5">
                  <p className="mb-4 text-xs leading-5 text-white/40">
                    This exact Product 78 location is used for the Sun and Earth analysis. Changing the landing site clears this selection and requires a new map click.
                  </p>

                  <div className="flex flex-wrap gap-3">
                    {generalExplorerHref && (
                      <Link
                        href={generalExplorerHref}
                        className="inline-flex items-center gap-4 border border-white/20 bg-white/[0.04] px-5 py-4 text-[10px] tracking-[0.18em] text-white/80 transition hover:border-white/50 hover:bg-white/[0.08]"
                      >
                        OPEN 360° SURFACE EXPLORER
                        <span aria-hidden="true">↗</span>
                      </Link>
                    )}

                    {missionDataHref && (
                      <Link
                        href={missionDataHref}
                        className="inline-flex items-center gap-4 border border-[#d6c18e]/35 bg-[#d6c18e]/[0.06] px-5 py-4 text-[10px] tracking-[0.18em] text-[#e4d3a9] transition hover:border-[#d6c18e]/65 hover:bg-[#d6c18e]/[0.11]"
                      >
                        OPEN MISSION DATA
                        <span aria-hidden="true">↗</span>
                      </Link>
                    )}
                  </div>

                  {!missionDataHref && (
                    <p className="mt-3 text-[10px] text-amber-200/70">
                      Mission Data navigation is unavailable until the selected coordinates, raster pixel and UTC mission time are valid.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="mt-3">
                <p className="text-sm leading-6 text-white/40">
                  No landing position selected for {activeSite.name}.
                </p>

                <p className="mt-2 text-[10px] leading-5 text-[#d9c89d]/70">
                  Click anywhere inside the active Product 78 terrain map above to select your observer position and unlock the visibility analysis.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* FOOTER */}

        <section className="mt-8 flex flex-wrap justify-between gap-3 border-t border-white/[0.07] pt-5 text-[10px] text-white/30">
          <span>SITE: {selectedSite}</span>

          <span>
            {activeLocalLocation
              ? "LANDING POSITION: SELECTED"
              : "LANDING POSITION: NOT SELECTED"}
          </span>

          <span>
            MISSION START: {missionDate || "NOT SET"} {missionTime} UTC
          </span>

          <span>DURATION: {missionDuration} HOURS</span>
        </section>
      </div>
    </main>
  );
}