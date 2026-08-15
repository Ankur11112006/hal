# KISAN SAARTHI
### Unified AI Agri-Vision Platform for Crop Advisory and Livestock Management
**SIH Problem Statement 1 | Full Technical Specification**

---

## 0. What this document is

The complete build spec for the app. Every feature, how it works, what it needs, why it exists.
UI/UX is deliberately excluded. This is functions, data, models, and flow.

---

## 1. The one-line pitch

> One app where a marginal farmer's crops and animals live in the same record, so the advice they get knows about both.

**Problem Statement asks for exactly 4 things:**
1. Crop disease identification
2. Livestock monitoring
3. Historical farm records
4. Actionable advisory services

Plus: "intuitive and accessible interface suitable for rural environments."

Everything in this spec traces back to one of those five. Anything that does not, is marked ROADMAP.

---

## 2. The thesis (why we win)

Three facts drive every design decision in this document:

**Fact 1: Accuracy is not the bottleneck. Trust is.**
Disease-detection apps with 95% lab accuracy have shown under 10% field adoption. Meanwhile Ama Krushi (Odisha) reached 7 million farmers using plain voice calls, no computer vision, and returned $9-15 of farmer benefit per $1 spent.
**Design consequence:** our AI must admit when it is unsure, and route to a human. An 85%-accurate honest system beats a 95%-accurate confident one.

**Fact 2: Apps alone do not reach marginal farmers.**
Kisan Suvidha app: roughly 3 lakh users. mKisan SMS: 5 crore registrations. 51.6% of rural women aged 15+ do not own a mobile phone at all.
**Design consequence:** voice is the primary interface, not typing, and the VLAE is the human channel for anyone the app cannot reach directly.

**Fact 3: Nobody has unified crop + livestock.**
Plantix = crop only. Bharat Pashudhan = livestock only, and built for field officers not farmers. Kisan e-Mitra = schemes only. iCow (Kenya) = dairy only. eNAM = price only.
**Design consequence:** one `event` table holding both crop and animal history is the entire product. Every differentiating feature falls out of that single design choice.

---

## 3. Feature list

Priority key: **P0** = must exist in MVP. **P1** = differentiator, build if time permits, mock in demo. **ROADMAP** = slide only, do not build.

---

### MODULE A: CROP

#### A1. Crop disease identification `P0`

**What it does**
Farmer photographs a leaf. App returns disease name, confidence score, severity, and a treatment plan with cost.
**Multi-crop, multi-disease.** Not a single-disease detector.

**Class list: ~35 classes across 7 crops Indian marginal farmers actually grow**

| Crop | Classes |
|---|---|
| **Dhaan / rice** | Blast · Brown spot · Bacterial leaf blight · Tungro · Sheath blight · healthy |
| **Gehu / wheat** | Leaf rust · Stripe (yellow) rust · Septoria · Powdery mildew · healthy |
| **Makka / maize** | Northern leaf blight · Common rust · Gray leaf spot · Fall armyworm · healthy |
| **Tamatar / tomato** | Early blight · Late blight · Leaf mold · Septoria leaf spot · Bacterial spot · Yellow leaf curl · Mosaic virus · Spider mites · healthy |
| **Aloo / potato** | Early blight · Late blight · healthy |
| **Kapas / cotton** | Bacterial blight · Leaf curl virus · healthy |
| **Mirchi / chilli** | Bacterial spot · Leaf curl · healthy |

Include a few **insect pests** (fall armyworm, spider mites) alongside diseases. The farmer does not care about the taxonomic distinction, only about why the leaf looks wrong.

**Crop-conditioned inference: free accuracy from the unified record**

The app already knows what is planted on each plot, from that plot's `sowing` event. So at scan time:
```
plot.current_crop = 'makka'
  -> mask the softmax to the 5 maize classes
  -> renormalize, then apply the confidence gate
```
The model now picks among 5 candidates instead of 35. **Accuracy rises with zero extra training.**
If the plot is unregistered, fall back to the flat 35-class output. Both paths work.

> Plantix cannot do this: it has to infer the crop from the image every single time. We know the crop because we hold the farmer's record. This is the crop-side payoff of the same schema decision that powers the timeline.

**How it is built**
- On-device TensorFlow Lite model, INT8 quantized, roughly 4-6 MB, ~50ms inference on a low-end Android device.
- Runs fully offline. No network call in the common path.
- Output is written into the `event` table as `type = 'disease_detected'`.

**Confidence gating (non-negotiable)**
```
confidence > 0.85   ->  show diagnosis + treatment immediately
0.60 - 0.85         ->  show "likely X, being verified" + push to VLAE queue
below 0.60          ->  show NO diagnosis. Route to expert queue.
                        Message: "Isko expert dekh raha hai, 4 ghante mein jawab milega"
```
This is the single most important design choice in the app. Never show a wrong diagnosis with unearned confidence.

**Image quality: no separate check needed**
A blurry or badly-lit photo produces a low confidence score, which the gate above already routes to escalation. The confidence gate *is* the quality check. Do not add OpenCV / Laplacian variance blur detection: it means linking native C++ libraries for a job the model already does. Optional 2-line nicety: if confidence is below 0.60, the escalation message can suggest "Photo paas se, roshni mein dobara lo" before sending it onward.

**Severity grading**
Not just "blight yes/no" but a 0-3 severity score, because a Stage-1 infection needs different dosage than Stage-3. Implemented as a second output head or a simple lesion-area heuristic.

**What the farmer gets**
Previously: 2-hour trip to the extension office, or nothing at all. Now: 10 seconds, in the field, with no signal. Catching blight 3 days earlier can save the crop.

---

#### A2. Crop calendar and plot records `P0`

**What it does**
Farmer registers a plot (name, area, **GPS**). Logs sowing, irrigation, spraying, fertilizer, harvest, yield, expenses.

**Soil type is NOT asked. It is derived.**
The farmer should never be asked something we can look up. From the plot's lat/lng we resolve soil type and, where available, actual NPK and pH:
1. **Soil Health Card** (soilhealth.dac.gov.in / AgriKosh) gives real plot-level N, P, K, pH and micronutrients for tested plots.
2. Fallback: district-level soil classification from public soil maps.

Two wins for free: one less field in the form, and a legitimate "government soil data integrated" line in the pitch. Fertilizer advice can then be actual ("25 kg urea") instead of generic.

**How it is built**
Plain forms writing into `event`. Zero ML. Voice logging supported via Bhashini ASR ("makka boya, 15 June, 2 bigha") which is parsed into structured fields by the LLM.

**Design principle for the whole app: never ask what you can derive or infer.**
Every extra form field is a farmer who abandons onboarding.

**What the farmer gets**
A written record where there was none. Enables year-on-year comparison and, later, loan eligibility proof.

---

### MODULE B: LIVESTOCK

> **Design note 1:** earlier drafts led with computer-vision disease detection here. That was wrong. The evidence (iCow Kenya: 13% more milk, 22% higher household income) shows the income gains came from **breeding calendars and vet access**, not from image models. The boring features win. Photo-based detection is demoted to an optional assist.

