
from pathlib import Path
import csv
import math
import numpy as np
import rasterio

# ============================================================
# LUNAPATH — INDEPENDENT PRODUCT 78 TERRAIN-HORIZON VERIFICATION
#
# Independent implementation:
# - Reads the original NASA Product 78 TIFF.
# - Checks the converted elevation.bin against the TIFF.
# - Independently calculates geographic destination coordinates.
# - Independently calculates polar stereographic coordinates.
# - Independently samples the raster using bilinear interpolation.
# - Independently calculates terrain elevation angles.
# - Recalculates all 720 terrain-horizon directions.
#
# This script does not call the Next.js API or TypeScript code.
# ============================================================


# ------------------------------------------------------------
# FILE LOCATIONS
# ------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
VERIFICATION_DIR = PROJECT_ROOT / "verification"

TIFF_PATH = (
    VERIFICATION_DIR /
    "Site04_final_adj_5mpp_surf.tif"
)

BINARY_PATH = (
    VERIFICATION_DIR /
    "elevation.bin"
)

CSV_OUTPUT = (
    VERIFICATION_DIR /
    "horizon-independent-results.csv"
)


# ------------------------------------------------------------
# VERIFIED PRODUCT 78 METADATA
# ------------------------------------------------------------

WIDTH = 3200
HEIGHT = 3200

LUNAR_RADIUS_METERS = 1_737_400.0

PIXEL_WIDTH = 5.0
PIXEL_HEIGHT = -5.0

TIE_COLUMN = 0.0
TIE_ROW = 0.0
TIE_X = -9000.0
TIE_Y = 1000.0

CENTRAL_MERIDIAN_DEGREES = 0.0

EXPECTED_BOUNDS = (
    -9000.0,
    -15000.0,
    7000.0,
    1000.0,
)


# ------------------------------------------------------------
# OBSERVER
# ------------------------------------------------------------

OBSERVER_LATITUDE = -89.7668
OBSERVER_LONGITUDE_EAST = 188.13

# Independently verified observer elevation.
EXPECTED_OBSERVER_ELEVATION = 769.6762636393926


# ------------------------------------------------------------
# HORIZON CALCULATION CONFIGURATION
# ------------------------------------------------------------

DIRECTION_COUNT = 720

SAMPLE_STEP_METERS = 5.0

MAX_DISTANCE_METERS = 15000.0


# ------------------------------------------------------------
# EXPECTED DASHBOARD DIAGNOSTICS
# ------------------------------------------------------------

EXPECTED_TOTAL_SAMPLES = 1_292_419

EXPECTED_BOUNDARY_DIRECTIONS = 720

EXPECTED_NODATA_DIRECTIONS = 0

EXPECTED_SEARCH_LIMIT_DIRECTIONS = 0


# ------------------------------------------------------------
# INDEPENDENT JPL HORIZONS AZIMUTHS
# ------------------------------------------------------------

SUN_AZIMUTH = 293.912303

EARTH_AZIMUTH = 170.118665


# Dashboard terrain-horizon values.
DASHBOARD_SUN_HORIZON = -13.657

DASHBOARD_EARTH_HORIZON = 8.324


# ============================================================
# GENERAL HELPERS
# ============================================================

def radians(degrees):
    return math.radians(degrees)


def degrees(radians_value):
    return math.degrees(radians_value)


def normalize_longitude(longitude):
    return ((longitude % 360.0) + 360.0) % 360.0


def print_section(title):
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


def check_close(actual, expected, tolerance, label):
    difference = abs(actual - expected)

    passed = difference <= tolerance

    print(
        f"{label}: "
        f"{'PASS' if passed else 'FAIL'} | "
        f"actual={actual:.12f} | "
        f"expected={expected:.12f} | "
        f"difference={difference:.12f}"
    )

    return passed


# ============================================================
# GEOGRAPHIC DESTINATION
# ============================================================

