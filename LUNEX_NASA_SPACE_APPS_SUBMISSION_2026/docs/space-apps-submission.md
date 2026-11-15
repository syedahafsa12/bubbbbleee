# Lunex — Space Apps project narrative

## Project title

**Lunex — A Lunar South-Pole Landing-Site Navigator**

**Challenge:** NASA Space Apps Challenge 2026 — Lunar Landing Site Navigator

## Project summary

Lunex is an interactive decision-support prototype that helps users examine candidate landing locations near the Moon's south pole through the combination of local topography and time-dependent celestial geometry. It uses NASA LOLA Product78 elevation data to sample a selected point and its surrounding terrain, then queries NASA/JPL Horizons for the apparent positions of the Sun and Earth as seen by an observer on the lunar surface.

Instead of treating a site as a single marker on a global map, Lunex lets a user select a position inside an available high-resolution terrain raster, inspect the local landscape, and examine when the Sun or Earth is above or obstructed by the sampled terrain horizon. NASA Moon Trek imagery provides regional map context, while an optional LROC NAC mosaic provides additional visual texture.

## Why it matters

A candidate location's practical value depends on more than its name or regional coordinates. Local ridges can affect the apparent horizon, and the apparent position of the Sun and Earth changes with time. Lunex puts local terrain selection and time-based geometric screening into one workflow to help users investigate those conditions.

## Technical approach

1. Select a registered south-polar candidate region.
2. Select a point inside the available Product78 terrain map.
3. Transform the selected coordinate into the local raster and sample observer elevation.
4. Request Sun/Earth observer ephemerides from NASA/JPL Horizons.
5. Sample terrain along azimuth directions around the selected point.
6. Compare target direction/angular size with the terrain profile and build sampled time windows.
7. Preserve missing/unknown terrain and incomplete coverage in the API/UI.

## Data sources

- NASA LOLA Product78: primary local elevation source.
- NASA/JPL Horizons: apparent Sun/Earth observer ephemerides.
- NASA Moon Trek / LRO WAC: regional mapping context.
- LROC controlled South Pole NAC average mosaic via Lunaserv: optional visual texture.
- NASA LOLA Product90: optional regional terrain enhancement, not the default Product78 path.

## What makes the method careful

Lunex keeps data provenance and uncertainty visible. It does not convert an unavailable terrain direction to zero, does not claim that a partial raster proves a complete lunar horizon, and does not describe sampled timestamps as exact crossing times.

## Current limitations

Lunex is not a certified landing safety system. It does not yet provide:
- Full-global lunar horizon verification.
- Complete two-dimensional celestial disk/terrain occultation.
- Solar array power, thermal, or energy-storage simulation.
- RF link budget, antenna pointing, or communications data-rate guarantees.
- A comprehensive hazard/slope safety certification for a landing ellipse.

The Product78 rasters in the reviewed repository snapshot covered three prepared candidate sites. The site registry includes more candidates than were locally prepared. The Site04 science metadata described ancillary layers, but their four binary files still needed to be included and verified.

## Suggested judge-facing one-liner

**Lunex connects a real lunar landing-position selection to NASA topography and JPL Sun/Earth ephemerides, while keeping unknown terrain coverage explicit instead of presenting unsupported visibility claims.**

## Final details to complete

- Production URL: **Pending backend deployment and smoke test**
- Walkthrough/demo URL: **Pending**
- Screenshot links: **Pending**
- Final deployed commit: **Pending**
