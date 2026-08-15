// Backend calls. Nothing here is on the critical path of a scan: the model is
// on the phone and every write goes to SQLite first. If all of this fails the
// app still works, which is the point.
import { unsynced, markSynced, plots as localPlots, animals as localAnimals } from './db';

// EXPO_PUBLIC_* is inlined at bundle time, so baking the backend URL into the
// APK means a 20-minute rebuild every time it moves: Render, then a laptop's
// LAN address when the hall wifi blocks it, then back. The compiled value is
// only the default; Settings can override it and the override wins.
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_BASE = process.env.EXPO_PUBLIC_API || 'https://bahi-backend.onrender.com';
const KEY = 'bahi.api_base';

let BASE = DEFAULT_BASE;

export function apiBase() {
  return BASE;
}

export async function loadApiBase() {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v) BASE = v;
  } catch {}
  return BASE;
}

export async function setApiBase(url) {
  BASE = (url || '').trim().replace(/\/+$/, '') || DEFAULT_BASE;
  try {
    await AsyncStorage.setItem(KEY, BASE);
  } catch {}
  return BASE;
}

/**
 * Errors carry `status` when the server answered and `offline` when it did not.
 * Callers have to be able to tell those apart: a 404 shown to the farmer as
 * "you have no internet" is a lie, and it hid a real bug for a whole build.
 */
export class ApiError extends Error {
  constructor(message, { status = null, offline = false, body = null } = {}) {
    super(message);
    this.status = status;
    this.offline = offline;
    this.body = body;
  }
}

async function call(path, opts = {}, timeoutMs = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let r;
  try {
    r = await fetch(BASE + path, {
      ...opts,
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
  } catch (e) {
    // fetch only rejects when the request never got an answer
    throw new ApiError(`${path}: ${e.message}`, { offline: true });
  } finally {
    clearTimeout(t);
  }
  if (!r.ok) {
    let body = null;
    try { body = await r.text(); } catch {}
    throw new ApiError(`${path} ${r.status}`, { status: r.status, body });
  }
  return r.json();
}

export async function online() {
  try {
    await call('/health', {}, 4000);
    return true;
  } catch {
    return false;
  }
}

// Profile rows are small, mutable and few, so they are pushed wholesale rather
// than queued. The event log is the append-only part; this is not.
export async function pushProfile(farmer) {
  const [ps, as] = await Promise.all([localPlots(farmer.id), localAnimals(farmer.id)]);
  return call('/profile', {
    method: 'POST',
    body: JSON.stringify({ farmer, plots: ps, animals: as }),
  });
}

// SPEC.md E3, the entire sync layer. Append-only events cannot conflict, so
// this is a batch POST and a flag update. Do not build a sync engine.
export async function flush(farmer) {
  // The server needs the farmer, plots and animals before the events referring
  // to them mean anything to /advise.
  if (farmer) { try { await pushProfile(farmer); } catch {} }

  const rows = await unsynced();
  if (!rows.length) return { sent: 0 };
  const body = rows.map((r) => ({
    id: r.id, farmer_id: r.farmer_id, plot_id: r.plot_id, animal_id: r.animal_id,
    type: r.type, data: r.data, confidence: r.confidence,
    lat: r.lat, lng: r.lng, at: r.at,
  }));
  await call('/sync', { method: 'POST', body: JSON.stringify(body) });
  await markSynced(rows.map((r) => r.id));
  return { sent: rows.length };
}

/**
 * The server cannot answer about a farmer it has never seen, and the phone is
 * the source of truth, so the profile goes up first. Skipping this is what made
 * every question after "delete my records" come back as 404 unknown farmer,
 * which the UI then reported as having no internet.
 */
export async function advise(farmer_id, question, lang = 'Hindi', farmer = null) {
  if (farmer) { try { await pushProfile(farmer); } catch {} }
  return call('/advise', {
    method: 'POST',
    body: JSON.stringify({ farmer_id, question, lang }),
  }, 45000);
}

export function escalate(farmer_id, event_id, tier, reason) {
  return call('/escalate', {
    method: 'POST',
    body: JSON.stringify({ farmer_id, event_id, tier, reason }),
  });
}

export function weather(lat, lng) {
  return call(`/weather?lat=${lat}&lng=${lng}`);
}

// Only for devices where the bundled model failed to load (SPEC.md 6.1).
export function predictCloud(image_b64, crop) {
  return call('/predict', { method: 'POST', body: JSON.stringify({ image_b64, crop }) }, 30000);
}
