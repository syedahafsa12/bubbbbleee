# LUNEX — NASA Space Apps 2026 Submission Pack

> A self-contained documentation pack for the **Lunar Landing Site Navigator** challenge. This folder is intentionally separate so it can be copied into the final Lunex project without overwriting project files.

**Project:** Lunex  
**Challenge:** [NASA Space Apps Challenge 2026 — Lunar Landing Site Navigator](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/)  
**Codebase reviewed for this pack:** [syedahafsa12/lunex](https://github.com/syedahafsa12/lunex), main snapshot inspected on 15 November 2026  
**Submission state:** Frontend deployment reported complete; backend deployment and final public demo verification were still in progress when this pack was prepared.

## Start here

This pack documents the application, scientific sources, API contracts, architecture, developer workflow, AI disclosure, testing status, asset provenance, and remaining submission work.

| Document | What it contains |
|---|---|
| [NASA data sources](docs/nasa-data-sources.md) | Primary and optional datasets, actual integrations, source links, resolutions, attribution, and limitations |
| [API reference](docs/api-reference.md) | Implemented routes, parameters, examples, response semantics, and errors |
| [System architecture](docs/system-architecture.md) | Frontend, API layer, raster pipeline, ephemerides, and data flow |
| [Developer guide](docs/developer-guide.md) | Local setup, environment, scripts, data preparation, and deployment requirements |
| [Testing and validation](docs/testing-and-validation.md) | Existing integration checks, reported results, scientific validation, and recommended tests |
| [AI use disclosure](docs/ai-usage.md) | Transparent 100% AI-generated code disclosure and human oversight |
| [Asset provenance](docs/asset-provenance.md) | Verified NASA source assets and media items whose creator/license still needs confirmation |
| [Demo materials](docs/demo-materials.md) | Recording plan and explicit placeholders for authentic deployed screenshots/video |
| [Space Apps narrative](docs/space-apps-submission.md) | Judge-facing project summary, method, value, and limitations |
| [Submission checklist](docs/submission-checklist.md) | Final deployment, evidence, attribution, and release checks |
| [Changelog](CHANGELOG.md) | Documentation-pack snapshot and known items |

Additional files:
- `ai-usage.json`: machine-readable AI disclosure.
- `.env.example`: safe environment-variable template; contains no credentials.
- `ci/lunex-ci.yml`: GitHub Actions workflow template. Copy it to the project's root `.github/workflows/` directory when adopting it.

## What Lunex does

Lunex is an interactive lunar south-pole site exploration and mission-planning prototype. A user can explore candidate regions, select a position inside an available NASA LOLA Product78 terrain raster, inspect local topography, and compare the sampled local terrain horizon with JPL Horizons observations of the Sun and Earth over a selected UTC interval.

The application is deliberately explicit about unknown coverage. A raster boundary, NoData value, or search limit does not become an assumed open horizon. A positive sampled clearance is not a certified visibility result.

## Important scientific boundary

Lunex is a **decision-support and educational screening prototype**, not flight-certified software or a landing safety certification. Its Earth assessment is geometric terrain-obstruction screening, not an RF link budget. Its Sun assessment is not a solar-array power or thermal simulation. The sampled horizon is not a globally complete lunar horizon.

## Repository-transfer note

This pack is stored here as a separate folder at the user's request. It was authored against the more complete Lunex code snapshot reviewed at `syedahafsa12/lunex` on 15 November 2026, not by modifying this repository's root files. Before putting these documents into the final source repository, compare the destination code with the reviewed snapshot and update any route, asset, or deployment detail that has changed.

**No existing repository file was edited, renamed, or deleted to add this pack.**
