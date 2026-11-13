
import {
    type GeographicCoordinate,
    type LolaTerrainData,
    type ProjectedCoordinate,
    SITE04_COORDINATES,
    geographicToLolaProjected,
    projectedToLolaPixel,
    isLolaPixelInsideRaster,
    sampleLolaHeightAtPixel,
    sampleLolaHeightAtLocation,
} from "./terrainData";

import {
    getProduct90Diagnostics,
    sampleProduct90Elevation,
    sampleProduct90Elevations,
} from "./product90Terrain.server";

export type TerrainSampleSource =
    | "product78"
    | "product90";

export type MultiResolutionTermination =
    | "search_limit"
    | "product90_boundary"
    | "product90_nodata";

export interface MultiResolutionElevationSample {
    elevationMeters: number;
    source: TerrainSampleSource;
    resolutionMeters: number;
}

export interface MultiResolutionTerrainHorizonDirection {
    azimuthDeg: number;

    horizonElevationDeg: number;
    distanceMeters: number;
    terrainElevationMeters: number;

    horizonSource: TerrainSampleSource;
    horizonResolutionMeters: number;

    samplesChecked: number;
    product78SamplesChecked: number;
    product90SamplesChecked: number;

    terminationReason: MultiResolutionTermination;

    coverageLimited: true;
}

export interface MultiResolutionTerrainHorizonResult {
    observer: GeographicCoordinate;
    observerProjected: ProjectedCoordinate;
    observerElevationMeters: number;
    lunarRadiusMeters: number;

    sampleStepMeters: number;
    regionalSampleStepMeters: number;
    maxDistanceMeters: number;

    directions: MultiResolutionTerrainHorizonDirection[];

    calculatedDirections: number;
    totalSamplesChecked: number;

    product78SamplesChecked: number;
    product90SamplesChecked: number;

    rasterBoundaryLimitedDirections: number;
    product90CoverageBoundaryLimitedDirections: number;
    product90NoDataTerminatedDirections: number;
    searchLimitReachedDirections: number;

    product78ResolutionMeters: number;
    product90ResolutionMeters: number;

    completeHorizonVerified: false;
}

export interface MultiResolutionTerrainHorizonOptions {
    directionCount?: number;

    // Local Product 78 sampling interval.
    sampleStepMeters?: number;

    // Regional Product 90 sampling interval.
    regionalSampleStepMeters?: number;

    maxDistanceMeters?: number;

    // Limits simultaneous directional calculations.
    directionConcurrency?: number;
}

type Product90Diagnostics =
    Awaited<ReturnType<typeof getProduct90Diagnostics>>;

const DEFAULT_DIRECTION_COUNT = 360;
const DEFAULT_SAMPLE_STEP_METERS = 5;
const DEFAULT_REGIONAL_SAMPLE_STEP_METERS = 20;
const DEFAULT_MAX_DISTANCE_METERS = 15000;
const DEFAULT_DIRECTION_CONCURRENCY = 8;

const PRODUCT78_RESOLUTION_METERS = 5;
const PRODUCT90_RESOLUTION_METERS = 20;

let product90DiagnosticsPromise:
    Promise<Product90Diagnostics> | null = null;

/**
 * Retrieves Product 90 metadata once.
 *
 * Failed initialization remains retryable.
 */
async function getProduct90Metadata(): Promise<Product90Diagnostics> {
    if (!product90DiagnosticsPromise) {
        product90DiagnosticsPromise =
            getProduct90Diagnostics().catch((error: unknown) => {
                product90DiagnosticsPromise = null;
                throw error;
            });
    }

    return product90DiagnosticsPromise;
}

function assertFinite(
    value: number,
    name: string
): void {
    if (!Number.isFinite(value)) {
        throw new Error(
            `${name} must be finite. Received: ${value}.`
        );
    }
}

function normalizeMetadataValue(
    value: string
): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

