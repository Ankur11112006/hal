# HAL: session handoff

*16 August 2026, updated after a device-testing pass that found the sync had
never worked. Everything a fresh session needs to pick this up.*

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

Repo: `https://github.com/Ankur11112006/hal` (private, master).
Backend: `https://bahi-backend.onrender.com` (live, free tier).

> **The GitHub repo was renamed from `bahi` to `hal` on 17 August. The Render
> service was not, and must not be.** Renaming the service in `render.yaml` does
> not rename it, it creates a **second** service on a different URL, and that URL
> is compiled into the APK as the default. So `bahi-backend.onrender.com` keeping
> the old name is deliberate, not a leftover anyone should tidy up. The service
> name is invisible to users; the working URL is not.
>
> The same reasoning covers the two other places `bahi` survives on purpose: the
> `BAHI_*` environment variables (one of them is set in the Render dashboard) and
> the `bahi.*` AsyncStorage keys. Renaming the keys makes every phone already
> carrying the app forget its language, server address and boot id on the next
> upgrade, in exchange for a string nobody sees.

---

## 2. State right now

17 August, working tree clean, everything pushed.

| | state |
|---|---|
| Model | v4, `artifacts/crop_model.tflite`, 1.98 MB float16, MobileNetV3-Small |
| Backend | live on Render, all tests pass, Gemini verified against the real API |
| App | walked by hand on an emulator: scan, ledger, symptom check, advisory, all three languages, and a full airplane-mode round trip |
| Languages | Hindi, English, **Marathi** |
| `dist/hal-arm64.apk` | current, 51 MB, built 17 Aug |

**The number to quote is 46.9%, not 76.1%.** Both are in the model card and §5
of this file explains the difference in one paragraph. Getting that backwards in
a pitch is the single easiest way to lose credibility with a judge who has
trained one of these.

Rebuild the APK after any change under `mobile/`. Backend changes deploy
themselves on push, but **only when something under `backend/` changed**: Render
uses `rootDir: backend` and skips the deploy otherwise.

### Five minutes before the demo

Render's free instance sleeps after 15 minutes idle, takes about 50 seconds to
wake, **and its database is wiped when it does**. Open
`https://bahi-backend.onrender.com/health` to wake it, then give the app a
minute on the phone: `/health` returns a `boot_id`, the phone notices it is new
and re-sends the whole event log by itself. Without that minute the advisory
answers about an empty farm.

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

> **Do not try the arm64 APK on an x86_64 emulator.** `adb install` reports
> Success and `ro.product.cpu.abilist` advertises `arm64-v8a`, so it looks
> supported. It is not: Android selects the arm64 lib dir, SoLoader then probes
> `base.apk!/lib/x86_64` because the libs ship uncompressed, finds nothing, and
> the process dies before the first screen with
> `SoLoaderDSONotFoundError: couldn't find DSO to load: libreactnative.so`.
> Build with `-PreactNativeArchitectures=x86_64` instead. `dist/hal-x86_64.apk`
> is the current emulator build, `dist/hal-arm64.apk` the phone one.

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

- **Symptom checker end to end.** Gauri, "can't get up" + "calved recently" →
  दूध बुख़ार (कैल्शियम की कमी), the "हमें पक्का पता नहीं" caveat, an urgent action,
  a tappable 1962, and a row written to the ledger.
- **English end to end.** Every label, the five tabs, and the advisory itself,
  which correctly says a Hindi-entered record back in English.
- **Sync, verified from both sides.** 34 events on the server, and
  `/vaccine-due/demo-ramesh` agreeing with the home card down to the date.
- **Re-sync after a server wipe**, seen in logcat: `server is new to us (null ->
  43f79861e029), re-sending 32 events`.
- **Marathi end to end.** Onboarding, home, tabs, vaccine names. Offered in the
  picker; Punjabi, Bengali and Telugu still say "जल्द आएगी" because their string
  files do not exist and the picker reads that, never a hand-set flag.
- **The full offline round trip (SPEC.md 6.3).** Airplane mode on: the offline
  chip appears, a gallery photo runs entirely on-device to tier 3, the advisory
  queues as "इंटरनेट आते ही जवाब मिल जाएगा" with the question kept. Airplane mode
  off: `[sync] sent 2 events`, both on the server afterwards with the Devanagari
  intact. The tier-3 scan stored `name: null`, so it does not even record a
  guess it would not show.
