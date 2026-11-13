"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";

import {
  loadLolaTerrain,
  isLolaPixelInsideRaster,
  type GeographicCoordinate,
  type LolaTerrainData,
  type RasterPixelCoordinate,
} from "@/components/lib/lunar/terrainData";

import { lolaPixelToGeographic } from "@/components/lib/lunar/lunarMapCoordinates";

interface LunarMapProps {
  onLocationSelect?: (
    coordinate: GeographicCoordinate,
    pixel: RasterPixelCoordinate,
  ) => void;
}

interface MapView {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  moved: boolean;
}

const INITIAL_VIEW: MapView = {
  scale: 0.2,
  offsetX: 0,
  offsetY: 0,
};

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 12;

const LIGHT_AZIMUTH_DEGREES = 315;
const LIGHT_ALTITUDE_DEGREES = 35;
const VERTICAL_EXAGGERATION = 1.4;

function getElevationPercentiles(
  elevations: Float32Array,
  minElevation: number,
  maxElevation: number,
) {
  const bins = 4096;
  const histogram = new Uint32Array(bins);
  const range = maxElevation - minElevation;

  if (!Number.isFinite(range) || range <= 0) {
    return {
      low: minElevation,
      high: maxElevation,
    };
  }

  let validCount = 0;

  for (let i = 0; i < elevations.length; i++) {
    const value = elevations[i];

    if (!Number.isFinite(value)) continue;

    const normalized = Math.max(
      0,
      Math.min(0.999999, (value - minElevation) / range),
    );

    const bin = Math.floor(normalized * bins);

    histogram[bin]++;
    validCount++;
  }

  if (validCount === 0) {
    return {
      low: minElevation,
      high: maxElevation,
    };
  }

  const findPercentile = (percentile: number) => {
    const target = Math.floor(validCount * percentile);
    let accumulated = 0;

    for (let i = 0; i < bins; i++) {
      accumulated += histogram[i];

      if (accumulated >= target) {
        return minElevation + (i / bins) * range;
      }
    }

    return maxElevation;
  };

  return {
    low: findPercentile(0.01),
    high: findPercentile(0.99),
  };
}

function getElevationAt(
  elevations: Float32Array,
  width: number,
  height: number,
  column: number,
  row: number,
) {
  const x = Math.max(0, Math.min(width - 1, column));
  const y = Math.max(0, Math.min(height - 1, row));

  return elevations[y * width + x];
}

/**
 * Builds a shaded-relief image from the actual LOLA elevation raster.
 *
 * This is a digital elevation model visualization, not photographic
 * lunar surface imagery.
 */
