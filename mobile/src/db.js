// Local SQLite. This is the source of truth, not the server.
// Every write lands here first and the UI renders immediately; the sync queue
// drains later. SPEC.md E3: the event table is append-only, so two devices can
// never edit the same row and there is nothing to merge. No sync engine.
import * as SQLite from 'expo-sqlite';
import { vaccinePlan, breedingPlan } from './domain';
import { schedule } from './content';

let db;

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS farmer (
  id TEXT PRIMARY KEY, phone TEXT, name TEXT, village TEXT, pincode TEXT,
  state TEXT, lang TEXT DEFAULT 'hi', gender TEXT, is_landless INTEGER DEFAULT 0,
  does TEXT, is_demo INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS plot (
  id TEXT PRIMARY KEY, farmer_id TEXT, name TEXT, area_ha REAL,
  area_local_value REAL, area_local_unit TEXT, lat REAL, lng REAL,
  current_crop TEXT, soil_type TEXT, is_demo INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS animal (
  id TEXT PRIMARY KEY, farmer_id TEXT, name TEXT, species TEXT, breed TEXT,
  dob TEXT, sex TEXT, photo_uri TEXT, tag_id TEXT,
  last_calving TEXT, last_insemination TEXT, is_demo INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS event (
  id TEXT PRIMARY KEY, farmer_id TEXT, plot_id TEXT, animal_id TEXT,
  type TEXT, data TEXT DEFAULT '{}', photo_uri TEXT, confidence REAL,
  lat REAL, lng REAL, at TEXT, synced INTEGER DEFAULT 0, is_demo INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_ev ON event(farmer_id, at DESC);
CREATE TABLE IF NOT EXISTS advisory (
  id TEXT PRIMARY KEY, farmer_id TEXT, question TEXT, answer_json TEXT,
  rating INTEGER, at TEXT, synced INTEGER DEFAULT 0, is_demo INTEGER DEFAULT 0);
`;

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const today = () => new Date().toISOString().slice(0, 10);

export async function open() {
  // The cached handle can be dead while still being non-null: installing over a
  // running app leaves the native database closed and every query afterwards
  // fails with "NativeDatabase.prepareAsync has been rejected, caused by
  // NullPointerException". The screen then renders with no cards and no error,
  // which is what a farmer would see if a presenter sideloaded a new build mid
  // demo. One trivial query proves the handle is alive; SQLite is in-process so
  // it costs microseconds, and it is far cheaper than a blank home screen.
  if (db) {
    try {
      await db.getFirstAsync('SELECT 1');
      return db;
    } catch (e) {
      console.warn('[db] handle was dead, reopening:', e?.message || e);
      db = null;
    }
  }
  db = await SQLite.openDatabaseAsync('hal.db');
  await db.execAsync(SCHEMA);
  // CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so
  // an install made before is_demo was added keeps the old advisory table and
  // resetDemo() dies on "no such column". Cheap to attempt, harmless to fail.
  try { await db.execAsync('ALTER TABLE advisory ADD COLUMN is_demo INTEGER DEFAULT 0'); }
  catch {}
  return db;
}

// ---------------------------------------------------------------- writes
export async function logEvent(e) {
  const d = await open();
  const id = e.id || uid();
  await d.runAsync(
    `INSERT OR REPLACE INTO event
     (id,farmer_id,plot_id,animal_id,type,data,photo_uri,confidence,lat,lng,at,synced,is_demo)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?)`,
    [id, e.farmer_id, e.plot_id ?? null, e.animal_id ?? null, e.type,
     JSON.stringify(e.data || {}), e.photo_uri ?? null, e.confidence ?? null,
     e.lat ?? null, e.lng ?? null, e.at || new Date().toISOString(), e.is_demo ? 1 : 0]);
  return id;
}

export async function addFarmer(f) {
  const d = await open();
  const id = f.id || uid();
  await d.runAsync(
    `INSERT OR REPLACE INTO farmer
     (id,phone,name,village,pincode,state,lang,gender,is_landless,does,is_demo,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, f.phone ?? null, f.name ?? null, f.village ?? null, f.pincode ?? null,
     f.state ?? 'UP', f.lang ?? 'hi', f.gender ?? null, f.is_landless ? 1 : 0,
     f.does ?? 'dono', f.is_demo ? 1 : 0, new Date().toISOString()]);
  return id;
}

export async function addPlot(p) {
  const d = await open();
  const id = p.id || uid();
  await d.runAsync(
    `INSERT OR REPLACE INTO plot
     (id,farmer_id,name,area_ha,area_local_value,area_local_unit,lat,lng,current_crop,soil_type,is_demo)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, p.farmer_id, p.name, p.area_ha ?? null, p.area_local_value ?? null,
     p.area_local_unit ?? null, p.lat ?? null, p.lng ?? null,
     p.current_crop ?? null, p.soil_type ?? null, p.is_demo ? 1 : 0]);
  if (p.current_crop && p.sown_on) {
    await logEvent({ farmer_id: p.farmer_id, plot_id: id, type: 'sowing',
      at: p.sown_on, is_demo: p.is_demo,
      data: { crop: p.current_crop, area_ha: p.area_ha } });
  }
  return id;
}

// Blueprint 4.1, the cold-start engine. Adding ONE animal writes its whole
// future vaccination and breeding calendar into the timeline right now, so the
// record is populated before the farmer has typed anything else.
export async function addAnimal(a) {
  const d = await open();
  const id = a.id || uid();
  await d.runAsync(
    `INSERT OR REPLACE INTO animal
     (id,farmer_id,name,species,breed,dob,sex,photo_uri,tag_id,last_calving,last_insemination,is_demo)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, a.farmer_id, a.name, a.species, a.breed ?? null, a.dob ?? null,
     a.sex ?? 'female', a.photo_uri ?? null, a.tag_id ?? null,
     a.last_calving ?? null, a.last_insemination ?? null, a.is_demo ? 1 : 0]);
  return { id, generated: await generateSchedule({ ...a, id }) };
}

