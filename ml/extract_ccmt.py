"""Unpack the CCMT archive into data/raw/ccmt/<Crop>/<class>/.

Only the Raw Data subtree. The archive also ships a "CCMT Dataset-Augmented"
copy, four times larger and made of rotations and flips of these same photos;
train.py augments on the fly, so importing them would just be the same images
counted five times against the per-class cap.

Only Maize and Tomato are unpacked. Cashew and cassava are not crops this model
knows, and labels.py would drop every one of their folders anyway.

Written as a script rather than a one-line unzip because the last archive that
went through here (PlantDoc) died a third of the way in on a filename Windows
would not accept, and exited 0 because it was piped.
"""
import pathlib
import sys
import zipfile

RAW = pathlib.Path(__file__).resolve().parents[1] / "data" / "raw" / "ccmt"
ARCHIVE = RAW / "ccmt.zip"
PREFIX = "Dataset for Crop Pest and Disease Detection/Raw Data/CCMT Dataset/"
CROPS = {"maize", "tomato"}
IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp"}


def main():
    if not ARCHIVE.exists():
        sys.exit(f"missing {ARCHIVE}")

    written = skipped = failed = 0
    with zipfile.ZipFile(ARCHIVE) as z:
        for name in z.namelist():
            if not name.startswith(PREFIX) or name.endswith("/"):
                continue
            parts = name[len(PREFIX):].split("/")
            if len(parts) != 3:
                continue
            crop, cls, fname = parts
            if crop.lower() not in CROPS or pathlib.Path(fname).suffix.lower() not in IMG_EXT:
                skipped += 1
                continue

            out = RAW / crop / cls / fname
            if out.exists():
                continue
            out.parent.mkdir(parents=True, exist_ok=True)
            try:
                out.write_bytes(z.read(name))
                written += 1
            except OSError as e:                 # long path, bad character, full disk
                print(f"  FAILED {name}: {e}")
                failed += 1

    print(f"ccmt: wrote {written}, skipped {skipped} (other crops), failed {failed}")
    if failed:
        sys.exit(f"{failed} files did not extract, do not treat this as a clean run")
    if not written:
        sys.exit("nothing extracted, the archive layout must have changed")


if __name__ == "__main__":
    main()
