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
> 2 Dec 2025, which the 180-day interval turns into "76 days overdue" on demo
> day. You cannot backdate from the UI, which is exactly why the seed exists.

---

## Test photos

`dist/test-photos/` has five real field photographs pulled from the held-out
test set, so they are images the model has never been trained on:

| File | What it is | Expect |
|---|---|---|
| `maize__northern_leaf_blight.jpg` | maize blight | the strongest class, likely tier 1 |
| `maize__common_rust.jpg` | maize rust | usually tier 1 or 2 |
| `maize__healthy.jpg` | healthy maize | should say the crop looks fine |
| `tomato__late_blight.jpg` | tomato late blight | tomato is the weak crop, may refuse |
| `potato__early_blight.jpg` | potato early blight | often confused with late blight |

Copy them to the phone and use **फ़ोन से फ़ोटो चुनें** on the camera screen.

Pick the plot chip before scanning. With the plot selected the model only
considers that crop's classes, which measurably raises accuracy. Scanning a maize
photo with no plot selected is a harder problem and a fair demonstration of why
the record matters.

**Rehearse a refusal.** Tier 3 is the highest-scoring moment in the whole demo,
and it needs a photo the model genuinely cannot place. The tomato and potato
files are the likeliest to produce one. Find which of your photos lands under 60%
before you are on stage, and keep it.
