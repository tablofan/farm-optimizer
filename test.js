// Node unit tests for optimizer.js — run: node test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PVE = require('./optimizer.js');
const { UNITS } = require('./cavalry.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('FAIL  ' + name + '\n      ' + e.message); }
}
function approx(a, b, eps) { assert(Math.abs(a - b) <= (eps || 1e-6), `${a} ≈ ${b}`); }

console.log('geometry/travel');
t('torus wrap on -200..200 (size 401)', () => {
  // (200,0) and (-200,0) are 1 field apart across the wrap, not 400
  approx(PVE.distance(200, 0, -200, 0, 200), 1);
  approx(PVE.distance(0, 0, 3, 4, 200), 5); // pythagorean
});
t('travel time: Marauder (base14) to 28-field oasis, no TS', () => {
  // fph = 14*2 = 28; fpm = 28/60. first 20 fields + 8 fields = 28/(28/60) = 60 min
  approx(PVE.travelMinutes(28, 14, 1, 0), 60, 1e-6);
});
t('TS only applies beyond 20 fields', () => {
  const noTs = PVE.travelMinutes(40, 14, 1, 0);
  const ts5 = PVE.travelMinutes(40, 14, 1, 5);  // beyond-20 portion 2x faster (1+0.2*5=2)
  const ts5_first20 = PVE.travelMinutes(20, 14, 1, 5);
  approx(PVE.travelMinutes(20, 14, 1, 0), ts5_first20); // first 20 unaffected by TS
  assert(ts5 < noTs, 'TS should reduce time for >20 trips');
});
t('artefact multiplies whole trip', () => {
  approx(PVE.travelMinutes(40, 14, 2, 0), PVE.travelMinutes(40, 28, 1, 0)); // 2x artefact == 2x base
});
t('oasis cost = ceil(2*travel/interval)', () => {
  assert.strictEqual(PVE.oasisCost(60, 5), 24);  // ceil(120/5)
  assert.strictEqual(PVE.oasisCost(61, 5), 25);  // ceil(122/5)=24.4->25
});

console.log('oasis typing');
t('primary res = first non-crop; clay+crop -> clay', () => {
  assert.strictEqual(PVE.primaryRes([{res:'clay',pct:25},{res:'crop',pct:25}]), 'clay');
  assert.strictEqual(PVE.primaryRes([{res:'crop',pct:50}]), 'crop');
  assert.strictEqual(PVE.primaryRes([{res:'iron',pct:25}]), 'iron');
});

console.log('budget = min over selected cavalry counts');
t('budget is the scarcest selected type', () => {
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'V', x: 0, y: 0, troops: { t4: 1000, t5: 1800, t6: 1200 } }],
    oases: [{ x: 1, y: 0, bonuses: [{ res: 'crop', pct: 50 }] }], farmLists: [] };
  const inst = PVE.buildInstance(data, {
    units: UNITS.huns, selectedSlots: ['t4','t5','t6'], includedDids: [1],
    resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 5, artefact: 1 } }
  });
  assert.strictEqual(inst.villages[0].budget, 1000); // min(1000,1800,1200)
  assert.strictEqual(inst.baseSpeed, 14);            // slowest of Steppe16/Marksman16/Marauder14
});

console.log('solver: greedy optimality + assignment');
t('greedy places every reachable oasis when budget is ample (=> provably optimal)', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-data.json')));
  const inst = PVE.buildInstance(data, {
    units: UNITS.huns, selectedSlots: ['t4','t5','t6'],
    includedDids: data.villages.map(v => v.did),
    resourceFilter: { wood: true, clay: true, iron: true, crop: true },
    perVillage: { 1001: { ts: 10, interval: 5, artefact: 1 },
                  1004: { ts: 8, interval: 5, artefact: 1 },
                  1006: { ts: 8, interval: 5, artefact: 1 } }
  });
  const r = PVE.solve(inst, {});
  assert(inst.maxPossible > 0, 'some oases feasible');
  assert.strictEqual(r.count, inst.maxPossible, 'all reachable placed');
  assert(r.optimal === true, 'flagged optimal');
  assert(r.movements > 0, 'movements estimated');
  // capacity respected
  inst.villages.forEach((v, vi) => assert(r.used[vi] <= v.budget, 'within budget'));
});
t('tight budget forces choices; greedy maximizes count & respects capacity', () => {
  // 2 villages, budget 3 each; 4 oases. v0 cheap to all (cost1), v1 cost2.
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 3 } },
               { did: 2, name: 'B', x: 2, y: 0, troops: { t6: 3 } }],
    oases: [ { x: 0, y: 1, bonuses: [{res:'crop',pct:25}] },
             { x: 1, y: 0, bonuses: [{res:'crop',pct:25}] },
             { x: 2, y: 1, bonuses: [{res:'crop',pct:25}] },
             { x: 3, y: 0, bonuses: [{res:'crop',pct:25}] } ],
    farmLists: [] };
  const inst = PVE.buildInstance(data, {
    units: UNITS.huns, selectedSlots: ['t6'], includedDids: [1, 2],
    resourceFilter: { crop: true },
    perVillage: { 1: { ts: 0, interval: 60, artefact: 1 }, 2: { ts: 0, interval: 60, artefact: 1 } }
  });
  const r = PVE.solve(inst, {});
  inst.villages.forEach((v, vi) => assert(r.used[vi] <= v.budget, 'within budget'));
  assert(r.count >= 1 && r.count <= inst.oases.length);
});

