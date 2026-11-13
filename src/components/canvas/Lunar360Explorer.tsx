
"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";

import { Canvas, useFrame } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import * as THREE from "three";

import {
  loadLolaTerrain,
  sampleLolaHeightAtPixel,
  type LolaTerrainData,
} from "@/components/lib/lunar/terrainData";

import {
  calculateEphemeris,
  type CelestialEphemeris,
} from "@/components/lib/lunar/ephemeris";

interface Lunar360ExplorerProps {
  latitude: number;
  longitude: number;
  pixelColumn: number;
  pixelRow: number;
  missionDate: string;
  missionTime: string;
}

interface LookState {
  yaw: number;
  pitch: number;
}

interface TerrainMeshData {
  geometry: THREE.BufferGeometry;
  centerElevation: number;
  minSlope: number;
  maxSlope: number;
}

const GRID_SEGMENTS = 1024;
const MAX_RADIUS_PIXELS = 700;

const OBSERVER_HEIGHT_METERS = 1.7;
const LUNAR_RADIUS_METERS = 1_737_400;

const CELESTIAL_DISPLAY_DISTANCE = 8000;

// Slope colours are an analytical visualization of measured elevations.
// They do not modify the terrain geometry.
const SLOPE_STOPS = [
  { degrees: 0, color: new THREE.Color("#285b9a") },
  { degrees: 5, color: new THREE.Color("#319b91") },
  { degrees: 15, color: new THREE.Color("#d4c65b") },
  { degrees: 30, color: new THREE.Color("#d87942") },
  { degrees: 45, color: new THREE.Color("#bd4545") },
];

function getSlopeColor(
  degrees: number,
  target: THREE.Color
): THREE.Color {
  const value = THREE.MathUtils.clamp(degrees, 0, 45);

  for (let i = 0; i < SLOPE_STOPS.length - 1; i++) {
    const current = SLOPE_STOPS[i];
    const next = SLOPE_STOPS[i + 1];

    if (
      value >= current.degrees &&
      value <= next.degrees
    ) {
      const amount =
        (value - current.degrees) /
        (next.degrees - current.degrees);

      return target
        .copy(current.color)
        .lerp(next.color, amount);
    }
  }

  return target.copy(SLOPE_STOPS[SLOPE_STOPS.length - 1].color);
}

