"""Standalone tests: synthetic mutations/rights/tool probes, never real art evidence."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from production import inputs, pilot_jobs, preflight, stage_pilots, validate_policy
from registry import (ART_ROOT, LARGE, PILOTS, ValidationError, accounting, alias_cards,
                      canonical_rows, image_targets, load_csv, load_json, load_registry,
                      read_text, validate_registry)
from rights import COLUMNS, RIGHTS, validate_rights


class RegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows, cls.policy, _, _ = inputs()
        cls.canonical = canonical_rows(read_text(ART_ROOT / "source/v3-matrix-canonical.md"))

    def test_approved_36_are_exact_and_all_five_styles_remain(self):
        validate_registry(self.rows, self.canonical)
        self.assertEqual(36, len(self.rows))
        self.assertEqual([5, 3, 2, 6, 7, 3, 5, 5], [sum(r["famille"] == f"F{i:02}" for r in self.rows) for i in range(1, 9)])
        self.assertEqual(set(PILOTS), {r["id"] for r in self.rows if r["pilote"] == "oui"})
        self.assertEqual(LARGE, {r["id"] for r in self.rows if r["facade_locale_grande_echelle"] == "oui"})

    def test_every_v3_requirement_is_frozen_for_every_composition(self):
        for index in range(36):
            for field in ("couple", "dimensions_v3_LxPxH_m", "theme_revue_v3", "facade_layout_v3", "props_v3_complets"):
                with self.subTest(composition=index + 1, field=field):
                    changed = deepcopy(self.rows)
                    changed[index][field] += " changed"
                    with self.assertRaisesRegex(ValidationError, "frozen V3"):
                        validate_registry(changed, self.canonical)

    def test_duplicate_or_missing_composition_is_rejected(self):
        for rows in (self.rows[:-1], self.rows[:-1] + [self.rows[0]]):
            with self.assertRaises(ValidationError):
                validate_registry(rows, self.canonical)

    def test_relational_constraints_cannot_be_silently_changed(self):
        changes = {
            "largeur_m": "NaN", "profondeur_m": "3.4", "hauteur_m": "0",
            "famille": "F04", "pilote": "oui", "facade_locale_grande_echelle": "oui",
            "theme_revue_code": "2", "declinaisons_styles": "1 Modern",
            "raccord_legacy_revue_LxHxP_m": "3.10x2.37x4.05", "volume_local_m": "1x1x1",
            "parvis_propose_m": "18x8", "profil_public_propose": "syn-example",
            "revision_editoriale": "r2", "prop_1": "not in V3", "props_complementaires": "extra machine",
            "render_exterieur_canonique": "shared-family-image", "statut": "delivered",
            "sous_budget_interieur": "hall_grand_volume",
        }
        for field, value in changes.items():
            with self.subTest(field=field):
                rows = deepcopy(self.rows)
                rows[0][field] = value
                with self.assertRaises(ValidationError):
                    validate_registry(rows, self.canonical)

    def test_families_are_not_duplicate_layout_or_prop_templates(self):
        for fields in (("layout_propre",), ("prop_1", "prop_2", "prop_3")):
            rows = deepcopy(self.rows)
            for field in fields:
                rows[1][field] = rows[0][field]
            with self.assertRaises(ValidationError):
                validate_registry(rows, self.canonical)

    def test_approved_detailed_placement_changes_require_explicit_review(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(ART_ROOT / "source", root / "source", ignore=shutil.ignore_patterns("__pycache__"))
            shutil.copytree(ART_ROOT / "release-spec", root / "release-spec")
            path = root / "source/canonical36.csv"
            path.write_text(path.read_text().replace("Accueil latéral gauche depuis le seuil", "Different unique layout"))
            with self.assertRaisesRegex(ValidationError, "approved input drift"):
                load_registry(root)

    def test_counts_describe_requirements_not_delivery(self):
        counts = accounting(self.rows)
        self.assertEqual(self.policy["expectedPlanningCounts"], counts)
        self.assertEqual(43, counts["reviewCards"])
        self.assertEqual(74, counts["minimumDistinctImageCompositions"])
        self.assertEqual(720, counts["baseRuntimeCaptures"])
        self.assertEqual(164, counts["theoreticalExportsBeforeSharingOrPartition"])

    def test_aliases_reuse_twelve_images_without_creating_new_compositions(self):
        targets = image_targets(self.rows)
        original_keys = {t["imageKey"] for t in targets}
        aliases = alias_cards(self.rows)
        alias_keys = {key for card in aliases for key in card["imageKeys"]}
        self.assertEqual(12, len(alias_keys))
        self.assertTrue(alias_keys <= original_keys)
        self.assertEqual(74, len(original_keys | alias_keys))
        self.assertEqual(0, sum(card["newImageCompositions"] for card in aliases))
        self.assertTrue(all(card["requiresAcceptedPublicProfile"] for card in aliases))

    def test_large_exterior_image_never_uses_street_connector(self):
        targets = [t for t in image_targets(self.rows) if t["compositionId"] in LARGE and t["view"] == "exterior"]
        self.assertEqual(8, len(targets))
        self.assertTrue(all(t["sceneKind"] == "local-exterior" for t in targets))

    def test_policy_cannot_authorize_extension_publish_or_inflate_alias_counts(self):
        for key, value in (("extensionAuthorized", True), ("publicationAllowed", True), ("milestone", "A4"),
                           ("pilotOrder", ["C01"]), ("qualities", ["standard"]), ("schemaVersion", True)):
            policy = deepcopy(self.policy)
            policy[key] = value
            with self.assertRaises(ValidationError):
                validate_policy(policy, self.rows)
        policy = deepcopy(self.policy)
        policy["expectedPlanningCounts"]["minimumDistinctImageCompositions"] = 86
        with self.assertRaisesRegex(ValidationError, "aliases"):
            validate_policy(policy, self.rows)

    def test_pilot_batch_retains_all_props_programmes_dimensions(self):
        batch = pilot_jobs(self.rows, self.policy)
        self.assertEqual(list(PILOTS), [j["compositionId"] for j in batch["jobs"]])
        self.assertEqual(["6x10x3.4", "7x10x3.2", "7x10x3.2", "24x36x8"], [j["requirements"]["dimensions_v3_LxPxH_m"] for j in batch["jobs"]])
        self.assertEqual([2, 2, 2, 3], [len(j["requiredSceneKinds"]) for j in batch["jobs"]])
        for job in batch["jobs"]:
            self.assertEqual(next(r for r in self.rows if r["id"] == job["compositionId"]), job["requirements"])
            self.assertEqual("not-authored", job["status"])
        self.assertEqual(8, batch["plannedPilotCanonicalImages"])
        self.assertEqual(80, batch["plannedPilotBaseRuntimeCaptures"])
        self.assertFalse(batch["publicationAllowed"])


class RightsTests(unittest.TestCase):
    def setUp(self):
        self.schema = load_json(ART_ROOT / "release-spec/licenses.schema.json")
        self.row = dict.fromkeys(COLUMNS, "")
        self.row.update(asset_id="synthetic-fixture-only", origin="original", license_cost="0", review_status="pending")
        self.row.update({key: "unknown" for key in RIGHTS})

    def reviewed_fixture(self):
        row = deepcopy(self.row)
        row.update(author_public="Synthetic test author", source_version="test-v1", sha256="a" * 64,
                   license_id="Synthetic-Test-Grant", license_url="https://example.invalid/test-license",
                   reviewed_on="2026-09-17", reviewer_public="Synthetic reviewer", evidence_ref="test-evidence",
                   review_status="reviewed")
        row.update({key: "yes" for key in RIGHTS})
        return row

    def test_empty_ledger_is_a0_valid_but_never_release_ready(self):
        result = validate_rights([], self.schema)
        self.assertEqual(0, result["rows"])
        self.assertFalse(result["releaseAuthorized"])
        self.assertEqual("not-performed-by-tool", result["legalAssessment"])

    def test_pending_unknown_rights_are_honest_but_not_reviewed(self):
        result = validate_rights([self.row], self.schema)
        self.assertEqual(0, result["declaredReviewedRows"])

    def test_declared_review_with_synthetic_evidence_is_not_legal_approval(self):
        result = validate_rights([self.reviewed_fixture()], self.schema)
        self.assertEqual(1, result["declaredReviewedRows"])
        self.assertFalse(result["releaseAuthorized"])

    def test_missing_rights_provenance_or_denied_right_blocks_review(self):
        for key in self.schema["reviewedRequires"]:
            row = self.reviewed_fixture()
            row[key] = ""
            with self.subTest(key=key), self.assertRaises(ValidationError):
                validate_rights([row], self.schema)
        for key in RIGHTS:
            for value in ("no", "unknown"):
                row = self.reviewed_fixture()
                row[key] = value
                with self.subTest(key=key, value=value), self.assertRaises(ValidationError):
                    validate_rights([row], self.schema)

    def test_purchase_private_evidence_signed_urls_and_duplicates_rejected(self):
        for key, value in (("license_cost", "5"), ("origin", "purchased"), ("evidence_ref", "../restricted/test.pdf"),
                           ("source_url", "file:///test"), ("source_url", "https://example.invalid/?token=test"),
                           ("license_url", "https://user:password@example.invalid/license"),
                           ("sha256", "invalid"), ("reviewed_on", "2026-99-99")):
            row = self.reviewed_fixture()
            row[key] = value
            with self.subTest(key=key), self.assertRaises(ValidationError):
                validate_rights([row], self.schema)
        with self.assertRaises(ValidationError):
            validate_rights([self.row, self.row], self.schema)

    def test_third_party_review_requires_exact_source_notice(self):
        row = self.reviewed_fixture()
        row["origin"] = "free-third-party"
        with self.assertRaises(ValidationError):
            validate_rights([row], self.schema)

    def test_schema_cannot_weaken_review(self):
        schema = deepcopy(self.schema)
        schema["reviewedRightsMustBeYes"] = []
        with self.assertRaises(ValidationError):
            validate_rights([], schema)


class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows, cls.policy, _, _ = inputs()
        cls.batch = pilot_jobs(cls.rows, cls.policy)

    def test_stage_writes_only_briefs_and_never_overwrites(self):
        before = (ART_ROOT / "source/canonical36.csv").read_bytes()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            relative = stage_pilots(root, "synthetic-run", self.batch)
            self.assertEqual("build/synthetic-run/job-spec.json", relative)
            self.assertEqual(self.batch, load_json(root / relative))
            self.assertEqual([root / relative], [p for p in root.rglob("*") if p.is_file()])
            with self.assertRaises(FileExistsError):
                stage_pilots(root, "synthetic-run", self.batch)
        self.assertEqual(before, (ART_ROOT / "source/canonical36.csv").read_bytes())

    def test_stage_rejects_traversal_and_build_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "art"
            root.mkdir()
            for run_id in ("../assets", "/assets", "a/b", "a\\b", ".", "", "A", "a" * 65):
                with self.subTest(run_id=run_id), self.assertRaises(ValidationError):
                    stage_pilots(root, run_id, self.batch)
            (root / "build").symlink_to(Path(directory), target_is_directory=True)
            with self.assertRaisesRegex(ValidationError, "symlink"):
                stage_pilots(root, "test", self.batch)

    def test_preflight_missing_blender_never_renders_or_accepts(self):
        runner = Mock()
        with tempfile.TemporaryDirectory() as directory:
            report = preflight(self.rows, self.policy, [], Path(directory), which=lambda _: None, run=runner)
        runner.assert_not_called()
        codes = [b["code"] for b in report["blockers"]]
        self.assertIn("blender-missing", codes)
        self.assertEqual(4, codes.count("pilot-source-missing"))
        self.assertEqual(4, codes.count("pilot-rights-incomplete"))
        self.assertFalse(report["releaseAuthorized"])
        self.assertEqual("blocked", report["status"])

    def test_installed_blender_is_not_a_working_art_pipeline(self):
        runner = Mock(return_value=subprocess.CompletedProcess([], 0, "Blender 4.2.0\n", ""))
        with tempfile.TemporaryDirectory() as directory:
            report = preflight(self.rows, self.policy, [], Path(directory), which=lambda _: "blender", run=runner)
        runner.assert_called_once_with(["blender", "--version"], capture_output=True, text=True, timeout=5, check=False)
        self.assertEqual("4.2.0", report["blender"]["version"])
        self.assertFalse(report["releaseAuthorized"])
        self.assertIn("authoring-export-and-human-review-not-implemented", {b["code"] for b in report["blockers"]})

    def test_blender_timeout_and_bad_version_are_explicit(self):
        for runner, code in ((Mock(side_effect=subprocess.TimeoutExpired("blender", 5)), "blender-probe-failed"),
                             (Mock(return_value=subprocess.CompletedProcess([], 1, "", "failed")), "blender-version-unreadable")):
            with tempfile.TemporaryDirectory() as directory:
                report = preflight(self.rows, self.policy, [], Path(directory), which=lambda _: "blender", run=runner)
            self.assertIn(code, {b["code"] for b in report["blockers"]})

    def test_loaders_reject_unknown_columns_duplicate_keys_and_nan(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic.json"
            for text in ('{"key": 1, "key": 2}', '{"value": NaN}'):
                path.write_text(text)
                with self.assertRaises(ValidationError):
                    load_json(path)
            path.write_text("asset_id,unknown\nfixture,data\n")
            with self.assertRaises(ValidationError):
                load_csv(path, COLUMNS)

    def test_read_only_cli_preserves_inputs_and_reports_exit_codes(self):
        files = [p for p in ART_ROOT.rglob("*") if p.is_file() and "build" not in p.parts and "__pycache__" not in p.parts]
        before = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
        script = ART_ROOT / "source/production.py"
        for command, exit_code in (("validate", 0), ("plan", 0), ("preflight", 2)):
            result = subprocess.run([sys.executable, str(script), command], capture_output=True, text=True, timeout=15)
            self.assertEqual(exit_code, result.returncode, result.stderr)
            report = json.loads(result.stdout)
            self.assertFalse(report["releaseAuthorized"])
        self.assertEqual(before, {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in files})


if __name__ == "__main__":
    unittest.main()
