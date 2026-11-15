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

function destinationOnMoon(latitudeDeg, longitudeEastDeg, bearingRadians, distanceMeters, lunarRadiusMeters) {
  const lat1 = latitudeDeg * Math.PI / 180;
  const lon1 = longitudeEastDeg * Math.PI / 180;
  const angularDistance = distanceMeters / lunarRadiusMeters;
  const sinLat2 =
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRadians);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
  const y = Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(lat1);
  const x = Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2);
  const lon2 = lon1 + Math.atan2(y, x);
  return {
    latitudeDeg: lat2 * 180 / Math.PI,
    longitudeEastDeg: normalizeEastLongitude(lon2 * 180 / Math.PI),
  };
}

function getLocalMapBasis(metadata, coordinate) {
  const probeMeters = 20;
  const origin = projectToProduct78Pixel(metadata, coordinate);
  const east = destinationOnMoon(coordinate.latitudeDeg, coordinate.longitudeEastDeg, Math.PI / 2, probeMeters, metadata.georeferencing.lunarRadiusMeters);
  const north = destinationOnMoon(coordinate.latitudeDeg, coordinate.longitudeEastDeg, 0, probeMeters, metadata.georeferencing.lunarRadiusMeters);
  const eastPixel = projectToProduct78Pixel(metadata, east);
  const northPixel = projectToProduct78Pixel(metadata, north);
  const spacingX = Math.abs(metadata.pixelResolution[0]);
  const spacingZ = Math.abs(metadata.pixelResolution[1]);

  let eastX = (eastPixel.column - origin.column) * spacingX / probeMeters;
  let eastZ = (eastPixel.row - origin.row) * spacingZ / probeMeters;
  let northX = (northPixel.column - origin.column) * spacingX / probeMeters;
  let northZ = (northPixel.row - origin.row) * spacingZ / probeMeters;

  const eastLength = Math.hypot(eastX, eastZ);
  const northLength = Math.hypot(northX, northZ);
  if (eastLength <= 1e-8 || northLength <= 1e-8) throw new Error("Local map basis is degenerate.");
  eastX /= eastLength;
  eastZ /= eastLength;
  northX /= northLength;
  northZ /= northLength;

  const determinant = eastX * northZ - northX * eastZ;
  if (Math.abs(determinant) <= 1e-6) throw new Error("Local map basis is singular.");
  return { eastX, eastZ, northX, northZ, determinant };
}

function getTrueHeadingFromSceneYaw(yawRadians, basis) {
  const sceneX = -Math.sin(yawRadians);
  const sceneZ = -Math.cos(yawRadians);
  const eastComponent = (sceneX * basis.northZ - basis.northX * sceneZ) / basis.determinant;
  const northComponent = (basis.eastX * sceneZ - sceneX * basis.eastZ) / basis.determinant;
  return normalizeEastLongitude(Math.atan2(eastComponent, northComponent) * 180 / Math.PI);
}

