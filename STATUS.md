# HAL — honest status

*15 August 2026. Written to be useful before a demo, not to be flattering.*

The short version: **the whole system is written and it compiles, but almost none
of the app has ever run.** The model is real and measured. The backend is real and
tested. The Android app has never been installed on a phone.

---

## 1. What exists

| | files | lines | state |
|---|---|---|---|
| `ml/` dataset prep + training | 4 | 1,011 | run end to end, many times |
| `backend/` FastAPI | 4 | 862 | runs, 9 assertions pass |
| `mobile/` Expo app | 23 | 3,000 | compiles, **never executed** |
| `content/` shared JSON | 4 | 759 | validated by script, **not by an expert** |
| `artifacts/` trained model | 5 | — | 1.98 MB float16 TFLite |

Data on disk: 15 GB raw across 7 datasets, 686 MB prepared (35,055 images).

---

## 2. What is genuinely verified, and by what

These four run on demand and all pass:

| Check | What it actually proves |
|---|---|
| `python ml/labels.py` | 31-class taxonomy is consistent; 107 folder aliases resolve; 17 refusals stay refused; crop masks partition the label space |
| `python content/validate.py` | every symptom-tree node is reachable and terminates; no dangling ids; every urgent outcome needs a vet; every trained class has a treatment card; every vaccine has an interval |
| `python backend/test_api.py` | timeline returns crop + animal from one query; FMD due date arithmetic is right; brucella is refused for an adult cow; re-sending a sync batch writes nothing; profile upsert is idempotent; Devanagari and romanized queries retrieve the same doc; escalation returns a real helpline |
| `node mobile/src/domain.test.mjs` | bigha differs by state and round-trips; unknown state/unit throws instead of guessing; vaccine plan, breeding dates, symptom walks, softmax masking |

Plus: `npm run bundle` compiles all 1,047 modules.

**What "it compiles" proves:** every import resolves, all JSX is valid, no syntax
errors, the model and content files are actually in the bundle.

**What it does not prove:** that a single screen renders, that a button works,
that the camera opens, or that TFLite loads on Android.

---

## 3. Written but NEVER RUN — read this section twice

Nothing below has executed even once. Each is a plausible demo-day failure.

| Thing | Risk | Why it is unproven |
|---|---|---|
| **Every app screen** | 🔴 high | No emulator, no device. 12 screens rendered zero times |
| **TFLite on Android** | 🟡 **downgraded** | See §3b. The APK builds and the native libraries and the model are provably inside it. Still never *loaded* at runtime |
| **jpeg-js → tensor path** | 🔴 high | `ml.js` decodes the photo in JS and builds a Float32Array. That code has never processed one image |
| **Camera capture** | 🟡 med | `expo-camera` permission flow, shutter, `takePictureAsync` |
| ~~Gemini advisory~~ | ✅ **now verified** | See §3a. Ran against the real API; the cross-domain answer works and is asserted by `backend/test_advise_live.py` |
| ~~Open-Meteo weather~~ | ✅ **now verified** | Exercised by the same live run; the answer's timing line comes from the real forecast |
| **Local notifications** | 🟡 med | `notify.js` schedules reminders; none has fired |
| **expo-sqlite** | 🟡 med | Schema and queries are written against the SDK 57 async API but have not touched a real database. The identical SQL passes on the Python side |
| **Backend on Render** | 🟡 med | Runs locally. Never deployed. `render.yaml` untested |
| **Voice / TTS** | 🟢 low | `expo-speech`, standard API |

---

### 3a. The advisory now runs for real, and running it found two more bugs

`GEMINI_API_KEY=... python backend/test_advise_live.py` seeds the demo farmer and
asks *"अब मुझे क्या करना चाहिए?"* against the live API. Output:

> नदी वाला खेत में मक्का के झुलसा रोग के लिए मैंकोज़ेब 75% WP, 2.5 ग्राम प्रति लीटर
> पानी में घोलकर **आज शाम 4 बजे से पहले छिड़काव करें क्योंकि कल बारिश का अनुमान है**।
> साथ ही **गौरी का एफएमडी टीका 76 दिन से ओवरड्यू है** उसे तुरंत लगवाएं, और एचएस तथा
> बीक्यू टीके का कोई रिकॉर्ड नहीं मिला, एक बार जाँच लें।

Plot name, crop, disease, dose, live weather, and an overdue vaccine on a
different animal, in one answer, in Devanagari. `confidence: high`,
`escalate: false`, sources cited. The test asserts both domains appear, so it
fails loudly if this ever regresses.

The first two attempts did **not** work, and neither failure was visible offline:

9. **Retrieval ignored the timeline.** "अब मुझे क्या करना चाहिए?" contains no crop
   and no disease, so TF-IDF retrieved three unrelated livestock documents and the
   model escalated to the call centre. The farmer's situation lives in their
   timeline, so the timeline now forms part of the retrieval query, not just the
   prompt.
10. **Vaccines with no record read as years overdue.** A cow with no deworming row
    showed "1,923 days overdue", which is not a fact we have and which buried the
    genuinely overdue FMD underneath it. A missing row is now capped at one
    interval, flagged `no_record`, sorted below recorded ones, and described to
    the model as "koi record nahi" rather than as overdue.

