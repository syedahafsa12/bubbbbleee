"use client";

import CelestialModel, {
  type CelestialModelProps,
} from "./CelestialModel";

export type EarthVisualProps = Omit<
  CelestialModelProps,
  "url" | "materialOverride" | "faceCamera"
>;

export function EarthVisual(props: EarthVisualProps) {
  return (
    <CelestialModel
      url="/models/earth.glb"
      {...props}
    />
  );
}

