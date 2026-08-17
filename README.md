# हल · HAL

**खेती की हर बात, एक साथ**, every part of farming, together. One record for a
farmer's crops and animals, so the advice knows about both.

SIH Problem Statement 1. Design docs: [`SPEC.md`](SPEC.md) (features, schema, thesis)
and the UI blueprint that ships alongside it.

---

## What is here

```
ml/         dataset prep + training for the crop disease model
backend/    FastAPI: RAG advisory, sync, vaccination, escalation
mobile/     Expo app: offline-first, on-device inference
content/    shared JSON: symptom tree, vaccine schedule, treatments, strings
artifacts/  trained model output (crop_model.tflite, metrics.json)
data/       downloaded + prepared datasets (gitignored, ~12 GB)
```

`content/` is the single source of truth for anything a farmer reads. The
backend reads it directly; `mobile/scripts/sync-assets.mjs` copies it into the
app bundle on `npm start`. Never edit `mobile/assets/*.json`, it is a copy.

---

## Run it

```bash
cd backend && pip install -r requirements.txt && uvicorn main:app --reload
```

```bash
cd mobile && npm install && npm start
```

Expo Go will not work: `react-native-fast-tflite` is native, so the app needs a
real build.

### Build the APK

Needs **JDK 17** (Gradle for RN 0.86 rejects JDK 8) and the Android SDK.

```bash
cd mobile && npm run sync && npx expo prebuild --platform android --clean
```

```bash
cd mobile/android && JAVA_HOME=/path/to/jdk-17 ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Output lands in `mobile/android/app/build/outputs/apk/release/`. Dropping the
`-P` flag builds all four ABIs and triples the size to 142 MB; arm64-v8a alone
covers every phone since roughly 2016 and comes to 50 MB.

Release is signed with the debug keystore, which installs fine and is not
publishable. Generate a real keystore before any store upload.

### Point it at a backend

`EXPO_PUBLIC_API` is the compiled-in default (emulator: `http://10.0.2.2:8000`),
but **Settings → सर्वर पता** overrides it at runtime and persists. Use that rather
than rebuilding when the backend moves.

### Deploy the backend

render.com → New → Blueprint → this repo. `render.yaml` at the root does the
rest; Render will prompt for `GEMINI_API_KEY`, which is `sync: false` and so
never lives in the repo.

---

## Checks

Every non-trivial piece leaves one runnable check behind. All four pass.

```bash
python ml/labels.py            # taxonomy, aliases, refusals
python content/validate.py     # symptom tree reachability, schedules, treatments
python backend/test_api.py     # timeline, vaccine arithmetic, sync, escalation
node mobile/src/domain.test.mjs # units, vaccine plan, breeding, softmax masking
```

`cd mobile && npm run bundle` compiles the whole app and is the fastest way to
catch a broken import.

---

## The model

```bash
python ml/prepare.py    # merge + dedupe + resize -> data/prepared
python ml/train.py      # train, calibrate, export INT8 tflite -> artifacts/
BAHI_REUSE=1 python ml/train.py   # skip training, redo eval + export only
```

**30 classes across 6 crops**: rice, wheat, maize, tomato, potato, cotton.

### Model card

Field numbers are on 1,606 held-out in-the-wild photographs from eight
collections, covering 26 classes. Nothing in that set was trained or calibrated
on.

| | |
|---|---|
| Held-out validation accuracy | 93.1% |
| Field accuracy, all sources | 76.1% |
| **Field accuracy, independent imagery only** | **46.9%** |
| Field accuracy, crop-conditioned | 80.6% |
| **Field treatment accuracy** (right spray, whatever the label) | **80.1%** |
| **Tier-1 precision** (when it answers, is it right) | **97.9%** |
| **Tier-1 treatment precision** (when it answers, is the spray right) | **98.1%** |
| Tier-1 share (how often it answers at all) | 45.2% |
| Field ECE, before / after field calibration | 0.071 → **0.036** |
| Model size | **1.98 MB** float16 TFLite, MobileNetV3-Small |
| TFLite vs float32 agreement | **1.00** |

