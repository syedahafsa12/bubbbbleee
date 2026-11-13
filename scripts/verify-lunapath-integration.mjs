import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { getTerrainHorizonAtAzimuth } from "../src/components/lib/lunar/horizonInterpolation.mjs";

const requestedDate =
  process.argv[2] ?? new Date().toISOString().slice(0, 10);
const baseUrl = process.env.LUNAPATH_BASE_URL ?? "http://localhost:3000";

function fail(message) {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`✓ ${message}`);
}

function warn(message) {
  console.warn(`! ${message}`);
}

const REQUIRED_SITE_IDS = [
  "site04_shackleton_rim",
  "site11_de_gerlache_rim",
  "site23_malapert_massif",
];

const ALLOWED_TERMINATION_REASONS = new Set([
  "raster_boundary",
  "nodata",
  "outside_raster",
  "invalid_sample",
  "calculation_error",
  "search_limit",
]);

function verifyUnknownDirectionFixture() {
  const syntheticProfile = [
    { azimuthDeg: 0, horizonElevationDeg: 10, coverageStatus: "partial", terminationReason: "search_limit" },
    { azimuthDeg: 90, horizonElevationDeg: 20, coverageStatus: "partial", terminationReason: "search_limit" },
    { azimuthDeg: 180, horizonElevationDeg: null, coverageStatus: "no_data", terminationReason: "nodata" },
    { azimuthDeg: 270, horizonElevationDeg: 40, coverageStatus: "partial", terminationReason: "search_limit" },
  ];

  const interpolationAcrossGap = getTerrainHorizonAtAzimuth(135, syntheticProfile);
  const interpolationInsideGap = getTerrainHorizonAtAzimuth(180, syntheticProfile);
  const wrappedInterpolation = getTerrainHorizonAtAzimuth(315, syntheticProfile);

  if (interpolationAcrossGap !== null || interpolationInsideGap !== null) {
    fail("Synthetic NoData fixture: interpolation must remain unknown beside and inside a missing direction.");
    return;
  }

  if (
    wrappedInterpolation === null ||
    Math.abs(wrappedInterpolation.horizonElevationDeg - 25) > 1e-9
  ) {
    fail("Synthetic NoData fixture: interpolation across the 360°/0° boundary is incorrect.");
    return;
  }

  pass("Synthetic NoData fixture: missing sectors remain unknown and north-wrap interpolation works.");
}

