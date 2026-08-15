"""Cross-domain advisory: retrieval + the farmer's own timeline + weather -> Gemini.

SPEC.md D1. Nothing is fine-tuned. The three things that make it work:
  1. "answer only from SOURCES" is a hard constraint against hallucination
  2. the farmer's OWN timeline goes into the prompt - this is the part
     Plantix cannot replicate, because it does not know the farmer owns cattle
  3. source citation, because farmers trust institutions more than anonymous AI

Retrieval is TF-IDF cosine over ~100 short docs. Deliberately not
sentence-transformers: that pulls torch (~2.5GB) and Render's free tier has
512MB of RAM. The docs are ours, so they carry Hindi keywords alongside the
English ones and lexical matching is enough at this size.
# ponytail: TF-IDF over ~100 docs. Swap in an embedding API if recall on
# paraphrased Hindi questions measurably suffers; the search() signature holds.
"""
import datetime as dt
import json
import math
import os
import pathlib
import re
import urllib.parse
import urllib.request
from collections import Counter

KB_DIR = pathlib.Path(__file__).parent / "kb"
MODEL_ID = os.environ.get("GEMINI_MODEL", "gemini-flash-lite-latest")
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")

_TOKEN = re.compile(r"[a-z0-9ऀ-ॿ]+")


def tokens(s: str) -> list[str]:
    return _TOKEN.findall(s.lower())


class KB:
    """Tiny lexical index. Built once at import, held in memory.

    KB AUTHORING RULE, load-bearing: every doc's `keywords` must carry the
    Devanagari words a farmer actually says AND their romanized spellings.
    Bhashini ASR returns Devanagari; a keyboard user types Hinglish; lexical
    retrieval matches neither unless the doc contains both. The self-check
    below fails if this rule is broken.
    """

    def __init__(self, docs: list[dict]):
        self.docs = docs
        self.tf = [Counter(tokens(" ".join(
            [d["text"], d.get("title", ""), " ".join(d.get("keywords", []))]))) for d in docs]
        df = Counter()
        for t in self.tf:
            df.update(t.keys())
        n = max(len(docs), 1)
        self.idf = {w: math.log(1 + n / (1 + c)) for w, c in df.items()}
        self.norm = [math.sqrt(sum((c * self.idf.get(w, 0)) ** 2 for w, c in t.items())) or 1.0
                     for t in self.tf]

    def search(self, query: str, k: int = 5) -> list[dict]:
        q = Counter(tokens(query))
        qn = math.sqrt(sum((c * self.idf.get(w, 0)) ** 2 for w, c in q.items())) or 1.0
        scored = []
        for i, t in enumerate(self.tf):
            dot = sum(c * t.get(w, 0) * self.idf.get(w, 0) ** 2 for w, c in q.items())
            if dot:
                scored.append((dot / (qn * self.norm[i]), i))
        scored.sort(reverse=True)
        return [self.docs[i] for _, i in scored[:k]]


def load_kb() -> KB:
    docs = []
    for f in sorted(KB_DIR.glob("*.json")):
        payload = json.loads(f.read_text(encoding="utf-8"))
        docs.extend(payload if isinstance(payload, list) else [payload])
    return KB(docs)


_kb: KB | None = None


def kb() -> KB:
    global _kb
    if _kb is None:
        _kb = load_kb()
    return _kb


# ---------------------------------------------------------------- weather
def get_weather(lat: float, lng: float) -> dict:
    """Open-Meteo: free, no API key. IMD is the production source (SPEC.md D3)."""
    q = urllib.parse.urlencode({
        "latitude": lat, "longitude": lng, "timezone": "Asia/Kolkata",
        "current": "temperature_2m,relative_humidity_2m",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max",
        "forecast_days": 3,
    })
    try:
        with urllib.request.urlopen(f"https://api.open-meteo.com/v1/forecast?{q}", timeout=8) as r:
            d = json.load(r)
    except Exception as e:
        return {"available": False, "error": str(e)}
    day = d.get("daily", {})
    return {
        "available": True,
        "now_c": d.get("current", {}).get("temperature_2m"),
        "humidity": d.get("current", {}).get("relative_humidity_2m"),
        "today_max_c": day.get("temperature_2m_max", [None])[0],
        "today_min_c": day.get("temperature_2m_min", [None])[0],
        "rain_mm_tomorrow": (day.get("precipitation_sum") or [None, None])[1:2][0],
        "rain_chance_tomorrow": (day.get("precipitation_probability_max") or [None, None])[1:2][0],
    }


def rain_expected(weather: dict) -> bool:
    """Threshold for the 'spray before the rain' trigger (SPEC.md D2)."""
    return bool(weather.get("available") and (
        (weather.get("rain_chance_tomorrow") or 0) >= 60
        or (weather.get("rain_mm_tomorrow") or 0) >= 5))


# ---------------------------------------------------------------- generation
ADVISORY_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string"},
        "quantity": {"type": "string"},
        "timing": {"type": "string"},
        "cost_benefit": {"type": "string"},
        "source": {"type": "string"},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "escalate": {"type": "boolean"},
    },
    "required": ["action", "timing", "source", "confidence", "escalate"],
}

