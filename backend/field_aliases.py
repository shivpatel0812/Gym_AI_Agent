"""
Canonical field names for user-logged records.

The two clients diverged on names for the same concepts: the web app writes
`fatigue_level` / `aches_level` / `energy_level` / `stress_level` where the
backend models and the mobile app use `fatigue` / `body_aches` / `energy` /
`level`.

The failure was silent rather than loud. `numeric_values` drops records that
are missing a key, so a web-logged wellness survey did not error — it read as
"never logged", and the coach told users it had no recovery data for them
while they were filling in the form daily.

The clients now agree, but documents written before they converged still
carry the old names. Reads normalize them here, at the fetch boundary, so
every downstream consumer is correct without knowing aliases exist.

Scoped per collection: `level` is only the right target for `stress_level`
inside the stress collection, and a blanket rename would be a guess anywhere
else.
"""

from typing import Any, Dict, Iterable, List

# collection -> {legacy field written by an older web client: canonical field}
LEGACY_ALIASES: Dict[str, Dict[str, str]] = {
    "wellness_survey": {
        "fatigue_level": "fatigue",
        "aches_level": "body_aches",
        "energy_level": "energy",
    },
    "stress": {
        "stress_level": "level",
    },
}


def normalize_record(collection: str, record: Dict[str, Any]) -> Dict[str, Any]:
    """
    Return `record` with any legacy field names copied onto their canonical
    equivalents.

    The canonical value wins when both keys are present: a document written
    after the clients converged is already correct, and a stale duplicate
    left over from an edit must not overwrite it. The legacy key is left in
    place so this stays a read-time projection with nothing to roll back.
    """
    aliases = LEGACY_ALIASES.get(collection)
    if not aliases or not isinstance(record, dict):
        return record

    normalized = dict(record)
    for legacy, canonical in aliases.items():
        if normalized.get(canonical) is None and normalized.get(legacy) is not None:
            normalized[canonical] = normalized[legacy]
    return normalized


def normalize_records(collection: str, records: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Normalize a batch of records from one collection."""
    if collection not in LEGACY_ALIASES:
        return list(records)
    return [normalize_record(collection, r) for r in records]
