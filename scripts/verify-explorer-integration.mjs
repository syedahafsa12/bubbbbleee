import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.LUNAPATH_BASE_URL ?? "http://localhost:3001";
const siteId = "site04_shackleton_rim";
const observer = {
  latitudeDeg: -89.7668,
  longitudeEastDeg: 188.13,
};
const durationHours = 6;
const expectedSamples = durationHours * 6 + 1;

let failures = 0;
let warnings = 0;

function pass(message) {
  console.log(`✓ ${message}`);
}

function warn(message) {
  warnings += 1;
  console.warn(`! ${message}`);
}

function fail(message) {
  failures += 1;
  console.error(`✗ ${message}`);
}

function normalizeEastLongitude(value) {
  return ((value % 360) + 360) % 360;
}

function projectToProduct78Pixel(metadata, coordinate) {
  const radius = metadata.georeferencing.lunarRadiusMeters;
  const latitudeFromSouthPole = (90 + coordinate.latitudeDeg) * Math.PI / 180;
  const longitudeDifference = (
    normalizeEastLongitude(coordinate.longitudeEastDeg) -
    normalizeEastLongitude(metadata.georeferencing.centralMeridianDegrees)
  ) * Math.PI / 180;

  const rho = 2 * radius * Math.tan(latitudeFromSouthPole / 2);
  const projectedX = rho * Math.sin(longitudeDifference);
  const projectedY = rho * Math.cos(longitudeDifference);

  const tie = metadata.georeferencing.tiePoint;
  const [pixelWidth, pixelHeight] = metadata.pixelResolution;

  return {
    column: tie.column + (projectedX - tie.x) / pixelWidth - 0.5,
    row: tie.row + (projectedY - tie.y) / pixelHeight - 0.5,
  };
}

