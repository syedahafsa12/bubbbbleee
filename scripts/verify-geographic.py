
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer

# --------------------------------------------------
# FILES
# --------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "verification"

TIFF = DATA_DIR / "Site04_final_adj_5mpp_surf.tif"
BINARY = DATA_DIR / "elevation.bin"

# --------------------------------------------------
# SHACKLETON RIM OBSERVER COORDINATES
# --------------------------------------------------

LATITUDE = -89.7668
LONGITUDE_EAST = 188.13

# Values previously displayed by your dashboard
DASHBOARD_COL = 1599.493
DASHBOARD_ROW = 1599.569
DASHBOARD_ELEVATION = 769.676

WIDTH = 3200
HEIGHT = 3200


def bilinear_sample(array, col, row):
    """Interpolate elevation using pixel-centre coordinates."""

    if not (0 <= col < array.shape[1] - 1):
        raise ValueError(f"Column outside interpolation range: {col}")

    if not (0 <= row < array.shape[0] - 1):
        raise ValueError(f"Row outside interpolation range: {row}")

    col0 = int(np.floor(col))
    row0 = int(np.floor(row))

    col1 = col0 + 1
    row1 = row0 + 1

    dx = col - col0
    dy = row - row0

    q00 = float(array[row0, col0])
    q10 = float(array[row0, col1])
    q01 = float(array[row1, col0])
    q11 = float(array[row1, col1])

    values = [q00, q10, q01, q11]

    if not all(np.isfinite(v) for v in values):
        raise ValueError("Invalid elevation encountered during interpolation.")

    top = q00 * (1 - dx) + q10 * dx
    bottom = q01 * (1 - dx) + q11 * dx

    return top * (1 - dy) + bottom * dy


def main():
    print("=" * 65)
    print("SHACKLETON RIM GEOGRAPHIC COORDINATE VERIFICATION")
    print("=" * 65)

    if not TIFF.exists():
        raise FileNotFoundError(TIFF)

    if not BINARY.exists():
        raise FileNotFoundError(BINARY)

    binary = np.fromfile(BINARY, dtype="<f4")

    if binary.size != WIDTH * HEIGHT:
        raise ValueError(
            f"Unexpected binary pixel count: {binary.size}"
        )

    terrain = binary.reshape(HEIGHT, WIDTH)

    with rasterio.open(TIFF) as src:
        print("\n1. NASA RASTER INFORMATION")
        print("-" * 45)

        print("CRS:", src.crs)
        print("Dimensions:", src.width, src.height)
        print("Transform:", src.transform)
        print("Bounds:", src.bounds)

        if src.width != WIDTH or src.height != HEIGHT:
            raise ValueError("Unexpected NASA raster dimensions.")

        geographic_crs = src.crs.geodetic_crs

        print("\n2. INPUT COORDINATES")
        print("-" * 45)

        print("Latitude:", LATITUDE)
        print("East longitude:", LONGITUDE_EAST)

        # Transform lunar geographic coordinates into
        # the projected coordinate system of the NASA raster.
        transformer = Transformer.from_crs(
            geographic_crs,
            src.crs,
            always_xy=True
        )

        x, y = transformer.transform(
            LONGITUDE_EAST,
            LATITUDE
        )

        print("\n3. PROJECTED COORDINATES")
        print("-" * 45)

        print("Projected X:", x)
        print("Projected Y:", y)

        # Inverse affine gives coordinates measured from
        # the upper-left outer corner of the raster.
        col_corner, row_corner = (
            ~src.transform
        ) * (x, y)

        # Raster array indices refer to pixel centres.
        col_center = col_corner - 0.5
        row_center = row_corner - 0.5

        print("\n4. PIXEL COORDINATES")
        print("-" * 45)

        print("Pixel column from raster corner:", col_corner)
        print("Pixel row from raster corner:", row_corner)

        print("Pixel column at pixel centres:", col_center)
        print("Pixel row at pixel centres:", row_center)

        print("\n5. DASHBOARD COORDINATE COMPARISON")
        print("-" * 45)

        print("Dashboard column:", DASHBOARD_COL)
        print("Calculated column:", col_center)
        print("Column difference:", col_center - DASHBOARD_COL)

        print("Dashboard row:", DASHBOARD_ROW)
        print("Calculated row:", row_center)
        print("Row difference:", row_center - DASHBOARD_ROW)

        if not (
            0 <= col_center < WIDTH - 1
            and 0 <= row_center < HEIGHT - 1
        ):
            raise ValueError(
                "Observer coordinates fall outside the raster."
            )

        nearest_col = int(np.floor(col_center + 0.5))
        nearest_row = int(np.floor(row_center + 0.5))

        nearest_elevation = float(
            terrain[nearest_row, nearest_col]
        )

        calculated_elevation = bilinear_sample(
            terrain,
            col_center,
            row_center
        )

        dashboard_interpolated_elevation = bilinear_sample(
            terrain,
            DASHBOARD_COL,
            DASHBOARD_ROW
        )

        print("\n6. ELEVATION VERIFICATION")
        print("-" * 45)

        print("Nearest pixel column:", nearest_col)
        print("Nearest pixel row:", nearest_row)
        print("Nearest pixel elevation:", nearest_elevation)

        print(
            "Calculated bilinear elevation:",
            calculated_elevation
        )

        print(
            "Dashboard-reported elevation:",
            DASHBOARD_ELEVATION
        )

        print(
            "Dashboard elevation difference:",
            calculated_elevation - DASHBOARD_ELEVATION
        )

        print(
            "Elevation interpolated at dashboard pixel:",
            dashboard_interpolated_elevation
        )

        print("\n7. SURROUNDING PIXELS")
        print("-" * 45)

        col0 = int(np.floor(col_center))
        row0 = int(np.floor(row_center))

        for r in range(row0, row0 + 2):
            for c in range(col0, col0 + 2):
                print(
                    f"Row {r}, Col {c}: "
                    f"{float(terrain[r, c]):.6f} m"
                )

        print("\nGEOGRAPHIC VERIFICATION FINISHED")
        print("=" * 65)


if __name__ == "__main__":
    main()
