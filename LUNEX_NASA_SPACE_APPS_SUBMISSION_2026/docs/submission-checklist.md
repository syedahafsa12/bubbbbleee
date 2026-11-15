# Lunex submission and release checklist

Use this as the final gate before entering the public submission URL or sharing the project with judges.

## A. Deployment

- [ ] Backend/API deployment is complete.
- [ ] Frontend and API operate on the same origin, or a verified proxy/rewrite handles the relative `/api/...` paths.
- [ ] Production build succeeds on the exact final commit.
- [ ] The deployed server uses a Node.js runtime, not a static-only export.
- [ ] Prepared Product78 metadata and binary files are present in the deployed runtime.
- [ ] `GET /api/product78/sites` reports expected site readiness.
- [ ] `GET /api/product78/terrain-preview?siteId=site04_shackleton_rim` returns binary data with valid metadata headers.
- [ ] JPL Horizons requests work from the deployed backend, or return an explicit structured upstream error.
- [ ] Optional LROC imagery failure does not break the LOLA terrain view.
- [ ] Diagnostic routes have been reviewed for public exposure.
- [ ] Production URL has been recorded.

## B. Data and science

- [ ] Product78 source and the 5 m grid-spacing caveat are clearly attributed.
- [ ] The three prepared elevation rasters are identified accurately.
- [ ] The app does not imply all 27 registered sites have local prepared DEMs.
- [ ] Site04 ancillary science binaries are either deployed and verified, or the feature is clearly marked unavailable.
- [ ] Product90 is described as optional, not the default terrain source.
- [ ] Horizon coverage remains marked partial/incomplete where appropriate.
- [ ] Missing samples do not become assumed visible or zero-degree terrain.
- [ ] Visibility windows are described as sampled intervals.
- [ ] No solar-power, thermal, RF link-budget, or landing-safety certification claim is made without an implemented validated model.

## C. Tests and reproducibility

- [ ] Run `npx tsc --noEmit --pretty false`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run `npm run test:integration` against the final code.
- [ ] Run `npm run test:explorer` only after its required local science assets are available.
- [ ] Repeat smoke tests against the production URL.
- [ ] Record the code commit SHA used for the final demo.

The team reported lint, build, and the existing integration check as passing on 15 November 2026. Re-run them against the deployed commit; the report is not a substitute for release verification.

## D. Attribution, licensing, and AI disclosure

- [ ] NASA/JPL data/service attributions are present.
- [ ] Third-party image/model creator, source URL, and terms are confirmed.
- [ ] No asset is described as NASA-created or NASA-approved without evidence.
- [ ] Dependency license inventory has been generated from the final lockfile and reviewed.
- [ ] The 100% AI-generated code disclosure is included in the project submission.
- [ ] Human direction, review, scientific/source checking, and testing are described accurately.
- [ ] No AI-generated image/video claim is made; project team reported none were used.

## E. Demo evidence

- [ ] Actual production screenshots are captured.
- [ ] Walkthrough video is recorded from the final deployed app.
- [ ] Demo uses a prepared site and a reproducible selected point.
- [ ] The demo does not present unknown terrain as confirmed open sky.
- [ ] Production URL, video URL, and screenshot links are added to the submission form and project README.

## F. Final handoff

- [ ] Confirm this documentation pack matches the final source commit.
- [ ] Remove remaining “Pending” placeholders only when the corresponding work is truly complete.
- [ ] Confirm the public repository contains the files judges are expected to inspect.
- [ ] Confirm all submission form fields are saved before the challenge deadline.
