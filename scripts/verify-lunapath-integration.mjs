import { readFile, stat } from "node:fs/promises";
import path from "node:path";

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
    return observations.length;
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
  console.log("\nLUNAPATH FRONTEND INTEGRATION CHECK");
  console.log(`Target: ${baseUrl}`);
  console.log(`UTC date: ${requestedDate}\n`);

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

  const terrain = payload.terrainModel;
  const profile = Array.isArray(terrain?.horizonProfile)
    ? terrain.horizonProfile
    : [];

  if (payload.targetStatus?.terrain === "available" && !terrain) {
    fail("API says terrain is available but terrainModel is missing.");
  } else if (terrain && profile.length !== terrain.directionCount) {
    fail(`Horizon profile length (${profile.length}) does not match directionCount (${terrain.directionCount}).`);
  } else if (terrain) {
    pass(`Terrain horizon profile: ${profile.length} directions at ${terrain.directionSpacingDegrees}° spacing.`);
    if (terrain.completeHorizonVerified !== false) {
      warn("API no longer reports completeHorizonVerified=false. Review the scientific status before displaying it as verified.");
    } else {
      pass("Horizon correctly remains labelled as not completely verified.");
    }
  } else {
    warn("Terrain horizon is unavailable for this request.");
  }

  if (payload.status === "partial") {
    warn("The API returned partial data. This is a valid response state; inspect the target-specific messages above.");
  } else {
    pass("API reports a complete response.");
  }

  console.log("\nSUMMARY");
  console.log(`  Sun observations:     ${sunCount}`);
  console.log(`  Earth observations:   ${earthCount}`);
  console.log(`  Horizon directions:   ${profile.length}`);
  console.log(`  API response status:  ${payload.status ?? "unknown"}`);

  if (process.exitCode === 1) {
    console.error("\nIntegration check found failures.");
  } else {
    console.log("\nIntegration contract check passed. Visual interaction still needs browser testing.");
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
});
