"""Pull PlantDoc out of git into plain files Windows can hold.

Two things break a naive `git clone` here:
  1. filenames contain '?', which Windows cannot create at all, so the clone
     downloads every object and then fails the checkout;
  2. some filenames are 200+ characters, and with the repo path prefix they
     exceed MAX_PATH, so writing them fails one by one.

So: read blobs by SHA (never by path, which avoids all quoting issues), rename
illegal characters, and truncate long names with a hash so they stay unique.
A file that still cannot be written is skipped and counted, never fatal - an
aborted extraction silently starves the field test set, which is exactly how
the first run ended up with 333 of ~2,600 images.
"""
import hashlib
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent / "data" / "raw" / "plantdoc"
OUT = REPO.parent / "plantdoc_files"
BAD = re.compile(r'[<>:"|?*\\]')
MAX_STEM = 60


def safe(name: str) -> str:
    stem, dot, ext = name.rpartition(".")
    stem = BAD.sub("_", stem or name)
    ext = (dot + ext).lower() if dot else ""
    if len(stem) > MAX_STEM:
        stem = stem[:MAX_STEM] + "_" + hashlib.md5(name.encode()).hexdigest()[:8]
    return stem + ext


def main():
    if not (REPO / ".git").exists():
        sys.exit(f"no git repo at {REPO}")
    listing = subprocess.run(["git", "-C", str(REPO), "ls-tree", "-r", "HEAD"],
                             capture_output=True, text=True, check=True).stdout.splitlines()
    ok = skipped = 0
    for line in listing:
        meta, _, path = line.partition("\t")
        parts = meta.split()
        if len(parts) < 3:
            continue
        sha = parts[2]
        if not path.lower().endswith((".jpg", ".jpeg", ".png")):
            continue
        segs = path.split("/")
        dest = OUT.joinpath(*[BAD.sub("_", s) for s in segs[:-1]], safe(segs[-1]))
        if dest.exists():
            ok += 1
            continue
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            blob = subprocess.run(["git", "-C", str(REPO), "cat-file", "blob", sha],
                                  capture_output=True, check=True).stdout
            dest.write_bytes(blob)
            ok += 1
        except Exception as e:
            skipped += 1
            if skipped <= 3:
                print(f"  skip {segs[-1][:50]}...: {type(e).__name__}")
        if ok % 500 == 0 and ok:
            print(f"  {ok} images", flush=True)

    for split in ("train", "test"):
        d = OUT / split
        n = len(list(d.rglob("*"))) if d.exists() else 0
        print(f"  {split}: {len(list(d.iterdir())) if d.exists() else 0} classes, {n} files")
    print(f"PLANTDOC EXTRACTED {ok} images, {skipped} skipped -> {OUT}")


if __name__ == "__main__":
    main()
