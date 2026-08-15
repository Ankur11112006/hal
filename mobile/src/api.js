// Backend calls. Nothing here is on the critical path of a scan: the model is
// on the phone and every write goes to SQLite first. If all of this fails the
// app still works, which is the point.
import { unsynced, markSynced, plots as localPlots, animals as localAnimals } from './db';

export const BASE = process.env.EXPO_PUBLIC_API || 'http://10.0.2.2:8000';

async function call(path, opts = {}, timeoutMs = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(BASE + path, {
      ...opts,
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
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

export function advise(farmer_id, question, lang = 'Hindi') {
  return call('/advise', {
    method: 'POST',
    body: JSON.stringify({ farmer_id, question, lang }),
  }, 30000);
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