Both were product bugs, not integration bugs. The offline suite passed throughout.

---

### 3b. The APK builds, which retires half of the biggest risk

`SPEC.md` 6.1 rated "TFLite inside Expo" as the project's #1 red risk and told us
to spike it before any UI. It was spiked last instead. It works.

| APK | size | ABIs | model inside |
|---|---|---|---|
| `dist/bahi-arm64.apk` | **50 MB** | arm64-v8a | md5 identical to `artifacts/crop_model.tflite` |
| `dist/bahi-universal.apk` | 142 MB | all four | same |

Verified by unzipping the APK, not by trusting the build log:

- `lib/*/libtensorflowlite_jni.so`, `libtensorflowlite_gpu_jni.so`,
  `libNitroTflite.so`, `libNitroModules.so` present for every ABI
- `res/mn.tflite` is byte-for-byte our model (Metro renames assets in release
  builds, which is why it is not under `assets/`)
- the Hindi strings, the symptom tree and the label list are inside
  `assets/index.android.bundle`

Ship the 50 MB one. The universal build carries x86 and x86_64 for emulators
only, and 142 MB is a bad number to put next to a pitch about cheap phones.

Local build needs JDK 17; the machine had only JRE 1.8, which would have failed
Gradle. `D:\tools\jdk-17.0.20+8` was installed for it.

**What this does NOT prove:** that the app launches, that a screen renders, or
that `loadTensorflowModel()` succeeds at runtime. The library is in the box. It
has not been switched on.

---

## 4. Deliberately mocked or substituted

Not bugs. Decisions, with the reason.

- **OTP login is fake.** No SMS is sent; any 4+ digit code proceeds. Real OTP needs
  a provider account. The Demo button bypasses it entirely.
- **Bhashini is NOT integrated.** Voice is the Android device TTS engine
  (`expo-speech`), Hindi locale. The blueprint calls Bhashini the production path
  and device TTS the fallback; only the fallback exists. ULCA registration was
  never started. **Do not claim Bhashini on a slide.**
- **Soil type is not derived from GPS.** `SPEC.md` A2 says look it up from the Soil
  Health Card. The field exists in the schema and is stored, but no lookup is
  wired; the demo seed sets it by hand.
- **VLAE queue is a case number.** Tier-2 escalations generate and display a real
  case number and record it server-side. No VLAE dashboard exists.
- **INT8 → float16.** `SPEC.md` 4.1 asked for INT8. It was built, measured, and
  rejected: only 23 of 30 predictions matched the float model. float16 is 2.6 MB
  instead of 1.25 MB and matches perfectly. The size budget was 4-6 MB.

---

## 5. Not built at all

- **In-app community Q&A** (`SPEC.md` E2, MVP item 6). The blueprint's §3.1 scope
  lock lists only four features and this is not one of them. Two documents
  disagree; I followed the newer one. Tables are not in the app schema.
- **Regional terminology rows** (`SPEC.md` E1b). The mechanism is complete end to
  end: the model emits canonical ids, the `term` table exists, `/advise` injects a
  per-farmer glossary into the prompt, and `localize()` picks the word last. There
  are **zero rows in it.** The spec's own rule is that unvalidated vernacular is
  worse than English, and I cannot validate Marwari disease names.
- Mandi prices, schemes, outbreak map UI, milk logging, photo-assist for skin
  conditions, year-on-year comparison. All scoped out by the blueprint.
- **`chilli`** — no public dataset exists. Every Kaggle result titled "chilli leaf
  disease" turned out to be PlantVillage **bell pepper** renamed.

---

## 6. Needs a human before a farmer sees it

Three files ship with `_validated_by: null` and a warning at the top.

| File | Who | Why it matters |
|---|---|---|
| `content/symptom_tree.json` | district vet | 24 clinical outcomes written from public triage references, not by a vet |
| `content/treatment_plans.json` | KVK plant-protection officer | 31 pesticide doses. A wrong dose costs money and can damage the crop |
| `mobile/src/domain.js` `UNITS` | state revenue figures | **The quietest risk in the codebase.** A bigha is not a fixed area in India. A wrong conversion makes every dose and cost wrong by up to 3x with no error message. `validate.py` cannot catch it |

---

## 7. The model, honestly

**31 classes across 6 crops.** Trained on 29,530 images from 7 datasets; tested on
361 held-out in-the-wild photos that were never trained or calibrated on.

| | |
|---|---|
| Validation accuracy | 93.9% |
| **Field accuracy** | **44.9%** |
| Field accuracy, crop-conditioned | 53.2% |
| Field treatment accuracy | 57.9% |
| **Tier-1 precision** | **82.9%** |
| **Tier-1 treatment precision** | **97.1%** |
| Field ECE, before → after field calibration | 0.222 → 0.045 |
| Size | 1.98 MB float16 |

### Three builds, and what each one taught

