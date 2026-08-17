"""Train the BAHI crop-disease classifier and export an INT8 TFLite model.

Reads data/prepared/{train,val,field_test}/<label>/*.jpg  (see prepare.py)
Writes  artifacts/crop_model.tflite, labels.txt, metrics.json, confusion.csv

Two phases, because this trains on CPU (native-Windows TF has no GPU):
  1. frozen backbone, train the head       - cheap, gets most of the accuracy
  2. unfreeze the top blocks, low LR       - buys the field-image robustness

Then temperature scaling, which is NOT optional: the whole three-tier
escalation in SPEC.md A1 is meaningless if "85% confident" is not actually
right 85% of the time.
"""
import json, os, pathlib, sys, time

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
import numpy as np
import tensorflow as tf

import labels as L

ROOT = pathlib.Path(__file__).resolve().parent.parent
PREPARED = ROOT / "data" / "prepared"
OUT = ROOT / "artifacts"
OUT.mkdir(exist_ok=True)

# The taxonomy in labels.py is what we WANT; kept_labels.txt is what prepare.py
# could actually build, after dropping classes that fell below MIN_PER_CLASS.
# Training against the taxonomy instead of the reality is a hard crash the
# moment any class is thin, so the model's class list comes from prepare.
_kept = PREPARED / "kept_labels.txt"
LABELS = (_kept.read_text().split() if _kept.exists() else L.LABELS)
CROP_MASK = {c: [LABELS.index(f"{c}__{d}") for d in ds if f"{c}__{d}" in LABELS]
             for c, ds in L.CROPS.items()}
CROP_MASK = {c: idx for c, idx in CROP_MASK.items() if idx}

IMG = int(os.environ.get("BAHI_IMG", 224))
BATCH = int(os.environ.get("BAHI_BATCH", 32))
EPOCHS_HEAD = int(os.environ.get("BAHI_EPOCHS_HEAD", 6))
EPOCHS_FT = int(os.environ.get("BAHI_EPOCHS_FT", 4))
SEED = 1337


def load(split, shuffle, class_names=LABELS):
    return tf.keras.utils.image_dataset_from_directory(
        PREPARED / split,
        labels="inferred",
        label_mode="int",
        class_names=class_names,     # fixed order, so index == label id everywhere
        image_size=(IMG, IMG),
        batch_size=BATCH,
        shuffle=shuffle,
        seed=SEED,
    )


def load_subset(split):
    """The field splits cover only the classes the field sources happen to
    have, so their directory listing is a SUBSET of LABELS. Let Keras infer its
    own class order, then remap those local indices into the global label space
    before anything is compared against a model prediction.
    """
    d = tf.keras.utils.image_dataset_from_directory(
        PREPARED / split, labels="inferred", label_mode="int",
        image_size=(IMG, IMG), batch_size=BATCH, shuffle=False)
    present = list(d.class_names)
    remap = np.array([LABELS.index(c) for c in present])
    return d, present, remap


def has_split(split):
    d = PREPARED / split
    return d.exists() and any(d.iterdir())


# Augmentation mimics the real input: a shaky photo taken at noon on a cheap
# phone, not a lab scan on a white background. SPEC.md 4.1 step 3.
#
# The bottom four layers exist for one measured reason. 93.9% on validation
# against 44.9% on field photographs is not a capacity problem, it is the model
# having learned that a plain background means it is safe to be confident:
# nearly every training image is a detached leaf on a lab bench. These attack
# that shortcut directly.
#
#   RandomErasing   punches out a patch, so no single region can carry the call
#   RandomGrayscale drops colour entirely 15% of the time, forcing the lesion's
#                   shape and texture to matter rather than the global palette
#   Saturation/Hue  midday sun in a field is nothing like studio lighting
#
# Everything here is a stock Keras 3 layer. Do not hand-roll these.
AUG = tf.keras.Sequential([
    tf.keras.layers.RandomFlip("horizontal"),
    tf.keras.layers.RandomRotation(0.15),
    tf.keras.layers.RandomZoom(0.2),
    tf.keras.layers.RandomTranslation(0.1, 0.1),
    tf.keras.layers.RandomBrightness(0.25, value_range=(0, 255)),
    tf.keras.layers.RandomContrast(0.25),
    tf.keras.layers.RandomSaturation(factor=(0.4, 0.6), value_range=(0, 255)),
    tf.keras.layers.RandomHue(factor=0.06, value_range=(0, 255)),
    tf.keras.layers.RandomGrayscale(factor=0.15),
    tf.keras.layers.RandomErasing(factor=0.35, scale=(0.02, 0.2), value_range=(0, 255)),
], name="augment")


