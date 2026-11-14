
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";

import {
  loadLolaTerrainForSite,
  isLolaPixelInsideRaster,
  type GeographicCoordinate,
  type LolaTerrainData,
  type RasterPixelCoordinate,
} from "@/components/lib/lunar/terrainData";

import type { Product78SiteId } from "@/components/lib/lunar/siteRegistry";
import { lolaPixelToGeographic } from "@/components/lib/lunar/lunarMapCoordinates";

interface LunarMapSelection {
  coordinate: GeographicCoordinate;
  pixel: RasterPixelCoordinate;
}

interface LunarMapProps {
  siteId: Product78SiteId;
  onLocationSelect?: (
    coordinate: GeographicCoordinate,
    pixel: RasterPixelCoordinate,
  ) => void;
  compact?: boolean;
  initialSelection?: LunarMapSelection | null;
  interactiveSelection?: boolean;
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

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 12;
const DISPLAY_SAMPLE_STEP = 4;

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
    return { low: minElevation, high: maxElevation };
  }

  let validCount = 0;

  for (
    let index = 0;
    index < elevations.length;
    index += DISPLAY_SAMPLE_STEP
  ) {
    const value = elevations[index];

    if (!Number.isFinite(value)) continue;

    const normalized = Math.max(
      0,
      Math.min(0.999999, (value - minElevation) / range),
    );

    histogram[Math.floor(normalized * bins)]++;
    validCount++;
  }

  if (validCount === 0) {
    return { low: minElevation, high: maxElevation };
  }

  const findPercentile = (percentile: number) => {
    const target = Math.max(1, Math.floor(validCount * percentile));
    let accumulated = 0;

    for (let index = 0; index < bins; index++) {
      accumulated += histogram[index];

      if (accumulated >= target) {
        return minElevation + (index / bins) * range;
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

function createElevationRaster(
  terrain: LolaTerrainData,
): HTMLCanvasElement {
  const { width, height, elevations } = terrain;
  const step = DISPLAY_SAMPLE_STEP;

  const outputWidth = Math.ceil(width / step);
  const outputHeight = Math.ceil(height / step);

  const raster = document.createElement("canvas");
  raster.width = outputWidth;
  raster.height = outputHeight;

  const context = raster.getContext("2d", { alpha: false });

  if (!context) {
    throw new Error("Unable to create lunar map canvas.");
  }

  const imageData = context.createImageData(outputWidth, outputHeight);

  const { low, high } = getElevationPercentiles(
    elevations,
    terrain.minElevation,
    terrain.maxElevation,
  );

  const elevationRange = Math.max(high - low, 1);
  const sourceResolution = terrain.metadata.resolutionMeters || 5;
  const resolution = Math.max(sourceResolution * step, 0.001);

  const azimuth = (LIGHT_AZIMUTH_DEGREES * Math.PI) / 180;
  const altitude = (LIGHT_ALTITUDE_DEGREES * Math.PI) / 180;

  const lightX = -Math.cos(altitude) * Math.sin(azimuth);
  const lightY = -Math.cos(altitude) * Math.cos(azimuth);
  const lightZ = Math.sin(altitude);

  const ambientLight = 0.32;
  const directionalLight = 0.68;

  for (let outputRow = 0; outputRow < outputHeight; outputRow++) {
    const sourceRow = Math.min(height - 1, outputRow * step);

    for (
      let outputColumn = 0;
      outputColumn < outputWidth;
      outputColumn++
    ) {
      const sourceColumn = Math.min(width - 1, outputColumn * step);

      const sourceIndex = sourceRow * width + sourceColumn;
      const elevation = elevations[sourceIndex];
      const pixelOffset =
        (outputRow * outputWidth + outputColumn) * 4;

      if (!Number.isFinite(elevation)) {
        imageData.data[pixelOffset] = 20;
        imageData.data[pixelOffset + 1] = 20;
        imageData.data[pixelOffset + 2] = 20;
        imageData.data[pixelOffset + 3] = 255;
        continue;
      }

      const z1 = getElevationAt(
        elevations, width, height, sourceColumn - step, sourceRow - step,
      );
      const z2 = getElevationAt(
        elevations, width, height, sourceColumn, sourceRow - step,
      );
      const z3 = getElevationAt(
        elevations, width, height, sourceColumn + step, sourceRow - step,
      );
      const z4 = getElevationAt(
        elevations, width, height, sourceColumn - step, sourceRow,
      );
      const z6 = getElevationAt(
        elevations, width, height, sourceColumn + step, sourceRow,
      );
      const z7 = getElevationAt(
        elevations, width, height, sourceColumn - step, sourceRow + step,
      );
      const z8 = getElevationAt(
        elevations, width, height, sourceColumn, sourceRow + step,
      );
      const z9 = getElevationAt(
        elevations, width, height, sourceColumn + step, sourceRow + step,
      );

      const validNeighbors = [
        z1, z2, z3, z4, z6, z7, z8, z9,
      ].every(Number.isFinite);

      let illumination = 0.72;

      if (validNeighbors) {
        const dzdx =
          (z3 + 2 * z6 + z9 - (z1 + 2 * z4 + z7)) /
          (8 * resolution);

        const dzdy =
          (z7 + 2 * z8 + z9 - (z1 + 2 * z2 + z3)) /
          (8 * resolution);

        const slopeX = dzdx * VERTICAL_EXAGGERATION;
        const slopeY = dzdy * VERTICAL_EXAGGERATION;

        let normalX = -slopeX;
        let normalY = -slopeY;
        let normalZ = 1;

        const normalLength = Math.sqrt(
          normalX * normalX +
          normalY * normalY +
          normalZ * normalZ,
        );

        normalX /= normalLength;
        normalY /= normalLength;
        normalZ /= normalLength;

        const dot =
          normalX * lightX +
          normalY * lightY +
          normalZ * lightZ;

        illumination =
          ambientLight +
          directionalLight * Math.max(0, dot);
      }

      const normalizedElevation = Math.max(
        0,
        Math.min(1, (elevation - low) / elevationRange),
      );

      const elevationTone = 102 + normalizedElevation * 66;

      const shade = Math.round(
        Math.max(12, Math.min(235, elevationTone * illumination)),
      );

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
    Math.min(
      viewport.width / terrain.width,
      viewport.height / terrain.height,
    ) * 0.94;

  return {
    scale,
    offsetX: (viewport.width - terrain.width * scale) / 2,
    offsetY: (viewport.height - terrain.height * scale) / 2,
  };
}

export default function LunarMap({
  siteId,
  onLocationSelect,
  compact = false,
  initialSelection = null,
  interactiveSelection = true,
}: LunarMapProps) {
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

  const [view, setView] = useState<MapView>({
    scale: 0.2,
    offsetX: 0,
    offsetY: 0,
  });

  const [selected, setSelected] = useState<LunarMapSelection | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      setLoading(true);
      setError(null);
      setTerrain(null);
      rasterRef.current = null;
      setSelected(null);

      try {
        const loadedTerrain = await loadLolaTerrainForSite(siteId);

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
              : `Failed to load LOLA data for ${siteId}.`,
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [siteId]);

  useEffect(() => {
    if (!terrain) return;

    if (
      initialSelection &&
      isLolaPixelInsideRaster(initialSelection.pixel, terrain)
    ) {
      setSelected(initialSelection);
    } else {
      setSelected(null);
    }
  }, [terrain, initialSelection]);

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

  useEffect(() => {
    if (!terrain || viewport.width <= 0 || viewport.height <= 0) {
      return;
    }

    setView(getFittedView(terrain, viewport));
  }, [terrain, viewport]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const raster = rasterRef.current;

    if (
      !canvas ||
      !raster ||
      !terrain ||
      viewport.width <= 0 ||
      viewport.height <= 0
    ) {
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);

    const context = canvas.getContext("2d", { alpha: false });
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
      terrain.width * view.scale,
      terrain.height * view.scale,
    );

    if (selected) {
      const markerX =
        view.offsetX + (selected.pixel.column + 0.5) * view.scale;

      const markerY =
        view.offsetY + (selected.pixel.row + 0.5) * view.scale;

      context.beginPath();
      context.arc(markerX, markerY, compact ? 9 : 12, 0, Math.PI * 2);
      context.fillStyle = "rgba(231, 199, 125, 0.12)";
      context.fill();

      context.beginPath();
      context.arc(markerX, markerY, compact ? 7 : 9, 0, Math.PI * 2);
      context.strokeStyle = "rgba(0, 0, 0, 0.85)";
      context.lineWidth = 4;
      context.stroke();

      context.beginPath();
      context.arc(markerX, markerY, compact ? 5 : 7, 0, Math.PI * 2);
      context.strokeStyle = "#E7C77D";
      context.lineWidth = 1.7;
      context.stroke();

      context.beginPath();
      context.arc(markerX, markerY, 2, 0, Math.PI * 2);
      context.fillStyle = "#F4D99B";
      context.fill();

      context.beginPath();
      context.moveTo(markerX - 15, markerY);
      context.lineTo(markerX - 5, markerY);
      context.moveTo(markerX + 5, markerY);
      context.lineTo(markerX + 15, markerY);
      context.moveTo(markerX, markerY - 15);
      context.lineTo(markerX, markerY - 5);
      context.moveTo(markerX, markerY + 5);
      context.lineTo(markerX, markerY + 15);

      context.strokeStyle = "#E7C77D";
      context.lineWidth = 1;
      context.stroke();
    }
  }, [terrain, viewport, view, selected, compact]);

  const selectMapPosition = useCallback(
    (screenX: number, screenY: number) => {
      if (!interactiveSelection || !terrain || view.scale <= 0) return;

      const pixel: RasterPixelCoordinate = {
        column: (screenX - view.offsetX) / view.scale - 0.5,
        row: (screenY - view.offsetY) / view.scale - 0.5,
      };

      if (
        pixel.column < 0 ||
        pixel.row < 0 ||
        pixel.column > terrain.width - 1 ||
        pixel.row > terrain.height - 1 ||
        !isLolaPixelInsideRaster(pixel, terrain)
      ) {
        return;
      }

      try {
        const coordinate = lolaPixelToGeographic(
          pixel,
          terrain.metadata,
        );

        const selection = { coordinate, pixel };

        setSelected(selection);
        onLocationSelect?.(coordinate, pixel);
      } catch (err) {
        console.error("[LunarMap] Coordinate conversion failed:", err);
      }
    },
    [terrain, view, onLocationSelect, interactiveSelection],
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

  const handleWheel = (
    event: ReactWheelEvent<HTMLCanvasElement>,
  ) => {
    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();

    zoomAt(
      event.clientX - rect.left,
      event.clientY - rect.top,
      event.deltaY < 0 ? 1.15 : 1 / 1.15,
    );
  };

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
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

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
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

  const handlePointerUp = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (!drag.moved) {
      const rect = event.currentTarget.getBoundingClientRect();

      selectMapPosition(
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    }

    dragRef.current = null;
    setIsDragging(false);
  };

  const resetView = () => {
    if (!terrain || !viewport.width || !viewport.height) return;
    setView(getFittedView(terrain, viewport));
  };

  const formatCoordinate = (value: number) => value.toFixed(5);

  return (
    <section className="w-full space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.22em] text-white/40">
            NASA LOLA · PRODUCT 78 · SHADED RELIEF
          </p>

          <h3 className="mt-1 text-base font-medium text-white">
            {compact
              ? siteId.replaceAll("_", " ").replace("site", "Site ")
              : "Selected lunar terrain"}
          </h3>

          {!compact && (
            <p className="mt-1 text-xs text-white/40">
              Elevation-derived terrain visualization for the selected landing site.
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              zoomAt(viewport.width / 2, viewport.height / 2, 1.4)
            }
            disabled={!terrain}
            className="h-9 w-9 rounded-lg border border-white/15 bg-white/[0.025] text-lg text-white transition duration-200 hover:border-white/35 hover:bg-white/[0.09] active:scale-95 disabled:opacity-40"
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
            className="h-9 w-9 rounded-lg border border-white/15 bg-white/[0.025] text-lg text-white transition duration-200 hover:border-white/35 hover:bg-white/[0.09] active:scale-95 disabled:opacity-40"
            aria-label="Zoom out"
          >
            −
          </button>

          <button
            type="button"
            onClick={resetView}
            disabled={!terrain}
            className="h-9 rounded-lg border border-white/15 bg-white/[0.025] px-3 text-[10px] font-semibold tracking-wider text-white/65 transition duration-200 hover:border-white/35 hover:bg-white/[0.09] hover:text-white active:scale-[0.98] disabled:opacity-40"
          >
            RESET VIEW
          </button>
        </div>
      </div>

      <div
        className={`relative w-full overflow-hidden rounded-xl border border-white/10 bg-[#101214] ${
          compact ? "h-[260px]" : "h-[min(65vh,620px)] min-h-[380px]"
        }`}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Interactive LOLA shaded-relief elevation map for ${siteId}. Drag to pan and scroll to zoom.`}
          className="h-full w-full touch-none"
          style={{ cursor: isDragging ? "grabbing" : "grab" }}
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
              <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-white" />
              <p className="text-xs text-white/65">
                Loading lunar elevation data...
              </p>
              <p className="mt-1 text-[10px] text-white/35">
                Preparing Product 78 raster
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#101214] p-5">
            <div className="max-w-md text-center">
              <p className="text-sm font-semibold text-red-300">
                Map loading failed
              </p>
              <p className="mt-2 break-words text-xs text-white/45">
                {error}
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-4 rounded-lg border border-white/20 px-4 py-2 text-xs text-white transition hover:bg-white/10"
              >
                Reload page
              </button>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-white/10 bg-black/65 px-3 py-2 backdrop-blur-md">
          <p className="text-[9px] tracking-[0.16em] text-white/40">
            ELEVATION RANGE
          </p>
          <p className="mt-1 text-xs font-medium text-white/85">
            {terrain
              ? `${terrain.minElevation.toFixed(0)} m — ${terrain.maxElevation.toFixed(0)} m`
              : "Loading..."}
          </p>
        </div>

        {selected && (
          <div className="pointer-events-none absolute right-3 top-3 rounded-lg border border-[#e7c77d]/30 bg-black/75 px-3 py-2 backdrop-blur-md">
            <p className="text-[9px] tracking-[0.16em] text-[#e7c77d]">
              OBSERVER POSITION
            </p>
            <p className="mt-1 text-[10px] text-white/80">
              {selected.pixel.column.toFixed(2)},{" "}
              {selected.pixel.row.toFixed(2)}
            </p>
          </div>
        )}

        <div className="pointer-events-none absolute bottom-3 right-3 rounded-lg border border-white/10 bg-black/65 px-3 py-2 text-[9px] tracking-wider text-white/60 backdrop-blur-md">
          DRAG TO PAN · SCROLL TO ZOOM
        </div>
      </div>

      {selected ? (
        <div className="rounded-lg border border-[#e7c77d]/20 bg-[#e7c77d]/[0.035] p-3">
          <p className="text-[9px] tracking-[0.16em] text-[#e7c77d]/75">
            {interactiveSelection
              ? "SELECTED COORDINATES"
              : "API OBSERVER COORDINATES"}
          </p>

          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-white/85">
            <span>
              {formatCoordinate(Math.abs(selected.coordinate.latitudeDeg))}
              ° {selected.coordinate.latitudeDeg < 0 ? "S" : "N"}
            </span>

            <span>
              {formatCoordinate(selected.coordinate.longitudeEastDeg)}° E
            </span>

            <span className="text-white/45">
              Pixel {selected.pixel.column.toFixed(2)},{" "}
              {selected.pixel.row.toFixed(2)}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-white/35">
          {interactiveSelection
            ? "Click inside the terrain raster to select a lunar coordinate."
            : "The observer marker will appear when the mission API returns its raster position."}
        </p>
      )}

      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-white/35">
          <p>
            Source: LOLA Product 78 ·{" "}
            {terrain?.metadata.resolutionMeters ?? "—"} m/pixel
          </p>

          <p>
            {terrain
              ? `${terrain.width.toLocaleString()} × ${terrain.height.toLocaleString()} raster`
              : "Raster dimensions loading"}
            {" · "}Shaded relief · 1%–99% contrast
          </p>
        </div>
      )}
    </section>
  );
}