async function verifyPreparedSiteCatalog(baseUrl) {
  const endpoint = new URL("/api/product78/sites", baseUrl);
  let response;
  let payload;

  try {
    response = await fetch(endpoint, { cache: "no-store" });
    payload = await response.json();
  } catch (error) {
    fail(`Could not reach or parse Product78 site registry: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }

  if (!response.ok || payload?.success !== true || !Array.isArray(payload?.sites)) {
    fail(`Product78 site registry returned HTTP ${response.status} or an invalid response.`);
    return false;
  }

  let ready = true;
  for (const siteId of REQUIRED_SITE_IDS) {
    const site = payload.sites.find((item) => item?.id === siteId);
    if (!site) {
      fail(`Product78 site registry is missing ${siteId}.`);
      ready = false;
    } else if (site.assetStatus !== "ready") {
      fail(`${siteId} assets are not ready: ${site.assetStatus ?? "status missing"}${site.error ? ` — ${site.error}` : ""}`);
      ready = false;
    } else {
      pass(`${siteId} Product78 metadata and binary assets are ready.`);
    }
  }

  return ready;
}

function validateSiteSpecificTerrain(siteId, payload) {
  if (payload?.site?.id !== siteId) {
    fail(`${siteId}: API returned site identity ${payload?.site?.id ?? "missing"}.`);
  }

  const terrain = payload?.terrainModel;
  if (!terrain || terrain.source !== "product78" || terrain.siteId !== siteId) {
    fail(`${siteId}: API did not return the expected Product78 terrain model.`);
    return { known: 0, unknown: 0 };
  }

  if (
    terrain.status !== "partial" ||
    terrain.resolutionMeters !== 5 ||
    terrain.completeHorizonVerified !== false
  ) {
    fail(`${siteId}: Product78 terrain status/resolution/completeness contract is invalid.`);
  }

  const profile = Array.isArray(terrain.horizonProfile)
    ? terrain.horizonProfile
    : [];

  if (profile.length !== 1440 || terrain.directionCount !== 1440) {
    fail(`${siteId}: expected 1,440 horizon directions; received ${profile.length}.`);
    return { known: 0, unknown: 0 };
  }

  const seenAzimuths = new Set();
  let known = 0;
  let unknown = 0;

  for (const [index, direction] of profile.entries()) {
    const expectedAzimuth = index * 0.25;
    const validAzimuth =
      Number.isFinite(direction?.azimuthDeg) &&
      direction.azimuthDeg >= 0 &&
      direction.azimuthDeg < 360 &&
      Math.abs(direction.azimuthDeg - expectedAzimuth) < 1e-6;
    const validDistance =
      direction?.lastKnownSampleDistanceM === null ||
      (Number.isFinite(direction?.lastKnownSampleDistanceM) &&
        direction.lastKnownSampleDistanceM >= 0);
    const validAngle =
      direction?.maxTerrainElevationAngleDeg === null ||
      (Number.isFinite(direction?.maxTerrainElevationAngleDeg) &&
        direction.maxTerrainElevationAngleDeg >= -90 &&
        direction.maxTerrainElevationAngleDeg <= 90);
    const validSamples =
      Number.isInteger(direction?.sampleCount) && direction.sampleCount >= 0;
    const validSource =
      direction?.source === "product78" || direction?.source === null;
    const validCoverage =
      direction?.coverageStatus === "partial" ||
      direction?.coverageStatus === "no_data";
    const validReason = ALLOWED_TERMINATION_REASONS.has(direction?.terminationReason);
    const unknownFlag = direction?.terrainBeyondKnownCoverageUnknown === true;
    const nullSemantics =
      direction?.coverageStatus !== "no_data" ||
      (direction.maxTerrainElevationAngleDeg === null &&
        direction.horizonElevationDeg === null &&
        direction.source === null);

    if (
      !validAzimuth ||
      !validDistance ||
      !validAngle ||
      !validSamples ||
      !validSource ||
      !validCoverage ||
      !validReason ||
      !unknownFlag ||
      !nullSemantics
    ) {
      fail(`${siteId}: horizon direction ${index} violates the Product78 partial-coverage contract.`);
      continue;
    }

    const key = direction.azimuthDeg.toFixed(6);
    if (seenAzimuths.has(key)) {
      fail(`${siteId}: duplicate horizon azimuth ${direction.azimuthDeg}°.`);
      continue;
    }
    seenAzimuths.add(key);

    if (
      direction.coverageStatus === "partial" &&
      direction.source === "product78" &&
      Number.isFinite(direction.maxTerrainElevationAngleDeg)
    ) {
      known += 1;
    } else {
      unknown += 1;
      if (getTerrainHorizonAtAzimuth(direction.azimuthDeg, profile) !== null) {
        fail(`${siteId}: NoData direction ${direction.azimuthDeg}° was interpolated as known terrain.`);
      }
    }
  }

  if (known === 0) {
    fail(`${siteId}: no valid Product78 terrain samples were returned.`);
  } else {
    pass(`${siteId}: 1,440 horizon directions validated (${known} known / ${unknown} unknown).`);
  }

  if (unknown === 0) {
    warn(`${siteId}: live raster contains no NoData directions; synthetic NoData behaviour was checked separately.`);
  }

  return { known, unknown };
}

async function verifyAdditionalSiteHorizons(baseUrl, requestedDate) {
  for (const siteId of REQUIRED_SITE_IDS.slice(1)) {
    const endpoint = new URL("/api/horizons", baseUrl);
    endpoint.searchParams.set("siteId", siteId);
    endpoint.searchParams.set("date", requestedDate);

    let response;
    let payload;
    try {
      response = await fetch(endpoint, { cache: "no-store" });
      payload = await response.json();
    } catch (error) {
      fail(`${siteId}: could not reach or parse the site-specific Horizons API: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    if (!response.ok || payload?.success !== true) {
      fail(`${siteId}: Horizons API returned HTTP ${response.status}: ${payload?.error ?? "success=false"}`);
      if (payload?.targetErrors) {
        for (const [target, error] of Object.entries(payload.targetErrors)) {
          if (error) console.error(`  ${siteId} ${target}: ${error}`);
        }
      }
      continue;
    }

    pass(`${siteId}: site-specific Horizons API responded successfully.`);
    validateObservations(`Sun (${siteId})`, payload.targets?.sun, payload.targetStatus?.sun);
    validateObservations(`Earth (${siteId})`, payload.targets?.earth, payload.targetStatus?.earth);
    validateSiteSpecificTerrain(siteId, payload);
  }
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function parseUtcTimestamp(value) {
  if (typeof value !== "string" || value.length === 0) return null;

  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;

  // Current API output is JPL's YYYY-Mmm-DD form, e.g. 2026-Nov-13T00:00:00Z.
  const match = value.match(
    /^(\d{4})-([A-Za-z]{3})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?Z$/
  );
  if (!match) return null;

  const months = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };

  const [, year, month, day, hour, minute, second = "0", fraction = ""] = match;
  if (months[month] === undefined) return null;

  const date = new Date(Date.UTC(
    Number(year),
    months[month],
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number((fraction + "000").slice(0, 3))
  ));

  return date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === months[month] &&
    date.getUTCDate() === Number(day) &&
    date.getUTCHours() === Number(hour) &&
    date.getUTCMinutes() === Number(minute) &&
    date.getUTCSeconds() === Number(second)
    ? date
    : null;
}

function validateObservations(name, target, targetStatus) {
  const observations = Array.isArray(target?.observations)
    ? target.observations
    : [];

  if (targetStatus === "available" && observations.length === 0) {
    fail(`${name}: API says available but returned no observations.`);
    return 0;
  }

  if (targetStatus !== "available") {
    warn(`${name}: ${targetStatus ?? "status missing"}${target?.error ? ` — ${target.error}` : ""}`);
    return observations.filter((item) => item !== null && item !== undefined).length;
  }

  let invalidCount = 0;

  for (const [index, item] of observations.entries()) {
    const timestamp = parseUtcTimestamp(item?.timeUtc)?.getTime() ?? Number.NaN;
    const azimuth = item?.azimuthDeg;
    const elevation = item?.elevationDeg;

    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(azimuth) ||
      azimuth < 0 ||
      azimuth > 360 ||
      !Number.isFinite(elevation) ||
      elevation < -90 ||
      elevation > 90
    ) {
      invalidCount += 1;
      if (invalidCount <= 3) {
        warn(`${name}: invalid observation at index ${index}.`);
      }
    }
  }

  if (invalidCount > 0) {
    fail(`${name}: ${invalidCount} observation(s) failed timestamp/angle validation.`);
  } else {
    pass(`${name}: ${observations.length} observations with valid UTC timestamps and degree angles.`);
  }

  return observations.length;
}

