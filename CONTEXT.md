# PvE Optimizer

A browser tool for planning **oasis farming** in Travian (x3 speed, T4.6). Given all oases on a
gameworld and a player's villages + cavalry, it works out which oases each village should farm and
how much cavalry that commits. This file is the shared glossary — terms only, no implementation.

## Language

**Gameworld**:
A single Travian server instance, identified by its host (e.g. `ts30.x3.international.travian.com`).
All oasis data is scoped to one gameworld.
_Avoid_: server (ambiguous — can mean the backend), world, realm.

**Oasis**:
A nature map tile that a village can raid for resources. In this tool oases are assumed **empty**
(animal garrison already cleared) — combat is out of scope. Only **free** oases (not annexed to any
player's village) are farm targets; **occupied/annexed** oases are excluded.
_Avoid_: oase, oasys.

**Collector**:
The Tampermonkey userscript that runs on the gameworld and gathers the data — all free **Oases**
(coordinates + **Oasis type**), the player's **Villages** (coordinates + **Cavalry** counts), and the
**Current farm lists** — then hands it to the **Calculator**. It never writes to the game.

**Calculator**:
The static `index.html` page that imports the **Collector**'s data, runs the optimizer, and displays
the result as a **Plan diff** against the current farm lists. Display only — the player applies
changes by hand.

**Farm list**:
A Travian rally-point list of raid targets that the game re-sends on a cadence. The optimizer plans
each village's *ideal* farm-list membership; the **Current farm lists** are what is set up now.

**Plan diff**:
The per-oasis comparison of the optimizer's assignment against the **Current farm lists**, labelling
each as **keep / add / move / remove**. Only **free Oases** are reconciled — village and
occupied-oasis entries in the lists are ignored (never moved or removed). A target is in scope only
if its coordinates match a free oasis in the scan; a target that is no longer a free oasis (e.g.
annexed since the scan) silently falls out of scope. Removals are tagged with a reason (over
capacity, excluded by the resource filter, or duplicate). Each row links to the oasis on the in-game
map (`karte.php?x=…&y=…`).

**Oasis type**:
The resource bonus an oasis carries (e.g. +25% lumber, +50% crop, or a double-bonus). Scraped
per-oasis alongside coordinates. For filtering it collapses to one of the **4 resources** by its
primary (first / non-crop) bonus — e.g. a clay+crop double buckets as **clay** — while the full type
is still displayed.
_Avoid_: oasis bonus (use only as a clarifier), oasis kind.

**Village**:
One of the player's own bases, with map coordinates and a stock of trainable cavalry. The origin
point from which oases are farmed.

**Cavalry**:
Mounted units used to farm oases (the "horses"). The only troops this tool plans for; speed is set
by the **slowest** cavalry type in a send.
_Avoid_: horses (UI shorthand only), troops (too broad — includes infantry/siege we don't plan).

**Rainbow**:
One farm-send composed of exactly **1 of each selected cavalry type** — the mix of unit types is
what makes it a "rainbow". A village can form `min(count of each selected type)` rainbows; a farmed
oasis ties up `ceil(2 × travel_time / interval)` of them (the round-trips in flight at any moment).
(The Excel's "111 / 222 / 333" meant 1 / 2 / 3 of each type; this tool fixes it at 1 of each — no
send-size knob.)
_Avoid_: clearing party (a rainbow here farms empty oases, it does not clear animals).

**Sending interval**:
How often (minutes) a village re-sends its farm list. Drives how many rainbows a given oasis ties up.

**Travel time**:
Minutes for cavalry to reach an oasis, derived from **distance**, cavalry speed, **Tournament Square**
level, and **speed artefact** — never entered by hand (the Excel entered it manually; this tool computes it).

**Distance**:
Straight-line (Euclidean) map distance in fields between a village and an oasis, computed from their
coordinates. This world's map runs **−200..+200** on both axes (≈401 wide) and wraps (torus), so each
axis delta is wrap-capped — `d = min(|Δ|, 401 − |Δ|)` — before applying Pythagoras.
_Avoid_: travel length (Excel term — that was distance), range.

**Tournament Square (TS)**:
A village building that increases travel speed for the portion of a trip beyond 20 fields.
_Avoid_: TS (spell out at least once per surface).

**Speed artefact**:
An account-wide multiplier on troop travel speed.

**Capacity**:
A village's available **Rainbows** = `min` over the selected cavalry types of their counts. The
oases assigned to a village are feasible only while their total cost (`Σ ceil(2 × travel/interval)`)
stays within this budget.

**Outgoing movement**:
One in-flight farm-send occupying a troop-movement slot. At steady state a farmed **Oasis** holds
`ceil(2 × travel/interval)` of them, so the account total = the sum of all assigned rainbow costs.
The gameworld caps total troop movements at **20,000**; the **Calculator** displays this estimate
but does not optimize against it.

## Relationships

- A **Gameworld** contains many **Oases** (each with coordinates and an **Oasis type**).
- A **Village** farms zero or more **Oases**; an **Oasis** is farmed by **at most one Village** (no double-farming).
- The optimizer maximizes the **total count of farmed Oases** across all selected villages, within each **Village**'s **Capacity**.
- Each assignment ties up **Cavalry** as **Rainbows**.
- **Travel time** is a function of **Distance**, cavalry speed, **Tournament Square**, and **Speed artefact**.
- A **Village** has a **Capacity** — the rainbows it can sustain across its assigned oases at a given **Sending interval**.

## Example dialogue

> **Dev:** "When the user picks a **Village**, do we farm every **Oasis** in range?"
> **Player:** "No — only the ones we assign. Each oasis we add costs **Rainbows** every **Sending interval**, and the **Village** only has so many. That's the **Capacity** limit."
> **Dev:** "And the **Oasis type** — does it change the math?"
> **Player:** "Not the cavalry math. It's a label so I can choose which oases to farm."

## Flagged ambiguities

- **Farming vs Clearing** — *Farming* = repeatedly raiding an empty **Oasis** for resources (this tool's whole scope). *Clearing* = killing the animal garrison first (combat). Clearing is **out of scope**; oases are assumed pre-cleared.
- **"Rainbow"** — in the wider Travian community can mean a mixed clearing party; **here** it means a fixed-size cavalry farm-send (111/222/333). Resolved to the farming meaning.
- **"Travel length" (Excel) vs "Distance"** — the Excel's manually-entered "travel length (sq)" is what this tool calls **Distance** and computes from coordinates.
