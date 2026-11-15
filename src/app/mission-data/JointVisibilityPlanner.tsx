
"use client";

import { useEffect, useState } from "react";

import type { Product78SiteId } from "@/components/lib/lunar/siteRegistry";

/* =========================================================
   TYPES
========================================================= */

type AnalysisStatus =
  | "verified_joint_visibility_found"
  | "provisional_joint_visibility_found"
  | "no_joint_visibility_found"
  | "no_matching_observations"
  | "joint_visibility_found";

interface VisibilityWindow {
  startTimeIso: string;
  endTimeIso: string;
  startTimeUtc: string;
  endTimeUtc: string;
  durationMinutes: number;
  sampleCount: number;
  bestTimeIso: string;
  bestTimeUtc: string;
  bestSunClearanceDeg: number;
  bestEarthClearanceDeg: number;
  bestJointClearanceDeg: number;
}

interface VisibilityCandidate {
  timeIso: string;
  timeUtc: string;
  sunClearanceDeg: number;
  earthClearanceDeg: number;
  jointClearanceDeg: number;
}

interface TerrainConfidence {
  level?: "verified" | "incomplete";
  terrainCoverageComplete?: boolean;
  interpretation?: string;
  limitation?: string;
}

interface DayAvailability {
  date: string;
  timeScale: string;
  samplingIntervalMinutes: number;

  status: AnalysisStatus;

  criterion: string;

  sampleCount: number;
  matchedObservationCount?: number;

  candidateSampleCount?: number;
  availableSampleCount: number;

  candidateWindowCount?: number;
  verifiedWindowCount?: number;
  windowCount: number;

  candidateRecommendation?: VisibilityCandidate | null;
  recommendation: VisibilityCandidate | null;

  candidateWindows?: VisibilityWindow[];
  verifiedWindows?: VisibilityWindow[];

  windows: VisibilityWindow[];

  closestApproach: VisibilityCandidate | null;

  boundaryResolution: string;
  visibilityQualification: string;

  terrainConfidence?: TerrainConfidence;
  terrainCoverageComplete: boolean;
}

interface DayAvailabilityResponse {
  success: boolean;
  mode?: string;

  site?: {
    id: string;
    displayName: string;
  };

  terrainModel?: {
    product?: string;
    resolutionMeters?: number;
    sampleStepMeters?: number;
    maxDistanceMeters?: number;
    completeHorizonVerified?: boolean;
    coverageStatus?: string;
    coverageExplanation?: string;
  };

  availability?: DayAvailability;
  error?: string;
}

/* =========================================================
   FORMATTERS
========================================================= */

