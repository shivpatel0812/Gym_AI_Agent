"""
One-time migration: write canonical field names onto legacy documents.

Backfills `fatigue` / `body_aches` / `energy` / `level` onto wellness_survey
and stress documents that only carry the old web-app names. Reads already
work without this — `field_aliases.normalize_records` projects legacy names
at the fetch boundary — so this is cleanup that lets the read-time shim be
deleted later, not a fix for broken reads.

Additive and idempotent: it only ever sets a canonical field that is absent
or None, never overwrites one, and never deletes the legacy field. Running
it twice changes nothing the second time.

    python3 scripts/migrate_wellness_field_names.py                 # dry run
    python3 scripts/migrate_wellness_field_names.py --user <uid>    # one user
    python3 scripts/migrate_wellness_field_names.py --apply         # write
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from field_aliases import LEGACY_ALIASES  # noqa: E402


def plan_updates(doc_data, aliases):
    """Return only the fields that need writing for one document."""
    updates = {}
    for legacy, canonical in aliases.items():
        if doc_data.get(canonical) is None and doc_data.get(legacy) is not None:
            updates[canonical] = doc_data[legacy]
    return updates


def migrate(db, apply_changes=False, only_user=None):
    users = (
        [db.collection("users").document(only_user)]
        if only_user
        else list(db.collection("users").list_documents())
    )
    print(f"Scanning {len(users)} user(s); mode = {'APPLY' if apply_changes else 'DRY RUN'}\n")

    totals = {"scanned": 0, "changed": 0}
    for user_ref in users:
        for collection, aliases in LEGACY_ALIASES.items():
            for doc in user_ref.collection(collection).stream():
                totals["scanned"] += 1
                updates = plan_updates(doc.to_dict() or {}, aliases)
                if not updates:
                    continue
                totals["changed"] += 1
                print(f"  {user_ref.id}/{collection}/{doc.id}: {updates}")
                if apply_changes:
                    doc.reference.update(updates)

    print(
        f"\nScanned {totals['scanned']} document(s); "
        f"{totals['changed']} need(s) backfill."
    )
    if totals["changed"] and not apply_changes:
        print("Nothing was written. Re-run with --apply to commit.")
    return totals


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    parser.add_argument("--user", help="limit to a single user id")
    args = parser.parse_args()

    from db import db  # imported here so --help works without credentials

    migrate(db, apply_changes=args.apply, only_user=args.user)