def destination_coordinate(
    latitude_degrees,
    longitude_east_degrees,
    bearing_degrees,
    distance_meters,
):
    """
    Independent spherical destination calculation.

    Bearing:
        0   = North
        90  = East
        180 = South
        270 = West
    """

    latitude_1 = radians(latitude_degrees)

    longitude_1 = radians(
        normalize_longitude(longitude_east_degrees)
    )

    bearing = radians(bearing_degrees)

    angular_distance = (
        distance_meters / LUNAR_RADIUS_METERS
    )

    sin_latitude_2 = (
        math.sin(latitude_1) *
        math.cos(angular_distance)
        +
        math.cos(latitude_1) *
        math.sin(angular_distance) *
        math.cos(bearing)
    )

    latitude_2 = math.asin(
        max(-1.0, min(1.0, sin_latitude_2))
    )

    longitude_2 = (
        longitude_1
        +
        math.atan2(
            math.sin(bearing)
            *
            math.sin(angular_distance)
            *
            math.cos(latitude_1),

            math.cos(angular_distance)
            -
            math.sin(latitude_1)
            *
            math.sin(latitude_2),
        )
    )

    return (
        degrees(latitude_2),
        normalize_longitude(degrees(longitude_2)),
    )


# ============================================================
# SOUTH POLAR STEREOGRAPHIC PROJECTION
# ============================================================

def geographic_to_projected(
    latitude_degrees,
    longitude_east_degrees,
):
    """
    Independently calculates South Polar Stereographic
    coordinates using the supplied Product 78 metadata.
    """

    if not -90.0 <= latitude_degrees <= 0.0:
        raise ValueError(
            f"Invalid south-polar latitude: {latitude_degrees}"
        )

    latitude_from_south_pole = radians(
        90.0 + latitude_degrees
    )

    longitude_difference = radians(
        normalize_longitude(longitude_east_degrees)
        -
        normalize_longitude(
            CENTRAL_MERIDIAN_DEGREES
        )
    )

    rho = (
        2.0
        *
        LUNAR_RADIUS_METERS
        *
        math.tan(latitude_from_south_pole / 2.0)
    )

    x = rho * math.sin(longitude_difference)

    y = rho * math.cos(longitude_difference)

    return x, y


# ============================================================
# PROJECTED COORDINATE TO RASTER PIXEL
# ============================================================

def projected_to_pixel(x, y):
    column = (
        TIE_COLUMN
        +
        (x - TIE_X) / PIXEL_WIDTH
        -
        0.5
    )

    row = (
        TIE_ROW
        +
        (y - TIE_Y) / PIXEL_HEIGHT
        -
        0.5
    )

    return column, row


def pixel_inside_raster(column, row):
    return (
        math.isfinite(column)
        and math.isfinite(row)
        and column >= -0.5
        and row >= -0.5
        and column < WIDTH - 0.5
        and row < HEIGHT - 0.5
    )


# ============================================================
# BILINEAR ELEVATION SAMPLING
# ============================================================

def bilinear_sample_many(
    raster,
    columns,
    rows,
):
    """
    Independently implements bilinear interpolation.

    Returns:
        elevations
        valid_mask
    """

    clamped_columns = np.clip(
        columns,
        0,
        WIDTH - 1,
    )

    clamped_rows = np.clip(
        rows,
        0,
        HEIGHT - 1,
    )

    x0 = np.floor(
        clamped_columns
    ).astype(np.int64)

    y0 = np.floor(
        clamped_rows
    ).astype(np.int64)

    x1 = np.minimum(
        x0 + 1,
        WIDTH - 1,
    )

    y1 = np.minimum(
        y0 + 1,
        HEIGHT - 1,
    )

    tx = clamped_columns - x0
    ty = clamped_rows - y0

    a = raster[y0, x0]
    b = raster[y0, x1]
    c = raster[y1, x0]
    d = raster[y1, x1]

    valid = (
        np.isfinite(a)
        &
        np.isfinite(b)
        &
        np.isfinite(c)
        &
        np.isfinite(d)
    )

    result = np.full(
        columns.shape,
        np.nan,
        dtype=np.float64,
    )

    top = a + (b - a) * tx

    bottom = c + (d - c) * tx

    result[valid] = (
        top[valid]
        +
        (bottom[valid] - top[valid]) * ty[valid]
    )

    return result, valid


