
"use client";

import { useEffect, useRef, useState } from "react";

import Map from "ol/Map.js";
import View from "ol/View.js";
import Overlay from "ol/Overlay.js";
import TileLayer from "ol/layer/Tile.js";
import XYZ from "ol/source/XYZ.js";
import TileGrid from "ol/tilegrid/TileGrid.js";
import Projection from "ol/proj/Projection.js";
import { get as getProjection } from "ol/proj.js";
import { defaults as defaultControls } from "ol/control/defaults.js";
import proj4 from "proj4";
import { register } from "ol/proj/proj4.js";

import "ol/ol.css";

export interface MoonGeographicCoordinate {
  latitudeDeg: number;
  longitudeEastDeg: number;
}

interface MoonTrekMapProps {
  onLocationSelect?: (
    coordinate: MoonGeographicCoordinate
  ) => void;
}

const PROJECTION_CODE = "IAU2000:30120";

const COVERAGE: [number, number, number, number] = [
  -931100,
  -931100,
  931100,
  931100,
];

const ORIGIN: [number, number] = [
  -1095930,
  1095930,
];

const MATRIX_IDS = ["0", "1", "2", "3", "4"];

const SCALE_DENOMINATORS = [
  3.0578404017857101e7,
  1.5289202008928550e7,
  7.6446010044642752e6,
  3.8223005022321376e6,
  1.9111502511160688e6,
];

const RESOLUTIONS = SCALE_DENOMINATORS.map(
  (scale) => scale * 0.00028
);

const TILE_URL =
  "https://trek.nasa.gov/tiles/Moon/SP/" +
  "LRO_WAC_Mosaic_SPole60_100mp/1.0.0/" +
  "default/default028mm/{z}/{y}/{x}.png";

function registerLunarProjection() {
  proj4.defs(
    PROJECTION_CODE,
    [
      "+proj=stere",
      "+lat_0=-90",
      "+lon_0=0",
      "+k=1",
      "+x_0=0",
      "+y_0=0",
      "+a=1737400",
      "+b=1737400",
      "+units=m",
      "+no_defs",
    ].join(" ")
  );

  proj4.defs(
    "IAU2000:30100",
    [
      "+proj=longlat",
      "+a=1737400",
      "+b=1737400",
      "+no_defs",
    ].join(" ")
  );

  register(proj4);

  if (!getProjection(PROJECTION_CODE)) {
    const projection = new Projection({
      code: PROJECTION_CODE,
      units: "m",
      extent: COVERAGE,
    });

    projection.setExtent(COVERAGE);
  }
}

function createMoonProjection() {
  registerLunarProjection();

  const projection = getProjection(PROJECTION_CODE);

  if (!projection) {
    throw new Error(
      "Unable to register the lunar South Polar projection."
    );
  }

  projection.setExtent(COVERAGE);

  return projection;
}

function createLandingMarker() {
  const element = document.createElement("div");

  element.style.cssText = `
    width: 42px;
    height: 42px;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  `;

  element.innerHTML = `
    <div style="
      position:absolute;
      inset:0;
      border:1px solid rgba(34,211,238,0.65);
      border-radius:50%;
      animation:lunar-marker-pulse 1.8s ease-out infinite;
    "></div>

    <div style="
      position:absolute;
      width:24px;
      height:24px;
      border:2px solid #22d3ee;
      border-radius:50%;
      box-shadow:0 0 12px rgba(34,211,238,0.8);
    "></div>

    <div style="
      position:absolute;
      width:6px;
      height:6px;
      background:#22d3ee;
      border:1px solid white;
      border-radius:50%;
    "></div>

    <div style="
      position:absolute;
      width:42px;
      height:1px;
      background:rgba(34,211,238,0.8);
    "></div>

    <div style="
      position:absolute;
      width:1px;
      height:42px;
      background:rgba(34,211,238,0.8);
    "></div>
  `;

  return element;
}