function approximatelyEqual(
    actual: number,
    expected: number,
    tolerance = 1e-6
): boolean {
    return Math.abs(actual - expected) <= tolerance;
}

/**
 * Verifies that the two datasets advertise compatible
 * coordinate-system metadata before they are combined.
 *
 * This checks the supplied dataset descriptions and raster
 * metadata. It does not independently establish a complete
 * CRS transformation or vertical-datum equivalence.
 */
function validateDatasetCompatibility(
    product78: LolaTerrainData,
    product90: Product90Diagnostics
): void {
    const local = product78.metadata.coordinateSystem;
    const regional = product90.dataset;

    const checks = [
        {
            name: "projection",
            local: local.projection,
            regional: regional.projection,
        },
        {
            name: "reference frame",
            local: local.referenceFrame,
            regional: regional.referenceFrame,
        },
        {
            name: "ephemeris",
            local: local.ephemeris,
            regional: regional.ephemeris,
        },
    ];

    for (const check of checks) {
        if (
            normalizeMetadataValue(check.local) !==
            normalizeMetadataValue(check.regional)
        ) {
            throw new Error(
                `Product 78 and Product 90 ${check.name} mismatch. ` +
                `Product 78: ${check.local}; Product 90: ${check.regional}.`
            );
        }
    }

    const localUnits = normalizeMetadataValue(
        local.linearUnits
    );

    const regionalUnits = normalizeMetadataValue(
        regional.linearUnits
    );

    const meterAliases = [
        "m",
        "meter",
        "meters",
        "metre",
        "metres",
    ];

    if (
        !meterAliases.includes(localUnits) ||
        !meterAliases.includes(regionalUnits)
    ) {
        throw new Error(
            "Both terrain datasets must use projected coordinates in metres."
        );
    }

    const localPixelRegistration = normalizeMetadataValue(
        local.pixelRegistration
    );

    if (
        localPixelRegistration !== "pixelarea" &&
        localPixelRegistration !== "pixelisarea"
    ) {
        throw new Error(
            `Unsupported Product 78 pixel registration: ${local.pixelRegistration}.`
        );
    }

    if (!product90.raster.pixelIsArea) {
        throw new Error(
            "Product 90 must use PixelIsArea registration."
        );
    }

    if (
        !approximatelyEqual(
            Math.abs(product78.metadata.pixelResolution[0]),
            PRODUCT78_RESOLUTION_METERS,
            0.001
        ) ||
        !approximatelyEqual(
            Math.abs(product78.metadata.pixelResolution[1]),
            PRODUCT78_RESOLUTION_METERS,
            0.001
        )
    ) {
        throw new Error(
            "Product 78 pixel resolution does not match the configured 5 m sampling model."
        );
    }

    if (
        !approximatelyEqual(
            Math.abs(product90.raster.pixelWidth),
            PRODUCT90_RESOLUTION_METERS,
            0.001
        ) ||
        !approximatelyEqual(
            Math.abs(product90.raster.pixelHeight),
            PRODUCT90_RESOLUTION_METERS,
            0.001
        )
    ) {
        throw new Error(
            "Product 90 pixel resolution does not match the configured 20 m sampling model."
        );
    }

    // Verify that the entire Product 78 raster footprint
    // is covered by the published Product 90 extent.
    const [
        localMinX,
        localMinY,
        localMaxX,
        localMaxY,
    ] = product78.metadata.bbox;

    const [
        regionalMinX,
        regionalMinY,
        regionalMaxX,
        regionalMaxY,
    ] = product90.raster.boundingBox;

    if (
        localMinX < regionalMinX ||
        localMinY < regionalMinY ||
        localMaxX > regionalMaxX ||
        localMaxY > regionalMaxY
    ) {
        throw new Error(
            "Product 78 raster footprint is not completely contained within Product 90 coverage."
        );
    }
}

/**
 * Tests the actual PixelIsArea footprint of Product 90.
 *
 * The upper/right outer edges follow the same half-open
 * pixel footprint convention used by the GeoTIFF sampler.
 */
