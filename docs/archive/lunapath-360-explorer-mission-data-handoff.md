# LunaPath 360 Explorer — Mission Data handoff

Date: 2026-11-15  
Branch: `work/lunapath-mission-analysis-v1`

## Product boundary

The 360 Explorer is the visual, spatial experience. It should prioritize the lunar surface and camera interaction. Do not reintroduce verbose data cards, explanatory paragraphs, source qualifications, tables, or diagnostic panels into the immersive scene.

The Mission Data page is the separate text-first/scientist-facing destination for numerical values, source details, explanations, links, caveats, and diagnostics.

## What remains visible in the 360 Explorer

- The lunar 3D surface and imagery.
- The compact N/E/S/W orientation compass.
- The mission-time slider with only its selected UTC timestamp.
- A small icon-only retry control when the JPL request fails.
- A small icon-only back-to-planner control.

These are controls or orientation context, not explanatory information cards. Keep them visually quiet.

## What was removed from the immersive interface

- JPL request status and endpoint/source panels.
- Terrain/imagery status, resolution, and qualification paragraphs.
- Sun/Earth azimuth, elevation, angular-size, and visibility explanation cards.
- Terrain-horizon readouts, skyline chart, sampled-distance and coverage caveats.
- Verbose timeline instructions and mission-window explanation.
- Product78 selected-pixel science values and uncertainty details.
- Long error messages and diagnostic text boxes.

The original JSX for these diagnostics is retained in `docs/archive/lunapath-explorer-diagnostics.jsx.txt`. Treat it as a migration reference, not code to paste blindly: its local variables and state may need to be wired to the final Mission Data page's data model.

## Celestial size fields to expose on Mission Data

The exact-observer endpoint `/api/horizons/selected-location` now returns per-observation size-verification fields:

- `angularDiameterArcsec`: selected apparent angular diameter used by the renderer.
- `jplAngularDiameterArcsec`: angular diameter returned by JPL Horizons quantity 13.
- `observerRangeKm`: apparent observer-to-target range returned by JPL Horizons quantity 20.
- `rangeDerivedAngularDiameterArcsec`: independently calculated apparent angular diameter from the body equatorial diameter and observer range.
- `angularDiameterCrossCheckPercent`: percentage difference between the JPL and range-derived values.
- `angularDiameterSource`: `jpl-range-verified`, `range-derived`, `jpl-only`, or `unavailable`.

The API requests quantities 4, 13, and 20 for both the Sun (target 10) and Earth (target 399). The range-derived calculation uses the full-angle geometry:

`angular diameter = 2 × atan((physical diameter / 2) / observer range)`

Convert the result from radians to arcseconds. Prefer the JPL angular diameter when it agrees with the independent range calculation within 2%; otherwise use the valid range-derived result while retaining both values and the cross-check status for the scientist.

Do not surface these implementation details as cards in the 360 scene. Place them in the Mission Data page with the relevant source references and units.

## Timeline interpretation to explain on Mission Data

The Explorer timeline selects actual JPL UTC samples in the configured mission window (6, 12, 24, 48, or 72 hours, sampled every 10 minutes). It is not a full lunar-day animation.

A lunar solar day is about 29.53 Earth days. Over a 6-hour mission window, the Sun's apparent movement can therefore be small. The Earth generally remains in nearly the same region of the lunar sky because the Moon is tidally locked, with some apparent movement from libration. Surface terrain can also obstruct either body.

The camera/compass direction and mission timestamp are separate: rotating the camera must not change the selected UTC time or JPL ephemerides.

## Data and behavior preservation requirements

- Keep the NASA/JPL Horizons API calls and response fields.
- Keep per-sample Sun/Earth observations and shared UTC sample selection.
- Keep angular-diameter and distance verification.
- Keep LOLA terrain loading/mesh generation, LROC imagery, science sampling, and terrain-horizon calculations.
- Keep the timeline, compass, retry, and planner navigation controls.
- Keep partial/unknown horizon coverage explicit in Mission Data. Never imply globally complete horizon visibility.
- When the brother's Mission Data implementation is brought into this branch, reconcile its current page/data types before migrating the archived JSX. Do not overwrite the newer page wholesale or reintroduce diagnostics to the 360 Explorer.

## Files

- Immersive UI: `src/components/canvas/Lunar360Explorer.tsx`
- Existing archived diagnostics JSX: `docs/archive/lunapath-explorer-diagnostics.jsx.txt`
- Current Mission Data page on this branch (integration target; reconcile with incoming version): `src/app/mission-data/page.tsx`
- Exact-observer JPL API: `src/app/api/horizons/selected-location/route.ts`
