
import {
    type GeographicCoordinate,
    type LolaTerrainData,
    type ProjectedCoordinate,
    LolaNoDataError,
    SITE04_COORDINATES,
    geographicToLolaProjected,
    projectedToLolaPixel,
    isLolaPixelInsideRaster,
    sampleLolaHeightAtPixel,
    sampleLolaHeightAtLocation,
} from "./terrainData";

/* =====================================================
   TYPES — NASA LOLA PRODUCT 78 ONLY
===================================================== */

export type TerrainSampleSource = "product78";

export type MultiResolutionTermination =
    | "search_limit"
    | "product78_boundary"
    | "product78_nodata";

export interface MultiResolutionElevationSample {
    elevationMeters: number;
    source: TerrainSampleSource;
    resolutionMeters: number;
}

export interface MultiResolutionTerrainHorizonDirection {
    azimuthDeg: number;

    horizonElevationDeg: number | null;
    distanceMeters: number | null;
    terrainElevationMeters: number | null;

    horizonSource: TerrainSampleSource | null;
    horizonResolutionMeters: number | null;

    lastKnownSampleDistanceMeters: number | null;

    coverageStatus: "partial" | "no_data";
    terrainBeyondKnownCoverageUnknown: true;

    samplesChecked: number;
    product78SamplesChecked: number;

    terminationReason: MultiResolutionTermination;
    coverageLimited: true;
}

export interface MultiResolutionTerrainHorizonResult {
    observer: GeographicCoordinate;
    observerProjected: ProjectedCoordinate;
    observerElevationMeters: number;
    lunarRadiusMeters: number;

    sampleStepMeters: number;
    maxDistanceMeters: number;

    directions: MultiResolutionTerrainHorizonDirection[];

    calculatedDirections: number;
    totalSamplesChecked: number;
    product78SamplesChecked: number;

    rasterBoundaryLimitedDirections: number;
    product78BoundaryLimitedDirections: number;
    product78NoDataTerminatedDirections: number;
    searchLimitReachedDirections: number;

    product78ResolutionMeters: number;

    completeHorizonVerified: false;
}

export interface MultiResolutionTerrainHorizonOptions {
    directionCount?: number;
    sampleStepMeters?: number;
    maxDistanceMeters?: number;
    directionConcurrency?: number;
}

/* =====================================================
   CONFIGURATION
===================================================== */

const DEFAULT_DIRECTION_COUNT = 360;
const DEFAULT_SAMPLE_STEP_METERS = 5;
const DEFAULT_MAX_DISTANCE_METERS = 15000;
const DEFAULT_DIRECTION_CONCURRENCY = 8;

const PRODUCT78_RESOLUTION_METERS = 5;

/* =====================================================
   VALIDATION HELPERS
===================================================== */

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

/* =====================================================
   ANGLE HELPERS
===================================================== */

function toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
    return (radians * 180) / Math.PI;
}

function normalizeEastLongitude(
    longitudeDeg: number
): number {
    return ((longitudeDeg % 360) + 360) % 360;
}

/* =====================================================
   LUNAR DESTINATION COORDINATE
===================================================== */

/**
 * Calculates a destination coordinate on a spherical Moon.
 *
 * Bearing:
 * 0°   = North
 * 90°  = East
 * 180° = South
 * 270° = West
 */
function destinationCoordinate(
    start: GeographicCoordinate,
    bearingDeg: number,
    distanceMeters: number,
    lunarRadiusMeters: number
): GeographicCoordinate {
    const latitude1 = toRadians(
        start.latitudeDeg
    );

    const longitude1 = toRadians(
        normalizeEastLongitude(
            start.longitudeEastDeg
        )
    );

    const bearing = toRadians(bearingDeg);

    const angularDistance =
        distanceMeters / lunarRadiusMeters;

    const sinLatitude2 =
        Math.sin(latitude1) *
        Math.cos(angularDistance) +
        Math.cos(latitude1) *
        Math.sin(angularDistance) *
        Math.cos(bearing);

    const latitude2 = Math.asin(
        Math.max(
            -1,
            Math.min(1, sinLatitude2)
        )
    );

    const longitude2 =
        longitude1 +
        Math.atan2(
            Math.sin(bearing) *
            Math.sin(angularDistance) *
            Math.cos(latitude1),

            Math.cos(angularDistance) -
            Math.sin(latitude1) *
            Math.sin(latitude2)
        );

    return {
        latitudeDeg: toDegrees(latitude2),

        longitudeEastDeg:
            normalizeEastLongitude(
                toDegrees(longitude2)
            ),
    };
}

