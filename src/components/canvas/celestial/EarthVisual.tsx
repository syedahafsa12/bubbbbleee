"use client";

import { useGLTF } from "@react-three/drei";
import CelestialModel, {
  EARTH_DISPLAY_SCALE,
  type CelestialModelProps,
} from "./CelestialModel";

export type EarthVisualProps = Omit<
  CelestialModelProps,
  "url" | "displayScale"
>;

export function EarthVisual(props: EarthVisualProps) {
  return (
    <CelestialModel
      url="/models/earth.glb"
      displayScale={EARTH_DISPLAY_SCALE}
      {...props}
    />
  );
}

useGLTF.preload("/models/earth.glb");