def build():
    base = tf.keras.applications.MobileNetV3Small(
        input_shape=(IMG, IMG, 3),
        include_top=False,
        weights="imagenet",
        include_preprocessing=True,   # model takes raw [0,255]
    )
    base.trainable = False
    gap = tf.keras.layers.GlobalAveragePooling2D(name="gap")
    dense = tf.keras.layers.Dense(len(LABELS), name="logits")     # logits, not softmax

    inp = tf.keras.Input((IMG, IMG, 3))
    x = AUG(inp)
    x = base(x, training=False)
    x = gap(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    out = dense(x)
    return tf.keras.Model(inp, out), base, gap, dense


def inference_twin(base, gap, dense):
    """A second Model over the SAME layer objects, so the same weights, without
    the augmentation block.

    This is not tidiness. model.export() bakes the augmentation layers into the
    serving signature, and TFLite cannot convert their ops:
      'tf.ImageProjectiveTransformV3' op is neither a custom op nor a flex op
      'tf.StatelessRandomUniformV2'   op is neither a custom op nor a flex op
    Augmentation is a training-time concern and has no business in the graph
    that ships inside the APK. Dropout is dropped for the same reason.
    """
    # batch_size=1 pins the input shape. A dynamic batch dim converts fine but
    # then XNNPACK refuses to prepare the graph at runtime, and the phone only
    # ever classifies one photo at a time anyway.
    i = tf.keras.Input(shape=(IMG, IMG, 3), batch_size=1)
    return tf.keras.Model(i, dense(gap(base(i, training=False))))


def class_weights() -> dict[int, float]:
    """The corpus is 28x imbalanced (wheat septoria has 50 images, tomato
    septoria 1400). Without this the thin classes are never predicted at all.
    Capped, because an uncapped weight of ~20 makes training unstable and
    trades a silent failure for a loud one.
    # ponytail: inverse-frequency with a cap. Focal loss if this is not enough.
    """
    counts = [len(list((PREPARED / "train" / l).glob("*.jpg"))) for l in LABELS]
    n, k = sum(counts), sum(1 for c in counts if c)
    return {i: min(n / (k * c), 8.0) if c else 0.0 for i, c in enumerate(counts)}


def fit(model, tr, va, epochs, lr, tag, weights):
    model.compile(
        optimizer=tf.keras.optimizers.Adam(lr),
        loss=tf.keras.losses.SparseCategoricalCrossentropy(from_logits=True),
        metrics=["accuracy"],
    )
    t0 = time.time()
    h = model.fit(tr, validation_data=va, epochs=epochs, verbose=2,
                  class_weight=weights,
                  callbacks=[tf.keras.callbacks.EarlyStopping(
                      monitor="val_accuracy", patience=2, restore_best_weights=True)])
    print(f"[{tag}] {time.time()-t0:.0f}s  best val_acc={max(h.history['val_accuracy']):.4f}")
    return h


def logits_and_labels(model, ds):
    lg, ys = [], []
    for xb, yb in ds:
        lg.append(model.predict(xb, verbose=0))
        ys.append(yb.numpy())
    return np.concatenate(lg), np.concatenate(ys)


def fit_temperature(logits, y):
    """Grid-search the scalar T that minimises NLL. 15 lines, and it is the
    difference between a real system and a demo (SPEC.md 4.1 step 6)."""
    best_t, best_nll = 1.0, float("inf")
    for t in np.arange(0.5, 5.01, 0.05):
        z = logits / t
        z = z - z.max(axis=1, keepdims=True)
        nll = -np.mean(z[np.arange(len(y)), y] - np.log(np.exp(z).sum(axis=1)))
        if nll < best_nll:
            best_nll, best_t = nll, float(t)
    return best_t


def ece(conf, correct, bins=10):
    """Expected calibration error - the number that proves the gate is honest."""
    e = 0.0
    for i in range(bins):
        lo, hi = i / bins, (i + 1) / bins
        m = (conf > lo) & (conf <= hi)
        if m.sum():
            e += m.mean() * abs(correct[m].mean() - conf[m].mean())
    return float(e)


def export_tflite(infer, rep_images):
    """Float16 quantize. Keras 3 needs a SavedModel hop before the converter.

    SPEC.md 4.1 step 5 called for INT8. It was measured and rejected:

      INT8    1.25 MB, but only 23/30 predictions matched the float model, and
              the Python runtime could not even prepare the graph
              ("failed to create XNNPACK runtime, node 118").
      float16 ~2.6 MB, predictions match, XNNPACK runs it.

    INT8's only advantage here was size, and the budget was 4-6 MB, so there
    was nothing to buy. A model that quietly disagrees with itself 23% of the
    time also makes the calibrated confidence meaningless, and the whole
    three-tier escalation rests on that number being honest.
    # ponytail: float16. Revisit INT8 with quantization-aware training if the
    # model ever has to fit somewhere 2.6 MB does not.
    """
    sm = OUT / "saved_model"
    infer.export(str(sm))
    conv = tf.lite.TFLiteConverter.from_saved_model(str(sm))
    conv.optimizations = [tf.lite.Optimize.DEFAULT]
    conv.target_spec.supported_types = [tf.float16]
    blob = conv.convert()
    (OUT / "crop_model.tflite").write_bytes(blob)
    return blob


def check_export(blob, infer, images):
    """Quantization can quietly change predictions. Compare the exported model
    against the float model on real images; if they disagree, the number on the
    slide is not the number in the farmer's hand.
    """
    it = tf.lite.Interpreter(model_content=blob)
    it.allocate_tensors()
    i, o = it.get_input_details()[0], it.get_output_details()[0]
    agree = 0
    for im in images:  # noqa: E501 - real images, not random noise: quantization damage is data-dependent
        x = im[None].astype(np.float32)
        it.set_tensor(i["index"], x)
        it.invoke()
        if int(it.get_tensor(o["index"])[0].argmax()) == int(infer.predict(x, verbose=0)[0].argmax()):
            agree += 1
    return {"tflite_vs_float_agreement": agree / len(images),
            "tflite_input_dtype": i["dtype"].__name__,
            "tflite_output_dtype": o["dtype"].__name__}


def main():
    if not PREPARED.exists():
        sys.exit(f"missing {PREPARED} - run prepare.py first")

    tr, va = load("train", True), load("val", False)
    tr = tr.prefetch(tf.data.AUTOTUNE)
    va = va.cache().prefetch(tf.data.AUTOTUNE)

    ckpt = OUT / "model.keras"
    if ckpt.exists() and os.environ.get("BAHI_REUSE") == "1":
        print(f"reusing {ckpt}")
        model = tf.keras.models.load_model(ckpt)
        # Found by type, not by name: a checkpoint written before the layers
        # were named still has to load here.
        # (the augmentation block is a Sequential, which is also a Model, so it
        # is excluded by name)
        base = next(l for l in model.layers
                    if isinstance(l, tf.keras.Model) and l.name != "augment")
        gap = next(l for l in model.layers
                   if isinstance(l, tf.keras.layers.GlobalAveragePooling2D))
        dense = model.get_layer("logits")
    else:
        w = class_weights()
        model, base, gap, dense = build()
        fit(model, tr, va, EPOCHS_HEAD, 1e-3, "head", w)

        # unfreeze the top third; the early layers are generic edges/texture
        # and retraining them on this much data just overfits
        base.trainable = True
        for layer in base.layers[:int(len(base.layers) * 0.66)]:
            layer.trainable = False
        fit(model, tr, va, EPOCHS_FT, 1e-4, "finetune", w)

        # Checkpoint BEFORE evaluation. Everything below is analysis and
        # export; a bug there must never cost the training run again.
        model.save(ckpt)
        print(f"saved {ckpt}")

    # --- calibration ---
    # The temperature has to be fitted on the distribution the phone actually
    # sees. Fitting it on val, which is ~95% studio imagery, leaves the model
    # systematically overconfident on real field photos: that is not a cosmetic
    # miscalibration, it is the direct cause of confident-but-wrong diagnoses,
    # and the whole three-tier design rests on the confidence being truthful.
    # field_cal is held-out field imagery that never trains and never appears
    # in any reported accuracy.
    vl, vy = logits_and_labels(model, va)
    T_val = fit_temperature(vl, vy)

    if has_split("field_cal"):
        cd, _, cal_remap = load_subset("field_cal")
        cl, cy_local = logits_and_labels(model, cd)
        cy = cal_remap[cy_local]
        T = fit_temperature(cl, cy)
        cal_note = f"field_cal, {len(cy)} held-out field images"
    else:
        T, cy = T_val, None
        cal_note = "val (lab-heavy) - field confidence will be overconfident"

    p = tf.nn.softmax(vl / T).numpy()
    conf, pred = p.max(1), p.argmax(1)
    metrics = {
        "temperature": T,
        "temperature_fitted_on": cal_note,
        "temperature_if_fitted_on_val": T_val,
        "val_accuracy": float((pred == vy).mean()),
        "val_ece_after_calibration": ece(conf, (pred == vy).astype(float)),
        "val_ece_before_calibration": ece(tf.nn.softmax(vl).numpy().max(1),
                                          (vl.argmax(1) == vy).astype(float)),
        "img_size": IMG, "classes": len(LABELS),
    }

    # --- the honest number: held-out FIELD images only ---
    if has_split("field_test"):
        fd, present, remap = load_subset("field_test")
        fl, fy_local = logits_and_labels(model, fd)
        fy = remap[fy_local]                     # into the global label space
        fp = tf.nn.softmax(fl / T).numpy()
        fpred, fconf = fp.argmax(1), fp.max(1)
        metrics["field_accuracy"] = float((fpred == fy).mean())
        metrics["field_n"] = int(len(fy))
        # ECE on FIELD data is the number that matters: val ECE will look worse
        # after field calibration and that is fine, because the phone is not
        # pointed at a studio backdrop.
        raw = tf.nn.softmax(fl).numpy()
        metrics["field_ece_after_calibration"] = ece(fconf, (fpred == fy).astype(float))
        metrics["field_ece_before_calibration"] = ece(raw.max(1),
                                                      (raw.argmax(1) == fy).astype(float))
        metrics["field_classes"] = present
        metrics["field_note"] = (
            f"{len(present)} of {len(LABELS)} classes have in-the-wild test "
            f"images. Classes without field images are reported on "
            f"the validation split only.")

        # Accuracy split by which collection the photograph came from. This
        # exists because the headline field number is not trustworthy on its
        # own: a donated field set is usually one team, one camera, a handful of
        # sessions, so held-out images from it resemble the training images far
        # more than a stranger's photo would. Measured once at 97.9% on cotton
        # and 37.1% on PlantDoc from the same model on the same day.
        #
        # plantdoc is the number to quote. It is web imagery from everywhere,
        # it has never been in training in any run, and it shares no collection
        # with anything the model has seen.
        origins_file = PREPARED / "field_test_origins.json"
        if origins_file.exists():
            origins = json.loads(origins_file.read_text(encoding="utf-8"))
            keys = ["/".join(pathlib.Path(p).parts[-2:]) for p in fd.file_paths]
            src = np.array([origins.get(k, "?") for k in keys])
            per_source = {}
            for s in sorted(set(src)):
                m = src == s
                per_source[s] = {"n": int(m.sum()),
                                 "accuracy": float((fpred[m] == fy[m]).mean())}
            metrics["field_accuracy_by_source"] = per_source
            pd = per_source.get("plantdoc_files")
            if pd:
                metrics["field_accuracy_plantdoc"] = pd["accuracy"]
                metrics["field_n_plantdoc"] = pd["n"]
        # What the three tiers actually do on field data.
        # tier1_precision is THE number to optimise: of the photos the app is
        # willing to put a diagnosis on, how often is that diagnosis right?
        # Raw field accuracy can be improved by making the model bolder, which
        # makes this one worse. Never trade them the wrong way.
        for name, lo, hi in [("tier1_auto", 0.85, 1.01), ("tier2_vlae", 0.60, 0.85),
                             ("tier3_expert", 0.0, 0.60)]:
            m = (fconf >= lo) & (fconf < hi)
            metrics[name] = {"share": float(m.mean()),
                             "accuracy": float((fpred[m] == fy[m]).mean()) if m.sum() else None,
                             "n": int(m.sum())}
        t1 = metrics["tier1_auto"]
        metrics["tier1_precision"] = t1["accuracy"]
        metrics["tier1_false_positive_rate"] = (
            None if t1["accuracy"] is None else 1 - t1["accuracy"])
        # SPEC.md A1: in the app the plot's crop is already known from its
        # sowing event, so the softmax is masked to that crop's classes and
        # renormalized. Measure that, because it is the number a registered
        # farmer actually experiences, and it costs no extra training.
        # What the farmer actually acts on is the spray, not the pathogen name.
        # Several of our classes share a treatment (early blight, septoria and
        # gray leaf spot all get mancozeb 2.5 g/l), so a "wrong" prediction can
        # still send the farmer to the right shop with the right dose. Class
        # accuracy hides that; this measures the outcome the farmer lives with.
        tp = json.loads((ROOT / "content" / "treatment_plans.json").read_text(encoding="utf-8"))
        def action_of(lab):
            r = tp.get(lab) or {}
            if r.get("healthy"):
                return "healthy"
            return (r.get("what", {}).get("en", lab) + "|" + r.get("dose", {}).get("en", "")).lower()
        act = [action_of(l) for l in LABELS]
        metrics["field_treatment_accuracy"] = float(
            np.mean([act[a] == act[b] for a, b in zip(fpred, fy)]))
        t1m = (fconf >= 0.85)
        metrics["tier1_treatment_precision"] = (
            float(np.mean([act[a] == act[b] for a, b in zip(fpred[t1m], fy[t1m])]))
            if t1m.sum() else None)

        crop_of = [l.split("__")[0] for l in LABELS]
        masked = np.full_like(fp, -1.0)
        for r in range(len(fy)):
            idx = CROP_MASK[crop_of[fy[r]]]
            masked[r, idx] = fp[r, idx] / max(fp[r, idx].sum(), 1e-12)
        mpred, mconf = masked.argmax(1), masked.max(1)
        metrics["field_accuracy_crop_conditioned"] = float((mpred == fy).mean())
        for name, lo, hi in [("cc_tier1_auto", 0.85, 1.01), ("cc_tier2_vlae", 0.60, 0.85),
                             ("cc_tier3_expert", 0.0, 0.60)]:
            m = (mconf >= lo) & (mconf < hi)
            metrics[name] = {"share": float(m.mean()),
                             "accuracy": float((mpred[m] == fy[m]).mean()) if m.sum() else None}

        cm = tf.math.confusion_matrix(fy, fpred, num_classes=len(LABELS)).numpy()
        with open(OUT / "confusion.csv", "w") as f:
            f.write("," + ",".join(LABELS) + "\n")
            for lab, row in zip(LABELS, cm):
                f.write(lab + "," + ",".join(map(str, row)) + "\n")

    # --- export ---
    reps = []
    for xb, _ in tr.take(4):
        reps.extend(xb.numpy())
    infer = inference_twin(base, gap, dense)
    blob = export_tflite(infer, reps[:100])
    metrics["tflite_bytes"] = len(blob)
    metrics["tflite_mb"] = round(len(blob) / 1e6, 2)
    metrics.update(check_export(blob, infer, reps[:25]))

    # labels.txt for the backend, labels.json for the app: Metro returns an
    # asset URI for a .txt require() but parses .json into a real array.
    (OUT / "labels.txt").write_text("\n".join(LABELS))
    (OUT / "labels.json").write_text(json.dumps(LABELS, indent=0))
    (OUT / "metrics.json").write_text(json.dumps(metrics, indent=2))
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
