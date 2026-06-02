# PvE Optimizer

A browser tool for optimizing **oasis farming** in Travian (x3 speed, T4.6). It maximizes the total
number of free oases farmed across your villages — each oasis assigned to at most one village, within
each village's cavalry capacity.

See `CONTEXT.md` for the domain glossary, `docs/adr/` for architecture decisions, and `docs/PLAN.md`
for the build plan / data contract.

## Two parts

1. **Collector** (`collector.user.js`) — a Tampermonkey userscript that runs on the gameworld and
   scrapes, read-only: all **free oases** (coords + bonus type) via `POST /api/v1/map/position`, your
   **villages** (coords) + home **cavalry** counts, and your **current farm lists**. Hands the data to
   the calculator via Download / Copy / auto-`postMessage`. Never writes to the game.
2. **Calculator** (`index.html`) — a static page. Import the collector's JSON, pick ≤3 cavalry types,
   set per-village TS / sending-interval / speed-artefact, filter by resource, and Optimise. Shows a
   **display-only plan diff** (keep / add / move / remove) versus your current farm lists, each oasis
   linking to the in-game map.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Calculator UI + wiring (imports the data, runs the optimizer, renders the plan diff). |
| `optimizer.js` | Pure core logic — torus distance, travel/cost model, greedy + exact-ILP solver, plan diff. Loadable in browser and Node. |
| `cavalry.js` | Per-tribe unit table (name / type / speed / carry), `t1..t10` slot mapping. |
| `collector.user.js` | Tampermonkey collector userscript. |
| `sample-data.json` | Sample dataset to try the calculator without the game. |
| `test.js` | Node unit tests for `optimizer.js` (`node test.js`). |
| `CONTEXT.md` · `docs/adr/` · `docs/PLAN.md` | Glossary · decisions · build plan + data contract. |

## How it works

- **Cavalry model** — a "rainbow" = 1 of each selected cavalry type; a village's budget = `min` over
  the selected types' counts; an oasis costs `ceil(2 × travel / interval)` rainbows. The slowest
  selected unit sets travel speed (base ×2 for the speed server, ×artefact whole-trip, +20%/TS level
  beyond 20 fields). Distance is Euclidean on the wrapping −200..+200 map.
- **Optimizer** — a max-cardinality Generalized Assignment Problem. Greedy cheapest-first is run
  first; if it places every reachable oasis it is provably optimal, otherwise the exact ILP
  (`jsLPSolver`, loaded from CDN, falls back to greedy if unavailable or the instance is too large).
  The plan shows the **outgoing-movement** estimate (= Σ rainbow cost) against the 20,000 game cap.

## Develop / test

```sh
node test.js                 # unit tests for the core logic
python3 -m http.server 8731  # then open http://localhost:8731/index.html, click "Load sample data"
```

(Open via a local server so `fetch('sample-data.json')` works; or use "Import JSON file".)

## Status

Calculator + core logic built and tested (Node unit tests + headless-browser end-to-end). The
collector's live DOM/endpoint parsers are written from documented selectors and marked
`VALIDATE LIVE` — confirm them against a logged-in gameworld (build-plan step 7).