> **Design note 2 — what "livestock monitoring" means here, and what it does not.**
>
> It does **not** mean live sensor telemetry. Connecterra collars, Cainthus barn cameras and Afimilk parlour sensors run ₹10,000-15,000 *per animal*. For a farmer with three animals that is ₹45,000 of hardware. Those systems are built for 500-cow commercial farms and do not transfer to Indian smallholders. Rejecting that model is a deliberate position, not a limitation, and it is the core of our pitch.
>
> It also does **not** mean daily data entry. A farmer will not log milk yield every morning. Asking them to is how farm apps die.
>
> **What it means for us: the farmer asks when something is wrong, the app tells them before something goes wrong, and the record writes itself as a byproduct of both.**
>
> | Record | Written when | Extra effort by farmer |
> |---|---|---|
> | Health event | Farmer runs the symptom checker. The query *is* the record. | none |
> | Vaccination | Reminder fires, farmer taps "ho gaya" | one tap |
> | Vaccination (alt) | VLAE or vet marks it done | none |
> | Breeding | Insemination date entered once | 1-2 times/year |
>
> **Zero data-entry forms, and history still accumulates.** That history is what makes the cross-domain advisory possible and satisfies the Problem Statement's "historical farm records" requirement for livestock.

#### B1. Animal profile `P0`

Name, species, breed, DOB, photo, purchase price, optional Bharat Pashudhan tag ID.
Plain forms. Links every subsequent event to a specific animal.

#### B2. Vaccination calendar and reminders `P0` — **highest impact-to-effort feature in the app**

**The official Indian schedule (verified, government-run):**

| Vaccine | Interval | Funding |
|---|---|---|
| **FMD** | every **180 days** | **100% central government** (NADCP / LHDCP) |
| **Brucellosis** | female calves 4-8 months, **once in lifetime** | Government |
| **HS** | annually, before monsoon | Government assistance to states |
| **BQ** | annually | Government assistance to states |
| Deworming | as per local vet practice | - |

Scale so far: 125 crore FMD doses since 2020, 4.77 crore Brucella, 30 crore LSD.

**The insight that makes this feature valuable:**
The vaccine is free and the government administers it. **Cost is not the barrier. Knowing the due date is.** Solving that needs one date per animal and a scheduled job. No sensors, no logging, no ML.

**What it does**
Tracks due dates per animal, sends reminders ahead of time, records completion on a single tap.

**How it is built**
```sql
SELECT * FROM event
WHERE type='vaccination' AND animal_id=?
ORDER BY at DESC LIMIT 1
```
Compare against schedule table, fire notification. A cron job and a WHERE clause. No ML.

**Why this is high value**
Preventing FMD is worth more than detecting it. This is the highest impact-to-effort feature in the entire app.

**Village cohort mode `P1`**
"12 cattle in your village are due for FMD booster this week." Enables a single group vet visit, which drops the per-animal cost dramatically.

#### B3. Symptom checker and vet triage `P0` — **the main entry point for livestock**

This is how a farmer uses the livestock side: something looks wrong, they ask. There is no dashboard to maintain and no log to keep up with. **Asking is the interaction, and the answer is automatically the record.**

**What it does**
Guided questions, the way a vet actually triages:
```
Bukhar hai?  ->  Khaana chhoda?  ->  Doodh kam hua?
->  Thano mein sujan?  ->  Charm pe gaanth ya ghaav?
->  Langda ke chal rahi hai?  ->  Naak/aankh se paani?
```
Output: likely condition + immediate action + whether a vet is needed urgently.

**How it is built**
A rule-based decision tree stored as JSON, roughly 40-60 nodes. **No ML.** Built in about 2 hours with a veterinary reference.

**Why a decision tree beats an image model here**
One image model covers one disease. This tree covers 20+ conditions, works without a camera, works offline, is fully explainable, and can be validated by an actual vet. It maps directly onto the Problem Statement phrase "access to specialized veterinary expertise."

**Escalation**
Any "urgent" branch surfaces the 1962 helpline, nearest Mobile Veterinary Unit, and the VLAE contact, with a one-tap call.

#### B4. Milk yield log and anomaly alert — ~~`P0`~~ **CUT**

**Removed deliberately. Do not re-add.**

The idea was: log daily yield, alert when it drops 15% for 3 days, catch mastitis early. The arithmetic works. The product does not.

**It requires the farmer to enter data every single day.** They will not. Weekly is no better. Real-world compliance on manual daily logging in smallholder apps is close to zero, and a feature whose alert depends on data nobody enters is a feature that never fires. Worse, it puts a chore on the home screen, which is the fastest way to lose a user.

This is exactly the failure mode the global research names: **technology push without demand pull.** A clever mechanism answering a question the farmer never asked.

The farmer notices low milk on their own. What they lack is what to do next, and that is B3's job. The symptom tree already has a "doodh kam ho gaya" branch, which routes to mastitis / heat stress / nutrition, with escalation. Same clinical value, zero data entry.

> Optional far-future: infer yield from cooperative collection-centre records, where the data already exists and the farmer enters nothing. Not now.

#### B5. Breeding and heat calendar `P0`

**What it does**
Tracks last calving, insemination date, expected calving. Predicts the heat window. Sends reminders for AI (artificial insemination) timing and for the dry-to-lactation feed transition 2 weeks before calving.

**How it is built**
Date arithmetic on standard bovine cycle constants (21-day heat cycle, 283-day gestation). No ML.

**Why it matters**
This is precisely the mechanism behind iCow's proven 13% milk production increase. A missed heat cycle costs the farmer an entire calving interval.

#### B6. Photo assist for visible conditions `P1`

**What it does**
Where the symptom tree branches to a visually confirmable condition (skin nodules, wounds, udder swelling), offer an optional photo step. A trained classifier gives a second opinion.

**How it is built**
Same architecture as A1. Trained on the Mendeley Lumpy Skin dataset (1,024 images: 700 healthy, 324 infected). Published results with MobileNetV2 transfer learning reach ~97.6%.

**Framing rule**
This is an *assist inside the symptom checker*, never a standalone "photo se bimari pakdo" feature. Presented standalone it looks gimmicky and covers only one disease.

---

### MODULE C: UNIFIED RECORD

#### C1. Single farm timeline `P0` — **this is the core of the product**

**What it does**
One chronological feed showing crops and animals together.
```
14 Aug  Gauri: FMD vaccine due in 12 days
12 Aug  Plot A (makka): blight detected, 87%
12 Aug  Plot A: Mancozeb sprayed, Rs 380
10 Aug  Gauri: "khaana kam kha rahi hai" -> symptom check logged
08 Aug  Plot B (gehu): harvested, 8.2 qtl
```

**How it is built**
```sql
SELECT * FROM event WHERE farmer_id = ? ORDER BY at DESC
```
One query. That is it.

**Why this is the whole game**
Because crop events and animal events share one table, cross-domain advisory becomes possible for free. Split them into two tables and the entire differentiator disappears. **This is the single most important schema decision in the project.**

#### C2. Year-on-year comparison `P1`
"Tomato yield 18% down vs last year. Late sowing (logged 22 June vs 8 June) or the September blight (logged)?"
Two queries and a diff.

#### C3. Farm income statement `ROADMAP`
Auto-generate a PDF from ledger data for KCC loan applications. Valuable, but not in the Problem Statement. Roadmap slide only.

---

### MODULE D: ADVISORY

#### D1. Cross-domain advisory `P0` — **this is the demo moment**

**What it does**
Not "blight detected." Instead:

> "Blight hai. **Pichle saal bhi isi plot mein aayi thi**, isliye is baar seed treatment karo. Mancozeb 2.5 g/litre, Rs 380 lagega, Rs 3,000 ka nuksaan bachega. **Kal baarish hai toh aaj 4 baje se pehle spray karo.** Aur tumhari 2 gaayon ka FMD vaccine 8 mahine purana hai, wo bhi karwa lo."

Crop history + weather + livestock status in one answer.

**How it is built: RAG, no model training**

