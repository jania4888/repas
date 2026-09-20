"""Pure A0 planning checks. No models, images, legal approval or runtime catalogue."""
import csv
import hashlib
import json
import math
from pathlib import Path
import re

ART_ROOT = Path(__file__).resolve().parents[1]
STYLES = ("Classic", "Modern", "Vintage", "Minimal", "Artisan")
PILOTS = ("C12", "C17", "C19", "C05")
LARGE = {"C02", "C04", "C05", "C09", "C23", "C24", "C25", "C26"}
FAMILIES = {
    "F01": ("tertiaire", (1, 3, 6, 7, 10)),
    "F02": ("atelier", (4, 9, 25)),
    "F03": ("halle", (2, 5)),
    "F04": ("retail", tuple(range(11, 17))),
    "F05": ("conseil-studio", (8, *range(17, 23))),
    "F06": ("BTP", (23, 24, 26)),
    "F07": ("collectif", tuple(range(27, 32))),
    "F08": ("formation", tuple(range(32, 37))),
}
ALIASES = dict(zip(
    ("entreprise", "commerce", "services", "btp-construction", "association", "etablissement-educatif"),
    ("C10", "C16", "C22", "C26", "C31", "C36"),
))
LEGACY_LHP = ("3.36x4.73x2.57", "3.10x4.05x2.37", "3.48x4.85x2.64", "3.02x3.82x2.30", "3.28x4.50x2.49")
FIELDS = (
    "id,couple,segment,domaine,famille,famille_nom,profil_public_propose,revision_editoriale,pilote,"
    "largeur_m,profondeur_m,hauteur_m,dimensions_v3_LxPxH_m,theme_revue_v3,theme_revue_code,"
    "declinaisons_styles,facade_locale_grande_echelle,volume_local_m,parvis_propose_m,"
    "raccord_legacy_revue_LxHxP_m,raccord_v2_regle,facade_layout_v3,layout_propre,prop_1,prop_2,"
    "prop_3,props_complementaires,props_v3_complets,limites_editoriales,refs_inspiration,"
    "render_exterieur_canonique,render_interieur_canonique,sous_budget_interieur,statut"
).split(",")
MAX_INPUT_BYTES = 1_000_000


class ValidationError(ValueError):
    """An invalid production input, never an instruction to repair/generate it."""


def require(condition, message):
    if not condition:
        raise ValidationError(message)


def read_text(path):
    with Path(path).open("rb") as stream:
        data = stream.read(MAX_INPUT_BYTES + 1)
    require(len(data) <= MAX_INPUT_BYTES, "Input exceeds 1 MB limit")
    return data.decode("utf-8")


def load_json(path):
    def unique_keys(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f"Duplicate JSON key: {key}")
            result[key] = value
        return result
    return json.loads(read_text(path), object_pairs_hook=unique_keys,
                      parse_constant=lambda value: require(False, f"Non-finite JSON: {value}"))


def load_csv(path, columns):
    reader = csv.DictReader(read_text(path).splitlines())
    require(reader.fieldnames == columns, "CSV header does not match the declared schema")
    rows = list(reader)
    require(len(rows) <= 4096, "CSV exceeds row limit")
    for row in rows:
        require(set(row) == set(columns) and all(isinstance(v, str) for v in row.values()),
                "CSV row has missing or extra cells")
        require(all(len(v) <= 4096 for v in row.values()), "CSV cell exceeds length limit")
    return rows


def canonical_rows(text):
    """Read only the six frozen V3 columns, not a free-form Markdown parser."""
    result = {}
    for line in text.splitlines():
        if re.match(r"^\| C\d{2} \|", line):
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            require(len(cells) == 6 and cells[0] not in result, "Malformed V3 matrix row")
            result[cells[0]] = cells[1:]
    require(set(result) == {f"C{i:02}" for i in range(1, 37)}, "V3 must contain C01–C36 exactly")
    return result


