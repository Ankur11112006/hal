"""HAL backend. FastAPI on Render.

The phone is offline-first and owns its own SQLite; this server exists for the
four things a phone cannot do alone: RAG advisory, cloud fallback inference,
daily feeds, and holding the synced copy of the append-only event log.
"""
import base64
import datetime as dt
import io
import json
import os
import pathlib

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import advise as A
import db

CONTENT = pathlib.Path(__file__).parent.parent / "content"
ARTIFACTS = pathlib.Path(__file__).parent.parent / "artifacts"

app = FastAPI(title="HAL", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def _startup():
    db.init()
    A.kb()          # build the index once, not per request


def _schedule():
    return json.loads((CONTENT / "vaccination_schedule.json").read_text(encoding="utf-8"))


# ------------------------------------------------------------------ health
@app.get("/health")
def health():
    with db.conn() as c:
        n = c.execute("SELECT COUNT(*) n FROM event").fetchone()["n"]
    return {"ok": True, "events": n, "kb_docs": len(A.kb().docs),
            "model_present": (ARTIFACTS / "crop_model.tflite").exists()}


# ------------------------------------------------------------------ sync
class EventIn(BaseModel):
    id: str | None = None
    farmer_id: str
    plot_id: str | None = None
    animal_id: str | None = None
    type: str
    data: dict = Field(default_factory=dict)
    photo_url: str | None = None
    confidence: float | None = None
    lat: float | None = None
    lng: float | None = None
    at: str


@app.post("/sync")
def sync(events: list[EventIn]):
    """Append-only, so this is an upsert-by-id and there is nothing to merge.
    Re-sending the same batch is safe (SPEC.md E3)."""
    written = 0
    with db.conn() as c:
        for e in events:
            eid = e.id or db.new_id()
            if c.execute("SELECT 1 FROM event WHERE id=?", (eid,)).fetchone():
                continue
            c.execute(
                "INSERT INTO event (id,farmer_id,plot_id,animal_id,type,data,photo_url,"
                "confidence,lat,lng,at,synced) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)",
                (eid, e.farmer_id, e.plot_id, e.animal_id, e.type,
                 json.dumps(e.data, ensure_ascii=False), e.photo_url, e.confidence,
                 e.lat, e.lng, e.at))
            written += 1
    return {"received": len(events), "written": written}


class ProfileIn(BaseModel):
    """Events alone are not enough. /advise resolves the farmer's state for the
    glossary, joins plot and animal names into the timeline, and computes
    vaccine-due from the animal table. Without these rows the cross-domain
    answer degrades to a list of anonymous ids, which is the one thing the
    whole product is for.
    """
    farmer: dict
    plots: list[dict] = Field(default_factory=list)
    animals: list[dict] = Field(default_factory=list)


def _upsert(c, table, row, cols):
    row = {k: row.get(k) for k in cols}
    ph = ",".join("?" * len(cols))
    c.execute(f"INSERT OR REPLACE INTO {table} ({','.join(cols)}) VALUES ({ph})",
              [row[k] for k in cols])


@app.post("/profile")
def profile(body: ProfileIn):
    with db.conn() as c:
        _upsert(c, "farmer", body.farmer,
                ["id", "phone", "name", "village", "pincode", "state", "lang",
                 "gender", "is_landless", "household_id", "is_demo"])
        for p in body.plots:
            _upsert(c, "plot", p,
                    ["id", "farmer_id", "name", "area_ha", "area_local_value",
                     "area_local_unit", "lat", "lng", "current_crop", "soil_type", "is_demo"])
        for a in body.animals:
            _upsert(c, "animal", a,
                    ["id", "farmer_id", "name", "species", "breed", "dob", "photo_url",
                     "tag_id", "last_calving", "last_insemination", "is_demo"])
    return {"plots": len(body.plots), "animals": len(body.animals)}


@app.get("/timeline/{farmer_id}")
def timeline(farmer_id: str, limit: int = 50):
    with db.conn() as c:
        return db.timeline(c, farmer_id, limit)


# ------------------------------------------------------------------ vaccination
@app.get("/vaccine-due/{farmer_id}")
def vaccine_due(farmer_id: str):
    """SPEC.md B2: last dose per animal per vaccine, compared to the schedule.
    A WHERE clause and some date arithmetic. No ML."""
    sched = _schedule()
    today = dt.date.today()
    out = []
    with db.conn() as c:
        animals = db.rows(c, "SELECT * FROM animal WHERE farmer_id=?", (farmer_id,))
        for a in animals:
            species = sched["aliases"].get(a["species"], a["species"])
            for v in sched["schedules"].get(species, []):
                last = c.execute(
                    "SELECT at FROM event WHERE animal_id=? AND type='vaccination' "
                    "AND json_extract(data,'$.vaccine')=? ORDER BY at DESC LIMIT 1",
                    (a["id"], v["vaccine"])).fetchone()
                due = _due_date(a, v, last["at"] if last else None, sched)
                if due is None:
                    continue
                days = (due - today).days
                if days <= v["remind_before_days"]:
                    out.append({
                        "animal_id": a["id"], "animal_name": a["name"],
                        "vaccine": v["vaccine"], "label": v["label"],
                        "due_on": due.isoformat(), "days_left": days,
                        "overdue": days < 0, "funding": v.get("funding"),
                        "last_done": last["at"][:10] if last else None,
                        "no_record": last is None,
                    })
    # A recorded dose that has expired is a FACT; a missing row is only an
    # inference, since the vaccine may well have been given before the farmer
    # started using the app. Facts first, or the inferred ones crowd out the
    # real overdue vaccine that the advisory is supposed to notice.
    out.sort(key=lambda r: (r["no_record"], r["days_left"]))
    return out


def _due_date(animal, vaccine, last_at, sched):
    """None means 'not applicable to this animal' (already done once-in-life,
    or past the eligibility window)."""
    today = dt.date.today()
    if last_at:
        if vaccine.get("lifetime_once"):
            return None
        return dt.date.fromisoformat(last_at[:10]) + dt.timedelta(days=vaccine["repeat_days"])
    if not animal.get("dob"):
        return today                    # unknown age: surface it, let the vet decide
    dob = dt.date.fromisoformat(animal["dob"][:10])
    first = dob + dt.timedelta(days=vaccine["first_dose_days"])
    if vaccine.get("eligible_until_days"):
        if today > dob + dt.timedelta(days=vaccine["eligible_until_days"]):
            return None
    # No record does not mean never given. A 5-year-old cow with no deworming
    # row is not "1,923 days overdue" - that number is nonsense, it buries the
    # genuinely overdue vaccines underneath it, and it is not something we
    # actually know. Report at most one interval late.
    repeat = vaccine.get("repeat_days")
    if repeat and first < today - dt.timedelta(days=repeat):
        return today - dt.timedelta(days=repeat)
    return first


# ------------------------------------------------------------------ advisory
class AskIn(BaseModel):
    farmer_id: str
    question: str
    lang: str = "Hindi"


@app.post("/advise")
def ask(body: AskIn):
    with db.conn() as c:
        f = c.execute("SELECT * FROM farmer WHERE id=?", (body.farmer_id,)).fetchone()
        if not f:
            raise HTTPException(404, "unknown farmer")
        events = db.timeline(c, body.farmer_id, 20)
        plot = c.execute("SELECT lat,lng FROM plot WHERE farmer_id=? AND lat IS NOT NULL "
                         "LIMIT 1", (body.farmer_id,)).fetchone()
        gloss = {r["canonical_id"]: r["local_term"] for r in db.rows(
            c, "SELECT canonical_id, local_term FROM term WHERE state=? AND lang=? "
               "AND is_primary=1", (f["state"], f["lang"]))}

        weather = A.get_weather(plot["lat"], plot["lng"]) if plot else {"available": False}
        due = vaccine_due(body.farmer_id)
        # overdue vaccines are facts about this farmer, so they belong in the
        # prompt: this is what makes the cross-domain answer possible at all
        events = events + [{
            "at": d["due_on"], "animal_name": d["animal_name"], "type": "vaccine_due",
            "data": {"vaccine": d["vaccine"], "overdue": d["overdue"],
                     "days_left": d["days_left"],
                     "status": "koi record nahi" if d["no_record"] else
                               (f"{abs(d['days_left'])} din se overdue" if d["overdue"]
                                else f"{d['days_left']} din mein")}}
            for d in due]

        ans = A.advise(body.question, events, weather, body.lang, gloss)
        c.execute("INSERT INTO advisory (id,farmer_id,question,answer_json,sources,"
                  "confidence,tier,at) VALUES (?,?,?,?,?,?,?,?)",
                  (db.new_id(), body.farmer_id, body.question,
                   json.dumps(ans, ensure_ascii=False), json.dumps(ans.get("sources", [])),
                   ans.get("confidence"), "expert" if ans.get("escalate") else "ai",
                   dt.datetime.now().isoformat(timespec="seconds")))
    return ans


@app.get("/weather")
def weather(lat: float, lng: float):
    return A.get_weather(lat, lng)


# ------------------------------------------------------------------ escalation
class EscalateIn(BaseModel):
    farmer_id: str
    event_id: str | None = None
    tier: str
    reason: str


@app.post("/escalate")
def escalate(body: EscalateIn):
    """The phone generates its own case number offline; this records the copy
    that a KVK can look up. Never promises a response time (blueprint 9)."""
    with db.conn() as c:
        n = c.execute("SELECT COUNT(*) n FROM escalation").fetchone()["n"] + 2481
        case_no = f"HL-{n}"
        c.execute("INSERT INTO escalation (id,case_no,farmer_id,event_id,tier,reason) "
                  "VALUES (?,?,?,?,?,?)",
                  (db.new_id(), case_no, body.farmer_id, body.event_id, body.tier, body.reason))
    return {"case_no": case_no, "tier": body.tier,
            "helpline": "1962" if body.tier == "vet" else "1800-180-1551"}


# ------------------------------------------------------------------ outbreak
@app.get("/outbreak")
def outbreak(days: int = 14, threshold: int = 3):
    """SPEC.md E7. Aggregation plus a threshold, only possible because every
    user writes to one shared event table."""
    since = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    with db.conn() as c:
        return db.rows(c, """
            SELECT f.pincode, json_extract(e.data,'$.label') AS label, COUNT(*) AS n
            FROM event e JOIN farmer f ON f.id = e.farmer_id
            WHERE e.type IN ('disease_detected','symptom_flagged') AND e.at > ?
            GROUP BY f.pincode, label HAVING COUNT(*) >= ?
            ORDER BY n DESC""", (since, threshold))


# ------------------------------------------------------------------ cloud fallback
class PredictIn(BaseModel):
    image_b64: str
    crop: str | None = None


@app.post("/predict")
def predict(body: PredictIn):
    """Fallback for devices where the on-device model is unavailable
    (SPEC.md 6.1). The common path never reaches here."""
    try:
        import numpy as np
        import tensorflow as tf
        from PIL import Image
    except ImportError:
        raise HTTPException(503, "server-side inference not installed on this instance")
    path = ARTIFACTS / "crop_model.tflite"
    if not path.exists():
        raise HTTPException(503, "model not deployed")
    labels = (ARTIFACTS / "labels.txt").read_text().split()
    img = Image.open(io.BytesIO(base64.b64decode(body.image_b64))).convert("RGB")
    meta = json.loads((ARTIFACTS / "metrics.json").read_text())
    size = meta.get("img_size", 224)
    x = np.asarray(img.resize((size, size)), dtype=np.float32)[None]

    it = tf.lite.Interpreter(model_path=str(path))
    it.allocate_tensors()
    inp, out = it.get_input_details()[0], it.get_output_details()[0]
    if inp["dtype"] == np.uint8 or inp["dtype"] == np.int8:
        s, z = inp["quantization"]
        x = (x / s + z).astype(inp["dtype"])
    it.set_tensor(inp["index"], x)
    it.invoke()
    logits = it.get_tensor(out["index"]).astype(np.float32)
    if out["dtype"] in (np.uint8, np.int8):
        s, z = out["quantization"]
        logits = (logits - z) * s
    return _route(logits[0], labels, meta.get("temperature", 1.0), body.crop)


def _route(logits, labels, temperature, crop):
    import numpy as np
    z = logits / temperature
    p = np.exp(z - z.max())
    p = p / p.sum()
    if crop:                                   # SPEC.md A1 crop-conditioned inference
        mask = np.array([l.startswith(f"{crop}__") for l in labels])
        if mask.any():
            p = np.where(mask, p, 0)
            p = p / p.sum()
    i = int(p.argmax())
    conf = float(p[i])
    tier = "auto" if conf > 0.85 else ("verify" if conf >= 0.60 else "expert")
    return {"label": labels[i] if tier != "expert" else None,
            "confidence": conf, "tier": tier, "crop_conditioned": bool(crop)}
