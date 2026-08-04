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

## API

- `GET /api/flights?airport=sfo|sjc[&forceRefresh=1]` — normalized, windowed
  (−1 h to +8 h) flights for one airport. Server cache: 5 min (1 min under
  forceRefresh). Supports `If-None-Match`/304.
- `GET /api/health` — liveness probe; touches nothing upstream.
