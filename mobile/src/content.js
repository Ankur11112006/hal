// Bundled content. Copied from the repo-root content/ by scripts/sync-assets.mjs.
// Blueprint 11: pitch copy, vet logic and treatment plans live in JSON so they
// can be edited the night before a demo without an Android rebuild.
export { default as schedule } from '../assets/vaccination_schedule.json';
export { default as symptomTree } from '../assets/symptom_tree.json';
export { default as treatments } from '../assets/treatment_plans.json';

import hi from '../assets/strings_hi.json';
import en from '../assets/strings_en.json';
import mr from '../assets/strings_mr.json';

// Every language that is actually complete. A language only appears here once
// its string file exists; the picker reads this, so a half-built language can
// never be offered. Showing a language and then rendering Hindi is worse than
// not showing it, and a judge will tap one.
//
// Marathi came next because it is written in Devanagari, so the Noto Sans
// Devanagari already in the bundle renders it with no new font and no size
// cost. Punjabi, Bengali, Telugu and Tamil each need their own script file
// before they can be offered at all, which is a real decision and not a typing
// exercise.
//
// "Complete" here means all 238 keys exist, which content/validate.py enforces.
// It does not mean a Marathi speaker has read them. strings_mr.json carries
// _validated_by: null and says so at the top.
export const BUNDLES = { hi, en, mr };
export const READY = Object.keys(BUNDLES);

let lang = 'hi';
let strings = BUNDLES.hi;

export function setLang(code) {
  lang = BUNDLES[code] ? code : 'hi';
  strings = BUNDLES[lang];
  return lang;
}
export function getLang() {
  return lang;
}

// No hardcoded farmer-facing strings in JS. Not one.
export function t(key, vars) {
  let s = strings[key];
  if (s === undefined) {
    s = BUNDLES.hi[key];                 // a missing translation shows Hindi,
    if (s === undefined) {                // never a raw key on a farmer's screen
      if (__DEV__) console.warn(`missing string: ${key}`);
      return key;
    }
  }
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(vars[k]);
  return s;
}

/**
 * Pick the current language out of a {hi, en} block from the content JSON.
 * The symptom tree, treatment plans and vaccine schedule all store both, so
 * screens must never reach for `.hi` directly.
 */
export function L(block) {
  if (!block) return '';
  if (typeof block === 'string') return block;
  return block[lang] ?? block.hi ?? block.en ?? '';
}

// The model emits a canonical id; the word the farmer sees is chosen here,
// last, from their own state and language (SPEC.md E1b).
export function localize(canonicalId, glossary) {
  if (glossary && glossary[canonicalId]) return glossary[canonicalId];
  return strings[`label.${canonicalId}`] || canonicalId;
}
