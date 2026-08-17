"""Turn the downloaded archives into folders that labels.py can read.

Run once after downloading, before prepare.py. Idempotent: files already on
disk are skipped, so an interrupted run just carries on.

This is a script and not three unzip commands because the last archive that
went through here (PlantDoc) died a third of the way in on a filename Windows
would not accept, and exited 0 because it was piped. Every failure is counted
and a non-zero count is a non-zero exit.

What each archive needs, and why it is not just "unzip everything":

  CCMT      also ships an augmented copy, four times larger, made of rotations
            and flips of the same photos. train.py augments on the fly, so
            importing those would be the same images counted five times
            against the per-class cap. Cashew and cassava are dropped here
            rather than by labels.py, to save unpacking 14k useless files.

  potato    one flat zip per class, named for the class. The folder name is
            what labels.py resolves, so the mapping lives in POTATO below and
            nowhere else.

  cotton    one Mendeley zip with a folder per class.
"""
import collections
import io
import pathlib
import sys
import zipfile

RAW = pathlib.Path(__file__).resolve().parents[1] / "data" / "raw"
IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp"}

CCMT_PREFIX = "Dataset for Crop Pest and Disease Detection/Raw Data/CCMT Dataset/"
CCMT_CROPS = {"maize", "tomato"}

# zip name -> folder name prepare.py will see under potato_field/.
# These become "healthy"/"early_blight"/"late_blight" under a flat:potato
# source, which labels.py resolves against the potato classes.
POTATO = {
    "HEALTHY_1": "healthy",
    "EARLYBLT_9": "early_blight",
    "LATEBLT_1": "late_blight",
}

# The Kaggle wheat set is a merge of a genuine field collection with images
# scraped off the web, and the two are mixed inside every class. Opening a
# handful found an Alamy stock photo complete with watermark, and a figure
# lifted from a journal showing eleven numbered detached leaves under a single
# "Brown Rust" label, several of which look healthy. Training on that teaches
# the watermark and the wrong label.
#
# The two kinds separate cleanly by resolution: the field photographs are phone
# originals, 700x945 and up, while the scraped ones are 256x256 thumbnails and
# small crops. Sampling sixty per class puts the phone-like share at 0% for
# yellow rust, 17-22% for mildew and brown rust, and 55-72% for septoria and
# healthy. Every image inspected above this threshold was a real field photo
# and every one below it was not, so the cut goes here.
#
# This is a judgement about provenance, not about the label, which is why it is
# allowed at all: getting it slightly wrong costs a few training images, where
# guessing a label would cost a farmer the wrong spray. It is still a heuristic
# and it is recorded as one in STATUS.md.
WHEAT_MIN_SIDE = 600
WHEAT_CLASSES = {"Brown Rust", "Yellow Rust", "Septoria", "Mildew", "Healthy"}

# The Kaggle "20k Multi-Class Crop Disease" set says it was gathered on field
# visits with farmers. For rice and maize that is not true: hashing it against
# what we already had found 100% of sampled Rice Blast, Tungro, Common Rust and
# Healthy Maize images byte-identical to the Sethy rice set and the maize set we
# downloaded weeks ago. Importing those as field imagery would have quietly
# promoted 5,900 lab photographs into the field pool, because dedupe ranks field
# above lab, and the honest field number would have risen for no reason at all.
#
# The cotton folders are the exception: 0% duplicates against 92,467 images we
# already hold. Cotton otherwise comes from a single institute's field in
# Gazipur, so a second, unrelated source is worth more here than the count
# suggests. It is also the only way to find out what cotton really scores.
#
# The mapping is explicit rather than resolved from folder names because one of
# those names is "Leaf Curl" with no crop attached. Opening it shows a cotton
# leaf, five-lobed and unmistakable, with the vein thickening of the leaf curl
# virus. Asserting the crop here is honest; letting a bare "leaf curl" fall
# through labels.py and land on tomato would not be.
COTTON_20K = {
    "bacterial_blight in Cotton": "bacterial_blight",
    "Bacterial Blight in cotton": "bacterial_blight",
    "Healthy cotton": "healthy",
    "Leaf Curl": "leaf_curl_virus",
}


def open_zip(path, stats):
    """None if the archive is not a readable zip yet. A half-downloaded file
    looks exactly like a corrupt one, and this script is meant to be re-run
    while the rest is still coming down, so say which it is and carry on."""
    try:
        return zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        print(f"  {path.name} is not a complete zip yet, skipping")
        stats["incomplete"] += 1
        return None


def write(z, name, out):
    """-> 1 if written, 0 if already there. Raises nothing; caller counts."""
    if out.exists():
        return 0
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(z.read(name))
    return 1


def do_ccmt(stats):
    src = RAW / "ccmt" / "ccmt.zip"
    if not src.exists():
        print("  ccmt.zip missing, skipping")
        return
    z = open_zip(src, stats)
    if z is None:
        return
    with z:
        for name in z.namelist():
            if not name.startswith(CCMT_PREFIX) or name.endswith("/"):
                continue
            parts = name[len(CCMT_PREFIX):].split("/")
            if len(parts) != 3:
                continue
            crop, cls, fname = parts
            if crop.lower() not in CCMT_CROPS or pathlib.Path(fname).suffix.lower() not in IMG_EXT:
                stats["skipped"] += 1
                continue
            try:
                stats["ccmt"] += write(z, name, RAW / "ccmt" / crop / cls / fname)
            except OSError as e:
                print(f"  FAILED {name}: {e}")
                stats["failed"] += 1


