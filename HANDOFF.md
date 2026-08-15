# HAL: session handoff

*16 August 2026. Everything a fresh session needs to pick this up.*

Read `STATUS.md` for the honest state of the product and `README.md` for the
model card. This file is the operational context: where things are, what runs,
what is verified, and what bites.

---

## 1. What this is

**HAL / हल**, "खेती की हर बात, एक साथ". SIH Problem Statement 1. One record
holds a farmer's crops **and** animals, which is what makes the cross-domain
advisory, the merged timeline and the outbreak map possible. Splitting that
table destroys the entire differentiator; `SPEC.md` section 5 says so and it is
correct.

```
D:\SIH AgriVision\
  SPEC.md        the feature spec (given, do not rewrite)
  README.md      model card, build steps, dataset rules
  STATUS.md      what is verified vs never run. Keep this honest.
  DEMO-DATA.md   what to type in by hand, and the test photos
  HANDOFF.md     this file
  ml/            dataset prep + training
  backend/       FastAPI, deployed on Render
  mobile/        Expo app
  content/       shared JSON, single source of truth for farmer-facing text
  artifacts/     trained model
  dist/          built APKs (gitignored)
  data/          15 GB of datasets (gitignored)
```

Repo: `https://github.com/Ankur11112006/bahi` (private, master).
Backend: `https://bahi-backend.onrender.com` (live, free tier).

> The GitHub repo and the Render service are still named `bahi`. Renaming the
> Render service in `render.yaml` creates a **second** service on a different
> URL, and that URL is compiled into the APK as the default. The name is
> invisible to users; the working URL is not. Leave it.

---

## 2. State right now

Last commit `22d1408`, working tree clean, everything pushed.

| | state |
|---|---|
| Model | trained, `artifacts/crop_model.tflite`, 1.98 MB float16 |
| Backend | live on Render, all tests pass, Gemini verified against the real API |
| App | runs on a device, most flows verified by hand (see §4) |
| `dist/hal-arm64.apk` | **STALE.** Built before the last two commits. Rebuild before giving it to anyone |
| Emulator APK | current for mobile code, but the last two backend fixes are server-side only |

**The first thing to do in a new session is rebuild the arm64 APK** (§3).

---

## 3. Commands

Environment gotchas, all of which cost time to rediscover:

- **JDK 17 is required** and lives at `D:\tools\jdk-17.0.20+8`. The machine's
  default is JRE 1.8, which Gradle rejects outright.
- **Use PowerShell for `adb`**, not Git Bash. Git Bash mangles remote device
  paths (`/sdcard/...` becomes `C:/Program Files/Git/sdcard/...`).
- `npx expo` needs `--no-install`, otherwise npm tries to fetch a global copy.

```bash
# checks: all four pass, run them before any build
python ml/labels.py
python content/validate.py
python backend/test_api.py
node mobile/src/domain.test.mjs
```

```bash
# live advisory test, costs Gemini quota, needs the key
cd backend && GEMINI_API_KEY=... python test_advise_live.py
```

```bash
# bundle only: fastest way to catch a broken import
cd mobile && npm run sync && npx --no-install expo export --platform android --output-dir .expo-export
```

APK, from PowerShell:

```powershell
$env:JAVA_HOME = "D:\tools\jdk-17.0.20+8"; $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
cd "D:\SIH AgriVision\mobile"; npm run sync
cd android
.\gradlew.bat assembleRelease --no-daemon "-PreactNativeArchitectures=arm64-v8a" -q
Copy-Item "app\build\outputs\apk\release\app-release.apk" "..\..\dist\hal-arm64.apk" -Force
```

`arm64-v8a` for real phones (~51 MB). `x86_64` for the emulator. Dropping the
flag builds all four ABIs and triples the size to 142 MB, which is a bad number
next to a pitch about cheap phones.

Driving the emulator:

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb install -r "app\build\outputs\apk\release\app-release.apk"
& $adb shell am start -n in.hal.app/.MainActivity
& $adb shell screencap -p /sdcard/s.png; & $adb pull /sdcard/s.png shot.png
& $adb shell uiautomator dump /sdcard/ui.xml   # real button bounds, trust this over screenshots
```

**Read button positions from `uiautomator`, not from screenshots.** Screenshot
scaling made text look truncated twice ("लगवा" instead of "लगवा दिया", a chip
missing its crop name) and both were rendering artifacts, not bugs. The XML has
the truth.

---

## 4. Verified on a real device, and how

Walked by hand on an x86_64 emulator, release build, with logcat open.

- **Model loads on device.** `[ml] model loaded from file:///.../ExponentAsset-474b05a4fc2cdaf2....tflite`, and that hash matches `artifacts/crop_model.tflite`.
- **Full scan pipeline.** Gallery photo of maize northern leaf blight → "शायद मक्का का झुलसा रोग", 67%, tier 2, **no treatment shown**, case number HL-8301, and the crop-conditioning note. Exactly the designed behaviour.
- **Crop conditioning** fires when a plot chip is selected.
- **Unified timeline.** Crop and animal rows interleaved in one feed, three zones, filter chips.
- **Advisory** answers from the phone, cross-domain, fully Devanagari, citing ICAR and DAHD.
- **Demo seed, home, camera, gallery picker, language screen, onboarding, settings** all render and work.
- **Hindi and English** both complete, 238 keys each, `validate.py` fails on any mismatch.

