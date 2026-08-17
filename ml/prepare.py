"""Merge five downloaded datasets into one labelled, deduped, resized corpus.

  data/raw/<source>/...        ->  data/prepared/{train,val,field_test}/<label>/

Three rules that matter more than the code:

1. NOTHING IS GUESSED. A source folder maps to a canonical label only via an
   explicit entry in labels.ALIASES. Unmapped folders are dropped and printed,
   so a silent mislabel is impossible.
2. PlantDoc's TEST half is the field set and never enters training; its TRAIN
   half does. The field number is the only honest one, because PlantDoc is the
   only in-the-wild source; reporting the PlantVillage split instead is the
   inflated figure everyone in the room already knows about (SPEC.md 4.1 step
   4). Holding out ALL of PlantDoc was tried first and measured 22.5% field
   accuracy: with lab imagery alone the model learns "plain background means
   classify confidently", exactly the trap SPEC.md 4.1 step 2 names.
3. Deduped by content hash across ALL sources before splitting. These datasets
   mirror each other; without this, the same JPEG lands in train and in test
   and the reported accuracy is a lie.
"""
import collections
import hashlib
import pathlib
import random
import shutil
import sys

from PIL import Image

import labels as L

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "prepared"

SIZE = 256              # stored size; training resizes to 224 from this
MIN_PER_CLASS = 40      # below this a class is too thin to keep
MAX_PER_CLASS = 1400    # cap so CPU training stays in the hour, not the day
VAL_FRACTION = 0.15
SEED = 1337

# Field images are ~4% of the corpus, so plain training lets the lab images
# drown them out. Repeating each field image this many times in the train split
# is the cheapest way to make the model actually pay attention to them.
# Kept LOW on purpose: at high multiples the model memorises the same few
# hundred photos and becomes overconfident on new ones, which raises exactly
# the confident-but-wrong rate this whole design exists to suppress.
FIELD_OVERSAMPLE = 3

# Ceiling on field images per class, applied before the train/cal/test split.
# One donated dataset can be enormous: the Tanzanian potato set alone is 58,709
# photographs against roughly 850 for all of ICAR's Indian rice and maize. Left
# uncapped it would supply most of the field test set and "field accuracy"
# would quietly become "potato accuracy". 900 is well above what any class had
# before and keeps the headline number a fair average across crops.
MAX_FIELD_PER_CLASS = 900

# How the field pool is divided. `cal` never trains and never appears in the
# reported number: it exists only to fit the temperature. Calibrating on the
# lab-heavy val split is what left the model overconfident on real photos.
FIELD_SPLIT = {"train": 0.70, "cal": 0.15, "test": 0.15}