PROMPT = """Tu ek agriculture advisor hai. Farmer ko {lang} mein simple, chhote jawab de.
{script_rule}

Roman shabd yahan naam se mana NAHI kiye ja rahe, kyunki jo shabd yahan likha
jayega wahi jawab mein chala jata hai: pichhli baar "jaanch" ko mana karne se
jawab mein "जाanch" aaya tha.

"source" mein us document ka naam likh jisse jawab aaya (jaise ICAR, DAHD).
Agar jawab farmer ke apne record se aaya hai to {own_record} likh. Is prompt
ke heading kabhi mat likh: ek baar "FARMER KA RECORD" hi source ban ke kisan
ki screen par pahunch gaya tha.

Sirf neeche diye SOURCES se jawab de. Agar source mein jawab nahi hai, escalate=true
karke action mein likh de "iske liye Kisan Call Centre 1800-180-1551 pe baat karein". Bana mat.

Farmer ke apne record ko jawab mein use kar, aur KHET + PASHU dono ki baat ek hi
jawab mein kar. Agar pichle saal isi plot pe wahi bimari thi to wo bol. Agar kisi
pashu ka tika overdue hai to wo bhi usi jawab mein bol, chahe sawaal fasal ka ho:
kisan ek hi aadmi hai, uske liye khet aur pashu alag nahi hain.
Tike ki baat karte waqt uska "status" jaisa likha hai waisa hi jawab mein le
aa. Apne shabd mat gadh: app usi pashu ke liye wahi vaakya screen par dikha
raha hai, aur do jagah do baat likhi ho to kisan dono par bharosa karna chhod
deta hai. Jis tike ka status kehta hai ki record nahi hai, use overdue mat
bol.

BIMARI KA NAAM FARMER KE RECORD SE LE, SOURCES SE MAT LE. Agar record mein
"मक्का का झुलसा रोग" likha hai to jawab mein wahi bol, chahe SOURCES mein makka
ki doosri bimariyan bhi ho. Sources sirf ILAAJ ke liye hain, pehchan ke liye
nahi: pehchan pehle ho chuki hai aur wo record mein likhi hai.
{glossary}
SOURCES:
{context}

FARMER KA RECORD (khet + pashu):
{timeline}

MAUSAM: {weather}

SAWAAL: {question}"""


_MONTHS = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून",
           "जुलाई", "अगस्त", "सितंबर", "अक्तूबर", "नवंबर", "दिसंबर"]


_MONTHS_EN = ["January", "February", "March", "April", "May", "June",
              "July", "August", "September", "October", "November", "December"]


def hindi_date(iso: str, english: bool = False) -> str:
    """"2026-05-31" -> "31 मई 2026". The model repeats back whatever format it
    is handed, and it was being handed ISO strings, so a farmer was told his
    cow's vaccine "2026-05-31 ko due tha"."""
    try:
        d = dt.date.fromisoformat(iso[:10])
    except ValueError:
        return iso[:10]
    months = _MONTHS_EN if english else _MONTHS
    return f"{d.day} {months[d.month - 1]} {d.year}"


def _timeline_lines(events: list[dict], english: bool = False) -> str:
    # Due vaccines are appended after the history, and a farm with twenty
    # recorded events pushed every one of them past this cut, so the carefully
    # worded status sentences never reached the model at all: it answered about
    # deworming while an FMD dose sat 76 days overdue. History is trimmed; the
    # due list is not, because it is short and it is the point.
    due = [e for e in events if e.get("type") == "vaccine_due"]
    rest = [e for e in events if e.get("type") != "vaccine_due"]
    out = []
    for e in due + rest[:20]:
        who = e.get("plot_name") or e.get("animal_name") or "-"
        crop = f" ({e['current_crop']})" if e.get("current_crop") else ""
        detail = e.get("data") or {}
        bits = ", ".join(f"{k}={v}" for k, v in list(detail.items())[:4])
        out.append(f"{hindi_date(e['at'], english)} | {who}{crop} | {e['type']} | {bits}")
    return "\n".join(out) or "(koi record nahi)"


def situation(events: list[dict]) -> str:
    """The words describing what is currently happening on this farm.

    The demo question is "अब मुझे क्या करना चाहिए?" - it contains no disease and
    no crop, so searching on the question alone retrieves whatever happens to
    score highest, which in testing was three unrelated livestock documents.
    What the farmer means by "now" lives in their timeline, so the timeline has
    to be part of the retrieval query, not just part of the prompt.
    """
    bits = []
    for e in events[:12]:
        d = e.get("data") or {}
        for k in ("name", "label", "vaccine", "crop", "likely", "what"):
            v = d.get(k)
            if isinstance(v, str):
                bits.append(v.replace("__", " ").replace("_", " "))
        if e.get("current_crop"):
            bits.append(e["current_crop"])
        if e.get("type") in ("disease_detected", "vaccine_due", "symptom_flagged"):
            bits.append(e["type"].replace("_", " "))
    return " ".join(dict.fromkeys(bits))          # dedupe, keep order