```python
# pip install google-genai sentence-transformers numpy
import numpy as np
from sentence_transformers import SentenceTransformer
from google import genai

embedder = SentenceTransformer("all-MiniLM-L6-v2")   # free, local, 80MB
client = genai.Client(api_key=GEMINI_KEY)

docs = load_knowledge_base()          # KCC Q&A + ICAR practices + vaccination schedules
doc_vecs = embedder.encode(docs, normalize_embeddings=True)

def search(query, k=5):
    q = embedder.encode([query], normalize_embeddings=True)[0]
    top = np.argsort(doc_vecs @ q)[::-1][:k]     # dot product on ~500 docs;
    return [docs[i] for i in top]                 # FAISS only if this ever hits 100k

ADVISORY_SCHEMA = {
    "type": "object",
    "properties": {
        "action":       {"type": "string"},   # kya karna hai
        "quantity":     {"type": "string"},   # kitna
        "timing":       {"type": "string"},   # kab, aur kyun tab
        "cost_benefit": {"type": "string"},   # kharcha vs bacha hua nuksaan
        "source":       {"type": "string"},   # ICAR / KCC / DAHD
        "confidence":   {"type": "string", "enum": ["high", "medium", "low"]},
        "escalate":     {"type": "boolean"},  # true -> route to vet/KVK
    },
    "required": ["action", "timing", "source", "confidence", "escalate"],
}

def advise(question, farmer_id, lang="Hindi"):
    context  = "\n".join(search(question))
    timeline = get_timeline(farmer_id, limit=20)   # the unified event feed
    weather  = get_weather(farmer_id)

    prompt = f"""Tu ek agriculture advisor hai. Farmer ko {lang} mein simple jawab de.
Sirf neeche diye SOURCES se jawab de. Agar source mein jawab nahi hai, escalate=true
karke action mein likh de "iske liye 1962 pe vet/KVK expert se baat karein". Bana mat.

SOURCES:
{context}

FARMER KA RECORD (khet + pashu):
{timeline}

MAUSAM: {weather}

SAWAAL: {question}"""

    return client.models.generate_content(
        model=MODEL_ID,                       # pin this, see note below
        contents=prompt,
        config={"response_mime_type": "application/json",
                "response_schema": ADVISORY_SCHEMA},
    ).parsed
```

**Pin the model ID on day 1, do not copy one from a blog post.**
Google's lineup moves fast. As of August 2026 the current free-tier Flash family is **Gemini 3.6 Flash / 3.5 Flash / 3.5 Flash-Lite**; the 2.5 series still works but is **deprecated**. Flash-Lite is the cheapest and is more than adequate for this workload.

Run this once, pick the newest Flash-Lite or Flash the account can see, and hard-code it:
```python
for m in client.models.list():
    if "flash" in m.name:
        print(m.name)
```
Structured output (`response_schema`) is supported across the 2.5 and 3.x families, so the `ADVISORY_SCHEMA` approach holds whichever you pin.

**Why forced JSON instead of free text**
1. Guaranteed structure. Free-text prompts drift, ignore the length limit, and produce walls of text that a low-literacy farmer will not read.
2. The frontend renders each field as its own labelled row with an icon, instead of one paragraph.
3. `escalate` and `confidence` become machine-readable, so the three-tier routing works on the advisory path too, not just the image path.
4. The structured answer stores cleanly into the `advisory` table for later analysis.

**Three things make this work:**
1. `"Sirf SOURCES se jawab de"` prevents hallucination. Out-of-scope questions escalate to 1962.
2. The **farmer's own timeline goes into the prompt.** This is why Plantix cannot replicate this answer: it has no idea the farmer owns cattle.
3. Source citation ("ICAR ke hisaab se...") builds trust. Farmers trust institutions far more than anonymous AI.

**No vector database.** Dot product over ~500 documents is instant. Chroma / Pinecone / FAISS are not needed and add deployment weight.

#### D2. Trigger-based alerts, not scheduled newsletters `P0`

| Bad (informational) | Good (actionable) |
|---|---|
| "Rain expected tomorrow" | "Kal baarish hai, aaj spray karo warna dhul jayega" |
| "Blight risk high" | "Aaj 4 baje se pehle spray karo. Rs 400 kharcha, Rs 3,000 nuksaan bachega" |
| "Temperature dropped" | "Raat 8°C se neeche, tamatar ke paudhe dhak do" |

Rule: every alert answers **what, when, how much, why**, and includes the cost-benefit.
Only fire when a threshold is actually crossed. Scheduled messaging causes alert fatigue, which is why generic SMS advisory has low engagement.

#### D3. Weather `P0`
Demo: Open-Meteo (free, no API key, 5-minute integration).
Production: IMD. Their AI monsoon system launched 11 May 2026 gives 1km block-level forecasts up to 4 weeks ahead across 3,000+ sub-districts. Cite this in the PPT, it is 3 months old.

#### D4. Mandi price `P1`
Agmarknet via data.gov.in. 3,000+ mandis, 200+ commodities, daily.
Show **net-realizable price** (headline price minus transport), not the headline. Cache daily.

#### D5. Government schemes `P1`
myScheme data + eligibility matched from the farmer's own profile.
"Tumhare 2 acre + gehu + UP se ye 4 schemes eligible hain."

---

### MODULE E: ACCESS AND TRUST

#### E1. Voice-first, multilingual `P0`

**Stack: Bhashini** (Government of India, ULCA platform, 22 languages, ASR + MT + TTS, 300+ models, free developer access).
Optionally BharatGen Sooktam-2 TTS for more natural prosody.

**Rules:**
- Every text advisory has a play button. A low-literacy farmer will not read a 200-word treatment plan.
- Accept code-mixed input. Farmers say "Rani ko 5 litre doodh diya, mastitis ka symptom hai kya?"
- Build the app in Hindi/English first, then wrap translation on top. Doing it per-screen from the start doubles build time.

**PPT bonus:** using Bhashini means "built on India's own Digital Public Infrastructure." Judges score this.

---

#### E1b. Regional terminology layer `P0` — **translation is not enough**

**The problem Bhashini does not solve.**
Bhashini translates *languages*. It does not know that the same wheat disease is called **gerua** in one district, that FMD has a completely different everyday name in Marathi than in Hindi, or that a "bigha" is a different amount of land in Rajasthan than in Bengal. Output standard Hindi into Marwar and the farmer reads a correct sentence containing a word they have never used.

**"Correct Hindi" that the farmer does not recognise is the same as a wrong answer.**

There are three distinct failures here, and only the first is a translation problem:

**1. Disease, pest and crop names vary by region.**
Every entity in the app has: a scientific name, an English name, a standard-language name, and one or more **local names that differ by state and sometimes by district**. Farmers use the local one. Extension officers use the local one. The model outputs the English one.

**2. Units of measurement are not constant — and this is a correctness bug, not a wording issue.**
`bigha` is **not a fixed area in India**. It differs materially between Rajasthan, UP, Bihar, MP, Punjab and Bengal, and in several states there are separate *pucca* and *kaccha* bighas. Other regions do not use bigha at all: *guntha* in Maharashtra, *kanal* and *marla* in Punjab and Haryana, *cent* in the south, *katha* and *biswa* in the east and north.

> If a farmer enters "2 bigha" and we compute a fertilizer dose or a treatment cost against a hard-coded conversion, **the number we give them is simply wrong**, potentially by 2-3x. This is the most dangerous silent bug in the app.

Rule: **store area canonically in hectares. Never store or compute in a local unit.** Convert at the UI boundary using a state lookup, and display back in the farmer's own unit.

**3. Dialect on the input side.**
Bhashini handles Marathi; Vidarbhi Marathi is another matter. Same for Marwari vs standard Hindi, Bhojpuri, Haryanvi, Awadhi. ASR will mis-transcribe, and the mis-transcription lands in the retrieval query.

---

**How it is built: a glossary, not a model.**