# (source dir, layout, kind)
#   "lab"           studio imagery: train/val only
#   "field"         in-the-wild: split across train / cal / test by FIELD_SPLIT
#   "field_holdout" in-the-wild, never trains and never calibrates: the number
#   flat         root/<ClassFolder>/*
#   flat:<crop>  same, but the source is single-crop so bare folder names
#                like "Healthy" or "Blight" resolve against that crop
#   crop_nested  root/<Crop>/<Crop___Disease>/*
#   split_dirs   root/<train|test|val>/<ClassFolder>/*
#   all:<label>  every image under root is that one label
SOURCES = [
    ("mendeley/15 Crop 45 Disease and Healthy Leaf dataset", "flat", "lab"),
    ("plantdisease/PlantVillage", "flat", "lab"),
    ("crops-disease-dataset/Final_Dataset", "crop_nested", "lab"),
    ("rice-leaf-disease-image", "flat", "lab"),
    ("maize/data", "flat:maize", "lab"),
    # Single-class Roboflow export: no per-image labels ship with it, and every
    # image is armyworm-affected maize. Treating the whole folder as one class
    # is an assumption; if it turns out to contain healthy plants too, the
    # confusion matrix against maize__healthy is where it will show up.
    ("fall-armyworm", "all:maize__fall_armyworm", "lab"),
    # ICAR / DARE via AIKosh: real Indian field photographs, high resolution.
    # Only ~50 per class, but it is the only source shot in Indian fields, so
    # it carries far more weight per image than anything else here.
    ("icar", "flat", "field"),
    # PlantDoc's own train/test split. Its train half is the ONLY in-the-wild
    # imagery in the training mix, and without it the model learns "plain
    # background means classify confidently" and collapses on real photos:
    # measured at 22.5% field accuracy when PlantDoc was held out entirely.
    # Its test half stays held out, so the reported field number is still honest.
    ("plantdoc_files/train", "flat", "field"),
    ("plantdoc_files/test", "flat", "field_holdout"),
    # Tomato-Village (Gehlot et al., Multimedia Systems 2023): tomato shot in
    # farmers' fields in Jodhpur and Jaipur. Tomato was the worst crop in the
    # model by a wide margin, 29.8% field accuracy, for the simple reason that
    # every tomato image we had came from PlantVillage's lab bench. Three of its
    # eight folders map onto our taxonomy; the rest are refused in labels.py
    # rather than guessed at.
    ("tomato_village/Variant-a(Multiclass Classification)", "split_dirs:tomato", "field"),
    # CCMT (Mendeley, CC BY 4.0): smallholder farms in Ghana, photographed
    # against real backgrounds rather than a bench. Not India, but the domain
    # gap this model suffers from is lab-versus-field, not India-versus-
    # elsewhere, and these are field. Five of its twenty-three folders map;
    # cashew and cassava are not crops we know and seven other folders are
    # refused by name in labels.py, "leaf blight" above all, which is ambiguous
    # under both maize and tomato between two classes we do model.
    # Its "leaf curl" maps to yellow leaf curl on the existing alias: the
    # begomoviruses behind it in West Africa and India differ, but the symptom,
    # the vector and the advice the app gives are the same.
    # ml/extract_ccmt.py unpacks only Raw Data. The archive's augmented copy is
    # rotations of these same photos and train.py augments on the fly.
    ("ccmt", "crop_nested", "field"),
    # SAR-CLD-2024 (Mendeley, CC BY 4.0): the National Cotton Research
    # Institute's field in Gazipur, shot on a Redmi Note 11s between October
    # 2023 and January 2024. Cotton had no field images at all, in any of its
    # three classes, and this has exactly those three. Four other folders are
    # refused, "Leaf Redding" above all: 578 images of what is usually a
    # potassium shortage, which mapped to bacterial blight would have the app
    # answering a feeding problem with a bactericide.
    ("cotton_field", "flat:cotton", "field"),
    # Tanzanian smallholder farms, smartphone photographs validated by plant
    # pathologists (Zenodo 17553016, CC BY 4.0). Not India, but the gap that
    # hurts this model is lab-versus-field and these are field. One flat zip per
    # class; ml/extract.py holds the zip-name-to-class mapping.
    ("potato_field", "flat:potato", "field"),
    # Wheat, and only the part of it that is real. The Kaggle set it comes from
    # mixes a genuine field collection with images scraped off the web, inside
    # every class; ml/extract.py keeps the phone-resolution originals and drops
    # 4,116 thumbnails, an Alamy stock photo and a journal figure among them.
    #
    # This matters more than the count suggests. wheat__septoria and
    # wheat__powdery_mildew had fifty lab images each, the thinnest classes in
    # the model, and now have 514 and 176 photographs taken in a field.
    # wheat__stripe_rust gets nothing: every image in that folder was scraped.
    ("wheat_field", "flat:wheat", "field"),
]

IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp"}


def images_in(d: pathlib.Path):
    for p in d.rglob("*"):
        if p.is_file() and p.suffix.lower() in IMG_EXT:
            yield p