function isInsideProduct90Raster(
    x: number,
    y: number,
    diagnostics: Product90Diagnostics
): boolean {
    const [
        minX,
        minY,
        maxX,
        maxY,
    ] = diagnostics.raster.boundingBox;

    return (
        x >= minX &&
        x < maxX &&
        y > minY &&
        y <= maxY
    );
}

/**
 * Samples both datasets at the same projected lunar
 * coordinate.
 *
 * Priority:
 * 1. Product 78 inside its local raster footprint.
 * 2. Product 90 outside Product 78 but inside Product 90.
 * 3. null if neither dataset supplies a valid elevation.
 *
 * No elevation averaging or artificial blending occurs.
 */
export async function sampleMultiResolutionElevation(
    product78: LolaTerrainData,
    projected: ProjectedCoordinate
): Promise<MultiResolutionElevationSample | null> {
    assertFinite(projected.xMeters, "Projected X");
    assertFinite(projected.yMeters, "Projected Y");

    const localPixel = projectedToLolaPixel(
        projected,
        product78.metadata
    );

    if (isLolaPixelInsideRaster(localPixel, product78)) {
        const elevation = sampleLolaHeightAtPixel(
            product78,
            localPixel
        );

        if (!Number.isFinite(elevation)) {
            throw new Error(
                "Product 78 returned an invalid elevation."
            );
        }

        return {
            elevationMeters: elevation,
            source: "product78",
            resolutionMeters: PRODUCT78_RESOLUTION_METERS,
        };
    }

    const diagnostics = await getProduct90Metadata();

    if (
        !isInsideProduct90Raster(
            projected.xMeters,
            projected.yMeters,
            diagnostics
        )
    ) {
        return null;
    }

    const elevation = await sampleProduct90Elevation(
        projected.xMeters,
        projected.yMeters
    );

    if (elevation === null) {
        return null;
    }

    if (!Number.isFinite(elevation)) {
        throw new Error(
            "Product 90 returned an invalid elevation."
        );
    }

    return {
        elevationMeters: elevation,
        source: "product90",
        resolutionMeters: PRODUCT90_RESOLUTION_METERS,
    };
}

/**
 * Converts degrees to radians.
 */
function toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
}

/**
 * Converts radians to degrees.
 */
function toDegrees(radians: number): number {
    return (radians * 180) / Math.PI;
}

/**
 * Normalizes east longitude to [0, 360).
 */
function normalizeEastLongitude(
    longitudeDeg: number
): number {
    return ((longitudeDeg % 360) + 360) % 360;
}

/**
 * Calculates a destination coordinate on a spherical Moon.
 *
 * Bearing:
 * 0° = North
 * 90° = East
 * 180° = South
 * 270° = West
 */
function destinationCoordinate(
    start: GeographicCoordinate,
    bearingDeg: number,
    distanceMeters: number,
    lunarRadiusMeters: number
): GeographicCoordinate {
    const latitude1 = toRadians(start.latitudeDeg);

    const longitude1 = toRadians(
        normalizeEastLongitude(start.longitudeEastDeg)
    );

    const bearing = toRadians(bearingDeg);

    const angularDistance =
        distanceMeters / lunarRadiusMeters;

    const sinLatitude2 =
        Math.sin(latitude1) * Math.cos(angularDistance) +
        Math.cos(latitude1) *
        Math.sin(angularDistance) *
        Math.cos(bearing);

    const latitude2 = Math.asin(
        Math.max(-1, Math.min(1, sinLatitude2))
    );

    const longitude2 =
        longitude1 +
        Math.atan2(
            Math.sin(bearing) *
            Math.sin(angularDistance) *
            Math.cos(latitude1),

            Math.cos(angularDistance) -
            Math.sin(latitude1) * Math.sin(latitude2)
        );

    return {
        latitudeDeg: toDegrees(latitude2),

        longitudeEastDeg: normalizeEastLongitude(
            toDegrees(longitude2)
        ),
    };
}