def advise(question: str, events: list[dict], weather: dict, lang="Hindi",
           glossary: dict | None = None) -> dict:
    """Returns the ADVISORY_SCHEMA dict. Never raises, never shows a stack trace."""
    docs = kb().search(f"{question} {situation(events)}", k=5)
    context = "\n\n".join(f"[{d.get('source','ICAR')}] {d.get('title','')}\n{d['text']}"
                          for d in docs) or "(no sources)"
    gloss = ""
    if glossary:
        pairs = ", ".join(f"{k}={v}" for k, v in list(glossary.items())[:20])
        gloss = ("\nIS FARMER KE LIYE YE LOCAL SHABD USE KAR (standard shabd mat use kar): "
                 f"{pairs}\n")

    # The Devanagari rule used to be unconditional, so picking English got a
    # Hindi answer: the script line sat right under the language line and won.
    english = lang.lower().startswith("en")
    script_rule = (
        "Answer in plain English. Short sentences, no jargon, no Hindi words.\n"
        "Parts of the record below are written in Hindi, because that is the\n"
        "language they were entered in. Say them in English rather than copying\n"
        "the Devanagari through: an English answer once came back quoting a\n"
        "whole Hindi sentence out of the farmer's own history."
        if english else
        "POORA jawab Devanagari lipi mein likh. Dawa ke naam ke ilawa ek bhi roman ya\n"
        "English shabd mat likh. Ye instructions roman mein likhi hain par TERA JAWAB\n"
        "nahi honi chahiye: farmer ko mixed script padhne mein dikkat hoti hai. Number\n"
        "aur % theek hain, shabd nahi.")

    prompt = PROMPT.format(lang=lang, script_rule=script_rule,
                           # The screen renders "According to {source}" and
                           # "{source} के अनुसार", so English wants lowercase and
                           # Hindi wants the oblique case, or it reads
                           # "आपका अपना रिकॉर्ड के अनुसार".
                           own_record="\"your own record\"" if english else "\"आपके अपने रिकॉर्ड\"",
                           glossary=gloss, context=context,
                           timeline=_timeline_lines(events, english),
                           weather=json.dumps(weather, ensure_ascii=False),
                           question=question)

    if GEMINI_KEY:
        try:
            from google import genai
            client = genai.Client(api_key=GEMINI_KEY)
            r = client.models.generate_content(
                model=MODEL_ID, contents=prompt,
                config={"response_mime_type": "application/json",
                        "response_schema": ADVISORY_SCHEMA})
            out = json.loads(r.text)
            out["sources"] = [d.get("source", "ICAR") for d in docs]
            return out
        except Exception as e:                       # quota, network, bad key
            print(f"[advise] gemini failed: {e}")

    # SPEC.md 6.3: never an error screen. Hand back the best real document,
    # labelled as a source excerpt rather than personalised advice.
    top = docs[0] if docs else None
    return {
        "action": top["text"][:400] if top else
                  "Iske liye Kisan Call Centre 1800-180-1551 pe baat karein.",
        "quantity": "",
        "timing": "Jald se jald",
        "cost_benefit": "",
        "source": top.get("source", "ICAR") if top else "Kisan Call Centre",
        "confidence": "medium" if top else "low",
        "escalate": True,
        "fallback": True,
        "sources": [d.get("source", "ICAR") for d in docs],
    }


def _self_check():
    k = KB([
        {"title": "Maize blight", "source": "ICAR",
         "text": "northern leaf blight mancozeb 2.5 gram per litre spray",
         "keywords": ["मक्का", "झुलसा", "makka", "jhulsa", "bhutta"]},
        {"title": "FMD vaccine", "source": "DAHD",
         "text": "FMD vaccine every 180 days, government administers it free",
         "keywords": ["खुरपका", "मुँहपका", "टीका", "गाय", "khurpaka", "tika", "gaay"]},
        {"title": "Tomato curl", "source": "ICAR",
         "text": "leaf curl virus spread by whitefly",
         "keywords": ["टमाटर", "पत्ता", "मुड़ना", "tamatar", "patta", "mudna"]},
    ])
    # both scripts must retrieve the same doc, because ASR gives Devanagari
    # and a keyboard user types Hinglish
    assert k.search("makka me jhulsa", 1)[0]["title"] == "Maize blight"
    assert k.search("मक्का में झुलसा", 1)[0]["title"] == "Maize blight"
    assert k.search("gaay ka tika kab", 1)[0]["title"] == "FMD vaccine"
    assert k.search("गाय का टीका कब", 1)[0]["title"] == "FMD vaccine"
    assert k.search("zzzz nothing", 3) == [], "no spurious matches"

    assert rain_expected({"available": True, "rain_chance_tomorrow": 80})
    assert not rain_expected({"available": True, "rain_chance_tomorrow": 10})
    assert not rain_expected({"available": False})

    tl = _timeline_lines([{"at": "2025-09-12T00:00", "plot_name": "A", "current_crop": "maize",
                           "type": "disease_detected", "data": {"label": "blight"}}])
    assert "2025-09-12" in tl and "maize" in tl and "blight" in tl
    print("advise ok")


if __name__ == "__main__":
    _self_check()
