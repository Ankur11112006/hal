// Speech. Blueprint 6.4 law 3: every advisory text block has a working speaker
// button, because a low-literacy farmer will not read a 200-word treatment plan.
//
// Bhashini is the production TTS (government DPI, 22 languages). The device
// engine is the fallback that is wired first, deliberately: the blueprint risk
// register rates "Bhashini fails on hall wifi" as high, and a speaker button
// that does nothing on stage is worse than no speaker button.
import * as Speech from 'expo-speech';

const LOCALE = { hi: 'hi-IN', en: 'en-IN', mr: 'mr-IN', pa: 'pa-IN', bn: 'bn-IN' };

let speaking = null;

// Slightly slow by default. Settings can change it, because a farmer hearing
// this for the first time and one who has used it for a month want different
// speeds, and neither should have to put up with the other's.
export const RATES = { slow: 0.72, normal: 0.92, fast: 1.15 };
let rate = RATES.normal;

export function setRate(name) {
  rate = RATES[name] ?? RATES.normal;
  return name;
}
export function rateName() {
  return Object.keys(RATES).find((k) => RATES[k] === rate) || 'normal';
}

// Which locales this phone can actually speak. Hindi and English ship on
// essentially every Indian Android; Marathi often does not, and a missing voice
// makes Speech.speak do nothing at all. A speaker button that silently does
// nothing is the failure this whole module exists to avoid, so ask once and
// fall back to Hindi, which at least reads Devanagari aloud and is understood
// across the Marathi belt. Better a Hindi accent than silence.
let installed = null;
let fellBackTo = null;

async function loadVoices() {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    installed = new Set(voices.map((v) => (v.language || '').toLowerCase()));
  } catch {
    installed = new Set();           // could not ask; assume nothing and fall back
  }
}
loadVoices();

/** Non-null when the last speak used a different language than asked for.
 *  Settings shows it, so "the voice sounds wrong" is diagnosable on the phone. */
export function voiceFallback() {
  return fellBackTo;
}

function pickLocale(lang) {
  const want = LOCALE[lang] || 'hi-IN';
  // Voices not loaded yet, or the exact locale is present: use it.
  if (installed === null || installed.has(want.toLowerCase())) {
    fellBackTo = null;
    return want;
  }
  // Some engines report "mr" rather than "mr-IN".
  if (installed.has(want.slice(0, 2))) {
    fellBackTo = null;
    return want;
  }
  fellBackTo = `${want} not installed, speaking hi-IN`;
  console.warn('[voice]', fellBackTo);
  return 'hi-IN';
}

export function speak(text, lang = 'hi', onDone) {
  if (!text) return;
  stop();
  speaking = text;
  Speech.speak(text, {
    language: pickLocale(lang),
    rate,
    onDone: () => { speaking = null; onDone && onDone(); },
    onStopped: () => { speaking = null; onDone && onDone(); },
    onError: (e) => {
      // Was swallowed. A dead speaker button looked identical to a working one.
      console.warn('[voice] speak failed:', e?.message || e);
      speaking = null;
      onDone && onDone();
    },
  });
}

export function stop() {
  Speech.stop();
  speaking = null;
}

export function isSpeaking() {
  return speaking !== null;
}

// Read a whole advisory card aloud in the order a person would say it,
// not in DOM order.
export function speakAdvisory(a, lang = 'hi') {
  speak([a.action, a.quantity, a.timing, a.cost_benefit].filter(Boolean).join('. '), lang);
}
