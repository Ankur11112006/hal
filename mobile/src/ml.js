// On-device crop disease inference. The primary feature works at zero
// connectivity, which no advisory platform in India offers (blueprint 2.3).
//
// The whole point of this file is the confidence gate. An honest 85% beats a
// confident 95%: apps with 95% lab accuracy have shown under 10% field
// adoption. Below 0.60 we show NO diagnosis. Not even a guess.
import * as ImageManipulator from 'expo-image-manipulator';
import { Asset } from 'expo-asset';
import jpeg from 'jpeg-js';
import { Buffer } from 'buffer';
import { routeConfidence } from './theme';
import { maskToCrop, softmax } from './domain';

const SIZE = 224;

let model = null;
let labels = null;
let meta = { temperature: 1.0, img_size: SIZE };
let loadError = null;

export async function load() {
  if (model || loadError) return model;
  try {
    const { loadTensorflowModel } = require('react-native-fast-tflite');
    labels = require('../assets/labels.json');
    meta = require('../assets/metrics.json');
    // Two separate things had to be right here, and both failed silently.
    //
    // 1. v3 requires the delegates argument. Passing one argument throws.
    //    [] means the default CPU delegate; 'android-gpu' is faster on some
    //    devices and silently wrong on others, not worth it on a 2 MB model.
    //
    // 2. require() cannot be handed to the library in a RELEASE build. Metro
    //    serves dev assets over http, so the native side gets a real URL; in
    //    release the asset is compiled into res/ and resolves to a bare
    //    resource name, which the library passes to new URL():
    //      MalformedURLException: no protocol: assets_crop_model
    //    expo-asset unpacks it out of the APK to a file:// path, which works
    //    in both. This is why the bug was invisible until a release build ran
    //    on a real device.
    const asset = Asset.fromModule(require('../assets/crop_model.tflite'));
    await asset.downloadAsync();
    const uri = asset.localUri || asset.uri;
    if (!uri) throw new Error('crop_model.tflite did not resolve to a file uri');
    model = await loadTensorflowModel({ url: uri }, []);
    console.log('[ml] model loaded from', uri);
  } catch (e) {
    // Blueprint 13 risk register: if the model cannot load, the app must still
    // run so all three tier screens stay rehearsable. But the reason has to be
    // visible, or a silent fallback looks exactly like success.
    loadError = e;
    console.warn('[ml] on-device model unavailable, using stub:', e?.message || e);
  }
  return model;
}

/** Surfaced in Settings so a failure is diagnosable on the device itself. */
export function status() {
  if (model) return { ok: true, detail: `${labelList().length} classes, on-device` };
  return { ok: false, detail: loadError ? String(loadError.message || loadError) : 'not loaded' };
}

export function labelList() {
  return Array.isArray(labels) ? labels : STUB_LABELS;
}

export function isReal() {
  return !!model;
}

// Surfaced in Settings. A whole build silently ran on the stub because this
// message was caught and thrown away, and the only symptom was one line of
// small text saying "demo mode".
export function loadErrorMessage() {
  return loadError ? String(loadError.message || loadError).slice(0, 120) : null;
}

// Resize on device before anything else. 224 is the model input anyway, and it
// turns a 4MB photo into ~40KB, which is what makes the cloud fallback usable
// on 2G (SPEC.md optimization rule 2).
export async function prepare(uri) {
  const r = await ImageManipulator.manipulateAsync(
    uri, [{ resize: { width: SIZE, height: SIZE } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true });
  return r;
}

function toTensor(base64) {
  const raw = jpeg.decode(Buffer.from(base64, 'base64'), { useTArray: true });
  const { width, height, data } = raw;                 // RGBA
  const out = new Float32Array(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    const sy = Math.min(height - 1, Math.floor((y * height) / SIZE));
    for (let x = 0; x < SIZE; x++) {
      const sx = Math.min(width - 1, Math.floor((x * width) / SIZE));
      const s = (sy * width + sx) * 4;
      const d = (y * SIZE + x) * 3;
      out[d] = data[s];                                 // MobileNetV3 carries
      out[d + 1] = data[s + 1];                         // its own preprocessing,
      out[d + 2] = data[s + 2];                         // so feed raw 0-255
    }
  }
  return out;
}

/**
 * @param {string} uri        photo on disk
 * @param {string|null} crop  the plot's crop, if the plot is registered
 * @returns {{label, confidence, tier, cropConditioned, probs, stub}}
 */
export async function classify(uri, crop = null) {
  await load();
  const prepared = await prepare(uri);
  const list = labelList();

  if (!model) return stub(list, crop, prepared);

  // run() takes and returns ArrayBuffer[], not typed arrays. Handing it a
  // Float32Array directly, or reading the result as one, silently produces
  // garbage rather than an error.
  const input = toTensor(prepared.base64);
  const out = await model.run([input.buffer]);
  const logits = Array.from(new Float32Array(out[0]));

  // Temperature scaling is what makes the gate mean anything. Without it,
  // "85% confident" is just a raw softmax number and the three-tier routing
  // is decoration (SPEC.md 4.1 step 6).
  let probs = softmax(logits, meta.temperature || 1);
  const conditioned = !!crop && list.some((l) => l.startsWith(crop + '__'));
  if (conditioned) probs = maskToCrop(probs, list, crop);

  let best = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
  const confidence = probs[best];

  return {
    label: list[best],
    confidence,
    tier: routeConfidence(confidence),
    cropConditioned: conditioned,
    uri: prepared.uri,
    base64: prepared.base64,
    stub: false,
  };
}

// ---------------------------------------------------------------- stub
// Cycles through the three tiers so the whole result screen can be built and
// rehearsed before the .tflite lands. Set STUB_CONFIDENCE to force a tier.
const STUB_LABELS = [
  'maize__northern_leaf_blight', 'maize__healthy', 'tomato__late_blight',
  'wheat__stripe_rust', 'rice__blast', 'potato__late_blight',
];
export let STUB_CONFIDENCE = null;
export function setStubConfidence(v) { STUB_CONFIDENCE = v; }

let stubTurn = 0;
function stub(list, crop, prepared) {
  const cycle = [0.91, 0.72, 0.44];
  const confidence = STUB_CONFIDENCE ?? cycle[stubTurn++ % cycle.length];
  const pool = crop ? list.filter((l) => l.startsWith(crop + '__')) : list;
  const label = (pool.length ? pool : list)[0];
  return {
    label, confidence, tier: routeConfidence(confidence),
    cropConditioned: !!crop, uri: prepared.uri, base64: prepared.base64,
    stub: true,
  };
}
