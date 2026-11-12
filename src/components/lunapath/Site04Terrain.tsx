"use client";

import { useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import {
  geographicToLolaProjected,
  loadLolaTerrain,
  sampleLolaHeightAtLocation,
  SITE04_COORDINATES,
} from "@/components/lib/lunar/terrainData";
import type {
  LolaTerrainData,
  LolaTerrainMetadata,
} from "@/components/lib/lunar/terrainData";
import type { CelestialObservation } from "./types";

type TerrainState =
  | { status: "loading"; message: string }
  | { status: "error"; message: string }
  | {
      status: "ready";
      geometry: THREE.BufferGeometry;
      metadata: LolaTerrainMetadata;
      displayResolutionMeters: number;
      validCells: number;
      totalCells: number;
      observerPosition: [number, number, number] | null;
    };

const DISPLAY_STRIDE_PIXELS = 8;

/**
 * Builds a lightweight display mesh from the already-decoded Product78
 * terrain. The original 5 m raster remains intact in terrainData.ts and
 * is not modified by this rendering downsampling.
 *
 * Horizontal coordinates come from the raster's south-polar stereographic
 * tie point and pixel resolution, not from treating latitude/longitude as
 * a flat Cartesian grid.
 */
function buildDisplayGeometry(terrain: LolaTerrainData): {
  geometry: THREE.BufferGeometry;
  displayResolutionMeters: number;
  validCells: number;
  totalCells: number;
  observerPosition: [number, number, number] | null;
} {
  const { metadata, elevations } = terrain;
  const stride = DISPLAY_STRIDE_PIXELS;
  const columns = Math.ceil((terrain.width - 1) / stride) + 1;
  const rows = Math.ceil((terrain.height - 1) / stride) + 1;
  const vertexCount = columns * rows;

  if (elevations.length !== terrain.width * terrain.height) {
    throw new Error(
      `Product78 elevation count mismatch. Expected ${(terrain.width * terrain.height).toLocaleString()}, received ${elevations.length.toLocaleString()}.`
    );
  }

  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const valid = new Uint8Array(vertexCount);
  const low = new THREE.Color("#283d47");
  const middle = new THREE.Color("#7a7468");
  const high = new THREE.Color("#d2c5a8");
  const color = new THREE.Color();

  const tiePoint = metadata.georeferencing.tiePoint;
  const [pixelWidth, pixelHeight] = metadata.pixelResolution;
  const centerColumn = (terrain.width - 1) / 2;
  const centerRow = (terrain.height - 1) / 2;

  const centerProjectedX =
    tiePoint.x + (centerColumn - tiePoint.column) * pixelWidth;
  const centerProjectedY =
    tiePoint.y + (centerRow - tiePoint.row) * pixelHeight;

  for (let row = 0; row < rows; row += 1) {
    const sourceRow = Math.min(row * stride, terrain.height - 1);

    for (let column = 0; column < columns; column += 1) {
      const sourceColumn = Math.min(column * stride, terrain.width - 1);
      const sourceIndex = sourceRow * terrain.width + sourceColumn;
      const vertexIndex = row * columns + column;
      const elevation = elevations[sourceIndex];

      const isValid =
        Number.isFinite(elevation) &&
        elevation >= metadata.minElevation - 5 &&
        elevation <= metadata.maxElevation + 5;

      const projectedX =
        tiePoint.x + (sourceColumn - tiePoint.column) * pixelWidth;
      const projectedY =
        tiePoint.y + (sourceRow - tiePoint.row) * pixelHeight;

      // Three.js uses +Y for elevation. Invert projected Y for the scene's
      // horizontal Z axis so the raster's north/south orientation is retained.
      positions[vertexIndex * 3] =
        (projectedX - centerProjectedX) / 1000;
      positions[vertexIndex * 3 + 1] =
        isValid ? elevation / 1000 : 0;
      positions[vertexIndex * 3 + 2] =
        -(projectedY - centerProjectedY) / 1000;

      valid[vertexIndex] = isValid ? 1 : 0;

      if (isValid) {
        const t = THREE.MathUtils.clamp(
          (elevation - metadata.minElevation) /
            (metadata.maxElevation - metadata.minElevation),
          0,
          1
        );

        if (t < 0.55) {
          color.copy(low).lerp(middle, t / 0.55);
        } else {
          color.copy(middle).lerp(high, (t - 0.55) / 0.45);
        }
      } else {
        color.set("#27323a");
      }

      colors[vertexIndex * 3] = color.r;
      colors[vertexIndex * 3 + 1] = color.g;
      colors[vertexIndex * 3 + 2] = color.b;
    }
  }

  const indices: number[] = [];
  let validCells = 0;
  const totalCells = (rows - 1) * (columns - 1);

  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;

      // Skip cells touching invalid/out-of-range source samples.
      if (!valid[a] || !valid[b] || !valid[c] || !valid[d]) {
        continue;
      }

      indices.push(a, c, b, b, c, d);
      validCells += 1;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  let observerPosition: [number, number, number] | null = null;

  try {
    const observer = sampleLolaHeightAtLocation(
      terrain,
      SITE04_COORDINATES
    );
    const projectedObserver = geographicToLolaProjected(
      SITE04_COORDINATES,
      metadata
    );

    observerPosition = [
      (projectedObserver.xMeters - centerProjectedX) / 1000,
      observer.elevationMeters / 1000 + 0.025,
      -(projectedObserver.yMeters - centerProjectedY) / 1000,
    ];
  } catch (error) {
    console.warn("[LOLA] Site04 observer marker is outside valid raster coverage:", error);
  }

  return {
    geometry,
    displayResolutionMeters: metadata.resolutionMeters * stride,
    validCells,
    totalCells,
    observerPosition,
  };
}

function projectedBearingDirection(
  azimuthDeg: number,
  metadata: LolaTerrainMetadata
): THREE.Vector3 | null {
  const latitude = SITE04_COORDINATES.latitudeDeg;
  const longitude = SITE04_COORDINATES.longitudeEastDeg;
  const radius = metadata.georeferencing.lunarRadiusMeters;
  const latitudeRadians = THREE.MathUtils.degToRad(latitude);
  const cosLatitude = Math.cos(latitudeRadians);

  if (!Number.isFinite(cosLatitude) || Math.abs(cosLatitude) < 1e-8) {
    return null;
  }

  // Estimate the local north/east basis by projecting nearby points through
  // the same Product78 south-polar stereographic transform as the terrain.
  const basisStepMeters = 100;
  const northLatitude = latitude +
    THREE.MathUtils.radToDeg(basisStepMeters / radius);
  const eastLongitude = longitude +
    THREE.MathUtils.radToDeg(basisStepMeters / (radius * cosLatitude));

  try {
    const origin = geographicToLolaProjected(SITE04_COORDINATES, metadata);
    const north = geographicToLolaProjected(
      { latitudeDeg: northLatitude, longitudeEastDeg: longitude },
      metadata
    );
    const east = geographicToLolaProjected(
      { latitudeDeg: latitude, longitudeEastDeg: eastLongitude },
      metadata
    );

    const northDirection = new THREE.Vector3(
      north.xMeters - origin.xMeters,
      0,
      -(north.yMeters - origin.yMeters)
    ).normalize();

    const eastDirection = new THREE.Vector3(
      east.xMeters - origin.xMeters,
      0,
      -(east.yMeters - origin.yMeters)
    ).normalize();

    const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
    return northDirection
      .multiplyScalar(Math.cos(azimuth))
      .add(eastDirection.multiplyScalar(Math.sin(azimuth)))
      .normalize();
  } catch (error) {
    console.warn("[LOLA] Could not project celestial bearing into the local terrain view:", error);
    return null;
  }
}

function celestialSceneDirection(
  observation: CelestialObservation,
  metadata: LolaTerrainMetadata
): THREE.Vector3 | null {
  const horizontal = projectedBearingDirection(
    observation.azimuthDeg,
    metadata
  );
  if (!horizontal) return null;

  const elevation = THREE.MathUtils.degToRad(
    THREE.MathUtils.clamp(observation.elevationDeg, -89.9, 89.9)
  );

  return new THREE.Vector3(
    horizontal.x * Math.cos(elevation),
    Math.sin(elevation),
    horizontal.z * Math.cos(elevation)
  ).normalize();
}

function disposeArrowHelper(arrow: THREE.ArrowHelper) {
  arrow.line.geometry.dispose();
  arrow.cone.geometry.dispose();

  const lineMaterial = arrow.line.material;
  const coneMaterial = arrow.cone.material;

  if (Array.isArray(lineMaterial)) lineMaterial.forEach((material) => material.dispose());
  else lineMaterial.dispose();

  if (Array.isArray(coneMaterial)) coneMaterial.forEach((material) => material.dispose());
  else coneMaterial.dispose();
}

function CelestialArrow({
  observation,
  metadata,
  observerPosition,
  color,
}: {
  observation?: CelestialObservation;
  metadata: LolaTerrainMetadata;
  observerPosition: [number, number, number] | null;
  color: string;
}) {
  const arrow = useMemo(() => {
    if (!observation || !observerPosition) return null;
    const direction = celestialSceneDirection(observation, metadata);
    if (!direction) return null;

    return new THREE.ArrowHelper(
      direction,
      new THREE.Vector3(...observerPosition),
      7,
      color,
      0.55,
      0.3
    );
  }, [
    observation?.azimuthDeg,
    observation?.elevationDeg,
    observerPosition,
    metadata,
    color,
  ]);

  useEffect(() => () => {
    if (arrow) disposeArrowHelper(arrow);
  }, [arrow]);

  return arrow ? <primitive object={arrow} /> : null;
}

function CameraReset({ resetToken }: { resetToken: number }) {
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    camera.position.set(11, 8.5, 12);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, resetToken]);

  return null;
}

