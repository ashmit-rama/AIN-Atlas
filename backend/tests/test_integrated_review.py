"""Cross-boundary test: genuine HTTP handling, extraction, ADK tools, and founder decisions."""

from fastapi.testclient import TestClient
from atlas import workflows
from atlas.config import Settings
from atlas.main import create_app
from test_backend import FakeStore, pdf
from test_workflows import ScriptedLlm


def test_document_to_review_through_adk(monkeypatch):
    store = FakeStore()
    cfg = Settings(project_id="offline", location="test", model="synthetic", gcs_bucket="test")
    monkeypatch.setattr(workflows, "_model", lambda settings: ScriptedLlm(model="synthetic"))
    with TestClient(create_app(cfg, store)) as browser:
        source = browser.post(
            "/api/documents",
            files={"file": ("fictional.pdf", pdf("A training room is proposed."), "application/pdf")},
        ).json()
        citation = {"document_id": source["id"], "page": 1, "quote": "A training room is proposed."}
        point = {
            "text": "The source proposes a training room.",
            "classification": "document_supported",
            "citations": [citation],
        }
        authored = {
            "map": {"nodes": [dict(point, id="room", kind="expenditure", label="Proposed training room")]},
            "explanation": {"title": "Training proposal", "statements": [point]},
        }
        ScriptedLlm.script = [("set", authored, True)]
        response = browser.post(
            "/api/generate", json={"question": "Which room is proposed?", "document_ids": [source["id"]]}
        )
        assert response.status_code == 200, response.text
        draft = response.json()
        path = "/api/drafts/" + draft["id"]
        assert store.traces[draft["trace_id"]].model_calls == 1 and not ScriptedLlm.script
        assert draft["result"]["explanation"]["statements"][0]["citations"] == [citation]
        assert browser.post(path + "/approve", json={"expected_revision": 1}).json()["status"] == "approved"
        draft["result"]["explanation"]["statements"][0]["text"] = "A training room is under consideration."
        assert browser.put(path, json={"expected_revision": 2, "result": draft["result"]}).status_code == 200
        reloaded = browser.get(path).json()
        assert reloaded["revision"] == 3 and reloaded["status"] == "draft" and reloaded["approved_at"] is None
        assert "explanation.statements.0.text" in reloaded["edited_fields"]
