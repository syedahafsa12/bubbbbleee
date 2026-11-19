import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const requestedDate =
  process.argv[2] ?? new Date().toISOString().slice(0, 10);
const baseUrl = process.env.LUNAPATH_BASE_URL ?? "http://localhost:3000";

const requiredSites = [
  {
    id: "site04_shackleton_rim",
    archiveSite: "Site04",
    dataDirectory: "site04_shackleton_rim",
    width: 3200,
    height: 3200,
    resolutionMeters: 5,
  },
  {
    id: "site11_de_gerlache_rim",
    archiveSite: "Site11",
    dataDirectory: "site11_de_gerlache_rim",
    width: 3200,
    height: 3200,
    resolutionMeters: 5,
  },
  {
    id: "site23_malapert_massif",
    archiveSite: "Site23",
    dataDirectory: "site23_malapert_massif",
    width: 4200,
    height: 4200,
    resolutionMeters: 5,
  },
];

const allowedTerminationReasons = new Set([
  "raster_boundary",
  "nodata",
  "outside_raster",
  "invalid_sample",
  "calculation_error",
  "search_limit",
]);

let failures = 0;
let warnings = 0;

function fail(message) {
  failures += 1;
  console.error("✗ " + message);
}

function pass(message) {
  console.log("✓ " + message);
}

function warn(message) {
  warnings += 1;
  console.warn("! " + message);
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function normalizeAzimuth(degrees) {
  return ((degrees % 360) + 360) % 360;
}

function angularDifference(a, b) {
  const difference = Math.abs(normalizeAzimuth(a) - normalizeAzimuth(b));
  return Math.min(difference, 360 - difference);
}

function parseUtcTimestamp(value) {
  if (typeof value !== "string" || value.length === 0) return null;

  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;

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
    fail(name + ": API says available but returned no observations.");
    return observations;
  }

  if (targetStatus !== "available") {
    warn(
      name + ": " + (targetStatus ?? "status missing") +
      (target?.error ? " — " + target.error : "")
    );
    return observations;
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
        warn(name + ": invalid observation at index " + index + ".");
      }
    }
  }

  if (invalidCount > 0) {
    fail(name + ": " + invalidCount + " observation(s) failed timestamp/angle validation.");
  } else {
    pass(name + ": " + observations.length + " observations have valid UTC timestamps and degree angles.");
  }

  if (observations.length !== 145) {
    warn(name + ": returned " + observations.length + " samples; the nominal 24-hour, 10-minute plan is 145.");
  }

  return observations;
}

function validateObserverFootprint(site, metadata, observer) {
  const coordinate = observer;
  const georeferencing = metadata.georeferencing;
  const tiePoint = georeferencing?.tiePoint;
  const pixelResolution = metadata.pixelResolution;

  if (
    !coordinate ||
    !Number.isFinite(coordinate.latitudeDeg) ||
    !Number.isFinite(coordinate.longitudeEastDeg) ||
    !tiePoint ||
    !Array.isArray(pixelResolution) ||
    pixelResolution.length < 3 ||
    !Number.isFinite(georeferencing?.lunarRadiusMeters) ||
    !Number.isFinite(georeferencing?.centralMeridianDegrees)
  ) {
    fail(site.archiveSite + ": observer or projection metadata is incomplete.");
    return;
  }

  const latitudeFromSouthPole =
    ((90 + coordinate.latitudeDeg) * Math.PI) / 180;
  const longitudeDifference =
    ((coordinate.longitudeEastDeg % 360) -
      (georeferencing.centralMeridianDegrees % 360)) *
    Math.PI / 180;
  const rho =
    2 *
    georeferencing.lunarRadiusMeters *
    Math.tan(latitudeFromSouthPole / 2);
  const xMeters = rho * Math.sin(longitudeDifference);
  const yMeters = rho * Math.cos(longitudeDifference);

  const [pixelWidth, pixelHeight, pixelRotation] = pixelResolution;
  if (
    pixelWidth === 0 ||
    pixelHeight === 0 ||
    Math.abs(pixelRotation) > 1e-10
  ) {
    fail(site.archiveSite + ": unsupported raster pixel transform.");
    return;
  }

  const column =
    tiePoint.column + (xMeters - tiePoint.x) / pixelWidth - 0.5;
  const row =
    tiePoint.row + (yMeters - tiePoint.y) / pixelHeight - 0.5;
  const inside =
    Number.isFinite(column) &&
    Number.isFinite(row) &&
    column >= -0.5 &&
    row >= -0.5 &&
    column < metadata.width - 0.5 &&
    row < metadata.height - 0.5;

  if (inside) {
    pass(
      site.archiveSite + ": observer maps inside raster at pixel (" +
      column.toFixed(2) + ", " + row.toFixed(2) + ")."
    );
  } else {
    fail(
      site.archiveSite + ": observer maps outside the raster at pixel (" +
      column + ", " + row + ")."
    );
  }
}

