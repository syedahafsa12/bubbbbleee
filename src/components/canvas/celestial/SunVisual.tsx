"use client";

import { useGLTF } from "@react-three/drei";
import CelestialModel, {
  SUN_DISPLAY_SCALE,
  type CelestialModelProps,
} from "./CelestialModel";
import { SunAia304ReferenceLayer } from "./SunAia304ReferenceLayer";

export type SunVisualProps = Omit<
  CelestialModelProps,
  "url" | "displayScale"
>;

export function SunVisual({ position, diameter, ...props }: SunVisualProps) {
  const displayDiameter = diameter * SUN_DISPLAY_SCALE;

  return (
    <>
      <CelestialModel
        url="/models/sun.glb"
        position={position}
        diameter={diameter}
        displayScale={SUN_DISPLAY_SCALE}
        {...props}
      />
      <SunAia304ReferenceLayer
        position={position}
        diameter={displayDiameter}
      />
    </>
  );
}

useGLTF.preload("/models/sun.glb");