function TerrainCoverageOutline({ metadata }: { metadata: LolaTerrainMetadata }) {
  const geometry = useMemo(() => {
    const [minX, minY, maxX, maxY] = metadata.bbox;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const baseY = metadata.minElevation / 1000 - 0.08;
    const points = [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ].map(([x, y]) => new THREE.Vector3(
      (x - centerX) / 1000,
      baseY,
      -(y - centerY) / 1000
    ));

    return new THREE.BufferGeometry().setFromPoints(points);
  }, [metadata]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineLoop geometry={geometry}>
      <lineBasicMaterial color="#70d8c6" transparent opacity={0.9} />
    </lineLoop>
  );
}

function TerrainMesh({
  geometry,
  observerPosition,
  metadata,
  resetToken,
  sun,
  earth,
}: {
  geometry: THREE.BufferGeometry;
  observerPosition: [number, number, number] | null;
  metadata: LolaTerrainMetadata;
  resetToken: number;
  sun?: CelestialObservation;
  earth?: CelestialObservation;
}) {
  const sunDirection = useMemo(
    () => sun ? celestialSceneDirection(sun, metadata) : null,
    [sun?.azimuthDeg, sun?.elevationDeg, metadata]
  );
  const sunLightPosition = sunDirection && observerPosition
    ? [
        observerPosition[0] + sunDirection.x * 12,
        observerPosition[1] + sunDirection.y * 12,
        observerPosition[2] + sunDirection.z * 12,
      ] as [number, number, number]
    : null;
  return (
    <>
      <CameraReset resetToken={resetToken} />
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial
          vertexColors
          roughness={0.92}
          metalness={0.03}
          side={THREE.DoubleSide}
        />
      </mesh>
      {observerPosition && (
        <group position={observerPosition}>
          <mesh>
            <sphereGeometry args={[0.14, 16, 16]} />
            <meshBasicMaterial color="#f0a34b" />
          </mesh>
          <mesh position={[0, 0.2, 0]}>
            <coneGeometry args={[0.1, 0.24, 8]} />
            <meshBasicMaterial color="#f0a34b" />
          </mesh>
        </group>
      )}
      <TerrainCoverageOutline metadata={metadata} />
      <CelestialArrow
        observation={sun}
        metadata={metadata}
        observerPosition={observerPosition}
        color="#f1b65d"
      />
      <CelestialArrow
        observation={earth}
        metadata={metadata}
        observerPosition={observerPosition}
        color="#72cce8"
      />
      {sunLightPosition && (
        <directionalLight
          position={sunLightPosition}
          intensity={sun && sun.elevationDeg > 0 ? 2.3 : 0.08}
          castShadow={Boolean(sun && sun.elevationDeg > 0)}
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
      )}
      <gridHelper
        position={[0, -3.15, 0]}
        args={[26, 26, "#59717a", "#38515b"]}
      />
      <OrbitControls
        key={resetToken}
        makeDefault
        minDistance={7}
        maxDistance={34}
        maxPolarAngle={Math.PI / 2.04}
        enableDamping
        dampingFactor={0.08}
      />
    </>
  );
}

