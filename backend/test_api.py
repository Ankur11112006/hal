"""Smoke test for the HAL backend. python test_api.py

Covers the paths the demo actually walks, and the two the demo depends on
being CORRECT rather than merely present:
  - the timeline returns crop and animal rows from one query
  - the FMD due date is genuinely overdue on demo day, which is the fact the
    cross-domain advisory line is built on
"""
import datetime as dt
import json
import os
import pathlib
import tempfile
import sys

os.environ["BAHI_DB"] = str(pathlib.Path(tempfile.mkdtemp()) / "test.db")
os.environ.pop("GEMINI_API_KEY", None)          # force the offline fallback path

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from fastapi.testclient import TestClient       # noqa: E402
import db                                        # noqa: E402
import main                                      # noqa: E402

db.DB_PATH = pathlib.Path(os.environ["BAHI_DB"])
main.db.DB_PATH = db.DB_PATH

F = "t-farmer"


def seed():
    db.init()
    with db.conn() as c:
        c.execute("INSERT INTO farmer (id,phone,name,village,pincode,state,lang) "
                  "VALUES (?,?,?,?,?,?,?)",
                  (F, "9000000000", "रमेश", "बाराबंकी", "225001", "UP", "hi"))
        c.execute("INSERT INTO plot (id,farmer_id,name,area_ha,lat,lng,current_crop) "
                  "VALUES ('p1',?,'नदी वाला',0.5058,26.9254,81.1861,'maize')", (F,))
        c.execute("INSERT INTO animal (id,farmer_id,name,species,dob) "
                  "VALUES ('a1',?,'गौरी','cow','2021-04-10')", (F,))
        # last year's blight on the same plot: the row the pitch rests on
        db.insert_event(c, F, "disease_detected", "2025-09-08T10:00:00", plot_id="p1",
                        data={"label": "maize__northern_leaf_blight"}, confidence=0.89)
        # FMD 8 months ago; the 180-day interval makes it overdue today
        db.insert_event(c, F, "vaccination", "2025-12-02T10:00:00", animal_id="a1",
                        data={"vaccine": "FMD"})


def main_test():
    seed()
    c = TestClient(main.app)

    h = c.get("/health").json()
    assert h["ok"] and h["kb_docs"] > 0, h
    print(f"health ok, {h['kb_docs']} kb docs")

    # --- one table, one query: crop AND animal come back together ---
    tl = c.get(f"/timeline/{F}").json()
    assert len(tl) == 2, tl
    kinds = {("crop" if r["plot_id"] else "animal") for r in tl}
    assert kinds == {"crop", "animal"}, "timeline must merge both domains"
    assert tl[0]["at"] > tl[1]["at"], "newest first"
    print("timeline ok, crop + animal from one query")

    # --- vaccination arithmetic: this is the demo's money fact ---
    due = c.get(f"/vaccine-due/{F}").json()
    fmd = [d for d in due if d["vaccine"] == "FMD"]
    assert fmd, f"FMD must appear, got {[d['vaccine'] for d in due]}"
    assert fmd[0]["overdue"], f"Dec 2025 dose must read overdue today: {fmd[0]}"
    assert fmd[0]["due_on"] == "2026-05-31", fmd[0]["due_on"]
    # brucella: a 5-year-old cow is past the 4-8 month window, must not appear
    assert not [d for d in due if d["vaccine"] == "Brucellosis"], \
        "brucella must not be offered to an adult cow"
    print(f"vaccine-due ok, FMD overdue since {fmd[0]['due_on']}")

    # --- sync is idempotent, because events are append-only ---
    ev = [{"id": "e-sync-1", "farmer_id": F, "plot_id": "p1", "type": "spray",
           "data": {"what": "मैंकोज़ेब", "cost_inr": 380},
           "at": dt.datetime.now().isoformat(timespec="seconds")}]
    assert c.post("/sync", json=ev).json()["written"] == 1
    assert c.post("/sync", json=ev).json()["written"] == 0, "resend must not duplicate"
    print("sync ok, resend is a no-op")

    # --- profile push: without it /advise has no plots, no animals, and the
    #     cross-domain line has nothing to reference ---
    prof = c.post("/profile", json={
        "farmer": {"id": "p-farmer", "name": "सीता", "state": "MH", "lang": "hi",
                   "pincode": "431203"},
        "plots": [{"id": "pp1", "farmer_id": "p-farmer", "name": "बड़ा खेत",
                   "area_ha": 0.4, "current_crop": "cotton"}],
        "animals": [{"id": "pa1", "farmer_id": "p-farmer", "name": "लक्ष्मी",
                     "species": "buffalo", "dob": "2022-01-01"}],
    }).json()
    assert prof == {"plots": 1, "animals": 1}, prof
    # re-push must update, not duplicate
    c.post("/profile", json={
        "farmer": {"id": "p-farmer", "name": "सीता देवी", "state": "MH"},
        "plots": [{"id": "pp1", "farmer_id": "p-farmer", "name": "बड़ा खेत",
                   "area_ha": 0.4, "current_crop": "cotton"}],
        "animals": [],
    })
    with db.conn() as cx:
        assert cx.execute("SELECT COUNT(*) c FROM plot WHERE farmer_id='p-farmer'"
                          ).fetchone()["c"] == 1, "re-push duplicated a plot"
        assert cx.execute("SELECT name FROM farmer WHERE id='p-farmer'"
                          ).fetchone()["name"] == "सीता देवी"
    # and now a synced animal produces a due vaccine on the server
    assert c.get("/vaccine-due/p-farmer").json(), "synced animal must yield due vaccines"
    print("profile ok, upsert is idempotent and feeds vaccine-due")

    # --- advisory falls back to a real sourced document, never a stack trace ---
    a = c.post("/advise", json={"farmer_id": F, "question": "मक्का में झुलसा लग गया है"}).json()
    assert a["action"] and a["source"], a
    assert a.get("fallback") is True, "no API key, so it must use the excerpt fallback"
    assert "मैंकोज़ेब" in a["action"] or "झुलसा" in a["action"], a["action"]
    print(f"advise ok (fallback), source={a['source']}")

    # retrieval must work in BOTH scripts: ASR gives Devanagari, keyboards give Hinglish
    b = c.post("/advise", json={"farmer_id": F, "question": "makka me jhulsa lag gaya"}).json()
    assert b["source"] == a["source"], "romanized query must find the same doc"
    print("advise ok, devanagari and romanized agree")

    # --- escalation always yields a real case number and a real helpline ---
    e = c.post("/escalate", json={"farmer_id": F, "tier": "expert",
                                  "reason": "confidence 0.44"}).json()
    assert e["case_no"].startswith("HL-") and e["helpline"] == "1800-180-1551", e
    v = c.post("/escalate", json={"farmer_id": F, "tier": "vet", "reason": "x"}).json()
    assert v["helpline"] == "1962", v
    assert v["case_no"] != e["case_no"], "case numbers must be unique"
    print(f"escalate ok, {e['case_no']} -> {e['helpline']}")

    # --- outbreak map is a GROUP BY, only possible because of the shared table ---
    assert isinstance(c.get("/outbreak").json(), list)
    print("outbreak ok")

    print("\nALL BACKEND TESTS PASSED")


if __name__ == "__main__":
    main_test()
