import truststore
truststore.inject_into_ssl()
import json
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# --------------------------------------------------
# EXACT OBSERVER LOCATION
# --------------------------------------------------

LATITUDE = -89.7668
LONGITUDE_EAST = 188.13

# Bilinear elevation from our verified NASA Product 78 raster
ALTITUDE_KM = 0.769676263639

# Exact timestamp from the LUNAPATH dashboard
OBSERVATION_TIME = "2026-11-14 08:59:51"

API_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"

TARGETS = {
    "SUN": {
        "command": "10",
        "dashboard": {
            "azimuth": 293.912,
            "elevation": 1.651,
            "angular_diameter": 1941.874,
        },
    },
    "EARTH": {
        "command": "399",
        "dashboard": {
            "azimuth": 170.119,
            "elevation": -4.487,
            "angular_diameter": 6488.922,
        },
    },
}


def query_horizons(name, target):
    params = {
        "format": "json",
        "COMMAND": f"'{target['command']}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": (
            f"'{LONGITUDE_EAST},{LATITUDE},{ALTITUDE_KM}'"
        ),
        "START_TIME": f"'{OBSERVATION_TIME}'",
        "STOP_TIME": "'2026-11-14 09:00:51'",
        "STEP_SIZE": "'1m'",
        "QUANTITIES": "'4,13'",
        "TIME_TYPE": "'UT'",
        "TIME_DIGITS": "'SECONDS'",
        "APPARENT": "'AIRLESS'",
    }

    url = API_URL + "?" + urlencode(params)

    request = Request(
        url,
        headers={
            "User-Agent": "LUNAPATH-independent-verification/1.0"
        },
    )

    with urlopen(request, timeout=60) as response:
        payload = json.loads(response.read().decode("utf-8"))

    if "error" in payload:
        raise RuntimeError(
            f"JPL rejected the {name} query: {payload['error']}"
        )

    result = payload.get("result")

    if not result:
        raise RuntimeError(f"No JPL result received for {name}")

    if "$$SOE" not in result or "$$EOE" not in result:
        raise RuntimeError(
            f"JPL returned no ephemeris table for {name}:\n{result}"
        )

    header, table = result.split("$$SOE", 1)
    table = table.split("$$EOE", 1)[0]

    rows = [
        line.strip()
        for line in table.splitlines()
        if line.strip()
    ]

    if not rows:
        raise RuntimeError(f"No observation rows for {name}")

    print(f"\n{'=' * 65}")
    print(f"{name} — INDEPENDENT NASA/JPL HORIZONS RESULT")
    print("=" * 65)

    print("API source:", payload.get("signature", {}).get("source"))
    print("API version:", payload.get("signature", {}).get("version"))

    print("\nQUERY CONFIGURATION")
    print("-" * 45)

    for line in header.splitlines():
        if any(key in line for key in [
            "Target body name",
            "Center body name",
            "Center-site name",
            "Start time",
            "Stop time",
            "Center geodetic",
            "Atmos refraction",
        ]):
            print(line.strip())

    print("\nRAW EPHEMERIS TABLE")
    print("-" * 45)

    for row in rows:
        print(row)

    print("\nDASHBOARD VALUES FOR COMPARISON")
    print("-" * 45)

    for key, value in target["dashboard"].items():
        print(f"{key}: {value}")

    return rows


def main():
    print("=" * 65)
    print("LUNAPATH — INDEPENDENT JPL EPHEMERIS VERIFICATION")
    print("=" * 65)

    print("Observation time (UT):", OBSERVATION_TIME)
    print("Observer latitude:", LATITUDE)
    print("Observer east longitude:", LONGITUDE_EAST)
    print("Observer altitude (km):", ALTITUDE_KM)
    print("Observer center: coord@301 (Moon)")
    print("Requested quantities: 4,13")

    for index, (name, target) in enumerate(TARGETS.items()):
        if index:
            time.sleep(1)

        query_horizons(name, target)

    print("\n" + "=" * 65)
    print("JPL VERIFICATION QUERIES COMPLETED")
    print("=" * 65)


if __name__ == "__main__":
    main()
