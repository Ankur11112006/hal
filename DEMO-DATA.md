# Demo data to type in by hand

Two ways to get a populated app.

**Fast:** on the login screen press **पहले नमूना देखें**. That seeds Ramesh's
account with eight months of history in about a second, and it is the account
the pitch is built around. Settings has **नमूना रिकॉर्ड दोबारा भरें** to reset it
between runs, so judges tapping around cannot spoil the next demo.

**By hand:** if you want to fill your own account from the phone, use the values
below. They are chosen so the cross-domain advisory line fires, which is the
only reason the demo works.

---

## Profile

| Field | Value |
|---|---|
| नाम | रमेश वर्मा |
| गाँव | बाराबंकी |
| पिनकोड | 225001 |
| राज्य | UP |
| आप क्या करते हैं | दोनों |

The state matters: `UP` is what makes a bigha convert to 0.2529 hectares. Enter
`MH` and the same "2 bigha" is a different area, which is the point of the whole
unit layer.

---

## Fields

**Field 1**

| Field | Value |
|---|---|
| खेत का नाम | नदी वाला |
| खेत कितना बड़ा है | 2 |
| किस नाप में | bigha |
| कौन सी फ़सल बोई है | मक्का |

Press **खेत की जगह दर्ज करें** so the weather and the "spray before the rain"
timing have coordinates to work with. Without it the advisory still answers, but
the timing line goes generic.

**Field 2**

| Field | Value |
|---|---|
| खेत का नाम | घर वाला |
| खेत कितना बड़ा है | 1.2 |
| किस नाप में | bigha |
| कौन सी फ़सल बोई है | गेहूँ |

---

## Animals

| नाम | कौन सा पशु | नस्ल | उम्र | नर/मादा |
|---|---|---|---|---|
| गौरी | गाय | साहीवाल | 5 | मादा |
| काली | गाय | संकर | 7 | मादा |
| मोती | भैंस | मुर्रा | 6 | मादा |

Adding गौरी alone should show a toast saying several entries were added on their
own. That is the Day Zero engine writing her whole vaccination and breeding
calendar. If the toast says zero, something is wrong and the vaccine screens will
be empty.

---

## What to add so the demo line fires

The advisory's closing answer needs two facts to exist. Add these from
**खेत → जोड़ें** on Field 1 (नदी वाला):

| Entry | Value | Why it matters |
|---|---|---|
| छिड़काव | क्या: मैंकोज़ेब, कितना: 380 | proves last year's blight was treated |
| कटाई | 6.8 quintals | closes last season |

And on गौरी, open her page and press **लगवा दिया** on the FMD row **once**. That
records a dose today, which is the opposite of what the demo needs, so for a hand
built account it is better to leave FMD untouched: an animal with no record shows
as needing a check, and the advisory will mention it.

> The seeded Ramesh account handles this properly by backdating the FMD dose to
> 2 Dec 2025, which the 180-day interval turns into an overdue count that grows
> by one every day: it read 76 days when the seed was written and 78 on 17
> August. Check the screen before quoting a number on a slide. You cannot
> backdate from the UI, which is exactly why the seed exists.

---

## Test photos

`dist/test-photos/` has six real field photographs, all from
`data/prepared/field_test`, so nothing here was trained on or calibrated on.
`ml/pick_demo_photos.py` rebuilds the folder and chooses them on purpose to span
all three tiers, because all three are the product. Run it after any retrain: the
confidences it prints are what the phone will show.

| File | What it is | Tier |
|---|---|---|
| `1-maize-blight.jpg` | maize northern leaf blight | 1 |
| `2-wheat-rust.jpg` | wheat leaf rust | 1 |
| `3-maize-healthy.jpg` | healthy maize | 1 |
| `4-tomato-blight.jpg` | tomato late blight | 1 |
| `5-maize-rust-verify.jpg` | maize common rust | 2, goes to a KVK expert |
| `6-maize-rust-expert.jpg` | maize common rust | 3, refuses outright |

Copy them to the phone and use **फ़ोन से फ़ोटो चुनें** on the camera screen.

### The three to show, verified on the emulator on 17 August

| Show | File | What appears |
|---|---|---|
| healthy | `3-maize-healthy.jpg` | मक्का ठीक है, **100%**, "दवा की ज़रूरत नहीं है" and no treatment card |
| diseased | `1-maize-blight.jpg` | मक्का का झुलसा रोग, **92%**, मैंकोज़ेब 75% WP, 2.5 g per litre, spray before tomorrow's rain, ₹380 against ₹3000 saved |
| refusal | `6-maize-rust-expert.jpg` | हम पक्का नहीं बता सकते. **No disease and no percentage on screen**, only किसान कॉल सेंटर 1800-180-1551 and दूसरी फ़ोटो |

Those three numbers came out of the app with **no plot chip selected**. Picking
the plot chip first masks the softmax to that crop's classes and raises
confidence, which is worth showing on the blight photo as a separate beat. Do not
pick it before the refusal: conditioning can lift that photo out of tier 3 and
you lose the best moment in the demo.

> **Driving the demo over `adb`?** Every `screencap` you leave under `/sdcard/`
> becomes a new tile in the system photo picker and shifts the whole grid, so a
> tap that hit the right photo a minute ago now hits its neighbour. Write
> screenshots to `/data/local/tmp/` instead, which MediaStore does not scan.