/**
 * Calculates apparent terrain elevation relative to the
 * observer's local horizontal plane.
 *
 * This preserves the existing spherical lunar-curvature
 * method used by terrainHorizon.ts.
 */
function calculateTerrainElevationAngle(
    observerElevationMeters: number,
    terrainElevationMeters: number,
    distanceMeters: number,
    lunarRadiusMeters: number
): number {
    if (
        !Number.isFinite(observerElevationMeters) ||
        !Number.isFinite(terrainElevationMeters) ||
        !Number.isFinite(distanceMeters) ||
        distanceMeters <= 0 ||
        !Number.isFinite(lunarRadiusMeters) ||
        lunarRadiusMeters <= 0
    ) {
        throw new Error(
            "Invalid values supplied to terrain elevation angle calculation."
        );
    }

    const observerRadius =
        lunarRadiusMeters + observerElevationMeters;

    const terrainRadius =
        lunarRadiusMeters + terrainElevationMeters;

    if (
        observerRadius <= 0 ||
        terrainRadius <= 0
    ) {
        throw new Error(
            "Observer or terrain radius is invalid."
        );
    }

    const angularDistance =
        distanceMeters / lunarRadiusMeters;

    const vertical =
        terrainRadius * Math.cos(angularDistance) -
        observerRadius;

    const horizontal =
        terrainRadius * Math.sin(angularDistance);

    const angle = toDegrees(
        Math.atan2(vertical, horizontal)
    );

    if (!Number.isFinite(angle)) {
        throw new Error(
            "Terrain elevation angle calculation produced an invalid result."
        );
    }

    return angle;
}

/**
 * Calculates a multi-resolution horizon for one azimuth.
 *
 * Product 78 is sampled at the configured local interval.
 * Product 90 is sampled at its regional interval after the
 * Product 78 footprint is exited.
 *
 * An uncovered or NoData regional sample terminates the
 * direction explicitly. It is never treated as clear terrain.
 */

/**
 * Calculates a multi-resolution horizon for one azimuth.
 *
 * Product 78 is sampled locally at its configured interval.
 * Product 90 coordinates are collected and sampled in one
 * batch after the directional path has been generated.
 *
 * This avoids repeatedly awaiting four individual pixel
 * reads for every regional elevation sample.
 *
 * The original lunar curvature calculation is preserved.
 */