async function main() {
  console.log("\nLUNAPATH MULTI-SITE BACKEND/API INTEGRATION CHECK");
  console.log(`Target: ${baseUrl}`);
  console.log(`UTC date: ${requestedDate}\n`);

  verifyUnknownDirectionFixture();
  if (!(await verifyPreparedSiteCatalog(baseUrl))) return;

  if (!isValidDate(requestedDate)) {
    fail("Date must be a real calendar date in YYYY-MM-DD format.");
    return;
  }

  const dataDirectory = path.join(
    process.cwd(),
    "public",
    "data",
    "site04_shackleton_rim"
  );
  const metadataPath = path.join(dataDirectory, "metadata.json");
  const elevationPath = path.join(dataDirectory, "elevation.bin");

  let metadata;

  try {
    metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    const binary = await stat(elevationPath);
    const expectedBytes =
      metadata.width * metadata.height * Float32Array.BYTES_PER_ELEMENT;

    if (
      metadata.width !== 3200 ||
      metadata.height !== 3200 ||
      metadata.resolutionMeters !== 5 ||
      metadata.dataType?.toLowerCase() !== "float32" ||
      metadata.byteOrder?.toLowerCase().replace(/[-_ ]/g, "") !== "littleendian"
    ) {
      fail("Site04 metadata does not match the expected 3200 × 3200, 5 m Float32 little-endian raster.");
    } else if (binary.size !== expectedBytes) {
      fail(`Site04 elevation.bin is ${binary.size.toLocaleString()} bytes; expected ${expectedBytes.toLocaleString()} bytes.`);
    } else {
      pass(`Site04 terrain assets present ( ${metadata.width} × ${metadata.height}, ${metadata.resolutionMeters} m/pixel, ${binary.size.toLocaleString()} bytes ).`);
    }
  } catch (error) {
    fail(`Could not validate Site04 terrain assets: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const endpoint = new URL("/api/horizons", baseUrl);
  endpoint.searchParams.set("date", requestedDate);

  let response;
  let payload;

  try {
    response = await fetch(endpoint, { cache: "no-store" });
    payload = await response.json();
  } catch (error) {
    fail(`Could not reach or parse ${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  if (!response.ok || payload?.success !== true) {
    fail(`Horizons API returned HTTP ${response.status}: ${payload?.error ?? "success=false"}`);

    if (payload?.targetErrors) {
      for (const [target, error] of Object.entries(payload.targetErrors)) {
        if (error) console.error(`  ${target}: ${error}`);
      }
    }

    console.error("This is an API/backend or upstream JPL failure, not a frontend rendering failure.");
    return;
  }

  pass(`Horizons API responded successfully (status: ${payload.status ?? "unspecified"}).`);

  const sunCount = validateObservations(
    "Sun",
    payload.targets?.sun,
    payload.targetStatus?.sun
  );
  const earthCount = validateObservations(
    "Earth",
    payload.targets?.earth,
    payload.targetStatus?.earth
  );

  const sunTargetStatus = payload.targetStatus?.sun;
  const earthTargetStatus = payload.targetStatus?.earth;

  if (sunTargetStatus === "available" && sunCount !== 145) {
    fail(`Sun returned ${sunCount} observations; expected all 145 JPL samples.`);
  }
  if (earthTargetStatus === "available" && earthCount !== 145) {
    fail(`Earth returned ${earthCount} observations; expected all 145 JPL samples.`);
  }

  const terrain = payload.terrainModel;
  // Only count the target Product78 profile. Legacy mixed-source profile
  // values are deliberately ignored by the frontend.
  const profile =
    terrain?.source === "product78" && Array.isArray(terrain?.horizonProfile)
      ? terrain.horizonProfile
      : [];

  let knownDirectionCount = 0;
  let unknownDirectionCount = 0;

  if (payload.targetStatus?.terrain === "available" && !terrain) {
    fail("API says terrain is available but terrainModel is missing.");
  } else if (terrain && terrain.source !== "product78") {
    // Older responses contain the mixed Product78 + Product90 model. Do not
    // treat those values as the new visualization contract.
    warn("Legacy non-Product78 terrain payload detected. The Product78-only frontend will leave this horizon unknown until the backend returns the new contract.");
  } else if (terrain) {
    if (terrain.status !== "partial") {
      fail(`Product78 terrain status must be partial; received ${terrain.status ?? "missing"}.`);
    }
    if (terrain.siteId !== "site04_shackleton_rim") {
      fail(`Unexpected terrain siteId: ${terrain.siteId ?? "missing"}.`);
    }
    if (terrain.resolutionMeters !== 5) {
      fail(`Product78 source resolution must be 5 m; received ${terrain.resolutionMeters ?? "missing"}.`);
    }
    if (terrain.completeHorizonVerified !== false) {
      fail("Product78 terrain must keep completeHorizonVerified=false.");
    }
    if (profile.length === 0) {
      warn("The Product78 terrain model returned an empty horizon profile.");
    }

    const allowedReasons = new Set([
      "raster_boundary",
      "nodata",
      "outside_raster",
      "invalid_sample",
      "calculation_error",
      "search_limit",
    ]);

    const seenAzimuths = new Set();
    for (const [index, direction] of profile.entries()) {
      const validAzimuth =
        Number.isFinite(direction?.azimuthDeg) &&
        direction.azimuthDeg >= 0 &&
        direction.azimuthDeg < 360;
      const validDistance =
        direction?.lastKnownSampleDistanceM === null ||
        (Number.isFinite(direction?.lastKnownSampleDistanceM) &&
          direction.lastKnownSampleDistanceM >= 0);
      const validAngle =
        direction?.maxTerrainElevationAngleDeg === null ||
        (Number.isFinite(direction?.maxTerrainElevationAngleDeg) &&
          direction.maxTerrainElevationAngleDeg >= -90 &&
          direction.maxTerrainElevationAngleDeg <= 90);
      const validSamples =
        Number.isInteger(direction?.sampleCount) &&
        direction.sampleCount >= 0;
      const validSource =
        direction?.source === "product78" || direction?.source === null;
      const validCoverage =
        direction?.coverageStatus === "partial" ||
        direction?.coverageStatus === "no_data";
      const validReason = allowedReasons.has(direction?.terminationReason);
      const unknownFlag = direction?.terrainBeyondKnownCoverageUnknown === true;
      const nullSemantics =
        direction?.coverageStatus !== "no_data" ||
        (direction.maxTerrainElevationAngleDeg === null &&
          direction.source === null);

      if (
        !validAzimuth ||
        !validDistance ||
        !validAngle ||
        !validSamples ||
        !validSource ||
        !validCoverage ||
        !validReason ||
        !unknownFlag ||
        !nullSemantics
      ) {
        fail(`Product78 horizon direction ${index} does not match the partial-terrain contract.`);
        continue;
      }

      const azimuthKey = direction.azimuthDeg.toFixed(6);
      if (seenAzimuths.has(azimuthKey)) {
        fail(`Duplicate horizon azimuth ${direction.azimuthDeg}°.`);
      }
      seenAzimuths.add(azimuthKey);

      if (
        direction.coverageStatus === "partial" &&
        direction.source === "product78" &&
        Number.isFinite(direction.maxTerrainElevationAngleDeg)
      ) {
        knownDirectionCount += 1;
      } else {
        unknownDirectionCount += 1;
      }
    }

    pass(`Product78 horizon directions: ${profile.length} total, ${knownDirectionCount} with local samples, ${unknownDirectionCount} unknown.`);
    pass("Missing/NoData terrain is explicitly unknown; complete horizon remains unverified.");
  } else {
    warn("Product78 terrain horizon is not available in this API response.");
  }

  if (payload.status === "partial") {
    warn("The API returned partial data. This is a valid response state; inspect the target-specific messages above.");
  } else {
    pass("API reports a complete response.");
  }

  await verifyAdditionalSiteHorizons(baseUrl, requestedDate);

  console.log("\nSUMMARY");
  console.log(`  Sun observations:     ${sunCount}`);
  console.log(`  Earth observations:   ${earthCount}`);
  console.log(`  Horizon directions:   ${profile.length} (${knownDirectionCount} known / ${unknownDirectionCount} unknown)`);
  console.log(`  API response status:  ${payload.status ?? "unknown"}`);

  if (process.exitCode === 1) {
    console.error("\nIntegration check found failures.");
  } else if (payload.status === "partial") {
    console.warn("\nFrontend contract checks completed, but the API response is partial. Review unavailable-target warnings; this is not a full mission-data pass.");
  } else {
    console.log("\nIntegration contract check passed. Visual interaction still needs browser testing.");
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
});
