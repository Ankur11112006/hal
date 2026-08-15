// Backend calls. Nothing here is on the critical path of a scan: the model is
// on the phone and every write goes to SQLite first. If all of this fails the
// app still works, which is the point.
import { unsynced, markSynced, resendAll, plots as localPlots, animals as localAnimals } from './db';

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

const BOOT_KEY = 'bahi.server_boot';

export async function online() {
  try {
    // 4s was too tight. A cold Render instance takes ~50s to wake, and even a
    // warm one over a slow rural link spends a second or two on the TLS
    // handshake alone. Reporting that as "no internet" is the same mistake as
    // the advisory sheet made: a timeout is not a verdict.
    const h = await call('/health', {}, 20000);
    await checkServerRestarted(h);
    lastOnlineError = null;
    return true;
  } catch (e) {
    lastOnlineError = `${e.offline ? 'unreachable' : e.status} ${e.message}`;
    console.warn('[api] offline:', lastOnlineError, 'base=', BASE);
    return false;
  }
}

/**
 * The server's database is ephemeral. When it comes back with a boot id we have
 * not seen, its copy of this farm is gone and every event has to be offered
 * again, because the phone had already marked them synced and would otherwise
 * never mention them. Cheap because /health is polled anyway.
 */
async function checkServerRestarted(health) {
  const id = health?.boot_id;
  if (!id) return;
  const seen = await AsyncStorage.getItem(BOOT_KEY);
  if (seen === id) return;
  await AsyncStorage.setItem(BOOT_KEY, id);
  // No exemption for the first run. A fresh install has nothing marked synced,
  // so this costs an UPDATE that matches no rows; but an install upgrading from
  // a build that had no boot_id is carrying exactly the rows the server lost,
  // all of them marked synced, and skipping it would leave them stranded.
  const n = await resendAll();
  console.warn(`[api] server is new to us (${seen} -> ${id}), re-sending ${n} events`);
}

let lastOnlineError = null;
let lastSyncError = null;

export function noteSyncError(e) {
  lastSyncError = `${e.status || 'offline'} ${e.message}${e.body ? ' ' + e.body.slice(0, 120) : ''}`;
}

/** Shown in Settings so a connectivity failure is diagnosable on the phone. */
export function lastError() {
  return lastSyncError || lastOnlineError;
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
  // Profile first, and its failure is fatal to the rest: the event rows point
  // at plot and animal ids, and the server enforces those keys. Pushing events
  // to a server that has never heard of the farm gets every one of them
  // rejected, which used to read as a bare 500 with no clue why.
  if (farmer) await pushProfile(farmer);

  const rows = await unsynced();
  if (!rows.length) return { sent: 0 };
  const body = rows.map((r) => ({
    id: r.id, farmer_id: r.farmer_id, plot_id: r.plot_id, animal_id: r.animal_id,
    type: r.type, data: r.data, confidence: r.confidence,
    lat: r.lat, lng: r.lng, at: r.at,
  }));
  const res = await call('/sync', { method: 'POST', body: JSON.stringify(body) });

  // Only what the server actually kept is marked synced. Rejected rows stay
  // queued and get retried, which is noisy but is the only version that cannot
  // quietly lose a farmer's record.
  const bad = new Set((res.rejected || []).map((r) => r.id));
  await markSynced(rows.map((r) => r.id).filter((id) => !bad.has(id)));
  if (bad.size) console.warn('[api] server rejected rows:', JSON.stringify(res.rejected));
  return { sent: rows.length - bad.size, rejected: res.rejected || [] };
}

/**
 * The server cannot answer about a farmer it has never seen, and the phone is
 * the source of truth, so the profile goes up first. Skipping this is what made
 * every question after "delete my records" come back as 404 unknown farmer,
 * which the UI then reported as having no internet.
 */
export async function advise(farmer_id, question, lang = 'Hindi', farmer = null) {
  // flush, not just pushProfile. The answer is only worth anything if the
  // server has this farm's timeline, and waiting for the 30-second beat means
  // the first question after a restart gets answered about an empty farm.
  if (farmer) {
    try { await flush(farmer); } catch (e) { noteSyncError(e); console.warn('[advise] sync first failed:', e.message); }
  }
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
