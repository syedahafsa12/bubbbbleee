"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

function disposeNodeTree(root: THREE.Object3D): void {
  root.traverse((object: THREE.Object3D) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material: THREE.Material) => {
      Object.values(material).forEach((value: unknown) => {
        if (value instanceof THREE.Texture) value.dispose();
      });
      material.dispose();
    });
  });
}

function createPreviewMoon(): THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial> {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("A 2D canvas is unavailable for the Moon preview.");

  context.fillStyle = "#aeb4bb";
  context.fillRect(0, 0, canvas.width, canvas.height);

  let seed = 14959;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let index = 0; index < 520; index += 1) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const radius = 5 + random() * 35;
    const gradient = context.createRadialGradient(
      x - radius * 0.22,
      y - radius * 0.22,
      radius * 0.08,
      x,
      y,
      radius
    );
    gradient.addColorStop(0, "rgba(76,82,91,.18)");
    gradient.addColorStop(.58, "rgba(115,122,132,.1)");
    gradient.addColorStop(.83, "rgba(225,228,232,.22)");
    gradient.addColorStop(1, "rgba(78,85,94,.05)");
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = gradient;
    context.fill();
  }

  for (let index = 0; index < 190; index += 1) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const radius = 2 + random() * 11;
    context.beginPath();
    context.ellipse(x, y, radius * 1.35, radius, random() * Math.PI, 0, Math.PI * 2);
    context.strokeStyle = "rgba(72,78,87," + (0.07 + random() * 0.12) + ")";
    context.lineWidth = 1 + random() * 2;
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.16, 56, 40),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 })
  );
  mesh.rotation.set(0.018, 0.16, -0.018);
  mesh.userData.isPreview = true;
  return mesh;
}

type SceneStatus = "checking" | "loading" | "ready" | "missing" | "load-error" | "webgl-error";
type MoonSceneProps = { compact?: boolean };
type ModelAvailability = { available: boolean };

export default function MoonScene({ compact = false }: MoonSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<SceneStatus>("checking");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let renderer: THREE.WebGLRenderer;
    let controls: OrbitControls;
    let resizeObserver: ResizeObserver;
    let intersectionObserver: IntersectionObserver;
    let disposed = false;
    let visible = true;
    let modelRoot: THREE.Group | null = null;
    let previewMoon: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial> | null = null;
    let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(0, 0, 4.45);

    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
        premultipliedAlpha: true
      });
    } catch {
      setStatus("webgl-error");
      return undefined;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1.25 : 1.45));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.16;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = "moon-canvas";
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute("aria-label", "Interactive three-dimensional Moon preview, upgraded to the NASA LRO and LOLA global Moon model when it finishes loading. Drag to rotate and use the scroll wheel or pinch to zoom. The global model is for orientation, not a local landing-site elevation model.");
    renderer.domElement.setAttribute("tabindex", "0");
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x0B3D91, 1.08));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.05);
    keyLight.position.set(-4.3, 2.8, 4.5);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x0B3D91, 0.24);
    fillLight.position.set(3.2, -1.8, -3.7);
    scene.add(fillLight);

    try {
      previewMoon = createPreviewMoon();
      scene.add(previewMoon);
    } catch {
      // The detailed model can still load if the lightweight preview cannot be created.
    }

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.045;
    controls.enablePan = false;
    controls.minDistance = 3.1;
    controls.maxDistance = 6;
    controls.rotateSpeed = 0.42;
    controls.zoomSpeed = 0.42;
    controls.autoRotate = !reducedMotion;
    controls.autoRotateSpeed = 0.18;

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const draw = () => {
      if (disposed || !visible || document.visibilityState === "hidden") return;
      controls.update();
      renderer.render(scene, camera);
    };
    const resume = () => renderer.setAnimationLoop(draw);
    const pause = () => renderer.setAnimationLoop(null);
    intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible && document.visibilityState === "visible") resume();
      else pause();
    }, { threshold: 0.01 });
    intersectionObserver.observe(host);

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      controls.autoRotate = !reducedMotion;
    };
    motionQuery.addEventListener?.("change", onMotionChange);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") pause();
      else if (visible) resume();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    resume();

    async function loadModel() {
      try {
        const check = await fetch("/api/moon-model?status=1", { cache: "no-store" });
        if (!check.ok) throw new Error("The local Moon model status check failed.");
        const availability = await check.json() as ModelAvailability;
        if (disposed) return;
        if (!availability.available) {
          setMessage("The NASA topographic model is not available in this runtime. The lightweight Moon preview remains available.");
          setStatus("missing");
          return;
        }

        setStatus("loading");
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync("/api/moon-model", (event: ProgressEvent) => {
          if (!disposed && event.total > 0) {
            setProgress(Math.min(99, Math.round(event.loaded / event.total * 100)));
          }
        });
        if (disposed) {
          disposeNodeTree(gltf.scene);
          return;
        }

        modelRoot = gltf.scene;
        const bounds = new THREE.Box3().setFromObject(modelRoot);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const maxAxis = Math.max(size.x, size.y, size.z) || 1;
        modelRoot.position.sub(center);
        modelRoot.scale.setScalar(2.32 / maxAxis);
        modelRoot.rotation.set(0.018, 0.16, -0.018);
        modelRoot.traverse((object: THREE.Object3D) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.frustumCulled = true;
          object.castShadow = false;
          object.receiveShadow = false;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material: THREE.Material) => {
            const surface = material as THREE.Material & { roughness?: number; metalness?: number };
            if (typeof surface.roughness === "number") surface.roughness = Math.max(surface.roughness, 0.84);
            if (typeof surface.metalness === "number") surface.metalness = 0;
            material.needsUpdate = true;
          });
        });
        scene.add(modelRoot);

        if (previewMoon) {
          scene.remove(previewMoon);
          previewMoon.geometry.dispose();
          previewMoon.material.map?.dispose();
          previewMoon.material.dispose();
          previewMoon = null;
        }

        setProgress(100);
        setStatus("ready");
      } catch (error) {
        if (!disposed) {
          setMessage(error instanceof Error ? error.message : "The browser could not load the local NASA GLB.");
          setStatus("load-error");
        }
      }
    }
    loadModel();

    return () => {
      disposed = true;
      pause();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      motionQuery.removeEventListener?.("change", onMotionChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      controls?.dispose();
      disposeNodeTree(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [compact]);

  const hasError = status === "missing" || status === "load-error" || status === "webgl-error";
  const isLoading = status === "checking" || status === "loading";

  return (
    <div className={compact ? "moon-scene moon-scene-compact" : "moon-scene"} ref={hostRef}>
      {isLoading && (
        <div className="moon-load-indicator" role="status" aria-live="polite">
          <span className="scene-spinner" />
          <span className="moon-load-copy">
            <b>{status === "checking" ? "Moon preview ready" : "Loading NASA LRO / LOLA"}</b>
            <small>{status === "checking" ? "Preparing detailed surface data" : progress > 0 ? progress + "% transferred" : "Refining the global surface"}</small>
          </span>
          {status === "loading" && <span className="moon-load-progress"><i style={{ width: progress + "%" }} /></span>}
        </div>
      )}
      {hasError && (
        <div className={"moon-scene-state state-" + status} role="status">
          {status === "missing" ? (
            <>
              <b>Preview mode</b>
              <p>{message}</p>
              <code>public/models/Moon_NASA_LRO_8k_Topo_Small.glb</code>
            </>
          ) : (
            <>
              <b>3D scene unavailable</b>
              <p>{message}</p>
              <small>Check WebGL support and the local NASA GLB file.</small>
            </>
          )}
        </div>
      )}
    </div>
  );
}