"""Validate the content JSON files the app ships with.

These files are edited the night before a demo by whoever owns the copy, not
by a developer. A dangling node id in symptom_tree.json is a dead end on stage.
Run this before every build.
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
LANGS = ("hi", "en")


def load(name):
    return json.loads((HERE / name).read_text(encoding="utf-8"))


def check_symptom_tree() -> list[str]:
    t = load("symptom_tree.json")
    nodes, results = t["nodes"], t["results"]
    errs = []

    if t["root"] not in nodes:
        errs.append(f"root '{t['root']}' is not a node")

    valid = set(nodes) | set(results)
    for nid, n in nodes.items():
        for branch in ("yes", "no"):
            tgt = n.get(branch)
            if tgt is None:
                errs.append(f"node '{nid}' has no '{branch}' branch")
            elif tgt not in valid:
                errs.append(f"node '{nid}'.{branch} -> '{tgt}' does not exist")
        for lang in LANGS:
            if not n.get("q", {}).get(lang):
                errs.append(f"node '{nid}' missing question text [{lang}]")

    for rid, r in results.items():
        for lang in LANGS:
            if not r.get("likely", {}).get(lang):
                errs.append(f"result '{rid}' missing likely [{lang}]")
            if not r.get("action", {}).get(lang):
                errs.append(f"result '{rid}' missing action [{lang}]")
        if r.get("urgency") not in ("urgent", "soon", "monitor"):
            errs.append(f"result '{rid}' bad urgency {r.get('urgency')!r}")
        if r.get("urgency") == "urgent" and not r.get("needs_vet"):
            errs.append(f"result '{rid}' is urgent but needs_vet is false")
        if not r.get("canonical_id"):
            errs.append(f"result '{rid}' has no canonical_id")

    # every node must be reachable from the root, and every walk must end
    seen, stack = set(), [t["root"]]
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        if cur in nodes:
            stack += [nodes[cur][b] for b in ("yes", "no") if nodes[cur].get(b) in valid]
    for orphan in sorted((set(nodes) | set(results)) - seen):
        errs.append(f"'{orphan}' is unreachable from the root")

    # depth bound: blueprint promises 3-6 questions, not an interrogation
    def depth(nid, guard=0):
        if guard > 40 or nid in results:
            return 0
        n = nodes[nid]
        return 1 + max(depth(n["yes"], guard + 1), depth(n["no"], guard + 1))

    d = depth(t["root"])
    if d > 10:
        errs.append(f"worst-case path is {d} questions; blueprint promises a short wizard")

    if t.get("_validated_by") is None:
        print("  WARNING symptom_tree.json _validated_by is null - "
              "not vet-reviewed, do not put in front of a real farmer")
    return errs


def check_vaccination() -> list[str]:
    v = load("vaccination_schedule.json")
    errs = []
    for species, entries in v["schedules"].items():
        for e in entries:
            tag = f"{species}/{e.get('vaccine')}"
            if not isinstance(e.get("first_dose_days"), int):
                errs.append(f"{tag}: first_dose_days must be an int")
            if e.get("lifetime_once"):
                if e.get("repeat_days") is not None:
                    errs.append(f"{tag}: lifetime_once but repeat_days is set")
            elif not isinstance(e.get("repeat_days"), int):
                errs.append(f"{tag}: needs repeat_days or lifetime_once")
            for lang in LANGS:
                if not e.get("label", {}).get(lang):
                    errs.append(f"{tag}: missing label [{lang}]")
            if not isinstance(e.get("remind_before_days"), int):
                errs.append(f"{tag}: missing remind_before_days")
    for alias, target in v.get("aliases", {}).items():
        if target not in v["schedules"]:
            errs.append(f"alias {alias} -> unknown schedule {target}")
    # Every species word the UI can write into animal.species must resolve.
    # "cow" not resolving meant every cow got an empty vaccine plan, silently.
    for word in ("cow", "buffalo", "cattle", "gaay", "bhains"):
        if v["aliases"].get(word) not in v["schedules"]:
            errs.append(f"species '{word}' does not resolve to a schedule")
    b = v["breeding"]
    if b["gestation_days"] != 283 or b["heat_cycle_days"] != 21:
        errs.append("bovine constants changed; SPEC.md B5 says 21-day heat, 283-day gestation")
    return errs


def check_treatments() -> list[str]:
    """Every trained class must have a card to render. A missing key is a blank
    screen at the exact moment the demo is being watched."""
    sys.path.insert(0, str(HERE.parent / "ml"))
    from labels import LABELS

    t = load("treatment_plans.json")
    errs = []
    for lab in LABELS:
        r = t.get(lab)
        if r is None:
            errs.append(f"no treatment plan for trained class '{lab}'")
            continue
        for lang in LANGS:
            if not r.get("name", {}).get(lang):
                errs.append(f"{lab}: missing name [{lang}]")
        if r.get("healthy"):
            continue
        for field in ("what", "dose", "when"):
            for lang in LANGS:
                if not r.get(field, {}).get(lang):
                    errs.append(f"{lab}: missing {field} [{lang}]")
        for field in ("cost_inr", "saves_inr"):
            if not isinstance(r.get(field), int):
                errs.append(f"{lab}: {field} must be an int")
        if isinstance(r.get("saves_inr"), int) and isinstance(r.get("cost_inr"), int):
            if r["saves_inr"] <= r["cost_inr"]:
                errs.append(f"{lab}: saves_inr not greater than cost_inr, "
                            f"the cost-benefit line would argue against spraying")
    for key in t:
        if not key.startswith("_") and key not in LABELS:
            errs.append(f"treatment plan '{key}' is not a trained class")
    if t.get("_validated_by") is None:
        print("  WARNING treatment_plans.json _validated_by is null - "
              "doses are not agronomist-reviewed")
    return errs


def check_strings() -> list[str]:
    """Both languages must carry exactly the same keys.

    A key present in Hindi but missing in English does not crash: t() silently
    falls back to Hindi, so an English-speaking user gets one Devanagari line in
    the middle of an English screen and nobody notices until a judge does.
    """
    files = sorted(HERE.glob("strings_*.json"))
    sets = {f.stem.split("_")[1]: {k for k in load(f.name) if not k.startswith("_")}
            for f in files}
    base = sets.get("hi", set())
    errs = []
    for lang, keys in sets.items():
        for k in sorted(base - keys):
            errs.append(f"strings_{lang}.json is missing key '{k}'")
        for k in sorted(keys - base):
            errs.append(f"strings_{lang}.json has extra key '{k}' not in Hindi")
    # placeholders must survive translation, or the value never gets substituted
    hi = load("strings_hi.json")
    for lang in sets:
        d = load(f"strings_{lang}.json")
        for k in base & sets[lang]:
            a, b = hi[k], d[k]
            if isinstance(a, str) and isinstance(b, str):
                ph = lambda x: {p.split("}")[0] for p in x.split("{")[1:]}
                if ph(a) != ph(b):
                    errs.append(f"strings_{lang}.json '{k}': placeholders "
                                f"{sorted(ph(b))} do not match Hindi {sorted(ph(a))}")
    # Key parity proves a language file is COMPLETE. It says nothing about
    # whether the words are right, and a wrong disease name in a language nobody
    # on the team reads is the quietest way to send a farmer to the wrong spray.
    # Any file that declares _validated_by: null says so on every run.
    for lang in sorted(sets):
        d = load(f"strings_{lang}.json")
        if "_validated_by" in d and d["_validated_by"] is None:
            print(f"  WARNING strings_{lang}.json _validated_by is null - "
                  f"no native speaker has read it, agricultural terms unverified")
    print(f"  {len(sets)} languages, {len(base)} keys each")
    return errs


def main():
    errs = []
    for name, fn in [("symptom_tree.json", check_symptom_tree),
                     ("vaccination_schedule.json", check_vaccination),
                     ("treatment_plans.json", check_treatments),
                     ("strings_*.json", check_strings)]:
        e = fn()
        print(f"{name}: {'OK' if not e else str(len(e)) + ' PROBLEMS'}")
        errs += [f"  {name}: {x}" for x in e]
    if errs:
        print("\n".join(errs))
        sys.exit(1)
    t = load("symptom_tree.json")
    print(f"content ok: {len(t['nodes'])} questions, {len(t['results'])} outcomes, "
          f"{sum(1 for r in t['results'].values() if r['urgency'] == 'urgent')} urgent paths")


if __name__ == "__main__":
    main()