def validate_registry(rows, canonical):
    require(len(rows) == 36, "Exactly 36 specialized compositions required")
    require({row.get("id") for row in rows} == set(canonical), "Missing or duplicate composition ID")
    family_by_id = {f"C{i:02}": (key, name) for key, (name, ids) in FAMILIES.items() for i in ids}
    for row in rows:
        cid = row["id"]
        require(set(row) == set(FIELDS) and all(isinstance(v, str) and v.strip() for v in row.values()),
                f"{cid}: all declared fields are required")
        actual = [row[k] for k in ("couple", "dimensions_v3_LxPxH_m", "theme_revue_v3", "facade_layout_v3", "props_v3_complets")]
        require(actual == canonical[cid], f"{cid}: frozen V3 dimensions/theme/layout/full props changed")
        require(row["couple"] == f'{row["segment"]}/{row["domaine"]}', f"{cid}: pair mismatch")
        require((row["famille"], row["famille_nom"]) == family_by_id[cid], f"{cid}: family mismatch")
        require(row["pilote"] == ("oui" if cid in PILOTS else "non"), f"{cid}: pilot scope changed")
        large = cid in LARGE
        require(row["facade_locale_grande_echelle"] == ("oui" if large else "non"), f"{cid}: local exterior requirement changed")
        try:
            dimensions = [float(row[k]) for k in ("largeur_m", "profondeur_m", "hauteur_m")]
            require(all(math.isfinite(v) and v > 0 for v in dimensions), f"{cid}: invalid dimensions")
            require(dimensions == [float(v) for v in row["dimensions_v3_LxPxH_m"].split("x")], f"{cid}: dimension axes mismatch")
        except ValueError as error:
            raise ValidationError(f"{cid}: invalid metric values") from error
        style = STYLES.index(row["theme_revue_v3"])
        require(row["theme_revue_code"] == str(style), f"{cid}: review theme code mismatch")
        require(row["declinaisons_styles"] == ";".join(f"{i} {s}" for i, s in enumerate(STYLES)), f"{cid}: all five styles required")
        require(row["raccord_legacy_revue_LxHxP_m"] == LEGACY_LHP[style], f"{cid}: legacy L×H×P changed")
        require(row["volume_local_m"] == (row["dimensions_v3_LxPxH_m"] if large else "sans_scene_locale"), f"{cid}: local metric mismatch")
        parvis = "24x12" if cid == "C05" else "12x6" if cid in {"C04", "C09", "C25"} else "18x8"
        require(row["parvis_propose_m"] == (parvis if large else "sans_scene_locale"), f"{cid}: proposed forecourt changed")
        require(row["sous_budget_interieur"] == ("hall_grand_volume" if large else "interieur_ordinaire"), f"{cid}: budget class mismatch")
        profile = f"vp-{cid.lower()}"
        require(row["profil_public_propose"] == profile and row["revision_editoriale"] == "r1", f"{cid}: proposed identity mismatch")
        for view, column in (("exterior", "render_exterieur_canonique"), ("interior", "render_interieur_canonique")):
            require(row[column] == f"{profile}-r1-{view}", f"{cid}: canonical image key mismatch")
        props = [row[f"prop_{i}"] for i in range(1, 4)]
        require(len(set(props)) == 3 and all(p in row["props_v3_complets"] for p in props), f"{cid}: three indexed V3 props required")
        for prop in row["props_complementaires"].split(" ; "):
            require(prop == "aucun item V3 supplémentaire" or prop in row["props_v3_complets"], f"{cid}: complementary prop mismatch")
        require(row["statut"] == ("pilote_avant_stop_humain" if cid in PILOTS else "a_produire_apres_stop_pilotes"), f"{cid}: A0 cannot claim delivery")
    require(len({r["layout_propre"] for r in rows}) == 36, "36 different layout briefs required; families are not recoloured rooms")
    require(len({tuple(r[f"prop_{i}"] for i in range(1, 4)) for r in rows}) == 36, "36 distinct three-prop sets required")


def image_targets(rows):
    targets = []
    for row in rows:
        for view, column in (("exterior", "render_exterieur_canonique"), ("interior", "render_interieur_canonique")):
            targets.append({"imageKey": row[column], "compositionId": row["id"], "view": view,
                            "sceneKind": "local-exterior" if view == "exterior" and row["id"] in LARGE else view,
                            "styleCode": int(row["theme_revue_code"]), "quality": "standard"})
    for view in ("exterior", "interior"):
        targets.append({"imageKey": f"vp-neutral-global-r1-{view}", "compositionId": "global", "view": view, "sceneKind": view})
    return targets


def accounting(rows):
    n, large = len(rows), sum(row["facade_locale_grande_echelle"] == "oui" for row in rows)
    targets = image_targets(rows)
    return {
        "specializedCompositions": n, "families": len({row["famille"] for row in rows}),
        "pilots": sum(row["pilote"] == "oui" for row in rows), "largeLocalExteriors": large,
        "reviewCards": n + len(ALIASES) + 1, "canonicalPairImages": n * 2,
        "minimumDistinctImageCompositions": len({t["imageKey"] for t in targets}),
        "businessStyleResolutions": n * 5, "businessStyleQualityConfigurations": n * 5 * 2,
        "baseRuntimeCaptures": n * 5 * 2 * 2,
        "theoreticalExportsBeforeSharingOrPartition": 2 * (2 * n + large + 2),
    }


def alias_cards(rows):
    by_id = {r["id"]: r for r in rows}
    return [{"reviewCard": f"alias-{segment}", "reuseCompositionId": cid,
             "imageKeys": [by_id[cid][k] for k in ("render_exterieur_canonique", "render_interieur_canonique")],
             "newImageCompositions": 0, "requiresAcceptedPublicProfile": True}
            for segment, cid in ALIASES.items()]


def load_registry(root=ART_ROOT):
    rows = load_csv(root / "source/canonical36.csv", FIELDS)
    validate_registry(rows, canonical_rows(read_text(root / "source/v3-matrix-canonical.md")))
    lock = load_json(root / "release-spec/approved-inputs.lock.json")
    require(set(lock["files"]) == {"source/canonical36.csv", "source/v3-matrix-canonical.md"}, "Unexpected approval lock scope")
    for relative, digest in lock["files"].items():
        actual = hashlib.sha256(read_text(root / relative).encode("utf-8")).hexdigest()
        require(actual == digest, f"{relative}: approved input drift; explicit editorial review required")
    return rows
