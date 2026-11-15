"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const AIA_304_TEXTURE_URL = "/api/solar-imagery/aia304";
const SOLAR_DISK_RADIUS_UV = 0.38;

interface SunAia304ReferenceLayerProps {
  position: THREE.Vector3;
  diameter: number;
  opacity?: number;
}

/**
 * Adds only a restrained, camera-facing outer-atmosphere reference from
 * NASA SDO/AIA 304 Å. The false-colour EUV image is not used to colour the
 * photosphere. This is a historical reference layer, not live mission data.
 */
export function SunAia304ReferenceLayer({
  position,
  diameter,
  opacity = 1,
}: SunAia304ReferenceLayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let active = true;
    const loadedTexture = new THREE.TextureLoader().load(
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
        loaded.anisotropy = 8;
        loaded.needsUpdate = true;
        setTexture(loaded);
      },
      undefined,
      (error) => {
        if (active) {
          console.warn("[LUNAPATH] NASA SDO/AIA 304 reference unavailable.", error);
        }
      }
    );

    return () => {
      active = false;
      loadedTexture.dispose();
    };
  }, []);

  const prominenceMaterial = useMemo(() => {
    if (!texture) return null;

    return new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uOpacity: { value: opacity },
        uDiskRadius: { value: SOLAR_DISK_RADIUS_UV },
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
        uniform float uDiskRadius;
        varying vec2 vUv;

        void main() {
          float radius = length(vUv - vec2(0.5));
          float limb = uDiskRadius;

          // Retain only the narrow off-limb / limb structure, not the
          // false-colour 304 Å disk itself.
          float outerAtmosphere =
            smoothstep(limb - 0.012, limb + 0.008, radius) *
            (1.0 - smoothstep(limb + 0.055, limb + 0.09, radius));

          vec3 observed = texture2D(uMap, vUv).rgb;
          float signal = dot(observed, vec3(0.2126, 0.7152, 0.0722));
          float prominenceSignal = smoothstep(0.035, 0.20, signal);
          float alpha = outerAtmosphere * prominenceSignal * 0.22 * uOpacity;

          vec3 neutralProminence = vec3(1.0, 0.94, 0.82);
          gl_FragColor = vec4(neutralProminence, alpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
  }, [texture, opacity]);

  useEffect(() => {
    return () => {
      prominenceMaterial?.dispose();
    };
  }, [prominenceMaterial]);

  useFrame(({ camera }) => {
    if (!groupRef.current) return;

    const towardCamera = camera.position.clone().sub(position).normalize();
    groupRef.current.position.copy(position).addScaledVector(
      towardCamera,
      Math.max(diameter * 0.505, 0.01)
    );
    groupRef.current.quaternion.copy(camera.quaternion);
  });

  if (!prominenceMaterial || !Number.isFinite(diameter) || diameter <= 0) {
    return null;
  }

  // The source disk radius is approximately 0.38 of the full square image.
  const imagePlaneSize = diameter / (2 * SOLAR_DISK_RADIUS_UV);

  return (
    <group ref={groupRef} frustumCulled={false}>
      <mesh renderOrder={21} frustumCulled={false}>
        <planeGeometry args={[imagePlaneSize, imagePlaneSize]} />
        <primitive object={prominenceMaterial} attach="material" />
      </mesh>
    </group>
  );
}