def bilinear_sample_one(
    raster,
    column,
    row,
):
    values, valid = bilinear_sample_many(
        raster,
        np.array([column], dtype=np.float64),
        np.array([row], dtype=np.float64),
    )

    if not valid[0]:
        raise ValueError(
            "Observer elevation intersects an invalid raster pixel."
        )

    return float(values[0])


# ============================================================
# TERRAIN ELEVATION ANGLE
# ============================================================

def terrain_elevation_angle(
    observer_elevation,
    terrain_elevation,
    distance,
):
    """
    Calculates the terrain elevation angle relative to
    the observer's local horizontal plane.

    Lunar curvature is included.
    """

    observer_radius = (
        LUNAR_RADIUS_METERS
        +
        observer_elevation
    )

    terrain_radius = (
        LUNAR_RADIUS_METERS
        +
        terrain_elevation
    )

    angular_distance = (
        distance / LUNAR_RADIUS_METERS
    )

    vertical = (
        terrain_radius
        *
        math.cos(angular_distance)
        -
        observer_radius
    )

    horizontal = (
        terrain_radius
        *
        math.sin(angular_distance)
    )

    return degrees(
        math.atan2(vertical, horizontal)
    )


# ============================================================
# SAMPLE DISTANCE GENERATION
# ============================================================

def build_sample_distances():
    """
    Mirrors the configured stepping behaviour:

    Start at the sample interval.
    Advance by the interval.
    Include max distance even if it is not an exact multiple.
    """

    if SAMPLE_STEP_METERS <= 0:
        raise ValueError("Sample interval must be positive.")

    if MAX_DISTANCE_METERS <= 0:
        raise ValueError("Maximum distance must be positive.")

    distances = np.arange(
        SAMPLE_STEP_METERS,
        MAX_DISTANCE_METERS + 1e-10,
        SAMPLE_STEP_METERS,
        dtype=np.float64,
    )

    if (
        len(distances) == 0
        or distances[-1] < MAX_DISTANCE_METERS
    ):
        distances = np.append(
            distances,
            MAX_DISTANCE_METERS,
        )

    return distances


# ============================================================
# ONE INDEPENDENT TERRAIN-HORIZON DIRECTION
# ============================================================

