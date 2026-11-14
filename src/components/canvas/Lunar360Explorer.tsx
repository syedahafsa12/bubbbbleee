
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
  azimuthDeg: number;
  elevationDeg: number;
  angularDiameterArcsec: number | null;
  terrainVisibility: TerrainVisibility;
}

interface HorizonsResponse {
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
}

/* =====================================================
   SCENE CONSTANTS
===================================================== */

const TERRAIN_RADIUS_PIXELS = 500;

const OBSERVER_HEIGHT_METERS = 1.7;
const LUNAR_RADIUS_METERS = 1_737_400;

const CELESTIAL_DISTANCE = 8000;


const CELESTIAL_VISUAL_SCALE = 6;

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

  // No terrain assessment or no positive visibility result.
  if (
    !visibility ||
    visibility.targetDiskVisible !== true
  ) {
    return false;
  }

  // Never invent a celestial disk size.
  const angularRadiusDeg = getAngularRadiusDeg(observation);

  if (angularRadiusDeg === null) {
    return false;
  }

  // Only these two states are eligible for rendering.
  switch (visibility.status) {
    case "target_disk_intersects_sampled_terrain":
      return true;

    case "target_disk_above_sampled_terrain_unconfirmed":
      return true;

    case "target_disk_below_sampled_terrain":
    case "target_disk_size_unavailable":
    case "terrain_horizon_unavailable":
    default:
      return false;
  }
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

  // Do not turn incomplete terrain coverage into confirmed
  // direct sunlight.
  if (
    !visibility ||
    visibility.targetDiskVisible !== true ||
    visibility.terrainCoverageComplete !== true ||
    visibility.status !==
    "target_disk_intersects_sampled_terrain"
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
    case "target_disk_above_sampled_terrain_unconfirmed":
      return 0.32;

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
      return "Above sampled terrain — unconfirmed";

    case "target_disk_size_unavailable":
      return "Unknown — angular diameter unavailable";

    case "terrain_horizon_unavailable":
      return "Unknown — terrain horizon unavailable";

    default:
      return "Unknown";
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

function getLocalSkyDirection(
  observation: HorizonsObservation,
  terrain: LolaTerrainData,
  latitude: number,
  longitude: number
): THREE.Vector3 {
  const azimuth = THREE.MathUtils.degToRad(
    observation.azimuthDeg
  );

  const elevation = THREE.MathUtils.degToRad(
    observation.elevationDeg
  );

  const east = Math.sin(azimuth) * Math.cos(elevation);
  const north = Math.cos(azimuth) * Math.cos(elevation);
  const up = Math.sin(elevation);

  const metadata = terrain.metadata;
  const probeMeters = 20;

  const origin = projectedToLolaPixel(
    geographicToLolaProjected(
      {
        latitudeDeg: latitude,
        longitudeEastDeg: longitude,
      },
      metadata
    ),
    metadata
  );

  const eastCoordinate = destinationOnMoon(
    latitude,
    longitude,
    Math.PI / 2,
    probeMeters
  );

  const northCoordinate = destinationOnMoon(
    latitude,
    longitude,
    0,
    probeMeters
  );

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

  const eastX =
    ((eastPixel.column - origin.column) * spacingX) /
    probeMeters;

  const eastZ =
    ((eastPixel.row - origin.row) * spacingZ) /
    probeMeters;

  const northX =
    ((northPixel.column - origin.column) * spacingX) /
    probeMeters;

  const northZ =
    ((northPixel.row - origin.row) * spacingZ) /
    probeMeters;

  return new THREE.Vector3(
    east * eastX + north * northX,
    up,
    east * eastZ + north * northZ
  ).normalize();
}

/* =====================================================
   NATIVE NASA LOLA GEOMETRY
===================================================== */

function createLunarGeometry(
  terrain: LolaTerrainData,
  pixelColumn: number,
  pixelRow: number
): THREE.BufferGeometry {
  const {
    width,
    height,
    elevations,
    metadata,
  } = terrain;

  if (elevations.length !== width * height) {
    throw new Error(
      "LOLA raster dimensions do not match the elevation array."
    );
  }

  const spacingX = Math.abs(metadata.pixelResolution[0]);
  const spacingZ = Math.abs(metadata.pixelResolution[1]);

  if (spacingX <= 0 || spacingZ <= 0) {
    throw new Error("LOLA pixel spacing is invalid.");
  }

  const centerElevation = sampleLolaHeightAtPixel(
    terrain,
    {
      column: pixelColumn,
      row: pixelRow,
    }
  );

  const startColumn = Math.max(
    0,
    Math.floor(pixelColumn - TERRAIN_RADIUS_PIXELS)
  );

  const endColumn = Math.min(
    width - 1,
    Math.ceil(pixelColumn + TERRAIN_RADIUS_PIXELS)
  );

  const startRow = Math.max(
    0,
    Math.floor(pixelRow - TERRAIN_RADIUS_PIXELS)
  );

  const endRow = Math.min(
    height - 1,
    Math.ceil(pixelRow + TERRAIN_RADIUS_PIXELS)
  );

  const columns = endColumn - startColumn + 1;
  const rows = endRow - startRow + 1;

  if (columns < 2 || rows < 2) {
    throw new Error(
      "Observer is too close to the raster boundary."
    );
  }

  const vertexCount = columns * rows;

  const positions = new Float32Array(vertexCount * 3);

  const indices = new Uint32Array(
    (columns - 1) * (rows - 1) * 6
  );

  for (let row = 0; row < rows; row++) {
    const rasterRow = startRow + row;
    const z = (rasterRow - pixelRow) * spacingZ;

    for (let column = 0; column < columns; column++) {
      const rasterColumn = startColumn + column;

      const rasterIndex =
        rasterRow * width + rasterColumn;

      const vertexIndex = row * columns + column;
      const offset = vertexIndex * 3;

      const elevation = elevations[rasterIndex];

      if (!Number.isFinite(elevation)) {
        throw new Error(
          `Invalid NASA elevation at pixel ${rasterColumn}, ${rasterRow}.`
        );
      }

      const x = (rasterColumn - pixelColumn) * spacingX;

      const curvature =
        (x * x + z * z) / (2 * LUNAR_RADIUS_METERS);

      positions[offset] = x;
      positions[offset + 1] =
        elevation - centerElevation - curvature;
      positions[offset + 2] = z;
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

  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3)
  );

  geometry.setIndex(
    new THREE.BufferAttribute(indices, 1)
  );

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
}: {
  terrain: LolaTerrainData;
  pixelColumn: number;
  pixelRow: number;
}) {
  const geometry = useMemo(
    () =>
      createLunarGeometry(
        terrain,
        pixelColumn,
        pixelRow
      ),
    [terrain, pixelColumn, pixelRow]
  );

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: LUNAR_REGOLITH_COLOR,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    []
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  return (
    <mesh
      geometry={geometry}
      material={material}
      castShadow
      receiveShadow
      frustumCulled={false}
    />
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
    float pulse =
      0.88 + 0.12 * sin(uTime * 0.55 + aPhase);

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
}: {
  look: RefObject<LookState>;
}) {
  useFrame(({ camera }) => {
    camera.layers.enable(1);

    camera.position.set(
      0,
      OBSERVER_HEIGHT_METERS,
      0
    );

    camera.rotation.order = "YXZ";
    camera.rotation.y = look.current.yaw;
    camera.rotation.x = look.current.pitch;
    camera.rotation.z = 0;
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

      <ObserverCamera look={look} />
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
  });

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

    async function loadJplHorizons() {
      try {
        const query = new URLSearchParams({
          date: missionDate,
          time: missionTime,
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
          throw new Error(
            result.error ||
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
          console.error(
            "[LUNAPATH] JPL Horizons data unavailable:",
            error
          );
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
    horizonsRequestKey,
  ]);

  const sun = useMemo(
    () => getFirstObservation(horizons?.targets?.sun),
    [horizons]
  );

  const earth = useMemo(
    () => getFirstObservation(horizons?.targets?.earth),
    [horizons]
  );

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

    look.current.yaw -= dx * 0.0035;

    look.current.pitch = clamp(
      look.current.pitch - dy * 0.0035,
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

        <ambientLight
          color="#a9a9a4"
          intensity={0.14}
        />

        <hemisphereLight
          args={["#b9b9b5", "#3c3c3a", 0.22]}
        />

        <LunarScene
          terrain={terrain}
          pixelColumn={pixelColumn}
          pixelRow={pixelRow}
          look={look}
          sun={sun}
          earth={earth}
          observer={observer}
        />
      </Canvas>

      <div className="pointer-events-none absolute left-5 top-5 z-40 w-[min(390px,calc(100vw-2.5rem))] border border-white/15 bg-black/75 p-4 text-white shadow-xl backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[9px] font-semibold tracking-[0.18em] text-white/60">
            NASA / JPL HORIZONS
          </p>

          <span className="text-[9px] tracking-wider text-white/40">
            {horizons ? "RESPONSE RECEIVED" : "NO RESPONSE"}
          </span>
        </div>

        <p className="mt-2 text-[10px] text-white/40">
          Mission time: {missionDate} {missionTime} UTC
        </p>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-wider text-amber-200">
              SUN
            </p>

            <p className="mt-2 text-[10px] leading-5 text-white/75">
              {getTerrainVisibilityLabel(sun)}
            </p>

            <p className="mt-2 text-[9px] text-white/35">
              JPL: {sun?.time ?? "Unavailable"}
            </p>
          </div>

          <div>
            <p className="text-[10px] font-semibold tracking-wider text-blue-200">
              EARTH
            </p>

            <p className="mt-2 text-[10px] leading-5 text-white/75">
              {getTerrainVisibilityLabel(earth)}
            </p>

            <p className="mt-2 text-[9px] text-white/35">
              JPL: {earth?.time ?? "Unavailable"}
            </p>
          </div>
        </div>
      </div>

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