// Generated rows are derived, never authored, so this clears its own previous
// output first and is safe to call any time the underlying facts change: after
// a vaccination is recorded, after an insemination, after seeding history.
const GENERATED = ['vaccine_due', 'expected_heat', 'expected_calving',
                   'dry_off', 'transition_feed', 'pd_check'];

export async function generateSchedule(animal) {
  const d = await open();
  await d.runAsync(
    `DELETE FROM event WHERE animal_id = ? AND type IN (${GENERATED.map(() => '?').join(',')})`,
    [animal.id, ...GENERATED]);

  const done = await animalEvents(animal.id);
  const plan = vaccinePlan(animal, schedule, done);
  const breed = breedingPlan(animal, schedule.breeding);
  let n = 0;
  for (const v of plan) {
    await logEvent({
      farmer_id: animal.farmer_id, animal_id: animal.id, type: 'vaccine_due',
      at: v.due, is_demo: animal.is_demo,
      data: { vaccine: v.vaccine, label: v.label, funding: v.funding, why: v.why,
              no_record: !v.lastDone },
    });
    n++;
  }
  for (const b of breed) {
    await logEvent({
      farmer_id: animal.farmer_id, animal_id: animal.id, type: b.kind,
      at: b.on, is_demo: animal.is_demo, data: { window: b.window || null },
    });
    n++;
  }
  return n;
}

export async function markVaccineDone(animal, vaccine) {
  await logEvent({ farmer_id: animal.farmer_id, animal_id: animal.id,
    type: 'vaccination', at: today(), data: { vaccine } });
  await generateSchedule(animal);       // the next due date falls out of this
  const plan = vaccinePlan(animal, schedule, await animalEvents(animal.id));
  return plan.find((p) => p.vaccine === vaccine);
}

// ---------------------------------------------------------------- reads
const parse = (rows) => rows.map((r) => ({ ...r, data: JSON.parse(r.data || '{}') }));

// SPEC.md C1: crop rows and animal rows come out of ONE query. This is the
// whole product. Two tables here and the differentiator is gone.
export async function timeline(farmer_id, limit = 100) {
  const d = await open();
  return parse(await d.getAllAsync(
    `SELECT e.*, p.name AS plot_name, p.current_crop, a.name AS animal_name, a.species
     FROM event e
     LEFT JOIN plot p ON p.id = e.plot_id
     LEFT JOIN animal a ON a.id = e.animal_id
     WHERE e.farmer_id = ? ORDER BY e.at DESC LIMIT ?`, [farmer_id, limit]));
}