- **All three tiers walked on 17 August**, x86_64 release build, from the seeded
  Ramesh account (`[sync] sent 32 events`, `[notify] scheduled 13 reminders`), no
  plot chip selected, so none of these got crop conditioning:
  - `1-maize-blight.jpg` → मक्का का झुलसा रोग, **92%**, tier 1, with the
    मैंकोज़ेब dose, the "spray before tomorrow's rain" timing, ₹380 and ₹3000.
  - `3-maize-healthy.jpg` → मक्का ठीक है, **100%**, and no treatment offered.
  - `6-maize-rust-expert.jpg` → हम पक्का नहीं बता सकते. **No diagnosis and no
    percentage on screen at all**, just Kisan Call Centre 1800-180-1551 and
    दूसरी फ़ोटो. That closes open item 4 from the previous handoff.
  - Screenshots kept in `dist/demo-shots/`.
- **The model inside the APK is the trained artifact, checked rather than
  assumed.** The app loads
  `ExponentAsset-233f91b66d881e5172228b4ff9e94df5.tflite`, and that hex string is
  the MD5 of `artifacts/crop_model.tflite`.
- **Reminders reach the OS.** `[notify] scheduled 13 reminders`, and
  `adb shell dumpsys alarm | grep in.hal.app` shows 13 matching `RTC_WAKEUP`
  alarms set for 9am. Android is holding them, not the JS.

Not yet walked: a notification actually appearing on screen (the emulator is a
Play Store image, so the clock cannot be moved past 9am without root),
`मेरा डेटा मिटाएँ` count,
airplane-mode sync, adding a खेत or पशु by hand.

---

## 5. Bugs found by running it, and the pattern

Every one was invisible to the bundler, the test suites and APK inspection.

### The one worth reading

**The sync had never worked, and everything looked fine.** The home card said
गौरी's FMD was 76 days overdue. The advisory, on the same screen, said no record
existed. `/timeline` explained it: the server held the profile and **zero
events**. Four causes, each hiding the next.

- `/sync` wrote a batch as one transaction, so one refused row rolled back the
  other forty and returned a bare 500.
- The schema refused a scan with no plot, which the app creates on purpose:
  photograph a leaf first, enter your fields later. So an ordinary scan poisoned
  the queue permanently.
- `App.js` swallowed the flush error in an empty `catch {}`.
- The server DB is wiped on every Render deploy and the phone never re-offered
  rows it had marked synced, so each deploy emptied the server for good.

Fixes: per-row inserts that name what was rejected and why, a CHECK that allows
parentless scans, a real error path into `api.lastError()`, and a `boot_id` in
`/health` that makes the phone re-send when the server it is talking to is one
it has not seen. **Ask the server, not the app.** `curl .../timeline/demo-ramesh`
and `curl .../vaccine-due/demo-ramesh` would have shown this on day one.

### The rest

1. **Model never loaded in release.** `require()` of a `.tflite` works in dev (Metro serves over http) and fails in release (compiled into `res/`, resolves to a bare resource name): `MalformedURLException: no protocol: assets_crop_model`. Fixed with `expo-asset`.
2. **`loadTensorflowModel` v3 needs a `delegates` argument** and exchanges ArrayBuffers, not typed arrays.
3. **Demo button did nothing, forever.** `resetDemo()` ran `DELETE FROM advisory WHERE is_demo = 1` against a table with no such column; the rejection was unhandled so the button was simply inert.
4. **Vaccines with no record showed as "365 days overdue"** and outranked a genuinely overdue FMD.
5. **Home did not scroll**, hiding the ledger section behind the mic pill.
6. **Home claimed "nothing urgent"** because the notification dialog stole focus and cancelled its query.
7. **"No internet" when the server answered in 0.5s.** The health check allowed 4s, less than a TLS handshake on a slow link.
8. **Advisory named the wrong disease** (रतुआ instead of झुलसा) and called a no-record vaccine "overdue", because it was sent `overdue=true` and `status="koi record nahi"` together.

9. **English mode was Hindi.** Three independent reasons: the Devanagari rule in
   the prompt was unconditional, the vaccine notes built for the prompt were
   Devanagari-only, and the app passed the literal string `'Hindi'` at its one
   call site. The tab bar also stayed Hindi, because it lives inside the
   navigator and React Navigation kept it mounted across the language change.
10. **Due vaccines were trimmed out of the prompt.** They are appended after the
    history and the line builder kept only the first twenty rows, so on a farm
    with a real timeline the model never saw a single one.
11. **The prompt named the words it was forbidding.** "na 'jaanch'" came back as
    **"एक बार जाanch लें"**, and an ISO due date came back as "2026-05-31 को".

12. **A dead SQLite handle blanked the home screen.** Installing over a running
    app closes the native database while the cached handle stays non-null, so
    every query failed and the screen rendered its headings with nothing under
    them and no error. Exactly what a farmer would see if a presenter sideloaded
    a new build during a demo. `open()` now proves the handle first.
