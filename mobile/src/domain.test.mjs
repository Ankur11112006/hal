// node src/domain.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import {
  addDays, daysBetween, toHectares, fromHectares, unitsFor,
  vaccinePlan, breedingPlan, walkSymptoms, symptomAnswer,
  maskToCrop, softmax, UNITS,
} from './domain.js';

const content = (f) =>
  JSON.parse(fs.readFileSync(new URL('../../content/' + f, import.meta.url), 'utf8'));
const sched = content('vaccination_schedule.json');
const tree = content('symptom_tree.json');
const T = (s) => new Date(s + 'T00:00:00Z');

// ---- dates
assert.equal(addDays('2026-01-01', 31), '2026-02-01');
assert.equal(daysBetween('2026-01-01', '2026-03-02'), 60);

// ---- area units: the most dangerous silent bug in the app
// a bigha is not one thing, and the same number must not convert the same way
assert.notEqual(toHectares(1, 'bigha', 'RJ'), toHectares(1, 'bigha', 'MP'));
assert.ok(Math.abs(toHectares(2, 'bigha', 'UP') - 0.5058) < 1e-3);
assert.ok(Math.abs(toHectares(1, 'acre', 'UP') - 0.404686) < 1e-6);
// round trip
for (const [u, st] of [['bigha', 'RJ'], ['guntha', 'MH'], ['kanal', 'PB'], ['acre', 'UP']]) {
  assert.ok(Math.abs(fromHectares(toHectares(3, u, st), u, st) - 3) < 1e-9, `${u}/${st}`);
}
// refuse rather than guess when the unit is not used in that state
assert.throws(() => toHectares(1, 'bigha', 'TN'), /not defined for TN/);
assert.throws(() => toHectares(1, 'nonsense', 'UP'), /unknown unit/);
assert.ok(unitsFor('MH').includes('guntha') && !unitsFor('MH').includes('bigha'));

// ---- vaccination: the demo's cross-domain line depends on this being right
const gauri = { species: 'cow', dob: '2021-03-01', sex: 'female' };
const fmdDec = [{ type: 'vaccination', at: '2025-12-02', data: { vaccine: 'FMD' } }];
const plan = vaccinePlan(gauri, sched, fmdDec, T('2026-08-15'));
const fmd = plan.find((p) => p.vaccine === 'FMD');
assert.equal(fmd.due, '2026-05-31', 'FMD repeats every 180 days');
assert.ok(fmd.overdue && fmd.daysLeft < 0, 'Dec 2025 dose must read overdue on demo day');
assert.ok(fmd.visible, 'an overdue vaccine must surface');

// brucellosis is once in a lifetime and only inside the 4-8 month window
const calf = { species: 'cow', dob: '2026-05-01', sex: 'female' };
assert.ok(vaccinePlan(calf, sched, [], T('2026-10-01')).some((p) => p.vaccine === 'Brucellosis'));
assert.ok(!vaccinePlan(gauri, sched, [], T('2026-08-15')).some((p) => p.vaccine === 'Brucellosis'),
  'a 5-year-old cow is past the brucella window');
const bruDone = [{ type: 'vaccination', at: '2026-09-01', data: { vaccine: 'Brucellosis' } }];
assert.ok(!vaccinePlan(calf, sched, bruDone, T('2026-10-01')).some((p) => p.vaccine === 'Brucellosis'),
  'lifetime_once must never repeat');

// a male animal is not offered a females_only vaccine
const bull = { species: 'cow', dob: '2026-05-01', sex: 'male' };
assert.ok(!vaccinePlan(bull, sched, [], T('2026-10-01')).some((p) => p.vaccine === 'Brucellosis'));

// buffalo follows the cattle schedule via the alias
assert.ok(vaccinePlan({ species: 'buffalo', dob: '2024-01-01' }, sched, [], T('2026-08-15')).length > 0);

// Day Zero: one animal with no history must generate several entries
assert.ok(vaccinePlan({ species: 'cow', dob: '2026-01-01', sex: 'female' }, sched, [],
  T('2026-08-15')).length >= 4, 'adding one animal must fill the timeline');

// ---- breeding
const bred = breedingPlan({ last_insemination: '2026-01-01' }, sched.breeding, T('2026-02-01'));
assert.equal(bred.find((e) => e.kind === 'expected_calving').on, '2026-10-11');
assert.ok(bred.find((e) => e.kind === 'dry_off').on < bred.find((e) => e.kind === 'expected_calving').on);
const heat = breedingPlan({ last_calving: '2026-02-01' }, sched.breeding, T('2026-08-15'));
assert.ok(heat[0].daysLeft >= 0 && heat[0].daysLeft <= 21, 'next heat is within one cycle');

// ---- symptom tree
const down = walkSymptoms(tree, [true, true]);          // cannot stand + calved
assert.ok(down.done && down.result.urgency === 'urgent');
assert.equal(down.id, 'res_milk_fever');
const fmdWalk = walkSymptoms(tree, [false, true, true, true]);  // fever, mouth, foot
assert.equal(fmdWalk.id, 'res_fmd');
assert.ok(fmdWalk.result.needs_vet && fmdWalk.result.notifiable);
// SPEC.md B3: "doodh kam ho gaya" must reach mastitis, which is why milk
// logging could be cut without losing the clinical value
const mast = walkSymptoms(tree, [false, false, true, true]);
assert.equal(mast.id, 'res_mastitis_clinical');
// answering "no" to everything must still terminate, not dead-end
let id = tree.root, guard = 0;
while (!tree.results[id] && guard++ < 50) id = symptomAnswer(tree, id, false);
assert.ok(tree.results[id], 'all-no path must terminate');

// ---- inference
const labels = ['maize__blight', 'maize__healthy', 'tomato__early_blight', 'rice__blast'];
const p = softmax([2.0, 1.0, 3.0, 0.5]);
assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
// without the crop, tomato wins; knowing the plot is maize flips it to maize
assert.equal(labels[p.indexOf(Math.max(...p))], 'tomato__early_blight');
const masked = maskToCrop(p, labels, 'maize');
assert.equal(labels[masked.indexOf(Math.max(...masked))], 'maize__blight');
assert.ok(Math.abs(masked.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'mask must renormalize');
assert.equal(masked[2], 0, 'other crops must be zeroed');
// masking raises confidence, which is the whole point
assert.ok(Math.max(...masked) > Math.max(...p));
// unknown crop must not blank the answer
assert.deepEqual(maskToCrop(p, labels, 'banana'), p);
// temperature scaling flattens confidence
assert.ok(Math.max(...softmax([2, 1, 3, 0.5], 2.5)) < Math.max(...p));

console.log('domain ok');