def calculate_direction(
    raster,
    observer_elevation,
    azimuth,
    distances,
):
    """
    Calculates one complete terrain ray.

    Stops at:
      - Product 78 raster boundary
      - Product 78 NoData
      - Configured search distance

    Unknown terrain is never treated as clear sky.
    """

    latitude_1 = radians(
        OBSERVER_LATITUDE
    )

    longitude_1 = radians(
        normalize_longitude(
            OBSERVER_LONGITUDE_EAST
        )
    )

    bearing = radians(azimuth)

    angular_distance = (
        distances / LUNAR_RADIUS_METERS
    )

    sin_latitude_2 = (
        math.sin(latitude_1)
        *
        np.cos(angular_distance)
        +
        math.cos(latitude_1)
        *
        np.sin(angular_distance)
        *
        math.cos(bearing)
    )

    latitude_2 = np.arcsin(
        np.clip(
            sin_latitude_2,
            -1.0,
            1.0,
        )
    )

    longitude_2 = (
        longitude_1
        +
        np.arctan2(
            math.sin(bearing)
            *
            np.sin(angular_distance)
            *
            math.cos(latitude_1),

            np.cos(angular_distance)
            -
            math.sin(latitude_1)
            *
            np.sin(latitude_2),
        )
    )

    latitude_degrees = np.degrees(
        latitude_2
    )

    longitude_degrees = np.mod(
        np.degrees(longitude_2),
        360.0,
    )

    latitude_from_south_pole = np.radians(
        90.0 + latitude_degrees
    )

    longitude_difference = np.radians(
        longitude_degrees
        -
        CENTRAL_MERIDIAN_DEGREES
    )

    rho = (
        2.0
        *
        LUNAR_RADIUS_METERS
        *
        np.tan(latitude_from_south_pole / 2.0)
    )

    projected_x = (
        rho * np.sin(longitude_difference)
    )

    projected_y = (
        rho * np.cos(longitude_difference)
    )

    columns = (
        TIE_COLUMN
        +
        (projected_x - TIE_X) / PIXEL_WIDTH
        -
        0.5
    )

    rows = (
        TIE_ROW
        +
        (projected_y - TIE_Y) / PIXEL_HEIGHT
        -
        0.5
    )

    inside = (
        np.isfinite(columns)
        &
        np.isfinite(rows)
        &
        (columns >= -0.5)
        &
        (rows >= -0.5)
        &
        (columns < WIDTH - 0.5)
        &
        (rows < HEIGHT - 0.5)
    )

    outside_indices = np.flatnonzero(
        ~inside
    )

    first_boundary_index = (
        int(outside_indices[0])
        if len(outside_indices)
        else None
    )

    # Only samples inside the raster may be evaluated.
    inside_count = (
        first_boundary_index
        if first_boundary_index is not None
        else len(distances)
    )

    candidate_columns = columns[:inside_count]
    candidate_rows = rows[:inside_count]

    candidate_distances = distances[:inside_count]

    elevations, valid = bilinear_sample_many(
        raster,
        candidate_columns,
        candidate_rows,
    )

    invalid_indices = np.flatnonzero(
        ~valid
    )

    first_nodata_index = (
        int(invalid_indices[0])
        if len(invalid_indices)
        else None
    )

    if first_nodata_index is not None:
        samples_checked = first_nodata_index
        termination = "product78_nodata"

    else:
        samples_checked = inside_count

        if first_boundary_index is not None:
            termination = "product78_boundary"
        else:
            termination = "search_limit"

    if samples_checked > 0:
        sampled_distances = candidate_distances[
            :samples_checked
        ]

        sampled_elevations = elevations[
            :samples_checked
        ]

        angular_distances = (
            sampled_distances / LUNAR_RADIUS_METERS
        )

        observer_radius = (
            LUNAR_RADIUS_METERS
            +
            observer_elevation
        )

        terrain_radii = (
            LUNAR_RADIUS_METERS
            +
            sampled_elevations
        )

        vertical = (
            terrain_radii
            *
            np.cos(angular_distances)
            -
            observer_radius
        )

        horizontal = (
            terrain_radii
            *
            np.sin(angular_distances)
        )

        angles = np.degrees(
            np.arctan2(
                vertical,
                horizontal,
            )
        )

        maximum_index = int(
            np.argmax(angles)
        )

        horizon_angle = float(
            angles[maximum_index]
        )

        horizon_distance = float(
            sampled_distances[maximum_index]
        )

        horizon_elevation = float(
            sampled_elevations[maximum_index]
        )

        last_known_distance = float(
            sampled_distances[-1]
        )

    else:
        horizon_angle = None
        horizon_distance = None
        horizon_elevation = None
        last_known_distance = None

    return {
        "azimuth": azimuth,
        "horizon_angle": horizon_angle,
        "horizon_distance": horizon_distance,
        "horizon_elevation": horizon_elevation,
        "last_known_distance": last_known_distance,
        "samples_checked": samples_checked,
        "product78_samples_checked": samples_checked,
        "termination": termination,
    }


# ============================================================
# OBSERVER VERIFICATION
# ============================================================

