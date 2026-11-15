"use client";

import { useEffect, useMemo, useState } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import CelestialModel, {
  type CelestialModelProps,
} from "./CelestialModel";
import { SunAia304ReferenceLayer } from "./SunAia304ReferenceLayer";

const PHOTOSPHERE_TEXTURE_URL = "/api/solar-imagery/photosphere";
const NASA_SOLAR_DISK_RADIUS_UV = 0.38;

export type SunVisualProps = Omit<
  CelestialModelProps,
  "url" | "materialOverride" | "faceCamera"
>;

/**
 * Uses the existing 3D Sun geometry, but replaces its featureless material
 * with a surface shader driven by NASA SDO 4500 Å photosphere observations.
 *
 * The source image is an orthographic solar disk, so the shader projects it
 * onto the camera-facing hemisphere using the mesh's local surface normals.
 * This preserves a genuinely 3D spherical body while retaining measured
 * photospheric texture and sunspot contrast.
 */
export function SunVisual({
  position,
  diameter,
  opacity = 1,
}: SunVisualProps) {
  const { scene } = useGLTF("/models/sun.glb");
  const [photosphereTexture, setPhotosphereTexture] =
    useState<THREE.Texture | null>(null);

  useEffect(() => {
    let active = true;
    const texture = new THREE.TextureLoader().load(
      PHOTOSPHERE_TEXTURE_URL,
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
        setPhotosphereTexture(loaded);
      },
      undefined,
      (error) => {
        if (active) {
          console.error(
            "[LUNAPATH] NASA SDO photosphere texture unavailable; hiding the untextured Sun model.",
            error
          );
        }
      }
    );

    return () => {
      active = false;
      texture.dispose();
    };
  }, []);

  const photosphereMaterial = useMemo(() => {
    if (!photosphereTexture) return null;

    return new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: photosphereTexture },
        uOpacity: { value: opacity },
        uDiskRadius: { value: NASA_SOLAR_DISK_RADIUS_UV },
      },
      vertexShader: `
        varying vec3 vLocalNormal;

        void main() {
          vLocalNormal = normalize(normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform float uOpacity;
        uniform float uDiskRadius;
        varying vec3 vLocalNormal;

        void main() {
          vec3 n = normalize(vLocalNormal);
          vec2 solarUv = vec2(
            0.5 + n.x * uDiskRadius,
            0.5 + n.y * uDiskRadius
          );

          vec3 observed = texture2D(uMap, solarUv).rgb;
          float luminance = dot(observed, vec3(0.2126, 0.7152, 0.0722));

          // Preserve real image contrast instead of saturating the entire
          // photosphere to a flat white disk.
          float normalizedSignal = clamp((luminance - 0.008) / 0.72, 0.0, 1.0);
          float surfaceBrightness =
            0.22 + 0.78 * pow(normalizedSignal, 0.62);

          vec3 surfaceColor =
            vec3(1.0, 0.975, 0.915) * surfaceBrightness;

          // Keep the observed dark sunspot signal visible after neutral
          // de-colourization of the NASA reference image.
          float sunspotMask = 1.0 - smoothstep(0.025, 0.16, luminance);
          surfaceColor = mix(
            surfaceColor,
            vec3(0.045, 0.038, 0.03),
            sunspotMask * 0.86
          );

          // A small limb-darkening term preserves the spherical appearance.
          surfaceColor *= 0.9 + 0.1 * sqrt(max(n.z, 0.0));

          gl_FragColor = vec4(surfaceColor, uOpacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: opacity < 1,
      depthWrite: opacity >= 1,
      side: THREE.FrontSide,
      toneMapped: false,
    });
  }, [photosphereTexture, opacity]);

  useEffect(() => {
    return () => {
      photosphereMaterial?.dispose();
    };
  }, [photosphereMaterial]);

  // Never fall back to the featureless white GLB material if the NASA
  // observation texture fails to load.
  if (!photosphereMaterial || !Number.isFinite(diameter) || diameter <= 0) {
    return null;
  }

  return (
    <>
      <CelestialModel
        url="/models/sun.glb"
        position={position}
        diameter={diameter}
        opacity={opacity}
        materialOverride={photosphereMaterial}
        faceCamera
      />
      <SunAia304ReferenceLayer
        position={position}
        diameter={diameter}
        opacity={opacity}
      />
    </>
  );
}

useGLTF.preload("/models/sun.glb");