def do_flat(stats, folder, mapping, key):
    """Archives that are one flat directory of images per class."""
    for stem, cls in mapping.items():
        src = RAW / folder / f"{stem}.zip"
        if not src.exists():
            print(f"  {folder}/{stem}.zip missing, skipping")
            continue
        z = open_zip(src, stats)
        if z is None:
            continue
        with z:
            for name in z.namelist():
                if name.endswith("/") or pathlib.Path(name).suffix.lower() not in IMG_EXT:
                    continue
                out = RAW / folder / cls / pathlib.Path(name).name
                try:
                    stats[key] += write(z, name, out)
                except OSError as e:
                    print(f"  FAILED {name}: {e}")
                    stats["failed"] += 1


def do_cotton(stats):
    """A zip containing two zips. Only "Original Dataset.zip" is unpacked; the
    sibling "Augmented Dataset.zip" is rotations of the same 2,137 photos, and
    train.py augments on the fly."""
    src = RAW / "cotton_field" / "cotton.zip"
    if not src.exists():
        print("  cotton.zip missing, skipping")
        return
    outer = open_zip(src, stats)
    if outer is None:
        return
    with outer:
        inner = [n for n in outer.namelist() if n.endswith("Original Dataset.zip")]
        if not inner:
            sys.exit("cotton.zip no longer contains 'Original Dataset.zip'")
        with zipfile.ZipFile(io.BytesIO(outer.read(inner[0]))) as z:
            for name in z.namelist():
                p = pathlib.PurePosixPath(name)
                if name.endswith("/") or p.suffix.lower() not in IMG_EXT or len(p.parts) < 2:
                    continue
                try:
                    stats["cotton"] += write(z, name, RAW / "cotton_field" / p.parts[-2] / p.name)
                except OSError as e:
                    print(f"  FAILED {name}: {e}")
                    stats["failed"] += 1


def do_wheat(stats):
    """Only the five folders that map onto our wheat classes, and within those
    only the phone-resolution originals. See WHEAT_MIN_SIDE above for why."""
    from PIL import Image                      # only this one source needs it

    src = RAW / "wheat_kaggle" / "wheat-plant-diseases.zip"
    if not src.exists():
        print("  wheat-plant-diseases.zip missing, skipping")
        return
    z = open_zip(src, stats)
    if z is None:
        return
    with z:
        for name in z.namelist():
            p = pathlib.PurePosixPath(name)
            if not name.startswith("data/train/") or p.suffix.lower() not in IMG_EXT:
                continue
            cls = p.parts[2]
            if cls not in WHEAT_CLASSES:
                stats["skipped"] += 1
                continue
            blob = z.read(name)
            try:
                w, h = Image.open(io.BytesIO(blob)).size
            except Exception:
                stats["skipped"] += 1               # unreadable, not a failure to extract
                continue
            if min(w, h) < WHEAT_MIN_SIDE:
                stats["scraped"] += 1
                continue
            out = RAW / "wheat_field" / cls / p.name
            if out.exists():
                continue
            out.parent.mkdir(parents=True, exist_ok=True)
            try:
                out.write_bytes(blob)
                stats["wheat"] += 1
            except OSError as e:
                print(f"  FAILED {name}: {e}")
                stats["failed"] += 1
    print(f"  dropped {stats['scraped']} below {WHEAT_MIN_SIDE}px (scraped/thumbnails)")


def do_cotton20k(stats):
    """Only the cotton folders, and only under names that say which crop they
    are. See COTTON_20K for why the rest of this archive is left alone."""
    src = RAW / "multicrop20k" / "20k-multi-class-crop-disease-images.zip"
    if not src.exists():
        print("  20k-multi-class-crop-disease-images.zip missing, skipping")
        return
    z = open_zip(src, stats)
    if z is None:
        return
    with z:
        for name in z.namelist():
            p = pathlib.PurePosixPath(name)
            if name.endswith("/") or p.suffix.lower() not in IMG_EXT or len(p.parts) < 3:
                continue
            cls = COTTON_20K.get(p.parts[1])
            if cls is None:
                stats["skipped"] += 1
                continue
            # Train/ and Validation/ both land here; the split is ours to make.
            out = RAW / "cotton_20k" / cls / f"{p.parts[0].lower()}_{p.name}"
            try:
                stats["cotton20k"] += write(z, name, out)
            except OSError as e:
                print(f"  FAILED {name}: {e}")
                stats["failed"] += 1


def main():
    stats = collections.Counter()
    for label, fn in (("ccmt", do_ccmt),
                      ("potato", lambda s: do_flat(s, "potato_field", POTATO, "potato")),
                      ("cotton", do_cotton),
                      ("wheat", do_wheat),
                      ("cotton20k", do_cotton20k)):
        print(f"{label}:")
        fn(stats)
        print(f"  wrote {stats[label]}")

    print(f"\ntotal written {stats['ccmt'] + stats['potato'] + stats['cotton'] + stats['wheat'] + stats['cotton20k']}, "
          f"skipped {stats['skipped']}, failed {stats['failed']}")
    if stats["incomplete"]:
        print(f"{stats['incomplete']} archive(s) still downloading, re-run when they finish")
    if stats["failed"]:
        sys.exit(f"{stats['failed']} files did not extract, this was not a clean run")


if __name__ == "__main__":
    main()