def collect() -> tuple[list, collections.Counter]:
    """-> [(src_path, label, kind)], counter of dropped folders"""
    found, dropped = [], collections.Counter()
    for rel, layout, kind in SOURCES:
        root = RAW / rel
        if not root.exists():
            print(f"  SKIP missing source {rel}")
            continue
        n0 = len(found)

        if layout.startswith("all:"):
            lab = layout.split(":", 1)[1]
            found += [(p, lab, kind) for p in images_in(root)]

        elif layout == "flat" or layout.startswith("flat:"):
            hint = layout.split(":", 1)[1] if ":" in layout else None
            for d in sorted(x for x in root.iterdir() if x.is_dir()):
                lab = L.resolve(d.name, crop_hint=hint)
                if lab:
                    found += [(p, lab, kind) for p in images_in(d)]
                else:
                    dropped[f"{rel} :: {d.name}"] += sum(1 for _ in images_in(d))

        elif layout == "crop_nested":
            for crop in sorted(x for x in root.iterdir() if x.is_dir()):
                for d in sorted(x for x in crop.iterdir() if x.is_dir()):
                    lab = L.resolve(d.name, crop_hint=crop.name)
                    if lab:
                        found += [(p, lab, kind) for p in images_in(d)]
                    else:
                        dropped[f"{rel} :: {crop.name}/{d.name}"] += sum(1 for _ in images_in(d))

        elif layout == "split_dirs" or layout.startswith("split_dirs:"):
            # The hint is not optional for single-crop sources. Tomato-Village
            # names its folders "Late_blight" and "Healthy" with no crop in the
            # name, and potato has a late blight too, so resolving those without
            # a hint would file real tomato photographs under potato.
            hint = layout.split(":", 1)[1] if ":" in layout else None
            for split in sorted(x for x in root.iterdir() if x.is_dir()):
                for d in sorted(x for x in split.iterdir() if x.is_dir()):
                    lab = L.resolve(d.name, crop_hint=hint)
                    if lab:
                        found += [(p, lab, kind) for p in images_in(d)]
                    else:
                        dropped[f"{rel} :: {d.name}"] += sum(1 for _ in images_in(d))
        else:
            sys.exit(f"unknown layout {layout}")

        print(f"  {rel}: +{len(found)-n0} images")
    return found, dropped


def dedupe(items):
    """Content hash across every source. Mirrors are common and leakage is fatal.

    Field images are hashed FIRST so that when the same JPEG exists in both a
    training source and the field set, the field copy wins and the training
    copy is dropped. This is not theoretical: the corn-or-maize dataset bundles
    PlantDoc's corn photos, so without this ordering every PlantDoc maize image
    ends up in training and the "held-out field accuracy" is measured on images
    the model was fitted on.
    """
    rank = {"field_holdout": 0, "field": 1, "lab": 2}
    items = sorted(items, key=lambda t: rank.get(t[2], 3))
    seen, out, dupes = set(), [], 0
    for path, lab, kind in items:
        try:
            h = hashlib.md5(path.read_bytes()).digest()
        except OSError:
            continue
        if h in seen:
            dupes += 1
            continue
        seen.add(h)
        out.append((path, lab, kind))
    return out, dupes


def save(src: pathlib.Path, dst: pathlib.Path) -> bool:
    try:
        with Image.open(src) as im:
            im.convert("RGB").resize((SIZE, SIZE), Image.BILINEAR).save(
                dst, "JPEG", quality=88, optimize=False)
        return True
    except Exception:
        return False