Confusion matrix: `artifacts/confusion.csv`. Full metrics: `artifacts/metrics.json`.

**Lead with the field number, not the validation number.** Everyone in the room
knows the PlantVillage-style split figure is inflated, and volunteering the gap
is what makes the rest of the pitch credible.

### Two field numbers, and why both are printed

76.1% is across every held-out field photograph. 46.9% is across PlantDoc alone.

A donated field dataset is usually one team, one camera and a handful of
sessions, so holding images out of it does not hold out much: the test photo
looks like the training photos because it was taken minutes later in the same
row. PlantDoc is web imagery from everywhere, it shares no collection with
anything in training, and it is the closest thing here to a stranger's phone.

| source | n | accuracy | answers | precision when it answers |
|---|---|---|---|---|
| cotton, one institute's field | 143 | 93.0% | 60.1% | **100%** |
| potato, Tanzanian smallholdings | 271 | 91.9% | 72.0% | 99.5% |
| cotton, a second unrelated survey | 194 | 87.6% | 60.8% | 99.2% |
| tomato, Jodhpur and Jaipur | 169 | 87.6% | 42.6% | 98.6% |
| CCMT, Ghanaian farms | 255 | 74.5% | 37.6% | 99.0% |
| wheat field subset | 212 | 73.1% | 62.7% | 93.2% |
| ICAR India | 55 | 60.0% | 25.5% | 92.9% |
| **PlantDoc, web imagery** | **307** | **46.9%** | **3.9%** | **91.7%** |

Quote 46.9%. Anyone who has trained one of these will ask about exactly this,
and having the breakdown ready is worth more than the higher number.

The two cotton rows are the cleanest illustration of why. Cotton used to come
from one institute's field in Gazipur and scored 97.9% on images held out of
it, which measured memory of a farm. Adding a second, unrelated cotton survey
dropped that row to 93.0% and put the new one at 87.6%. **The number went down
and that was the point.** Any single-source score in this table should be read
as an upper bound on what a stranger's phone would get.

### Read these three numbers together, or none of them

**46.9% field accuracy on independent imagery** is the model naming the exact
pathogen from a photograph unlike anything it trained on. On its own it sounds
unusable.

**97.9% tier-1 precision** is what the farmer experiences. The app only puts a
diagnosis on screen above 0.85 confidence. On familiar-looking photographs it
crosses that line 60 to 70% of the time and is essentially never wrong; on
PlantDoc it crosses it on one photograph in twenty-six. The model declines the
ones it cannot read.

**Several classes share a treatment** (early blight, septoria and gray leaf spot
all get mancozeb 2.5 g/l), so a wrong label is often still the right action, and
the action is the only thing the farmer buys: tier-1 treatment precision is
98.1%.

**The remainder is not failure, it is the design.** 24.0% of field photographs
route to "being verified" and 30.8% to "we cannot tell, call the Kisan Call
Centre". Every one of those ends at a real dialable number.

### How the numbers got here

| Build | field acc | tier-1 share | tier-1 precision | what changed |
|---|---|---|---|---|
| v1 | 22.5% | 34% | **28.9%** | all field images held out of training |
| v2 | 33.3% | 19% | 66.7% | PlantDoc train half added to training |
| v3 | 44.9% | 9.7% | 82.9% | + ICAR Indian field data, 3x field oversampling, temperature fitted on field data |
| **v4** | 76.1% (46.9% independent) | **45.2%** | **97.9%** | + 6 field datasets, background-attacking augmentation, source-aware splits |

v1 is the cautionary tale: it answered confidently on a third of field photos and
was wrong 71% of those times. v4 answers four and a half times as often as v3 and
is wrong once in forty instead of once in six.

Validation accuracy barely moved across all four builds (93.2 → 92.8).
Everything that mattered happened in the field column.

**What v4's extra data did not do:** on the same 116 PlantDoc holdout images
before and after, 37.1% → 37.9%. Nine thousand new field photographs bought
almost nothing on imagery that does not resemble them. What they bought instead
was calibration, and that is where tier-1 precision came from. The next real
gain is Indian field photographs from many phones and many farms.

