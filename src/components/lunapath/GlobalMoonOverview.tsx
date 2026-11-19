"use client";

import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { fromUrl } from "geotiff";
import * as THREE from "three";
import type { Product78SiteStatus } from "./types";

// NASA CGI Moon Kit: LROC colour mosaic + global LOLA displacement map.
// The global model is for orientation only; Product78 remains the local
// landing-site terrain source and the basis of all local calculations.
const LUNAR_COLOR_MAP_URL =
  "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg";
const LUNAR_ELEVATION_MAP_URL =
  "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16_uint.tif";

const LUNAR_REFERENCE_RADIUS_METERS = 1_737_400;
const LUNAR_UNSIGNED_HEIGHT_BASE_METERS = 1_727_400;
const LUNAR_UNSIGNED_HEIGHT_STEP_METERS = 0.5;
const GLOBAL_LONGITUDE_SEGMENTS = 720;
const GLOBAL_LATITUDE_SEGMENTS = 360;

type Props = {
  sites: Product78SiteStatus[];
  selectedSite: Product78SiteStatus | null;
};

type GlobalMoonModel = {
  geometry: THREE.BufferGeometry;
  width: number;
  height: number;
};

function latLonToSpherePosition(
  latitudeDeg: number,
  longitudeEastDeg: number,
  radius: number
): THREE.Vector3 {
  const latitude = THREE.MathUtils.degToRad(latitudeDeg);
  const longitude = THREE.MathUtils.degToRad(longitudeEastDeg);
  const cosLatitude = Math.cos(latitude);

  return new THREE.Vector3(
    cosLatitude * Math.cos(longitude),
    Math.sin(latitude),
    -cosLatitude * Math.sin(longitude)
  ).multiplyScalar(radius);
}

/**
 * Builds a spherical global mesh from NASA's unsigned 16-bit LOLA map.
 *
 * NASA documents this map as half-metre samples referenced to a
 * 1,727,400 m base radius. This globe is intentionally a global context
 * model; local landing analysis continues to use the original Product78
 * raster without this global mesh's decimation.
 */