function createTerrainGeometry(
  terrain: LolaTerrainData,
  pixelColumn: number,
  pixelRow: number
): TerrainMeshData {
  const metadata = terrain.metadata;

  const pixelWidth = Math.abs(metadata.pixelResolution[0]);
  const pixelHeight = Math.abs(metadata.pixelResolution[1]);

  const availableRadius = Math.min(
    pixelColumn,
    terrain.width - 1 - pixelColumn,
    pixelRow,
    terrain.height - 1 - pixelRow
  );

  const radiusPixels = Math.min(
    MAX_RADIUS_PIXELS,
    Math.floor(availableRadius)
  );

  if (radiusPixels < 2) {
    throw new Error(
      "Selected pixel is too close to the Product 78 raster boundary."
    );
  }

  const centerElevation = sampleLolaHeightAtPixel(terrain, {
    column: pixelColumn,
    row: pixelRow,
  });

  if (!Number.isFinite(centerElevation)) {
    throw new Error(
      "Unable to sample elevation at the selected location."
    );
  }

  const side = GRID_SEGMENTS + 1;
  const vertexCount = side * side;

  const positions = new Float32Array(vertexCount * 3);
  const elevations = new Float32Array(vertexCount);
  const colors = new Float32Array(vertexCount * 3);

  // Uint32Array avoids the large temporary JavaScript number array.
  const indices = new Uint32Array(
    GRID_SEGMENTS * GRID_SEGMENTS * 6
  );

  const xSpacing =
    (2 * radiusPixels * pixelWidth) / GRID_SEGMENTS;

  const zSpacing =
    (2 * radiusPixels * pixelHeight) / GRID_SEGMENTS;

  // First pass: sample the actual LOLA elevation raster.
  for (let row = 0; row <= GRID_SEGMENTS; row++) {
    const v = row / GRID_SEGMENTS;

    for (let column = 0; column <= GRID_SEGMENTS; column++) {
      const u = column / GRID_SEGMENTS;

      const rasterColumn =
        pixelColumn + (u * 2 - 1) * radiusPixels;

      const rasterRow =
        pixelRow + (v * 2 - 1) * radiusPixels;

      const sampledElevation = sampleLolaHeightAtPixel(
        terrain,
        {
          column: rasterColumn,
          row: rasterRow,
        }
      );

      const elevation = Number.isFinite(sampledElevation)
        ? sampledElevation
        : centerElevation;

      const x = (rasterColumn - pixelColumn) * pixelWidth;
      const z = (rasterRow - pixelRow) * pixelHeight;

      // Lunar curvature in the local tangent-plane representation.
      const curvatureDrop =
        (x * x + z * z) / (2 * LUNAR_RADIUS_METERS);

      const relativeElevation =
        elevation - centerElevation;

      const index = row * side + column;
      const positionOffset = index * 3;

      positions[positionOffset] = x;
      positions[positionOffset + 1] =
        relativeElevation - curvatureDrop;
      positions[positionOffset + 2] = z;

      elevations[index] = relativeElevation;
    }
  }

  // Second pass: calculate actual slope from neighbouring DEM samples.
  // The gradient is calculated from elevation, not artificial geometry.
  const slopeColor = new THREE.Color();

  let minSlope = Number.POSITIVE_INFINITY;
  let maxSlope = Number.NEGATIVE_INFINITY;

  for (let row = 0; row <= GRID_SEGMENTS; row++) {
    const previousRow = Math.max(0, row - 1);
    const nextRow = Math.min(GRID_SEGMENTS, row + 1);

    for (let column = 0; column <= GRID_SEGMENTS; column++) {
      const previousColumn = Math.max(0, column - 1);
      const nextColumn = Math.min(
        GRID_SEGMENTS,
        column + 1
      );

      const centerIndex = row * side + column;

      const leftIndex = row * side + previousColumn;
      const rightIndex = row * side + nextColumn;

      const upperIndex = previousRow * side + column;
      const lowerIndex = nextRow * side + column;

      const horizontalDistance =
        (nextColumn - previousColumn) * xSpacing;

      const verticalDistance =
        (nextRow - previousRow) * zSpacing;

      const dzdx =
        horizontalDistance > 0
          ? (elevations[rightIndex] - elevations[leftIndex]) /
            horizontalDistance
          : 0;

      const dzdz =
        verticalDistance > 0
          ? (elevations[lowerIndex] - elevations[upperIndex]) /
            verticalDistance
          : 0;

      const slopeRadians = Math.atan(
        Math.sqrt(dzdx * dzdx + dzdz * dzdz)
      );

      const slopeDegrees =
        slopeRadians * (180 / Math.PI);

      minSlope = Math.min(minSlope, slopeDegrees);
      maxSlope = Math.max(maxSlope, slopeDegrees);

      const color = getSlopeColor(
        slopeDegrees,
        slopeColor
      );

      const colorOffset = centerIndex * 3;

      colors[colorOffset] = color.r;
      colors[colorOffset + 1] = color.g;
      colors[colorOffset + 2] = color.b;
    }
  }

  // Third pass: construct the terrain mesh.
  let indexOffset = 0;

  for (let row = 0; row < GRID_SEGMENTS; row++) {
    for (let column = 0; column < GRID_SEGMENTS; column++) {
      const a = row * side + column;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;

      indices[indexOffset++] = a;
      indices[indexOffset++] = c;
      indices[indexOffset++] = b;

      indices[indexOffset++] = b;
      indices[indexOffset++] = c;
      indices[indexOffset++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3)
  );

  geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(colors, 3)
  );

  geometry.setIndex(
    new THREE.BufferAttribute(indices, 1)
  );

  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return {
    geometry,
    centerElevation,
    minSlope,
    maxSlope,
  };
}

function Product78Terrain({
  terrain,
  pixelColumn,
  pixelRow,
  slopeMode,
}: {
  terrain: LolaTerrainData;
  pixelColumn: number;
  pixelRow: number;
  slopeMode: boolean;
}) {
  const terrainData = useMemo(
    () =>
      createTerrainGeometry(
        terrain,
        pixelColumn,
        pixelRow
      ),
    [terrain, pixelColumn, pixelRow]
  );

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: slopeMode ? "#ffffff" : "#92928D",
        vertexColors: slopeMode,
        roughness: 1,
        metalness: 0,
        side: THREE.FrontSide,
      }),
    [slopeMode]
  );

  useEffect(() => {
    return () => {
      terrainData.geometry.dispose();
      material.dispose();
    };
  }, [terrainData, material]);

  return (
    <mesh
      geometry={terrainData.geometry}
      material={material}
      castShadow
      receiveShadow
    />
  );
}

