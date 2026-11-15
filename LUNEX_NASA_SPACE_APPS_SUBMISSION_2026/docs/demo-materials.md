# Demo materials and walkthrough plan

## Current evidence status

At the time this pack was prepared:
- The frontend was reported deployed.
- Backend deployment was still in progress.
- A verified public application URL had not been supplied.
- Final deployed screenshots had not been captured.
- The final walkthrough video had not been recorded.

**No screenshots, demo links, or video files have been fabricated or inserted.** Add the real production evidence after the frontend and API have been tested together.

## Evidence folder to create after capture

Recommended project structure after copying this pack:

```text
docs/
  demo/
    lunex-home.png
    south-pole-map.png
    site-selection.png
    terrain-visualization.png
    mission-analysis.png
    site-comparison.png
    walkthrough.mp4
```

Use authentic captures from the actual deployed release. Do not use mockups as proof of a feature or capture a local-only page and label it production.

## Suggested 30-second walkthrough

| Time | Screen/action | Narration point |
|---|---|---|
| 0–4 s | Open the deployed Lunex home page | Introduce Lunex and the lunar south-pole landing-site problem |
| 4–9 s | Open the south-pole map and choose a prepared candidate site | Show where the candidate sits in the lunar context |
| 9–15 s | Select a point directly inside the Product78 terrain map | Show the exact landing-position selection, not just a regional pin |
| 15–22 s | Display the 3D terrain and Sun/Earth analysis timeline | Explain the combination of measured local terrain samples and JPL ephemerides |
| 22–27 s | Show a sampled horizon/unknown-coverage indicator or compare another prepared site | Demonstrate that unknown terrain is not mislabeled as open sky |
| 27–30 s | Show Lunex title and project/repository URL | Close with the prototype's purpose and scientific boundary |

Keep narration concise. Avoid showing a result as complete visibility if the returned terrain model says coverage is partial or unknown.

## Before recording

- Confirm both UI and API are on the production origin.
- Confirm a prepared Product78 site is marked ready.
- Use a known reproducible selected point.
- Wait for the live Horizons response; do not splice in a fabricated observation.
- Ensure the screen shows the current UTC/date context.
- Hide browser developer tools, credentials, and unrelated tabs.
- Keep the URL visible long enough to establish that it is the deployed product.
- Capture a still image of each major step at full resolution.

## Final evidence fields

- Production URL: **Pending**
- Walkthrough video URL/file: **Pending**
- Screenshot set: **Pending**
- Date/time of deployed smoke test: **Pending**
- Commit SHA of deployed code: **Pending**