/* =====================================================
   TERRAIN ELEVATION ANGLE
===================================================== */

/**
 * Calculates terrain elevation relative to the observer's
 * local horizontal plane, accounting for lunar curvature.
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
        lunarRadiusMeters +
        observerElevationMeters;

    const terrainRadius =
        lunarRadiusMeters +
        terrainElevationMeters;

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
        terrainRadius *
        Math.cos(angularDistance) -
        observerRadius;

    const horizontal =
        terrainRadius *
        Math.sin(angularDistance);

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

/* =====================================================
   PRODUCT 78 ELEVATION SAMPLING
===================================================== */

/**
 * Samples an elevation using the local Product 78 raster.
 *
 * Returns null when the coordinate is outside the raster.
 * Does not use another dataset as a fallback.
 */
export async function sampleMultiResolutionElevation(
    product78: LolaTerrainData,
    projected: ProjectedCoordinate
): Promise<MultiResolutionElevationSample | null> {
    assertFinite(
        projected.xMeters,
        "Projected X"
    );

    assertFinite(
        projected.yMeters,
        "Projected Y"
    );

    const pixel = projectedToLolaPixel(
        projected,
        product78.metadata
    );

    if (!isLolaPixelInsideRaster(pixel, product78)) {
        return null;
    }

    const elevation = sampleLolaHeightAtPixel(
        product78,
        pixel
    );

    if (!Number.isFinite(elevation)) {
        throw new Error(
            "NASA LOLA Product 78 returned an invalid elevation."
        );
    }

    return {
        elevationMeters: elevation,
        source: "product78",
        resolutionMeters: PRODUCT78_RESOLUTION_METERS,
    };
}

/* =====================================================
   PRODUCT 78 DIRECTION HORIZON
===================================================== */

/**
 * Calculates the terrain horizon for one azimuth.
 *
 * Sampling uses Product 78 exclusively.
 *
 * The ray terminates at:
 * - The configured maximum search distance.
 * - The Product 78 raster boundary.
 * - A declared Product 78 NoData sample.
 *
 * Missing terrain is never interpreted as unobstructed sky.
 */