This is the good news. Almost none of this is machine learning. It is a lookup table.

```sql
term (id, canonical_id,        -- e.g. 'disease.wheat.leaf_rust'
      kind,                    -- disease | pest | crop | animal | symptom | unit
      lang,                    -- hi | mr | gu | pa | bn ...
      state,                   -- NULL = whole language, else state-specific
      local_term,
      is_primary,              -- the one we speak back to this farmer
      validated_by)            -- KVK / vet / extension officer who confirmed it

unit_conversion (local_unit, state, hectares)   -- bigha(RJ) != bigha(WB)
```

**Output path (what the farmer hears):**
```
model -> canonical_id -> localize(canonical_id, farmer.state, farmer.lang) -> speak
```
The model never emits a farmer-facing string. It emits an ID. The word is chosen at the last moment based on where the farmer actually is.

**Input path (what the farmer says):**
```
speech -> Bhashini ASR -> fuzzy match against term.local_term for this state
       -> canonical_id -> retrieval / symptom tree
```
Fuzzy matching (edit distance plus phonetic matching for Indic scripts) absorbs a lot of ASR dialect error, because we are matching against a small closed vocabulary of a few hundred agricultural terms rather than open text.

**Advisory path:** inject the farmer's regional glossary into the RAG prompt as an instruction, so the generated answer uses their words rather than textbook ones:
> *"Use these local terms for this farmer: {glossary_subset}. Do not use standard-language equivalents where a local term exists."*

---

**Where the glossary comes from (this is the part that makes it feasible)**

| Source | What it gives |
|---|---|
| **KCC transcripts** | **The single best source.** Millions of real farmer queries, **already district-tagged**, in the farmers' own words. Mine the vocabulary directly: which words do farmers in Barabanki use for this disease, versus farmers in Jalna? This dataset is already in our knowledge base for advisory, so we get the glossary from data we are ingesting anyway. |
| ICAR / State Agricultural University extension pamphlets | Published in state languages, disease names given in the local vernacular |
| Vikaspedia | Multilingual crop and livestock content, state-wise |
| NDDB / DAHD livestock material | State-language vaccination and disease terminology |
| **KVK / vet validation** | Human confirmation before shipping. Non-negotiable. |

**MVP target: 200-300 rows.** That covers our 35 crop disease classes, ~20 livestock conditions, the 7 crops, and every area unit. It is a CSV, and it is a day of research for one team member, not an ML project.

**Do NOT ship unvalidated vernacular terms.** A wrong local name is worse than an English one, because it sounds authoritative while being incorrect. Every row needs a named human (KVK officer, vet, or extension worker) in `validated_by` before it goes live. Where no validated local term exists, fall back to the standard-language name and mark the gap.

---

**Why this is a differentiator, not just polish**

Existing platforms operate at the *language* level. Ama Krushi is Odia. Kisan e-Mitra is 11 languages. None operate at the **district-vocabulary** level, and the global research explicitly names this as a failure mode: *"a farmer in Vidarbha speaks differently from a farmer in Kolhapur."* Everyone identifies the problem; nobody has specified the fix.

It also compounds with everything else we built: we already know the farmer's `pincode`, `state` and `lang` from their profile. The localisation layer costs one join.

> Pitch line: **"Har app anuvaad karta hai. Hum farmer ki apni bhasha bolte hain."**
> Every app translates. We speak the farmer's actual words.

#### E2. In-app community Q&A `P0`

Farmer posts a question (voice, text, or photo) against a specific crop or animal. Other farmers, VLAEs, and experts answer. Threads are searchable.

**How it is built**
```sql
thread (id, farmer_id, crop_or_species, title, body, photo_url,
        status, at)          -- open | answered | resolved
reply  (id, thread_id, author_id, author_role, body, upvotes, at)
                             -- author_role: farmer | vlae | expert
```
The low-confidence escalation path from A1 and B3 posts here automatically, so escalated cases become public knowledge instead of dying in a private queue.

**Why it earns its place**
- Peer answers reduce expert load. Farmers trust other farmers.
- Answered threads become searchable ("mere district ke sab tomato leaf-curl sawaal dikhao"), so the same question gets answered once, not fifty times.
- Visible human responses are what converts a suspicious first-time user into a returning one.

**Women-only circles `P1`:** a separate space with female moderators. Women are 64.3% of the agricultural workforce and are documented as hesitant to ask in male-dominated forums.

#### E3. Offline-first sync `P0`
- All writes go to local SQLite first. UI never blocks on network.
- Crop model runs on-device, so the primary feature works at zero connectivity.

**There is no conflict resolution, because there are no conflicts.**
The `event` table is **append-only**. Rows are never updated, only inserted. Two devices cannot edit the same row, so two-way merge logic is unnecessary. Do not build a sync engine.

The entire sync layer is this:
```sql
-- on connectivity
SELECT * FROM event WHERE synced = 0;     -- local SQLite
-- POST the batch to Supabase
UPDATE event SET synced = 1 WHERE id IN (...);
```
Roughly 15 lines. Anything more elaborate is wasted hackathon time.

#### E4. Three-tier escalation `P0`
```
AI (conf > 85%)          ->  70% of cases resolved here
VLAE (conf 60-85%)       ->  20%, village-level agri-entrepreneur verifies in person
Expert (conf < 60%)      ->  8%, agronomist or vet via in-app thread / 1962
Community forum          ->  2%, unresolved cases
```

#### E5. VLAE network `P1`
A village youth (18-35), manages 50-100 farmer households, earns commission.
Handles AI escalations in person. Onboards farmers who do not trust an app.
**Evidence:** Digital Green's community mediators achieved 44% practice adoption vs 11% for conventional extension, at $3.70 vs $38.18 cost per adoption.
Directly attacks India's 1 extension worker : 1,162 farmers ratio.

#### E6. Gender lens `P1`
- **Shared device mode:** one phone, multiple profiles (crop / livestock / market). 51.6% of rural women 15+ own no phone at all, and most households share one.
- **Evening advisory window:** send women's advisories at 8:30 PM, after care work, not at 10 AM.
- **Self-declaration onboarding:** no land title required. PM-KISAN's land-record requirement excludes tenant farmers and most women, since titles are usually in a man's name. Women are 64.3% of the agricultural workforce.

#### E7. Village outbreak map `P1`
Aggregate anonymized detections by pincode. Crop and animal together.
"3 villages within 10 km reported LSD this week. Vaccinate now."
```sql
SELECT pincode, disease, COUNT(*) FROM event
WHERE type IN ('disease_detected','symptom_flagged')
  AND at > now() - interval '14 days'
GROUP BY pincode, disease HAVING COUNT(*) >= 3
```
**No ML.** Aggregation plus a threshold. Only possible because every user writes to one shared event table, so it is a direct consequence of the unified design.

#### E8. Data consent `P0`
DPDP Act 2023 compliance. Explicit consent per data type. A one-tap "Delete my data" button that reports the record count deleted.
**We do not sell farmer data.** Any B2B licensing would contradict this and must not appear in the pitch.

---

### ROADMAP (slide only, do not build)
Insurance claim assist (PMFBY) · Warehouse receipt financing · KCC loan pre-approval · Input marketplace · Equipment rental · Satellite NDVI plot health · Drone services · Video-based lameness scoring · Muzzle biometric ID · 5-year yield forecast · Export market linkage

> **Muzzle ID was cut deliberately.** A farmer with 3 animals already knows which cow is which. Muzzle biometrics solve an *institutional* problem (insurance fraud, national traceability), not a marginal farmer's problem. It was the most expensive feature answering a question nobody asked.

---

## 4. Machine learning: what actually gets trained