def main():
    random.seed(SEED)
    if OUT.exists():
        shutil.rmtree(OUT)

    print("scanning sources...")
    items, dropped = collect()
    print(f"\n{len(items)} images before dedupe")
    items, dupes = dedupe(items)
    print(f"{len(items)} after dedupe ({dupes} duplicates removed)")

    by_label = collections.defaultdict(lambda: {"lab": [], "field": [], "holdout": []})
    for path, lab, kind in items:
        bucket = {"lab": "lab", "field_holdout": "holdout"}.get(kind, "field")
        by_label[lab][bucket].append(path)

    print(f"\n{'label':34} {'lab':>6} {'field':>6} {'test':>5}  status")
    kept, plan = [], []
    for lab in L.LABELS:
        b = by_label[lab]
        # Split the field pool three ways FIRST, so a calibration or test image
        # can never leak into training no matter what happens below.
        field = b["field"][:]
        random.shuffle(field)
        field = field[:MAX_FIELD_PER_CLASS]
        n_tr = int(len(field) * FIELD_SPLIT["train"])
        n_cal = int(len(field) * FIELD_SPLIT["cal"])
        f_train, f_cal, f_test = field[:n_tr], field[n_tr:n_tr + n_cal], field[n_tr + n_cal:]
        n_test = len(f_test) + len(b["holdout"])

        pool = b["lab"] + f_train
        if len(pool) < MIN_PER_CLASS:
            print(f"{lab:34} {len(b['lab']):>6} {len(field):>6} {n_test:>5}  "
                  f"DROPPED (<{MIN_PER_CLASS})")
            continue

        kept.append(lab)
        status = "ok"
        # Field images survive the cap, lab images fill what is left. Capping a
        # shuffled mixture threw away the scarce in-the-wild photographs by pure
        # chance, and they are the only reason the model works on a real one.
        # The pool is shuffled again afterwards so the val split stays random:
        # taking val off the front of a field-first list would put every field
        # image in validation and leave training with nothing but lab benches.
        random.shuffle(f_train)
        random.shuffle(b["lab"])
        pool = (f_train + b["lab"])[:MAX_PER_CLASS]
        random.shuffle(pool)
        if len(pool) == MAX_PER_CLASS:
            status = f"capped {MAX_PER_CLASS}"
        cut = max(1, int(len(pool) * VAL_FRACTION))
        plan += [("val", lab, p) for p in pool[:cut]]
        plan += [("train", lab, p) for p in pool[cut:]]

        # Oversample only the field images that actually landed in train.
        in_train = set(pool[cut:]) & set(f_train)
        for _ in range(FIELD_OVERSAMPLE - 1):
            plan += [("train", lab, p) for p in in_train]
        if in_train:
            status += f" | {len(in_train)} field x{FIELD_OVERSAMPLE}"

        plan += [("field_cal", lab, p) for p in f_cal]
        plan += [("field_test", lab, p) for p in f_test + b["holdout"]]
        if not n_test:
            status += " | NO field test"
        print(f"{lab:34} {len(b['lab']):>6} {len(field):>6} {n_test:>5}  {status}")

    if dropped:
        print(f"\nunmapped source folders (dropped, never guessed):")
        for k, n in dropped.most_common(40):
            print(f"  {n:>6}  {k}")

    print(f"\nwriting {len(plan)} files to {OUT} ...")
    written, failed = collections.Counter(), 0
    for split, lab, src in plan:
        d = OUT / split / lab
        d.mkdir(parents=True, exist_ok=True)
        if save(src, d / f"{written[(split, lab)]:05d}.jpg"):
            written[(split, lab)] += 1
        else:
            failed += 1

    tot = collections.Counter()
    for (split, _), n in written.items():
        tot[split] += n
    print(f"\ndone. {dict(tot)}  ({failed} unreadable files skipped)")
    print(f"{len(kept)} classes kept of {len(L.LABELS)}")

    missing_field = [l for l in kept if tot and not (OUT / "field_test" / l).exists()]
    if missing_field:
        print(f"\nNOTE: no field-test images for {len(missing_field)} classes: "
              f"{', '.join(missing_field)}")
        print("      field accuracy will be reported over the remaining classes only.")

    (OUT / "kept_labels.txt").write_text("\n".join(kept))


if __name__ == "__main__":
    main()
