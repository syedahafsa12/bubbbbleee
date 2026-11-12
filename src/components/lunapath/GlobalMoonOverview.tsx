"use client";

import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Product78SiteStatus } from "./types";

// NASA Scientific Visualization Studio CGI Moon Kit (2025 LROC-based color map).
// This texture is for global visual context only, not scientific elevation data.
const LUNAR_COLOR_MAP_URL =
  "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg";

type Props = {
  sites: Product78SiteStatus[];
  selectedSite: Product78SiteStatus | null;
};

function latLonToSpherePosition(
  latitudeDeg: number,
  longitudeEastDeg: number,
  radius: number
): THREE.Vector3 {
  const latitude = THREE.MathUtils.degToRad(latitudeDeg);
  const longitude = THREE.MathUtils.degToRad(longitudeEastDeg);

  // The NASA map is an equirectangular texture centered on 0° longitude.
  // Match the default Three.js SphereGeometry UV orientation.
  const theta = Math.PI / 2 - latitude;
  const phi = Math.PI + longitude;

  return new THREE.Vector3(
    -Math.sin(theta) * Math.cos(phi),
    Math.cos(theta),
    Math.sin(theta) * Math.sin(phi)
  ).multiplyScalar(radius);
}

function MoonGlobe({
  sites,
  selectedSiteId,
}: {
  sites: Product78SiteStatus[];
  selectedSiteId: string | null;
}) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

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

  useEffect(() => {
    let active = true;
    let loadedTexture: THREE.Texture | null = null;
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
        console.warn("[MoonOverview] NASA lunar color texture unavailable; using neutral globe fallback.");
      }
    );

    return () => {
      active = false;
      loadedTexture?.dispose();
    };
  }, []);

  return (
    <>
      <mesh>
        <sphereGeometry args={[1, 128, 96]} />
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

      <ambientLight intensity={0.7} />
      <directionalLight position={[3.5, 2.5, 4]} intensity={2.1} />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minDistance={1.35}
        maxDistance={4.2}
        rotateSpeed={0.55}
      />
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
            dpr={[1, 1.5]}
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
            <strong>Visual-context map only</strong>
            <p>The global color texture is from NASA's LROC-based CGI Moon Kit. It is a visual reference, not a scientific elevation model; a neutral globe appears if the texture cannot load. Local terrain analysis uses the selected Product78 raster.</p>
            <a href="https://svs.gsfc.nasa.gov/4720/" target="_blank" rel="noreferrer">NASA CGI Moon Kit ↗</a>
          </div>
        </div>
      </div>
    </section>
  );
}