**Only ONE model is trained from scratch-ish. Everything else is rules, arithmetic, or API calls.**

| Component | Approach | Training needed |
|---|---|---|
| Crop disease | Transfer learning CNN | **Yes, ~40 min on free Colab GPU** |
| Skin condition assist | Transfer learning CNN | Yes, ~20 min (P1) |
| Symptom checker | Rule-based decision tree | No |
| Community Q&A | Plain CRUD + search | No |
| Regional terminology | Glossary lookup + fuzzy match | No |
| Breeding calendar | Date arithmetic | No |
| Advisory | RAG over documents | No |
| Outbreak map | SQL GROUP BY | No |
| Voice | Bhashini API | No |

### 4.1 How the crop model is trained

**Step 1: Do not train from zero.**
MobileNetV3-Small comes pretrained on ImageNet. It already knows edges, textures, colour patches, and shapes. We remove its final classification layer and attach our own, then train only that. This is **transfer learning**, and it takes minutes instead of days.

**Step 2: Mix lab data with field data. This is the critical step.**

PlantVillage (54,000 images, 38 classes, 14 crops) is the standard benchmark, but it carries **two traps**, and most teams fall into both.

**Trap 1: it is lab imagery.** Every image is a single detached leaf on a plain background under studio lighting. A model trained only on it scores 99% in the notebook and **fails on a real photo from a real field**, because it quietly learned "plain background means classify confidently."

**Trap 2: the crops are wrong for India.** PlantVillage's 14 species are largely temperate and American: apple, blueberry, cherry, grape, orange, peach, raspberry, strawberry, squash. Only maize, potato, tomato, pepper and soybean meaningfully overlap with Indian smallholder cropping.

> **Rice and wheat are not in PlantVillage at all.** India's two largest crops, absent from the benchmark everyone trains on.

Train only on PlantVillage and the app will confidently identify apple scab while failing on dhaan ka blast. This is why the Indian field datasets below are not optional extras, they are the core of the training set.

Training mix:
| Dataset | Size | Role |
|---|---|---|
| PlantVillage | ~54k | Bulk, controlled |
| PlantDoc | ~2.6k | In-the-wild field images |
| Paddy Doctor | ~16k | Indian paddy, field conditions |
| Cassava Leaf Disease (Kaggle) | ~21k | Field conditions, class imbalance |
| ICAR Rice & Maize (AIKosh) | field | **Indian field conditions, official source** |
| Mendeley multi-crop (15 crops, 45 diseases) | mixed | Class coverage |

**Step 3: Augmentation that mimics reality.**
Random rotation, brightness and contrast jitter, motion blur, random crop, JPEG compression artifacts. Because the real input is a shaky photo taken at noon by someone holding a cheap phone.

**Step 4: Report honestly.**
Report accuracy on a **held-out field-image test set**, not on the PlantVillage split. The PlantVillage number is inflated and everyone in the room knows it. Present a confusion matrix.

**Step 5: Quantize and export.**
```python
converter = tf.lite.TFLiteConverter.from_keras_model(model)
converter.optimizations = [tf.lite.Optimize.DEFAULT]
converter.representative_dataset = rep_data_gen     # INT8 calibration
tflite_model = converter.convert()
```
Result: roughly 4-6 MB, ~50ms inference on a low-end device. Bundle it inside the APK.

**Step 6: Calibrate the confidence score.**
Raw softmax outputs are overconfident. Apply temperature scaling on a validation set so that "85% confident" actually means right about 85% of the time. **Without this, the entire three-tier escalation system is meaningless.** This is a 15-line addition and it is the difference between a real system and a demo.

**Numbers to put on the slide:** field-test accuracy, model size in MB, inference latency in ms on a named cheap phone, and the confusion matrix. Those four beat any architecture diagram.

### 4.2 Advisory: why nothing is fine-tuned

Fine-tuning an LLM is expensive, slow, and bakes in facts that go stale. RAG retrieves the source at question time, so:
- Answers can cite ICAR or KCC directly, which farmers trust.
- Updating knowledge means adding a text file, not retraining.
- "Answer only from sources" is a hard constraint against hallucination.

**Knowledge base contents:**
| Source | What it gives |
|---|---|
| **Kisan Call Centre transcripts** (data.gov.in / AIKosh) | Real farmer questions with real expert answers, district-wise. In actual farmer language, not textbook language. This is the single best resource available. |
| ICAR Package of Practices | Official crop-wise recommendations |
| Vaccination schedules (DAHD) | FMD, HS, BQ, Brucella timing |
| myScheme | Scheme eligibility and benefits |

500 to 1,000 short documents is plenty for the MVP.

---

## 5. Data model

Five tables. The `event` table is the product.

```sql
farmer   (id, phone, name, village, pincode, lang, gender,
          is_landless, household_id,      -- shared-device: same phone, many profiles
          farmer_id_agristack NULL, vlae_id NULL, created_at)

plot     (id, farmer_id, name, area_ha, area_local_unit, lat, lng,
                                          -- store hectares, display local. See E1b.
          soil_type NULL,                 -- DERIVED from lat/lng, never asked
          soil_n NULL, soil_p NULL, soil_k NULL, soil_ph NULL)   -- from Soil Health Card

animal   (id, farmer_id, name, species, breed, dob, photo_url,
          tag_id NULL,                    -- optional Bharat Pashudhan link
          last_calving NULL, last_insemination NULL)

event    (id, farmer_id,
          plot_id NULL, animal_id NULL,    -- exactly one is set
          type,          -- sowing | irrigation | spray | fertilizer | harvest
                         -- | disease_detected | symptom_flagged
                         -- | vaccination | insemination | expense
          data JSONB,    -- type-specific payload
          photo_url NULL, confidence NULL,
          lat NULL, lng NULL,              -- geotag: outbreak map precision + photo evidence
          at, synced BOOLEAN)

advisory (id, farmer_id, event_id NULL, question, answer_json,
          sources[], confidence, tier,     -- 'ai' | 'vlae' | 'expert'
          rating NULL, at)

thread   (id, farmer_id, crop_or_species, title, body, photo_url, status, at)
reply    (id, thread_id, author_id, author_role, body, upvotes, at)

term     (id, canonical_id, kind, lang, state, local_term,
          is_primary, validated_by)      -- regional vocabulary, see E1b
unit_conversion (local_unit, state, hectares)   -- bigha(RJ) != bigha(WB)

vlae_queue   (id, vlae_id, farmer_id, event_id, reason, status, resolved_at)
notification (id, farmer_id, channel, content, scheduled_at, sent_at)
```

**Notes on the changes**
- `soil_type` and NPK live on `plot` but are **populated by lookup, not by a form field**. See A2.
- `event.lat/lng` makes the outbreak map accurate to the plot rather than the village, and geotags any photo taken.
- `household_id` is how shared-device mode works: several `farmer` rows, one household, quick-switch in the UI, each with its own advisory feed. No separate profile table needed.
- `milk_yield` is gone from the event types. See B4.

**Non-negotiable rule: do NOT create separate `crop_event` and `animal_event` tables.**
One table is why the timeline is one query, why cross-domain advisory works, and why the outbreak map is free. Splitting it destroys the entire differentiator. This is the fragmentation the Problem Statement is complaining about, reproduced in a schema.

---

## 6. Architecture

