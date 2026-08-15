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

export function speak(text, lang = 'hi', onDone) {
  if (!text) return;
  stop();
  speaking = text;
  Speech.speak(text, {
    language: LOCALE[lang] || 'hi-IN',
    rate,
    onDone: () => { speaking = null; onDone && onDone(); },
    onStopped: () => { speaking = null; onDone && onDone(); },
    onError: () => { speaking = null; onDone && onDone(); },
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
