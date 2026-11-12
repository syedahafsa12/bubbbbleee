"use client";

import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";

type Site04Metadata = {
  width: number;
  height: number;
  minElevation: number;
  maxElevation: number;
  resolutionMeters: number;
  bbox: [number, number, number, number];
  pixelResolution: [number, number, number];
  coordinateSystem: {
    projection: string;
    referenceFrame: string;
    ephemeris: string;
    linearUnits: string;
    pixelRegistration: string;
  };
  georeferencing: {
    tiePoint: { column: number; row: number; x: number; y: number };
    centralMeridianDegrees: number;
    lunarRadiusMeters: number;
  };
  dataType: string;
  byteOrder: string;
};

type TerrainState =
  | { status: "loading"; message: string }
  | { status: "error"; message: string }
  | {
      status: "ready";
      geometry: THREE.BufferGeometry;
      metadata: Site04Metadata;
      displayResolutionMeters: number;
      validCells: number;
      totalCells: number;
    };

function buildDisplayGeometry(
  buffer: ArrayBuffer,
  metadata: Site04Metadata
): {
  geometry: THREE.BufferGeometry;
  displayResolutionMeters: number;
  validCells: number;
  totalCells: number;
} {
  const expectedBytes = metadata.width * metadata.height * Float32Array.BYTES_PER_ELEMENT;

  if (buffer.byteLength !== expectedBytes) {
    throw new Error(
      `Terrain binary size mismatch. Expected ${expectedBytes.toLocaleString()} bytes, received ${buffer.byteLength.toLocaleString()}.`
    );
  }

  const stride = Math.max(1, Math.ceil(Math.max(metadata.width, metadata.height) / 180));
  const columns = Math.ceil((metadata.width - 1) / stride) + 1;
  const rows = Math.ceil((metadata.height - 1) / stride) + 1;
  const vertexCount = columns * rows;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const valid = new Uint8Array(vertexCount);
  const view = new DataView(buffer);
  const low = new THREE.Color("#283d47");
  const middle = new THREE.Color("#7a7468");
  const high = new THREE.Color("#d2c5a8");
  const color = new THREE.Color();

  let validVertices = 0;

  for (let row = 0; row < rows; row += 1) {
    const sourceRow = Math.min(row * stride, metadata.height - 1);

    for (let column = 0; column < columns; column += 1) {
      const sourceColumn = Math.min(column * stride, metadata.width - 1);
      const sourceIndex = sourceRow * metadata.width + sourceColumn;
      const vertexIndex = row * columns + column;
      const elevation = view.getFloat32(sourceIndex * 4, true);

      // Do not let non-finite or metadata-out-of-range values create
      // artificial spikes in the display mesh. Invalid vertices are
      // left out of the triangle index below.
      const isValid =
        Number.isFinite(elevation) &&
        elevation >= metadata.minElevation - 5 &&
        elevation <= metadata.maxElevation + 5;

      const xKm = (sourceColumn - (metadata.width - 1) / 2) *
        metadata.resolutionMeters / 1000;
      const zKm = (sourceRow - (metadata.height - 1) / 2) *
        metadata.resolutionMeters / 1000;
      const yKm = isValid ? elevation / 1000 : 0;

      positions[vertexIndex * 3] = xKm;
      positions[vertexIndex * 3 + 1] = yKm;
      positions[vertexIndex * 3 + 2] = zKm;
      valid[vertexIndex] = isValid ? 1 : 0;

      if (isValid) {
        validVertices += 1;
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

      if (!valid[a] || !valid[b] || !valid[c] || !valid[d]) {
        continue;
      }

      // Counter-clockwise winding when viewed from above (+Y).
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

  return {
    geometry,
    displayResolutionMeters: metadata.resolutionMeters * stride,
    validCells,
    totalCells,
  };
}

function TerrainMesh({ geometry }: { geometry: THREE.BufferGeometry }) {
  return (
    <>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial
          vertexColors
          roughness={0.92}
          metalness={0.03}
          side={THREE.DoubleSide}
        />
      </mesh>
      <Grid
        position={[0, -3.15, 0]}
        args={[26, 26]}
        cellSize={1}
        cellThickness={0.35}
        sectionSize={4}
        sectionThickness={0.75}
        fadeDistance={32}
        fadeStrength={1.5}
        infiniteGrid={false}
        cellColor="#38515b"
        sectionColor="#59717a"
      />
      <OrbitControls
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

export default function Site04Terrain() {
  const [terrain, setTerrain] = useState<TerrainState>({
    status: "loading",
    message: "Loading Site04 terrain metadata…",
  });

  useEffect(() => {
    let active = true;
    let createdGeometry: THREE.BufferGeometry | null = null;

    async function loadTerrain() {
      try {
        const metadataResponse = await fetch(
          "/data/site04_shackleton_rim/metadata.json",
          { cache: "force-cache" }
        );

        if (!metadataResponse.ok) {
          throw new Error(`Metadata request failed (${metadataResponse.status}).`);
        }

        const metadata = (await metadataResponse.json()) as Site04Metadata;

        if (
          metadata.width !== 3200 ||
          metadata.height !== 3200 ||
          metadata.dataType.toLowerCase() !== "float32" ||
          metadata.byteOrder.toLowerCase().replace(/[-_ ]/g, "") !== "littleendian"
        ) {
          throw new Error("The Site04 raster metadata does not match the expected 3200 × 3200 Float32 little-endian dataset.");
        }

        if (active) {
          setTerrain({
            status: "loading",
            message: "Loading 40.96 MB elevation raster…",
          });
        }

        const elevationResponse = await fetch(
          "/data/site04_shackleton_rim/elevation.bin",
          { cache: "force-cache" }
        );

        if (!elevationResponse.ok) {
          throw new Error(`Elevation raster request failed (${elevationResponse.status}).`);
        }

        const buffer = await elevationResponse.arrayBuffer();
        const result = buildDisplayGeometry(buffer, metadata);
        createdGeometry = result.geometry;

        if (!active) {
          result.geometry.dispose();
          return;
        }

        setTerrain({
          status: "ready",
          geometry: result.geometry,
          metadata,
          displayResolutionMeters: result.displayResolutionMeters,
          validCells: result.validCells,
          totalCells: result.totalCells,
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
        <p className="muted small">Preparing a lightweight display mesh from the local NASA LOLA raster.</p>
      </div>
    );
  }

  if (terrain.status === "error") {
    return (
      <div className="terrain-state terrain-error">
        <span className="status-dot status-dot-warning" />
        <p className="terrain-state-title">Terrain viewer unavailable</p>
        <p className="muted small">{terrain.message}</p>
        <p className="muted small">The Horizons observations and other panels can still be used independently.</p>
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
        >
          <color attach="background" args={["#08131b"]} />
          <ambientLight intensity={1.35} />
          <directionalLight
            position={[-7, 12, 8]}
            intensity={2.4}
            castShadow
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
          />
          <directionalLight position={[8, 4, -9]} intensity={0.55} />
          <TerrainMesh geometry={terrain.geometry} />
        </Canvas>
        <div className="terrain-overlay terrain-overlay-top">
          <span className="scene-chip"><span className="status-dot" /> LOCAL DEM · SITE04</span>
          <span className="scene-chip">5 m source pixels</span>
        </div>
        <div className="terrain-overlay terrain-overlay-bottom">
          <span>Drag to orbit · Scroll to zoom · Right-drag to pan</span>
          <span>16 × 16 km raster footprint</span>
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
          <span className="eyebrow">VALID CELL SHARE</span>
          <strong>{coveragePercent}%</strong>
        </div>
        <div>
          <span className="eyebrow">FRAME</span>
          <strong>{terrain.metadata.coordinateSystem.referenceFrame}</strong>
        </div>
      </div>
      <p className="terrain-footnote">
        Visual mesh is downsampled for rendering; the source raster remains 5 m/pixel.
        It is not used for scientific sampling. Finite NoData sentinels have not been independently verified.
      </p>
    </div>
  );
}