def verify_observer(raster):
    print_section(
        "OBSERVER COORDINATE AND ELEVATION VERIFICATION"
    )

    x, y = geographic_to_projected(
        OBSERVER_LATITUDE,
        OBSERVER_LONGITUDE_EAST,
    )

    column, row = projected_to_pixel(
        x,
        y,
    )

    print(
        f"Observer latitude: {OBSERVER_LATITUDE:.8f}"
    )

    print(
        f"Observer east longitude: "
        f"{OBSERVER_LONGITUDE_EAST:.8f}"
    )

    print(
        f"Projected X: {x:.9f} m"
    )

    print(
        f"Projected Y: {y:.9f} m"
    )

    print(
        f"Raster column: {column:.12f}"
    )

    print(
        f"Raster row: {row:.12f}"
    )

    print(
        f"Nearest pixel: "
        f"column={round(column)}, row={round(row)}"
    )

    if not pixel_inside_raster(
        column,
        row,
    ):
        raise ValueError(
            "Observer location is outside Product 78 raster."
        )

    elevation = bilinear_sample_one(
        raster,
        column,
        row,
    )

    print(
        f"\nIndependent observer elevation: "
        f"{elevation:.12f} m"
    )

    check_close(
        elevation,
        EXPECTED_OBSERVER_ELEVATION,
        0.001,
        "Observer elevation",
    )

    return elevation


# ============================================================
# JPL AZIMUTH TO TERRAIN-HORIZON COMPARISON
# ============================================================

def compare_horizon_at_azimuth(
    directions,
    azimuth,
    dashboard_value,
    label,
):
    print_section(
        f"{label} TERRAIN-HORIZON COMPARISON"
    )

    spacing = 360.0 / DIRECTION_COUNT

    normalized_azimuth = azimuth % 360.0

    position = normalized_azimuth / spacing

    lower_index = int(
        math.floor(position)
    ) % DIRECTION_COUNT

    upper_index = (
        lower_index + 1
    ) % DIRECTION_COUNT

    fraction = position - math.floor(position)

    nearest_index = int(
        math.floor(position + 0.5)
    ) % DIRECTION_COUNT

    lower = directions[lower_index]
    upper = directions[upper_index]
    nearest = directions[nearest_index]

    print(
        f"JPL azimuth: {normalized_azimuth:.6f}°"
    )

    print(
        f"Direction spacing: {spacing:.6f}°"
    )

    print(
        f"Lower ray: {lower['azimuth']:.3f}°"
    )

    print(
        f"Upper ray: {upper['azimuth']:.3f}°"
    )

    print(
        f"Nearest ray: {nearest['azimuth']:.3f}°"
    )

    print(
        f"Dashboard horizon: {dashboard_value:.6f}°"
    )

    if nearest["horizon_angle"] is not None:
        nearest_difference = (
            nearest["horizon_angle"]
            -
            dashboard_value
        )

        print(
            f"\nNearest-ray horizon: "
            f"{nearest['horizon_angle']:.9f}°"
        )

        print(
            f"Nearest-ray difference: "
            f"{nearest_difference:+.9f}°"
        )

    else:
        print(
            "\nNearest ray has no known terrain samples."
        )

    if (
        lower["horizon_angle"] is not None
        and upper["horizon_angle"] is not None
    ):
        interpolated = (
            lower["horizon_angle"]
            +
            (
                upper["horizon_angle"]
                -
                lower["horizon_angle"]
            )
            *
            fraction
        )

        difference = (
            interpolated
            -
            dashboard_value
        )

        print(
            f"\nBetween-ray linear interpolation: "
            f"{interpolated:.9f}°"
        )

        print(
            f"Interpolated difference: "
            f"{difference:+.9f}°"
        )

    else:
        print(
            "\nBetween-ray interpolation unavailable "
            "because one adjacent ray has no horizon result."
        )

    print(
        "\nNote: between-ray interpolation is diagnostic only. "
        "The application's exact azimuth lookup method must "
        "be checked separately before treating it as the "
        "dashboard comparison method."
    )


# ============================================================
# CSV EXPORT
# ============================================================

