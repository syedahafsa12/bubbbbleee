"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const PHOTOSPHERE_TEXTURE_URL = "/api/solar-imagery/photosphere";
const AIA_304_TEXTURE_URL = "/api/solar-imagery/aia304";

interface SunAia304ReferenceLayerProps {
  position: THREE.Vector3;
  diameter: number;
}

interface SolarTextures {
  photosphere: THREE.Texture | null;
  prominences: THREE.Texture | null;
}

/**
 * NASA SDO 4500 Å visible-light photosphere supplies the main solar disk.
 * NASA AIA 304 Å is restricted to the outer rim so its false-colour EUV
 * palette does not turn the entire Sun orange. Both frames are historical,
 * not live data for the selected mission timestamp.
 */
export function SunAia304ReferenceLayer({
  position,
  diameter,
}: SunAia304ReferenceLayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [textures, setTextures] = useState<SolarTextures>({
    photosphere: null,
    prominences: null,
  });

  useEffect(() => {
    let active = true;
    const loader = new THREE.TextureLoader();
    const loaded: SolarTextures = { photosphere: null, prominences: null };

    const configure = (texture: THREE.Texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
    };

    loaded.photosphere = loader.load(
      PHOTOSPHERE_TEXTURE_URL,
      (texture) => {
        if (!active) { texture.dispose(); return; }
        configure(texture);
        setTextures((previous) => ({ ...previous, photosphere: texture }));
      },
      undefined,
      (error) => {
        if (active) console.warn("[LUNAPATH] NASA SDO 4500 Å photosphere unavailable.", error);
      }
    );

    loaded.prominences = loader.load(
      AIA_304_TEXTURE_URL,
      (texture) => {
        if (!active) { texture.dispose(); return; }
        configure(texture);
        setTextures((previous) => ({ ...previous, prominences: texture }));
      },
      undefined,
      (error) => {
        if (active) console.warn("[LUNAPATH] NASA SDO/AIA 304 prominence reference unavailable.", error);
      }
    );

    return () => {
      active = false;
      loaded.photosphere?.dispose();
      loaded.prominences?.dispose();
    };
  }, []);

  const photosphereMaterial = useMemo(() => {
    if (!textures.photosphere) return null;
    return new THREE.ShaderMaterial({
      uniforms: { uMap: { value: textures.photosphere } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec2 vUv;
        void main() {
          float radius = length(vUv - vec2(0.5));
          float alpha = 1.0 - smoothstep(0.392, 0.402, radius);
          vec3 sampleColor = texture2D(uMap, vUv).rgb;
          float signal = dot(sampleColor, vec3(0.2126, 0.7152, 0.0722));
          float detail = smoothstep(0.025, 0.55, signal);
          vec3 photosphere = mix(
            vec3(0.12, 0.12, 0.11),
            vec3(1.0, 0.985, 0.94),
            pow(detail, 0.72)
          );
          gl_FragColor = vec4(photosphere, alpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
  }, [textures.photosphere]);

  const prominenceMaterial = useMemo(() => {
    if (!textures.prominences) return null;
    return new THREE.ShaderMaterial({
      uniforms: { uMap: { value: textures.prominences } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec2 vUv;
        void main() {
          float radius = length(vUv - vec2(0.5));
          float rim =
            smoothstep(0.386, 0.405, radius) *
            (1.0 - smoothstep(0.455, 0.485, radius));
          vec3 sampleColor = texture2D(uMap, vUv).rgb;
          float signal = dot(sampleColor, vec3(0.2126, 0.7152, 0.0722));
          float detail = smoothstep(0.025, 0.18, signal);
          float alpha = rim * detail * 0.38;
          vec3 color = mix(
            vec3(0.94, 0.91, 0.84),
            vec3(1.0, 0.96, 0.86),
            detail
          );
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
  }, [textures.prominences]);

  useEffect(() => {
    return () => {
      photosphereMaterial?.dispose();
      prominenceMaterial?.dispose();
    };
  }, [photosphereMaterial, prominenceMaterial]);

  useFrame(({ camera }) => {
    if (!groupRef.current) return;
    const towardCamera = camera.position.clone().sub(position).normalize();
    groupRef.current.position.copy(position).addScaledVector(
      towardCamera,
      Math.max(diameter * 0.515, 0.01)
    );
    groupRef.current.quaternion.copy(camera.quaternion);
  });

  // NASA source images have a solar disk radius of about 0.40 of image width.
  const imagePlaneSize = diameter / 0.80;

  return (
    <group ref={groupRef} frustumCulled={false}>
      {photosphereMaterial && (
        <mesh renderOrder={20} frustumCulled={false}>
          <planeGeometry args={[imagePlaneSize, imagePlaneSize]} />
          <primitive object={photosphereMaterial} attach="material" />
        </mesh>
      )}
      {prominenceMaterial && (
        <mesh position={[0, 0, 0.002]} renderOrder={21} frustumCulled={false}>
          <planeGeometry args={[imagePlaneSize, imagePlaneSize]} />
          <primitive object={prominenceMaterial} attach="material" />
        </mesh>
      )}
    </group>
  );
}
