from pathlib import Path
import hashlib

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TIFF = PROJECT_ROOT / "verification" / "Site04_final_adj_5mpp_surf.tif"

TIFF_SIGNATURES = {
    "Classic TIFF (little-endian)": bytes.fromhex("49492A00"),
    "Classic TIFF (big-endian)": bytes.fromhex("4D4D002A"),
    "BigTIFF (little-endian)": bytes.fromhex("49492B00"),
    "BigTIFF (big-endian)": bytes.fromhex("4D4D002B"),
}

def main():
    print("=" * 65)
    print("NASA TIFF FILE DIAGNOSTICS")
    print("=" * 65)

    print("File:", TIFF)

    if not TIFF.exists():
        raise FileNotFoundError(f"File not found: {TIFF}")

    size = TIFF.stat().st_size
    print("File size:", size, "bytes")
    print("File size:", round(size / (1024 * 1024), 3), "MB")

    with TIFF.open("rb") as f:
        header = f.read(4096)

    print("\nFIRST 64 BYTES (HEX)")
    print("-" * 45)
    print(header[:64].hex(" "))

    print("\nFIRST 256 BYTES (TEXT PREVIEW)")
    print("-" * 45)
    print(repr(header[:256].decode("utf-8", errors="replace")))

    print("\nFILE FORMAT SIGNATURE CHECK")
    print("-" * 45)

    for name, signature in TIFF_SIGNATURES.items():
        if header.startswith(signature):
            print("FOUND:", name)
            break
    else:
        print("No standard TIFF signature at byte zero.")

    signatures = {
        "TIFF": [
            b"II*\x00", b"MM\x00*",
            b"II+\x00", b"MM\x00+"
        ],
        "ZIP": [b"PK\x03\x04"],
        "GZIP": [b"\x1f\x8b"],
        "PDF": [b"%PDF-"],
        "HTML": [b"<html", b"<!DOCTYPE"],
        "XML": [b"<?xml"],
        "JSON": [b"{", b"["],
    }

    with TIFF.open("rb") as f:
        scan = f.read(1024 * 1024)

    print("\nSIGNATURE SCAN (FIRST 1 MB)")
    print("-" * 45)

    for name, patterns in signatures.items():
        for pattern in patterns:
            offset = scan.find(pattern)
            if offset >= 0:
                print(f"{name} signature found at byte offset: {offset}")

    print("\nGIT LFS CHECK")
    print("-" * 45)

    if b"git-lfs.github.com/spec/v1" in header:
        print("WARNING: This appears to be a Git LFS pointer, not raster data.")
    else:
        print("No Git LFS pointer detected in the header.")

    print("\nSHA-256 CHECKSUM")
    print("-" * 45)

    digest = hashlib.sha256()

    with TIFF.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)

    print(digest.hexdigest())

    print("\nDIAGNOSTICS FINISHED")
    print("=" * 65)


if __name__ == "__main__":
    main()