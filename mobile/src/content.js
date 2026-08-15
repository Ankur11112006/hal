// Bundled content. Copied from the repo-root content/ by scripts/sync-assets.mjs.
// Blueprint 11: pitch copy, vet logic and treatment plans live in JSON so they
// can be edited the night before a demo without an Android rebuild.
export { default as schedule } from '../assets/vaccination_schedule.json';
export { default as symptomTree } from '../assets/symptom_tree.json';
export { default as treatments } from '../assets/treatment_plans.json';
export { default as strings } from '../assets/strings_hi.json';

import strings from '../assets/strings_hi.json';

// No hardcoded farmer-facing strings in JS. Not one.
export function t(key, vars) {
  let s = strings[key];
  if (s === undefined) {
    if (__DEV__) console.warn(`missing string: ${key}`);
    return key;
  }
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(vars[k]);
  return s;
}

// The model emits a canonical id; the word the farmer sees is chosen here,
// last, from their own state and language (SPEC.md E1b).
export function localize(canonicalId, glossary) {
  if (glossary && glossary[canonicalId]) return glossary[canonicalId];
  return strings[`label.${canonicalId}`] || canonicalId;
}
