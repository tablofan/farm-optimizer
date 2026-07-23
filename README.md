# Farm Optimizer

Farm Optimizer is a client-side planning tool that turns imported Travian account data into
constrained assignment plans. The game provides the domain, but the core problem is general:
allocate a large set of jobs across capacity-limited workers while maximizing coverage and
controlling travel cost.

The application is written in plain JavaScript and HTML, runs entirely in the browser, and keeps
the optimization engine separate from the UI so it can be tested directly with Node.js.

## Engineering highlights

- Models oasis assignment as a max-cardinality Generalized Assignment Problem.
- Compares two greedy constructions and keeps the better feasible result.
- Uses an exact integer-programming fallback for small instances, with a time limit and an
  independent feasibility check before accepting a solver result.
- Rebalances existing PvP assignments through alternating overload-repair and cost-improvement
  phases without introducing new capacity violations.
- Produces explicit keep, add, move, and remove plan diffs instead of changing external state.
- Handles wrapping-map geometry, per-unit travel speeds, heterogeneous village capacities,
  exclusions, partial imports, and stale data.
- Includes a sample dataset and 57 dependency-free unit tests for the core logic.

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
| `smoke-test.html` | Headless-browser integration check |
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

For the browser smoke test, serve the repository as above and run:

```sh
google-chrome --headless=new --disable-gpu --virtual-time-budget=10000 \
  --dump-dom http://localhost:8731/smoke-test.html | grep -E 'SMOKE-(OK|FAIL)'
```

## Design documentation

The detailed data contracts, algorithm notes, trade-offs, and current validation status are in
[`DOCS.md`](DOCS.md). Significant decisions are recorded under [`docs/adr/`](docs/adr/), including
the exact-solver boundary and the keep-biased PvP rebalancer.

## License

MIT