13. **Marathi arrived half-built three separate ways**, each a different route to
    the same failure: vaccine names baked into event rows at write time, so the
    record never changed language; onboarding slides hardcoded with only `hi`
    and `en`; and `'7.63 करोड़'` as a bare string, which had been showing
    Devanagari in the middle of the **English** onboarding since English was
    added. Nobody caught that one because nobody ran English from screen one.

> The pattern in nearly all of them: **a `catch` that swallowed the reason, or a
> value that contradicted itself.** Every fix included making the failure
> visible. If something in this app appears to do nothing, assume an error is
> being eaten and go find it, rather than guessing at the cause.
>
> And a second pattern, from the model side: **a headline number that jumps is
> usually a test set that moved.** Field accuracy read 77% for an afternoon
> before the check that showed it was measuring memory of a single farm.

A related rule that keeps paying: **anything the model echoes must already be
in the target script.** Sending it `"FMD"`, `overdue: true` and romanized status
strings produced "गौरी का FMD टीका overdue है, एक बार jaanch lein" in an app
whose entire premise is speaking the farmer's language.

---

## 6. Open, roughly in order

Nothing here is code that is missing. It is all work only a person can do, plus
things deliberately left out.

1. **Four files need a human before a farmer sees them.** All carry
   `_validated_by: null` and print a warning on every `validate.py` run. A KVK,
   Krishi Vigyan Kendra, is the government's district farm-science centre. There
   is one in every district, the staff are qualified, and helping farmers is
   their job. Walk in with a printout.
   - `content/treatment_plans.json`: a KVK plant-protection officer. This is
     where the doses live. "मैंकोज़ेब 75% WP, 2.5 ग्राम प्रति लीटर" came out of
     research, not out of anyone who has sprayed a field.
   - `content/symptom_tree.json`: a district veterinarian.
   - `content/strings_mr.json`: a Marathi speaker, ideally at a Maharashtra KVK.
   - `mobile/src/domain.js` `UNITS`: the tehsil revenue office. **The quietest
     risk in the codebase.** A bigha is not a fixed area, it differs by state,
     and a wrong conversion makes every dose and every cost wrong by up to 3x
     with no error message anywhere. Everything looks normal and is wrong.
2. Watch a reminder actually appear. Scheduling and the OS alarms are verified;
   the last hop is not, and this emulator cannot test it.
3. `मेरा डेटा मिटाएँ` count, and adding a खेत/पशु by hand.
4. **Done, 17 August.** `6-maize-rust-expert.jpg` genuinely lands under 0.60 and
   the app shows no diagnosis. Re-run `ml/pick_demo_photos.py` after any retrain,
   because the confidences it prints are what the phone will show.
5. **Field accuracy is 46.9% on independent imagery**, 76.1% across all held-out
   field photographs. Say 46.9% out loud in the pitch; §5 explains why. The fix
   is Indian field photographs from many different phones and farms, not a
   bigger backbone: 11,000 new field images moved the same 116 PlantDoc holdout
   from 37.1% to 37.9%, which is nothing. `BAHI_BACKBONE=large` exists to test
   the capacity theory rather than assume it.
6. Not built: in-app community Q&A (`SPEC.md` E2, cut by the blueprint's scope
   lock), regional glossary rows (mechanism complete, zero rows, and the spec
   forbids shipping unvalidated vernacular).
7. Not integrated: **Bhashini**. Voice is the Android TTS engine. Do not claim
   Bhashini on a slide.
8. OTP is fake: any 4+ digit code proceeds.
9. Marathi covers the UI and the vaccine names. `symptom_tree.json` and
   `treatment_plans.json` stay Hindi and fall back through `L()`, on purpose: a
   wrong disease name confuses, a wrong dose kills. `strings_mr.json` records
   that under `_deliberate_gap`.

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
  is the product. Do not lower the threshold to make demos smoother. On
  PlantDoc it answers one photograph in twenty-six and is right on 92% of those:
  the model declining what it cannot read is the measurement, not a shortfall.
- **Every field source is split on its own, and never shuffled.** A donated
  dataset is one team, one camera, a few sessions. Shuffling puts near-identical
  frames of the same plant on both sides and the score becomes memory. Cotton
  read 97.9% that way; a second cotton source dropped it to 93.0%.
- **Provenance is checked before a dataset is used, not after.** The Kaggle
  wheat set turned out to hold an Alamy stock photo with the watermark on it and
  a journal figure of eleven leaves under one label; 4,116 of its images were
  dropped. A Kaggle set advertising "field visits with farmers" turned out to be
  100% byte-identical repackaging of data already on disk, and importing it as
  field imagery would have promoted 5,900 lab photographs into the field pool.
  Hash a new dataset against `data/raw` before believing its description.
- **Marathi before Punjabi, Bengali, Telugu or Tamil.** Marathi is Devanagari,
  so the font already in the APK renders it at no size cost. The others each
  need another script file, which is a real decision and not a typing exercise.
