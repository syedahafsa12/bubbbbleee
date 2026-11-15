"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const AIA_304_TEXTURE_URL = "/api/solar-imagery/aia304";

interface SunAia304ReferenceLayerProps {
  position: THREE.Vector3;
  diameter: number;
}

/**
 * Displays a historical NASA SDO/AIA 304 Å image as a camera-facing reference
 * layer over the 3D Sun. This is an EUV false-colour view, not visible-light
 * colour and not a live image for the selected mission timestamp.
 */
export function SunAia304ReferenceLayer({
  position,
  diameter,
}: SunAia304ReferenceLayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let active = true;
    const loader = new THREE.TextureLoader();
    const loadedTexture = loader.load(
      AIA_304_TEXTURE_URL,
      (loaded) => {
        if (!active) {
          loaded.dispose();
          return;
        }

        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.minFilter = THREE.LinearMipmapLinearFilter;
        loaded.magFilter = THREE.LinearFilter;
        loaded.generateMipmaps = true;
        loaded.needsUpdate = true;
        setTexture(loaded);
      },
      undefined,
      (error) => {
        if (active) {
          console.warn("[LUNAPATH] NASA SDO/AIA 304 reference image unavailable.", error);
        }
      }
    );

    return () => {
      active = false;
      loadedTexture.dispose();
    };
  }, []);

  const material = useMemo(() => {
    if (!texture) return null;

    return new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uOpacity: { value: 0.9 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform float uOpacity;
        varying vec2 vUv;

        void main() {
          vec3 solarSignal = texture2D(uMap, vUv).rgb;
          float luminance = dot(solarSignal, vec3(0.2126, 0.7152, 0.0722));
          float alpha = smoothstep(0.003, 0.04, luminance);
          gl_FragColor = vec4(solarSignal, alpha * uOpacity);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
  }, [texture]);

  useEffect(() => {
    return () => {
      material?.dispose();
    };
  }, [material]);

  useFrame(({ camera }) => {
    if (!groupRef.current) return;

    const towardCamera = camera.position.clone().sub(position).normalize();
    groupRef.current.position
      .copy(position)
      .addScaledVector(towardCamera, Math.max(diameter * 0.515, 0.01));
    groupRef.current.quaternion.copy(camera.quaternion);
  });

  if (!material) return null;

  return (
    <group ref={groupRef} frustumCulled={false}>
      <mesh renderOrder={20} frustumCulled={false}>
        <planeGeometry args={[diameter * 1.08, diameter * 1.08]} />
        <primitive object={material} attach="material" />
      </mesh>
    </group>
  );
}
