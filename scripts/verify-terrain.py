
from pathlib import Path
import numpy as np
import rasterio

# Project root / verification folder
PROJECT_ROOT = Path(__file__).resolve().parent.parent
BASE = PROJECT_ROOT / "verification"

TIFF = BASE / "Site04_final_adj_5mpp_surf.tif"
BINARY = BASE / "elevation.bin"

WIDTH = 3200
HEIGHT = 3200


def report(label, array):
    valid = np.isfinite(array)
    values = array[valid]

    print(f"\n{label}")
    print("-" * 45)
    print("Shape:", array.shape)
    print("Valid pixels:", int(valid.sum()))
    print("Invalid pixels:", int((~valid).sum()))

    if values.size:
        print("Minimum:", float(values.min()))
        print("Maximum:", float(values.max()))
        print("Mean:", float(values.mean()))


def main():
    print("NASA PRODUCT 78 TERRAIN VERIFICATION")
    print("=" * 55)
    print("Project root:", PROJECT_ROOT)
    print("Verification folder:", BASE)

    if not TIFF.exists():
        raise FileNotFoundError(f"Missing TIFF: {TIFF}")

    if not BINARY.exists():
        raise FileNotFoundError(f"Missing binary: {BINARY}")

    expected_size = WIDTH * HEIGHT * 4
    actual_size = BINARY.stat().st_size

    print("\nBinary size:", actual_size)
    print("Expected size:", expected_size)

    if actual_size != expected_size:
        raise ValueError(
            f"Binary size mismatch: expected {expected_size}, "
            f"got {actual_size}"
        )

    binary = np.fromfile(
        BINARY, dtype="<f4"
    ).reshape(HEIGHT, WIDTH)

    with rasterio.open(TIFF) as src:
        print("\nORIGINAL NASA TIFF METADATA")
        print("-" * 45)
        print("Dimensions:", src.width, src.height)
        print("Bands:", src.count)
        print("Data type:", src.dtypes)
        print("CRS:", src.crs)
        print("Transform:", src.transform)
        print("NoData:", src.nodata)
        print("Bounds:", src.bounds)
        print("Resolution:", src.res)

        if src.width != WIDTH or src.height != HEIGHT:
            raise ValueError(
                "TIFF dimensions do not match expected 3200x3200."
            )

        if src.count < 1:
            raise ValueError("TIFF contains no raster bands.")

        original = src.read(1).astype(np.float64)
        nodata = src.nodata

        original_valid = np.isfinite(original)

        if nodata is not None:
            if np.isnan(nodata):
                original_valid &= ~np.isnan(original)
            else:
                original_valid &= original != nodata

    binary_valid = np.isfinite(binary)

    report("NASA TIFF", original)
    report("CONVERTED BINARY", binary)

    common = original_valid & binary_valid

    if not common.any():
        raise ValueError("No common valid pixels found.")

    differences = np.abs(
        original[common] - binary[common].astype(np.float64)
    )

    print("\nPIXEL-BY-PIXEL COMPARISON")
    print("=" * 55)
    print("Common valid pixels:", int(common.sum()))
    print(
        "TIFF valid / binary invalid:",
        int((original_valid & ~binary_valid).sum())
    )
    print(
        "Binary valid / TIFF invalid:",
        int((binary_valid & ~original_valid).sum())
    )
    print("Maximum absolute difference:", float(differences.max()))
    print("Mean absolute difference:", float(differences.mean()))
    print("Pixels exactly equal:", int((differences == 0).sum()))
    print("Pixels within 0.001m:", int((differences <= 0.001).sum()))
    print("Pixels within 0.01m:", int((differences <= 0.01).sum()))

    print("\nSAMPLE PIXEL COMPARISON")
    print("-" * 45)

    for row, col in [
        (0, 0),
        (0, 3199),
        (3199, 0),
        (3199, 3199),
        (1599, 1599),
        (1600, 1599),
        (1000, 1000),
        (2500, 2500),
    ]:
        print(
            f"Row {row}, Col {col}: "
            f"TIFF={original[row, col]:.6f}, "
            f"BIN={binary[row, col]:.6f}"
        )

    print("\nVERIFICATION COMPLETE")


if __name__ == "__main__":
    main()