Not yet walked: symptom checker end to end, English mode on the device,
notifications actually firing, `मेरा डेटा मिटाएँ` count, airplane-mode sync.

---

## 5. Eight bugs found by running it, and the pattern

Every one was invisible to the bundler, the test suites and APK inspection.

1. **Model never loaded in release.** `require()` of a `.tflite` works in dev (Metro serves over http) and fails in release (compiled into `res/`, resolves to a bare resource name): `MalformedURLException: no protocol: assets_crop_model`. Fixed with `expo-asset`.
2. **`loadTensorflowModel` v3 needs a `delegates` argument** and exchanges ArrayBuffers, not typed arrays.
3. **Demo button did nothing, forever.** `resetDemo()` ran `DELETE FROM advisory WHERE is_demo = 1` against a table with no such column; the rejection was unhandled so the button was simply inert.
4. **Vaccines with no record showed as "365 days overdue"** and outranked a genuinely overdue FMD.
5. **Home did not scroll**, hiding the ledger section behind the mic pill.
6. **Home claimed "nothing urgent"** because the notification dialog stole focus and cancelled its query.
7. **"No internet" when the server answered in 0.5s.** The health check allowed 4s, less than a TLS handshake on a slow link.
8. **Advisory named the wrong disease** (रतुआ instead of झुलसा) and called a no-record vaccine "overdue", because it was sent `overdue=true` and `status="koi record nahi"` together.

> The pattern in all eight: **a `catch` that swallowed the reason, or a value
> that contradicted itself.** Every fix included making the failure visible.
> If something in this app appears to do nothing, assume an error is being
> eaten and go find it, rather than guessing at the cause.

A related rule that keeps paying: **anything the model echoes must already be
in the target script.** Sending it `"FMD"`, `overdue: true` and romanized status
strings produced "गौरी का FMD टीका overdue है, एक बार jaanch lein" in an app
whose entire premise is speaking the farmer's language.

---

## 6. Open, roughly in order

1. **Rebuild `dist/hal-arm64.apk`.** It is two commits stale.
2. Walk the symptom checker, English mode, and notifications on the device.
3. Airplane-mode test: scan works, writes queue, then sync (`SPEC.md` 6.3).
4. Three files need a human before a farmer sees them, all carrying
   `_validated_by: null` and a warning:
   - `content/symptom_tree.json`: a district vet
   - `content/treatment_plans.json`: a KVK plant-protection officer
   - `mobile/src/domain.js` `UNITS`: state revenue figures. **The quietest
     risk in the codebase**: a bigha is not a fixed area, and a wrong
     conversion makes every dose and cost wrong by up to 3x with no error.
5. Field accuracy is 44.9% (maize 75.7%, tomato 29.8%). Not shippable. The fix
   is Indian field imagery, not a bigger model. Say the number out loud in the
   pitch.
6. Not built: in-app community Q&A (`SPEC.md` E2, cut by the blueprint's scope
   lock), regional glossary rows (mechanism complete, zero rows, and the spec
   forbids shipping unvalidated vernacular).
7. Not integrated: **Bhashini**. Voice is the Android TTS engine. Do not claim
   Bhashini on a slide.
8. OTP is fake: any 4+ digit code proceeds.

---

## 7. Credentials

Three keys were pasted into a chat during this build and are **not** in the
repo: Kaggle, AIKosh, and Gemini. `GEMINI_API_KEY` lives in the Render
dashboard as `sync: false`. **Rotate all three after the demo.**

---

## 8. Decisions worth not relitigating

- **React Native, not Kotlin/Compose.** The UI blueprint asks for Compose; its
  own risk register rates "nobody has shipped Compose" as high. The Expo path
  worked.
- **float16, not INT8.** `SPEC.md` asked for INT8. It was built, measured, and
  rejected: only 23 of 30 predictions matched the float model. float16 is
  1.98 MB against a 4-6 MB budget and matches exactly.
- **PlantDoc's test half is the field set and never trains.** Its train half
  does, because holding out all of it produced a model that was confidently
  wrong on a third of real photos.
- **Nothing is guessed in `ml/labels.py`.** Unmapped source folders are dropped
  and printed; `REFUSED` records the ones that look mappable but are not, with
  reasons. Chilli was cut because every "chilli" dataset found was PlantVillage
  bell pepper renamed.
- **Tier 3 is the pitch, not tier 1.** The app showing no diagnosis below 0.60
  is the product. Do not lower the threshold to make demos smoother.