function formatUtcTime(value: string): string {
  const match = value.match(
    /^(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );

  if (!match) return value;

  const hour = Number(match[1]);
  const minute = match[2];
  const second = match[3];

  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;

  return `${hour12}:${minute}${
    second ? `:${second}` : ""
  } ${period}`;
}

function formatClearance(value: number): string {
  if (!Number.isFinite(value)) {
    return "Unavailable";
  }

  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(4)}°`;
}

function formatNumber(
  value: number | undefined,
): string {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return "Unavailable";
  }

  return value.toLocaleString("en-US");
}

/* =========================================================
   SHARED UI
========================================================= */

function PlannerMetric({
  label,
  value,
  description,
}: {
  label: string;
  value: string | number;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-black/25 p-4">
      <p className="text-[9px] uppercase tracking-[0.15em] text-white/40">
        {label}
      </p>

      <p className="mt-2 text-2xl font-semibold text-white">
        {value}
      </p>

      <p className="mt-1 text-[9px] leading-4 text-white/30">
        {description}
      </p>
    </div>
  );
}

function ClearanceMetric({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-[9px] text-white/35">
        {label}
      </p>

      <p
        className={`mt-1 text-sm font-semibold ${
          highlight
            ? "text-emerald-200"
            : "text-white/80"
        }`}
      >
        {formatClearance(value)}
      </p>
    </div>
  );
}

/* =========================================================
   COMPONENT
========================================================= */

export default function JointVisibilityPlanner({
  date,
  siteId,
  latitude,
  longitude,
  pixelColumn,
  pixelRow,
  onUseTime,
}: {
  date: string;
  siteId: Product78SiteId;
  latitude: string | null;
  longitude: string | null;
  pixelColumn: string | null;
  pixelRow: string | null;
  onUseTime: (timeUtc: string) => void;
}) {
  const [data, setData] =
    useState<DayAvailabilityResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* =======================================================
     FETCH FULL-DAY AVAILABILITY
  ======================================================= */

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    async function loadDayAvailability() {
      setLoading(true);
      setError(null);
      setData(null);

      try {
        const query = new URLSearchParams({
          mode: "joint-visibility-day",
          siteId,
          date,
        });

        function appendParameter(
          name: string,
          value: string | null,
        ) {
          if (
            value === null ||
            value.trim() === "" ||
            value === "undefined" ||
            value === "null"
          ) {
            return;
          }

          query.set(name, value);
        }

        appendParameter("lat", latitude);
        appendParameter("lon", longitude);
        appendParameter("pixelColumn", pixelColumn);
        appendParameter("pixelRow", pixelRow);

        const response = await fetch(
          `/api/horizons/selected-location?${query.toString()}`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          },
        );

        const result =
          (await response.json()) as DayAvailabilityResponse;

        if (!response.ok || !result.success) {
          throw new Error(
            result.error ||
              `Full-day analysis failed with HTTP ${response.status}.`,
          );
        }

        if (!result.availability) {
          throw new Error(
            "The API returned no daily availability analysis.",
          );
        }

        if (
          result.mode !== "joint-visibility-day" ||
          result.availability.date !== date
        ) {
          throw new Error(
            "The API returned an unexpected visibility analysis for this request.",
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
            : "Unable to calculate joint visibility.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadDayAvailability();

    return () => controller.abort();
  }, [
    date,
    siteId,
    latitude,
    longitude,
    pixelColumn,
    pixelRow,
  ]);

  /* =======================================================
     DERIVED ANALYSIS
  ======================================================= */

  const availability = data?.availability;
  const terrainModel = data?.terrainModel;

  const candidateWindows =
    availability?.candidateWindows ?? [];

  const verifiedWindows =
    availability?.verifiedWindows ??
    availability?.windows ??
    [];

  const candidateRecommendation =
    availability?.candidateRecommendation ?? null;

  const recommendation =
    availability?.recommendation ?? null;

  const closestApproach =
    availability?.closestApproach ?? null;

  const terrainCoverageComplete =
    availability?.terrainCoverageComplete === true &&
    terrainModel?.completeHorizonVerified === true &&
    availability?.terrainConfidence?.level === "verified";

  const hasVerifiedRecommendation =
    terrainCoverageComplete &&
    recommendation !== null;

  const hasNoMatchingObservations =
    availability?.status === "no_matching_observations";

  const matchedObservationCount =
    availability?.matchedObservationCount ??
    availability?.sampleCount ??
    0;

  const candidateSampleCount =
    availability?.candidateSampleCount ??
    availability?.availableSampleCount ??
    0;

  const verifiedWindowCount =
    availability?.verifiedWindowCount ??
    verifiedWindows.length;

  /* =======================================================
     UI
  ======================================================= */

  return (
    <section className="mb-10">
      <div className="overflow-hidden rounded-2xl border border-[#c9b98e]/20 bg-[#0d0e10] shadow-[0_18px_55px_rgba(0,0,0,0.2)]">

        {/* HEADER */}

        <div className="flex flex-col justify-between gap-4 border-b border-white/[0.07] p-5 sm:flex-row sm:items-center sm:p-6">
          <div>
            <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.2em] text-[#c9b98e]/75">
              <span className="h-1.5 w-1.5 rounded-full bg-[#c9b98e]" />
              Joint celestial visibility
            </div>

            <h2 className="mt-3 text-xl font-medium tracking-tight text-white">
              Find when both are visible
            </h2>

            <p className="mt-2 max-w-2xl text-xs leading-6 text-white/40">
              Full-day analysis of simultaneous Sun and Earth
              visibility against the available local lunar terrain.
              Candidate results are separated from verified results.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/[0.035] px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.13em] text-white/60 sm:self-center">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
            {availability?.samplingIntervalMinutes ?? 1}-minute sampling
          </div>
        </div>

        <div className="p-5 sm:p-6">

          {/* LOADING */}

          {loading && (
            <div className="flex items-center gap-4 rounded-xl border border-white/[0.07] bg-black/20 p-5">
              <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-white/15 border-t-[#c9b98e]" />

              <div>
                <p className="text-sm font-medium text-white/80">
                  Analysing the selected lunar day
                </p>

                <p className="mt-1 text-[10px] leading-5 text-white/40">
                  Requesting Sun and Earth ephemerides from JPL
                  Horizons and evaluating both against Product 78
                  terrain.
                </p>
              </div>
            </div>
          )}

          {/* ERROR */}

          {error && !loading && (
            <div className="rounded-xl border border-red-300/15 bg-red-300/[0.035] p-4">
              <p className="text-xs font-semibold text-red-200">
                Daily visibility analysis failed
              </p>

              <p className="mt-2 break-words text-xs leading-5 text-red-100/60">
                {error}
              </p>
            </div>
          )}

          {/* NO ANALYSIS YET */}

          {!loading && !error && !availability && (
            <p className="text-xs text-white/40">
              Select a valid mission date to calculate daily
              joint visibility.
            </p>
          )}

          {/* SUCCESSFUL ANALYSIS */}

          {!loading && !error && availability && (
            <>
              {/* SUMMARY */}

              <div className="grid gap-3 sm:grid-cols-3">
                <PlannerMetric
                  label="Matched observations"
                  value={formatNumber(matchedObservationCount)}
                  description="Epochs with both Sun and Earth observations and valid clearances"
                />

                <PlannerMetric
                  label="Provisional candidates"
                  value={formatNumber(candidateSampleCount)}
                  description="Samples where both apparent disks clear sampled terrain"
                />

                <PlannerMetric
                  label="Verified windows"
                  value={formatNumber(verifiedWindowCount)}
                  description="Windows meeting the terrain coverage requirement"
                />
              </div>

              {/* VERIFIED RECOMMENDATION */}

              {hasVerifiedRecommendation && recommendation && (
                <div className="mt-5 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.035] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-emerald-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                        Verified terrain visibility recommendation
                      </div>

                      <p className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                        {formatUtcTime(recommendation.timeUtc)}
                      </p>

                      <p className="mt-2 text-[10px] text-white/40">
                        {date} · UTC
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        onUseTime(recommendation.timeUtc)
                      }
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#e8e5dc] px-5 text-xs font-semibold text-[#141414] transition hover:bg-white"
                    >
                      Use this time
                      <span aria-hidden="true">↗</span>
                    </button>
                  </div>

                  <div className="mt-5 grid gap-3 border-t border-emerald-200/10 pt-4 sm:grid-cols-3">
                    <ClearanceMetric
                      label="Sun lower-limb clearance"
                      value={recommendation.sunClearanceDeg}
                    />

                    <ClearanceMetric
                      label="Earth lower-limb clearance"
                      value={recommendation.earthClearanceDeg}
                    />

                    <ClearanceMetric
                      label="Limiting clearance"
                      value={recommendation.jointClearanceDeg}
                      highlight
                    />
                  </div>

                  <p className="mt-4 text-[10px] leading-5 text-white/40">
                    This is a terrain visibility result only.
                    It does not independently establish solar power
                    availability, communication link performance,
                    or overall mission safety.
                  </p>
                </div>
              )}

              {/* PROVISIONAL CANDIDATE RECOMMENDATION */}

              {!hasVerifiedRecommendation &&
                candidateRecommendation && (
                  <div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/[0.035] p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-amber-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                          Provisional visibility candidate
                        </div>

                        <p className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                          {formatUtcTime(candidateRecommendation.timeUtc)}
                        </p>

                        <p className="mt-2 text-[10px] text-white/40">
                          {date} · UTC
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          onUseTime(candidateRecommendation.timeUtc)
                        }
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-amber-200/25 bg-amber-200/[0.08] px-5 text-xs font-semibold text-amber-100 transition hover:bg-amber-200/[0.14]"
                      >
                        Inspect candidate time
                        <span aria-hidden="true">↗</span>
                      </button>
                    </div>

                    <div className="mt-5 grid gap-3 border-t border-amber-200/10 pt-4 sm:grid-cols-3">
                      <ClearanceMetric
                        label="Sun lower-limb clearance"
                        value={candidateRecommendation.sunClearanceDeg}
                      />

                      <ClearanceMetric
                        label="Earth lower-limb clearance"
                        value={candidateRecommendation.earthClearanceDeg}
                      />

                      <ClearanceMetric
                        label="Limiting clearance"
                        value={candidateRecommendation.jointClearanceDeg}
                      />
                    </div>

                    <p className="mt-4 text-[10px] leading-5 text-amber-100/65">
                      This is the strongest candidate found within
                      the sampled terrain model. It is not a verified
                      visibility window because the available raster
                      does not cover the complete terrain horizon.
                      Inspect it for analysis, not as an operational
                      mission recommendation.
                    </p>
                  </div>
                )}

              {/* NO CANDIDATE */}

              {!hasVerifiedRecommendation &&
                !candidateRecommendation && (
                  <div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/[0.035] p-5">
                    <p className="text-sm font-semibold text-amber-200">
                      {hasNoMatchingObservations
                        ? "No matching observations available"
                        : "No simultaneous candidate found"}
                    </p>

                    <p className="mt-2 text-xs leading-6 text-white/55">
                      {hasNoMatchingObservations
                        ? "The analysis could not obtain matching Sun and Earth observations for this date. No visibility conclusion can be drawn."
                        : "No sampled minute was found when both apparent lower limbs cleared the sampled local terrain horizon. This does not prove that simultaneous visibility is physically impossible."}
                    </p>

                    {closestApproach && (
                      <div className="mt-5 border-t border-amber-200/10 pt-4">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/40">
                          Closest sampled approach — not an available time
                        </p>

                        <p className="mt-2 text-2xl font-semibold text-white">
                          {formatUtcTime(closestApproach.timeUtc)}
                        </p>

                        <div className="mt-3 grid gap-3 sm:grid-cols-3">
                          <ClearanceMetric
                            label="Sun clearance"
                            value={closestApproach.sunClearanceDeg}
                          />

                          <ClearanceMetric
                            label="Earth clearance"
                            value={closestApproach.earthClearanceDeg}
                          />

                          <ClearanceMetric
                            label="Limiting clearance"
                            value={closestApproach.jointClearanceDeg}
                          />
                        </div>

                        <p className="mt-3 text-[10px] leading-5 text-white/35">
                          The limiting clearance is the smaller of
                          the Sun and Earth clearances. A negative
                          value means at least one apparent disk
                          falls below or intersects the sampled
                          terrain horizon.
                        </p>
                      </div>
                    )}
                  </div>
                )}

              {/* PROVISIONAL CANDIDATE WINDOWS */}

              {candidateWindows.length > 0 && (
                <div className="mt-7">
                  <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-amber-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                        Provisional results
                      </div>

                      <h3 className="mt-2 text-base font-medium text-white">
                        Candidate visibility periods
                      </h3>

                      <p className="mt-1 max-w-xl text-[10px] leading-5 text-white/40">
                        These periods pass the sampled terrain
                        clearance test but have not passed complete
                        terrain-horizon verification.
                      </p>
                    </div>

                    <p className="text-[9px] text-white/30">
                      All times UTC
                    </p>
                  </div>

                  <div className="space-y-3">
                    {candidateWindows.map((window, index) => (
                      <div
                        key={`${window.startTimeIso}-${index}`}
                        className="rounded-xl border border-amber-200/15 bg-black/25 p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-[9px] uppercase tracking-[0.14em] text-amber-200/70">
                              Candidate period {index + 1}
                            </p>

                            <p className="mt-2 text-base font-semibold text-white">
                              {formatUtcTime(window.startTimeUtc)}
                              <span className="mx-2 text-white/25">
                                →
                              </span>
                              {formatUtcTime(window.endTimeUtc)}
                            </p>

                            <p className="mt-1 text-[10px] text-white/35">
                              Approximately {window.durationMinutes} minutes
                              · {window.sampleCount} samples
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              onUseTime(window.bestTimeUtc)
                            }
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-amber-200/20 bg-amber-200/[0.06] px-3 text-[10px] font-medium text-amber-100 transition hover:bg-amber-200/[0.12]"
                          >
                            Inspect candidate
                            <span aria-hidden="true">↗</span>
                          </button>
                        </div>

                        <div className="mt-4 grid gap-3 border-t border-white/[0.06] pt-4 sm:grid-cols-3">
                          <div>
                            <p className="text-[9px] text-white/35">
                              Best candidate time
                            </p>

                            <p className="mt-1 text-sm font-medium text-white">
                              {formatUtcTime(window.bestTimeUtc)}
                            </p>
                          </div>

                          <ClearanceMetric
                            label="Sun clearance"
                            value={window.bestSunClearanceDeg}
                          />

                          <ClearanceMetric
                            label="Earth clearance"
                            value={window.bestEarthClearanceDeg}
                          />
                        </div>

                        <div className="mt-3 border-t border-white/[0.05] pt-3">
                          <ClearanceMetric
                            label="Limiting joint clearance"
                            value={window.bestJointClearanceDeg}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* VERIFIED WINDOWS */}

              {verifiedWindows.length > 0 &&
                terrainCoverageComplete && (
                  <div className="mt-7">
                    <div className="mb-4">
                      <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-emerald-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                        Verified terrain visibility
                      </div>

                      <h3 className="mt-2 text-base font-medium text-white">
                        Verified visibility windows
                      </h3>
                    </div>

                    <div className="space-y-3">
                      {verifiedWindows.map((window, index) => (
                        <div
                          key={`${window.startTimeIso}-${index}`}
                          className="rounded-xl border border-emerald-200/15 bg-black/25 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-[9px] uppercase tracking-[0.14em] text-emerald-200/70">
                                Verified window {index + 1}
                              </p>

                              <p className="mt-2 text-base font-semibold text-white">
                                {formatUtcTime(window.startTimeUtc)}
                                <span className="mx-2 text-white/25">
                                  →
                                </span>
                                {formatUtcTime(window.endTimeUtc)}
                              </p>

                              <p className="mt-1 text-[10px] text-white/35">
                                Approximately {window.durationMinutes} minutes
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                onUseTime(window.bestTimeUtc)
                              }
                              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-emerald-200/20 bg-emerald-200/[0.06] px-3 text-[10px] font-medium text-emerald-100 transition hover:bg-emerald-200/[0.12]"
                            >
                              Use best time
                              <span aria-hidden="true">↗</span>
                            </button>
                          </div>

                          <div className="mt-4 grid gap-3 border-t border-white/[0.06] pt-4 sm:grid-cols-3">
                            <div>
                              <p className="text-[9px] text-white/35">
                                Best time
                              </p>

                              <p className="mt-1 text-sm font-medium text-white">
                                {formatUtcTime(window.bestTimeUtc)}
                              </p>
                            </div>

                            <ClearanceMetric
                              label="Sun clearance"
                              value={window.bestSunClearanceDeg}
                            />

                            <ClearanceMetric
                              label="Earth clearance"
                              value={window.bestEarthClearanceDeg}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/* TERRAIN COVERAGE QUALIFICATION */}

              <div
                className={`mt-5 rounded-xl border p-4 ${
                  terrainCoverageComplete
                    ? "border-emerald-300/15 bg-emerald-300/[0.025]"
                    : "border-amber-300/20 bg-amber-300/[0.035]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      terrainCoverageComplete
                        ? "bg-emerald-300"
                        : "bg-amber-300"
                    }`}
                  />

                  <p
                    className={`text-[9px] font-semibold uppercase tracking-[0.15em] ${
                      terrainCoverageComplete
                        ? "text-emerald-200/80"
                        : "text-amber-200"
                    }`}
                  >
                    {terrainCoverageComplete
                      ? "Terrain coverage verified"
                      : "Incomplete terrain coverage"}
                  </p>
                </div>

                <p className="mt-2 text-[10px] leading-5 text-white/55">
                  {availability.terrainConfidence?.interpretation ??
                    terrainModel?.coverageExplanation ??
                    (terrainCoverageComplete
                      ? "The terrain horizon coverage was reported as complete."
                      : "The Product 78 raster does not establish a complete terrain horizon in every direction. Visibility candidates apply only to the sampled terrain.")}
                </p>

                {!terrainCoverageComplete && (
                  <p className="mt-2 text-[10px] leading-5 text-amber-100/55">
                    {availability.terrainConfidence?.limitation ??
                      "Terrain outside the available raster may obstruct the Sun or Earth. Candidate windows are not confirmed mission visibility windows."}
                  </p>
                )}
              </div>

              {/* SCIENTIFIC QUALIFICATION */}

              <div className="mt-6 rounded-xl border border-white/[0.07] bg-black/20 p-4">
                <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/55">
                  Scientific qualification
                </p>

                <p className="mt-2 text-[10px] leading-5 text-white/45">
                  {availability.visibilityQualification}
                </p>

                <p className="mt-2 text-[10px] leading-5 text-white/35">
                  {availability.boundaryResolution}
                </p>

                <p className="mt-2 text-[10px] leading-5 text-white/35">
                  Sampling interval:{" "}
                  {availability.samplingIntervalMinutes} minute(s).
                  Window boundaries are estimates at the temporal
                  resolution of the daily sampling.
                </p>

                <p className="mt-2 text-[10px] leading-5 text-white/35">
                  This analysis evaluates geometric apparent-disk
                  clearance against the sampled terrain horizon.
                  It does not calculate solar array output, antenna
                  link budget, signal strength, thermal constraints,
                  or overall landing safety.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
