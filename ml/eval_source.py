"""Accuracy broken down by where the photographs came from.

The headline field number moved from 44.9% to 77.1%, but the test set it is
measured on changed in the same breath, 361 images to 1,201. A bigger number on
a different test proves nothing on its own: the new sources could simply be
easier photographs. This answers the only question that matters, which is how
the model does on the images it was always judged against.

PlantDoc's test half is the fair comparison. It is web imagery, cluttered and
badly lit, it has never been in training in any run, and it is byte-identical
between the two runs.

    python ml/eval_source.py
"""
import collections
import os
import pathlib
import sys

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
sys.path.insert(0, str(pathlib.Path(__file__).parent))

import numpy as np                                    # noqa: E402
import tensorflow as tf                               # noqa: E402
from PIL import Image                                 # noqa: E402

import labels as L                                    # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
IMG = 224
IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp"}

# Sources evaluated separately. crop_hint mirrors what prepare.py passes, so a
# folder resolves here exactly as it does there.
SOURCES = [
    ("plantdoc test (never trained, both runs)", "plantdoc_files/test", None),
    ("ICAR India (70% was in training)", "icar", None),
    ("cotton Gazipur", "cotton_field", "cotton"),
    ("wheat field subset", "wheat_field", "wheat"),
]


def load(path):
    im = Image.open(path).convert("RGB").resize((IMG, IMG))
    return np.asarray(im, dtype="float32")


def main():
    model = tf.keras.models.load_model(ROOT / "artifacts" / "model.keras")
    order = [l.strip() for l in (ROOT / "artifacts" / "labels.txt").read_text().splitlines() if l.strip()]

    for title, rel, hint in SOURCES:
        root = RAW / rel
        if not root.exists():
            print(f"{title}: missing, skipped")
            continue

        xs, ys = [], []
        for d in sorted(x for x in root.iterdir() if x.is_dir()):
            lab = L.resolve(d.name, crop_hint=hint)
            if lab is None or lab not in order:
                continue
            for p in sorted(d.rglob("*")):
                if p.suffix.lower() in IMG_EXT:
                    try:
                        xs.append(load(p))
                        ys.append(order.index(lab))
                    except Exception:
                        pass
        if not xs:
            print(f"{title}: no resolvable images")
            continue

        pred = model.predict(np.stack(xs), verbose=0).argmax(1)
        y = np.array(ys)
        acc = float((pred == y).mean())
        per = collections.Counter()
        tot = collections.Counter()
        for t, p in zip(y, pred):
            crop = order[t].split("__")[0]
            tot[crop] += 1
            per[crop] += int(t == p)
        breakdown = "  ".join(f"{c} {per[c]/tot[c]:.0%}({tot[c]})" for c in sorted(tot))
        print(f"{title}: {acc:.1%} over {len(y)} images")
        print(f"    {breakdown}")


if __name__ == "__main__":
    main()