function createElevationRaster(terrain: LolaTerrainData): HTMLCanvasElement {
  const { width, height, elevations } = terrain;

  const raster = document.createElement("canvas");

  raster.width = width;
  raster.height = height;

  const context = raster.getContext("2d", {
    alpha: false,
  });

  if (!context) {
    throw new Error("Unable to create lunar map canvas.");
  }

  const imageData = context.createImageData(width, height);

  const { low, high } = getElevationPercentiles(
    elevations,
    terrain.minElevation,
    terrain.maxElevation,
  );

  const elevationRange = Math.max(high - low, 1);

  const resolution = Math.max(terrain.metadata.resolutionMeters, 0.001);

  const azimuth = (LIGHT_AZIMUTH_DEGREES * Math.PI) / 180;

  const altitude = (LIGHT_ALTITUDE_DEGREES * Math.PI) / 180;

  // Screen-coordinate light direction.
  // Negative X and Y means light comes from the upper-left.
  const lightX = -Math.cos(altitude) * Math.sin(azimuth);
  const lightY = -Math.cos(altitude) * Math.cos(azimuth);
  const lightZ = Math.sin(altitude);

  const ambientLight = 0.32;
  const directionalLight = 0.68;

  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const index = row * width + column;
      const elevation = elevations[index];

      const pixelOffset = index * 4;

      if (!Number.isFinite(elevation)) {
        imageData.data[pixelOffset] = 20;
        imageData.data[pixelOffset + 1] = 20;
        imageData.data[pixelOffset + 2] = 20;
        imageData.data[pixelOffset + 3] = 255;
        continue;
      }

      // Horn's 3x3 method estimates the terrain gradient.
      const z1 = getElevationAt(elevations, width, height, column - 1, row - 1);
      const z2 = getElevationAt(elevations, width, height, column, row - 1);
      const z3 = getElevationAt(elevations, width, height, column + 1, row - 1);
      const z4 = getElevationAt(elevations, width, height, column - 1, row);
      const z6 = getElevationAt(elevations, width, height, column + 1, row);
      const z7 = getElevationAt(elevations, width, height, column - 1, row + 1);
      const z8 = getElevationAt(elevations, width, height, column, row + 1);
      const z9 = getElevationAt(elevations, width, height, column + 1, row + 1);

      const validNeighbors = [z1, z2, z3, z4, z6, z7, z8, z9].every(
        Number.isFinite,
      );

      let illumination = 0.72;

      if (validNeighbors) {
        // X increases from left to right.
        const dzdx = (z3 + 2 * z6 + z9 - (z1 + 2 * z4 + z7)) / (8 * resolution);

        // Screen Y increases from top to bottom.
        const dzdy = (z7 + 2 * z8 + z9 - (z1 + 2 * z2 + z3)) / (8 * resolution);

        const slopeX = dzdx * VERTICAL_EXAGGERATION;
        const slopeY = dzdy * VERTICAL_EXAGGERATION;

        // Surface normal in screen coordinates.
        let normalX = -slopeX;
        let normalY = -slopeY;
        let normalZ = 1;

        const normalLength = Math.sqrt(
          normalX * normalX + normalY * normalY + normalZ * normalZ,
        );

        normalX /= normalLength;
        normalY /= normalLength;
        normalZ /= normalLength;

        const dot = normalX * lightX + normalY * lightY + normalZ * lightZ;

        illumination = ambientLight + directionalLight * Math.max(0, dot);
      }

      // Elevation contrast is independent of hillshade.
      const normalizedElevation = Math.max(
        0,
        Math.min(1, (elevation - low) / elevationRange),
      );

      // Neutral lunar-grey base tone.
      const elevationTone = 102 + normalizedElevation * 66;

      // Directional relief adds visible crater walls and ridges.
      const shadedTone = Math.max(
        12,
        Math.min(235, elevationTone * illumination),
      );

      const shade = Math.round(shadedTone);

      imageData.data[pixelOffset] = shade;
      imageData.data[pixelOffset + 1] = shade;
      imageData.data[pixelOffset + 2] = shade;
      imageData.data[pixelOffset + 3] = 255;
    }
  }

  context.putImageData(imageData, 0, 0);

  return raster;
}

function getFittedView(
  terrain: LolaTerrainData,
  viewport: ViewportSize,
): MapView {
  const scale =
    Math.min(viewport.width / terrain.width, viewport.height / terrain.height) *
    0.94;

  return {
    scale,
    offsetX: (viewport.width - terrain.width * scale) / 2,
    offsetY: (viewport.height - terrain.height * scale) / 2,
  };
}

