# Testing and validation

## Existing checks

The reviewed package exposes these scripts:

- `npm run lint`
- `npm run build`
- `npm run test:integration`
- `npm run test:explorer`
- `npx tsc --noEmit --pretty false` (direct TypeScript check)

The existing integration scripts are live-service verifiers, not isolated unit tests. They make HTTP requests to the running app and, through the application, to external NASA/JPL services.

## Project-team reported results

The project team reported the following checks as passing on 15 November 2026:

| Check | Reported status | Verification note |
|---|---|---|
| `npm run lint` | Passed | Reported by the project team; not re-run while preparing this documentation folder |
| `npm run build` | Passed | Reported by the project team; not re-run while preparing this documentation folder |
| `npm run test:integration` | Passed | Reported by the project team; the check depends on a running app and live upstream service |

These are clearly labelled as **team-reported**, not independent CI results from this documentation task. Re-run the checks against the exact final commit and deployed environment before submission.

The project team did not report a completed `npm run test:explorer` result in the information available for this pack. The reviewed repository snapshot had science metadata but not the four Site04 ancillary science binary files required for a fully available sample response.

## What the existing integration verifier checks

The existing `verify-lunapath-integration.mjs` script checks the daily Horizons/Product78 integration, including response shape, time samples, target angles, horizon coverage flags, and the explicit incomplete-horizon contract. It is controlled by `LUNAPATH_BASE_URL`, defaulting to `http://localhost:3000`.

The explorer verifier checks a larger flow involving:
- Product78 metadata and coordinate-to-pixel mapping.
- Selected-observer Horizons results.
- Expected 10-minute sampling and Sun/Earth timeline consistency.
- Angular diameter checks against observer range.
- A 360-bearing sampled horizon profile and explicit unknown coverage.
- Site science sample values.
- Compact terrain preview dimensions, resolution, metadata, and binary length.
- Optional LROC image retrieval and PNG/source headers.

The explorer verifier treats imagery as optional, but the required science sample and terrain checks need their underlying assets and API to be available.

## Validation plan for the final release

Run these checks locally and in the deployed environment:

1. TypeScript check.
2. ESLint.
3. Production build.
4. Product78 site readiness API.
5. Terrain preview binary/header check.
6. Selected-coordinate projection and pixel-agreement check.
7. Horizons single-day API check for Sun and Earth.
8. Mission-analysis checks for single observation, joint day, and visibility cycle.
9. Science-sample check only after all four science binaries are deployed.
10. Optional LROC proxy check and LOLA-only fallback check.
11. Browser walkthrough on desktop and mobile.
12. Smoke test against the public deployment origin.

## Recommended additional automated tests

The current scripts cover important live integrations, but a stronger scientific application should also have deterministic tests that do not rely on network services:

- Coordinate conversion round trips and east-positive longitude normalization.
- Pixel registration and boundary calculations.
- Float32 little-endian binary decoding and expected byte-length checks.
- NoData behavior and raster-edge termination.
- Terrain-horizon sampling for known synthetic DEMs.
- Angular-diameter/limb-clearance classifications.
- Sun/Earth epoch matching and rejection outside the configured tolerance.
- Visibility-window splitting on missing samples.
- Invalid/missing query parameter handling for every route.
- Product90 failure isolation from the Product78 baseline.

Use tiny synthetic rasters and mocked Horizons responses for unit tests. Keep live NASA checks as a separate integration layer so upstream outages do not make every pull request flaky.

## CI template included in this pack

The `ci/lunex-ci.yml` template runs the static quality gates automatically on pushes and pull requests. It provides a manual live integration job for the existing Horizons integration script. It must be copied into the repository's root `.github/workflows/` directory before GitHub Actions will discover it.
