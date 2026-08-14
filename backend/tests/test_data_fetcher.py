from unittest.mock import MagicMock

from ai_analysis.workout_recommender.data_fetcher import DataFetcher


def test_user_profile_uses_canonical_profile_document():
    db = MagicMock()
    users = MagicMock()
    user = MagicMock()
    profiles = MagicMock()
    profile = MagicMock()
    profile.exists = True
    profile.to_dict.return_value = {"top_lifts": {"bench_press": 225}}

    db.collection.return_value = users
    users.document.return_value = user
    user.collection.return_value = profiles
    profiles.document.return_value.get.return_value = profile

    result = DataFetcher(db, "user-1").get_user_profile()

    db.collection.assert_called_once_with("users")
    users.document.assert_called_once_with("user-1")
    user.collection.assert_called_once_with("user_profile")
    profiles.document.assert_called_once_with("profile")
    assert result["top_lifts"]["bench_press"] == 225
