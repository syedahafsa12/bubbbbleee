"use client";

import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

const SITE04 = {
  latitudeDeg: -89.7668,
  longitudeEastDeg: 188.13,
  label: "Shackleton Rim · Site04",
};

// NASA Scientific Visualization Studio CGI Moon Kit (2025 LROC-based color map).
// This texture is for global visual context only, not scientific elevation data.
const LUNAR_COLOR_MAP_URL =
  "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg";

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

function MoonGlobe() {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [textureFailed, setTextureFailed] = useState(false);

  const sitePosition = useMemo(
    () => latLonToSpherePosition(
      SITE04.latitudeDeg,
      SITE04.longitudeEastDeg,
      1.012
    ),
    []
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
        setTextureFailed(false);
      },
      undefined,
      () => {
        if (active) setTextureFailed(true);
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

      <group position={sitePosition}>
        <mesh>
          <sphereGeometry args={[0.022, 20, 20]} />
          <meshBasicMaterial color="#f3a34b" />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.043, 20, 20]} />
          <meshBasicMaterial
            color="#f3a34b"
            transparent
            opacity={0.22}
            depthWrite={false}
          />
        </mesh>
      </group>

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

      {textureFailed && null}
    </>
  );
}

export default function GlobalMoonOverview() {
  const [textureAvailable, setTextureAvailable] = useState(true);

  return (
    <section className="moon-overview" aria-label="Interactive global Moon overview">
      <div className="moon-overview-heading">
        <div>
          <div className="eyebrow">GLOBAL CONTEXT · LUNAR SOUTH POLE</div>
          <h2>Moon overview <span>· interactive globe</span></h2>
          <p>Rotate the Moon to locate the Site04 observer region. Select the local terrain panel for the 5 m Product78 surface data.</p>
        </div>
        <span className="panel-badge">GLOBAL CONTEXT</span>
      </div>

      <div className="moon-overview-content">
        <div className="moon-globe-wrap">
          <Canvas
            camera={{ position: [2.5, -1.45, 2.7], fov: 34, near: 0.1, far: 20 }}
            dpr={[1, 1.5]}
            gl={{ antialias: true, alpha: true }}
          >
            <color attach="background" args={["#07131b"]} />
            <MoonGlobe />
          </Canvas>
          <div className="moon-globe-instructions">DRAG TO ROTATE · SCROLL TO ZOOM</div>
        </div>

        <div className="moon-site-details">
          <div className="moon-site-key">
            <span className="moon-marker-dot" />
            <div>
              <span className="eyebrow">CURRENT VERIFIED SITE</span>
              <strong>{SITE04.label}</strong>
            </div>
          </div>
          <div className="moon-coordinate-row">
            <span>Latitude</span>
            <strong>{Math.abs(SITE04.latitudeDeg).toFixed(4)}° S</strong>
          </div>
          <div className="moon-coordinate-row">
            <span>East longitude</span>
            <strong>{SITE04.longitudeEastDeg.toFixed(2)}° E</strong>
          </div>
          <div className="moon-coordinate-row">
            <span>Terrain dataset</span>
            <strong>NASA LOLA Product78</strong>
          </div>
          <div className="moon-coordinate-row">
            <span>Source resolution</span>
            <strong>5 m / pixel</strong>
          </div>
          <div className="moon-map-note">
            <strong>Visual-context map only</strong>
            <p>The global color texture is from NASA's LROC-based CGI Moon Kit. It is not a scientific elevation model. Local terrain analysis uses the supplied Product78 Site04 raster.</p>
            <a href="https://svs.gsfc.nasa.gov/4720/" target="_blank" rel="noreferrer">NASA CGI Moon Kit ↗</a>
          </div>
        </div>
      </div>
    </section>
  );
}
