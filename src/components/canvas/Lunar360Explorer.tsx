
"use client";

import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";

import {
  Canvas,
  useFrame,
} from "@react-three/fiber";

import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

import {
  geographicToLolaProjected,
  projectedToLolaPixel,
  loadLolaTerrainForSite,
  sampleLolaHeightAtPixel,
  type LolaTerrainData,
} from "@/components/lib/lunar/terrainData";

import type {
  Product78SiteId,
} from "@/components/lib/lunar/siteRegistry";

/* =====================================================
   TYPES
===================================================== */
interface HorizonProfileDirection {
  azimuthDeg: number;

  horizonElevationDeg: number | null;
  distanceMeters: number | null;
  terrainElevationMeters: number | null;

  horizonSource: "product78" | "product90" | null;
  horizonResolutionMeters: number | null;

  lastKnownSampleDistanceMeters: number | null;
  coverageStatus: "partial" | "no_data";
  terrainBeyondKnownCoverageUnknown: true;

  samplesChecked: number;
  product78SamplesChecked: number;
  product90SamplesChecked: number;

  terminationReason:
    | "search_limit"
    | "product78_boundary"
    | "product78_nodata"
    | "product90_boundary"
    | "product90_nodata";

  coverageLimited: true;
}
interface Lunar360ExplorerProps {
  siteId: Product78SiteId;
  latitude: number;
  longitude: number;
  pixelColumn: number;
  pixelRow: number;
  missionDate: string;
  missionTime: string;
  durationHours: string;
}

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
  timeUtc: string;
  azimuthDeg: number;
  elevationDeg: number;
  angularDiameterArcsec: number | null;
  terrainVisibility: TerrainVisibility;
}

interface HorizonsTarget extends HorizonsObservation {
  observations?: HorizonsObservation[];
  visibilityWindows?: Array<{
    state: TerrainVisibilityStatus;
    startTimeUtc: string;
    endTimeUtc: string;
    durationMinutes: number;
    observationCount: number;
  }>;
}

interface HorizonsResponse {
  success: boolean;
  status?: "complete" | "partial" | "unavailable";
  targetErrors?: {
    sun?: string | null;
    earth?: string | null;
  };
  terrainError?: string | null;

  site?: {
    id: string;
    archiveSite: string;
    displayName: string;
    dataDirectory: string;
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
    sun?: HorizonsTarget;
    earth?: HorizonsTarget;
  };

  horizonProfile?: HorizonProfileDirection[];

  mission?: {
    date: string;
    time: string;
    durationHours: number;
    sampleIntervalMinutes: number;
    startTime: string;
    stopTime: string;
  };

  terrainModel?: {
    product: string;
    siteId: string;
    siteName: string;
    resolutionMeters: number;
    sampleStepMeters: number;
    maxDistanceMeters: number;
    completeHorizonVerified: boolean;
  };

  sources?: {
    ephemeris: string;
    localTerrain: string;
    regionalTerrain: string;
  };

  error?: string;
}

interface LookState {
  yaw: number;
  pitch: number;
  targetYaw: number;
  targetPitch: number;
}

interface ScienceSample {
  success: boolean;
  available: boolean;
  pixel?: { column: number; row: number };
  resolutionMeters?: number;
  values?: {
    elevationMeters: number;
    elevationUncertaintyMeters: number;
    slopeDegrees: number;
    slopeUncertaintyDegrees: number;
    observationCount: number;
  };
  reason?: string;
  error?: string;
}

/* =====================================================
   SCENE CONSTANTS
===================================================== */

const TERRAIN_RADIUS_PIXELS = 500;
const REGIONAL_SAMPLE_STEP_PIXELS = 6;
const IMAGERY_HALF_SPAN_METERS = 12_000;

const OBSERVER_HEIGHT_METERS = 1.7;
const LUNAR_RADIUS_METERS = 1_737_400;

const CELESTIAL_DISTANCE = 8000;


const CELESTIAL_VISUAL_SCALE = 1;

const STAR_COUNT = 9000;
const STAR_RADIUS = 12000;

const LUNAR_REGOLITH_COLOR = "#777777";

/* =====================================================
   GENERAL HELPERS
===================================================== */

function clamp(
  value: number,
  min: number,
  max: number
): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeAzimuth(value: number): number {
  return ((value % 360) + 360) % 360;
}

function getNearestHorizonDirection(
  profile: HorizonProfileDirection[] | undefined,
  azimuthDeg: number
): HorizonProfileDirection | null {
  if (!profile?.length) return null;
  const azimuth = normalizeAzimuth(azimuthDeg);
  return profile.reduce((nearest, current) => {
    const currentDelta = Math.abs(
      ((current.azimuthDeg - azimuth + 540) % 360) - 180
    );
    const nearestDelta = Math.abs(
      ((nearest.azimuthDeg - azimuth + 540) % 360) - 180
    );
    return currentDelta < nearestDelta ? current : nearest;
  });
}

