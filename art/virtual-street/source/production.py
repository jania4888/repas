#!/usr/bin/env python3
"""A0 offline CLI: validate requirements, stage four briefs, report DCC blockers.

Never renders, downloads, copies to public assets, promotes or authorizes a release.
"""
import argparse
import json
import re
import shutil
import subprocess
import sys

from registry import (ALIASES, ART_ROOT, LARGE, PILOTS, STYLES, ValidationError,
                      accounting, alias_cards, image_targets, load_json,
                      load_registry, require)
from rights import load_rights


def validate_policy(policy, rows):
    require(type(policy["schemaVersion"]) is int and policy["schemaVersion"] == 1,
            "Offline requirements schema must be 1 (not runtime manifest schema 2)")
    require(policy["kind"] == "offline-production-requirements" and policy["milestone"] == "A0", "Not an A0 production specification")
    require(policy["publicationAllowed"] is False and policy["extensionAuthorized"] is False,
            "A0 tooling cannot publish or authorize the remaining 32")
    require(policy["productionScope"] == "four-pilots-only" and policy["pilotOrder"] == list(PILOTS), "Only the four approved pilots may be staged")
    require(policy["extensionGate"] == "written-human-review-of-all-four-real-pilots", "Four-pilot human stop is mandatory")
    require(policy["styles"] == list(STYLES) and policy["qualities"] == ["economy", "standard"], "Five styles and two qualities required")
    require(policy["aliases"] == ALIASES, "Aliases must reuse their six other compositions")
    require(policy["global"]["profileKeyProposed"] == "vp-neutral-global" and policy["global"]["editorialRevisionProposed"] == "r1", "Global identity mismatch")
    require(policy["global"]["dimensionsProposedLxPxHMetres"] == [6, 8, 3.2], "Global proposed metric changed")
    require(policy["global"]["renderKeys"] == [f"vp-neutral-global-r1-{view}" for view in ("exterior", "interior")], "Global requires two separate image targets")
    counts = policy["expectedPlanningCounts"]
    require(all(type(v) is int for v in counts.values()) and counts == accounting(rows), "Planning counts mismatch (aliases are not new images)")
    require(policy["toolchain"]["runtimeTarget"] == "three/161", "Runtime target must stay Three r161")
    require(policy["dcc"]["lightmap"] == {"gltfSemantic": "TEXCOORD_1", "threeAttribute": "uv1", "channel": 1}, "Use r161 uv1 and channel 1, not legacy uv2")


def inputs(root=ART_ROOT):
    rows = load_registry(root)
    policy = load_json(root / "release-spec/production-policy.json")
    validate_policy(policy, rows)
    rights, rights_summary = load_rights(root / "licenses.csv", load_json(root / "release-spec/licenses.schema.json"))
    return rows, policy, rights, rights_summary


def pilot_jobs(rows, policy):
    by_id = {row["id"]: row for row in rows}
    jobs = []
    for cid in PILOTS:
        row = by_id[cid]
        identity = f'{row["profil_public_propose"]}/{row["revision_editoriale"]}'
        jobs.append({
            "compositionId": cid, "status": "not-authored", "requirements": row,
            "sourceToAuthor": f"source/profiles/{identity}/scene.blend",
            "requiredSourceRightsId": f'source-{row["profil_public_propose"]}-r1',
            "requiredSceneKinds": ["street-connector", "interior"] + (["local-exterior"] if cid in LARGE else []),
            "stylesRequired": policy["styles"], "qualitiesRequired": policy["qualities"],
            "canonicalImageTargets": [t for t in image_targets([row]) if t["compositionId"] == cid],
            "sourceProvenanceRequired": ["author", "date", "blenderVersion", "gltfExporterVersion", "scriptCommit", "proceduralSeed", "dependencyRightsIds", "sourceSha256"],
            "evidenceRequiredLater": ["editable-source", "exact-export-hashes", "rights-review", "offline-renders", "r161-runtime-captures", "navigation-and-collisions", "measured-budgets", "human-art-and-business-review"],
        })
    return {
        "schemaVersion": 1, "kind": "authoring-brief-batch", "milestone": "A0",
        "status": "requirements-only-not-models", "publicationAllowed": False,
        "productionScope": "four-pilots-only", "jobs": jobs,
        "dccRequirements": policy["dcc"], "subBudgetsProposed": policy["subBudgetsProposed"],
        "navigationProposedMetres": policy["navigationProposedMetres"],
        "plannedPilotCanonicalImages": 8, "plannedPilotBaseRuntimeCaptures": 80,
        "completionAssessment": "not-performed",
        "nextGate": "STOP after all four real pilots; written human decision required before remaining 32",
    }