async function calculateDirectionHorizon(
    product78: LolaTerrainData,
    product90: Product90Diagnostics,
    observer: GeographicCoordinate,
    observerElevationMeters: number,
    azimuthDeg: number,
    sampleStepMeters: number,
    regionalSampleStepMeters: number,
    maxDistanceMeters: number,
    lunarRadiusMeters: number
): Promise<MultiResolutionTerrainHorizonDirection> {
    type DirectionPathSample =
        | {
            source: "product78";
            distanceMeters: number;
            elevationMeters: number;
        }
        | {
            source: "product90";
            distanceMeters: number;
            regionalIndex: number;
        };

    const pathSamples: DirectionPathSample[] = [];

    const regionalCoordinates: Array<{
        x: number;
        y: number;
    }> = [];

    let terminationReason: MultiResolutionTermination =
        "search_limit";

    // Generate the path using the appropriate resolution.
    let distance = Math.min(
        sampleStepMeters,
        maxDistanceMeters
    );

    const minimumStepMeters = Math.min(
        sampleStepMeters,
        regionalSampleStepMeters
    );

    const maximumIterations =
        Math.ceil(maxDistanceMeters / minimumStepMeters) + 2;

    let iterations = 0;

    while (distance <= maxDistanceMeters) {
        iterations++;

        if (iterations > maximumIterations) {
            throw new Error(
                `Maximum path-generation iterations exceeded at azimuth ${azimuthDeg}°.`
            );
        }

        const coordinate = destinationCoordinate(
            observer,
            azimuthDeg,
            distance,
            lunarRadiusMeters
        );

        const projected = geographicToLolaProjected(
            coordinate,
            product78.metadata
        );

        const localPixel = projectedToLolaPixel(
            projected,
            product78.metadata
        );

        let stepAfterSample: number;

        if (isLolaPixelInsideRaster(localPixel, product78)) {
            // Product 78: use existing high-resolution sampling.
            const elevation = sampleLolaHeightAtPixel(
                product78,
                localPixel
            );

            pathSamples.push({
                source: "product78",
                distanceMeters: distance,
                elevationMeters: elevation,
            });

            stepAfterSample = sampleStepMeters;
        } else {
            // Product 78 has ended.
            // Check whether Product 90 still covers this position.
            if (
                !isInsideProduct90Raster(
                    projected.xMeters,
                    projected.yMeters,
                    product90
                )
            ) {
                terminationReason = "product90_boundary";
                break;
            }

            // Queue regional coordinates instead of awaiting
            // individual remote elevation reads.
            const regionalIndex =
                regionalCoordinates.length;

            regionalCoordinates.push({
                x: projected.xMeters,
                y: projected.yMeters,
            });

            pathSamples.push({
                source: "product90",
                distanceMeters: distance,
                regionalIndex,
            });

            stepAfterSample = regionalSampleStepMeters;
        }

        // Include the exact configured endpoint.
        if (distance >= maxDistanceMeters) {
            terminationReason = "search_limit";
            break;
        }

        const nextDistance = Math.min(
            distance + stepAfterSample,
            maxDistanceMeters
        );

        if (nextDistance <= distance) {
            throw new Error(
                `Terrain sampling failed to advance at azimuth ${azimuthDeg}°.`
            );
        }

        distance = nextDistance;
    }

    // Load and sample all regional coordinates in one batch.
    const regionalElevations =
        regionalCoordinates.length > 0
            ? await sampleProduct90Elevations(
                regionalCoordinates
            )
            : [];

    if (
        regionalElevations.length !==
        regionalCoordinates.length
    ) {
        throw new Error(
            `Product 90 batch returned ${regionalElevations.length} results for ` +
            `${regionalCoordinates.length} requested coordinates.`
        );
    }

    let maximumAngle = -Infinity;
    let maximumDistance = 0;
    let maximumTerrainElevation = 0;

    let horizonSource: TerrainSampleSource = "product78";

    let horizonResolutionMeters =
        PRODUCT78_RESOLUTION_METERS;

    let samplesChecked = 0;
    let product78SamplesChecked = 0;
    let product90SamplesChecked = 0;

    // Process the samples in original distance order.
    for (const pathSample of pathSamples) {
        let terrainElevation: number;
        let source: TerrainSampleSource;
        let resolutionMeters: number;

        if (pathSample.source === "product78") {
            terrainElevation = pathSample.elevationMeters;

            source = "product78";
            resolutionMeters = PRODUCT78_RESOLUTION_METERS;
        } else {
            const regionalElevation =
                regionalElevations[pathSample.regionalIndex];

            // Stop at the first missing regional elevation.
            // Never treat missing terrain as unobstructed.
            if (regionalElevation === null) {
                terminationReason = "product90_nodata";
                break;
            }

            if (!Number.isFinite(regionalElevation)) {
                throw new Error(
                    `Invalid Product 90 elevation at azimuth ${azimuthDeg}°.`
                );
            }

            terrainElevation = regionalElevation;

            source = "product90";
            resolutionMeters = PRODUCT90_RESOLUTION_METERS;
        }

        if (!Number.isFinite(terrainElevation)) {
            throw new Error(
                `Invalid ${source} elevation at azimuth ${azimuthDeg}°, ` +
                `distance ${pathSample.distanceMeters} m.`
            );
        }

        // Preserve the existing lunar-curvature model.
        const elevationAngle =
            calculateTerrainElevationAngle(
                observerElevationMeters,
                terrainElevation,
                pathSample.distanceMeters,
                lunarRadiusMeters
            );

        samplesChecked++;

        if (source === "product78") {
            product78SamplesChecked++;
        } else {
            product90SamplesChecked++;
        }

        if (elevationAngle > maximumAngle) {
            maximumAngle = elevationAngle;

            maximumDistance =
                pathSample.distanceMeters;

            maximumTerrainElevation =
                terrainElevation;

            horizonSource = source;
            horizonResolutionMeters = resolutionMeters;
        }
    }

    // Fail closed if no valid terrain was sampled.
    if (samplesChecked === 0) {
        throw new Error(
            `No valid terrain samples at azimuth ${azimuthDeg}°.`
        );
    }

    if (
        !Number.isFinite(maximumAngle) ||
        !Number.isFinite(maximumDistance) ||
        !Number.isFinite(maximumTerrainElevation)
    ) {
        throw new Error(
            `Invalid horizon result at azimuth ${azimuthDeg}°.`
        );
    }

    return {
        azimuthDeg,

        horizonElevationDeg: maximumAngle,
        distanceMeters: maximumDistance,
        terrainElevationMeters: maximumTerrainElevation,

        horizonSource,
        horizonResolutionMeters,

        samplesChecked,
        product78SamplesChecked,
        product90SamplesChecked,

        terminationReason,

        coverageLimited: true,
    };
}

