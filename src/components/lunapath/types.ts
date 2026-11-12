export type ApiStatus = "complete" | "partial";

export type HorizonDirection = {
  azimuthDeg: number;
  horizonElevationDeg: number;
  distanceMeters: number;
  terrainElevationMeters: number;
  horizonSource: "product78" | "product90";
  horizonResolutionMeters: number;
  samplesChecked: number;
  product78SamplesChecked: number;
  product90SamplesChecked: number;
  terminationReason: "search_limit" | "product90_boundary" | "product90_nodata" | string;
};

export type TerrainVisibility = {
  terrainHorizonElevationDeg: number;
  clearanceDeg: number;
  blockedBySampledTerrain: boolean;
  assessment: "blocked_by_sampled_terrain" | "above_sampled_terrain_unconfirmed";
  angularDiameterArcsec: number | null;
  semiDiameterDeg: number | null;
  upperLimbClearanceDeg: number | null;
  lowerLimbClearanceDeg: number | null;
  limbAssessment: string;
  terrainCoverageComplete: false;
};

export type CelestialObservation = {
  time: string;
  timeUtc: string;
  azimuthDeg: number;
  elevationDeg: number;
  angularDiameterArcsec: number | null;
  horizonsMarker: string | null;
  terrainVisibility?: TerrainVisibility;
};

export type VisibilityWindow = {
  state: string;
  startTimeUtc: string;
  endTimeUtc: string;
  durationMinutes: number;
  observationCount: number;
  startClearanceDeg: number;
  endClearanceDeg: number;
};

export type CelestialTarget = {
  targetId?: string;
  available?: boolean;
  error?: string;
  observations?: CelestialObservation[];
  visibilityWindows?: VisibilityWindow[];
  limbVisibilityWindows?: VisibilityWindow[];
  parsing?: {
    totalParsed: number;
    expectedObservations: number;
    totalUnparsed: number;
    missingObservations: number;
    unexpectedExtraObservations: number;
    isComplete: boolean;
  };
  raw?: unknown;
};

export type TerrainModel = {
  source: string;
  cache: string;
  sources: {
    local: { name: string; resolutionMeters: number };
    regional: { name: string; resolutionMeters: number };
  };
  referenceFrame: string;
  ephemeris: string;
  observerElevationMeters: number | null;
  sampleStepMeters: number;
  regionalSampleStepMeters: number;
  directionCount: number;
  directionSpacingDegrees: number;
  totalSamplesChecked: number;
  product78SamplesChecked: number;
  product90SamplesChecked: number;
  rasterBoundaryLimitedDirections: number;
  product90CoverageBoundaryLimitedDirections: number;
  product90NoDataTerminatedDirections: number;
  searchLimitReachedDirections: number;
  completeHorizonVerified: false;
  horizonProfile: HorizonDirection[];
};

export type HorizonsResponse = {
  success: boolean;
  status?: ApiStatus;
  partial?: boolean;
  error?: string;
  source?: string[];
  observer?: {
    name: string;
    longitudeEast: number;
    latitude: number;
    altitudeKm: number;
    elevationMeters: number | null;
    elevationSource: string;
    altitudeQuality: string;
  };
  timeRange?: {
    start: string;
    stop: string;
    timeScale: string;
    interval: string;
    expectedObservationsPerTarget: number;
  };
  targetStatus?: {
    sun: string;
    earth: string;
    terrain: string;
  };
  targetErrors?: {
    sun: string | null;
    earth: string | null;
  };
  targets?: {
    sun: CelestialTarget;
    earth: CelestialTarget;
  };
  terrainAnalysis?: {
    status: string;
    cache: string;
    error: string | null;
  };
  terrainModel?: TerrainModel | null;
  coordinateConvention?: Record<string, unknown>;
  quantities?: Record<string, unknown>;
  interpretation?: Record<string, unknown>;
  notes?: string[];
};

export function normalizeAzimuth(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function formatUtcTime(value: string, options?: Intl.DateTimeFormatOptions): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  }).format(date);
}

export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "—";
  const hours = Math.floor(minutes / 60);
  const remaining = Math.round(minutes % 60);
  if (hours === 0) return `${remaining} min`;
  if (remaining === 0) return `${hours} hr`;
  return `${hours} hr ${remaining} min`;
}

export function getWindowLabel(state: string): string {
  if (state === "blocked_by_sampled_terrain") return "Blocked by sampled terrain";
  if (state === "above_sampled_terrain_unconfirmed") return "Above sampled terrain · unconfirmed";
  if (state === "target_disk_below_sampled_terrain") return "Disk below sampled terrain";
  if (state === "target_disk_intersects_sampled_terrain") return "Disk intersects sampled terrain";
  if (state === "target_disk_above_sampled_terrain_unconfirmed") return "Disk above sampled terrain · unconfirmed";
  return state.replaceAll("_", " ");
}
