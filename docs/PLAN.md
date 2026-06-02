# PvE Optimizer — Build Plan

Implementation plan for the design captured in `CONTEXT.md` and `docs/adr/0001-0003`. Two artifacts:
a **Collector** userscript and a static **Calculator** page.

## Components

### A. Collector — Tampermonkey userscript (read-only, runs on the gameworld)

- `@match` the gameworld hosts (`*.travian.com`). Page-context `fetch`, session cookie only (no token;
  CSP is just `frame-ancestors 'self'`).
- **Free oases** — sweep `POST /api/v1/map/position` over a grid of windows covering −200..+200.
  Per tile: free oasis = title token `{k.fo}`; bonus from `text` tokens `{a.r1}=wood {a.r2}=clay
  {a.r3}=iron {a.r4}=crop`, each with a `%`; coords from `position`. Throttle ~0.5–1.5 s/call.
  (Oasis locations/types are permanent → cache; only free-vs-occupied drifts.)
- **Own villages** — `#sidebarBoxVillageList` → `data-did` + coordinates; detect account **tribe**.
- **Cavalry counts** — per village from `build.php?gid=16&tt=1` (or dorf3 Troops tab): `t1..t10`.
- **Current farm lists** — `build.php?id=39&gid=16&tt=99` → per list: owning village + target coords.
- **Export** one JSON (the data contract below) and hand off to the Calculator
  (localStorage key + open Calculator URL, or postMessage). Never writes to the game.

### B. Calculator — static `index.html` (sibling of `trade-route-calculator`)

- Import the JSON. Bundle a **cavalry data table** (from `Ash-Warden/.ai/documentation/troops_t46.json`):
  per tribe, the cavalry units (`type:"c"`) with `speed` (base fields/h) and `cap`; map `t1..t10` →
  unit via tribe (race indices: 0 Romans, 1 Teutons, 2 Gauls, 3 Nature, 4 Natars, 5 Egyptians,
  6 Huns, 7 Spartans, 8 Vikings).
  Note: those 0-based race indices are **internal** to `troops_t46.json`'s layout. The **wire** `tribe`
  field is a lowercase **slug** (`huns`, …); the collector maps the in-game Travian tribeId
  (1 Romans … 6 Egyptians, 7 Huns, 8 Spartans) to that slug.
  ⚠️ The local json has ≥1 stale value — Huns **Marksman is base 16, not 15** (verified ×3 vs
  Kirilloid `t4.fs/units.ts`). Re-derive the full cavalry table from
  `raw.githubusercontent.com/kirilloid/travian/master/src/model/t4.fs/units.ts` (`v` = velocity)
  rather than trusting the json, then sanity-check one route against the in-game rally-point ETA.
- **Per-village input table** (manual): TS level, sending interval, speed-artefact multiplier.
- **Controls**: pick ≤3 cavalry types; choose villages; 4-resource filter (oasis buckets by
  primary/non-crop bonus).
- Compute the cost matrix → build + solve the ILP (`glpk.js`) → diff vs current farm lists → render
  the **Plan diff** table.

## Data contract (Collector → Calculator)

```json
{
  "server": "https://tsXX.x3...travian.com",
  "tribe": "huns",
  "mapRadius": 200,
  "scannedAt": "<iso>",
  "villages": [{ "did": 12345, "name": "A001", "x": -18, "y": -93, "troops": { "t1": 0, "...": 0, "t10": 0 } }],
  "oases":    [{ "x": -20, "y": -90, "bonuses": [{ "res": "clay", "pct": 25 }, { "res": "crop", "pct": 25 }] }],
  "farmLists":[{ "listId": 1, "name": "A001 oases", "villageDid": 12345, "targets": [{ "x": -20, "y": -90 }] }]
}
```

## Travel / cost model

- `spd_fpm = slowest_selected_base × 2 × artefact[v] / 60` (fields per minute; **×2 = speed-server
  rule, not ×3**).
- `dist(o,v)` = torus-Euclidean on −200..+200: `dx = min(|Δx|, 401−|Δx|)`, likewise `dy`,
  `dist = √(dx²+dy²)` (kept as a float — matches in-game ETA precision; not rounded).
- `tt = min(dist,20)/spd_fpm + max(dist−20,0)/(spd_fpm × (1 + 0.2·TS[v]))` minutes (TS only beyond 20
  fields; artefact already in `spd_fpm` applies whole trip; no hero/boots).
- `cost(o,v) = ceil(2·tt / interval[v])` rainbows; feasible iff `cost ≤ budget[v]`.
- `budget[v] = min` over selected cavalry types of that village's count.

## Optimizer (exact GAP ILP)

- Binary `x[o,v]` per feasible pair. `maximize Σ x[o,v] − ε·Σ cost[o,v]·x[o,v]`.
- `Σ_v x[o,v] ≤ 1` (oasis ≤ 1 village); `Σ_o cost[o,v]·x[o,v] ≤ budget[v]`.
- Solve with `glpk.js` (WASM, `<script>`); solver time limit → greedy cheapest-first fallback.
- **Outgoing-movement estimate** = `Σ cost` over assigned oases; flag against the 20,000 cap.

## Plan diff (display only)

- Match current farm-list targets to scanned free oases by coordinates; **only free oases are in
  scope** (village / occupied-oasis targets ignored).
- Per oasis: **keep / add / move / remove**; removals reason-tagged (over capacity, excluded by the
  resource filter, or duplicate). A current target that is no longer a free oasis (annexed) or is a
  village is silently ignored — the collector only emits free oases, so such targets fall out of
  scope rather than being flagged. Each row links to `…/karte.php?x=&y=`.

## Build order

1. Cavalry data module (table + tribe/`tN` mapping) — feeds everything.
2. Calculator skeleton: JSON import, per-village table, controls (against mock data).
3. Travel/cost + torus distance; unit-test against known in-game ETAs and the Excel.
4. ILP integration (`glpk.js`) + greedy fallback + movement estimate.
5. Plan-diff logic + table UI + map links.
6. Collector userscript: oasis sweep → villages/troops → farm lists → export + handoff.
7. End-to-end on a live world; tune throttle and validate token/selector parsing.

## Verified facts

- **Cavalry base speeds (fields/h, 1×)** — Huns: Spotter 19, Steppe Rider 16, Marksman 16, Marauder 14.
  Egyptians: Sopdu 16, Anhur 15, Resheph 10. Anchor: Gauls Theutates Thunder 19. (3 independent
  sources, high confidence. The local `troops_t46.json` had Marksman as 15 — use 16.)
- **Speed-server multiplier** — fixed **×2** on all speed worlds (x3/x5 alike), confirmed high.

## Open data items (validate at build time on a live world)

- Re-derive the full per-tribe cavalry table from Kirilloid `t4.fs/units.ts` (json is partly stale).
- Exact `/api/v1/map/position` tile token format on the current patch.
- Farm-list (`tt=99`) DOM/endpoint selectors; troop-table (`gid=16&tt=1`) parse.
- Map radius auto-detect (default 200).
