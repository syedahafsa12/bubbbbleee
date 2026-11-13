
"use client";

import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";

import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  Stars,
  useGLTF,
  useProgress,
} from "@react-three/drei";

import * as THREE from "three";

const MOON_MODEL_PATH = "/models/moon-optimized.glb";

/* -----------------------------------------
   Error boundary
----------------------------------------- */

class MoonErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);

    this.state = {
      hasError: false,
      message: "",
    };
  }

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unable to render the lunar model.",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Moon viewer error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-[420px] w-full flex-col items-center justify-center bg-[#080a10] px-6 text-center">
          <p className="text-[10px] tracking-[0.3em] text-red-300/70">
            MODEL LOADING FAILED
          </p>

          <p className="mt-4 max-w-md break-words text-sm leading-6 text-white/60">
            {this.state.message}
          </p>

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 border border-white/20 px-5 py-3 text-[10px] tracking-[0.2em] text-white/80 transition hover:border-white/50"
          >
            RELOAD VIEWER
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

/* -----------------------------------------
   Moon GLB model
----------------------------------------- */

function MoonModel() {
  const gltf = useGLTF(MOON_MODEL_PATH);

  const model = useMemo(() => {
    const scene = gltf.scene.clone(true);

    const bounds = new THREE.Box3().setFromObject(scene);

    const size = new THREE.Vector3();
    const center = new THREE.Vector3();

    bounds.getSize(size);
    bounds.getCenter(center);

    const largestDimension = Math.max(size.x, size.y, size.z);

    if (
      !Number.isFinite(largestDimension) ||
      largestDimension <= 0
    ) {
      throw new Error("Invalid Moon model dimensions.");
    }

    const scale = 4.2 / largestDimension;

    scene.scale.setScalar(scale);

    scene.position.set(
      -center.x * scale,
      -center.y * scale,
      -center.z * scale
    );

    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = false;
        object.receiveShadow = false;
      }
    });

    return scene;
  }, [gltf.scene]);

  return <primitive object={model} />;
}

/* -----------------------------------------
   Loading overlay
   IMPORTANT: This is outside Canvas.
----------------------------------------- */

function MoonLoadingOverlay() {
  const { progress, loaded, total, active, item } = useProgress();

  if (!active && progress >= 100) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#080a10]">
      <div className="w-[min(280px,70vw)] text-center">
        <p className="text-[10px] tracking-[0.35em] text-white/50">
          LOADING LUNAR MODEL
        </p>

        <div className="mt-5 h-[2px] w-full overflow-hidden bg-white/10">
          <div
            className="h-full bg-white/80 transition-[width] duration-300"
            style={{
              width: `${Math.min(100, Math.max(0, progress))}%`,
            }}
          />
        </div>

        <div className="mt-3 flex justify-between text-[10px] tabular-nums text-white/40">
          <span>{Math.round(progress)}%</span>
          <span>
            {loaded} / {total || 1} ASSETS
          </span>
        </div>

        {item && (
          <p className="mt-3 truncate text-[9px] text-white/30">
            {item.split("/").pop()}
          </p>
        )}
      </div>
    </div>
  );
}

/* -----------------------------------------
   Three.js scene
----------------------------------------- */

function MoonScene() {
  return (
    <>
      <color attach="background" args={["#080a10"]} />

      <ambientLight intensity={1.15} />

      <directionalLight
        position={[5, 3, 5]}
        intensity={2.2}
        color="#fff8ed"
      />

      <directionalLight
        position={[-4, -2, -5]}
        intensity={0.35}
        color="#a9bbdf"
      />

      <Stars
        radius={90}
        depth={45}
        count={1800}
        factor={3}
        saturation={0}
        fade
        speed={0.25}
      />

      <Suspense fallback={null}>
        <MoonModel />
      </Suspense>

      <OrbitControls
        makeDefault
        enablePan={false}
        enableRotate
        enableZoom
        minDistance={4.8}
        maxDistance={10}
        minPolarAngle={Math.PI * 0.12}
        maxPolarAngle={Math.PI * 0.88}
        rotateSpeed={0.55}
        zoomSpeed={0.7}
        dampingFactor={0.08}
        enableDamping
      />
    </>
  );
}

/* -----------------------------------------
   Main viewer
----------------------------------------- */

export default function MoonViewer() {
  const [webglFailed, setWebglFailed] = useState(false);

  useEffect(() => {
    const canvas = document.querySelector(
      "[data-lunar-moon-canvas]"
    ) as HTMLCanvasElement | null;

    if (!canvas) return;

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      setWebglFailed(true);
    };

    canvas.addEventListener("webglcontextlost", handleContextLost);

    return () => {
      canvas.removeEventListener(
        "webglcontextlost",
        handleContextLost
      );
    };
  }, []);

  if (webglFailed) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center bg-[#080a10] px-6 text-center">
        <p className="text-xs tracking-[0.25em] text-white/60">
          WEBGL UNAVAILABLE — 3D VIEWER CANNOT START
        </p>
      </div>
    );
  }

  return (
    <MoonErrorBoundary>
      <div className="relative h-full min-h-[420px] w-full bg-[#080a10]">
        <Canvas
          camera={{
            position: [0, 0, 6.8],
            fov: 35,
            near: 0.1,
            far: 200,
          }}
          dpr={[1, 1.75]}
          gl={{
            antialias: true,
            alpha: false,
            powerPreference: "high-performance",
          }}
          onCreated={({ gl }) => {
            gl.setClearColor("#080a10", 1);
            gl.domElement.dataset.lunarMoonCanvas = "true";
          }}
        >
          <MoonScene />
        </Canvas>

        <MoonLoadingOverlay />

        <div className="pointer-events-none absolute bottom-7 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap text-[9px] tracking-[0.25em] text-white/40">
          DRAG TO ROTATE
          <span className="mx-2 text-white/20">·</span>
          SCROLL TO ZOOM
        </div>
      </div>
    </MoonErrorBoundary>
  );
}

useGLTF.preload(MOON_MODEL_PATH);