function toSceneDirection(
  direction: CelestialEphemeris["sunDirection"]
): THREE.Vector3 {
  return new THREE.Vector3(
    direction.east,
    direction.up,
    -direction.north
  ).normalize();
}

function CelestialBodies({
  ephemeris,
}: {
  ephemeris: CelestialEphemeris;
}) {
  const sunDirection = useMemo(
    () => toSceneDirection(ephemeris.sunDirection),
    [ephemeris.sunDirection]
  );

  const earthDirection = useMemo(
    () => toSceneDirection(ephemeris.earthDirection),
    [ephemeris.earthDirection]
  );

  const sunPosition = useMemo(
    () =>
      sunDirection
        .clone()
        .multiplyScalar(CELESTIAL_DISPLAY_DISTANCE),
    [sunDirection]
  );

  const earthPosition = useMemo(
    () =>
      earthDirection
        .clone()
        .multiplyScalar(CELESTIAL_DISPLAY_DISTANCE),
    [earthDirection]
  );

  const sunRadius =
    CELESTIAL_DISPLAY_DISTANCE *
    Math.tan(0.2666 * Math.PI / 180);

  const earthRadius =
    CELESTIAL_DISPLAY_DISTANCE *
    Math.tan(ephemeris.earthAngularRadius);

  return (
    <>
      {ephemeris.sunElevation > 0 && (
        <directionalLight
          color="#fff8e8"
          intensity={2.0}
          position={sunPosition}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-4000}
          shadow-camera-right={4000}
          shadow-camera-top={4000}
          shadow-camera-bottom={-4000}
          shadow-camera-near={0.1}
          shadow-camera-far={12000}
          shadow-bias={-0.0001}
          shadow-normalBias={0.02}
        />
      )}

      {ephemeris.isSunVisible && (
        <mesh position={sunPosition}>
          <sphereGeometry args={[sunRadius, 48, 32]} />

          <meshBasicMaterial
            color="#fff2d5"
            toneMapped={false}
          />
        </mesh>
      )}

      {ephemeris.isEarthVisible && (
        <mesh position={earthPosition}>
          <sphereGeometry args={[earthRadius, 64, 48]} />

          <meshStandardMaterial
            color="#477fae"
            emissive="#10243a"
            emissiveIntensity={0.25}
            roughness={0.9}
            metalness={0}
          />
        </mesh>
      )}
    </>
  );
}