async function validateLocalAssets(site, catalogueRecord) {
  if (!catalogueRecord) {
    fail(site.archiveSite + ": missing from /api/product78/sites.");
    return null;
  }

  if (
    catalogueRecord.id !== site.id ||
    catalogueRecord.archiveSite !== site.archiveSite ||
    catalogueRecord.dataDirectory !== site.dataDirectory
  ) {
    fail(site.archiveSite + ": catalogue identity or data directory does not match the expected site.");
    return null;
  }

  if (catalogueRecord.assetStatus !== "ready") {
    fail(
      site.archiveSite + ": catalogue assetStatus is " +
      String(catalogueRecord.assetStatus) + ". " +
      (catalogueRecord.error ?? "")
    );
    return null;
  }

  const directory = path.join(
    process.cwd(),
    "public",
    "data",
    site.dataDirectory
  );

  try {
    const metadata = JSON.parse(
      await readFile(path.join(directory, "metadata.json"), "utf8")
    );
    const binary = await stat(path.join(directory, "elevation.bin"));
    const expectedBytes =
      metadata.width * metadata.height * Float32Array.BYTES_PER_ELEMENT;
    const projection = metadata.coordinateSystem?.projection
      ?.toLowerCase()
      .replace(/[^a-z]/g, "");
    const pixelRegistration = metadata.coordinateSystem?.pixelRegistration
      ?.toLowerCase()
      .replace(/[^a-z]/g, "");
    const linearUnits = metadata.coordinateSystem?.linearUnits
      ?.toLowerCase()
      .replace(/[^a-z]/g, "");
    const byteOrder = metadata.byteOrder
      ?.toLowerCase()
      .replace(/[^a-z]/g, "");

    const validMetadata =
      metadata.width === site.width &&
      metadata.height === site.height &&
      metadata.resolutionMeters === site.resolutionMeters &&
      metadata.dataType?.toLowerCase() === "float32" &&
      byteOrder === "littleendian" &&
      projection === "southpolarstereographic" &&
      metadata.coordinateSystem?.referenceFrame === "MOON_ME" &&
      metadata.coordinateSystem?.ephemeris === "DE421" &&
      ["pixelarea", "pixelisarea"].includes(pixelRegistration) &&
      ["meters", "metres", "m"].includes(linearUnits);

    if (!validMetadata) {
      fail(site.archiveSite + ": metadata does not match the expected Product78 raster contract.");
      return null;
    }

    if (!Number.isSafeInteger(expectedBytes) || binary.size !== expectedBytes) {
      fail(
        site.archiveSite + ": elevation.bin is " +
        binary.size.toLocaleString() + " bytes; expected " +
        expectedBytes.toLocaleString() + " bytes."
      );
      return null;
    }

    if (
      catalogueRecord.dimensions?.[0] !== metadata.width ||
      catalogueRecord.dimensions?.[1] !== metadata.height ||
      catalogueRecord.resolutionMeters !== metadata.resolutionMeters ||
      catalogueRecord.binaryBytes !== binary.size
    ) {
      fail(site.archiveSite + ": API catalogue metadata differs from the files on disk.");
      return null;
    }

    validateObserverFootprint(site, metadata, catalogueRecord.observer);

    pass(
      site.archiveSite + ": local Product78 assets verified (" +
      metadata.width + " × " + metadata.height + ", " +
      metadata.resolutionMeters + " m/pixel, " +
      binary.size.toLocaleString() + " bytes)."
    );

    return catalogueRecord;
  } catch (error) {
    fail(
      site.archiveSite + ": could not validate local terrain assets: " +
      (error instanceof Error ? error.message : String(error))
    );
    return null;
  }
}

