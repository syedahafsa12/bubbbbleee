# Lunex API reference

The API is implemented with Next.js App Router route handlers. JSON routes return `application/json` unless noted otherwise. These handlers use Node.js filesystem APIs to read local terrain assets and outbound HTTPS requests to NASA/JPL services.

Set the deployed or local origin:

```bash
BASE_URL=http://localhost:3000
```

## Endpoint index

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/product78/sites` | Site catalogue and local elevation/science asset readiness |
| GET | `/api/horizons` | One-day Sun/Earth ephemerides and Product78 terrain screening for a registered site's reference observer |
| GET | `/api/horizons/selected-location` | Time-series analysis for a selected site coordinate |
| GET | `/api/horizons/mission-analysis` | Single observation, full-day joint visibility, or automatic visibility-cycle analysis |
| GET | `/api/product78/terrain-preview` | Downsampled Float32 elevation preview; metadata is returned in response headers |
| GET | `/api/product78/science-sample` | Read one pixel from the Product78 ancillary science rasters |
| GET | `/api/lunar-imagery/nac-south-pole` | Proxy a selected-location LROC NAC PNG image |
| POST | `/terrain-selection` | Validate a selected lunar coordinate and sample local elevation |
| GET | `/api/test/multi-resolution` | Developer diagnostic for terrain fallback behavior |
| GET | `/api/test/product90` | Developer diagnostic for Product90 raster/tile access |
| GET | `/api/test/terrain-overlap` | Developer comparison of Product78 and Product90 samples |

The `/api/test/*` routes are diagnostics, not stable public product APIs. Remove, restrict, or protect them before a public production launch if they are not needed.

---

## 1. `GET /api/product78/sites`

Returns the 27 registered Product78 candidate entries and independently inspects local elevation and science-layer assets.

**Parameters:** none.

**Example**

```bash
curl "$BASE_URL/api/product78/sites"
```

**Response shape (abbreviated)**

```json
{
  "success": true,
  "source": "NASA PGDA Product 78 catalogue",
  "totalSites": 27,
  "readySites": 3,
  "scienceReadySites": 0,
  "sites": [
    {
      "id": "site04_shackleton_rim",
      "archiveSite": "Site04",
      "name": "Shackleton Rim",
      "assetStatus": "ready",
      "scienceLayersStatus": "not_prepared"
    }
  ],
  "notes": []
}
```

Counts shown above represent the repository snapshot reviewed while preparing these docs, not a permanent value. Read the live endpoint for current state.

Elevation status includes values such as `ready`, `not_prepared`, `invalid_metadata`, and `invalid_binary_size`. Science-layer status is independent and may be `ready`, `not_prepared`, `invalid`, or `blocked`.

The endpoint checks metadata and file size. It does not independently inspect every numeric sample.

---

## 2. `GET /api/horizons`

Requests one UTC day of Sun and Earth ephemerides from the registered reference observer and assesses them against the local Product78 terrain horizon.

| Parameter | Required | Default | Meaning |
|---|---|---|---|
| `date` | No | Current UTC date | Date in `YYYY-MM-DD` format |
| `siteId` | No | `site04_shackleton_rim` | Registered Product78 site id |

**Example**

```bash
curl "$BASE_URL/api/horizons?date=2026-11-15&siteId=site04_shackleton_rim"
```

**Calculation contract**

- Sun target id: `10`; Earth target id: `399`.
- Moon observer centre: `coord@301`.
- Airless apparent azimuth/elevation and angular diameter.
- 10-minute sample interval; 145 samples per target are expected for a complete 24-hour series.
- Product78 local terrain is the standard horizon source. The route explicitly disables Product90.
- The terrain configuration uses 1,440 azimuth directions, 5 m radial samples, and a 15 km configured search distance.

The response includes site and observer data, coordinate/time conventions, source information, target observations, terrain profile/model, explicit interpretation notes, per-target errors, and visibility windows. A failed target is not silently substituted with an assumed result.

**Errors:** invalid date/site parameters return HTTP 400. If both Horizons target requests fail, the route returns HTTP 502.

---

## 3. `GET /api/horizons/selected-location`

Requests Sun/Earth observations and a local terrain horizon for a selected location.

| Parameter | Required | Default | Meaning |
|---|---|---|---|
| `siteId` | No | `site04_shackleton_rim` | Registered Product78 site |
| `date` | Yes | — | UTC date: `YYYY-MM-DD` |
| `time` | Yes | — | UTC time: `HH:mm` or `HH:mm:ss` |
| `durationHours` | No | `24` | One of 6, 12, 24, 48, or 72 |
| `lat` | No | Registered reference latitude | Selected lunar latitude |
| `lon` | No | Registered reference longitude | East-positive lunar longitude |
| `pixelColumn` | No | — | Optional raster column, paired with `pixelRow` |
| `pixelRow` | No | — | Optional raster row, paired with `pixelColumn` |
| `includeProduct90` | No | `false` | Opt into the optional regional terrain enhancement |

**Example**

```bash
curl "$BASE_URL/api/horizons/selected-location?siteId=site04_shackleton_rim&date=2026-11-15&time=12:00&durationHours=24&lat=-89.7668&lon=188.13"
```

If the caller supplies pixel coordinates, the API verifies that they agree with the selected geographic coordinate within 1.5 pixels. The response includes the sampled observer altitude, selected pixel, terrain profile, available Sun/Earth observations, status/errors, and explicit interpretation text.

A partial response is possible if one target or the local terrain calculation is unavailable. `completeHorizonVerified` remains false because the available raster does not establish a complete global horizon.

---

## 4. `GET /api/horizons/mission-analysis`

Advanced analysis at a selected point. Both `lat` and `lon` are required. Latitude must be in the southern range from -90° to 0°. Optional `pixelColumn` and `pixelRow` must be supplied together and must agree with the selected coordinate within 1.5 pixels.

**Common parameters**

| Parameter | Required | Meaning |
|---|---|---|
| `mode` | No | `observation` (default), `joint-visibility-day`, or `visibility-cycle` |
| `siteId` | No | Registered candidate, default Site04 |
| `lat` | Yes | Selected lunar latitude |
| `lon` | Yes | East-positive longitude |
| `pixelColumn`, `pixelRow` | No | Optional paired raster-pixel confirmation |

### Mode: `observation`

Accepts an ISO UTC date-time through `startDateTime`, `startDatetime`, `missionStart`, `missionStartTime`, `datetime`, or `start`; alternatively pass date and time values.

```bash
curl "$BASE_URL/api/horizons/mission-analysis?mode=observation&siteId=site04_shackleton_rim&lat=-89.7668&lon=188.13&startDateTime=2026-11-15T12:00:00Z"
```

The response contains the selected observer, terrain model, Sun observation, Earth observation, joint assessment, and source metadata. The route obtains 1-minute ephemeris samples and matches Sun/Earth epochs within 1.5 seconds.

### Mode: `joint-visibility-day`

Pass a UTC date using `date` or `startDate`.

```bash
curl "$BASE_URL/api/horizons/mission-analysis?mode=joint-visibility-day&siteId=site04_shackleton_rim&lat=-89.7668&lon=188.13&date=2026-11-15"
```

The route calculates sampled Sun/Earth joint visibility over the UTC day.

### Mode: `visibility-cycle`

Pass the start date/time and an emission duration using one of `durationHours`, `emissionDurationHours`, `missionDurationHours`, `emissionDuration`, `duration`, or `hours`. Duration accepts hours, days, or minutes; it must be greater than zero and no more than 168 hours.

```bash
curl "$BASE_URL/api/horizons/mission-analysis?mode=visibility-cycle&siteId=site04_shackleton_rim&lat=-89.7668&lon=188.13&date=2026-11-15&time=12:00&durationHours=24"
```

The response includes analysis, candidate availability, and automatic-selection metadata. It is a sampled geometric planner, not a radio communications link-budget optimizer.

**Failure response:** structured JSON with `success: false`; the outer route error handler uses HTTP 503.

---

## 5. `GET /api/product78/terrain-preview`

Returns a compact, 8× downsampled Float32 binary preview for a prepared Product78 raster.

| Parameter | Required | Default |
|---|---|---|
| `siteId` | No | `site04_shackleton_rim` |

**Example**

```bash
curl -D terrain-preview.headers \
  "$BASE_URL/api/product78/terrain-preview?siteId=site04_shackleton_rim" \
  --output terrain-preview.bin
```

Success returns `application/octet-stream`. URL-encoded JSON metadata is carried in `X-LunaPath-Terrain-Metadata`; the preview marker and downsample factor are returned in `X-LunaPath-Terrain-Preview` and `X-LunaPath-Terrain-Downsample-Factor`.

This reduced raster is for faster visualization. The original Product78 raster remains the basis for scientific sampling.

---

## 6. `GET /api/product78/science-sample`

Reads one pixel from the Product78 elevation and ancillary science rasters.

| Parameter | Required | Default |
|---|---|---|
| `siteId` | No | `site04_shackleton_rim` |
| `col` | Yes | — |
| `row` | Yes | — |

```bash
curl "$BASE_URL/api/product78/science-sample?siteId=site04_shackleton_rim&col=1200&row=1500"
```

When available, the response contains elevation (m), elevation uncertainty (m), slope (degrees), slope uncertainty (degrees), and observation count. If the science metadata is absent, the route may return `success: true, available: false`. If metadata is present but required layer files are missing or invalid, it returns a structured error.

The reviewed repository snapshot had the science metadata but not all four required science binary files. Treat this endpoint as not deployment-verified until those files are included and tested.

---

## 7. `GET /api/lunar-imagery/nac-south-pole`

Proxies the LROC controlled South Pole NAC average mosaic around the selected map pixel.

Required parameters: `lat`, `lon`, `col`, and `row`. `siteId` defaults to Site04. Latitude must be between -90° and -84°; longitude must be east-positive in `[0, 360)`. The coordinate and pixel must agree within 1.5 pixels.

```bash
curl "$BASE_URL/api/lunar-imagery/nac-south-pole?siteId=site04_shackleton_rim&lat=-89.7668&lon=188.13&col=1600&row=1600" \
  --output nac-context.png
```

Success returns `image/png` and source/layer/projection headers. The route requests a 2,048 × 2,048 image for a 24 km × 24 km extent and rejects an empty or oversized response. Error responses are JSON.

The image is a visual texture only, not terrain height, calibrated albedo, or live illumination.

---

## 8. `POST /terrain-selection`

Samples a coordinate from Product78 and the configured multi-resolution terrain sampler.

**JSON body**

```json
{
  "latitudeDeg": -89.7668,
  "longitudeEastDeg": 188.13
}
```

**Example**

```bash
curl -X POST "$BASE_URL/terrain-selection" \
  -H "Content-Type: application/json" \
  -d '{"latitudeDeg":-89.7668,"longitudeEastDeg":188.13}'
```

The response provides the coordinate, projected location, sampled elevation, source, resolution, and a list of limitations. Unsupported terrain samples return `supported: false` (HTTP 422). Invalid JSON or coordinates return HTTP 400.

An elevation sample does not establish landing safety or calculate terrain visibility.

---

## Diagnostic endpoints

- `GET /api/test/multi-resolution`
- `GET /api/test/product90`
- `GET /api/test/terrain-overlap`

These routes are useful during development but should not automatically be treated as public product endpoints. Review whether to remove, protect, or restrict them for production.

## API-wide conventions

- Angular values are degrees unless explicitly labelled arcseconds.
- Candidate longitudes are east-positive and normalized internally.
- The API retains unknown/partial status rather than coercing missing data into zero or “visible”.
- Horizons and imagery depend on external network services and can be affected by upstream outages, throttling, or format changes.
- Current browser code uses relative `/api/...` requests. Keep the app and API on one origin or configure a proxy/rewrite; see the [developer guide](developer-guide.md#deployment).
