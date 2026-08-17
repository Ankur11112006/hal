"""Rebuild dist/test-photos from held-out field images, one per tier.

The old set was five PlantDoc photographs, and PlantDoc is the hardest source
the model sees: it answers on 3.9% of those against 60-72% on ordinary field
photographs. So every demo photo landed on "we cannot be sure", which is the
model behaving correctly on an unrepresentative sample and looks, on stage,
like an app that never works.

Every image here still comes out of data/prepared/field_test. Nothing was
trained on, nothing was calibrated on. What changed is that the set now spans
all three tiers on purpose, because all three are the product:

  tier 1  a confident, correct diagnosis with a dose
  tier 2  a diagnosis routed to a KVK expert for confirmation, no dose shown
  tier 3  no diagnosis at all, and a phone number

Run after any retrain. The confidences printed here are what the phone will
show, so if they move, the demo script moves with them.
"""
import json
import os
import pathlib
import shutil
import sys

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

import numpy as np                                    # noqa: E402
import tensorflow as tf                               # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIELD = ROOT / "data" / "prepared" / "field_test"
OUT = ROOT / "dist" / "test-photos"
AUTO, VERIFY = 0.85, 0.60

# What to show, in the order to show it. The demo farm grows maize and wheat,
# so the headline photographs are maize and wheat.
WANT = [
    ("1-maize-blight", "maize__northern_leaf_blight", "auto"),
    ("2-wheat-rust", "wheat__leaf_rust", "auto"),
    ("3-maize-healthy", "maize__healthy", "auto"),
    ("4-tomato-blight", "tomato__late_blight", "auto"),
    ("5-maize-rust-verify", "maize__common_rust", "verify"),
    ("6-maize-rust-expert", "maize__common_rust", "expert"),
]


def tier(conf):
    return "auto" if conf > AUTO else "verify" if conf > VERIFY else "expert"


def main():
    order = [l.strip() for l in (ROOT / "artifacts" / "labels.txt").read_text().splitlines() if l.strip()]
    T = json.loads((ROOT / "artifacts" / "metrics.json").read_text())["temperature"]
    model = tf.keras.models.load_model(ROOT / "artifacts" / "model.keras")

    ds = tf.keras.utils.image_dataset_from_directory(
        FIELD, image_size=(224, 224), batch_size=64, shuffle=False, label_mode="int")
    names = ds.class_names
    logits = np.concatenate([model.predict(x, verbose=0) for x, _ in ds])
    y = np.array([order.index(names[i]) for i in
                  np.concatenate([b.numpy() for _, b in ds])])
    prob = tf.nn.softmax(logits / T).numpy()
    pred, conf = prob.argmax(1), prob.max(1)
    files = ds.file_paths

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    print(f"temperature {T:.2f}\n")
    print(f"{'file':26} {'truth':28} {'prediction':28} {'conf':>6}  tier")
    picked = 0
    for stem, want_label, want_tier in WANT:
        # Correct predictions only, in the requested tier, most typical first:
        # for tier 1 the most confident, for the others the middle of the band,
        # so the demo does not sit on a boundary that a retrain will move.
        cands = [i for i in range(len(y))
                 if order[y[i]] == want_label and pred[i] == y[i] and tier(conf[i]) == want_tier]
        if not cands:
            print(f"  MISSING {stem}: no correct {want_label} in tier {want_tier}")
            continue
        i = (max(cands, key=lambda j: conf[j]) if want_tier == "auto"
             else sorted(cands, key=lambda j: conf[j])[len(cands) // 2])
        dst = OUT / f"{stem}.jpg"
        shutil.copy(files[i], dst)
        picked += 1
        print(f"{dst.name:26} {order[y[i]]:28} {order[pred[i]]:28} {conf[i]:>5.0%}  {tier(conf[i])}")

    if picked < len(WANT):
        sys.exit(f"only {picked} of {len(WANT)} photos found; the demo script needs all of them")
    print(f"\n{picked} photos -> {OUT}")


if __name__ == "__main__":
    main()
