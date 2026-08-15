"""Canonical crop-disease taxonomy for BAHI.

The model NEVER emits a farmer-facing string. It emits one of these ids.
The Hindi/regional word is chosen at the last moment from the glossary
(SPEC.md E1b), so every label here is a stable machine id.

31 classes across 6 crops.

One deliberate cut from the SPEC.md A1 list, because the data does not exist,
not because the class is unimportant:

  chilli (3 classes)   - no public chilli disease dataset was found. Every
                         Kaggle result titled "chilli leaf disease" turned out
                         to be PlantVillage BELL PEPPER folders renamed
                         (Pepper__bell___Bacterial_spot). Bell pepper is not
                         chilli and training on it would put a confidently
                         wrong crop in front of a farmer.

It goes on the roadmap slide. Say the reason out loud in the pitch: it is the
same honesty rule as SPEC.md section 11's "Do NOT cite" list.

rice sheath_blight was cut for the same reason and then restored once the ICAR
field dataset turned out to contain it. It sits near the MIN_PER_CLASS floor,
as do wheat septoria and wheat powdery mildew: check those three rows in
artifacts/confusion.csv before claiming them on a slide.
"""

# crop -> list of disease slugs. "healthy" is a class for every crop.
CROPS = {
    "rice": ["blast", "brown_spot", "bacterial_leaf_blight", "tungro",
             "sheath_blight", "healthy"],
    "wheat": ["leaf_rust", "stripe_rust", "septoria", "powdery_mildew", "healthy"],
    "maize": ["northern_leaf_blight", "common_rust", "gray_leaf_spot", "fall_armyworm", "healthy"],
    "tomato": ["early_blight", "late_blight", "leaf_mold", "septoria_leaf_spot", "bacterial_spot",
               "yellow_leaf_curl", "mosaic_virus", "spider_mites", "healthy"],
    "potato": ["early_blight", "late_blight", "healthy"],
    "cotton": ["bacterial_blight", "leaf_curl_virus", "healthy"],
}

LABELS = [f"{c}__{d}" for c, ds in CROPS.items() for d in ds]
LABEL_TO_IDX = {l: i for i, l in enumerate(LABELS)}

# Indices per crop, used for crop-conditioned inference (SPEC.md A1):
# when the plot's crop is known we mask the softmax to that crop's classes
# and renormalize, so the model picks among ~5 candidates instead of 34.
CROP_MASK = {c: [LABEL_TO_IDX[f"{c}__{d}"] for d in ds] for c, ds in CROPS.items()}


def normalize(s: str) -> str:
    """Source folder name -> comparable token."""
    s = s.lower()
    for ch in " -()[]{}.,'":
        s = s.replace(ch, "_")
    while "__" in s:
        s = s.replace("__", "_")
    return s.strip("_")