| build | field acc | tier-1 share | tier-1 precision |
|---|---|---|---|
| v1 | 22.5% | 34% | **28.9%** |
| v2 | 33.3% | 19% | 66.7% |
| v3 | **44.9%** | 9.7% | **82.9%** |

v1 answered confidently on a third of field photos and was **wrong 71% of those
times.** Validation accuracy across all three builds moved 93.2 → 93.9. Every
number that mattered moved in the field column, and none of it was visible from
validation.

### Per crop — the most useful table in this document

| crop | field accuracy | n |
|---|---|---|
| **maize** | **75.7%** | 111 |
| rice | 41.7% | 24 |
| potato | 31.2% | 48 |
| tomato | 29.8% | 178 |

Same model, same run. Maize had the most in-the-wild training images; tomato had
the fewest relative to its nine classes. This is the proof that the gap is data,
not architecture. The demo crop is the strong one, which is worth saying out loud
rather than hoping nobody asks.

Two rows a judge could find: `tomato__bacterial_spot` is 0 of 25 on field photos,
`potato__early_blight` is 3 of 25.

### Bugs found and fixed along the way

Each one was silent, and each would have survived to demo day.

1. **PlantDoc extraction died partway** (333 of 2,600 images) because some
   filenames contain `?` and some exceed Windows MAX_PATH. It exited 0 because the
   output was piped. Result: zero field images in training, and a model that had
   learned "plain background means classify confidently."
2. **Train/test leakage.** The corn/maize dataset bundles PlantDoc's corn photos.
   Without hashing field images first, every PlantDoc maize image landed in
   training and "held-out field accuracy" was measured on fitted images.
3. **Temperature fitted on the wrong distribution.** Validation is ~95% studio
   imagery, so the confidence gate was calibrated for photos the app never sees.
   Val ECE read 0.007 the whole time while field ECE was 0.222.
4. **`cow` resolved to no vaccine schedule.** The species map had `buffalo` but not
   `cow`, so every cow silently got an empty vaccination plan. Caught by a test.
5. **KB was romanized-only.** Bhashini ASR returns Devanagari; lexical retrieval
   matched nothing. Every doc now carries both scripts.
6. **Sync never sent farmer, plot or animal rows** — only events. `/advise` would
   have 404'd on the server and the cross-domain line would have died.
7. **INT8 quantization changed 7 of 30 predictions.**
8. **Metro does not bundle `.tflite`** without config, so the model would have been
   silently absent from the APK.

### The sync had been failing the entire build, and looked fine

Found on 16 Aug by asking the running app a question and then asking the server
the same question. The app said गौरी's vaccine was 76 days overdue. The server,
about the same cow on the same day, said no record existed. `/timeline` showed
why: **zero events on the server**, while the profile was there.

Four causes, each hiding the next:

9. **`/sync` inserted a whole batch in one transaction.** One row the schema
   refused rolled the other forty back and returned a bare 500. Now per-row,
   and the reply names each rejected row with its reason.
10. **The schema refused a scan with no plot** (`CHECK plot_id IS NOT NULL OR
    animal_id IS NOT NULL`), which the app creates deliberately: you can
    photograph a leaf before entering a single field. So an ordinary scan
    poisoned the queue for good.
11. **`App.js` swallowed the flush error in an empty catch.** Nothing anywhere
    said a word. This is the same failure mode as the model-load bug and the
    404-reported-as-offline bug, for the third time in one project.
12. **The server DB is ephemeral and the phone never re-offered its log.** Every
    redeploy emptied the server permanently, because those rows were already
    marked synced. `/health` now returns a `boot_id` and the phone re-sends when
    it changes.

And two the advisory showed once the data was actually flowing:

13. **The prompt told the model, in Roman, to say "ek baar jaanch lein".** It
    printed the instruction back as **"एक बार जाanch लें"**. Naming a forbidden
    word in the prompt is how that word reaches the farmer.
14. **English mode was Hindi.** The Devanagari rule was unconditional and sat
    directly under the language line; the vaccine notes fed to the model were
    Devanagari-only; and the app passed the literal string `'Hindi'` at its one
    call site. Three independent reasons, all pointing the same way.

---

## 8. Where the time went

Roughly: 40% data (download, mapping, dedupe, three rebuilds), 25% model (four
training runs, calibration, export), 20% app, 15% backend and content.

The datasets took longest and produced the most surprises. Every hour spent on
`prepare.py` bought a real accuracy point; the last hour on calibration bought 16
points of tier-1 precision.

---

## 9. Next

1. **EAS dev build and install on a real phone.** Everything still open in §3
   resolves or breaks here, and nothing else can be trusted until it does.
2. Deploy the backend, ping `/health` five minutes before the demo.
3. Rehearse tier 3. It is the highest-scoring moment and it needs a leaf that
   actually lands under 0.60.
4. Get the three files in §6 signed off.

Each of the ten bugs in this document was found by **running** something, never by
reading it. Eight came from the offline checks, two only appeared once the real
API was called. The app has not been run at all yet, which is the honest reason to
expect more.

**Rotate the Kaggle and AIKosh keys after the demo.** Both were pasted into a chat.
