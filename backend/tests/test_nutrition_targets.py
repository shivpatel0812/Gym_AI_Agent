import asyncio
from unittest.mock import MagicMock, patch

import pytest
from nutrition.targets import resolve_targets
from nutrition.plan_store import NutritionPlanStore
from routers import user_profile


def test_manual_targets_override_plan_and_missing_fields_have_defaults():
    assert resolve_targets({"calories": 1800, "water": 0}, {"calories": 2400, "protein": 160}) == {
        "calories": 1800, "protein": 160, "carbs": 240, "fats": 80, "fiber": 30, "water": 0,
    }


def test_plan_read_failure_is_not_no_plan():
    db = MagicMock()
    db.collection.return_value.document.return_value.collection.return_value.limit.return_value.stream.side_effect = RuntimeError("offline")
    with pytest.raises(RuntimeError, match="offline"):
        NutritionPlanStore(db, "user").get_active()


def test_target_write_commits_profile_and_plan_together():
    db = MagicMock()
    profile = db.collection.return_value.document.return_value.collection.return_value.document.return_value
    profile.get.return_value.to_dict.return_value = {"nutrition_targets": {"calories": 2400}}
    plan = {"id": "plan", "version": 4, "targets": {"calories": 2400, "protein": 150}}
    with patch.object(user_profile, "db", db), patch.object(user_profile, "NutritionPlanStore") as store:
        store.return_value.get_active.return_value = plan
        result = asyncio.run(user_profile.update_nutrition_targets(user_profile.NutritionTargetsRequest(calories=1800), "user"))
    batch = db.batch.return_value
    assert result["calories"] == 1800
    assert batch.set.call_args.args[1]["nutrition_targets"]["calories"] == 1800
    assert batch.update.call_args.args[1]["targets"]["calories"] == 1800
    assert batch.update.call_args.args[1]["targets"]["protein"] == 150
    assert batch.update.call_args.args[1]["targets"]["calories_min"] is None
    assert batch.update.call_args.args[1]["targets"]["calories_max"] is None
    assert batch.update.call_args.args[1]["version"] == 5
    batch.commit.assert_called_once()
    profile.set.assert_not_called()


def test_failed_commit_is_not_reported_as_a_successful_target_save():
    db = MagicMock()
    profile = db.collection.return_value.document.return_value.collection.return_value.document.return_value
    profile.get.return_value.to_dict.return_value = {}
    db.batch.return_value.commit.side_effect = RuntimeError("offline")
    with patch.object(user_profile, "db", db), patch.object(user_profile, "NutritionPlanStore") as store:
        store.return_value.get_active.return_value = None
        with pytest.raises(RuntimeError, match="offline"):
            asyncio.run(user_profile.update_nutrition_targets(user_profile.NutritionTargetsRequest(calories=1800), "user"))