```
┌──────────────────── PHONE (offline capable) ────────────────────┐
│  React Native + Expo                                             │
│    ├─ TFLite crop model  (INT8, ~5MB, no network)               │
│    ├─ SQLite            (local event log, source of truth)      │
│    ├─ Symptom tree JSON (offline)                                │
│    └─ Sync queue        (flushes when online)                    │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTPS, compressed 224x224 images
┌────────────────────────────▼─────────────────────────────────────┐
│  FastAPI on Render                                               │
│    ├─ /advise      RAG + Gemini Flash                            │
│    ├─ /escalate    routes to VLAE / expert queue                 │
│    ├─ /feeds       weather, mandi, schemes (cached daily)        │
│    ├─ /outbreak    pincode aggregation                            │
│    └─ /notify      daily cron: vaccination + trigger alerts       │
└────────────────────────────┬─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│  Supabase:  Postgres + PostGIS · phone OTP auth · file storage   │
└──────────────────────────────────────────────────────────────────┘

External: Bhashini (voice) · Open-Meteo/IMD · Agmarknet · myScheme · Soil Health Card · Expo Push
```

### Stack decisions (locked)

| Layer | Choice | Reason |
|---|---|---|
| App | React Native + Expo (**development build, not Expo Go**) | One codebase, team already knows it from COTTER |
| On-device ML | `react-native-fast-tflite`, INT8 model | Has an official Expo config plugin. Requires an EAS dev build |
| Local store | expo-sqlite | Offline-first requires it |
| Backend | FastAPI on Render | Python for ML, Render already provisioned |
| DB + Auth + Storage | Supabase free tier | Replaces 4 services with 1. Phone OTP auth included |
| LLM | Gemini Flash free tier | 250 req/day free, image input, no card |
| Retrieval | sentence-transformers + numpy | 500 docs does not need a vector DB |
| Voice | Bhashini | Free, 22 languages, government DPI |
| Notifications | Expo Push + Supabase cron | Vaccination reminders are P0 |
| Auth method | Phone + OTP only | No email, no passwords. Rural reality |

### Optimization rules

1. **Model on device.** ~90% of scans never touch the network.
2. **Compress to 224x224 before any upload.** The model input size anyway. 4 MB photo becomes ~40 KB. Works on 2G.
3. **UI never waits for network.** Write to SQLite, render immediately, sync in background.
4. **Cache daily feeds.** Weather and mandi prices change once a day, not per request.
5. **One event table = one query.** No joins on the hot path.
6. **Explicitly NOT using:** vector DB, Redis, Kafka, microservices, Kubernetes. All theatre at this scale.

---

## 6.1 Build risks and fallbacks

| Risk | Severity | Mitigation |
|---|---|---|
| **TFLite inside Expo** | 🔴 High | `react-native-fast-tflite` ships an official Expo config plugin, so it works, but **only in an EAS development build, not Expo Go**. Each build takes 15-20 min. **Spike this FIRST, before any UI.** Blank screen, load model, run inference on one image. If it is not working within ~2 hours, fall back to a `/predict` endpoint on FastAPI, and move "offline inference" to the roadmap slide. Losing offline hurts the pitch; losing the whole day kills it. |
| Render free tier sleeps after 15 min idle | 🟡 Medium | ~50s cold start on the first request. Ping the backend 5 minutes before the demo, or run FastAPI locally on the presenting laptop. |
| Gemini free tier: 250 requests/day | 🟡 Medium | Six people testing will exhaust it by afternoon. Generate 2-3 keys on separate Google accounts and **reserve one exclusively for the demo**. |
| Bhashini API access | 🟡 Medium | ULCA registration is not instant. Start it on day 1. Fallback for the demo: pre-recorded TTS for the 3 demo answers, or a device TTS engine. |
| Supabase offline sync | 🟢 Non-issue | Append-only events means no conflicts. See E3. |
| Blurry input images | 🟢 Non-issue | Confidence gate already handles it. No OpenCV. |

**Order of operations on day 1:** TFLite spike → schema → demo seed data → everything else. The first three are the ones that block other work.

---

## 6.2 Cost

**Cost to build and demo: ₹0.** Colab, Supabase, Render, Gemini, Bhashini and EAS all have free tiers sufficient for the MVP. See 6.1 for the limits that bite.

**Cost to serve, for the pitch.** Judges care about this because India has ~14 crore farmers. A solution costing ₹50 per query cannot scale regardless of accuracy. This is precisely why Ama Krushi's $0.18 per farmer per year mattered enough to reach 7 million people.

Our estimate, showing the arithmetic rather than asserting a number:

| Path | Share | Cost |
|---|---|---|
| On-device inference (crop scan, symptom tree, offline) | ~90% of interactions | ₹0 |
| Cloud advisory (Gemini Flash, ~2,000 tok in / 200 out) | ~10% | ~₹0.10 |
| Voice (Bhashini, government DPI) | all voice | ₹0 |
| Hosting, amortized | all | negligible |

**Claim: under ₹0.50 per advisory at scale.** State it as an estimate with the arithmetic visible.

VLAE economics (commission per escalation resolved) is a **design target, not a measured figure**. Label it as such. Do not present invented CAC, LTV, or break-even numbers.

---

## 6.3 Plumbing that is easy to forget

Small, unglamorous, and each one blocks a P0 feature if missed.

**Notifications.** Vaccination reminders are P0 and need somewhere to actually fire from.
- Scheduler: one **Supabase Edge Function on a daily cron** (or a Render cron job). It runs the due-date query, writes rows into `notification`, and dispatches them.
- Delivery: **Expo Push** for app users, SMS fallback for critical items.
- The `notification` table exists so a reminder is never sent twice and can be retried if delivery fails.

**Image storage.**
- Upload the **224x224 version** to a Supabase Storage bucket; that is what the model needs and what the timeline thumbnail shows.
- Keep the original only when the event is geotagged evidence (a damaged crop, a visible animal condition). Everything else discards the original on the device.
- `event.photo_url` points at the bucket path, `event.lat/lng` carries the geotag.

**Knowledge base deployment.**
Ship the RAG corpus as **JSON files committed to the repo**, embedded once at container start and held in memory. About 500-1,000 short documents is a few MB. No database table, no separate ingestion service, no rebuild step.

**Gemini failure fallback (needed, given the 250/day free limit).**
If the API errors or the quota is exhausted, do not show an error screen. Fall back to returning the top retrieved document verbatim, labelled as a source excerpt rather than personalised advice:
```python
try:
    return llm_advise(...)
except Exception:
    return {"action": search(question)[0], "source": "ICAR",
            "confidence": "medium", "escalate": True, "fallback": True}
```
The farmer still gets a real, sourced answer. Judges never see a stack trace.

**Demo data protection.**
Judges will tap around. If they create events on Ramesh's profile, the seeded timeline gets polluted and the next run of the demo is worse. Either mark demo rows `is_demo = true` and re-seed before each pitch, or point the Demo button at a fresh copy of the seed each time. A `reset_demo()` function, 10 lines.

**Airplane-mode verification (run it before the pitch, not during).**
```
airplane ON -> scan a leaf -> confirm diagnosis appears
            -> confirm a row exists with synced = 0
airplane OFF -> wait for flush -> confirm synced = 1 and the row is in Supabase
```

---

## 7. Main functions