def export_directions(directions):
    fieldnames = [
        "azimuth_degrees",
        "horizon_elevation_degrees",
        "horizon_distance_meters",
        "horizon_terrain_elevation_meters",
        "last_known_sample_distance_meters",
        "samples_checked",
        "product78_samples_checked",
        "termination_reason",
    ]

    with CSV_OUTPUT.open(
        "w",
        newline="",
        encoding="utf-8",
    ) as file:
        writer = csv.DictWriter(
            file,
            fieldnames=fieldnames,
        )

        writer.writeheader()

        for direction in directions:
            writer.writerow({
                "azimuth_degrees":
                    direction["azimuth"],

                "horizon_elevation_degrees":
                    direction["horizon_angle"],

                "horizon_distance_meters":
                    direction["horizon_distance"],

                "horizon_terrain_elevation_meters":
                    direction["horizon_elevation"],

                "last_known_sample_distance_meters":
                    direction["last_known_distance"],

                "samples_checked":
                    direction["samples_checked"],

                "product78_samples_checked":
                    direction["product78_samples_checked"],

                "termination_reason":
                    direction["termination"],
            })

    print(
        f"\nIndependent direction results saved to:\n"
        f"{CSV_OUTPUT}"
    )


# ============================================================
# MAIN
# ============================================================