function buildGlobalMoonGeometry(
  samples: Uint16Array,
  sourceWidth: number,
  sourceHeight: number
): THREE.BufferGeometry {
  if (samples.length !== sourceWidth * sourceHeight) {
    throw new Error(
      `Global LOLA raster length mismatch: expected ${sourceWidth * sourceHeight}, received ${samples.length}.`
    );
  }

  const columns = GLOBAL_LONGITUDE_SEGMENTS + 1;
  const rows = GLOBAL_LATITUDE_SEGMENTS + 1;
  const vertexCount = columns * rows;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(
    GLOBAL_LONGITUDE_SEGMENTS * GLOBAL_LATITUDE_SEGMENTS * 6
  );

  const longitudeCoordinates = new Float64Array(columns);
  const longitudeCosines = new Float64Array(columns);
  const longitudeSines = new Float64Array(columns);
  for (let column = 0; column < columns; column += 1) {
    const u = column / GLOBAL_LONGITUDE_SEGMENTS;
    const longitude = u * Math.PI * 2 - Math.PI;
    longitudeCoordinates[column] = u;
    longitudeCosines[column] = Math.cos(longitude);
    longitudeSines[column] = Math.sin(longitude);
  }

  const latitudeCoordinates = new Float64Array(rows);
  const latitudeCosines = new Float64Array(rows);
  const latitudeSines = new Float64Array(rows);
  const sourceRows = new Uint32Array(rows);
  for (let row = 0; row < rows; row += 1) {
    const v = row / GLOBAL_LATITUDE_SEGMENTS;
    const latitude = Math.PI / 2 - v * Math.PI;
    latitudeCoordinates[row] = v;
    latitudeCosines[row] = Math.cos(latitude);
    latitudeSines[row] = Math.sin(latitude);
    sourceRows[row] = Math.min(
      sourceHeight - 1,
      Math.round(v * (sourceHeight - 1))
    );
  }

  let vertexIndex = 0;
  for (let row = 0; row < rows; row += 1) {
    const sourceRowOffset = sourceRows[row] * sourceWidth;
    const cosLatitude = latitudeCosines[row];
    const sinLatitude = latitudeSines[row];
    const v = latitudeCoordinates[row];

    for (let column = 0; column < columns; column += 1) {
      const sourceColumn = Math.min(
        sourceWidth - 1,
        Math.round(longitudeCoordinates[column] * (sourceWidth - 1))
      );
      const sample = samples[sourceRowOffset + sourceColumn];

      // Unsigned map values are 0.5 m increments above the 1,727,400 m base.
      const radiusMeters =
        LUNAR_UNSIGNED_HEIGHT_BASE_METERS +
        sample * LUNAR_UNSIGNED_HEIGHT_STEP_METERS;
      const radius = radiusMeters / LUNAR_REFERENCE_RADIUS_METERS;

      positions[vertexIndex * 3] =
        cosLatitude * longitudeCosines[column] * radius;
      positions[vertexIndex * 3 + 1] = sinLatitude * radius;
      positions[vertexIndex * 3 + 2] =
        -cosLatitude * longitudeSines[column] * radius;

      uvs[vertexIndex * 2] = longitudeCoordinates[column];
      uvs[vertexIndex * 2 + 1] = v;
      vertexIndex += 1;
    }
  }

  let indexOffset = 0;
  for (let row = 0; row < GLOBAL_LATITUDE_SEGMENTS; row += 1) {
    for (let column = 0; column < GLOBAL_LONGITUDE_SEGMENTS; column += 1) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;

      // Winding is outward-facing for this north-to-south, west-to-east grid.
      indices[indexOffset++] = a;
      indices[indexOffset++] = c;
      indices[indexOffset++] = b;
      indices[indexOffset++] = b;
      indices[indexOffset++] = c;
      indices[indexOffset++] = d;
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

function MoonGlobe({
  sites,
  selectedSiteId,
}: {
  sites: Product78SiteStatus[];
  selectedSiteId: string | null;
}) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [globalModel, setGlobalModel] = useState<GlobalMoonModel | null>(null);
  const [modelStatus, setModelStatus] = useState<"loading" | "ready" | "fallback">("loading");

  const siteMarkers = useMemo(
    () => sites.map((site) => ({
      site,
      position: latLonToSpherePosition(
        site.observer.latitudeDeg,
        site.observer.longitudeEastDeg,
        1.012
      ),
      selected: site.id === selectedSiteId,
    })),
    [sites, selectedSiteId]
  );

  const southPolePosition = useMemo(
    () => new THREE.Vector3(0, -1.012, 0),
    []
  );

  const fallbackGeometry = useMemo(
    () => new THREE.SphereGeometry(1, 128, 96),
    []
  );

  useEffect(() => {
    let active = true;
    let loadedTexture: THREE.Texture | null = null;
    let createdGeometry: THREE.BufferGeometry | null = null;
    const loader = new THREE.TextureLoader();

    loader.setCrossOrigin("anonymous");
    loader.load(
      LUNAR_COLOR_MAP_URL,
      (loaded) => {
        if (!active) {
          loaded.dispose();
          return;
        }

        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.anisotropy = 4;
        loadedTexture = loaded;
        setTexture(loaded);
      },
      undefined,
      () => {
        console.warn("[MoonOverview] NASA LROC colour map unavailable; using a neutral globe.");
      }
    );

    async function loadGlobalElevation() {
      try {
        const tiff = await fromUrl(LUNAR_ELEVATION_MAP_URL);
        const image = await tiff.getImage();

        if (
          image.getSamplesPerPixel() !== 1 ||
          image.getSampleFormat(0) !== 1 ||
          image.getBitsPerSample(0) !== 16
        ) {
          throw new Error("NASA global LOLA map is not a single-band unsigned 16-bit raster.");
        }

        const raster = await image.readRasters({ interleave: true });
        const samples = raster as unknown as Uint16Array;

        const geometry = buildGlobalMoonGeometry(
          samples,
          image.getWidth(),
          image.getHeight()
        );
        createdGeometry = geometry;

        if (!active) {
          geometry.dispose();
          return;
        }

        setGlobalModel({
          geometry,
          width: image.getWidth(),
          height: image.getHeight(),
        });
        setModelStatus("ready");
      } catch (error) {
        console.warn(
          "[MoonOverview] Could not load NASA global LOLA topography; using the colour-only fallback.",
          error
        );
        if (active) setModelStatus("fallback");
      }
    }

    void loadGlobalElevation();

    return () => {
      active = false;
      loadedTexture?.dispose();
      createdGeometry?.dispose();
      fallbackGeometry.dispose();
    };
  }, [fallbackGeometry]);

  const globeGeometry = globalModel?.geometry ?? fallbackGeometry;

  return (
    <>
      <mesh geometry={globeGeometry}>
        <meshStandardMaterial
          map={texture ?? undefined}
          color={texture ? "#ffffff" : "#777d82"}
          roughness={1}
          metalness={0}
        />
      </mesh>

      <mesh position={southPolePosition}>
        <sphereGeometry args={[0.012, 16, 16]} />
        <meshBasicMaterial color="#dce7e5" />
      </mesh>

      {siteMarkers.map(({ site, position, selected }) => (
        <group key={site.id} position={position}>
          <mesh>
            <sphereGeometry args={[selected ? 0.024 : 0.015, 16, 16]} />
            <meshBasicMaterial color={selected ? "#f3a34b" : "#73d7c4"} />
          </mesh>
          {selected && (
            <mesh>
              <sphereGeometry args={[0.047, 20, 20]} />
              <meshBasicMaterial
                color="#f3a34b"
                transparent
                opacity={0.2}
                depthWrite={false}
              />
            </mesh>
          )}
        </group>
      ))}

      <ambientLight intensity={0.48} />
      <directionalLight position={[3.5, 2.5, 4]} intensity={1.65} />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minDistance={1.35}
        maxDistance={4.2}
        rotateSpeed={0.55}
      />

      {modelStatus === "loading" && (
        <group position={[0, -1.08, 0]}>
          <mesh>
            <sphereGeometry args={[0.008, 8, 8]} />
            <meshBasicMaterial color="#73d7c4" />
          </mesh>
        </group>
      )}
    </>
  );
}

export default function GlobalMoonOverview({ sites, selectedSite }: Props) {
  return (
    <section className="moon-overview" aria-label="Interactive global Moon overview">
      <div className="moon-overview-heading">
        <div>
          <div className="eyebrow">GLOBAL CONTEXT · LUNAR SOUTH POLE</div>
          <h2>Moon overview <span>· interactive globe</span></h2>
          <p>Rotate the Moon to see every locally prepared Product78 site. The highlighted marker follows the selected landing site.</p>
        </div>
        <span className="panel-badge">{sites.length} VERIFIED {sites.length === 1 ? "SITE" : "SITES"}</span>
      </div>

      <div className="moon-overview-content">
        <div className="moon-globe-wrap">
          <Canvas
            camera={{ position: [2.5, -1.45, 2.7], fov: 34, near: 0.1, far: 20 }}
            dpr={[1, 1.25]}
            gl={{ antialias: true, alpha: true }}
          >
            <color attach="background" args={["#07131b"]} />
            <MoonGlobe sites={sites} selectedSiteId={selectedSite?.id ?? null} />
          </Canvas>
          <div className="moon-globe-instructions">DRAG TO ROTATE · SCROLL TO ZOOM</div>
        </div>

        <div className="moon-site-details">
          {selectedSite ? (
            <>
              <div className="moon-site-key">
                <span className="moon-marker-dot" />
                <div>
                  <span className="eyebrow">SELECTED VERIFIED SITE</span>
                  <strong>{selectedSite.name} · {selectedSite.archiveSite}</strong>
                </div>
              </div>
              <div className="moon-coordinate-row">
                <span>Latitude</span>
                <strong>{Math.abs(selectedSite.observer.latitudeDeg).toFixed(4)}° {selectedSite.observer.latitudeDeg < 0 ? "S" : "N"}</strong>
              </div>
              <div className="moon-coordinate-row">
                <span>East longitude</span>
                <strong>{selectedSite.observer.longitudeEastDeg.toFixed(4)}° E</strong>
              </div>
              <div className="moon-coordinate-row">
                <span>Terrain dataset</span>
                <strong>NASA LOLA Product78</strong>
              </div>
              <div className="moon-coordinate-row">
                <span>Source resolution</span>
                <strong>{selectedSite.resolutionMeters ?? "—"} m / pixel</strong>
              </div>
            </>
          ) : (
            <div className="moon-map-note">
              <strong>No verified local site is available</strong>
              <p>Prepare and validate a Product78 raster before selecting a site for terrain analysis.</p>
            </div>
          )}

          <div className="moon-prepared-sites">
            <span className="eyebrow">LOCALLY PREPARED SITES</span>
            {sites.length ? (
              <div className="moon-prepared-site-list">
                {sites.map((site) => (
                  <div key={site.id} className={site.id === selectedSite?.id ? "moon-prepared-site is-selected" : "moon-prepared-site"}>
                    <span>{site.archiveSite}</span>
                    <strong>{site.name}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted small">No local Product78 assets have passed the site availability check.</p>
            )}
          </div>

          <div className="moon-map-note">
            <strong>Global orientation model · NASA LRO / LOLA</strong>
            <p>The global sphere uses NASA&apos;s LROC colour mosaic and LOLA global elevation map. It is for planetary orientation only; all local landing-site terrain and horizon analysis continues to use the selected NASA Product78 raster.</p>
            <a href="https://svs.gsfc.nasa.gov/4720/" target="_blank" rel="noreferrer">NASA CGI Moon Kit ↗</a>
          </div>
        </div>
      </div>
    </section>
  );
}