async function getJson(url, label, timeoutMs = 120_000) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${label}: HTTP ${response.status}, response was not JSON.`);
  }

  if (!response.ok || payload?.success !== true) {
    const detail = payload?.error ?? `HTTP ${response.status}`;
    throw new Error(`${label}: ${detail}`);
  }

  return payload;
}

async function main() {
  console.log("\nLUNAPATH EXPLORER INTEGRATION CHECK");
  console.log(`Target: ${baseUrl}`);
  console.log(`Observer: Site04 registered reference point (${observer.latitudeDeg}, ${observer.longitudeEastDeg})`);
  console.log(`JPL window: ${durationHours} hours at 10-minute intervals (${expectedSamples} expected samples)\n`);

  const dataDirectory = path.join(
    process.cwd(),
    "public",
    "data",
    siteId
  );

  let metadata;
  try {
    metadata = JSON.parse(
      await readFile(path.join(dataDirectory, "metadata.json"), "utf8")
    );
    if (
      metadata.width !== 3200 ||
      metadata.height !== 3200 ||
      metadata.resolutionMeters !== 5 ||
      metadata.coordinateSystem?.projection !== "South Polar Stereographic" ||
      metadata.coordinateSystem?.referenceFrame !== "MOON_ME" ||
      metadata.coordinateSystem?.ephemeris !== "DE421"
    ) {
      throw new Error("Site04 metadata does not match the expected Product78 5 m MOON_ME / DE421 raster.");
    }
    pass("Site04 Product78 metadata has the expected 5 m South Polar Stereographic / MOON_ME / DE421 definition.");
  } catch (error) {
    fail(`Could not validate Site04 terrain metadata: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const pixel = projectToProduct78Pixel(metadata, observer);
  const column = Math.round(pixel.column);
  const row = Math.round(pixel.row);

  if (
    column < 0 || column >= metadata.width ||
    row < 0 || row >= metadata.height
  ) {
    fail("Registered Site04 reference observer falls outside its prepared Product78 raster.");
    return;
  }
  pass(`Registered observer maps to Product78 pixel ${column}, ${row}.`);

  // 1. Exact-observer JPL ephemerides and Product78 terrain horizon.
  const now = new Date();
  const roundedMinute = Math.floor(now.getUTCMinutes() / 10) * 10;
  const date = now.toISOString().slice(0, 10);
  const time = `${String(now.getUTCHours()).padStart(2, "0")}:${String(roundedMinute).padStart(2, "0")}:00`;

  const horizonsQuery = new URLSearchParams({
    siteId,
    lat: String(observer.latitudeDeg),
    lon: String(observer.longitudeEastDeg),
    pixelColumn: String(column),
    pixelRow: String(row),
    date,
    time,
    durationHours: String(durationHours),
  });

  let horizons;
  try {
    horizons = await getJson(
      `${baseUrl}/api/horizons/selected-location?${horizonsQuery.toString()}`,
      "Exact-observer JPL / terrain endpoint"
    );
    pass(`Exact-observer API returned success (${horizons.status ?? "status unspecified"}).`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  if (horizons) {
    if (horizons.site?.id !== siteId) {
      fail("Exact-observer API returned a different site ID.");
    } else {
      pass("Exact-observer API returned the requested Site04 dataset.");
    }

    if (
      horizons.observer?.pixel &&
      Math.hypot(
        horizons.observer.pixel.column - pixel.column,
        horizons.observer.pixel.row - pixel.row
      ) <= 1.5
    ) {
      pass("API observer pixel matches the requested geographic observer.");
    } else {
      fail("API observer pixel does not match the requested geographic observer.");
    }

    if (horizons.mission?.durationHours !== durationHours ||
        horizons.mission?.sampleIntervalMinutes !== 10) {
      fail("API mission duration or JPL sample interval is incorrect.");
    } else {
      pass("API mission metadata confirms the requested 6-hour / 10-minute sampling.");
    }

    for (const targetName of ["sun", "earth"]) {
      const observations = horizons.targets?.[targetName]?.observations ?? [];
      if (observations.length !== expectedSamples) {
        fail(`${targetName.toUpperCase()} returned ${observations.length} observations; expected ${expectedSamples}.`);
        continue;
      }

      let targetValid = true;
      for (let index = 0; index < observations.length; index += 1) {
        const item = observations[index];
        const timestamp = Date.parse(item.timeUtc);
        if (
          !Number.isFinite(timestamp) ||
          !Number.isFinite(item.azimuthDeg) ||
          item.azimuthDeg < 0 ||
          item.azimuthDeg > 360 ||
          !Number.isFinite(item.elevationDeg) ||
          item.elevationDeg < -90 ||
          item.elevationDeg > 90
        ) {
          targetValid = false;
          break;
        }

        if (index > 0) {
          const previous = Date.parse(observations[index - 1].timeUtc);
          if (timestamp - previous !== 600_000) {
            targetValid = false;
            break;
          }
        }

        if (item.terrainVisibility?.terrainCoverageComplete !== false) {
          targetValid = false;
          break;
        }
      }

      if (targetValid) {
        pass(`${targetName.toUpperCase()} has ${observations.length} valid 10-minute UTC samples and explicitly partial terrain coverage.`);
      } else {
        fail(`${targetName.toUpperCase()} samples failed timestamp, angle, interval or coverage validation.`);
      }
    }

    const profile = horizons.horizonProfile ?? [];
    if (profile.length !== 360) {
      fail(`Horizon profile contains ${profile.length} directions; expected 360 one-degree bearings.`);
    } else {
      const uniqueAzimuths = new Set(profile.map((item) => Number(item.azimuthDeg).toFixed(6)));
      if (uniqueAzimuths.size !== 360) {
        fail("Horizon profile contains duplicate or missing azimuth bearings.");
      } else {
        pass("Horizon profile contains 360 unique one-degree bearings.");
      }
    }

    if (horizons.terrainModel?.completeHorizonVerified !== false) {
      fail("API must explicitly retain completeHorizonVerified=false.");
    } else {
      pass("API does not claim complete lunar horizon coverage.");
    }

    if (horizons.terrainError) {
      fail(`Terrain horizon calculation reported an error: ${horizons.terrainError}`);
    }

    for (const targetName of ["sun", "earth"]) {
      const observations = horizons.targets?.[targetName]?.observations ?? [];
      if (observations.length > 0) {
        const knownStates = new Set([
          "target_disk_below_sampled_terrain",
          "target_disk_intersects_sampled_terrain",
          "target_disk_above_sampled_terrain_unconfirmed",
          "target_disk_size_unavailable",
          "terrain_horizon_unavailable",
        ]);
        const invalid = observations.some(
          (item) => !knownStates.has(item.terrainVisibility?.status)
        );
        if (invalid) fail(`${targetName.toUpperCase()} contains an unknown terrain-visibility state.`);
        else pass(`${targetName.toUpperCase()} terrain visibility uses explicit sampled/unknown states.`);
      }
    }
  }

  // 2. Selected-pixel science layers.
  const scienceQuery = new URLSearchParams({
    siteId,
    col: String(column),
    row: String(row),
  });

  try {
    const science = await getJson(
      `${baseUrl}/api/product78/science-sample?${scienceQuery.toString()}`,
      "Product78 science-sample endpoint",
      30_000
    );

    const values = science.values;
    const requiredValues = [
      "elevationMeters",
      "elevationUncertaintyMeters",
      "slopeDegrees",
      "slopeUncertaintyDegrees",
      "observationCount",
    ];

    if (
      science.available !== true ||
      science.resolutionMeters !== 5 ||
      !values ||
      requiredValues.some((key) => !Number.isFinite(values[key]))
    ) {
      fail("Science sample is missing one or more finite Product78 values.");
    } else if (
      values.observationCount < 0 ||
      !Number.isInteger(values.observationCount)
    ) {
      fail("Direct LOLA shot count must be a non-negative integer.");
    } else {
      pass("Selected pixel returned finite elevation, slope, RMS uncertainties and integer direct-LOLA shot count.");
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  // 3. LROC image proxy. This is an optional remote visual layer;
  // a failure must not invalidate Product78 geometry or JPL data.
  const imageryQuery = new URLSearchParams({
    siteId,
    lat: String(observer.latitudeDeg),
    lon: String(observer.longitudeEastDeg),
    col: String(column),
    row: String(row),
  });

  try {
    const response = await fetch(
      `${baseUrl}/api/lunar-imagery/nac-south-pole?${imageryQuery.toString()}`,
      { cache: "no-store", signal: AbortSignal.timeout(40_000) }
    );

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.toLowerCase().includes("image/png")) {
      const detail = contentType.toLowerCase().includes("json")
        ? (await response.json().catch(() => null))?.error
        : await response.text().catch(() => "");
      warn(
        `LROC imagery is unavailable (HTTP ${response.status}). ${detail ?? "The explorer should use the LOLA shaded-relief fallback."}`
      );
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer());
      const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
      const validPng = bytes.length >= 8 &&
        pngSignature.every((value, index) => bytes[index] === value);

      if (!validPng) {
        warn("LROC endpoint returned image/png but the payload did not contain a valid PNG signature.");
      } else if (
        response.headers.get("X-LunaPath-Imagery-Layer") !== "luna_nac_pole_control_south"
      ) {
        warn("LROC PNG loaded, but the expected source-layer response header is missing.");
      } else {
        pass(`LROC controlled South Pole NAC image loaded (${bytes.length.toLocaleString()} bytes).`);
      }
    }
  } catch (error) {
    warn(
      `LROC imagery request failed: ${error instanceof Error ? error.message : String(error)}. The explorer should use the LOLA shaded-relief fallback.`
    );
  }

  console.log("\nSUMMARY");
  console.log(`  Required checks failed: ${failures}`);
  console.log(`  Optional imagery warnings: ${warnings}`);

  if (failures > 0) {
    console.error("\nExplorer integration check FAILED.");
    process.exitCode = 1;
  } else {
    console.log("\nExplorer integration checks passed. Confirm compass rotation and imagery appearance in the browser.");
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