function buildHorizonPaths(
  profile: HorizonProfileDirection[] | undefined
): string[] {
  if (!profile?.length) return [];
  const sorted = [...profile].sort((a, b) => a.azimuthDeg - b.azimuthDeg);
  const paths: string[] = [];
  let current: string[] = [];

  const finishSegment = () => {
    if (current.length >= 2) paths.push(current.join(" "));
    current = [];
  };

  for (const direction of sorted) {
    const elevation = direction.horizonElevationDeg;
    if (
      direction.coverageStatus === "no_data" ||
      typeof elevation !== "number" ||
      !Number.isFinite(elevation)
    ) {
      finishSegment();
      continue;
    }

    const x = 10 + (normalizeAzimuth(direction.azimuthDeg) / 360) * 300;
    const y = 82 - clamp((elevation + 10) / 45, 0, 1) * 64;
    current.push(`${current.length === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  }

  finishSegment();
  return paths;
}

function getFirstObservation(
  target?: HorizonsObservation | null
): HorizonsObservation | null {
  if (
    !target ||
    !Number.isFinite(target.azimuthDeg) ||
    !Number.isFinite(target.elevationDeg)
  ) {
    return null;
  }

  return target;
}

function getAngularRadiusDeg(
  observation: HorizonsObservation | null
): number | null {
  const diameter = observation?.angularDiameterArcsec;

  if (
    diameter === null ||
    diameter === undefined ||
    !Number.isFinite(diameter) ||
    diameter <= 0
  ) {
    return null;
  }

  return diameter / 7200;
}

function canRenderCelestialDisk(
  observation: HorizonsObservation | null
): boolean {
  if (!observation) {
    return false;
  }

  const visibility = observation.terrainVisibility;

  if (!visibility) {
    return false;
  }

  // A missing horizon must not erase a real JPL position. Render that
  // marker with a subdued opacity and label its terrain occlusion unknown.
  if (
    visibility.status !== "terrain_horizon_unavailable" &&
    visibility.targetDiskVisible !== true
  ) {
    return false;
  }

  // Never invent a disk size. A target below sampled terrain is still hidden.
  const angularRadiusDeg = getAngularRadiusDeg(observation);

  if (
    angularRadiusDeg === null ||
    visibility.status === "target_disk_below_sampled_terrain" ||
    visibility.status === "target_disk_size_unavailable"
  ) {
    return false;
  }

  return (
    visibility.status === "terrain_horizon_unavailable" ||
    visibility.status === "target_disk_intersects_sampled_terrain" ||
    visibility.status === "target_disk_above_sampled_terrain_unconfirmed"
  );
}

function getDiskFractionAboveHorizon(
  clearanceDeg: number,
  angularRadiusDeg: number
): number {
  if (
    !Number.isFinite(clearanceDeg) ||
    !Number.isFinite(angularRadiusDeg) ||
    angularRadiusDeg <= 0
  ) {
    return 0;
  }

  const normalized = clamp(
    clearanceDeg / angularRadiusDeg,
    -1,
    1
  );

  return clamp(
    (
      Math.acos(-normalized) +
      normalized *
      Math.sqrt(
        Math.max(0, 1 - normalized * normalized)
      )
    ) / Math.PI,
    0,
    1
  );
}

function getSunlightFraction(
  sun: HorizonsObservation | null
): number {
  if (!sun) {
    return 0;
  }

  const visibility = sun.terrainVisibility;

  // Use a measured local horizon when available. The separate global
  // completeness flag remains false and is still disclosed in the HUD;
  // it must not suppress sunlight from a valid sampled local horizon.
  if (
    !visibility ||
    visibility.targetDiskVisible !== true ||
    (
      visibility.status !== "target_disk_intersects_sampled_terrain" &&
      visibility.status !== "target_disk_above_sampled_terrain_unconfirmed"
    )
  ) {
    return 0;
  }

  if (
    visibility.clearanceDeg === null ||
    !Number.isFinite(visibility.clearanceDeg)
  ) {
    return 0;
  }

  const angularRadiusDeg = getAngularRadiusDeg(sun);

  if (angularRadiusDeg === null) {
    return 0;
  }

  return getDiskFractionAboveHorizon(
    visibility.clearanceDeg,
    angularRadiusDeg
  );
}

function getCelestialVisualOpacity(
  observation: HorizonsObservation | null
): number {
  if (!observation) {
    return 0;
  }

  const visibility = observation.terrainVisibility;

  if (!visibility) {
    return 0;
  }

  switch (visibility.status) {
    case "terrain_horizon_unavailable":
      return 0.22;

    case "target_disk_above_sampled_terrain_unconfirmed":
      return 0.48;

    case "target_disk_intersects_sampled_terrain": {
      const angularRadiusDeg =
        getAngularRadiusDeg(observation);

      if (
        angularRadiusDeg === null ||
        visibility.clearanceDeg === null ||
        !Number.isFinite(visibility.clearanceDeg)
      ) {
        return 0.25;
      }

      const visibleFraction = getDiskFractionAboveHorizon(
        visibility.clearanceDeg,
        angularRadiusDeg
      );

      return clamp(
        0.25 + visibleFraction * 0.35,
        0.25,
        0.6
      );
    }

    default:
      return 0;
  }
}

function getTerrainVisibilityLabel(
  observation: HorizonsObservation | null
): string {
  if (!observation) {
    return "JPL position unavailable";
  }

  const visibility = observation.terrainVisibility;

  if (!visibility) {
    return "Unknown — terrain assessment unavailable";
  }

  switch (visibility.status) {
    case "target_disk_below_sampled_terrain":
      return "Blocked by sampled terrain";

    case "target_disk_intersects_sampled_terrain":
      return "Intersects sampled terrain horizon";

    case "target_disk_above_sampled_terrain_unconfirmed":
      return "Above sampled horizon";

    case "target_disk_size_unavailable":
      return "Unknown — angular diameter unavailable";

    case "terrain_horizon_unavailable":
      return "JPL position known · terrain occlusion unknown";

    default:
      return "Unknown";
  }
}

function getTerrainVisibilityQualification(
  observation: HorizonsObservation | null,
  profile: HorizonProfileDirection[] | undefined
): string {
  if (!observation) return "No JPL sample is available for this timestamp.";

  const direction = getNearestHorizonDirection(profile, observation.azimuthDeg);
  const distance = direction?.lastKnownSampleDistanceMeters;

  switch (observation.terrainVisibility.status) {
    case "target_disk_above_sampled_terrain_unconfirmed":
      return Number.isFinite(distance)
        ? `Above the measured local horizon. Terrain was sampled to ${(distance! / 1000).toFixed(2)} km along this bearing; beyond that remains unknown.`
        : "Above the measured local horizon; full directional coverage is not verified.";
    case "target_disk_intersects_sampled_terrain":
      return "The modeled disk intersects the sampled terrain skyline; the visible fraction is an estimate.";
    case "target_disk_below_sampled_terrain":
      return Number.isFinite(distance)
        ? `The modeled disk is blocked by sampled terrain. Known samples extend ${(distance! / 1000).toFixed(2)} km along this bearing; beyond that remains unknown.`
        : "The modeled disk is blocked by the available sampled terrain profile.";
    case "terrain_horizon_unavailable":
      return "JPL sky position is available, but no valid terrain horizon sample exists for this bearing.";
    case "target_disk_size_unavailable":
      return "The sky position is available, but disk visibility cannot be estimated without angular diameter.";
    default:
      return "Terrain visibility qualification is unavailable.";
  }
}

/* =====================================================
   GEOGRAPHIC DIRECTION
===================================================== */

function destinationOnMoon(
  latitudeDeg: number,
  longitudeEastDeg: number,
  bearingRadians: number,
  distanceMeters: number
): {
  latitudeDeg: number;
  longitudeEastDeg: number;
} {
  const lat1 = THREE.MathUtils.degToRad(latitudeDeg);
  const lon1 = THREE.MathUtils.degToRad(longitudeEastDeg);

  const angularDistance =
    distanceMeters / LUNAR_RADIUS_METERS;

  const sinLat2 =
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) *
    Math.sin(angularDistance) *
    Math.cos(bearingRadians);

  const lat2 = Math.asin(clamp(sinLat2, -1, 1));

  const y =
    Math.sin(bearingRadians) *
    Math.sin(angularDistance) *
    Math.cos(lat1);

  const x =
    Math.cos(angularDistance) -
    Math.sin(lat1) * Math.sin(lat2);

  const lon2 = lon1 + Math.atan2(y, x);

  return {
    latitudeDeg: THREE.MathUtils.radToDeg(lat2),
    longitudeEastDeg:
      (
        THREE.MathUtils.radToDeg(lon2) % 360 +
        360
      ) % 360,
  };
}

interface LocalMapBasis {
  eastX: number;
  eastZ: number;
  northX: number;
  northZ: number;
}

function getLocalMapBasis(
  terrain: LolaTerrainData,
  latitude: number,
  longitude: number
): LocalMapBasis {
  const metadata = terrain.metadata;
  const probeMeters = 20;
  const origin = projectedToLolaPixel(
    geographicToLolaProjected(
      { latitudeDeg: latitude, longitudeEastDeg: longitude },
      metadata
    ),
    metadata
  );

  const eastCoordinate = destinationOnMoon(latitude, longitude, Math.PI / 2, probeMeters);
  const northCoordinate = destinationOnMoon(latitude, longitude, 0, probeMeters);

  const eastPixel = projectedToLolaPixel(
    geographicToLolaProjected(eastCoordinate, metadata),
    metadata
  );
  const northPixel = projectedToLolaPixel(
    geographicToLolaProjected(northCoordinate, metadata),
    metadata
  );

  const spacingX = Math.abs(metadata.pixelResolution[0]);
  const spacingZ = Math.abs(metadata.pixelResolution[1]);

  let eastX = ((eastPixel.column - origin.column) * spacingX) / probeMeters;
  let eastZ = ((eastPixel.row - origin.row) * spacingZ) / probeMeters;
  let northX = ((northPixel.column - origin.column) * spacingX) / probeMeters;
  let northZ = ((northPixel.row - origin.row) * spacingZ) / probeMeters;

  const eastLength = Math.hypot(eastX, eastZ);
  const northLength = Math.hypot(northX, northZ);
  if (eastLength <= 1e-8 || northLength <= 1e-8) {
    throw new Error("Could not derive the local lunar map orientation.");
  }

  eastX /= eastLength;
  eastZ /= eastLength;
  northX /= northLength;
  northZ /= northLength;

  const determinant = eastX * northZ - northX * eastZ;
  if (Math.abs(determinant) <= 1e-6) {
    throw new Error("Local lunar east/north basis is singular.");
  }

  return { eastX, eastZ, northX, northZ };
}

function getTrueHeadingFromSceneYaw(
  yawRadians: number,
  basis: LocalMapBasis
): number {
  // Three.js camera forward after Y rotation, expressed in scene X/Z.
  const sceneX = -Math.sin(yawRadians);
  const sceneZ = -Math.cos(yawRadians);
  const determinant = basis.eastX * basis.northZ - basis.northX * basis.eastZ;

  // Invert the local map basis to recover geographic east/north components.
  const eastComponent =
    (sceneX * basis.northZ - basis.northX * sceneZ) / determinant;
  const northComponent =
    (basis.eastX * sceneZ - sceneX * basis.eastZ) / determinant;

  return normalizeAzimuth(
    THREE.MathUtils.radToDeg(Math.atan2(eastComponent, northComponent))
  );
}

function getLocalSkyDirection(
  observation: HorizonsObservation,
  terrain: LolaTerrainData,
  latitude: number,
  longitude: number
): THREE.Vector3 {
  const azimuth = THREE.MathUtils.degToRad(observation.azimuthDeg);
  const elevation = THREE.MathUtils.degToRad(observation.elevationDeg);

  const east = Math.sin(azimuth) * Math.cos(elevation);
  const north = Math.cos(azimuth) * Math.cos(elevation);
  const up = Math.sin(elevation);

  const basis = getLocalMapBasis(terrain, latitude, longitude);
  return new THREE.Vector3(
    east * basis.eastX + north * basis.northX,
    up,
    east * basis.eastZ + north * basis.northZ
  ).normalize();
}

/* =====================================================
   NATIVE NASA LOLA GEOMETRY
===================================================== */

function writeSurfaceUv(
  uvs: Float32Array,
  vertexIndex: number,
  x: number,
  z: number
): void {
  const offset = vertexIndex * 2;
  uvs[offset] = clamp(
    (x + IMAGERY_HALF_SPAN_METERS) / (IMAGERY_HALF_SPAN_METERS * 2),
    0,
    1
  );
  // Scene +Z points toward decreasing map Y in the south-polar projection.
  // Texture v=1 is the north/top edge of the WMS image.
  uvs[offset + 1] = clamp(
    (IMAGERY_HALF_SPAN_METERS - z) / (IMAGERY_HALF_SPAN_METERS * 2),
    0,
    1
  );
}

function createLunarGeometry(
  terrain: LolaTerrainData,
  pixelColumn: number,
  pixelRow: number
): THREE.BufferGeometry {
  const { width, height, elevations, metadata } = terrain;

  if (elevations.length !== width * height) {
    throw new Error("LOLA raster dimensions do not match the elevation array.");
  }

  const spacingX = Math.abs(metadata.pixelResolution[0]);
  const spacingZ = Math.abs(metadata.pixelResolution[1]);
  if (spacingX <= 0 || spacingZ <= 0) {
    throw new Error("LOLA pixel spacing is invalid.");
  }

  const centerElevation = sampleLolaHeightAtPixel(terrain, {
    column: pixelColumn,
    row: pixelRow,
  });

  const startColumn = Math.max(0, Math.floor(pixelColumn - TERRAIN_RADIUS_PIXELS));
  const endColumn = Math.min(width - 1, Math.ceil(pixelColumn + TERRAIN_RADIUS_PIXELS));
  const startRow = Math.max(0, Math.floor(pixelRow - TERRAIN_RADIUS_PIXELS));
  const endRow = Math.min(height - 1, Math.ceil(pixelRow + TERRAIN_RADIUS_PIXELS));

  const columns = endColumn - startColumn + 1;
  const rows = endRow - startRow + 1;
  if (columns < 2 || rows < 2) {
    throw new Error("Observer is too close to the raster boundary.");
  }

  const vertexCount = columns * rows;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array((columns - 1) * (rows - 1) * 6);

  for (let row = 0; row < rows; row++) {
    const rasterRow = startRow + row;
    const z = (rasterRow - pixelRow) * spacingZ;

    for (let column = 0; column < columns; column++) {
      const rasterColumn = startColumn + column;
      const rasterIndex = rasterRow * width + rasterColumn;
      const vertexIndex = row * columns + column;
      const offset = vertexIndex * 3;
      const elevation = elevations[rasterIndex];

      if (!Number.isFinite(elevation)) {
        throw new Error(`Invalid NASA elevation at pixel ${rasterColumn}, ${rasterRow}.`);
      }

      const x = (rasterColumn - pixelColumn) * spacingX;
      const curvature = (x * x + z * z) / (2 * LUNAR_RADIUS_METERS);

      positions[offset] = x;
      positions[offset + 1] = elevation - centerElevation - curvature;
      positions[offset + 2] = z;
      writeSurfaceUv(uvs, vertexIndex, x, z);
    }
  }

  let cursor = 0;
  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;

      indices[cursor++] = a;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createAxisSamples(
  lastIndex: number,
  innerStart: number,
  innerEnd: number
): number[] {
  const samples = new Set<number>([0, lastIndex, innerStart, innerEnd]);
  for (let index = 0; index <= lastIndex; index += REGIONAL_SAMPLE_STEP_PIXELS) {
    samples.add(index);
  }
  return Array.from(samples).sort((left, right) => left - right);
}

/**
 * Draws the full prepared Product78 raster at a 30 m mesh interval,
 * leaving the 5 m near-field patch as the sole geometry inside its bounds.
 * This is a regional context mesh, not a 15 km-complete terrain model.
 */
function createRegionalLunarGeometry(
  terrain: LolaTerrainData,
  pixelColumn: number,
  pixelRow: number
): THREE.BufferGeometry {
  const { width, height, elevations, metadata } = terrain;
  const spacingX = Math.abs(metadata.pixelResolution[0]);
  const spacingZ = Math.abs(metadata.pixelResolution[1]);
  if (spacingX <= 0 || spacingZ <= 0) {
    throw new Error("LOLA pixel spacing is invalid.");
  }

  const centerElevation = sampleLolaHeightAtPixel(terrain, {
    column: pixelColumn,
    row: pixelRow,
  });

  const innerColumnStart = Math.max(0, Math.floor(pixelColumn - TERRAIN_RADIUS_PIXELS));
  const innerColumnEnd = Math.min(width - 1, Math.ceil(pixelColumn + TERRAIN_RADIUS_PIXELS));
  const innerRowStart = Math.max(0, Math.floor(pixelRow - TERRAIN_RADIUS_PIXELS));
  const innerRowEnd = Math.min(height - 1, Math.ceil(pixelRow + TERRAIN_RADIUS_PIXELS));

  const columnSamples = createAxisSamples(width - 1, innerColumnStart, innerColumnEnd);
  const rowSamples = createAxisSamples(height - 1, innerRowStart, innerRowEnd);
  const columns = columnSamples.length;
  const rows = rowSamples.length;

  const vertexCount = columns * rows;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let row = 0; row < rows; row++) {
    const rasterRow = rowSamples[row];
    const z = (rasterRow - pixelRow) * spacingZ;

    for (let column = 0; column < columns; column++) {
      const rasterColumn = columnSamples[column];
      const rasterIndex = rasterRow * width + rasterColumn;
      const vertexIndex = row * columns + column;
      const offset = vertexIndex * 3;
      const elevation = elevations[rasterIndex];

      if (!Number.isFinite(elevation)) {
        throw new Error(`Invalid regional NASA elevation at pixel ${rasterColumn}, ${rasterRow}.`);
      }

      const x = (rasterColumn - pixelColumn) * spacingX;
      const curvature = (x * x + z * z) / (2 * LUNAR_RADIUS_METERS);

      positions[offset] = x;
      positions[offset + 1] = elevation - centerElevation - curvature;
      positions[offset + 2] = z;
      writeSurfaceUv(uvs, vertexIndex, x, z);
    }
  }

  const maximumIndexCount = (columns - 1) * (rows - 1) * 6;
  const indices = new Uint32Array(maximumIndexCount);
  let cursor = 0;

  for (let row = 0; row < rows - 1; row++) {
    const rowStart = rowSamples[row];
    const rowEnd = rowSamples[row + 1];

    for (let column = 0; column < columns - 1; column++) {
      const columnStart = columnSamples[column];
      const columnEnd = columnSamples[column + 1];

      const fullyCoveredByNearField =
        columnStart >= innerColumnStart &&
        columnEnd <= innerColumnEnd &&
        rowStart >= innerRowStart &&
        rowEnd <= innerRowEnd;

      if (fullyCoveredByNearField) continue;

      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;

      indices[cursor++] = a;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices.subarray(0, cursor), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/* =====================================================
   LUNAR SURFACE
===================================================== */

function LunarSurface({
  terrain,
  pixelColumn,
  pixelRow,
  imageryTexture,
}: {
  terrain: LolaTerrainData;
  pixelColumn: number;
  pixelRow: number;
  imageryTexture: THREE.Texture | null;
}) {
  const localGeometry = useMemo(
    () => createLunarGeometry(terrain, pixelColumn, pixelRow),
    [terrain, pixelColumn, pixelRow]
  );

  const regionalGeometry = useMemo(
    () => createRegionalLunarGeometry(terrain, pixelColumn, pixelRow),
    [terrain, pixelColumn, pixelRow]
  );

  // LOLA geometry is always present. Transparent or missing LROC mosaic
  // pixels reveal this shaded-relief base instead of deleting the ground.
  const baseMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: LUNAR_REGOLITH_COLOR,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    []
  );

  const imageryMaterial = useMemo(
    () =>
      imageryTexture
        ? new THREE.MeshStandardMaterial({
            map: imageryTexture,
            color: "#ffffff",
            roughness: 1,
            metalness: 0,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9,
            alphaTest: 0.02,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          })
        : null,
    [imageryTexture]
  );

  useEffect(() => {
    return () => {
      localGeometry.dispose();
      regionalGeometry.dispose();
      baseMaterial.dispose();
      imageryMaterial?.dispose();
    };
  }, [localGeometry, regionalGeometry, baseMaterial, imageryMaterial]);

  return (
    <>
      <mesh
        geometry={regionalGeometry}
        material={baseMaterial}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      <mesh
        geometry={localGeometry}
        material={baseMaterial}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      {imageryMaterial && (
        <>
          <mesh
            geometry={regionalGeometry}
            material={imageryMaterial}
            renderOrder={1}
            frustumCulled={false}
          />
          <mesh
            geometry={localGeometry}
            material={imageryMaterial}
            renderOrder={1}
            frustumCulled={false}
          />
        </>
      )}
    </>
  );
}

/* =====================================================
   ANIMATED STARS
===================================================== */

const STAR_VERTEX_SHADER = `
  uniform float uTime;

  attribute float aPhase;
  attribute float aSize;
  attribute vec3 aColor;

  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    // Stars do not twinkle through a lunar vacuum; there is no atmosphere.
    float pulse = 1.0;

    vec4 mvPosition =
      modelViewMatrix * vec4(position, 1.0);

    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize * (0.85 + pulse * 0.15);

    vAlpha = pulse;
    vColor = aColor;
  }
`;

const STAR_FRAGMENT_SHADER = `
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec2 point = gl_PointCoord - vec2(0.5);
    float radius = length(point);

    float core = 1.0 - smoothstep(0.04, 0.34, radius);
    float glow = exp(-radius * 13.0) * 0.12;

    float alpha = clamp(
      (core + glow) * vAlpha,
      0.0,
      1.0
    );

    gl_FragColor = vec4(vColor, alpha);
  }
`;

function createStarGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  const phases = new Float32Array(STAR_COUNT);
  const sizes = new Float32Array(STAR_COUNT);

  let seed = 7812345;

  function random(): number {
    seed =
      (1664525 * seed + 1013904223) %
      4294967296;

    return seed / 4294967296;
  }

  for (let i = 0; i < STAR_COUNT; i++) {
    const azimuth = random() * Math.PI * 2;
    const elevation = 0.025 + random() * 0.975;

    const horizontal = Math.sqrt(
      1 - elevation * elevation
    );

    const offset = i * 3;

    positions[offset] =
      Math.cos(azimuth) * horizontal * STAR_RADIUS;

    positions[offset + 1] =
      elevation * STAR_RADIUS;

    positions[offset + 2] =
      Math.sin(azimuth) * horizontal * STAR_RADIUS;

    const tint = random();

    colors[offset] =
      tint > 0.88 ? 1 : 0.82 + random() * 0.18;

    colors[offset + 1] =
      tint < 0.10 ? 0.84 : 0.90 + random() * 0.10;

    colors[offset + 2] =
      tint > 0.88 ? 0.82 : 1;

    phases[i] = random() * Math.PI * 2;
    sizes[i] = 1.0 + random() * 2.2;
  }

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3)
  );

  geometry.setAttribute(
    "aColor",
    new THREE.BufferAttribute(colors, 3)
  );

  geometry.setAttribute(
    "aPhase",
    new THREE.BufferAttribute(phases, 1)
  );

  geometry.setAttribute(
    "aSize",
    new THREE.BufferAttribute(sizes, 1)
  );

  return geometry;
}

function AnimatedStarField() {
  const geometry = useMemo(
    () => createStarGeometry(),
    []
  );

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
        },
        vertexShader: STAR_VERTEX_SHADER,
        fragmentShader: STAR_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    []
  );

  const materialRef = useRef<THREE.ShaderMaterial | null>(null);

  useEffect(() => {
    materialRef.current = material;

    return () => {
      if (materialRef.current === material) {
        materialRef.current = null;
      }

      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame(({ clock }) => {
    const activeMaterial = materialRef.current;

    if (activeMaterial) {
      activeMaterial.uniforms.uTime.value = clock.elapsedTime;
    }
  });

  return (
    <points
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={10}
    />
  );
}

/* =====================================================
   SUN AND EARTH MODELS
===================================================== */
function CelestialModel({
  url,
  position,
  diameter,
  emissive = false,
  rotationSpeed = 0,
  opacity = 1,
}: {
  url: string;
  position: THREE.Vector3;
  diameter: number;
  emissive?: boolean;
  rotationSpeed?: number;
  opacity?: number;
}) {
  const { scene } = useGLTF(url);
  const modelRef = useRef<THREE.Group>(null);

  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(clone);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());

    const largestDimension = Math.max(
      size.x,
      size.y,
      size.z
    );

    const group = new THREE.Group();

    clone.position.sub(center);
    group.add(clone);

    if (largestDimension > 0) {
      group.scale.setScalar(
        diameter / largestDimension
      );
    }

    group.traverse((object) => {
      object.layers.set(1);

      if (!(object instanceof THREE.Mesh)) {
        return;
      }

      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];

      const clonedMaterials = materials.map(
        (sourceMaterial) => {
          const material = sourceMaterial.clone();

          if (opacity < 1) {
            material.transparent = true;
            material.opacity *= opacity;
            material.depthWrite = false;
          }

          if (
            emissive &&
            material instanceof THREE.MeshStandardMaterial
          ) {
            material.emissive.set("#ffb24d");
            material.emissiveIntensity = 4.0;
            material.toneMapped = false;
          }

          if (
            emissive &&
            material instanceof THREE.MeshBasicMaterial
          ) {
            material.color.set("#fff2d5");
            material.toneMapped = false;
          }

          return material;
        }
      );

      object.material = Array.isArray(object.material)
        ? clonedMaterials
        : clonedMaterials[0];

      object.castShadow = false;
      object.receiveShadow = false;
    });

    group.layers.set(1);

    return group;
  }, [scene, diameter, emissive, opacity]);

  useEffect(() => {
    return () => {
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) {
          return;
        }

        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];

        materials.forEach((material) => material.dispose());
      });
    };
  }, [model]);

  useFrame((_, delta) => {
    if (modelRef.current && rotationSpeed !== 0) {
      modelRef.current.rotation.y +=
        rotationSpeed * Math.min(delta, 0.05);
    }
  });

  return (
    <group
      ref={modelRef}
      position={[position.x, position.y, position.z]}
    >
      <primitive object={model} />
    </group>
  );
}

/* =====================================================
   REAL CELESTIAL POSITIONS AND LIGHTING
===================================================== */

function CelestialBodies({
  terrain,
  latitude,
  longitude,
  sun,
  earth,
}: {
  terrain: LolaTerrainData;
  latitude: number;
  longitude: number;
  sun: HorizonsObservation | null;
  earth: HorizonsObservation | null;
}) {
  const sunAngularRadiusDeg =
    sun ? getAngularRadiusDeg(sun) : null;

  const earthAngularRadiusDeg =
    earth ? getAngularRadiusDeg(earth) : null;

  const sunVisible = canRenderCelestialDisk(sun);

  const earthVisible = canRenderCelestialDisk(earth);
  const sunOpacity = getCelestialVisualOpacity(sun);

  const earthOpacity = getCelestialVisualOpacity(earth);

  const sunlightFraction = getSunlightFraction(sun);

  const directSunlightAvailable =
    sunVisible && sunlightFraction > 0;

  const sunDirection = useMemo(
    () =>
      sunVisible && sun
        ? getLocalSkyDirection(
          sun,
          terrain,
          latitude,
          longitude
        )
        : null,
    [sun, sunVisible, terrain, latitude, longitude]
  );

  const earthDirection = useMemo(
    () =>
      earthVisible && earth
        ? getLocalSkyDirection(
          earth,
          terrain,
          latitude,
          longitude
        )
        : null,
    [earth, earthVisible, terrain, latitude, longitude]
  );

  const sunPosition = useMemo(
    () =>
      sunDirection
        ? sunDirection.clone().multiplyScalar(
          CELESTIAL_DISTANCE
        )
        : null,
    [sunDirection]
  );

  const earthPosition = useMemo(
    () =>
      earthDirection
        ? earthDirection.clone().multiplyScalar(
          CELESTIAL_DISTANCE
        )
        : null,
    [earthDirection]
  );

  const sunDiameter =
    sunAngularRadiusDeg !== null
      ? 2 *
      CELESTIAL_DISTANCE *
      Math.tan(
        THREE.MathUtils.degToRad(sunAngularRadiusDeg)
      ) *
      CELESTIAL_VISUAL_SCALE
      : null;

  const earthDiameter =
    earthAngularRadiusDeg !== null
      ? 2 *
      CELESTIAL_DISTANCE *
      Math.tan(
        THREE.MathUtils.degToRad(earthAngularRadiusDeg)
      ) *
      CELESTIAL_VISUAL_SCALE
      : null;

  const modelAmbient = useMemo(() => {
    const light = new THREE.AmbientLight("#ffffff", 0.75);
    light.layers.set(1);
    return light;
  }, []);

  const sunLightRef = useRef<THREE.DirectionalLight>(null);

  useEffect(() => {
    sunLightRef.current?.layers.enable(1);
  }, [sunPosition, directSunlightAvailable]);

  return (
    <>
      <primitive object={modelAmbient} />

      {directSunlightAvailable && sunPosition && (
        <directionalLight
          ref={sunLightRef}
          position={[
            sunPosition.x,
            sunPosition.y,
            sunPosition.z,
          ]}
          intensity={2.6 * sunlightFraction}
          color="#fff0d7"
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-3500}
          shadow-camera-right={3500}
          shadow-camera-top={3500}
          shadow-camera-bottom={-3500}
          shadow-camera-near={0.1}
          shadow-camera-far={16000}
          shadow-bias={-0.0001}
          shadow-normalBias={0.02}
        />
      )}

      {sunVisible &&
        sunPosition &&
        sunDiameter !== null && (
          <CelestialModel
            url="/models/sun.glb"
            position={sunPosition}
            diameter={sunDiameter}
            emissive
            rotationSpeed={0.0015}
            opacity={sunOpacity}

          />
        )}

      {earthVisible &&
        earthPosition &&
        earthDiameter !== null && (
          <CelestialModel
            url="/models/earth.glb"
            position={earthPosition}
            diameter={earthDiameter}
            rotationSpeed={0.0005}
            opacity={earthOpacity}

          />
        )}
    </>
  );
}

/* =====================================================
   FIRST-PERSON CAMERA
===================================================== */

function ObserverCamera({
  look,
  terrain,
  latitude,
  longitude,
  onHeadingChange,
}: {
  look: RefObject<LookState>;
  terrain: LolaTerrainData | null;
  latitude: number;
  longitude: number;
  onHeadingChange: (heading: number) => void;
}) {
  const headingAccumulator = useRef(0);
  const lastHeading = useRef(-1);

  const localMapBasis = useMemo(
    () => terrain ? getLocalMapBasis(terrain, latitude, longitude) : null,
    [terrain, latitude, longitude]
  );

  useFrame(({ camera }, delta) => {
    camera.layers.enable(1);
    camera.position.set(0, OBSERVER_HEIGHT_METERS, 0);

    const damping = 1 - Math.exp(-12 * Math.min(delta, 0.05));
    look.current.yaw +=
      (look.current.targetYaw - look.current.yaw) * damping;
    look.current.pitch +=
      (look.current.targetPitch - look.current.pitch) * damping;

    camera.rotation.order = "YXZ";
    camera.rotation.y = look.current.yaw;
    camera.rotation.x = look.current.pitch;
    camera.rotation.z = 0;

    if (!localMapBasis) return;

    headingAccumulator.current += delta;
    if (headingAccumulator.current >= 0.1) {
      headingAccumulator.current = 0;
      const heading = getTrueHeadingFromSceneYaw(look.current.yaw, localMapBasis);
      if (Math.abs(heading - lastHeading.current) >= 0.5) {
        lastHeading.current = heading;
        onHeadingChange(heading);
      }
    }
  });

  return null;
}

/* =====================================================
   VISUALIZATION SCENE
===================================================== */

function LunarScene({
  terrain,
  pixelColumn,
  pixelRow,
  look,
  sun,
  earth,
  observer,
  latitude,
  longitude,
  imageryTexture,
  onHeadingChange,
}: {
  terrain: LolaTerrainData | null;
  pixelColumn: number;
  pixelRow: number;
  look: RefObject<LookState>;
  sun: HorizonsObservation | null;
  earth: HorizonsObservation | null;
  observer: {
    latitudeDeg: number;
    longitudeEastDeg: number;
  } | null;
  latitude: number;
  longitude: number;
  imageryTexture: THREE.Texture | null;
  onHeadingChange: (heading: number) => void;
}) {
  return (
    <>
      <color attach="background" args={["#020203"]} />

      <AnimatedStarField />

      {terrain && (
        <LunarSurface
          terrain={terrain}
          pixelColumn={pixelColumn}
          pixelRow={pixelRow}
          imageryTexture={imageryTexture}
        />
      )}

      {terrain && observer && (sun || earth) && (
        <Suspense fallback={null}>
          <CelestialBodies
            terrain={terrain}
            latitude={observer.latitudeDeg}
            longitude={observer.longitudeEastDeg}
            sun={sun}
            earth={earth}
          />
        </Suspense>
      )}

      <ObserverCamera
        look={look}
        terrain={terrain}
        latitude={latitude}
        longitude={longitude}
        onHeadingChange={onHeadingChange}
      />
    </>
  );
}

/* =====================================================
   MAIN COMPONENT
===================================================== */
export default function Lunar360Explorer({
  siteId,
  latitude,
  longitude,
  pixelColumn,
  pixelRow,
  missionDate,
  missionTime,
  durationHours,
}: Lunar360ExplorerProps) {
  const terrainRequestKey = JSON.stringify([
    siteId,
    pixelColumn,
    pixelRow,
  ]);

  const [terrainResult, setTerrainResult] = useState<{
    key: string;
    data: LolaTerrainData;
  } | null>(null);

  const terrain =
    terrainResult?.key === terrainRequestKey
      ? terrainResult.data
      : null;

  const horizonsRequestKey = JSON.stringify([
    terrainRequestKey,
    latitude,
    longitude,
    missionDate,
    missionTime,
    durationHours,
  ]);

  const [horizonsResult, setHorizonsResult] = useState<{
    key: string;
    data: HorizonsResponse;
  } | null>(null);

  const horizons =
    horizonsResult?.key === horizonsRequestKey
      ? horizonsResult.data
      : null;

  const look = useRef<LookState>({
    yaw: 0,
    pitch: 0,
    targetYaw: 0,
    targetPitch: 0,
  });

  const [cameraHeading, setCameraHeading] = useState(0);
  const [selectedObservationIndex, setSelectedObservationIndex] = useState(0);
  const [horizonsLoading, setHorizonsLoading] = useState(false);
  const [horizonsError, setHorizonsError] = useState<string | null>(null);
  const [jplRetryCount, setJplRetryCount] = useState(0);
  const [scienceSample, setScienceSample] = useState<ScienceSample | null>(null);
  const [scienceLoading, setScienceLoading] = useState(false);
  const [surfaceImagery, setSurfaceImagery] = useState<THREE.Texture | null>(null);
  const [surfaceImageryStatus, setSurfaceImageryStatus] =
    useState<"loading" | "available" | "unavailable">("loading");

  const pointer = useRef({
    active: false,
    pointerId: -1,
    x: 0,
    y: 0,
  });

  /* -----------------------------------------------
     Load the selected site's actual NASA LOLA terrain.
  ------------------------------------------------ */

  useEffect(() => {
    let cancelled = false;

    async function initializeTerrain() {
      try {
        const loaded = await loadLolaTerrainForSite(siteId);

        if (cancelled) {
          return;
        }

        sampleLolaHeightAtPixel(loaded, {
          column: pixelColumn,
          row: pixelRow,
        });

        setTerrainResult({
          key: terrainRequestKey,
          data: loaded,
        });

        console.info("[LUNAPATH] Loaded selected LOLA site:", {
          siteId,
          width: loaded.width,
          height: loaded.height,
          metadata: loaded.metadata,
        });
      } catch (error) {
        console.error(
          `[LUNAPATH] NASA terrain unavailable for ${siteId}:`,
          error
        );
      }
    }

    initializeTerrain();

    return () => {
      cancelled = true;
    };
  }, [siteId, pixelColumn, pixelRow, terrainRequestKey]);

  /* -----------------------------------------------
     Load the controlled LROC South Pole NAC average mosaic.
     The image is used as morphology/albedo only; Product78 remains
     the source of elevation and the JPL Sun drives current lighting.
  ------------------------------------------------ */

  useEffect(() => {
    if (!terrain) return;

    let active = true;
    setSurfaceImagery(null);
    setSurfaceImageryStatus("loading");

    const query = new URLSearchParams({
      siteId,
      lat: String(latitude),
      lon: String(longitude),
      col: String(pixelColumn),
      row: String(pixelRow),
    });

    const texture = new THREE.TextureLoader().load(
      `/api/lunar-imagery/nac-south-pole?${query.toString()}`,
      (loaded) => {
        if (!active) {
          loaded.dispose();
          return;
        }

        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.wrapS = THREE.ClampToEdgeWrapping;
        loaded.wrapT = THREE.ClampToEdgeWrapping;
        loaded.minFilter = THREE.LinearMipmapLinearFilter;
        loaded.magFilter = THREE.LinearFilter;
        loaded.generateMipmaps = true;
        loaded.anisotropy = 4;
        loaded.needsUpdate = true;

        setSurfaceImagery(loaded);
        setSurfaceImageryStatus("available");
      },
      undefined,
      (error) => {
        if (!active) return;
        console.warn("[LUNAPATH] LROC NAC imagery unavailable; using LOLA-only shaded terrain.", error);
        setSurfaceImageryStatus("unavailable");
      }
    );

    return () => {
      active = false;
      texture.dispose();
    };
  }, [terrain, siteId, latitude, longitude, pixelColumn, pixelRow]);

  /* -----------------------------------------------
     Fetch JPL Horizons at the selected location.
  ------------------------------------------------ */

  useEffect(() => {
    let cancelled = false;

    const controller = new AbortController();

    if (!terrain) {
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(missionDate) ||
      !/^\d{2}:\d{2}(?::\d{2})?$/.test(missionTime)
    ) {
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    setHorizonsLoading(true);
    setHorizonsError(null);

    async function loadJplHorizons() {
      try {
        const query = new URLSearchParams({
          date: missionDate,
          time: missionTime,
          durationHours,
          lat: String(latitude),
          lon: String(longitude),
          pixelColumn: String(pixelColumn),
          pixelRow: String(pixelRow),
          siteId,
        });

        const response = await fetch(
          `/api/horizons/selected-location?${query.toString()}`,
          {
            cache: "no-store",
            signal: controller.signal,
          }
        );

        const result =
          (await response.json()) as HorizonsResponse;

        if (!response.ok || !result.success) {
          const targetDiagnostics = Object.entries(result.targetErrors ?? {})
            .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
            .map(([target, detail]) => `${target.toUpperCase()}: ${detail}`)
            .join(" · ");

          throw new Error(
            [result.error, targetDiagnostics]
              .filter((part): part is string => Boolean(part))
              .join(" — ") ||
            `JPL Horizons request failed: HTTP ${response.status}.`
          );
        }

        if (cancelled) {
          return;
        }

        if (result.site?.id && result.site.id !== siteId) {
          throw new Error(
            `Site mismatch: requested ${siteId}, received ${result.site.id}.`
          );
        }

        setHorizonsResult({
          key: horizonsRequestKey,
          data: result,
        });

        console.info(
          "[LUNAPATH] JPL selected-location result:",
          {
            requestedSiteId: siteId,
            returnedSiteId: result.site?.id,
            observer: result.observer,
            sun: result.targets?.sun,
            earth: result.targets?.earth,
            terrainModel: result.terrainModel,
          }
        );
      } catch (error) {
        if (
          !cancelled &&
          !(
            error instanceof DOMException &&
            error.name === "AbortError"
          )
        ) {
          const message = error instanceof Error
            ? error.message
            : "Unknown JPL Horizons request failure.";
          setHorizonsError(message);
          console.error("[LUNAPATH] JPL Horizons data unavailable:", error);
        }
      } finally {
        if (!cancelled) {
          setHorizonsLoading(false);
        }
      }
    }

    loadJplHorizons();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    terrain,
    siteId,
    latitude,
    longitude,
    pixelColumn,
    pixelRow,
    missionDate,
    missionTime,
    durationHours,
    horizonsRequestKey,
    jplRetryCount,
  ]);

  const sunObservations = horizons?.targets?.sun?.observations ?? [];
  const earthObservations = horizons?.targets?.earth?.observations ?? [];
  const timelineLength = Math.max(sunObservations.length, earthObservations.length);
  const safeObservationIndex = Math.min(
    selectedObservationIndex,
    Math.max(0, timelineLength - 1)
  );
  const selectedTimeUtc =
    sunObservations[safeObservationIndex]?.timeUtc ??
    earthObservations[safeObservationIndex]?.timeUtc ??
    null;

  const sun = useMemo(() => {
    if (selectedTimeUtc) {
      const exact = sunObservations.find((item) => item.timeUtc === selectedTimeUtc);
      if (exact) return getFirstObservation(exact);
    }
    return getFirstObservation(horizons?.targets?.sun);
  }, [horizons, selectedTimeUtc, sunObservations]);

  const earth = useMemo(() => {
    if (selectedTimeUtc) {
      const exact = earthObservations.find((item) => item.timeUtc === selectedTimeUtc);
      if (exact) return getFirstObservation(exact);
    }
    return getFirstObservation(horizons?.targets?.earth);
  }, [horizons, selectedTimeUtc, earthObservations]);

  const horizonAtHeading = useMemo(
    () => getNearestHorizonDirection(horizons?.horizonProfile, cameraHeading),
    [horizons, cameraHeading]
  );
  const horizonPaths = useMemo(
    () => buildHorizonPaths(horizons?.horizonProfile),
    [horizons]
  );

  useEffect(() => {
    setSelectedObservationIndex(0);
  }, [horizonsRequestKey]);

  useEffect(() => {
    let active = true;
    setScienceLoading(true);
    setScienceSample(null);

    const query = new URLSearchParams({
      siteId,
      col: String(Math.round(pixelColumn)),
      row: String(Math.round(pixelRow)),
    });

    fetch(`/api/product78/science-sample?${query.toString()}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as ScienceSample;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error ?? `Science sample failed: HTTP ${response.status}`);
        }
        if (active) setScienceSample(payload);
      })
      .catch((error: unknown) => {
        if (active) {
          setScienceSample({
            success: false,
            available: false,
            reason: error instanceof Error ? error.message : "Science sample unavailable.",
          });
        }
      })
      .finally(() => {
        if (active) setScienceLoading(false);
      });

    return () => {
      active = false;
    };
  }, [siteId, pixelColumn, pixelRow]);

  const observer = useMemo(() => {
    if (!horizons?.observer) {
      return null;
    }

    return {
      latitudeDeg: horizons.observer.latitudeDeg,
      longitudeEastDeg: horizons.observer.longitudeEastDeg,
    };
  }, [horizons]);

  /* -----------------------------------------------
     Mouse-look controls.
  ------------------------------------------------ */

  function handlePointerDown(
    event: ReactPointerEvent<HTMLDivElement>
  ) {
    pointer.current = {
      active: true,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(
    event: ReactPointerEvent<HTMLDivElement>
  ) {
    if (
      !pointer.current.active ||
      pointer.current.pointerId !== event.pointerId
    ) {
      return;
    }

    const dx = event.clientX - pointer.current.x;
    const dy = event.clientY - pointer.current.y;

    pointer.current.x = event.clientX;
    pointer.current.y = event.clientY;

    look.current.targetYaw -= dx * 0.0035;

    look.current.targetPitch = clamp(
      look.current.targetPitch - dy * 0.0035,
      -Math.PI / 2 + 0.02,
      Math.PI / 2 - 0.02
    );
  }

  function handlePointerUp(
    event: ReactPointerEvent<HTMLDivElement>
  ) {
    if (pointer.current.pointerId !== event.pointerId) {
      return;
    }

    pointer.current.active = false;
    pointer.current.pointerId = -1;
  }

  function handlePointerCancel() {
    pointer.current.active = false;
    pointer.current.pointerId = -1;
  }

  return (
    <main
      className="fixed inset-0 h-[100dvh] w-full overflow-hidden bg-black touch-none select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <Canvas
        shadows
        camera={{
          position: [0, OBSERVER_HEIGHT_METERS, 0],
          fov: 72,
          near: 0.1,
          far: 30000,
        }}
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1,
        }}
      >
        <color attach="background" args={["#020203"]} />

        {/* Neutral visualization fill keeps LOLA relief legible during
            JPL outages. Only a measured Sun sample drives directional light. */}
        <ambientLight
          color="#b8b8b2"
          intensity={0.14}
        />

        <hemisphereLight
          args={["#c8c8c2", "#202020", 0.18]}
        />

        <LunarScene
          terrain={terrain}
          pixelColumn={pixelColumn}
          pixelRow={pixelRow}
          look={look}
          sun={sun}
          earth={earth}
          observer={observer}
          latitude={latitude}
          longitude={longitude}
          imageryTexture={surfaceImagery}
          onHeadingChange={setCameraHeading}
        />
      </Canvas>

      <div
        className="pointer-events-auto absolute left-5 top-5 z-40 w-[min(360px,calc(100vw-2.5rem))] border border-white/15 bg-black/80 p-3 text-white shadow-xl backdrop-blur-md"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[9px] font-semibold tracking-[0.18em] text-white/60">
            NASA / JPL HORIZONS
          </p>

          <span className="text-[9px] tracking-wider text-white/55">
            {horizonsLoading
              ? "QUERYING JPL…"
              : horizons
                ? horizons.status === "partial" ? "PARTIAL DATA LOADED" : "EPHEMERIS + TERRAIN LOADED"
                : horizonsError ? "JPL ERROR" : "WAITING"}
          </span>
        </div>

        <p className="mt-2 text-[10px] text-white/40">
          Mission time: {missionDate} {missionTime} UTC · {durationHours} h
        </p>
        <p className="mt-1 text-[9px] tracking-wider text-amber-100/65">
          TERRAIN HORIZON: PARTIAL · COMPLETE 360° COVERAGE NOT VERIFIED
        </p>
        <p className="mt-1 text-[9px] text-white/40">
          SURFACE IMAGERY: {surfaceImageryStatus === "available"
            ? "LROC NAC MOSAIC LOADED"
            : surfaceImageryStatus === "loading"
              ? "LOADING LROC NAC…"
              : "LOLA SHADED RELIEF FALLBACK"}
        </p>
        <p className="mt-1 text-[8px] text-white/30">
          TERRAIN MESH: 5 m near-field · 30 m regional context
        </p>
        <p className="mt-1 text-[8px] leading-3 text-white/30">
          LROC imagery supplies average surface morphology, not live illumination or elevation.
        </p>
        <a
          href="https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_POLE_SOUTH_CM_AVG"
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-[8px] text-white/45 underline underline-offset-2 hover:text-white/75"
        >
          LROC source product · NASA / ASU
        </a>
        <p className="mt-1 text-[8px] text-white/30">
          Celestial disk diameters use JPL apparent angular sizes (1× scale).
        </p>

        {horizonsError && (
          <div className="mt-2 rounded-md border border-red-300/20 bg-red-300/[0.06] p-2">
            <p className="max-h-20 overflow-y-auto break-words text-[10px] leading-4 text-red-100/85">
              {horizonsError}
            </p>
            <button
              type="button"
              onClick={() => setJplRetryCount((count) => count + 1)}
              className="mt-2 text-[9px] font-semibold tracking-wider text-red-100 underline underline-offset-2"
            >
              RETRY JPL REQUEST
            </button>
          </div>
        )}

        {horizons?.targetErrors && (horizons.targetErrors.sun || horizons.targetErrors.earth) && (
          <p className="mt-2 break-words text-[9px] leading-4 text-amber-100/70">
            {[
              horizons.targetErrors.sun ? `Sun: ${horizons.targetErrors.sun}` : null,
              horizons.targetErrors.earth ? `Earth: ${horizons.targetErrors.earth}` : null,
            ].filter(Boolean).join(" · ")}
          </p>
        )}

        {horizons?.terrainError && (
          <p className="mt-2 break-words text-[9px] leading-4 text-amber-100/70">
            Terrain horizon unavailable: {horizons.terrainError}. JPL positions can still be displayed; terrain occlusion remains unknown.
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-wider text-amber-200">
              SUN
            </p>

            <p className="mt-2 text-[10px] leading-5 text-white/75">
              {getTerrainVisibilityLabel(sun)}
            </p>
            <p className="mt-1 text-[9px] leading-4 text-white/45">
              {getTerrainVisibilityQualification(sun, horizons?.horizonProfile)}
            </p>
            <p className="mt-1 text-[9px] text-white/35">
              JPL: {sun?.time ?? "Unavailable"} · Az {sun ? sun.azimuthDeg.toFixed(1) : "—"}° · El {sun ? sun.elevationDeg.toFixed(1) : "—"}°
            </p>
          </div>

          <div>
            <p className="text-[10px] font-semibold tracking-wider text-blue-200">
              EARTH
            </p>

            <p className="mt-2 text-[10px] leading-5 text-white/75">
              {getTerrainVisibilityLabel(earth)}
            </p>
            <p className="mt-1 text-[9px] leading-4 text-white/45">
              {getTerrainVisibilityQualification(earth, horizons?.horizonProfile)}
            </p>
            <p className="mt-1 text-[9px] text-white/35">
              JPL: {earth?.time ?? "Unavailable"} · Az {earth ? earth.azimuthDeg.toFixed(1) : "—"}° · El {earth ? earth.elevationDeg.toFixed(1) : "—"}°
            </p>
          </div>
        </div>
      </div>

      <details
        className="group pointer-events-auto absolute right-4 top-4 z-40 w-[min(320px,calc(100vw-2rem))] max-h-[70vh] overflow-y-auto rounded-xl border border-white/15 bg-black/85 p-3 text-white shadow-2xl backdrop-blur-md"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
      >
        <summary
          aria-label="Expand or collapse the observer HUD containing terrain, skyline and mission timeline"
          className="list-none cursor-pointer [&::-webkit-details-marker]:hidden"
        >
          <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-semibold tracking-[0.18em] text-white/50">OBSERVER HUD · TRUE NORTH</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{cameraHeading.toFixed(1)}°</p>
            <p className="text-[10px] text-white/45">Camera heading · {cameraHeading < 22.5 || cameraHeading >= 337.5 ? "N" : cameraHeading < 67.5 ? "NE" : cameraHeading < 112.5 ? "E" : cameraHeading < 157.5 ? "SE" : cameraHeading < 202.5 ? "S" : cameraHeading < 247.5 ? "SW" : cameraHeading < 292.5 ? "W" : "NW"}</p>
            <p className="mt-1 text-[8px] tracking-wider text-amber-100/65">TRUE-NORTH BEARING</p>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center text-[9px] text-white/45">
            <span />
            <span className="rounded border border-white/20 px-2 py-1">N</span>
            <span />
            <span className="rounded border border-white/20 px-2 py-1">W</span>
            <span
              className="inline-block rounded border border-amber-300/40 bg-amber-300/10 px-2 py-1 text-amber-100"
              style={{ transform: `rotate(${cameraHeading}deg)` }}
              title="Arrow indicates the camera look direction relative to true north"
            >↑</span>
            <span className="rounded border border-white/20 px-2 py-1">E</span>
            <span />
            <span className="rounded border border-white/20 px-2 py-1">S</span>
            <span />
          </div>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-md border border-white/10 bg-white/[0.035] px-3 py-2">
            <span className="text-[8px] tracking-[0.12em] text-white/50">TAP TO EXPAND TERRAIN, SKYLINE & TIMELINE</span>
            <span className="text-sm text-amber-100 transition-transform group-open:rotate-180">⌄</span>
          </div>
        </summary>

        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.035] p-3">
          <p className="text-[9px] tracking-[0.15em] text-white/45">LOOK-DIRECTION TERRAIN</p>
          {horizonAtHeading?.horizonElevationDeg !== null && horizonAtHeading?.horizonElevationDeg !== undefined ? (
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div><p className="text-[9px] text-white/40">Sampled horizon</p><strong className="text-sm">{horizonAtHeading.horizonElevationDeg.toFixed(2)}°</strong></div>
              <div><p className="text-[9px] text-white/40">Farthest known sample</p><strong className="text-sm">{horizonAtHeading.lastKnownSampleDistanceMeters?.toFixed(0) ?? "—"} m</strong></div>
              <p className="col-span-2 text-[9px] text-white/45">Bearing {horizonAtHeading.azimuthDeg.toFixed(2)}° · {horizonAtHeading.horizonSource ?? "unknown"} · {horizonAtHeading.horizonResolutionMeters ?? "—"} m grid</p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-amber-100/75">UNKNOWN — no valid terrain sample in this direction.</p>
          )}
          <p className="mt-2 text-[9px] text-amber-100/60">Terrain beyond known coverage remains unknown. The 15 km search limit is not a claim of complete horizon coverage.</p>
        </div>

        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.025] p-3">
          <div className="flex items-center justify-between">
            <p className="text-[9px] tracking-[0.15em] text-white/45">360° SAMPLED SKYLINE</p>
            <span className="text-[9px] text-white/35">Gaps = unknown</span>
          </div>
          <svg viewBox="0 0 320 100" role="img" aria-label="Sampled terrain horizon by azimuth" className="mt-2 h-24 w-full overflow-visible">
            <line x1="10" y1="82" x2="310" y2="82" stroke="rgba(255,255,255,.18)" strokeDasharray="3 4" />
            <line x1="160" y1="10" x2="160" y2="86" stroke="rgba(255,255,255,.10)" strokeDasharray="3 4" />
            {horizonPaths.map((path, index) => <path key={index} d={path} fill="none" stroke="#79cbb7" strokeWidth="2" strokeLinejoin="round" />)}
            <text x="10" y="96" fill="rgba(255,255,255,.5)" fontSize="8">N</text>
            <text x="85" y="96" fill="rgba(255,255,255,.5)" fontSize="8">E</text>
            <text x="160" y="96" fill="rgba(255,255,255,.5)" fontSize="8">S</text>
            <text x="235" y="96" fill="rgba(255,255,255,.5)" fontSize="8">W</text>
          </svg>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-amber-200/15 bg-amber-200/[0.04] p-3">
            <p className="text-[9px] tracking-wider text-amber-100/60">SUN · AZ / EL</p>
            <strong className="mt-1 block text-sm">{sun ? `${sun.azimuthDeg.toFixed(1)}°` : "—"}</strong>
            <p className="text-[9px] text-white/55">Elevation {sun ? `${sun.elevationDeg >= 0 ? "+" : ""}${sun.elevationDeg.toFixed(2)}°` : "—"}</p>
            <p className="mt-1 text-[9px] text-white/45">{sun ? getTerrainVisibilityLabel(sun) : "No selected sample"}</p>
          </div>
          <div className="rounded-lg border border-sky-200/15 bg-sky-200/[0.04] p-3">
            <p className="text-[9px] tracking-wider text-sky-100/60">EARTH · AZ / EL</p>
            <strong className="mt-1 block text-sm">{earth ? `${earth.azimuthDeg.toFixed(1)}°` : "—"}</strong>
            <p className="text-[9px] text-white/55">Elevation {earth ? `${earth.elevationDeg >= 0 ? "+" : ""}${earth.elevationDeg.toFixed(2)}°` : "—"}</p>
            <p className="mt-1 text-[9px] text-white/45">{earth ? getTerrainVisibilityLabel(earth) : "No selected sample"}</p>
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-white/10 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[9px] tracking-[0.15em] text-white/45">MISSION TIMELINE · JPL SAMPLES</p>
            <span className="text-[9px] tabular-nums text-white/55">{timelineLength ? `${safeObservationIndex + 1}/${timelineLength}` : "No samples"}</span>
          </div>
          <p className="mt-2 text-[9px] leading-4 text-white/45">
            Each step selects one actual 10-minute JPL timestamp. Sun and Earth positions and sampled-terrain visibility update together; the observer and camera remain fixed.
          </p>
          {timelineLength > 0 ? (
            <>
              <input
                aria-label="Select actual JPL mission observation"
                className="mt-3 w-full accent-amber-300"
                type="range"
                min="0"
                max={timelineLength - 1}
                step="1"
                value={safeObservationIndex}
                onChange={(event) => setSelectedObservationIndex(Number(event.target.value))}
              />
              <div className="mt-1 flex justify-between text-[9px] text-white/40">
                <span>{sunObservations[0]?.timeUtc ?? "—"}</span>
                <span>{sunObservations[sunObservations.length - 1]?.timeUtc ?? "—"}</span>
              </div>
              <p className="mt-2 text-[10px] text-white/65">{selectedTimeUtc ?? "Observation unavailable"}</p>
            </>
          ) : (
            <p className="mt-2 text-xs text-white/45">Waiting for exact-observer JPL samples.</p>
          )}
        </div>

        <div className="mt-3 rounded-lg border border-white/10 p-3">
          <p className="text-[9px] tracking-[0.15em] text-white/45">PRODUCT78 SCIENCE · SELECTED PIXEL</p>
          {scienceLoading ? (
            <p className="mt-2 text-xs text-white/45">Reading science values…</p>
          ) : scienceSample?.available && scienceSample.values ? (
            <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
              <div><p className="text-[9px] text-white/40">Elevation</p><strong>{scienceSample.values.elevationMeters.toFixed(2)} m</strong></div>
              <div><p className="text-[9px] text-white/40">Slope</p><strong>{scienceSample.values.slopeDegrees.toFixed(2)}°</strong></div>
              <div><p className="text-[9px] text-white/40">Slope RMS uncertainty</p><strong>{scienceSample.values.slopeUncertaintyDegrees.toFixed(2)}°</strong></div>
              <div><p className="text-[9px] text-white/40">Elevation RMS uncertainty</p><strong>{scienceSample.values.elevationUncertaintyMeters.toFixed(2)} m</strong></div>
              <div><p className="text-[9px] text-white/40">Direct LOLA shots / pixel</p><strong>{scienceSample.values.observationCount.toFixed(0)}</strong></div>
            </div>
            <p className="mt-3 text-[9px] leading-4 text-white/45">
              Zero direct shots does not mean missing terrain: Product78 can interpolate elevation between LOLA tracks. Elevation is bilinearly sampled at the selected coordinate; slope, RMS errors and shot count use the nearest 5 m pixel.
            </p>
          ) : (
            <p className="mt-2 text-[10px] text-amber-100/70">{scienceSample?.reason ?? "Science layers not prepared for this site."}</p>
          )}
        </div>

        <p className="mt-3 text-[9px] leading-4 text-white/40">Camera rotation changes only the true-north look-direction HUD. The shared JPL timestamp updates both celestial bodies and their sampled-terrain assessments. Earth visibility is geometric screening only, not an RF link budget.</p>
      </details>

      <a
        href="/map"
        onPointerDown={(
          event: ReactPointerEvent<HTMLAnchorElement>
        ) => event.stopPropagation()}
        onPointerUp={(
          event: ReactPointerEvent<HTMLAnchorElement>
        ) => event.stopPropagation()}
        className="absolute bottom-5 left-5 z-50 inline-flex items-center gap-2 border border-white/25 bg-black/70 px-4 py-3 text-[10px] font-medium tracking-[0.16em] text-white/85 shadow-lg backdrop-blur-md transition-colors hover:border-white/60 hover:bg-black/90 hover:text-white"
      >
        <span aria-hidden="true">←</span>
        BACK TO PLANNER
      </a>
    </main>
  );
}
/* =====================================================
   PRELOAD MODELS
===================================================== */

useGLTF.preload("/models/sun.glb");
useGLTF.preload("/models/earth.glb");