```
AUTH
  sendOTP(phone)                       -> void
  verifyOTP(phone, code)               -> session
  createProfile(name, village, pincode, lang, gender, is_landless)
  switchProfile(profile_id)            -> shared-device mode

CROP
  scanCrop(image, plot_id?) -> { disease, confidence, severity, treatment, tier }
       1. resize 224x224                      (no blur check; see A1)
       2. TFLite inference (on-device)
       3. if plot_id: mask softmax to that crop's classes, renormalize
       4. temperature-scaled confidence
       5. route by tier: show | vlae_queue | expert_queue
       6. logEvent('disease_detected', ...)

  addPlot(name, area, soil, gps)
  logCropEvent(plot_id, type, data)    -> sowing/spray/harvest/expense

LIVESTOCK
  addAnimal(name, species, breed, dob, photo, tag_id?)
  checkSymptoms(animal_id, answers[])  -> { likely, action, urgency, needs_vet }
       walks the JSON decision tree, offline
  markVaccineDone(animal_id, vaccine)  -> one tap from the reminder
  getVaccineDue(farmer_id)             -> upcoming + overdue
  logInsemination(animal_id, date)     -> computes heat + calving windows
                                          (heat cycle 21d, gestation 283d)

RECORD
  getTimeline(farmer_id, limit)        -> merged crop + animal feed
  getPlotHistory(plot_id)
  compareYearOnYear(plot_id, crop)

ADVISORY
  ask(question, farmer_id, lang)       -> RAG + timeline + weather -> answer
  getAlerts(farmer_id)                 -> trigger-based only
  rateAdvisory(advisory_id, rating)    -> feeds the retraining queue

ESCALATION
  escalate(case, tier)                 -> VLAE or expert queue
  getVLAEQueue(vlae_id)
  resolveCase(case_id, resolution)

FEEDS
  getWeather(pincode)                  -> cached daily
  getMandiPrice(commodity, district)   -> cached daily
  getSchemes(farmer_profile)           -> eligibility matched
  getSoil(lat, lng)                    -> Soil Health Card, else district soil map

COMMUNITY
  postThread(crop_or_species, body, photo?)
  reply(thread_id, body)
  searchThreads(query, district)       -> "sab tamatar leaf-curl sawaal"

SYNC
  queueWrite(event)                    -> SQLite, always succeeds
  flushQueue()                         -> on connectivity, POST batch
  pullUpdates(since)                   -> server -> local

LANGUAGE
  speak(text, lang, state)             -> localize() then Bhashini TTS
  listen(audio, lang)                  -> Bhashini ASR -> resolveTerm()
  localize(canonical_id, state, lang)  -> the term this farmer actually uses
  resolveTerm(spoken_word, state)      -> canonical_id (fuzzy match)
```

---

## 8. Full user flow

### First run
```
Phone number -> OTP -> language pick (voice prompt, not a dropdown)
-> "Kheti karte ho, pashu paalte ho, ya dono?"
-> minimal profile (village, pincode)
-> NO land title required (self-declaration)
-> optional: add a plot, add an animal
-> home
```

### First-week experience (deliberate design)
Early interactions must be high-confidence so trust forms before the AI is asked to do anything hard.
```
Day 1: weather alert       (100% reliable, IMD data)
Day 3: mandi price alert   (100% reliable, Agmarknet)
Day 7: simple disease scan (high confidence, common disease)
```

### Crop disease flow
```
Camera -> resize 224x224
       -> on-device inference (offline, ~50ms)
       -> plot known? mask to that crop's classes, renormalize
       -> confidence?          (a blurry photo lands here as low confidence,
                                which is exactly what we want. No blur check.)
            >85%  : diagnosis + treatment + cost + timing (voice + text)
            60-85%: "likely X, verifying" -> VLAE queue -> notify on resolve
            <60%  : no diagnosis -> expert queue -> "4 ghante mein jawab"
       -> write event to SQLite
       -> sync when online
       -> advisory reads this event next time it runs
```

### Livestock sick-animal flow
```
Pick animal -> symptom tree (offline, 3-6 questions)
            -> [visual condition branch?] optional photo assist
            -> result: likely condition + action + urgency
            -> urgent? -> 1962 + nearest MVU + VLAE, one tap
            -> write event
```

### Advisory flow
```
Farmer speaks a question (Bhashini ASR)
  -> retrieve top-5 docs (KCC + ICAR)
  -> load farmer timeline (crop + animal, last 20 events)
  -> load weather
  -> Gemini Flash with "answer only from sources"
  -> answer: what / when / how much / why + cost-benefit + source citation
  -> Bhashini TTS -> spoken reply
  -> logged to advisory table
  -> thumbs up/down -> down-votes go to expert review
```

### Offline flow
```
No network -> crop scan still works (on-device model)
           -> symptom tree still works (local JSON)
           -> all writes hit SQLite
           -> advisory queues: "Network aane pe jawab milega"
Network returns -> flush queue -> pull updates -> deliver queued answers
```

### Community flow
```
Farmer asks (voice / text / photo)
  -> posted as a thread, tagged to crop or species + district
  -> peers, VLAE, or expert reply
  -> answered threads are searchable, so the question is answered once, not fifty times
Low-confidence AI escalations post here automatically, so an escalated
case becomes shared knowledge instead of dying in a private queue.
```

---

## 9. Why we beat every existing app

| Platform | What it does well | What it structurally cannot do |
|---|---|---|
| **Plantix** | Most-downloaded crop diagnosis app, 100M+ queries | Crop only. No animals, no records. Monetized on agri-input sales, so advice is conflicted |
| **PlantVillage Nuru** | Offline on-device diagnosis | Crop only, few crops. Documented adoption of only 14.1% in field studies |
| **Bharat Pashudhan / NDLM** | 29.6 of 30.5 crore bovines tagged | **Built for paravets and AI technicians, not farmers.** No disease help, no advisory |
| **Kisan e-Mitra** | Voice chatbot, 11 languages, 93 lakh queries | Scheme Q&A only. Cannot see a photo, cannot diagnose |
| **Ama Krushi (Odisha)** | 7M farmers, 10% crop-loss reduction, $9-15 return per $1 | **One-way.** Farmer cannot ask. Crop only |
| **iCow (Kenya)** | 13% milk, 22% household income | Dairy only. No crops |
| **eNAM / Agmarknet** | Mandi prices | Price only |

**The structural gap:** every one of these solves a slice. A farmer's maize crop *is* their cow's fodder. No existing platform holds both facts at once, so none of them can produce this sentence:

> "Your maize harvest is 2 weeks out and cattle feed cost is up 22%. Harvest 3 days early and use the stover as fodder."

That single capability is our moat, and it comes from one design decision: **one event table.**

**Four reasons we win:**
1. **Unified crop + livestock record.** Nobody has it. Everything else follows from it.
2. **AI that admits uncertainty.** 95%-lab-accuracy apps hit under 10% field adoption. Honesty plus escalation is the fix.
3. **Human bridge (VLAE).** 1:1,162 extension ratio cannot be solved by software alone. 44% vs 11% adoption is the proof.
4. **Built for who actually gets excluded.** Landless farmers, tenant farmers, and the 64.3% of the agricultural workforce that is women, over half of whom own no phone.

---

## 10. MVP scope

### Must work in the demo
0. **Pre-seeded demo farmer** with 8 months of history (see 10.1). Non-negotiable.
1. Phone OTP login
2. Add plot, add animal
3. Crop disease scan, on-device, offline, with confidence gating
4. Livestock symptom checker with vet escalation
5. Vaccination calendar with reminders
6. In-app community Q&A with 2-3 seeded resolved threads
6b. **Regional terminology**: the demo answer must use Awadhi/UP farmer vocabulary, not textbook Hindi. Even 30 validated glossary rows for the demo crops is enough to show it working.
7. **Unified timeline showing crop + animal together**
8. **Cross-domain advisory that visibly references the farmer's own history**
9. Hindi voice output
10. Airplane-mode test: scan works, writes queue, then sync

### Mocked in the demo, real on the slide
VLAE dashboard · outbreak map · mandi and scheme feeds · skin-condition photo assist · Soil Health Card import

---

### 10.1 Demo seed data — **build this, the demo fails without it**

The pitch depends on the advisory saying *"pichle saal bhi isi plot mein blight aayi thi."* A profile created live in front of the judge **has no last year**. The RAG prompt gets an empty timeline and the entire differentiator evaporates.

