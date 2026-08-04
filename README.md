# Flight Status — SFO + SJC

One dashboard for SFO's and SJC's public flight-status feeds, for airport
volunteers answering passenger questions. One normalized table, the same
filters at both airports, all view state in the URL.

Design docs: `docs/superpowers/specs/`, glossary in `docs/CONTEXT.md`,
decisions in `docs/adr/`.

## Develop

    npm install
    npm run dev          # http://localhost:3000
    npx vitest run       # tests
    npm run typecheck

## Deploy

Every push to `main` publishes `ghcr.io/iltc/flight-status:latest`
(amd64 + arm64). On the server:

    docker pull ghcr.io/iltc/flight-status:latest
    docker run -d --name flight-status -p 3000:3000 \
      --restart unless-stopped ghcr.io/iltc/flight-status:latest

**One-time setup:** GHCR packages auto-created by `GITHUB_TOKEN` don't
reliably inherit the repo's visibility and often land private. After the
first successful workflow run, check the `flight-status` package under the
repo's Packages tab:

- If private and you want the `docker pull` above to work unauthenticated,
  open the package's settings and change its visibility to public — a
  one-time change.
- Otherwise, keep it private and authenticate on the server once with a
  personal access token scoped to `read:packages`:
  `echo "$GHCR_PAT" | docker login ghcr.io -u iLtc --password-stdin`.

Needed only once, before the first deploy.

## API

- `GET /api/flights?airport=sfo|sjc[&forceRefresh=1]` — normalized, windowed
  (−1 h to +8 h) flights for one airport. Server cache: 5 min (1 min under
  forceRefresh). Supports `If-None-Match`/304.
- `GET /api/health` — liveness probe; touches nothing upstream.

## Known issues

If you press Force refresh between one and five minutes into an airport
outage, the "couldn't reach" banner can briefly clear and then return. This
is because force refresh and the automatic poll use different freshness
windows (one minute versus five), and the cache does not remember that its
last attempt failed. The data shown during that gap is still within the
app's normal freshness window and its "Server data from" timestamp remains
accurate, so nothing incorrect is displayed — the banner just under-reports
the outage for up to about three and a half minutes. Fixing it properly
means tracking the last failure time in the cache.
