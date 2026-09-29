# Farm Optimizer

Farm Optimizer is a client-side tool for optimizing farming patterns in Travian. It assigns oasis
and PvP farming targets across villages using imported account data, troop capacity, and travel
costs. The game provides the domain, but the core problem is general: allocate a large set of jobs
across capacity-limited workers while maximizing coverage and controlling travel cost.

The application is written in plain JavaScript and HTML, runs entirely in the browser, and keeps
the optimization engine separate from the UI so it can be tested directly with Node.js.

**Live:** <https://tablofan.github.io/farm-optimizer/> · collector userscript:
<https://tablofan.github.io/farm-optimizer/collector.user.js>

## Engineering highlights

- Models oasis assignment as a max-cardinality Generalized Assignment Problem.
- Compares two greedy constructions and keeps the better feasible result; cost ties go to the
  village that farms the oasis today, so an equally good plan never proposes a pointless move.
- Uses an exact integer-programming fallback for small instances, with a time limit and an
  independent feasibility check before accepting a solver result.
- Rebalances existing PvP assignments through alternating overload-repair, cost-improvement and
  return-home passes, without introducing new capacity violations.
- Produces explicit keep, add, move, and remove plan diffs instead of changing external state.
- Handles wrapping-map geometry, per-unit travel speeds, heterogeneous village capacities,
  exclusions, partial imports, and stale data.
- Includes a sample dataset, dependency-free unit tests for the core logic, and a headless-browser
  smoke test for the page, both run in CI.

The companion collector is read-only: it gathers data for the planner but never performs game
actions. The resulting plan is display-only.

## Repository structure

| Path | Purpose |
| --- | --- |
| `optimizer.js` | Pure optimization, geometry, budgeting, rebalancing, and plan-diff logic |
| `cavalry.js` | Unit data and slot mappings |
| `index.html` | Browser UI, importing, persistence, and result presentation |
| `collector.user.js` | Read-only data collector |
| `sample-data.json` | Self-contained dataset for trying the application |
| `test.js` | Node.js unit-test harness |
| `smoke-test.html` · `smoke.sh` | Headless-browser integration check and its runner |
| `docs/adr/` | Architecture decision records |

## Run locally

No build step is required. From the repository root:

```sh
python3 -m http.server 8731
```

Open `http://localhost:8731`, select **Load sample**, and explore the generated plans.

## Test

Run the core test suite with:

```sh
node test.js
```

The suite covers geometry, capacity accounting, greedy and exact-solver safeguards, plan diffs,
role derivation, exclusions, the oasis browser, PvP rebalancing, and pooled-budget planning. The
optional real ILP integration check is skipped when `javascript-lp-solver` is not installed; all
fallback and solver-validation behavior is still tested with deterministic fakes.

To run the real-solver check too, install the solver locally first (it is not committed):
`npm install --no-save --no-package-lock javascript-lp-solver@0.4.24`.

For the browser smoke test (needs Chrome; set `CHROME=/path/to/chrome` if it is not on `PATH`):

```sh
./smoke.sh
```

It serves the repository, runs `smoke-test.html` headless, and exits non-zero on any `SMOKE-FAIL`
line or if the page never reaches `SMOKE-DONE`.

## Design documentation

The detailed data contracts, algorithm notes, trade-offs, and current validation status are in
[`DOCS.md`](DOCS.md). Significant decisions are recorded under [`docs/adr/`](docs/adr/), including
the exact-solver boundary and the keep-biased PvP rebalancer.

## License

MIT