function angularDifference(left, right) {
  return Math.abs(((left - right + 540) % 360) - 180);
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

  try {
    const basis = getLocalMapBasis(metadata, observer);
    const initialHeading = getTrueHeadingFromSceneYaw(0, basis);
    if (angularDifference(initialHeading, 171.8700) > 0.2) {
      fail(`Initial camera heading should be approximately 171.9° at the Site04 registered reference observer; received ${initialHeading.toFixed(3)}°.`);
    } else {
      pass(`Initial camera view maps to true bearing ${initialHeading.toFixed(2)}° (south-southeast), not an assumed North.`);
    }

    const cardinalVectors = [
      { bearing: 0, x: basis.northX, z: basis.northZ },
      { bearing: 90, x: basis.eastX, z: basis.eastZ },
      { bearing: 180, x: -basis.northX, z: -basis.northZ },
      { bearing: 270, x: -basis.eastX, z: -basis.eastZ },
    ];
    for (const cardinal of cardinalVectors) {
      const yaw = Math.atan2(-cardinal.x, -cardinal.z);
      const actual = getTrueHeadingFromSceneYaw(yaw, basis);
      if (angularDifference(actual, cardinal.bearing) > 0.05) {
        fail(`Compass cardinal round-trip failed for ${cardinal.bearing}° (received ${actual.toFixed(3)}°).`);
      }
    }
    pass("True-north transform round-trips N/E/S/W to 0°/90°/180°/270°.");
  } catch (error) {
    fail(`True-north regression check failed: ${error instanceof Error ? error.message : String(error)}`);
  }

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

        if (
          !Number.isFinite(item.observerRangeKm) ||
          item.observerRangeKm <= 0 ||
          !Number.isFinite(item.angularDiameterArcsec) ||
          item.angularDiameterArcsec <= 0 ||
          !Number.isFinite(item.rangeDerivedAngularDiameterArcsec) ||
          item.rangeDerivedAngularDiameterArcsec <= 0 ||
          item.angularDiameterSource !== "jpl-range-verified" ||
          !Number.isFinite(item.angularDiameterCrossCheckPercent) ||
          item.angularDiameterCrossCheckPercent > 2 ||
          !Number.isFinite(item.observerRangeKm) ||
          item.observerRangeKm <= 0
        ) {
          targetValid = false;
          break;
        }
      }

      if (targetValid) {
        const first = observations[0];
        const diameterDeg = first.angularDiameterArcsec / 3600;

        if (targetName === "sun") {
          if (
            diameterDeg < 0.4 ||
            diameterDeg > 0.7 ||
            !Number.isFinite(first.solarIrradianceWm2) ||
            first.solarIrradianceWm2 < 1200 ||
            first.solarIrradianceWm2 > 1500
          ) {
            fail(`SUN apparent diameter/irradiance outside expected lunar values: ${diameterDeg.toFixed(3)}° / ${first.solarIrradianceWm2} W/m².`);
          } else {
            pass(`SUN apparent diameter ${diameterDeg.toFixed(3)}°; observer solar irradiance ${first.solarIrradianceWm2.toFixed(1)} W/m².`);
          }
        } else if (diameterDeg < 1.3 || diameterDeg > 2.6) {
          fail(`EARTH apparent diameter outside expected lunar values: ${diameterDeg.toFixed(3)}°.`);
        } else {
          pass(`EARTH apparent diameter ${diameterDeg.toFixed(3)}° at this lunar observer.`);
        }

        pass(
          `${targetName.toUpperCase()} has ${observations.length} valid 10-minute UTC samples and JPL angular size cross-checked against observer range (first sample: ${first.angularDiameterArcsec.toFixed(2)} arcsec, ${first.observerRangeKm.toLocaleString()} km).`
        );
      } else {
        fail(`${targetName.toUpperCase()} samples failed timestamp, angle, interval, coverage or apparent-size validation.`);
      }
    }

    const sunTimes = horizons.targets?.sun?.observations ?? [];
    const earthTimes = horizons.targets?.earth?.observations ?? [];
    if (sunTimes.length > 0 && earthTimes.length > 0) {
      const sunDiameter = sunTimes[0].angularDiameterArcsec;
      const earthDiameter = earthTimes[0].angularDiameterArcsec;
      const ratio = earthDiameter / sunDiameter;
      if (
        !Number.isFinite(ratio) ||
        ratio < 2 ||
        ratio > 6
      ) {
        fail(`Earth/Sun apparent-diameter ratio is implausible: ${ratio}.`);
      } else {
        pass(`Earth appears ${ratio.toFixed(2)}× the Sun's angular diameter at the first mission sample; both sizes are range-verified.`);
      }
    }
    if (
      sunTimes.length === expectedSamples &&
      earthTimes.length === expectedSamples &&
      sunTimes.every((item, index) => item.timeUtc === earthTimes[index]?.timeUtc)
    ) {
      pass("Sun and Earth samples share the same UTC timeline.");
    } else {
      fail("Sun and Earth observation timestamps are not aligned on one shared timeline.");
    }

    const profile = horizons.horizonProfile ?? [];
    if (profile.length !== 360) {
      fail(`Horizon profile contains ${profile.length} directions; expected 360 one-degree bearings.`);
    } else {
      const uniqueAzimuths = new Set(profile.map((item) => Number(item.azimuthDeg).toFixed(6)));
      if (uniqueAzimuths.size !== 360) {
        fail("Horizon profile contains duplicate or missing azimuth bearings.");
      } else {
        const knownDirections = profile.filter(
          (item) =>
            item.coverageStatus === "partial" &&
            Number.isFinite(item.horizonElevationDeg) &&
            Number.isFinite(item.lastKnownSampleDistanceMeters) &&
            item.lastKnownSampleDistanceMeters > 0 &&
            item.lastKnownSampleDistanceMeters <= 15_000
        );
        const directionsConsistent = profile.every((item) => {
          if (item.terrainBeyondKnownCoverageUnknown !== true) return false;
          if (item.coverageStatus === "no_data") return item.horizonElevationDeg === null;
          return item.coverageStatus === "partial" &&
            Number.isFinite(item.horizonElevationDeg) &&
            Number.isFinite(item.lastKnownSampleDistanceMeters) &&
            item.lastKnownSampleDistanceMeters > 0 &&
            item.lastKnownSampleDistanceMeters <= 15_000;
        });

        if (!directionsConsistent) {
          fail("Horizon directions contain inconsistent known/unknown coverage metadata.");
        } else if (knownDirections.length === 0) {
          fail("The 360-degree profile contains no measured terrain directions.");
        } else {
          pass(`360 unique one-degree bearings are consistent; ${knownDirections.length} have measured terrain and all retain explicit unknown-beyond-coverage flags.`);
        }
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
    if (science.pixel?.column !== column || science.pixel?.row !== row) {
      fail("Science API did not return the exact nearest pixel requested by the verifier.");
    } else {
      pass("Science values are explicitly associated with the requested nearest raster pixel.");
    }
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

  // 3. Compact Product78 terrain preview should be available before the full DEM.
  try {
    const response = await fetch(
      `${baseUrl}/api/product78/terrain-preview?siteId=${siteId}`,
      { cache: "no-store", signal: AbortSignal.timeout(45_000) }
    );
    const encodedMetadata = response.headers.get("X-LunaPath-Terrain-Metadata");
    const factor = Number(
      response.headers.get("X-LunaPath-Terrain-Downsample-Factor")
    );

    if (!response.ok || !encodedMetadata) {
      fail(`Product78 terrain preview failed: HTTP ${response.status}.`);
    } else {
      const metadata = JSON.parse(decodeURIComponent(encodedMetadata));
      const bytes = new Uint8Array(await response.arrayBuffer());

      if (
        response.headers.get("X-LunaPath-Terrain-Preview") !== "true" ||
        !Number.isSafeInteger(factor) ||
        factor < 2 ||
        factor > 8 ||
        metadata.width * factor !== 3200 ||
        metadata.height * factor !== 3200 ||
        metadata.resolutionMeters !== 5 * factor ||
        bytes.byteLength !== metadata.width * metadata.height * 4
      ) {
        fail("Product78 terrain preview georeferencing, resolution or binary length is inconsistent.");
      } else {
        pass(`Fast Product78 terrain preview: ${metadata.width}×${metadata.height} at ${metadata.resolutionMeters} m/pixel (${bytes.byteLength.toLocaleString()} bytes).`);
      }
    }
  } catch (error) {
    fail(`Product78 terrain preview request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 4. LROC image proxy. This is an optional remote visual layer;
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
