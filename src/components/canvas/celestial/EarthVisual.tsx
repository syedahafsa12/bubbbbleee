"use client";

import { useGLTF } from "@react-three/drei";
import CelestialModel, {
  type CelestialModelProps,
} from "./CelestialModel";

export type EarthVisualProps = Omit<CelestialModelProps, "url">;

export function EarthVisual(props: EarthVisualProps) {
  return <CelestialModel url="/models/earth.glb" {...props} />;
}

useGLTF.preload("/models/earth.glb");