export default function Site04Terrain({ sun, earth }: { sun?: CelestialObservation; earth?: CelestialObservation }) {
  const [cameraResetToken, setCameraResetToken] = useState(0);
  const [terrain, setTerrain] = useState<TerrainState>({
    status: "loading",
    message: "Loading NASA Product78 Site04 terrain…",
  });

  useEffect(() => {
    let active = true;
    let createdGeometry: THREE.BufferGeometry | null = null;

    async function loadTerrain() {
      try {
        // Reuse the validated Product78 loader; do not decode elevation.bin
        // a second time inside the visualization component.
        const terrainData = await loadLolaTerrain();
        const result = buildDisplayGeometry(terrainData);
        createdGeometry = result.geometry;

        if (!active) {
          result.geometry.dispose();
          return;
        }

        setTerrain({
          status: "ready",
          geometry: result.geometry,
          metadata: terrainData.metadata,
          displayResolutionMeters: result.displayResolutionMeters,
          validCells: result.validCells,
          totalCells: result.totalCells,
          observerPosition: result.observerPosition,
        });
      } catch (error) {
        if (!active) return;

        setTerrain({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load Site04 terrain.",
        });
      }
    }

    void loadTerrain();

    return () => {
      active = false;
      createdGeometry?.dispose();
    };
  }, []);

  if (terrain.status === "loading") {
    return (
      <div className="terrain-state">
        <div className="loading-orbit" />
        <p className="terrain-state-title">{terrain.message}</p>
        <p className="muted small">Preparing a lightweight display mesh from the validated NASA LOLA raster.</p>
      </div>
    );
  }

  if (terrain.status === "error") {
    return (
      <div className="terrain-state terrain-error">
        <span className="status-dot status-dot-warning" />
        <p className="terrain-state-title">Terrain viewer unavailable</p>
        <p className="muted small">{terrain.message}</p>
        <p className="muted small">The JPL Sun/Earth observations and timeline remain independent of terrain loading.</p>
      </div>
    );
  }

  const coveragePercent = Math.round(
    (terrain.validCells / Math.max(1, terrain.totalCells)) * 100
  );

  return (
    <div className="terrain-viewer-wrap">
      <div className="terrain-canvas">
        <Canvas
          camera={{ position: [11, 8.5, 12], fov: 42, near: 0.1, far: 100 }}
          dpr={[1, 1.6]}
          gl={{ antialias: true, alpha: false }}
          shadows
        >
          <color attach="background" args={["#08131b"]} />
          <ambientLight intensity={1.15} />
          <directionalLight position={[8, 4, -9]} intensity={0.35} />
          <TerrainMesh
            geometry={terrain.geometry}
            observerPosition={terrain.observerPosition}
            metadata={terrain.metadata}
            resetToken={cameraResetToken}
            sun={sun}
            earth={earth}
          />
        </Canvas>
        <div className="terrain-overlay terrain-overlay-top">
          <span className="scene-chip"><span className="status-dot" /> PRODUCT78 · SITE04</span>
          <span className="scene-chip">5 m source pixels</span>
          <button
            type="button"
            className="terrain-view-reset"
            onClick={() => setCameraResetToken((token) => token + 1)}
            aria-label="Reset terrain camera view"
          >
            RESET VIEW ↺
          </button>
        </div>
        <div className="terrain-overlay terrain-overlay-bottom">
          <span>Drag to orbit · Scroll to zoom · Right-drag to pan</span>
          <span>TEAL OUTLINE · PRODUCT78 RASTER FOOTPRINT</span>
        </div>
      </div>

      <div className="terrain-meta-strip">
        <div>
          <span className="eyebrow">DISPLAY GRID</span>
          <strong>≈ {Math.round(terrain.displayResolutionMeters)} m</strong>
        </div>
        <div>
          <span className="eyebrow">MESH CELLS</span>
          <strong>{terrain.validCells.toLocaleString()}</strong>
        </div>
        <div>
          <span className="eyebrow">OBSERVER</span>
          <strong>{terrain.observerPosition ? "MARKED" : "UNAVAILABLE"}</strong>
        </div>
        <div>
          <span className="eyebrow">REFERENCE FRAME</span>
          <strong>{terrain.metadata.coordinateSystem.referenceFrame}</strong>
        </div>
      </div>
      <p className="terrain-footnote">
        The display mesh samples every 8th raster pixel (about 40 m); the original NASA Product78 raster remains at 5 m/pixel.
        Horizontal placement uses the metadata tie point and south-polar stereographic pixel resolution.
        Vertical scale is 1×. The orange marker identifies the Site04 observer location.
      </p>
    </div>
  );
}
