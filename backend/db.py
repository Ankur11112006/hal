"""SQLite schema for HAL. SPEC.md section 5, one event table.

Postgres/Supabase is the production target but the DDL below is plain SQL and
the only Postgres-ism in SPEC.md was JSONB, which is TEXT here. Swap the driver
when you swap the host; nothing else in the app knows the difference.

The event table is APPEND-ONLY. That is why there is no sync engine: two
devices cannot edit the same row, so there is nothing to merge (SPEC.md E3).
"""
import json
import os
import pathlib
import sqlite3
import uuid

# Render's free tier has no persistent disk, so this is ephemeral there and is
# wiped on redeploy. The phone owns the event log (SPEC.md E3) and the server
# holds a synced copy, so losing it is survivable ONLY because the phone can be
# told to send everything again: see BOOT_ID below. Point BAHI_DB at a real
# volume, or swap to Postgres, before any of it matters.
DB_PATH = pathlib.Path(os.environ.get("BAHI_DB", pathlib.Path(__file__).parent / "bahi.db"))

# New value on every process start, which on Render means every redeploy, which
# is also every wipe. /health hands it to the phone; a phone that sees a value
# it does not recognise re-sends its whole event log. Without this the server's
# copy stays empty forever after a deploy: the phone has already marked those
# rows synced and will never offer them again, so /advise answers "koi record
# nahi mila" about a farm whose entire history is sitting on the device.
BOOT_ID = uuid.uuid4().hex[:12]

SCHEMA = """
CREATE TABLE IF NOT EXISTS farmer (
  id TEXT PRIMARY KEY, phone TEXT UNIQUE, name TEXT, village TEXT, pincode TEXT,
  state TEXT, lang TEXT DEFAULT 'hi', gender TEXT, is_landless INTEGER DEFAULT 0,
  household_id TEXT, vlae_id TEXT, is_demo INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plot (
  id TEXT PRIMARY KEY, farmer_id TEXT NOT NULL REFERENCES farmer(id),
  name TEXT, area_ha REAL, area_local_value REAL, area_local_unit TEXT,
  lat REAL, lng REAL, current_crop TEXT,
  soil_type TEXT, soil_n REAL, soil_p REAL, soil_k REAL, soil_ph REAL,
  is_demo INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS animal (
  id TEXT PRIMARY KEY, farmer_id TEXT NOT NULL REFERENCES farmer(id),
  name TEXT, species TEXT, breed TEXT, dob TEXT, photo_url TEXT, tag_id TEXT,
  last_calving TEXT, last_insemination TEXT, is_demo INTEGER DEFAULT 0
);

-- The product. Crop events and animal events share this table; splitting it
-- destroys the timeline, the cross-domain advisory and the outbreak map.
CREATE TABLE IF NOT EXISTS event (
  id TEXT PRIMARY KEY, farmer_id TEXT NOT NULL REFERENCES farmer(id),
  plot_id TEXT REFERENCES plot(id), animal_id TEXT REFERENCES animal(id),
  type TEXT NOT NULL, data TEXT DEFAULT '{}',
  photo_url TEXT, confidence REAL, lat REAL, lng REAL,
  at TEXT NOT NULL, synced INTEGER DEFAULT 1, is_demo INTEGER DEFAULT 0,
  -- A scan or a symptom check is allowed to have no plot and no animal. The app
  -- lets a farmer photograph a leaf before they have entered a single field,
  -- deliberately, because that is the first thing anyone does. This constraint
  -- used to reject those rows, and since /sync inserted the batch as one unit,
  -- one plotless scan silently blocked every other event from ever syncing.
  CHECK (plot_id IS NOT NULL OR animal_id IS NOT NULL
         OR type IN ('note','weather','disease_detected','symptom_flagged'))
);
CREATE INDEX IF NOT EXISTS idx_event_farmer_at ON event(farmer_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_event_animal ON event(animal_id, type, at DESC);

CREATE TABLE IF NOT EXISTS advisory (
  id TEXT PRIMARY KEY, farmer_id TEXT NOT NULL, event_id TEXT,
  question TEXT, answer_json TEXT, sources TEXT, confidence TEXT, tier TEXT,
  rating INTEGER, at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS thread (
  id TEXT PRIMARY KEY, farmer_id TEXT, crop_or_species TEXT, title TEXT,
  body TEXT, photo_url TEXT, district TEXT, status TEXT DEFAULT 'open',
  at TEXT DEFAULT (datetime('now')), is_demo INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS reply (
  id TEXT PRIMARY KEY, thread_id TEXT REFERENCES thread(id), author_id TEXT,
  author_role TEXT, body TEXT, upvotes INTEGER DEFAULT 0,
  at TEXT DEFAULT (datetime('now'))
);

-- Regional vocabulary (SPEC.md E1b). Nothing ships without validated_by.
CREATE TABLE IF NOT EXISTS term (
  id INTEGER PRIMARY KEY AUTOINCREMENT, canonical_id TEXT NOT NULL, kind TEXT,
  lang TEXT, state TEXT, local_term TEXT, is_primary INTEGER DEFAULT 0,
  validated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_term_lookup ON term(canonical_id, state, lang);

CREATE TABLE IF NOT EXISTS unit_conversion (
  local_unit TEXT, state TEXT, hectares REAL, source TEXT,
  PRIMARY KEY (local_unit, state)
);

CREATE TABLE IF NOT EXISTS escalation (
  id TEXT PRIMARY KEY, case_no TEXT UNIQUE, farmer_id TEXT, event_id TEXT,
  tier TEXT, reason TEXT, status TEXT DEFAULT 'open',
  at TEXT DEFAULT (datetime('now')), resolved_at TEXT, resolution TEXT
);

CREATE TABLE IF NOT EXISTS notification (
  id TEXT PRIMARY KEY, farmer_id TEXT, channel TEXT, content TEXT,
  scheduled_at TEXT, sent_at TEXT
);
"""