export default function MoonTrekMap({
  onLocationSelect,
}: MoonTrekMapProps) {
  const mapElementRef = useRef<HTMLDivElement>(null);

  const [mapError, setMapError] = useState<string | null>(null);

  const [selectedCoordinate, setSelectedCoordinate] =
    useState<MoonGeographicCoordinate | null>(null);

  const onLocationSelectRef = useRef(onLocationSelect);

  useEffect(() => {
    onLocationSelectRef.current = onLocationSelect;
  }, [onLocationSelect]);

  useEffect(() => {
    const target = mapElementRef.current;

    if (!target) return;

    let map: Map | null = null;

    try {
      const projection = createMoonProjection();

      const tileGrid = new TileGrid({
        extent: [
          -1095930,
          -1095930,
          1095930,
          1095930,
        ],
        origin: ORIGIN,
        resolutions: RESOLUTIONS,
        tileSize: 256,
        sizes: [
          [2, 1],
          [4, 2],
          [8, 4],
          [16, 8],
          [32, 16],
        ],
      });

      const source = new XYZ({
        projection,
        tileGrid,
        tileUrlFunction: (tileCoordinate) => {
          if (!tileCoordinate) return undefined;

          const [z, x, y] = tileCoordinate;

          if (z < 0 || z >= MATRIX_IDS.length) {
            return undefined;
          }

          return TILE_URL
            .replace("{z}", String(z))
            .replace("{x}", String(x))
            .replace("{y}", String(y));
        },
        wrapX: false,
        crossOrigin: "anonymous",
        maxZoom: 4,
        attributions:
          "Imagery: NASA / JPL / LRO Wide Angle Camera",
      });

      const layer = new TileLayer({ source });

      const markerElement = createLandingMarker();

      const markerOverlay = new Overlay({
        element: markerElement,
        positioning: "center-center",
        stopEvent: false,
      });

      map = new Map({
        target,
        layers: [layer],
        overlays: [markerOverlay],
        controls: defaultControls({
          rotate: false,
        }),
        view: new View({
          projection,
          center: [-85619.53125, -166958.0859375],
          resolution: RESOLUTIONS[2],
          minResolution: RESOLUTIONS[4],
          maxResolution: RESOLUTIONS[0],
          extent: COVERAGE,
          constrainOnlyCenter: false,
        }),
      });

      map.on("singleclick", (event) => {
        try {
          const [longitude, latitude] = proj4(
            PROJECTION_CODE,
            "IAU2000:30100",
            event.coordinate
          );

          if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            latitude < -90 ||
            latitude > 90
          ) {
            return;
          }

          const coordinate: MoonGeographicCoordinate = {
            latitudeDeg: latitude,
            longitudeEastDeg:
              ((longitude % 360) + 360) % 360,
          };

          markerOverlay.setPosition(event.coordinate);
          setSelectedCoordinate(coordinate);
          onLocationSelectRef.current?.(coordinate);

          console.log(
            "[MoonTrekMap] Landing location selected:",
            coordinate
          );
        } catch (error) {
          console.error(
            "[MoonTrekMap] Coordinate conversion failed:",
            error
          );
        }
      });

      map.updateSize();

      requestAnimationFrame(() => {
        map?.updateSize();
      });
    } catch (error) {
      setMapError(
        error instanceof Error
          ? error.message
          : "Unable to initialize Moon Trek."
      );
    }

    return () => {
      if (map) {
        map.setTarget(undefined);
        map.dispose();
      }
    };
  }, []);

  return (
    <section className="w-full space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.2em] text-neutral-400">
            NASA MOON TREK · LRO WAC MOSAIC
          </p>

          <h2 className="mt-1 text-xl font-medium text-white">
            Lunar South Pole
          </h2>

          <p className="mt-1 text-xs text-neutral-500">
            Click the lunar surface to choose your landing location.
          </p>
        </div>

        <span className="rounded-md border border-white/10 px-3 py-2 text-[10px] tracking-wider text-neutral-400">
          NASA / JPL
        </span>
      </div>

      <div className="relative h-[620px] w-full overflow-hidden rounded-xl border border-white/10 bg-[#101214]">
        <div
          ref={mapElementRef}
          className="h-full w-full"
        />

        {mapError && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#101214] p-6">
            <div className="max-w-md text-center">
              <p className="text-sm font-semibold text-red-400">
                Moon Trek initialization failed
              </p>

              <p className="mt-2 break-words text-xs text-neutral-400">
                {mapError}
              </p>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-white/10 bg-black/70 px-3 py-2 text-[10px] text-neutral-300 backdrop-blur">
          CLICK TO SELECT · DRAG TO PAN · SCROLL TO ZOOM
        </div>

        {selectedCoordinate && (
          <div className="pointer-events-none absolute right-3 top-3 rounded-lg border border-cyan-400/30 bg-black/80 px-3 py-2 backdrop-blur">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-400" />
              <span className="text-[10px] font-semibold tracking-wider text-cyan-300">
                LANDING TARGET SELECTED
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        {selectedCoordinate ? (
          <>
            <p className="text-[10px] tracking-[0.18em] text-cyan-300">
              SELECTED LANDING COORDINATES
            </p>

            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 font-mono text-sm text-white">
              <span>
                {Math.abs(selectedCoordinate.latitudeDeg).toFixed(5)}°
                {" "}
                {selectedCoordinate.latitudeDeg < 0 ? "S" : "N"}
              </span>

              <span>
                {selectedCoordinate.longitudeEastDeg.toFixed(5)}° E
              </span>
            </div>

            <p className="mt-3 text-xs text-neutral-500">
              Click another location to move your landing target.
            </p>
          </>
        ) : (
          <div>
            <p className="text-xs font-medium text-white">
              No landing site selected
            </p>

            <p className="mt-1 text-xs text-neutral-400">
              Click once on the map to place your landing target.
            </p>
          </div>
        )}
      </div>

      <p className="text-[10px] text-neutral-500">
        Source: NASA/JPL Moon Trek · LRO WAC South Pole Mosaic
        · IAU2000:30120
      </p>

      <style jsx>{`
        @keyframes lunar-marker-pulse {
          0% {
            transform: scale(0.45);
            opacity: 1;
          }
          100% {
            transform: scale(1.5);
            opacity: 0;
          }
        }
      `}</style>
    </section>
  );
}
