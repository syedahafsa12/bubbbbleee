"use client";

import { useGLTF } from "@react-three/drei";
import CelestialModel, {
  type CelestialModelProps,
} from "./CelestialModel";

export type SunVisualProps = Omit<CelestialModelProps, "url">;

export function SunVisual(props: SunVisualProps) {
  return <CelestialModel url="/models/sun.glb" {...props} />;
}

useGLTF.preload("/models/sun.glb");
