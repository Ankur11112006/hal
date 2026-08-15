// Pure offline logic. No React, no native modules, so it runs under plain
// node for the self-check in domain.test.mjs.
//
// Everything here must work with the phone in airplane mode, because all of
// it does: Day Zero, the vaccine calendar, breeding dates, the symptom tree,
// and the crop-conditioned softmax mask.

const DAY = 86400000;

export function addDays(iso, n) {
  return new Date(new Date(iso).getTime() + n * DAY).toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / DAY);
}

// ---------------------------------------------------------------- area units
// SPEC.md E1b: a bigha is NOT a fixed area in India. Storing a local unit, or
// hard-coding one conversion, makes every fertiliser dose and cost figure
// wrong by up to 3x, silently. Hectares in the database, always; convert only
// at the UI boundary using the farmer's state.
//
// VERIFY BEFORE THE DEMO: these are the commonly published values, not values
// read off a state revenue notification. A wrong number here is invisible.
export const UNITS = {
  hectare: { all: 1 },
  acre: { all: 0.404686 },
  bigha: {
    UP: 0.2529, BR: 0.2529, RJ: 0.2529, MP: 0.1112, HR: 0.1012, PB: 0.1012,
    GJ: 0.1618, WB: 0.1338, AS: 0.1338, UK: 0.0809, HP: 0.0809,
  },
  guntha: { all: 0.010117 },
  kanal: { all: 0.050586 },
  marla: { all: 0.002529 },
  cent: { all: 0.0040469 },
  katha: { BR: 0.01264, WB: 0.00669, AS: 0.01338 },
  biswa: { UP: 0.012645, RJ: 0.012645 },
};

export function unitsFor(state) {
  return Object.keys(UNITS).filter((u) => 'all' in UNITS[u] || state in UNITS[u]);
}

export function toHectares(value, unit, state) {
  const row = UNITS[unit];
  if (!row) throw new Error(`unknown unit ${unit}`);
  const f = 'all' in row ? row.all : row[state];
  if (f === undefined) {
    throw new Error(`${unit} is not defined for ${state}; ask, do not assume`);
  }
  return value * f;
}

export function fromHectares(ha, unit, state) {
  return ha / toHectares(1, unit, state);
}

// ---------------------------------------------------------------- vaccination
// Blueprint 4.1: adding ONE animal must immediately write future events, so
// the timeline is populated before the farmer types anything else.
export function vaccinePlan(animal, schedule, doneEvents = [], today = new Date()) {
  const species = schedule.aliases[animal.species] || animal.species;
  const list = schedule.schedules[species];
  if (!list) return [];
  const todayIso = today.toISOString().slice(0, 10);
  const out = [];

  for (const v of list) {
    if (v.females_only && animal.sex && animal.sex !== 'female') continue;

    const done = doneEvents
      .filter((e) => e.type === 'vaccination' && e.data && e.data.vaccine === v.vaccine)
      .sort((a, b) => (a.at < b.at ? 1 : -1));
    const last = done[0];

    let due;
    if (last) {
      if (v.lifetime_once) continue;            // already had the one dose
      due = addDays(last.at, v.repeat_days);
    } else if (animal.dob) {
      due = addDays(animal.dob, v.first_dose_days);
      if (v.eligible_until_days &&
          daysBetween(animal.dob, todayIso) > v.eligible_until_days) {
        continue;                                // window has passed
      }
      // No record does not mean never given. A 5-year-old cow with no deworming
      // row is not 1,923 days overdue: that number is nonsense, it buries the
      // genuinely overdue vaccines under it, and we do not actually know it.
      // Report at most one interval late.
      if (v.repeat_days && daysBetween(due, todayIso) > v.repeat_days) {
        due = addDays(todayIso, -v.repeat_days);
      }
    } else {
      due = todayIso;                            // unknown age: surface it
    }

    const daysLeft = daysBetween(todayIso, due);
    out.push({
      vaccine: v.vaccine, label: v.label, canonical_id: v.canonical_id,
      due, daysLeft, overdue: daysLeft < 0,
      visible: daysLeft <= v.remind_before_days,
      funding: v.funding, why: v.why, lastDone: last ? last.at.slice(0, 10) : null,
    });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

// ---------------------------------------------------------------- breeding
// SPEC.md B5. Date arithmetic on standard bovine constants. A missed heat
// costs the farmer an entire calving interval, which is the mechanism behind
// iCow's documented 13% milk increase.
export function breedingPlan(animal, b, today = new Date()) {
  const out = [];
  const todayIso = today.toISOString().slice(0, 10);

  if (animal.last_insemination) {
    const calving = addDays(animal.last_insemination, b.gestation_days);
    out.push({ kind: 'pd_check', on: addDays(animal.last_insemination, b.pd_check_after_ai_days) });
    out.push({ kind: 'dry_off', on: addDays(calving, -b.dry_off_before_calving_days) });
    out.push({ kind: 'transition_feed', on: addDays(calving, -b.transition_feed_before_calving_days) });
    out.push({ kind: 'expected_calving', on: calving });
  } else if (animal.last_calving) {
    // next heat: step the 21-day cycle forward from the first post-calving heat
    let heat = addDays(animal.last_calving, 60);
    while (heat < todayIso) heat = addDays(heat, b.heat_cycle_days);
    out.push({ kind: 'expected_heat', on: heat, window: b.ai_window });
  }
  return out.map((e) => ({ ...e, daysLeft: daysBetween(todayIso, e.on) }));
}

// ---------------------------------------------------------------- symptom tree
export function symptomStep(tree, nodeId) {
  if (tree.results[nodeId]) return { done: true, result: tree.results[nodeId], id: nodeId };
  const n = tree.nodes[nodeId];
  if (!n) throw new Error(`unknown symptom node ${nodeId}`);
  return { done: false, node: n, id: nodeId };
}

export function symptomAnswer(tree, nodeId, yes) {
  const n = tree.nodes[nodeId];
  if (!n) throw new Error(`unknown symptom node ${nodeId}`);
  return yes ? n.yes : n.no;
}

export function walkSymptoms(tree, answers) {
  let id = tree.root;
  for (const a of answers) {
    if (tree.results[id]) break;
    id = symptomAnswer(tree, id, a);
  }
  return symptomStep(tree, id);
}

// ---------------------------------------------------------------- inference
// SPEC.md A1: the plot's crop is already known from its sowing event, so mask
// the softmax to that crop's classes and renormalize. The model then picks
// among ~5 candidates instead of 30. Free accuracy, no extra training, and
// Plantix cannot do it because it has to infer the crop from the image.
export function maskToCrop(probs, labels, crop) {
  if (!crop) return probs;
  const keep = labels.map((l) => l.startsWith(crop + '__'));
  if (!keep.some(Boolean)) return probs;
  let sum = 0;
  for (let i = 0; i < probs.length; i++) if (keep[i]) sum += probs[i];
  if (sum <= 0) return probs;
  return probs.map((p, i) => (keep[i] ? p / sum : 0));
}

export function softmax(logits, temperature = 1) {
  const z = logits.map((v) => v / temperature);
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

// Offline case number. The farmer must be able to carry it to a KVK even if
// the phone never sees a network (blueprint section 9).
export function caseNumber(seed = Date.now()) {
  return 'BH-' + String(2481 + (seed % 7000));
}