// Blueprint 15: three zones. Upcoming is generated, so it is never empty.
export async function timelineZones(farmer_id) {
  const all = await timeline(farmer_id, 300);
  const t = today();
  return {
    upcoming: all.filter((e) => e.at.slice(0, 10) > t).reverse(),
    today: all.filter((e) => e.at.slice(0, 10) === t),
    past: all.filter((e) => e.at.slice(0, 10) < t),
  };
}

export async function plots(farmer_id) {
  const d = await open();
  return d.getAllAsync('SELECT * FROM plot WHERE farmer_id=?', [farmer_id]);
}
export async function animals(farmer_id) {
  const d = await open();
  return d.getAllAsync('SELECT * FROM animal WHERE farmer_id=?', [farmer_id]);
}
export async function animalEvents(animal_id) {
  const d = await open();
  return parse(await d.getAllAsync(
    'SELECT * FROM event WHERE animal_id=? ORDER BY at DESC', [animal_id]));
}
export async function farmer(id) {
  const d = await open();
  return d.getFirstAsync('SELECT * FROM farmer WHERE id=?', [id]);
}
export async function anyFarmer() {
  const d = await open();
  return d.getFirstAsync('SELECT * FROM farmer ORDER BY created_at DESC LIMIT 1');
}

export async function dueVaccines(farmer_id) {
  const d = await open();
  const rows = parse(await d.getAllAsync(
    `SELECT e.*, a.name AS animal_name FROM event e JOIN animal a ON a.id=e.animal_id
     WHERE e.farmer_id=? AND e.type='vaccine_due' ORDER BY e.at ASC`, [farmer_id]));
  const t = today();
  return rows
    .map((r) => ({
      ...r,
      daysLeft: Math.round((new Date(r.at) - new Date(t)) / 86400000),
      overdue: r.at.slice(0, 10) < t,
      noRecord: !!r.data.no_record,
    }))
    // A recorded dose that has expired is a FACT. A missing row is only an
    // inference, and one interval of it is not evidence of anything. Sorting
    // them together buried गौरी's genuinely overdue FMD under two vaccines
    // nobody had ever written down.
    .sort((a, b) => (a.noRecord - b.noRecord) || (a.daysLeft - b.daysLeft));
}

// ---------------------------------------------------------------- sync
export async function unsynced() {
  const d = await open();
  return parse(await d.getAllAsync('SELECT * FROM event WHERE synced = 0 LIMIT 200'));
}
export async function markSynced(ids) {
  if (!ids.length) return;
  const d = await open();
  await d.runAsync(
    `UPDATE event SET synced = 1 WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
}

/**
 * Offer the whole log again. The server's copy lives on a free tier with no
 * disk and is wiped on every redeploy; once these rows are marked synced the
 * phone never offers them again, so without this the server stays empty and
 * the advisory answers "no record" about a farm with two years of history.
 * Called only when /health reports a server we have not talked to before.
 */
export async function resendAll() {
  const d = await open();
  const r = await d.runAsync('UPDATE event SET synced = 0 WHERE synced = 1');
  return r.changes;
}

// ---------------------------------------------------------------- DPDP
// SPEC.md E8: one tap, and it must report the real count deleted.
export async function deleteEverything() {
  const d = await open();
  let n = 0;
  for (const t of ['event', 'advisory', 'plot', 'animal', 'farmer']) {
    const r = await d.getFirstAsync(`SELECT COUNT(*) c FROM ${t}`);
    n += r.c;
    await d.runAsync(`DELETE FROM ${t}`);
  }
  return n;
}

// Judges tap around. Re-seeding before each run keeps the demo timeline clean.
export async function resetDemo() {
  const d = await open();
  for (const t of ['event', 'advisory', 'plot', 'animal', 'farmer']) {
    // One table missing the column must not take the whole seed down with it.
    // It did: the demo button silently did nothing for an entire build.
    try { await d.runAsync(`DELETE FROM ${t} WHERE is_demo = 1`); }
    catch (e) { console.warn(`[db] resetDemo skipped ${t}:`, e?.message || e); }
  }
}
