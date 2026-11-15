
"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  PointerEvent as ReactPointerEvent,
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

type LookController = (deltaX: number, deltaY: number) => void;

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
    };
  }, [localGeometry, regionalGeometry]);

  useEffect(() => {
    return () => {
      baseMaterial.dispose();
      imageryMaterial?.dispose();
    };
  }, [baseMaterial, imageryMaterial]);

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
            receiveShadow
            renderOrder={1}
            frustumCulled={false}
          />
          <mesh
            geometry={localGeometry}
            material={imageryMaterial}
            receiveShadow
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
          shadow-camera-left={-9000}
          shadow-camera-right={9000}
          shadow-camera-top={9000}
          shadow-camera-bottom={-9000}
          shadow-camera-near={0.1}
          shadow-camera-far={30000}
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
  terrain,
  latitude,
  longitude,
  onHeadingChange,
  onLookControllerReady,
}: {
  terrain: LolaTerrainData | null;
  latitude: number;
  longitude: number;
  onHeadingChange: (heading: number) => void;
  onLookControllerReady: (controller: LookController | null) => void;
}) {
  // Keep only the requested look target in React state. The camera itself
  // is the animation state, so the render loop never mutates a React ref.
  const [lookTarget, setLookTarget] = useState({ yaw: 0, pitch: 0 });
  const headingAccumulator = useRef(0);
  const lastHeading = useRef(-1);

  const handleLookInput = useCallback((deltaX: number, deltaY: number) => {
    setLookTarget((current) => ({
      yaw: current.yaw - deltaX * 0.0035,
      pitch: clamp(
        current.pitch - deltaY * 0.0035,
        -Math.PI / 2 + 0.02,
        Math.PI / 2 - 0.02
      ),
    }));
  }, []);

  useEffect(() => {
    onLookControllerReady(handleLookInput);
    return () => onLookControllerReady(null);
  }, [handleLookInput, onLookControllerReady]);

  const localMapBasis = useMemo(
    () => terrain ? getLocalMapBasis(terrain, latitude, longitude) : null,
    [terrain, latitude, longitude]
  );

  useFrame(({ camera }, delta) => {
    camera.layers.enable(1);
    camera.position.set(0, OBSERVER_HEIGHT_METERS, 0);

    const damping = 1 - Math.exp(-12 * Math.min(delta, 0.05));

    // Three.js camera rotation is the imperative animation target. React state
    // changes only when pointer input arrives, not on every animation frame.
    camera.rotation.order = "YXZ";
    camera.rotation.y += (lookTarget.yaw - camera.rotation.y) * damping;
    camera.rotation.x += (lookTarget.pitch - camera.rotation.x) * damping;
    camera.rotation.z = 0;

    if (!localMapBasis) return;

    headingAccumulator.current += delta;
    if (headingAccumulator.current >= 0.1) {
      headingAccumulator.current = 0;
      const heading = getTrueHeadingFromSceneYaw(camera.rotation.y, localMapBasis);
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
  sun,
  earth,
  observer,
  latitude,
  longitude,
  imageryTexture,
  onHeadingChange,
  onLookControllerReady,
}: {
  terrain: LolaTerrainData | null;
  pixelColumn: number;
  pixelRow: number;
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
  onLookControllerReady: (controller: LookController | null) => void;
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
        terrain={terrain}
        latitude={latitude}
        longitude={longitude}
        onHeadingChange={onHeadingChange}
        onLookControllerReady={onLookControllerReady}
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

  const [cameraHeading, setCameraHeading] = useState(0);
  const [selectedObservation, setSelectedObservation] = useState<{
    key: string;
    index: number;
  }>({ key: "", index: 0 });
  const [jplRetryCount, setJplRetryCount] = useState(0);
  const [horizonsRequestResult, setHorizonsRequestResult] = useState<{
    key: string;
    status: "complete" | "error";
    error?: string;
  } | null>(null);
  const [scienceResult, setScienceResult] = useState<{
    key: string;
    data: ScienceSample;
  } | null>(null);
  const [surfaceImageryState, setSurfaceImageryState] = useState<{
    key: string;
    texture: THREE.Texture | null;
  } | null>(null);

  const selectedObservationIndex =
    selectedObservation.key === horizonsRequestKey
      ? selectedObservation.index
      : 0;
  const horizonsAttemptKey = JSON.stringify([
    horizonsRequestKey,
    jplRetryCount,
  ]);
  const horizonsRequestIsValid =
    /^\d{4}-\d{2}-\d{2}$/.test(missionDate) &&
    /^\d{2}:\d{2}(?::\d{2})?$/.test(missionTime);
  const currentHorizonsRequestResult =
    horizonsRequestResult?.key === horizonsAttemptKey
      ? horizonsRequestResult
      : null;
  const horizonsError =
    currentHorizonsRequestResult?.status === "error"
      ? currentHorizonsRequestResult.error ?? "JPL Horizons request failed."
      : null;

  const scienceRequestKey = JSON.stringify([
    siteId,
    Math.round(pixelColumn),
    Math.round(pixelRow),
  ]);
  const surfaceImageryRequestKey = JSON.stringify([
    siteId,
    latitude,
    longitude,
    pixelColumn,
    pixelRow,
  ]);
  const currentSurfaceImageryState =
    surfaceImageryState?.key === surfaceImageryRequestKey
      ? surfaceImageryState
      : null;
  const surfaceImagery = currentSurfaceImageryState?.texture ?? null;

  const lookController = useRef<LookController | null>(null);
  const handleLookControllerReady = useCallback(
    (controller: LookController | null) => {
      lookController.current = controller;
    },
    []
  );

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
     The image is a visual morphology texture only; Product78 remains
     the source of elevation and the JPL Sun drives current lighting.
  ------------------------------------------------ */

  useEffect(() => {
    if (!terrain) return;

    let active = true;

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

        setSurfaceImageryState({
          key: surfaceImageryRequestKey,
          texture: loaded,
        });
      },
      undefined,
      (error) => {
        if (!active) return;
        console.warn("[LUNAPATH] LROC NAC imagery unavailable; using LOLA-only shaded terrain.", error);
        setSurfaceImageryState({
          key: surfaceImageryRequestKey,
          texture: null,
        });
      }
    );

    return () => {
      active = false;
      texture.dispose();
    };
  }, [
    terrain,
    siteId,
    latitude,
    longitude,
    pixelColumn,
    pixelRow,
    surfaceImageryRequestKey,
  ]);

  /* -----------------------------------------------
     Fetch JPL Horizons at the selected location.
  ------------------------------------------------ */

  useEffect(() => {
    let cancelled = false;
    let requestError: string | null = null;

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
          requestError = error instanceof Error
            ? error.message
            : "Unknown JPL Horizons request failure.";
          console.error("[LUNAPATH] JPL Horizons data unavailable:", error);
        }
      } finally {
        if (!cancelled) {
          setHorizonsRequestResult({
            key: horizonsAttemptKey,
            status: requestError ? "error" : "complete",
            ...(requestError ? { error: requestError } : {}),
          });
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
    horizonsAttemptKey,
  ]);

  const sunObservations = useMemo(
    () => horizons?.targets?.sun?.observations ?? [],
    [horizons]
  );
  const earthObservations = useMemo(
    () => horizons?.targets?.earth?.observations ?? [],
    [horizons]
  );
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

  useEffect(() => {
    let active = true;

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
        if (active) {
          setScienceResult({
            key: scienceRequestKey,
            data: payload,
          });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setScienceResult({
            key: scienceRequestKey,
            data: {
              success: false,
              available: false,
              reason: error instanceof Error ? error.message : "Science sample unavailable.",
            },
          });
        }
      });

    return () => {
      active = false;
    };
  }, [siteId, pixelColumn, pixelRow, scienceRequestKey]);

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

    lookController.current?.(dx, dy);
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
          sun={sun}
          earth={earth}
          observer={observer}
          latitude={latitude}
          longitude={longitude}
          imageryTexture={surfaceImagery}
          onHeadingChange={setCameraHeading}
          onLookControllerReady={handleLookControllerReady}
        />
      </Canvas>

      {/* Verbose diagnostics moved intact to docs/archive/lunapath-explorer-diagnostics.jsx.txt for migration
          into Mission Data. Keep the live API/data logic above unchanged. */}

      {/* Minimal true-north compass: the scene remains the focus. */}
      <div
        aria-label={`Camera direction ${cameraHeading.toFixed(0)} degrees from true north`}
        className="pointer-events-none absolute right-5 top-5 z-40 grid h-24 w-24 grid-cols-3 grid-rows-3 place-items-center rounded-full border border-white/20 bg-black/45 p-2 text-[10px] font-medium text-white/65 shadow-lg backdrop-blur-md"
      >
        <span />
        <span className="text-white">N</span>
        <span />
        <span>W</span>
        <span
          className="text-lg text-amber-100"
          style={{ transform: `rotate(${cameraHeading}deg)` }}
          aria-hidden="true"
        >
          ↑
        </span>
        <span>E</span>
        <span />
        <span className="text-white">S</span>
        <span />
      </div>

      {/* The timeline stays available as a compact exploration control.
          Its full explanation and ephemeris diagnostics remain archived above. */}
      {timelineLength > 0 && selectedTimeUtc && (
        <div
          className="pointer-events-auto absolute bottom-5 left-1/2 z-40 w-[min(520px,calc(100vw-11rem))] -translate-x-1/2 rounded-lg border border-white/15 bg-black/65 px-4 py-3 text-white shadow-xl backdrop-blur-md"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between gap-3 text-[10px] tabular-nums text-white/65">
            <time dateTime={selectedTimeUtc}>
              {new Date(selectedTimeUtc).toISOString().slice(0, 16).replace("T", " ")} UTC
            </time>
            <span>{safeObservationIndex + 1}/{timelineLength}</span>
          </div>
          <input
            aria-label="Mission timeline"
            className="block w-full accent-amber-300"
            type="range"
            min="0"
            max={timelineLength - 1}
            step="1"
            value={safeObservationIndex}
            onChange={(event) => setSelectedObservation({
              key: horizonsRequestKey,
              index: Number(event.target.value),
            })}
          />
        </div>
      )}

      {horizonsError && (
        <button
          type="button"
          onClick={() => setJplRetryCount((count) => count + 1)}
          className="pointer-events-auto absolute right-5 top-28 z-40 rounded-md border border-red-200/30 bg-black/70 px-3 py-2 text-[10px] text-red-100/85 backdrop-blur-md"
          aria-label="Retry JPL mission data request"
        >
          JPL retry
        </button>
      )}

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