def main():
    print_section(
        "LUNAPATH — INDEPENDENT PRODUCT 78 TERRAIN VERIFICATION"
    )

    print("Project root:", PROJECT_ROOT)
    print("Original TIFF:", TIFF_PATH)
    print("Converted binary:", BINARY_PATH)

    print("\nCONFIGURATION")
    print("-" * 50)

    print("Raster dimensions:", WIDTH, "x", HEIGHT)
    print("Product resolution:", PIXEL_WIDTH, "m/pixel")
    print("Lunar radius:", LUNAR_RADIUS_METERS, "m")
    print("Observer latitude:", OBSERVER_LATITUDE)
    print("Observer east longitude:", OBSERVER_LONGITUDE_EAST)
    print("Directions:", DIRECTION_COUNT)
    print("Angular spacing:", 360 / DIRECTION_COUNT, "degrees")
    print("Sample interval:", SAMPLE_STEP_METERS, "m")
    print("Maximum distance:", MAX_DISTANCE_METERS, "m")

    if not TIFF_PATH.exists():
        raise FileNotFoundError(
            f"Original NASA TIFF not found: {TIFF_PATH}"
        )

    if not BINARY_PATH.exists():
        raise FileNotFoundError(
            f"Converted elevation binary not found: {BINARY_PATH}"
        )

    # --------------------------------------------------------
    # 1. LOAD ORIGINAL NASA TIFF
    # --------------------------------------------------------

    print_section(
        "1. ORIGINAL NASA PRODUCT 78 TIFF"
    )

    with rasterio.open(TIFF_PATH) as source:
        print("Dimensions:", source.width, source.height)
        print("Bands:", source.count)
        print("Data types:", source.dtypes)
        print("CRS:", source.crs)
        print("Transform:", source.transform)
        print("Bounds:", source.bounds)
        print("Resolution:", source.res)
        print("NoData:", source.nodata)

        if (
            source.width != WIDTH
            or source.height != HEIGHT
            or source.count < 1
        ):
            raise ValueError(
                "Original TIFF dimensions or bands are incorrect."
            )

        transform = source.transform

        transform_checks = [
            (transform.a, 5.0, "Pixel width"),
            (transform.e, -5.0, "Pixel height"),
            (transform.c, -9000.0, "Raster origin X"),
            (transform.f, 1000.0, "Raster origin Y"),
            (transform.b, 0.0, "Transform rotation X"),
            (transform.d, 0.0, "Transform rotation Y"),
        ]

        for actual, expected, label in transform_checks:
            check_close(
                actual,
                expected,
                1e-9,
                label,
            )

        original = source.read(1)

    original = original.astype(
        np.float64,
        copy=False,
    )

    if original.shape != (HEIGHT, WIDTH):
        raise ValueError(
            "Loaded TIFF array shape is incorrect."
        )

    original_valid = np.isfinite(original)

    print(
        "\nOriginal TIFF valid pixels:",
        int(original_valid.sum()),
    )

    print(
        "Original TIFF invalid pixels:",
        int((~original_valid).sum()),
    )

    print(
        "Original TIFF minimum:",
        float(np.nanmin(original)),
    )

    print(
        "Original TIFF maximum:",
        float(np.nanmax(original)),
    )

    # --------------------------------------------------------
    # 2. CHECK CONVERTED BINARY AGAINST ORIGINAL TIFF
    # --------------------------------------------------------

    print_section(
        "2. ORIGINAL TIFF VS CONVERTED ELEVATION.BIN"
    )

    expected_bytes = (
        WIDTH * HEIGHT * 4
    )

    actual_bytes = BINARY_PATH.stat().st_size

    print("Expected binary bytes:", expected_bytes)
    print("Actual binary bytes:", actual_bytes)

    if actual_bytes != expected_bytes:
        raise ValueError(
            "Converted binary size does not match Product 78."
        )

    binary = np.fromfile(
        BINARY_PATH,
        dtype="<f4",
    ).reshape(
        HEIGHT,
        WIDTH,
    )

    binary_valid = np.isfinite(binary)

    if not np.array_equal(
        original_valid,
        binary_valid,
    ):
        raise ValueError(
            "TIFF and binary valid-pixel masks do not match."
        )

    common = original_valid & binary_valid

    differences = np.abs(
        original[common]
        -
        binary[common].astype(np.float64)
    )

    print(
        "Common valid pixels:",
        int(common.sum()),
    )

    print(
        "Maximum absolute difference:",
        float(differences.max()),
    )

    print(
        "Mean absolute difference:",
        float(differences.mean()),
    )

    print(
        "Exactly equal pixels:",
        int(np.count_nonzero(differences == 0)),
    )

    if differences.max() != 0:
        raise ValueError(
            "Original TIFF and converted binary are not identical."
        )

    print(
        "\nPASS: The TIFF and binary contain identical elevation values."
    )

    # --------------------------------------------------------
    # 3. OBSERVER ELEVATION
    # --------------------------------------------------------

    observer_elevation = verify_observer(
        original
    )

    # --------------------------------------------------------
    # 4. GENERATE INDEPENDENT TERRAIN HORIZONS
    # --------------------------------------------------------

    print_section(
        "3. INDEPENDENT 720-DIRECTION TERRAIN CALCULATION"
    )

    distances = build_sample_distances()

    print(
        "Samples available per complete ray:",
        len(distances),
    )

    print(
        "First distance:",
        float(distances[0]),
        "m",
    )

    print(
        "Last distance:",
        float(distances[-1]),
        "m",
    )

    directions = []

    for index in range(DIRECTION_COUNT):
        azimuth = (
            index * 360.0 / DIRECTION_COUNT
        )

        result = calculate_direction(
            original,
            observer_elevation,
            azimuth,
            distances,
        )

        directions.append(result)

        if (index + 1) % 90 == 0:
            print(
                f"Calculated {index + 1}/"
                f"{DIRECTION_COUNT} directions"
            )

    # --------------------------------------------------------
    # 5. AGGREGATE DIAGNOSTICS
    # --------------------------------------------------------

    print_section(
        "4. INDEPENDENT TERRAIN-HORIZON DIAGNOSTICS"
    )

    total_samples = sum(
        item["samples_checked"]
        for item in directions
    )

    product78_samples = sum(
        item["product78_samples_checked"]
        for item in directions
    )

    boundary_count = sum(
        item["termination"] == "product78_boundary"
        for item in directions
    )

    nodata_count = sum(
        item["termination"] == "product78_nodata"
        for item in directions
    )

    search_limit_count = sum(
        item["termination"] == "search_limit"
        for item in directions
    )

    calculated_directions = len(directions)

    print("Calculated directions:", calculated_directions)

    print("Total samples checked:", total_samples)

    print("Product 78 samples checked:", product78_samples)

    print("Raster-boundary terminations:", boundary_count)

    print("NoData terminations:", nodata_count)

    print("Search-limit terminations:", search_limit_count)

    print(
        "All directions have known horizon samples:",
        all(item["horizon_angle"] is not None for item in directions),
    )

    print(
        "Complete lunar horizon verified: NO"
    )

    # --------------------------------------------------------
    # 6. COMPARE WITH DASHBOARD DIAGNOSTICS
    # --------------------------------------------------------

    print_section(
        "5. INDEPENDENT RESULTS VS LUNAPATH DASHBOARD"
    )

    print(
        "Dashboard expected total samples:",
        EXPECTED_TOTAL_SAMPLES,
    )

    print(
        "Independent total samples:",
        total_samples,
    )

    print(
        "Sample-count difference:",
        total_samples - EXPECTED_TOTAL_SAMPLES,
    )

    print(
        "Dashboard expected boundary directions:",
        EXPECTED_BOUNDARY_DIRECTIONS,
    )

    print(
        "Independent boundary directions:",
        boundary_count,
    )

    print(
        "Dashboard expected NoData directions:",
        EXPECTED_NODATA_DIRECTIONS,
    )

    print(
        "Independent NoData directions:",
        nodata_count,
    )

    print(
        "Dashboard expected search-limit directions:",
        EXPECTED_SEARCH_LIMIT_DIRECTIONS,
    )

    print(
        "Independent search-limit directions:",
        search_limit_count,
    )

    print("\nDIAGNOSTIC CHECKS")

    check_close(
        float(calculated_directions),
        float(DIRECTION_COUNT),
        0,
        "Calculated direction count",
    )

    check_close(
        float(total_samples),
        float(EXPECTED_TOTAL_SAMPLES),
        0,
        "Total sample count",
    )

    check_close(
        float(boundary_count),
        float(EXPECTED_BOUNDARY_DIRECTIONS),
        0,
        "Boundary-limited directions",
    )

    check_close(
        float(nodata_count),
        float(EXPECTED_NODATA_DIRECTIONS),
        0,
        "NoData-terminated directions",
    )

    check_close(
        float(search_limit_count),
        float(EXPECTED_SEARCH_LIMIT_DIRECTIONS),
        0,
        "Search-limit directions",
    )

    # --------------------------------------------------------
    # 7. SUN TERRAIN-HORIZON COMPARISON
    # --------------------------------------------------------

    compare_horizon_at_azimuth(
        directions,
        SUN_AZIMUTH,
        DASHBOARD_SUN_HORIZON,
        "SUN",
    )

    # --------------------------------------------------------
    # 8. EARTH TERRAIN-HORIZON COMPARISON
    # --------------------------------------------------------

    compare_horizon_at_azimuth(
        directions,
        EARTH_AZIMUTH,
        DASHBOARD_EARTH_HORIZON,
        "EARTH",
    )

    # --------------------------------------------------------
    # 9. EXPORT ALL 720 DIRECTION RESULTS
    # --------------------------------------------------------

    print_section(
        "6. EXPORTING INDEPENDENT DIRECTION RESULTS"
    )

    export_directions(
        directions
    )

    # --------------------------------------------------------
    # 10. FINAL SUMMARY
    # --------------------------------------------------------

    print_section(
        "INDEPENDENT VERIFICATION FINISHED"
    )

    print("Elevation source: Original NASA LOLA Product 78 TIFF")

    print("Converted binary: Independently checked against TIFF")

    print("Horizon implementation: Independent Python calculation")

    print("Directions calculated:", calculated_directions)

    print("Total samples:", total_samples)

    print("Boundary-limited directions:", boundary_count)

    print("NoData directions:", nodata_count)

    print("Search-limit directions:", search_limit_count)

    print(
        "\nIMPORTANT: This calculation verifies only "
        "the sampled Product 78 raster coverage."
    )

    print(
        "It does not establish complete lunar-horizon coverage."
    )


if __name__ == "__main__":
    main()