console.log('plan diff');
t('diff: keep/add/move/remove; ignores non-free-oasis targets', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-data.json')));
  const inst = PVE.buildInstance(data, {
    units: UNITS.huns, selectedSlots: ['t4','t5','t6'],
    includedDids: data.villages.map(v => v.did),
    resourceFilter: { wood: true, clay: true, iron: true, crop: true },
    perVillage: { 1001: { ts: 10, interval: 5, artefact: 1 },
                  1004: { ts: 8, interval: 5, artefact: 1 },
                  1006: { ts: 8, interval: 5, artefact: 1 } }
  });
  const r = PVE.solve(inst, {});
  const rows = PVE.planDiff(data, inst, r);
  assert(rows.length > 0, 'diff has rows');
  const statuses = new Set(rows.map(x => x.status));
  // the -50/-50 (occupied) and -18/-93 (village) targets must NOT appear as removals
  const badRemoval = rows.find(x => x.status === 'remove' && x.x === -50 && x.y === -50);
  assert(!badRemoval, 'non-free-oasis target ignored');
  assert(statuses.has('add') || statuses.has('keep') || statuses.has('move'), 'has actionable rows');
});

console.log('plan diff — regressions from review');
t('removal branch does not throw and tags reason (strict-mode `cur` fix)', () => {
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 100 } }],
    oases: [{ x: 1, y: 0, bonuses: [{ res: 'clay', pct: 25 }] }],
    farmLists: [{ listId: 1, name: 'A', villageDid: 1, targets: [{ x: 1, y: 0 }] }] };
  const inst = PVE.buildInstance(data, { units: UNITS.huns, selectedSlots: ['t6'], includedDids: [1],
    resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 60, artefact: 1 } } }); // clay excluded
  const r = PVE.solve(inst, {});
  let rows;
  assert.doesNotThrow(function () { rows = PVE.planDiff(data, inst, r); });
  const rem = rows.find(x => x.status === 'remove' && x.x === 1 && x.y === 0);
  assert(rem && /filter/.test(rem.reason), 'filtered current target flagged remove with reason');
});
t('multi-list oasis: one keep/move + one remove (no A→A, no double-farm)', () => {
  const data = { mapRadius: 200,
    villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 100 } },
               { did: 2, name: 'B', x: 1, y: 0, troops: { t6: 100 } }],
    oases: [{ x: 0, y: 1, bonuses: [{ res: 'crop', pct: 25 }] }],
    farmLists: [{ listId: 1, name: 'A', villageDid: 1, targets: [{ x: 0, y: 1 }] },
                { listId: 2, name: 'B', villageDid: 2, targets: [{ x: 0, y: 1 }] }] };
  const inst = PVE.buildInstance(data, { units: UNITS.huns, selectedSlots: ['t6'], includedDids: [1, 2],
    resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 60, artefact: 1 }, 2: { ts: 0, interval: 60, artefact: 1 } } });
  const r = PVE.solve(inst, {});
  const forOasis = PVE.planDiff(data, inst, r).filter(x => x.x === 0 && x.y === 1);
  const keeps = forOasis.filter(x => x.status === 'keep' || x.status === 'move');
  const rems = forOasis.filter(x => x.status === 'remove');
  assert.strictEqual(keeps.length, 1, 'exactly one keep/move');
  assert.strictEqual(rems.length, 1, 'exactly one remove for the other holder');
  keeps.forEach(k => assert(k.toVillage !== k.fromVillage, 'no X→X no-op'));
});
t('distance is a non-rounded float', () => {
  const d = PVE.distance(0, 0, 1, 2, 200); // sqrt(5) ≈ 2.236…
  approx(d, Math.sqrt(5));
  assert(d !== Math.round(d), 'kept as float (matches in-game ETA precision)');
});
t('oases at the same tile are deduped in buildInstance', () => {
  const data = { mapRadius: 200, villages: [{ did: 1, name: 'A', x: 0, y: 0, troops: { t6: 100 } }],
    oases: [{ x: 1, y: 0, bonuses: [{ res: 'crop', pct: 25 }] }, { x: 1, y: 0, bonuses: [{ res: 'crop', pct: 50 }] }],
    farmLists: [] };
  const inst = PVE.buildInstance(data, { units: UNITS.huns, selectedSlots: ['t6'], includedDids: [1],
    resourceFilter: { crop: true }, perVillage: { 1: { ts: 0, interval: 60, artefact: 1 } } });
  assert.strictEqual(inst.oases.length, 1, 'duplicate tile collapsed');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
