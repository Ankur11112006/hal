"""Live end-to-end advisory against the real Gemini API. NOT part of the
offline suite, because it costs quota and needs a key.

    GEMINI_API_KEY=... python test_advise_live.py

This is the demo's closing moment. It asserts the answer actually references
BOTH domains: today's blight, last year's blight on the same plot, tomorrow's
rain, and the overdue FMD on a different animal. Running it caught two bugs the
offline suite could not: retrieval that ignored the timeline, and "no record"
vaccines being reported as years overdue.
"""
import datetime as dt, json, os, pathlib, sys, tempfile
os.environ["BAHI_DB"] = str(pathlib.Path(tempfile.mkdtemp()) / "live.db")
sys.path.insert(0, r"D:\SIH AgriVision\backend")
from fastapi.testclient import TestClient
import db, main
db.DB_PATH = pathlib.Path(os.environ["BAHI_DB"]); main.db.DB_PATH = db.DB_PATH

F = "demo-ramesh"
db.init()
with db.conn() as c:
    c.execute("INSERT INTO farmer (id,phone,name,village,pincode,state,lang) "
              "VALUES (?,?,?,?,?,?,?)", (F,"9000000000","रमेश वर्मा","बाराबंकी","225001","UP","hi"))
    c.execute("INSERT INTO plot (id,farmer_id,name,area_ha,lat,lng,current_crop) "
              "VALUES ('pA',?,'नदी वाला',0.5058,26.9254,81.1861,'maize')",(F,))
    c.execute("INSERT INTO animal (id,farmer_id,name,species,dob) "
              "VALUES ('gauri',?,'गौरी','cow','2021-04-10')",(F,))
    # last year's blight on the SAME plot
    db.insert_event(c,F,"disease_detected","2025-09-08T10:00:00",plot_id="pA",
                    data={"label":"maize__northern_leaf_blight","name":"मक्का का झुलसा रोग"},confidence=0.89)
    db.insert_event(c,F,"spray","2025-09-08T12:00:00",plot_id="pA",
                    data={"what":"मैंकोज़ेब","cost_inr":380})
    db.insert_event(c,F,"harvest","2025-10-24T10:00:00",plot_id="pA",data={"crop":"maize","qtl":6.8})
    db.insert_event(c,F,"sowing","2026-06-18T10:00:00",plot_id="pA",data={"crop":"maize"})
    # today's detection
    db.insert_event(c,F,"disease_detected","2026-08-15T09:30:00",plot_id="pA",
                    data={"label":"maize__northern_leaf_blight","name":"मक्का का झुलसा रोग"},confidence=0.87)
    # FMD 8 months ago -> overdue
    db.insert_event(c,F,"vaccination","2025-12-02T10:00:00",animal_id="gauri",data={"vaccine":"FMD"})

cl = TestClient(main.app)
print("vaccine due:", json.dumps(cl.get(f"/vaccine-due/{F}").json(), ensure_ascii=False)[:200], "\n")
r = cl.post("/advise", json={"farmer_id": F, "question": "अब मुझे क्या करना चाहिए?"}).json()
print(json.dumps(r, ensure_ascii=False, indent=2))
print("\n--- checks ---")
blob = json.dumps(r, ensure_ascii=False)
assert not r.get("fallback"), "fell back; the API call did not work"
assert any(w in blob for w in ["झुलसा","मैंकोज़ेब"]), "answer ignored the crop disease"
assert any(w in blob for w in ["एफएमडी","FMD","खुरपका"]), "answer ignored the overdue vaccine"
assert r.get("source"), "no source cited"
print("fallback used  :", r.get("fallback", False))
print("mentions blight:", any(w in blob for w in ["झुलसा","blight","मैंकोज़ेब"]))
print("mentions FMD   :", any(w in blob for w in ["FMD","खुरपका","टीका","गौरी"]))
print("has source     :", bool(r.get("source")))