The single largest fix was **calibration on the right distribution**. Temperature
fitted on the lab-heavy validation split comes out at 1.1; fitted on held-out
field photos it is 1.8. The model was systematically overconfident on exactly the
images the app sees, and no amount of extra training would have shown that,
because validation ECE looked fine (0.007) the whole time.

### Per-crop, and why this is the most useful table here

| crop | field accuracy | n | prediction stayed in the right crop |
|---|---|---|---|
| **maize** | **75.7%** | 111 | 99.1% |
| rice | 41.7% | 24 | 54.2% |
| potato | 31.2% | 48 | 62.5% |
| tomato | 29.8% | 178 | 75.8% |

Maize is 2.5x better than tomato, from the same model, the same architecture and
the same training run. The only difference is that maize got the most in-the-wild
training images (ICAR turcicum and fall armyworm, PlantDoc corn, the corn/maize
set: 228 field images for northern leaf blight alone) and tomato got the fewest
relative to its nine classes.

That is the entire argument in one table: **this is a data problem, not a model
problem**, and it is measurable rather than asserted. It also means the demo crop
is the strong one, which is honest to say out loud rather than hide.

Two rows to know before a judge finds them: `tomato__bacterial_spot` scores 0 of
25 on field photos, and `potato__early_blight` 3 of 25 (12 of those go to potato
late blight, which shares a treatment). Both are in `artifacts/confusion.csv`.

### Why it is still not shippable, and what actually fixes it

Not a model problem, a data problem: 802 ICAR images and ~2.6k PlantDoc images
against a need for thousands of Indian field photos per class. Bigger models and
longer training buy a few points, not forty.

The fix is already in the product's architecture: **every tier-2 and tier-3
escalation is an unlabelled Indian field photo that a KVK expert then labels.**
The app's refusals are its training pipeline. A platform that never refuses never
finds out when it was wrong.

Sources (all free, no login except Kaggle): Mendeley 15-crop/45-disease,
PlantVillage, Kaggle Indian crops disease, Kaggle rice leaf disease, Kaggle
corn/maize leaf disease, a fall-armyworm set, and PlantDoc for field images.

Three rules in `prepare.py` that matter more than the code:

1. **Nothing is guessed.** A source folder maps to a label only via an explicit
   alias. Unmapped folders are dropped and printed. `labels.REFUSED` records
   the ones that look mappable but are not, with the reason.
2. **PlantDoc is field-test only**, never training. It is the only in-the-wild
   source, so it is the only honest accuracy number.
3. **Deduped by content hash, field images first.** These datasets mirror each
   other; the corn/maize set bundles PlantDoc's corn photos, so without the
   ordering every field image lands in training and the "held-out" number is a
   lie.

### Two classes were cut, deliberately

- **chilli** (3 classes): no public chilli disease dataset exists. Every Kaggle
  result titled "chilli leaf disease" turned out to be PlantVillage **bell
  pepper** folders renamed. Bell pepper is not chilli.
- **rice sheath blight**: absent from every rice dataset located.

Say this out loud in the pitch. It is the same instinct as `SPEC.md` section 11's
*Do NOT cite* list, and it is cheaper than being caught.

---

## What is NOT validated yet

Three files carry a `_validated_by: null` and a warning at the top. They are
written from public references, **not** by a professional:

| File | Needs sign-off from |
|---|---|
| `content/symptom_tree.json` | a district veterinary officer |
| `content/treatment_plans.json` | a KVK plant-protection officer |
| `mobile/src/domain.js` `UNITS` | state revenue figures for each bigha value |

The unit table is the quietest of the three. A bigha is not a fixed area in
India, so a wrong conversion makes every fertiliser dose and cost figure wrong
by up to 3x, with no error message. `content/validate.py` will not catch it;
only a human will.

---

## Deliberate non-goals

No sensors or collars. No daily manual logging of anything. No muzzle
biometrics. No vector database. No sync engine (append-only events cannot
conflict). No OpenCV blur check (the confidence gate already rejects bad
photos). No area stored in local units. No farmer data sold, ever.

Full list and reasoning in `SPEC.md` section 12.