# Source folder token -> canonical label.
# Keys are normalize()d. Built from PlantVillage / PlantDoc / Mendeley /
# Kaggle folder conventions; unmatched folders are reported and dropped
# rather than guessed, because a mislabelled class is worse than a missing one.
ALIASES = {
    # --- rice ---
    "rice_blast": "rice__blast", "blast": "rice__blast", "rice_leaf_blast": "rice__blast",
    "rice_brown_spot": "rice__brown_spot", "brown_spot": "rice__brown_spot",
    "brownspot": "rice__brown_spot", "rice_brownspot": "rice__brown_spot",
    "rice_bacterial_leaf_blight": "rice__bacterial_leaf_blight",
    "bacterial_leaf_blight": "rice__bacterial_leaf_blight",
    "bacterialblight": "rice__bacterial_leaf_blight", "rice_blb": "rice__bacterial_leaf_blight",
    "blb": "rice__bacterial_leaf_blight",
    "rice_tungro": "rice__tungro", "tungro": "rice__tungro",
    "rice_healthy": "rice__healthy", "healthy_rice": "rice__healthy",
    "rice_normal": "rice__healthy",

    # --- wheat ---
    "wheat_leaf_rust": "wheat__leaf_rust", "leaf_rust": "wheat__leaf_rust",
    "wheat_brown_rust": "wheat__leaf_rust", "brown_rust": "wheat__leaf_rust",
    "wheat_stripe_rust": "wheat__stripe_rust", "stripe_rust": "wheat__stripe_rust",
    "yellow_rust": "wheat__stripe_rust", "wheat_yellow_rust": "wheat__stripe_rust",
    "wheat_septoria": "wheat__septoria", "septoria": "wheat__septoria",
    "wheat_powdery_mildew": "wheat__powdery_mildew", "powdery_mildew": "wheat__powdery_mildew",
    "wheat_healthy": "wheat__healthy", "healthy_wheat": "wheat__healthy",

    # --- maize ---
    "corn_maize_northern_leaf_blight": "maize__northern_leaf_blight",
    "corn_northern_leaf_blight": "maize__northern_leaf_blight",
    "northern_leaf_blight": "maize__northern_leaf_blight",
    "maize_northern_leaf_blight": "maize__northern_leaf_blight",
    "turcicum_leaf_blight": "maize__northern_leaf_blight",
    "corn_maize_common_rust": "maize__common_rust", "corn_common_rust": "maize__common_rust",
    "common_rust": "maize__common_rust", "maize_common_rust": "maize__common_rust",
    "corn_maize_cercospora_leaf_spot_gray_leaf_spot": "maize__gray_leaf_spot",
    "cercospora_leaf_spot_gray_leaf_spot": "maize__gray_leaf_spot",
    "gray_leaf_spot": "maize__gray_leaf_spot", "grey_leaf_spot": "maize__gray_leaf_spot",
    "maize_gray_leaf_spot": "maize__gray_leaf_spot",
    "fall_armyworm": "maize__fall_armyworm", "maize_fall_armyworm": "maize__fall_armyworm",
    "corn_fall_armyworm": "maize__fall_armyworm", "fallarmyworm": "maize__fall_armyworm",
    "corn_maize_healthy": "maize__healthy", "corn_healthy": "maize__healthy",
    "maize_healthy": "maize__healthy", "healthy_maize": "maize__healthy",

    # --- tomato ---
    "tomato_early_blight": "tomato__early_blight",
    "tomato_late_blight": "tomato__late_blight",
    "tomato_leaf_mold": "tomato__leaf_mold", "tomato_leaf_mould": "tomato__leaf_mold",
    "tomato_septoria_leaf_spot": "tomato__septoria_leaf_spot",
    "tomato_bacterial_spot": "tomato__bacterial_spot",
    "tomato_tomato_yellowleaf_curl_virus": "tomato__yellow_leaf_curl",
    "tomato_yellow_leaf_curl_virus": "tomato__yellow_leaf_curl",
    "tomato_yellowleaf_curl_virus": "tomato__yellow_leaf_curl",
    "tomato_leaf_curl": "tomato__yellow_leaf_curl",
    "tomato_tomato_mosaic_virus": "tomato__mosaic_virus",
    "tomato_mosaic_virus": "tomato__mosaic_virus",
    "tomato_spider_mites_two_spotted_spider_mite": "tomato__spider_mites",
    "tomato_spider_mites": "tomato__spider_mites",
    "tomato_two_spotted_spider_mite": "tomato__spider_mites",
    "tomato_healthy": "tomato__healthy", "healthy_tomato": "tomato__healthy",

    # --- potato ---
    "potato_early_blight": "potato__early_blight",
    "potato_late_blight": "potato__late_blight",
    "potato_healthy": "potato__healthy", "healthy_potato": "potato__healthy",

    # --- cotton (Mendeley 15-crop) ---
    "cotton_bacterial_blight": "cotton__bacterial_blight",
    "bacterial_blight": "cotton__bacterial_blight",
    "cotton_leaf_curl_virus": "cotton__leaf_curl_virus",
    "cotton_curl_virus": "cotton__leaf_curl_virus",
    "cotton_healthy": "cotton__healthy", "healthy_cotton": "cotton__healthy",
    "cotton_healthy_leaf": "cotton__healthy", "fresh_cotton_leaf": "cotton__healthy",

    # --- exact folder names seen in the downloaded sources ---
    # Mendeley "15 Crop 45 Disease and Healthy Leaf dataset"
    "rice_leaf_blast": "rice__blast", "rice_leafblast": "rice__blast",
    "septoria_leaf_spot_tomato": "tomato__septoria_leaf_spot",
    # Kaggle nirmalsankalana/rice-leaf-disease-image
    "bacterialblight": "rice__bacterial_leaf_blight",
    # Kaggle smaranjitghose/corn-or-maize-leaf-disease-dataset. This source is
    # maize-only and its four folders are the standard set, so bare "Blight"
    # is unambiguously Northern Leaf Blight HERE. It is reached only via
    # crop_hint="maize", never as a global bare token.
    "maize_blight": "maize__northern_leaf_blight",
    # Kaggle vishesh2395/crops-disease-dataset
    "corn_gray_leaf_spot": "maize__gray_leaf_spot",
    "wheat_brownrust": "wheat__leaf_rust",
    "wheat_yellowrust": "wheat__stripe_rust",
    "wheat_mildew": "wheat__powdery_mildew",
    # ICAR / DARE via AIKosh. Folder names come from the download script as
    # <Crop>_<Group>_<NN_class>, e.g. Maize/Disease/02_turcicum_leaf_blight.
    # Turcicum leaf blight IS northern leaf blight (Exserohilum turcicum);
    # maydis leaf blight is the SOUTHERN one and is a different disease, so it
    # is refused rather than folded in.
    "maize_disease_02_turcicum_leaf_blight": "maize__northern_leaf_blight",
    "maize_insect_pests_02_fall_armyworm": "maize__fall_armyworm",
    "maize_insect_pests_03_faw_symptoms": "maize__fall_armyworm",
    "rice_disease_01_bacterial_leaf_blight": "rice__bacterial_leaf_blight",
    "rice_disease_02_brown_spot": "rice__brown_spot",
    "rice_disease_04_leaf_sheath_blight": "rice__sheath_blight",
    # PlantDoc (field images; used only for the held-out test set)
    "corn_gray_leaf_spot_": "maize__gray_leaf_spot",
    "corn_leaf_blight": "maize__northern_leaf_blight",
    "corn_rust_leaf": "maize__common_rust",
    "potato_leaf_early_blight": "potato__early_blight",
    "potato_leaf_late_blight": "potato__late_blight",
    "tomato_early_blight_leaf": "tomato__early_blight",
    "tomato_leaf_late_blight": "tomato__late_blight",
    "tomato_leaf_bacterial_spot": "tomato__bacterial_spot",
    "tomato_leaf_mosaic_virus": "tomato__mosaic_virus",
    "tomato_leaf_yellow_virus": "tomato__yellow_leaf_curl",
    "tomato_mold_leaf": "tomato__leaf_mold",
    "tomato_leaf": "tomato__healthy",
}

