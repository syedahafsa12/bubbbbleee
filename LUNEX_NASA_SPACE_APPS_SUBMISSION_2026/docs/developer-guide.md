# Lunex developer guide

## Requirements

- Node.js 22 is the recommended runtime.
- npm.
- Git.
- Network access to NASA/JPL services for live ephemeris and optional imagery calls.
- Sufficient disk and deployment storage for the prepared terrain rasters.

## Local setup

```bash
git clone https://github.com/syedahafsa12/lunex.git
cd lunex
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

If PowerShell is used, copy the environment file with:

```powershell
Copy-Item .env.example .env.local
```

The source repository may not include a ready-to-use environment file; the template in this pack is intended to be copied and reviewed before use.

## Environment variables

| Variable | Purpose | Required |
|---|---|---|
| `HORIZONS_USER_AGENT` | Identifies the application in the mission-analysis route's outbound Horizons requests | Recommended for deployment |
| `NEXT_PUBLIC_LUNEX_MOON_MODEL_URL` | Optional public URL for the global Moon model asset | Only if using the configurable global model URL |

Example:

```dotenv
HORIZONS_USER_AGENT=Lunex/1.0 (contact: your-team-email)
NEXT_PUBLIC_LUNEX_MOON_MODEL_URL=
```

Do not commit API credentials, deployment tokens, private contact information, or local secrets. No secret is needed for the public Horizons interface.

## Available package scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start Next.js development server |
| `npm run build` | Build production application |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run test:integration` | Run the existing live Horizons/Product78 integration verifier |
| `npm run test:explorer` | Run the more extensive explorer/API verifier |
| `npm run prepare:product78` | Download and prepare the script's default set of additional Product78 sites |

Run the TypeScript checker separately:

```bash
npx tsc --noEmit --pretty false
```

The integration script accepts an optional base URL through `LUNAPATH_BASE_URL`. The existing explorer verifier defaults to port 3001; set the variable explicitly when using another port.

## Product78 data preparation

The reviewed code includes a preparation script for downloading additional Product78 source DEMs. It writes prepared data beneath `public/data/<site-directory>/`.

Examples:

```bash
# Prepare the default set configured by the script.
npm run prepare:product78

# Prepare only selected archive sites.
npm run prepare:product78 -- Site11 Site23

# Prepare all registered archive sites.
npm run prepare:product78 -- --all
```

The all-sites operation can download substantial data. Do not assume every raster should be committed to Git or bundled into a serverless deployment. Confirm storage limits, file tracing, bandwidth, and runtime memory before enabling more candidate regions.

## Run checks locally

```bash
npx tsc --noEmit --pretty false
npm run lint
npm run build
```

For the live API integration check, start the production server in one terminal:

```bash
npm run start
```

Then in another terminal:

```bash
npm run test:integration
```

The integration verifier calls the live API and JPL Horizons; it is not an offline deterministic unit test. Network/service availability can affect its result.

The explorer check exercises terrain preview, selected-position analysis, science sampling, and optional LROC imagery. It requires all assets used by those checks to exist. The reviewed snapshot did not contain the Site04 ancillary science binaries, so this test must not be described as passed unless those files are supplied and the test has been rerun.

## Deployment

### Recommended topology

Deploy the Next.js frontend and its API routes under one origin. The browser currently uses relative `/api/...` paths. If you deploy a separate backend origin, configure a reverse proxy/rewrite and adapt the frontend API base. CORS configuration alone does not rewrite relative URLs.

### Runtime requirements

The API uses Node.js filesystem access and outbound fetch calls. A static export or browser-only host cannot run these handlers. The server must have the prepared `public/data` files available at runtime.

The reviewed `next.config.ts` contains output file tracing includes for the main routes and the prepared raster assets. Confirm these paths match the final deployment branch and provider. Do not assume that local development success guarantees that a serverless deployment includes the large binary files.

### Post-deployment smoke test

After frontend and backend deployment, verify:

1. Home page renders without a client runtime error.
2. `GET /api/product78/sites` returns a valid catalogue and readiness counts.
3. Site04 terrain preview returns binary data and metadata headers.
4. A selected point is mapped to the expected site/pixel.
5. `GET /api/horizons` returns Sun/Earth data or a clear structured upstream error.
6. `GET /api/horizons/selected-location` works for the exact selected coordinate and requested UTC duration.
7. `GET /api/horizons/mission-analysis` works for one supported mode at a time.
8. Optional NAC imagery fails gracefully and the LOLA terrain view remains usable.
9. The same checks work against the deployed URL, not only localhost.

## Production cautions

- Avoid deploying a static-only build.
- Avoid splitting frontend and API origins without proxy/API-base handling.
- Verify asset inclusion for every prepared `.bin` file.
- Restrict diagnostic endpoints when not needed.
- Review external-service timeout behavior and provider function-duration limits.
- Add the final production URL to the main README only after a real smoke test.