function validateTerrainPayload(site, payload, observationsByTarget) {
  const terrain = payload?.terrainModel;
  if (!terrain || terrain.source !== "product78") {
    fail(site.archiveSite + ": ready local assets did not produce a Product78 terrainModel.");
    return;
  }

  if (payload.site?.id !== site.id || terrain.siteId !== site.id) {
    fail(
      site.archiveSite + ": API site identity mismatch (site=" +
      String(payload.site?.id) + ", terrain=" +
      String(terrain.siteId) + ")."
    );
  }

  if (terrain.status !== "partial") {
    fail(site.archiveSite + ": Product78 terrain status must be partial.");
  }
  if (terrain.resolutionMeters !== site.resolutionMeters) {
    fail(site.archiveSite + ": API terrain resolution does not match the local raster.");
  }
  if (terrain.completeHorizonVerified !== false) {
    fail(site.archiveSite + ": completeHorizonVerified must remain false.");
  }
  if (
    terrain.product90?.status !== "disabled" ||
    terrain.product90SamplesChecked !== 0
  ) {
    fail(site.archiveSite + ": Product90 must remain disabled on the main horizons API.");
  }

  const profile = Array.isArray(terrain.horizonProfile)
    ? terrain.horizonProfile
    : [];

  if (profile.length === 0) {
    fail(site.archiveSite + ": API returned an empty Product78 horizon profile.");
    return;
  }

  const seenAzimuths = new Set();
  let knownDirectionCount = 0;
  let unknownDirectionCount = 0;

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
    const validReason = allowedTerminationReasons.has(direction?.terminationReason);
    const unknownFlag = direction?.terrainBeyondKnownCoverageUnknown === true;
    const noDataSemantics =
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
      !noDataSemantics
    ) {
      fail(
        site.archiveSite + ": Product78 horizon direction " + index +
        " violates the partial/unknown-coverage contract."
      );
      continue;
    }

    const azimuthKey = direction.azimuthDeg.toFixed(6);
    if (seenAzimuths.has(azimuthKey)) {
      fail(site.archiveSite + ": duplicate horizon azimuth " + direction.azimuthDeg + "°.");
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

  for (const [targetName, observations] of Object.entries(observationsByTarget)) {
    for (const [index, observation] of observations.entries()) {
      const terrainVisibility = observation?.terrainVisibility;
      if (terrainVisibility === null || terrainVisibility === undefined) continue;

      const nearestDirection = profile.reduce((nearest, direction) => {
        if (!nearest) return direction;
        return angularDifference(direction.azimuthDeg, observation.azimuthDeg) <
          angularDifference(nearest.azimuthDeg, observation.azimuthDeg)
          ? direction
          : nearest;
      }, null);

      if (
        !nearestDirection ||
        nearestDirection.coverageStatus === "no_data" ||
        nearestDirection.source !== "product78" ||
        !Number.isFinite(nearestDirection.maxTerrainElevationAngleDeg)
      ) {
        fail(
          site.archiveSite + ": " + targetName +
          " observation " + index +
          " has terrain visibility despite an unknown horizon direction."
        );
        continue;
      }

      if (
        terrainVisibility.terrainCoverageComplete !== false ||
        ![
          "blocked_by_sampled_terrain",
          "above_sampled_terrain_unconfirmed",
        ].includes(terrainVisibility.assessment)
      ) {
        fail(
          site.archiveSite + ": " + targetName +
          " observation " + index +
          " incorrectly claims complete or unqualified terrain visibility."
        );
      }
    }
  }

  pass(
    site.archiveSite + ": " + profile.length + " horizon directions (" +
    knownDirectionCount + " known / " + unknownDirectionCount +
    " unknown); no-data directions remain unknown."
  );
}