# Folders that LOOK mappable but are deliberately NOT mapped. Listing them
# stops a well-meaning teammate from "fixing" the drop later.
REFUSED = {
    "pepper_bell_bacterial_spot": "bell pepper is not chilli",
    "pepper_bell_healthy": "bell pepper is not chilli",
    "maize_leaf_spot": "ambiguous: could be gray leaf spot or something else",
    "leaf_blight_tomato": "ambiguous: tomato early blight vs late blight",
    "rice_hispa": "insect pest not in the class list",
    "tomato_target_spot": "not in the class list",
    "wheat_blast": "not in the class list",
    "wheat_leafblight": "ambiguous against the two rusts we do model",
    # ICAR folders outside the class list. Refused by name so nobody folds
    # maydis into turcicum later: they are different pathogens.
    "maize_disease_01_maydis_leaf_blight": "southern corn leaf blight, a different disease",
    "maize_disease_03_curvularia_leaf_spot": "not in the class list",
    "maize_disease_04_sorghum_downy_mildew": "not in the class list",
    "maize_insect_pests_01_aphid": "not in the class list",
    "rice_disease_03_false_smut": "not in the class list",
    "rice_insect_pests_05_leaf_folder": "not in the class list",
    "rice_insect_pests_06_rice_skipper": "not in the class list",
    "rice_insect_pests_07_white_stem_borer": "not in the class list",
    "rice_insect_pests_08_yellow_stem_borer": "not in the class list",
}