So the database must ship with a pre-seeded farmer, reachable from a **"Demo" button on the login screen** that skips OTP.

```
Ramesh Verma · Barabanki, UP · pincode 225001 · Hindi

PLOTS
  Plot A "Nadi wala"  · 2.0 bigha · loamy · makka, sown 18 June 2026
  Plot B "Ghar wala"  · 1.2 bigha · sandy loam · gehu (harvested Apr 2026)

ANIMALS
  Gauri  · cow · Sahiwal · b. 2021 · last calving Feb 2026
  Kali   · cow · crossbred · b. 2019
  Moti   · buffalo · Murrah · b. 2020

EVENTS (~8 months of history, ~60 rows)
  Sep 2025  Plot A: blight detected, treated        <- THE payoff row
  Oct 2025  Plot A: makka harvested, 6.8 qtl
  Nov 2025  Plot B: gehu sown
  Dec 2025  Gauri: FMD vaccine                      <- makes it overdue today
  Jan 2026  Kali: deworming
  Feb 2026  Gauri: calving
  Apr 2026  Plot B: gehu harvested, 8.2 qtl
  Jun 2026  Plot A: makka sown
  Jul-Aug   irrigation, spray, and expense rows on Plot A
            + 2 answered community threads from the district
              ("Tamatar ke patte mud rahe hain" -> resolved by a VLAE)
```

Two seeded facts carry the entire pitch:
1. **Sep 2025 blight on Plot A** makes "pichle saal bhi aayi thi" true.
2. **Dec 2025 FMD vaccine on Gauri** makes it 8 months overdue on demo day, so the cross-domain line fires.

Ship this as `seed.sql` plus a `--demo` flag. About one hour of work, and it is the highest-leverage hour in the build.

---

### 10.2 The slide that goes BEFORE the demo

Judges watch 20 demos in a day and forget every feature list. They remember a person. Put up one slide, no UI screenshots, before touching the app:

> **Ramesh Verma · Barabanki, UP · 2 bigha · 3 animals**
>
> **7:00 AM** Voice alert in Awadhi: "Kal baarish hai, aaj spray karo."
> **9:30 AM** In the field, no signal. Scans a maize leaf. Blight, 87%. Treatment on screen.
> **2:00 PM** Gauri is off her feed and giving less milk. Opens the symptom checker, answers 4 questions. Mastitis risk. One tap to 1962.
> **8:30 PM** Asks aloud: *"Ab kya karu?"*
> App: *"Blight pichle saal bhi isi plot mein aayi thi, is baar seed treatment karo. Aur Gauri ka FMD vaccine 8 mahine purana hai."*

Then say the line, and only then open the app:

> **"Every agri app in India can do 9:30 AM. Not one of them can do 8:30 PM. Here is why."**

Then show the unified timeline and the single `event` table. This makes the architecture *mean* something to a non-technical judge, instead of being a box diagram.

---

### The demo script (2 minutes)
```
0. Tap "Demo". Logs in as Ramesh, 8 months of history already there.  5s
1. Airplane mode ON. Scan a diseased maize leaf. Diagnosis appears.  20s
   -> "No internet. The model is on the phone."
2. Scan a hard/ambiguous leaf. Confidence 62%.                       20s
   -> "It refuses to guess. It escalated to an expert.
       THIS is why farmers keep using it."
3. Symptom checker on Gauri: fever + reduced milk.                   20s
   -> Suspected mastitis. Vet escalation. 1962 in one tap.
4. Open the timeline. Crops and animals in one feed, 8 months deep.  15s
5. Ask by voice: "ab mujhe kya karna chahiye?"                       40s
   -> Answer cites: today's blight, LAST YEAR's blight on the same
      plot, tomorrow's rain, AND Gauri's overdue FMD vaccine.
   -> "No other app in India can produce this sentence."
```

**Step 5 is the whole pitch.** Everything else exists to make step 5 land. If time runs out, cut features, never cut step 5.

---

## 11. Verified numbers (safe to cite)

| Claim | Value | Source |
|---|---|---|
| Ama Krushi reach | ~7 million farmers, $0.18/farmer/year | PxD / Govt of Odisha RCT |
| Ama Krushi impact | 10% less severe crop loss (26% pest/disease, 24% weather) | Same RCT |
| Ama Krushi return | $9-15 benefit per $1 spent | Same |
| iCow Kenya | +13% milk, +29% milk income, +22% household income | ILRI (Marwa & Mburu) |
| Digital Green | 44% adoption vs 11% conventional; $3.70 vs $38.18 per adoption | Digital Green evidence review |
| Extension ratio | 1 worker : 1,162 operational holdings | Indian extension literature |
| Veterinarians | ~41,000 for ~53.58 crore livestock | DAHD |
| Women in agri workforce | 64.3% | Labour statistics |
| Rural women without a phone | 51.6% of women 15+ | NSO |
| Farmer share of consumer price | 28% potato, 33% onion, 49% rice | RBI study, 16 states, 9,400 respondents |
| Bovines tagged | 29.6 of 30.5 crore | Bharat Pashudhan / NDLM |
| AgriStack Farmer IDs | 7.63 crore generated | DAHD |
| IMD AI monsoon | 1km block-level, 4 weeks ahead, launched 11 May 2026 | IMD |
| LSD detection | up to 97.6% on 1,024-image Mendeley dataset | PLOS One |

### Do NOT cite
- "LSD 98.2% on a 10,516-image dataset from 18 farms" — could not be verified; the 98.2% figures found belong to skin-cancer and lung-cancer ensemble papers.
- Any unit economics (CAC, LTV, break-even) — invented.
- "Farmers get 45% of mandi price" — use the RBI figures above instead.

---

## 12. Deliberate non-goals

- **No muzzle biometric ID.** Solves an institutional problem, not a marginal farmer's.
- **No video gait/lameness scoring.** No public dataset exists. Roadmap.
- **No marketplace, insurance, or lending in v1.** Not in the Problem Statement. Roadmap slide.
- **No satellite NDVI.** High effort, partnership-dependent.
- **No 5-year forecast.** Not credibly forecastable. Reframed as "next season recommendation."
- **No farmer data sold to anyone.** Contradicts the consent layer, and judges will catch the contradiction.
- **No OpenCV blur detection.** The confidence gate already rejects bad images. Linking native C++ for this is pure waste.
- **No sync engine.** Append-only events cannot conflict. A `synced` flag and a batch POST is the whole feature.
- **No vector database.** numpy dot product over ~500 documents is instant.
- **No invented business metrics.** Cost-to-serve gets shown with arithmetic (6.2). CAC, LTV, and break-even do not appear at all.
- **No sensors, collars, or cameras.** Precision-livestock hardware is ₹10-15k per animal and is built for 500-cow farms. Rejecting it is the pitch, not a gap.
- **No daily or weekly manual logging of anything.** Every record must be a byproduct of an action the farmer already wanted to take. See B4 for why milk logging was cut.
- **No form field for anything derivable.** Soil type comes from GPS, not from the farmer.
- **No WhatsApp channel.** Cut. In-app community Q&A (E2) covers farmer-to-farmer and farmer-to-expert. Do not re-add.
- **No area stored in local units.** Hectares in the database, always. `bigha` is not a fixed quantity in India and hard-coding a conversion is a silent 2-3x error in every dose and cost calculation.
- **No unvalidated vernacular terms.** A confidently wrong local disease name is worse than an English one.
- **No debt tracker, insurance claim module, FPO dashboard, or warehouse financing.** All four keep getting proposed by AI reviewers. None are in the Problem Statement. They stay on the roadmap slide.
