"""Structural rights-ledger checks only. Humans verify terms and evidence."""
from datetime import date
import re
from urllib.parse import urlsplit

from registry import load_csv, require

ID = re.compile(r"[a-z0-9][a-z0-9._-]{0,95}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
RIGHTS = ("commercial_use", "modification", "web_redistribution", "extractable_redistribution")
COLUMNS = (
    "asset_id,origin,author_public,source_url,source_version,sha256,license_id,license_url,license_cost,"
    "commercial_use,modification,web_redistribution,extractable_redistribution,review_status,reviewed_on,"
    "reviewer_public,evidence_ref"
).split(",")


def safe_public_url(value):
    try:
        parts = urlsplit(value)
        return parts.scheme == "https" and bool(parts.hostname) and not (
            parts.username or parts.password or parts.query or parts.fragment
        ) and not any(ch.isspace() or ord(ch) < 32 for ch in value)
    except ValueError:
        return False


def validate_rights(rows, schema):
    require(schema["columns"] == COLUMNS, "Unexpected rights schema columns")
    require(schema["reviewedRightsMustBeYes"] == list(RIGHTS), "Rights requirements cannot be weakened")
    require(schema["reviewedRequires"] == ["author_public", "source_version", "sha256", "license_id", "license_url", "reviewed_on", "reviewer_public", "evidence_ref"], "Review provenance requirements cannot be weakened")
    expected_enums = {
        "origin": ["original", "free-third-party"], "license_cost": ["0"],
        **{key: ["yes", "no", "unknown"] for key in RIGHTS},
        "review_status": ["pending", "reviewed", "rejected"],
    }
    require(schema["enums"] == expected_enums, "Unexpected rights schema enumerations")
    ids = set()
    for row in rows:
        require(set(row) == set(COLUMNS) and all(isinstance(v, str) for v in row.values()), "Invalid rights row")
        aid = row["asset_id"]
        require(ID.fullmatch(aid) and aid not in ids, "Invalid or duplicate rights asset_id")
        ids.add(aid)
        for column, values in expected_enums.items():
            require(row[column] in values, f"{aid}: invalid {column}")
        for column in ("source_url", "license_url"):
            require(not row[column] or safe_public_url(row[column]), f"{aid}: {column} must be a public HTTPS notice, without credentials/query")
        require(not row["sha256"] or SHA256.fullmatch(row["sha256"]), f"{aid}: malformed SHA-256")
        require(not row["evidence_ref"] or ID.fullmatch(row["evidence_ref"]), f"{aid}: use opaque evidence ID, never a private path or URL")
        if row["reviewed_on"]:
            require(re.fullmatch(r"\d{4}-\d{2}-\d{2}", row["reviewed_on"]), f"{aid}: invalid review date format")
            try:
                date.fromisoformat(row["reviewed_on"])
            except ValueError:
                require(False, f"{aid}: invalid review date")
        if row["review_status"] == "reviewed":
            require(all(row[key].strip() for key in schema["reviewedRequires"]), f"{aid}: review provenance incomplete")
            require(all(row[key] == "yes" for key in RIGHTS), f"{aid}: all four rights must be verified separately")
            require(row["origin"] != "free-third-party" or row["source_url"], f"{aid}: exact free-resource source URL required")
    return {"rows": len(rows), "declaredReviewedRows": sum(r["review_status"] == "reviewed" for r in rows),
            "legalAssessment": "not-performed-by-tool", "releaseAuthorized": False}


def load_rights(path, schema):
    rows = load_csv(path, COLUMNS)
    return rows, validate_rights(rows, schema)
