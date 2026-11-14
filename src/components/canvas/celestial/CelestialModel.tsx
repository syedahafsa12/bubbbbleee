"use client";

import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

export interface CelestialModelProps {
  url: string;
  position: THREE.Vector3;
  diameter: number;
  opacity?: number;
}

/**
 * Loads the selected glTF appearance model while preserving its authored
 * geometry and materials. JPL Horizons supplies the apparent position and
 * angular diameter; this component only normalizes the source model's bounds.
 */
export default function CelestialModel({
  url,
  position,
  diameter,
  opacity = 1,
}: CelestialModelProps) {
  const { scene } = useGLTF(url);

  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(clone);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const largestDimension = Math.max(size.x, size.y, size.z);

    const group = new THREE.Group();

    clone.position.sub(center);
    group.add(clone);

    if (largestDimension > 0 && Number.isFinite(diameter) && diameter > 0) {
      group.scale.setScalar(diameter / largestDimension);
    }

    group.traverse((object) => {
      object.layers.set(1);

      if (!(object instanceof THREE.Mesh)) {
        return;
      }

      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];

      const clonedMaterials = materials.map((sourceMaterial) => {
        const material = sourceMaterial.clone();

        // Keep the source material and texture. Opacity is only used for the
        // existing qualified terrain-visibility display states.
        if (opacity < 1) {
          material.transparent = true;
          material.opacity *= opacity;
          material.depthWrite = false;
        }

        return material;
      });

      object.material = Array.isArray(object.material)
        ? clonedMaterials
        : clonedMaterials[0];

      object.castShadow = false;
      object.receiveShadow = false;
    });

    group.layers.set(1);
    return group;
  }, [scene, diameter, opacity]);

  useEffect(() => {
    return () => {
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) {
          return;
        }

        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];

        materials.forEach((material) => material.dispose());
      });
    };
  }, [model]);

  return (
    <group position={[position.x, position.y, position.z]}>
      <primitive object={model} />
    </group>
  );
}