function ObserverCamera({
  look,
}: {
  look: RefObject<LookState>;
}) {
  useFrame(({ camera }) => {
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

function LunarScene({
  terrain,
  pixelColumn,
  pixelRow,
  look,
  ephemeris,
  slopeMode,
}: {
  terrain: LolaTerrainData;
  pixelColumn: number;
  pixelRow: number;
  look: RefObject<LookState>;
  ephemeris: CelestialEphemeris | null;
  slopeMode: boolean;
}) {
  return (
    <>
      <color attach="background" args={["#020306"]} />

      <fog attach="fog" args={["#020306", 3500, 12000]} />

      <ambientLight intensity={0.3} />

      <hemisphereLight
        color="#D8D8D2"
        groundColor="#454541"
        intensity={0.25}
      />

      <Stars
        radius={14000}
        depth={3000}
        count={2600}
        factor={3}
        saturation={0}
        fade
        speed={0}
      />

      {ephemeris && (
        <CelestialBodies ephemeris={ephemeris} />
      )}

      <Product78Terrain
        terrain={terrain}
        pixelColumn={pixelColumn}
        pixelRow={pixelRow}
        slopeMode={slopeMode}
      />

      <ObserverCamera look={look} />
    </>
  );
}

function formatDegrees(radians: number): string {
  return `${(
    radians * 180 / Math.PI
  ).toFixed(1)}°`;
}

export default function Lunar360Explorer({
  latitude,
  longitude,
  pixelColumn,
  pixelRow,
  missionDate,
  missionTime,
}: Lunar360ExplorerProps) {
  const [terrain, setTerrain] =
    useState<LolaTerrainData | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [slopeMode, setSlopeMode] = useState(false);

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

  const ephemeris = useMemo(() => {
    if (
      !missionDate ||
      missionDate === "NOT SET" ||
      !missionTime
    ) {
      return null;
    }

    const date = new Date(
      `${missionDate}T${missionTime}:00Z`
    );

    if (!Number.isFinite(date.getTime())) {
      return null;
    }

    try {
      return calculateEphemeris(
        date,
        latitude,
        longitude
      );
    } catch {
      return null;
    }
  }, [
    missionDate,
    missionTime,
    latitude,
    longitude,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        setLoading(true);
        setError(null);

        const data = await loadLolaTerrain();

        if (cancelled) return;

        if (
          !Number.isFinite(pixelColumn) ||
          !Number.isFinite(pixelRow) ||
          pixelColumn < 0 ||
          pixelRow < 0 ||
          pixelColumn >= data.width ||
          pixelRow >= data.height
        ) {
          throw new Error(
            "The selected raster pixel is outside Product 78 coverage."
          );
        }

        setTerrain(data);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load Product 78 terrain."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, [pixelColumn, pixelRow]);

  function handlePointerDown(
    event: ReactPointerEvent<HTMLDivElement>
  ) {
    pointer.current = {
      active: true,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };

    event.currentTarget.setPointerCapture(
      event.pointerId
    );

    setDragging(true);
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

    const deltaX =
      event.clientX - pointer.current.x;

    const deltaY =
      event.clientY - pointer.current.y;

    pointer.current.x = event.clientX;
    pointer.current.y = event.clientY;

    look.current.yaw -= deltaX * 0.0035;
    look.current.pitch -= deltaY * 0.0035;

    look.current.pitch = THREE.MathUtils.clamp(
      look.current.pitch,
      -Math.PI / 2 + 0.02,
      Math.PI / 2 - 0.02
    );
  }

  function handlePointerUp(
    event: ReactPointerEvent<HTMLDivElement>
  ) {
    if (
      pointer.current.pointerId !== event.pointerId
    ) {
      return;
    }

    pointer.current.active = false;
    pointer.current.pointerId = -1;

    setDragging(false);
  }

  function handlePointerCancel() {
    pointer.current.active = false;
    pointer.current.pointerId = -1;

    setDragging(false);
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#030406] text-white">
        <div className="w-[min(320px,80vw)]">
          <p className="text-[10px] tracking-[0.3em] text-white/45">
            LOADING PRODUCT 78
          </p>

          <div className="mt-5 h-px overflow-hidden bg-white/10">
            <div className="h-full w-1/2 animate-pulse bg-white/70" />
          </div>

          <p className="mt-4 text-xs text-white/40">
            Loading Shackleton Rim elevation data...
          </p>
        </div>
      </main>
    );
  }

  if (error || !terrain) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#030406] px-6 text-center text-white">
        <div className="max-w-lg">
          <p className="text-[10px] tracking-[0.3em] text-red-300/70">
            TERRAIN LOAD FAILED
          </p>

          <p className="mt-4 text-sm leading-6 text-white/60">
            {error || "Product 78 terrain is unavailable."}
          </p>

          <a
            href="/map"
            className="mt-6 inline-flex border border-white/20 px-5 py-3 text-[10px] tracking-[0.2em] text-white/75 hover:border-white/50"
          >
            RETURN TO MISSION PLANNER
          </a>
        </div>
      </main>
    );
  }

  return (
    <main
      className="relative h-[100dvh] min-h-[480px] w-full touch-none select-none overflow-hidden bg-[#030406]"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <Canvas
        shadows
        camera={{
          position: [
            0,
            OBSERVER_HEIGHT_METERS,
            0,
          ],
          fov: 78,
          near: 0.05,
          far: 18000,
        }}
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        }}
      >
        <LunarScene
          terrain={terrain}
          pixelColumn={pixelColumn}
          pixelRow={pixelRow}
          look={look}
          ephemeris={ephemeris}
          slopeMode={slopeMode}
        />
      </Canvas>

      <div className="pointer-events-none absolute left-5 top-5 z-10">
        <p className="text-[9px] tracking-[0.28em] text-white/45">
          LUNAPATH / SURFACE OBSERVATION
        </p>

        <p className="mt-2 text-sm font-medium text-white/85">
          Shackleton Rim
        </p>

        <p className="mt-1 font-mono text-[10px] text-white/45">
          {latitude.toFixed(5)}° / {longitude.toFixed(5)}° E
        </p>
      </div>

      <div className="absolute left-5 top-[105px] z-20 pointer-events-auto">
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setSlopeMode((current) => !current)}
          aria-pressed={slopeMode}
          className="border border-white/20 bg-black/65 px-3 py-2 text-[9px] tracking-[0.16em] text-white/80 backdrop-blur hover:border-white/50"
        >
          {slopeMode ? "SHOW NATURAL SURFACE" : "SHOW SLOPE ANALYSIS"}
        </button>
      </div>

      {slopeMode && (
        <div className="pointer-events-none absolute left-5 top-[150px] z-10 w-[190px] border border-white/10 bg-black/65 p-3 backdrop-blur">
          <p className="text-[9px] tracking-[0.18em] text-white/75">
            LOLA DERIVED SLOPE
          </p>

          <div
            className="mt-3 h-2 w-full"
            style={{
              background:
                "linear-gradient(to right, #285b9a, #319b91, #d4c65b, #d87942, #bd4545)",
            }}
          />

          <div className="mt-2 flex justify-between font-mono text-[9px] text-white/55">
            <span>0°</span>
            <span>5°</span>
            <span>15°</span>
            <span>30°</span>
            <span>45°+</span>
          </div>

          <p className="mt-2 text-[9px] leading-4 text-white/40">
            Slope calculated from neighbouring elevation samples.
          </p>
        </div>
      )}

      <div className="pointer-events-none absolute right-5 top-5 z-10 text-right">
        <p className="text-[9px] tracking-[0.2em] text-white/40">
          MISSION UTC
        </p>

        <p className="mt-2 font-mono text-xs text-white/70">
          {missionDate} · {missionTime}
        </p>

        {ephemeris ? (
          <div className="mt-4 space-y-2">
            <div>
              <p className="text-[9px] tracking-[0.15em] text-white/35">
                SUN · AZ / EL
              </p>

              <p className="mt-1 font-mono text-[10px] text-white/65">
                {formatDegrees(ephemeris.sunAzimuth)} /{" "}
                {formatDegrees(ephemeris.sunElevation)}
              </p>

              <p className="mt-1 text-[9px] text-white/35">
                {ephemeris.isSunVisible
                  ? "ABOVE GEOMETRIC HORIZON"
                  : "BELOW GEOMETRIC HORIZON"}
              </p>
            </div>

            <div>
              <p className="text-[9px] tracking-[0.15em] text-white/35">
                EARTH · AZ / EL
              </p>

              <p className="mt-1 font-mono text-[10px] text-white/65">
                {formatDegrees(ephemeris.earthAzimuth)} /{" "}
                {formatDegrees(ephemeris.earthElevation)}
              </p>

              <p className="mt-1 text-[9px] text-white/35">
                {ephemeris.isEarthVisible
                  ? "VISIBLE AT GEOMETRIC HORIZON"
                  : "BELOW GEOMETRIC HORIZON"}
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[9px] text-amber-200/60">
            MISSION TIME UNAVAILABLE
          </p>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-7 left-1/2 z-10 -translate-x-1/2 text-center">
        <p className="text-[9px] tracking-[0.25em] text-white/65">
          {dragging
            ? "LOOKING AROUND"
            : "DRAG TO LOOK AROUND"}
        </p>

        <p className="mt-2 text-[9px] text-white/30">
          FIXED OBSERVATION POINT · NO MOVEMENT
        </p>
      </div>

      <a
        href="/map"
        onPointerDown={(event) => event.stopPropagation()}
        className="absolute bottom-6 left-5 z-20 border border-white/15 bg-black/40 px-4 py-3 text-[9px] tracking-[0.18em] text-white/65 backdrop-blur hover:border-white/40 hover:text-white"
      >
        BACK TO PLANNER
      </a>

      <div className="pointer-events-none absolute bottom-6 right-5 z-10 text-right">
        <p className="text-[9px] tracking-[0.15em] text-white/35">
          NASA LOLA · PRODUCT 78
        </p>

        <p className="mt-1 text-[9px] text-white/25">
          5 METRE / PIXEL SOURCE DATA
        </p>
      </div>
    </main>
  );
}