def resolve(folder_name: str, crop_hint: str | None = None) -> str | None:
    """Map a source folder to a canonical label, or None if unknown.

    crop_hint comes from the parent directory when a dataset nests as
    Crop/Crop___Disease, which disambiguates bare names like "healthy".
    """
    tok = normalize(folder_name)
    if tok in REFUSED:
        return None
    if tok in ALIASES:
        return ALIASES[tok]
    if crop_hint:
        crop = normalize(crop_hint)
        crop = {"corn": "maize", "chili": "chilli", "pepper": "chilli",
                "pepper_bell": "chilli", "paddy": "rice"}.get(crop, crop)
        combined = f"{crop}_{tok}"
        if combined in ALIASES:
            return ALIASES[combined]
        if crop in CROPS:
            # bare disease token under a crop folder, e.g. Rice/Healthy
            direct = f"{crop}__{tok}"
            if direct in LABEL_TO_IDX:
                return direct
    return None


def _self_check():
    assert len(LABELS) == 31, len(LABELS)
    assert len(set(LABELS)) == len(LABELS), "duplicate label"
    for k, v in ALIASES.items():
        assert v in LABEL_TO_IDX, f"alias {k} -> unknown label {v}"
    for k in REFUSED:
        assert k not in ALIASES, f"{k} is both aliased and refused"
    # crop masks partition the label space exactly, which is what makes
    # crop-conditioned inference safe
    seen = sorted(i for idxs in CROP_MASK.values() for i in idxs)
    assert seen == list(range(len(LABELS))), "crop masks do not partition labels"

    # exact folder names from the five downloaded sources
    assert resolve("Corn_(maize)___Common_rust_") == "maize__common_rust"
    assert resolve("Tomato___Tomato_YellowLeaf__Curl_Virus") == "tomato__yellow_leaf_curl"
    assert resolve("Potato___Late_blight") == "potato__late_blight"
    assert resolve("Wheat___Yellow_Rust") == "wheat__stripe_rust"
    assert resolve("Wheat_BrownRust") == "wheat__leaf_rust"
    assert resolve("Cotton Curl Virus") == "cotton__leaf_curl_virus"
    assert resolve("Bacterialblight") == "rice__bacterial_leaf_blight"
    assert resolve("Rice___Leaf_Blast") == "rice__blast"
    assert resolve("Tomato leaf") == "tomato__healthy"
    assert resolve("Healthy", crop_hint="Rice") == "rice__healthy"
    assert resolve("Common_Rust", crop_hint="Corn") == "maize__common_rust"

    # the refusals are the point: never guess
    assert resolve("Apple___Apple_scab") is None, "out-of-scope crop"
    assert resolve("Pepper__bell___Bacterial_spot") is None, "bell pepper is not chilli"
    assert resolve("Maize leaf spot") is None, "ambiguous maize folder"
    assert resolve("leaf blight_tomato") is None, "ambiguous tomato folder"
    assert resolve("Rice_Hispa") is None, "pest outside the class list"
    assert resolve("Maize_Disease_02_turcicum_leaf_blight") == "maize__northern_leaf_blight"
    assert resolve("Rice_Disease_01_Bacterial_leaf_blight") == "rice__bacterial_leaf_blight"
    assert resolve("Maize_Disease_01_maydis_leaf_blight") is None, "southern != northern blight"
    print(f"labels ok: {len(LABELS)} classes / {len(CROPS)} crops, "
          f"{len(ALIASES)} aliases, {len(REFUSED)} explicit refusals")


if __name__ == "__main__":
    _self_check()
