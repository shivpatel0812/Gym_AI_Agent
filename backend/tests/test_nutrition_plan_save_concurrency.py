"""Slow automatic meal ideas must leave the server available for saves."""

import asyncio
import threading
from types import SimpleNamespace

import httpx
from fastapi import FastAPI

from routers import nutrition_plan as routes


def test_save_can_finish_while_meal_idea_is_still_generating(monkeypatch):
    started = threading.Event()
    release = threading.Event()
    plan = {"id": "plan", "version": 1}
    monkeypatch.setattr(routes, "_store", lambda user: SimpleNamespace(get=lambda key: plan))
    monkeypatch.setattr(routes, "resolve_slot_targets", lambda plan: {})
    monkeypatch.setattr(routes, "_recent_macro_entries", lambda *a, **kw: [])
    monkeypatch.setattr(routes, "slot_log_facts", lambda *a: {})
    monkeypatch.setattr(routes, "_apply_patch", lambda user, key, patch: {**plan, **patch})
    monkeypatch.setattr(routes, "apply_slot_targets", lambda plan: plan)

    def slow_ideas(*args, **kwargs):
        started.set()
        release.wait(timeout=3)
        return {"ideas": []}

    monkeypatch.setattr(routes, "suggest_slot_fills", slow_ideas)
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[routes.get_user_id] = lambda: "test-user"

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            idea = asyncio.create_task(client.post(
                "/api/nutrition-plan/plan/suggest-slot",
                json={"slot": "breakfast", "refresh": True},
            ))
            try:
                assert await asyncio.to_thread(started.wait, 2)
                saved = await asyncio.wait_for(client.patch(
                    "/api/nutrition-plan/plan",
                    json={"go_to_items": [{"name": "Yogurt", "days": ["mon"]}]},
                ), timeout=1)
                assert saved.status_code == 200
                assert saved.json()["plan"]["go_to_items"][0]["name"] == "Yogurt"
                assert not idea.done(), "AI generation blocked the save request"
            finally:
                release.set()
                await idea

    asyncio.run(exercise())