function calculateProduct78DirectionHorizon(
    product78: LolaTerrainData,
    observer: GeographicCoordinate,
    observerElevationMeters: number,
    azimuthDeg: number,
    sampleStepMeters: number,
    maxDistanceMeters: number,
    lunarRadiusMeters: number
): MultiResolutionTerrainHorizonDirection {
    let maximumAngle = -Infinity;

    let maximumDistance: number | null = null;
    let maximumTerrainElevation: number | null = null;

    let lastKnownSampleDistance: number | null = null;

    let samplesChecked = 0;

    let terminationReason: MultiResolutionTermination =
        "search_limit";

    const maximumIterations =
        Math.ceil(
            maxDistanceMeters / sampleStepMeters
        ) + 2;

    let distance = Math.min(
        sampleStepMeters,
        maxDistanceMeters
    );

    let iterations = 0;

    while (distance <= maxDistanceMeters) {
        iterations++;

        if (iterations > maximumIterations) {
            throw new Error(
                `Maximum Product 78 path iterations exceeded at azimuth ${azimuthDeg}°.`
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

        const pixel = projectedToLolaPixel(
            projected,
            product78.metadata
        );

        if (!isLolaPixelInsideRaster(pixel, product78)) {
            terminationReason = "product78_boundary";
            break;
        }

        let elevation: number;

        try {
            elevation = sampleLolaHeightAtPixel(
                product78,
                pixel
            );
        } catch (error) {
            if (error instanceof LolaNoDataError) {
                terminationReason = "product78_nodata";
                break;
            }

            throw error;
        }

        if (!Number.isFinite(elevation)) {
            throw new Error(
                `Product 78 returned a non-finite elevation at azimuth ${azimuthDeg}°, distance ${distance} m.`
            );
        }

        const angle = calculateTerrainElevationAngle(
            observerElevationMeters,
            elevation,
            distance,
            lunarRadiusMeters
        );

        samplesChecked++;
        lastKnownSampleDistance = distance;

        if (angle > maximumAngle) {
            maximumAngle = angle;
            maximumDistance = distance;
            maximumTerrainElevation = elevation;
        }

        if (distance >= maxDistanceMeters) {
            terminationReason = "search_limit";
            break;
        }

        const nextDistance = Math.min(
            distance + sampleStepMeters,
            maxDistanceMeters
        );

        if (nextDistance <= distance) {
            throw new Error(
                `Product 78 sampling failed to advance at azimuth ${azimuthDeg}°.`
            );
        }

        distance = nextDistance;
    }

    const hasSamples = samplesChecked > 0;

    return {
        azimuthDeg,

        horizonElevationDeg: hasSamples
            ? maximumAngle
            : null,

        distanceMeters: maximumDistance,

        terrainElevationMeters:
            maximumTerrainElevation,

        horizonSource: hasSamples
            ? "product78"
            : null,

        horizonResolutionMeters: hasSamples
            ? PRODUCT78_RESOLUTION_METERS
            : null,

        lastKnownSampleDistanceMeters:
            lastKnownSampleDistance,

        coverageStatus: hasSamples
            ? "partial"
            : "no_data",

        terrainBeyondKnownCoverageUnknown: true,

        samplesChecked,
        product78SamplesChecked: samplesChecked,

        terminationReason,

        coverageLimited: true,
    };
}

/* =====================================================
   PRODUCT 78 HORIZON CALCULATION
===================================================== */

/**
 * Calculates terrain horizons in multiple azimuth directions.
 *
 * NASA LOLA Product 78 is the only elevation source.
 *
 * No external regional terrain dataset is loaded, imported,
 * sampled, or used as a fallback.
 *
 * The calculation never claims complete lunar horizon coverage.
 */
export async function calculateMultiResolutionTerrainHorizon(
    product78: LolaTerrainData,
    observer: GeographicCoordinate = SITE04_COORDINATES,
    options: MultiResolutionTerrainHorizonOptions = {}
): Promise<MultiResolutionTerrainHorizonResult> {
    const directionCount =
        options.directionCount ??
        DEFAULT_DIRECTION_COUNT;

    const sampleStepMeters =
        options.sampleStepMeters ??
        DEFAULT_SAMPLE_STEP_METERS;

    const maxDistanceMeters =
        options.maxDistanceMeters ??
        DEFAULT_MAX_DISTANCE_METERS;

    const directionConcurrency =
        options.directionConcurrency ??
        DEFAULT_DIRECTION_CONCURRENCY;

    /* -----------------------------------------------
       Validate calculation parameters.
    ------------------------------------------------ */

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

    /* -----------------------------------------------
       Validate Product 78 metadata.
    ------------------------------------------------ */

    const metadata = product78.metadata;
    const coordinateSystem = metadata.coordinateSystem;

    if (
        normalizeMetadataValue(
            coordinateSystem.projection
        ) !== "southpolarstereographic"
    ) {
        throw new Error(
            "Product 78 must use South Polar Stereographic projection."
        );
    }

    if (
        normalizeMetadataValue(
            coordinateSystem.referenceFrame
        ) !== "moonme" ||
        normalizeMetadataValue(
            coordinateSystem.ephemeris
        ) !== "de421"
    ) {
        throw new Error(
            "Product 78 must use the MOON_ME reference frame and DE421 ephemeris."
        );
    }

    const units = normalizeMetadataValue(
        coordinateSystem.linearUnits
    );

    if (
        ![
            "m",
            "meter",
            "meters",
            "metre",
            "metres",
        ].includes(units)
    ) {
        throw new Error(
            "Product 78 projected coordinates must use metres."
        );
    }

    const pixelRegistration =
        normalizeMetadataValue(
            coordinateSystem.pixelRegistration
        );

    if (
        pixelRegistration !== "pixelarea" &&
        pixelRegistration !== "pixelisarea"
    ) {
        throw new Error(
            "Product 78 must use PixelIsArea registration."
        );
    }

    if (
        !Number.isSafeInteger(product78.width) ||
        !Number.isSafeInteger(product78.height) ||
        product78.width <= 0 ||
        product78.height <= 0 ||
        metadata.width !== product78.width ||
        metadata.height !== product78.height ||
        product78.elevations.length !==
            product78.width * product78.height
    ) {
        throw new Error(
            "Product 78 elevation array dimensions do not match validated metadata."
        );
    }

    if (
        !approximatelyEqual(
            Math.abs(metadata.pixelResolution[0]),
            PRODUCT78_RESOLUTION_METERS,
            0.001
        ) ||
        !approximatelyEqual(
            Math.abs(metadata.pixelResolution[1]),
            PRODUCT78_RESOLUTION_METERS,
            0.001
        ) ||
        !approximatelyEqual(
            metadata.resolutionMeters,
            PRODUCT78_RESOLUTION_METERS,
            0.001
        )
    ) {
        throw new Error(
            "Product 78 horizon calculation requires the validated 5 m/pixel raster."
        );
    }

    const lunarRadius =
        metadata.georeferencing.lunarRadiusMeters;

    if (
        !Number.isFinite(lunarRadius) ||
        lunarRadius <= 0
    ) {
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

    /* -----------------------------------------------
       Validate observer elevation.
    ------------------------------------------------ */

    const observerSample =
        sampleLolaHeightAtLocation(
            product78,
            observer
        );

    /* -----------------------------------------------
       Calculate all requested azimuth directions.
    ------------------------------------------------ */

    const directions: MultiResolutionTerrainHorizonDirection[] = [];

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
                        (directionIndex * 360) /
                        directionCount;

                    return calculateProduct78DirectionHorizon(
                        product78,
                        observer,
                        observerSample.elevationMeters,
                        azimuthDeg,
                        sampleStepMeters,
                        maxDistanceMeters,
                        lunarRadius
                    );
                }
            )
        );

        directions.push(...batch);
    }

    /* -----------------------------------------------
       Aggregate Product 78 diagnostics.
    ------------------------------------------------ */

    let totalSamplesChecked = 0;
    let product78SamplesChecked = 0;

    let rasterBoundaryLimitedDirections = 0;
    let product78BoundaryLimitedDirections = 0;
    let product78NoDataTerminatedDirections = 0;
    let searchLimitReachedDirections = 0;

    for (const direction of directions) {
        totalSamplesChecked +=
            direction.samplesChecked;

        product78SamplesChecked +=
            direction.product78SamplesChecked;

        if (
            direction.terminationReason ===
            "search_limit"
        ) {
            searchLimitReachedDirections++;
        } else if (
            direction.terminationReason ===
            "product78_boundary"
        ) {
            rasterBoundaryLimitedDirections++;
            product78BoundaryLimitedDirections++;
        } else if (
            direction.terminationReason ===
            "product78_nodata"
        ) {
            product78NoDataTerminatedDirections++;
        }
    }

    /* -----------------------------------------------
       Return Product 78-only scientific result.
    ------------------------------------------------ */

    return {
        observer,

        observerProjected:
            observerSample.projected,

        observerElevationMeters:
            observerSample.elevationMeters,

        lunarRadiusMeters: lunarRadius,

        sampleStepMeters,
        maxDistanceMeters,

        directions,

        calculatedDirections:
            directions.length,

        totalSamplesChecked,
        product78SamplesChecked,

        rasterBoundaryLimitedDirections,
        product78BoundaryLimitedDirections,
        product78NoDataTerminatedDirections,
        searchLimitReachedDirections,

        product78ResolutionMeters:
            PRODUCT78_RESOLUTION_METERS,

        completeHorizonVerified: false,
    };
}