def stage_pilots(root, run_id, batch):
    """Exclusive, local staging of requirements; no arbitrary destination option."""
    require(re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", run_id) is not None, "Invalid run ID")
    build = root / "build"
    require(not build.is_symlink(), "Staging build directory must not be a symlink")
    build.mkdir(exist_ok=True)
    require(build.resolve().parent == root.resolve(), "Staging escaped the offline art root")
    stage = build / run_id
    # mkdir fails on existing directories/files/symlinks: never overwrite a staged run.
    stage.mkdir()
    # On write failure keep work for inspection; do not delete user artifacts.
    with (stage / "job-spec.json").open("x", encoding="utf-8") as stream:
        json.dump(batch, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    return f"build/{run_id}/job-spec.json"


def preflight(rows, policy, rights, root=ART_ROOT, which=shutil.which, run=subprocess.run):
    """Probe Blender presence/version only; all modelling/export execution is deferred."""
    blockers = []
    binary = which("blender")
    blender = {"available": binary is not None, "version": None}
    if binary is None:
        blockers.append({"code": "blender-missing", "detail": "Blender is not on PATH; dependency provisioning belongs to the main agent/operator."})
    else:
        try:
            result = run([binary, "--version"], capture_output=True, text=True, timeout=5, check=False)
            first = result.stdout.splitlines()[0] if result.stdout else ""
            match = re.fullmatch(r"Blender (\d+\.\d+\.\d+)(?: .*)?", first)
            if result.returncode or not match:
                blockers.append({"code": "blender-version-unreadable", "detail": "Blender --version did not return a recognized version."})
            else:
                blender["version"] = match.group(1)
        except (OSError, subprocess.TimeoutExpired):
            blockers.append({"code": "blender-probe-failed", "detail": "Blender --version failed or exceeded 5 seconds."})
    toolchain = policy["toolchain"]
    if not toolchain["blenderVersion"] or not toolchain["gltfExporterVersion"]:
        blockers.append({"code": "toolchain-unpinned", "detail": "Pin and qualify Blender/exporter with real pilot exports before reproducibility claims."})
    if toolchain["blenderVersion"] and blender["version"] != toolchain["blenderVersion"]:
        blockers.append({"code": "blender-version-mismatch", "detail": "Installed Blender does not match the pinned version."})
    rights_by_id = {row["asset_id"]: row for row in rights}
    for job in pilot_jobs(rows, policy)["jobs"]:
        source = root / job["sourceToAuthor"]
        if not source.is_file():
            blockers.append({"code": "pilot-source-missing", "compositionId": job["compositionId"]})
        elif source.is_symlink() or not source.resolve().is_relative_to((root / "source").resolve()):
            blockers.append({"code": "pilot-source-not-confined", "compositionId": job["compositionId"]})
        row = rights_by_id.get(job["requiredSourceRightsId"])
        if row is None or row["review_status"] != "reviewed":
            blockers.append({"code": "pilot-rights-incomplete", "compositionId": job["compositionId"]})
    # Presence and declared reviews alone cannot close A0/A1 or any release gate.
    blockers.append({"code": "authoring-export-and-human-review-not-implemented", "detail": "This A0 entrypoint prepares briefs only. Real source/export dependency checks, rights evidence, four-pilot review and release gates remain mandatory."})
    return {"kind": "offline-preflight", "status": "blocked", "blender": blender,
            "blockers": blockers, "modelAssessment": "not-performed", "legalAssessment": "not-performed",
            "performanceAssessment": "not-performed", "releaseAuthorized": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("validate", help="Validate A0 inputs only, not assets or acceptance")
    commands.add_parser("plan", help="Print counts, target identities and 43 review-card references")
    commands.add_parser("preflight", help="Report DCC blockers without rendering; exit 2 while blocked")
    stage = commands.add_parser("stage-pilots", help="Write four authoring briefs to a new ignored build run")
    stage.add_argument("--run-id", required=True)
    args = parser.parse_args(argv)
    try:
        rows, policy, rights, rights_summary = inputs()
        if args.command == "preflight":
            output = preflight(rows, policy, rights)
        elif args.command == "stage-pilots":
            relative = stage_pilots(ART_ROOT, args.run_id, pilot_jobs(rows, policy))
            output = {"status": "briefs-staged-not-assets", "jobSpec": relative, "releaseAuthorized": False}
        else:
            output = {"status": "a0-inputs-valid-not-release-ready", "plannedCounts": accounting(rows),
                      "rightsLedger": rights_summary, "completionAssessment": "not-performed", "releaseAuthorized": False}
            if args.command == "plan":
                output.update({"canonicalImageTargets": image_targets(rows), "aliasReviewCards": alias_cards(rows),
                               "specializedReviewCards": [r["id"] for r in rows], "globalReviewCard": "global",
                               "pilotAuthoringBatch": pilot_jobs(rows, policy)})
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 2 if args.command == "preflight" else 0
    except (ValidationError, OSError, ValueError, KeyError, TypeError, RecursionError) as error:
        print(json.dumps({"status": "invalid-a0-input", "error": str(error), "releaseAuthorized": False}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