async function validateSiteApi(site, requestedDate) {
  const endpoint = new URL("/api/horizons", baseUrl);
  endpoint.searchParams.set("date", requestedDate);
  endpoint.searchParams.set("siteId", site.id);

  let response;
  let payload;

  try {
    response = await fetch(endpoint, { cache: "no-store" });
    payload = await response.json();
  } catch (error) {
    fail(
      site.archiveSite + ": could not reach or parse " + endpoint +
      ": " + (error instanceof Error ? error.message : String(error))
    );
    return;
  }

  if (!response.ok || payload?.success !== true) {
    fail(
      site.archiveSite + ": Horizons API returned HTTP " +
      response.status + ": " + (payload?.error ?? "success=false")
    );
    if (payload?.targetErrors) {
      for (const [target, error] of Object.entries(payload.targetErrors)) {
        if (error) console.error("  " + target + ": " + error);
      }
    }
    return;
  }

  if (payload.status !== "partial" || payload.partial !== true) {
    fail(site.archiveSite + ": Product78-only API response should be marked partial.");
  } else {
    pass(site.archiveSite + ": Horizons API returned the expected partial status.");
  }

  const sun = validateObservations(
    site.archiveSite + " Sun",
    payload.targets?.sun,
    payload.targetStatus?.sun
  );
  const earth = validateObservations(
    site.archiveSite + " Earth",
    payload.targets?.earth,
    payload.targetStatus?.earth
  );

  validateTerrainPayload(site, payload, { Sun: sun, Earth: earth });
}

async function main() {
  console.log("\nLUNAPATH MULTI-SITE FRONTEND INTEGRATION CHECK");
  console.log("Target: " + baseUrl);
  console.log("UTC date: " + requestedDate);
  console.log("Sites: Site04, Site11, Site23\n");

  if (!isValidDate(requestedDate)) {
    fail("Date must be a real calendar date in YYYY-MM-DD format.");
    return;
  }

  let catalogue;
  try {
    const response = await fetch(new URL("/api/product78/sites", baseUrl), {
      cache: "no-store",
    });
    catalogue = await response.json();
    if (!response.ok || catalogue?.success !== true || !Array.isArray(catalogue.sites)) {
      fail("Product78 site catalogue request failed.");
      return;
    }
    pass(
      "Product78 catalogue loaded (" + catalogue.readySites +
      " ready of " + catalogue.totalSites + " registered sites)."
    );
  } catch (error) {
    fail(
      "Could not reach the Product78 site catalogue: " +
      (error instanceof Error ? error.message : String(error))
    );
    return;
  }

  const records = new Map(catalogue.sites.map((site) => [site.id, site]));
  const verifiedSites = [];

  for (const site of requiredSites) {
    console.log("\n--- " + site.archiveSite + " ---");
    const record = await validateLocalAssets(site, records.get(site.id));
    if (record) verifiedSites.push(site);
  }

  for (const site of verifiedSites) {
    console.log("\nAPI check: " + site.archiveSite);
    await validateSiteApi(site, requestedDate);
  }

  console.log("\nSUMMARY");
  console.log("  Required sites:       " + requiredSites.length);
  console.log("  Local assets verified:" + verifiedSites.length);
  console.log("  Failures:             " + failures);
  console.log("  Warnings:             " + warnings);

  if (failures > 0) {
    console.error("\nMulti-site integration check failed.");
    process.exitCode = 1;
  } else if (verifiedSites.length !== requiredSites.length) {
    console.error("\nNot all required local terrain assets were verified.");
    process.exitCode = 1;
  } else {
    console.log("\nAll three site selections passed the local and API contract checks.");
    console.log("Browser rendering and manual camera interaction still require browser testing.");
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
});