/**
 * Calculates the terrain horizon using Product 78 locally
 * and Product 90 regionally.
 *
 * This is an asynchronous replacement for the existing
 * Product-78-only calculation at the API integration point.
 *
 * The original calculateTerrainHorizon() remains unchanged.
 */
export async function calculateMultiResolutionTerrainHorizon(
    product78: LolaTerrainData,
    observer: GeographicCoordinate = SITE04_COORDINATES,
    options: MultiResolutionTerrainHorizonOptions = {}
): Promise<MultiResolutionTerrainHorizonResult> {
    const directionCount =
        options.directionCount ?? DEFAULT_DIRECTION_COUNT;

    const sampleStepMeters =
        options.sampleStepMeters ?? DEFAULT_SAMPLE_STEP_METERS;

    const regionalSampleStepMeters =
        options.regionalSampleStepMeters ??
        DEFAULT_REGIONAL_SAMPLE_STEP_METERS;

    const maxDistanceMeters =
        options.maxDistanceMeters ?? DEFAULT_MAX_DISTANCE_METERS;

    const directionConcurrency =
        options.directionConcurrency ??
        DEFAULT_DIRECTION_CONCURRENCY;

    if (
        !Number.isSafeInteger(directionCount) ||
        directionCount < 4
    ) {
        throw new Error(
            "directionCount must be a safe integer of at least 4."
        );
    }

    if (
        !Number.isFinite(sampleStepMeters) ||
        sampleStepMeters <= 0
    ) {
        throw new Error(
            "sampleStepMeters must be greater than zero."
        );
    }

    if (
        !Number.isFinite(regionalSampleStepMeters) ||
        regionalSampleStepMeters <
        PRODUCT90_RESOLUTION_METERS
    ) {
        throw new Error(
            "regionalSampleStepMeters must be at least Product 90's 20 m pixel spacing."
        );
    }

    if (
        !Number.isFinite(maxDistanceMeters) ||
        maxDistanceMeters <= 0
    ) {
        throw new Error(
            "maxDistanceMeters must be greater than zero."
        );
    }

    if (
        !Number.isSafeInteger(directionConcurrency) ||
        directionConcurrency < 1 ||
        directionConcurrency > 32
    ) {
        throw new Error(
            "directionConcurrency must be an integer between 1 and 32."
        );
    }

    if (
        !Number.isFinite(observer.latitudeDeg) ||
        observer.latitudeDeg < -90 ||
        observer.latitudeDeg > 90 ||
        !Number.isFinite(observer.longitudeEastDeg) ||
        observer.longitudeEastDeg < -360 ||
        observer.longitudeEastDeg > 360
    ) {
        throw new Error(
            "Invalid observer geographic coordinates."
        );
    }

    const lunarRadius =
        product78.metadata.georeferencing.lunarRadiusMeters;

    if (!Number.isFinite(lunarRadius) || lunarRadius <= 0) {
        throw new Error(
            `Invalid lunar radius: ${lunarRadius}.`
        );
    }

    if (
        maxDistanceMeters >= Math.PI * lunarRadius
    ) {
        throw new Error(
            "Maximum search distance must be less than half the lunar circumference."
        );
    }

    // Ensure the observer has a valid local Product 78 elevation.
    const observerSample = sampleLolaHeightAtLocation(
        product78,
        observer
    );

    // Load and validate Product 90 before the expensive
    // directional calculation starts.
    const product90 = await getProduct90Metadata();

    validateDatasetCompatibility(
        product78,
        product90
    );

    const directions: MultiResolutionTerrainHorizonDirection[] = [];

    let totalSamplesChecked = 0;
    let product78SamplesChecked = 0;
    let product90SamplesChecked = 0;

    let rasterBoundaryLimitedDirections = 0;
    let product90CoverageBoundaryLimitedDirections = 0;
    let product90NoDataTerminatedDirections = 0;
    let searchLimitReachedDirections = 0;

    // Bound concurrency so simultaneous directional paths
    // do not create an uncontrolled number of remote tile reads.
    for (
        let start = 0;
        start < directionCount;
        start += directionConcurrency
    ) {
        const end = Math.min(
            start + directionConcurrency,
            directionCount
        );

        const batch = await Promise.all(
            Array.from(
                { length: end - start },
                (_, index) => {
                    const directionIndex = start + index;

                    const azimuthDeg =
                        (directionIndex * 360) / directionCount;

                    return calculateDirectionHorizon(
                        product78,
                        product90,
                        observer,
                        observerSample.elevationMeters,
                        azimuthDeg,
                        sampleStepMeters,
                        regionalSampleStepMeters,
                        maxDistanceMeters,
                        lunarRadius
                    );
                }
            )
        );

        directions.push(...batch);
    }

    for (const direction of directions) {
        totalSamplesChecked += direction.samplesChecked;

        product78SamplesChecked +=
            direction.product78SamplesChecked;

        product90SamplesChecked +=
            direction.product90SamplesChecked;

        if (direction.terminationReason === "search_limit") {
            searchLimitReachedDirections++;
        } else {
            rasterBoundaryLimitedDirections++;

            if (
                direction.terminationReason === "product90_boundary"
            ) {
                product90CoverageBoundaryLimitedDirections++;
            }

            if (
                direction.terminationReason === "product90_nodata"
            ) {
                product90NoDataTerminatedDirections++;
            }
        }
    }

    return {
        observer,

        observerProjected: observerSample.projected,

        observerElevationMeters:
            observerSample.elevationMeters,

        lunarRadiusMeters: lunarRadius,

        sampleStepMeters,
        regionalSampleStepMeters,
        maxDistanceMeters,

        directions,

        calculatedDirections: directions.length,
        totalSamplesChecked,

        product78SamplesChecked,
        product90SamplesChecked,

        rasterBoundaryLimitedDirections,
        product90CoverageBoundaryLimitedDirections,
        product90NoDataTerminatedDirections,
        searchLimitReachedDirections,

        product78ResolutionMeters:
            PRODUCT78_RESOLUTION_METERS,

        product90ResolutionMeters:
            PRODUCT90_RESOLUTION_METERS,

        // A 15 km search limit and finite raster coverage
        // never prove the complete lunar horizon.
        completeHorizonVerified: false,
    };
}