export default function LunarMap({ onLocationSelect }: LunarMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rasterRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const [terrain, setTerrain] = useState<LolaTerrainData | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [viewport, setViewport] = useState<ViewportSize>({
    width: 0,
    height: 0,
  });

  const [view, setView] = useState<MapView>(INITIAL_VIEW);

  const [selected, setSelected] = useState<{
    coordinate: GeographicCoordinate;
    pixel: RasterPixelCoordinate;
  } | null>(null);

  // Load and shade the actual Product 78 elevation data.
  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        setLoading(true);
        setError(null);

        const loadedTerrain = await loadLolaTerrain();

        if (cancelled) return;

        const raster = createElevationRaster(loadedTerrain);

        if (cancelled) return;

        rasterRef.current = raster;
        setTerrain(loadedTerrain);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load lunar elevation data.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  // Track the map viewport.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;

    if (!container) return;

    const observer = new ResizeObserver(([entry]) => {
      setViewport({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });

    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  // Fit the raster when the data or viewport first becomes available.
  useEffect(() => {
    if (!terrain || viewport.width <= 0 || viewport.height <= 0) {
      return;
    }

    // Intentional initial view update after terrain and viewport initialization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView((previous) => {
      if (
        previous.scale !== INITIAL_VIEW.scale ||
        previous.offsetX !== INITIAL_VIEW.offsetX ||
        previous.offsetY !== INITIAL_VIEW.offsetY
      ) {
        return previous;
      }

      return getFittedView(terrain, viewport);
    });
  }, [terrain, viewport]);
  // Render the raster and the selected coordinate.
  useEffect(() => {
    const canvas = canvasRef.current;
    const raster = rasterRef.current;

    if (!canvas || !raster || viewport.width <= 0 || viewport.height <= 0) {
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);

    const context = canvas.getContext("2d", {
      alpha: false,
    });

    if (!context) return;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    context.fillStyle = "#101214";
    context.fillRect(0, 0, viewport.width, viewport.height);

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    context.drawImage(
      raster,
      view.offsetX,
      view.offsetY,
      raster.width * view.scale,
      raster.height * view.scale,
    );

    if (selected) {
      const markerX = view.offsetX + selected.pixel.column * view.scale;

      const markerY = view.offsetY + selected.pixel.row * view.scale;

      // Subtle dark outline keeps the target visible on bright terrain.
      context.beginPath();
      context.arc(markerX, markerY, 10, 0, Math.PI * 2);
      context.strokeStyle = "rgba(0, 0, 0, 0.8)";
      context.lineWidth = 4;
      context.stroke();

      // Fine gold target ring.
      context.beginPath();
      context.arc(markerX, markerY, 8, 0, Math.PI * 2);
      context.strokeStyle = "#E7C77D";
      context.lineWidth = 1.5;
      context.stroke();

      context.beginPath();
      context.arc(markerX, markerY, 2, 0, Math.PI * 2);
      context.fillStyle = "#F4D99B";
      context.fill();

      context.beginPath();
      context.moveTo(markerX - 14, markerY);
      context.lineTo(markerX - 5, markerY);
      context.moveTo(markerX + 5, markerY);
      context.lineTo(markerX + 14, markerY);
      context.moveTo(markerX, markerY - 14);
      context.lineTo(markerX, markerY - 5);
      context.moveTo(markerX, markerY + 5);
      context.lineTo(markerX, markerY + 14);

      context.strokeStyle = "#E7C77D";
      context.lineWidth = 1;
      context.stroke();
    }
  }, [terrain, viewport, view, selected]);

  const selectMapPosition = useCallback(
    (screenX: number, screenY: number) => {
      if (!terrain) return;

      const pixel: RasterPixelCoordinate = {
        column: (screenX - view.offsetX) / view.scale,
        row: (screenY - view.offsetY) / view.scale,
      };

      if (!isLolaPixelInsideRaster(pixel, terrain)) {
        return;
      }

      try {
        const coordinate = lolaPixelToGeographic(pixel, terrain.metadata);

        const selection = {
          coordinate,
          pixel,
        };

        setSelected(selection);
        onLocationSelect?.(coordinate, pixel);
      } catch (err) {
        console.error("[LunarMap] Coordinate conversion failed:", err);
      }
    },
    [terrain, view, onLocationSelect],
  );

  const zoomAt = useCallback(
    (screenX: number, screenY: number, factor: number) => {
      setView((previous) => {
        const newScale = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, previous.scale * factor),
        );

        const mapX = (screenX - previous.offsetX) / previous.scale;

        const mapY = (screenY - previous.offsetY) / previous.scale;

        return {
          scale: newScale,
          offsetX: screenX - mapX * newScale,
          offsetY: screenY - mapY * newScale,
        };
      });
    },
    [],
  );

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();

    zoomAt(
      event.clientX - rect.left,
      event.clientY - rect.top,
      event.deltaY < 0 ? 1.15 : 1 / 1.15,
    );
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: view.offsetX,
      offsetY: view.offsetY,
      moved: false,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
      drag.moved = true;
      setIsDragging(true);
    }

    if (drag.moved) {
      setView((previous) => ({
        ...previous,
        offsetX: drag.offsetX + deltaX,
        offsetY: drag.offsetY + deltaY,
      }));
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) return;

    if (!drag.moved) {
      const rect = event.currentTarget.getBoundingClientRect();

      selectMapPosition(event.clientX - rect.left, event.clientY - rect.top);
    }

    dragRef.current = null;
    setIsDragging(false);
  };

  const resetView = () => {
    if (!terrain || !viewport.width || !viewport.height) {
      return;
    }

    setView(getFittedView(terrain, viewport));
  };

  const formatCoordinate = (value: number) => value.toFixed(5);

  return (
    <section className="w-full space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-neutral-400">
            PRODUCT 78 · LOLA SHADED RELIEF
          </p>

          <h2 className="mt-1 text-lg font-medium text-white">
            Select a lunar location
          </h2>

          <p className="mt-1 text-xs text-neutral-500">
            Terrain shape is derived from measured elevation data.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => zoomAt(viewport.width / 2, viewport.height / 2, 1.4)}
            disabled={!terrain}
            className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white hover:bg-white/10 disabled:opacity-40"
            aria-label="Zoom in"
          >
            +
          </button>

          <button
            type="button"
            onClick={() =>
              zoomAt(viewport.width / 2, viewport.height / 2, 1 / 1.4)
            }
            disabled={!terrain}
            className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white hover:bg-white/10 disabled:opacity-40"
            aria-label="Zoom out"
          >
            −
          </button>

          <button
            type="button"
            onClick={resetView}
            disabled={!terrain}
            className="rounded-lg border border-white/15 px-3 py-2 text-xs text-neutral-300 hover:bg-white/10 disabled:opacity-40"
          >
            RESET
          </button>
        </div>
      </div>

      <div className="relative h-[560px] w-full overflow-hidden rounded-xl border border-white/10 bg-[#101214]">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Interactive LOLA shaded-relief elevation map. Drag to pan, scroll to zoom, and click to select a lunar coordinate."
          className="h-full w-full touch-none"
          style={{
            cursor: isDragging ? "grabbing" : "crosshair",
          }}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            dragRef.current = null;
            setIsDragging(false);
          }}
        />

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#101214]">
            <div className="text-center">
              <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-white/20 border-t-white" />
              <p className="text-sm text-neutral-300">
                Processing LOLA elevation data...
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                Generating terrain relief from the 3,200 × 3,200 raster
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#101214] p-6">
            <div className="max-w-md text-center">
              <p className="text-sm font-semibold text-red-400">
                Map loading failed
              </p>

              <p className="mt-2 break-words text-xs text-neutral-400">
                {error}
              </p>

              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-4 rounded-lg border border-white/20 px-4 py-2 text-sm text-white"
              >
                Reload page
              </button>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-white/10 bg-black/65 px-3 py-2 backdrop-blur">
          <p className="text-[10px] tracking-wider text-neutral-400">
            ELEVATION RANGE
          </p>

          <p className="text-xs text-neutral-200">
            {terrain
              ? `${terrain.minElevation.toFixed(0)} m to ${terrain.maxElevation.toFixed(0)} m`
              : "Loading..."}
          </p>
        </div>

        <div className="pointer-events-none absolute bottom-3 right-3 rounded-md border border-white/10 bg-black/65 px-3 py-2 text-[10px] text-neutral-300 backdrop-blur">
          DRAG TO PAN · SCROLL TO ZOOM
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        {selected ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[10px] tracking-[0.18em] text-neutral-500">
                SELECTED LUNAR COORDINATES
              </p>

              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                <p className="font-mono text-sm text-white">
                  {formatCoordinate(Math.abs(selected.coordinate.latitudeDeg))}°
                  S
                </p>

                <p className="font-mono text-sm text-white">
                  {formatCoordinate(selected.coordinate.longitudeEastDeg)}° E
                </p>
              </div>

              <p className="mt-2 text-xs text-neutral-500">
                Raster pixel: {selected.pixel.column.toFixed(2)},{" "}
                {selected.pixel.row.toFixed(2)}
              </p>
            </div>

            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
              LOCATION SELECTED
            </span>
          </div>
        ) : (
          <div>
            <p className="text-sm text-neutral-200">No location selected</p>

            <p className="mt-1 text-xs text-neutral-500">
              Click anywhere inside the displayed Product 78 raster.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-500">
        <p>Source: LOLA Product 78 · 5 m/pixel · South Polar Stereographic</p>

        <p>
          Shaded relief · Directional illumination · 1%–99% elevation contrast
        </p>
      </div>
    </section>
  );
}