def conn():
    c = sqlite3.connect(DB_PATH, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


def init():
    with conn() as c:
        c.executescript(SCHEMA)
    return DB_PATH


def new_id() -> str:
    return uuid.uuid4().hex[:16]


def rows(c, sql, args=()) -> list[dict]:
    return [dict(r) for r in c.execute(sql, args).fetchall()]


def insert_event(c, farmer_id, type, at, plot_id=None, animal_id=None, data=None,
                 photo_url=None, confidence=None, lat=None, lng=None, is_demo=0) -> str:
    eid = new_id()
    c.execute(
        "INSERT INTO event (id,farmer_id,plot_id,animal_id,type,data,photo_url,"
        "confidence,lat,lng,at,synced,is_demo) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)",
        (eid, farmer_id, plot_id, animal_id, type, json.dumps(data or {}, ensure_ascii=False),
         photo_url, confidence, lat, lng, at, is_demo))
    return eid


def timeline(c, farmer_id, limit=50) -> list[dict]:
    """SPEC.md C1: the entire feature is one query over one table."""
    out = rows(c, """
        SELECT e.*, p.name AS plot_name, p.current_crop, a.name AS animal_name, a.species
        FROM event e
        LEFT JOIN plot p ON p.id = e.plot_id
        LEFT JOIN animal a ON a.id = e.animal_id
        WHERE e.farmer_id = ? ORDER BY e.at DESC LIMIT ?""", (farmer_id, limit))
    for r in out:
        r["data"] = json.loads(r["data"] or "{}")
    return out


def _self_check():
    global DB_PATH
    import tempfile
    DB_PATH = pathlib.Path(tempfile.mkdtemp()) / "t.db"
    init()
    with conn() as c:
        c.execute("INSERT INTO farmer (id,phone,name,state) VALUES ('f1','9','R','UP')")
        c.execute("INSERT INTO plot (id,farmer_id,name,area_ha,current_crop) "
                  "VALUES ('p1','f1','A',0.5,'maize')")
        c.execute("INSERT INTO animal (id,farmer_id,name,species) VALUES ('a1','f1','Gauri','cow')")
        insert_event(c, "f1", "disease_detected", "2025-09-12T10:00:00", plot_id="p1",
                     data={"label": "maize__northern_leaf_blight"}, confidence=0.87)
        insert_event(c, "f1", "vaccination", "2025-12-02T10:00:00", animal_id="a1",
                     data={"vaccine": "FMD"})
        t = timeline(c, "f1")
        assert len(t) == 2, t
        assert t[0]["type"] == "vaccination", "timeline must be newest first"
        assert t[1]["plot_name"] == "A" and t[1]["data"]["label"].startswith("maize")
        assert t[0]["animal_name"] == "Gauri", "crop and animal come from ONE query"
        # an event must attach to a plot or an animal
        try:
            c.execute("INSERT INTO event (id,farmer_id,type,at) VALUES ('x','f1','spray','now')")
            raise AssertionError("CHECK constraint did not fire")
        except sqlite3.IntegrityError:
            pass
    print("db ok")


if __name__ == "__main__":
    _self_check()
