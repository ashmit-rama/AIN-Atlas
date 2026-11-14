"""Synthetic local API and persistence contract tests; never use credentials or cloud APIs."""

import io
from unittest.mock import MagicMock
import pytest
from fastapi.testclient import TestClient
from google.api_core.exceptions import AlreadyExists, PreconditionFailed
from pydantic import ValidationError
from reportlab.pdfgen.canvas import Canvas
from atlas import storage
from atlas.config import Settings
from atlas.documents import build_evidence, extract_pdf, reconcile_budget, validate_result
from atlas.main import create_app
from atlas.models import Citation, Draft, GenerateRequest, GenerationOutput, InvestmentResult, Trace
from atlas.storage import Conflict, GoogleStore, NotFound


def pdf(*pages):
    out = io.BytesIO()
    canvas = Canvas(out, invariant=True)
    for page in pages:
        y = 780
        for line in page.splitlines():
            canvas.drawString(30, y, line)
            y -= 15
        canvas.showPage()
    canvas.save()
    return out.getvalue()


@pytest.fixture
def cfg():
    return Settings(
        _env_file=None,
        project_id="test-project",
        gcs_bucket="test-bucket",
        location="test-region",
        model="test-model",
    )


class FakeStore:
    def __init__(self):
        self.docs, self.drafts, self.history, self.traces = {}, {}, {}, {}

    def get_document(self, key):
        if key not in self.docs:
            raise NotFound()
        return self.docs[key]

    def save_document(self, doc, data):
        return self.docs.setdefault(doc.id, doc)

    def list_documents(self):
        return list(self.docs.values())

    def get_draft(self, key):
        if key not in self.drafts:
            raise NotFound()
        return self.drafts[key]

    def save_draft(self, draft, expected):
        current = self.drafts.get(draft.id)
        if (current.revision if current else 0) != expected:
            raise Conflict()
        self.drafts[draft.id] = draft
        self.history.setdefault(draft.id, []).append(draft)
        return draft

    def list_drafts(self):
        return list(self.drafts.values())

    def versions(self, key):
        return self.history[key]

    def save_trace(self, trace):
        self.traces[trace.id] = trace

    def list_comparisons(self):
        return []


def result():
    return InvestmentResult.model_validate(
        {
            "map": {
                "nodes": [
                    {
                        "id": "n1",
                        "kind": "capability",
                        "label": "Proposed depot",
                        "text": "Evidence is needed.",
                        "classification": "unknown",
                    }
                ]
            },
            "explanation": {
                "title": "Proposal",
                "statements": [{"text": "Ownership is unknown.", "classification": "unknown"}],
            },
        }
    )


async def gen(req, packet, cfg):
    r = result()
    r.budget_checks = packet.budget_checks
    return GenerationOutput(
        result=r,
        trace=Trace(
            id="synthetic-run",
            request_id="test",
            workflow=req.workflow,
            status="succeeded",
            latency_ms=1,
            model="synthetic",
            model_calls=1,
        ),
    )


def test_extract_preserves_pages_checks_both_currency_ranges_and_flags_gaps(cfg):
    data = pdf(
        "EST. (FCFA) EST. (USD)\nSous-total Phase 1 2 - 4 M $3k - $5k",
        "EST. (FCFA) EST. (USD)\nSous-total Phase 2 5 - 8 M $2k - $4k\nGrand total 9 M - 15 M FCFA $5,000 - $9,000",
    )
    doc = extract_pdf(data, "../../synthetic.pdf", cfg)
    assert (doc.status, doc.page_count, doc.filename) == ("ready", 2, "synthetic.pdf")
    assert [p.page for p in doc.pages] == [1, 2]
    check = {c.currency: c for c in reconcile_budget([doc])}
    assert check["FCFA"].status == "conflict" and check["USD"].status == "reconciled"
    assert check["FCFA"].subtotal_sum == "7000000–12000000"
    assert check["FCFA"].difference == "2000000–3000000"
    assert check["FCFA"].fields[-1].citation.page == 2
    assert extract_pdf(pdf(""), "scan.pdf", cfg).status == "extraction_failed"
    assert (
        extract_pdf(data, "synthetic.pdf", cfg.model_copy(update={"max_pdf_pages": 1})).status
        == "extraction_failed"
    )
    assert extract_pdf(b"oops", "fake.pdf", cfg).status == "unsupported"
    assert extract_pdf(b"%PDF-damaged", "bad.pdf", cfg).status == "malformed"


def test_calculations_keep_distinct_documents_and_fail_on_missing_phases(cfg):
    a = extract_pdf(pdf("EST FCFA\nSous-total Phase 1 10-15 M FCFA"), "A.pdf", cfg)
    b = extract_pdf(pdf("Grand total 16-18 M FCFA"), "B.pdf", cfg)
    assert all(c.status == "incomplete" for c in reconcile_budget([a, b]))
    c = extract_pdf(pdf("Phase 2 subtotal 2-3 M FCFA\nGrand total 2-3 M FCFA"), "C.pdf", cfg)
    assert reconcile_budget([c])[0].status == "incomplete"


def test_mechanical_validation_and_translations(cfg):
    orig = extract_pdf(pdf("Une proposition documentee."), "original.pdf", cfg)
    derived = extract_pdf(pdf("A documented proposal."), "translation.pdf", cfg)
    derived.derived_from = orig.id
    derived.source_page_map = {"1": [1]}
    req = GenerateRequest(question="Infrastructure?")
    packet = build_evidence(req, [orig, derived])
    claim = result()
    statement = claim.explanation.statements[0]
    statement.classification = "document_supported"
    with pytest.raises(ValueError, match="require citations"):
        validate_result(claim, packet, req)
    statement.citations = [Citation(document_id=derived.id, page=1)]
    with pytest.raises(ValueError, match="mapped original"):
        validate_result(claim, packet, req)
    statement.citations.append(Citation(document_id=orig.id, page=1, quote="Une proposition"))
    assert validate_result(claim, packet, req) is claim
    statement.citations[-1].quote = "Fabricated quotation"
    with pytest.raises(ValueError, match="quotation"):
        validate_result(claim, packet, req)
    statement.citations = [Citation(document_id=orig.id, page=99)]
    with pytest.raises(ValueError, match="outside"):
        validate_result(claim, packet, req)
    statement.classification = "calculation"
    with pytest.raises(ValueError, match="deterministic"):
        validate_result(claim, packet, req)
    with pytest.raises(ValidationError):
        InvestmentResult(map={"nodes": []}, explanation={"title": "Title", "statements": []})
    material = result().model_dump()
    material["map"]["edges"] = [{"id": "e", "source": "n1", "target": "unseen", "relationship": "funds"}]
    with pytest.raises(ValidationError, match="existing nodes"):
        InvestmentResult.model_validate(material)


def test_http_generate_approve_edit_recover_and_conflict(cfg):
    store = FakeStore()
    client = TestClient(create_app(cfg, store, gen))
    data = pdf("Fictional support document.")
    doc = client.post("/api/documents", files={"file": ("A.pdf", data, "application/pdf")}).json()
    again = client.post(
        "/api/documents", files={"file": ("another name.pdf", data, "application/pdf")}
    ).json()
    assert doc["id"] == again["id"] and len(store.docs) == 1
    generation = client.post(
        "/api/generate", json={"question": "Is there evidence?", "document_ids": [doc["id"]]}
    )
    assert generation.status_code == 200, generation.text
    draft = generation.json()
    path = "/api/drafts/" + draft["id"]
    assert draft["revision"] == 1 and draft["status"] == "draft"
    assert store.traces[draft["trace_id"]].request_id == generation.headers["x-request-id"]
    approved = client.post(path + "/approve", json={"expected_revision": 1}).json()
    assert approved["revision"] == 2 and approved["status"] == "approved" and approved["approved_at"]
    draft["result"]["map"]["nodes"][0]["label"] = "Edited proposal"
    assert client.put(path, json={"expected_revision": 1, "result": draft["result"]}).status_code == 409
    edit = client.put(path, json={"expected_revision": 2, "result": draft["result"]}).json()
    assert (
        edit["revision"] == 3
        and edit["status"] == "draft"
        and not edit["approved_at"]
        and edit["origin"] == "human_edited"
    )
    versions = client.get(path + "/versions").json()
    assert len(versions) == 3 and versions[0]["result"]["map"]["nodes"][0]["label"] == "Proposed depot"
    assert client.get(path).json() == edit
    draft["result"]["map"]["nodes"][0]["classification"] = "document_supported"
    assert client.put(path, json={"expected_revision": 3, "result": draft["result"]}).status_code == 422
    assert client.get("/api/comparisons").json() == []


def test_upload_provenance_limits_origin_and_unconfigured(cfg):
    store = FakeStore()
    client = TestClient(create_app(cfg, store))

    def upload(f, data=None):
        return client.post(
            "/api/documents", files={"file": ("example.pdf", pdf(f), "application/pdf")}, data=data or {}
        )

    orig = upload("Original").json()
    assert (
        upload("Translation", {"derived_from": orig["id"], "source_page_map": '{"1":[9]}'}).status_code == 422
    )
    translated = upload(
        "Translation", {"derived_from": orig["id"], "source_page_map": '{"1":[1]}', "source_language": "en"}
    ).json()
    assert translated["derived_from"] == orig["id"] and translated["source_page_map"] == {"1": [1]}
    assert (
        client.post("/api/documents", files={"file": ("bad.txt", b"file", "text/plain")}).status_code == 415
    )
    assert (
        client.post(
            "/api/generate", json={"question": "q"}, headers={"Origin": "https://evil.invalid"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/documents",
            files={"file": ("a.pdf", b"pdf", "application/pdf")},
            headers={"Sec-Fetch-Site": "cross-site"},
        ).status_code
        == 403
    )
    small = TestClient(create_app(cfg.model_copy(update={"max_upload_bytes": 1024}), store))
    assert (
        small.post(
            "/api/documents", files={"file": ("large.pdf", b"0" * 4096, "application/pdf")}
        ).status_code
        == 413
    )
    assert (
        small.post(
            "/api/documents", files={"file": ("large.pdf", b"0" * 70000, "application/pdf")}
        ).status_code
        == 413
    )
    empty = TestClient(
        create_app(Settings(_env_file=None, project_id="", gcs_bucket="", location="", model=""))
    )
    assert empty.get("/healthz").status_code == 200 and not empty.get("/api/config").json()["configured"]
    res = empty.post("/api/generate", json={"question": "Q"})
    assert res.status_code == 503 and "ATLAS_PROJECT_ID" in res.json()["detail"]["message"]
    assert res.json()["detail"]["request_id"] == res.headers["x-request-id"]


def test_real_google_adapter_uses_immutable_uploads_and_conditional_transaction(cfg, monkeypatch):
    db = MagicMock()
    bucket = MagicMock()
    blobs = {}
    metadata = {}
    writes = []

    def make_blob(path):
        blob = MagicMock()

        def upload(data, *, content_type, if_generation_match, timeout):
            assert if_generation_match == 0
            if path in blobs:
                raise PreconditionFailed("immutable")
            blobs[path] = data

        blob.upload_from_string.side_effect = upload
        blob.download_as_bytes.side_effect = lambda **kw: blobs[path]
        return blob

    bucket.blob.side_effect = make_blob

    def ref_for(path):
        ref = MagicMock()
        ref.path = path

        def get(**kw):
            snap = MagicMock()
            snap.exists = path in metadata
            snap.to_dict.return_value = metadata.get(path)
            return snap

        ref.get.side_effect = get

        def create(meta, **kw):
            if path in metadata:
                raise AlreadyExists("already stored")
            metadata[path] = meta

        ref.create.side_effect = create
        ref.collection.side_effect = lambda sub: collection(path + "/" + sub)
        return ref

    def collection(prefix):
        c = MagicMock()
        c.document.side_effect = lambda k: ref_for(prefix + "/" + k)
        return c

    db.collection.side_effect = collection
    db.transaction.return_value = MagicMock()

    def transact(fn):
        def run(txn):
            writes.clear()
            txn.set.side_effect = lambda ref, data: writes.append((ref.path, data))
            txn.create.side_effect = lambda ref, data: writes.append((ref.path, data))
            fn(txn)
            metadata.update(writes)

        return run

    monkeypatch.setattr(storage.firestore, "transactional", transact)
    monkeypatch.setattr(storage.firestore, "Client", lambda **kw: db)
    monkeypatch.setattr(storage.storage, "Client", lambda **kw: MagicMock(bucket=lambda name: bucket))
    adapter = GoogleStore(cfg)
    data = pdf("Synthetic only.")
    d = extract_pdf(data, "synthetic.pdf", cfg)
    assert adapter.save_document(d, data) == d
    assert (
        adapter.save_document(d.model_copy(update={"filename": "different.pdf"}), data).filename
        == "synthetic.pdf"
    )
    assert len([path for path in blobs if path.endswith(".pdf")]) == 1
    draft = Draft(id="d1", request=GenerateRequest(question="Synthetic?"), result=result(), trace_id="t1")
    adapter.save_draft(draft, 0)
    approved = draft.model_copy(update={"revision": 2, "status": "approved", "approved_at": "test"})
    adapter.save_draft(approved, 1)
    with pytest.raises(Conflict):
        adapter.save_draft(draft.model_copy(update={"revision": 2, "status": "draft"}), 1)
    assert adapter.get_draft("d1").status == "approved"
    assert (
        metadata["atlas_drafts/d1/versions/1"]["artifact"]
        != metadata["atlas_drafts/d1/versions/2"]["artifact"]
    )
    assert len([k for k in metadata if "/versions/" in k]) == 2


def test_failed_workflow_trace_safe_errors_and_proxy_origin(cfg):
    from atlas.workflows import WorkflowError

    async def failing(req, packet, cfg):
        trace = Trace(
            id="fake-failure",
            request_id="test",
            workflow=req.workflow,
            status="failed",
            latency_ms=5,
            model="synthetic",
            model_calls=1,
            error="PermissionDenied",
        )
        raise WorkflowError("Vertex AI access was denied; check configured permissions", trace)

    store = FakeStore()
    app = TestClient(create_app(cfg, store, failing))
    response = app.post(
        "/api/generate",
        headers={
            "Origin": "http://127.0.0.1:8080",
            "Sec-Fetch-Site": "same-origin",
            "Host": "synthetic-service.invalid",
        },
        json={"question": "A synthetic question"},
    )
    assert response.status_code == 502
    assert "Vertex AI access was denied" in response.json()["detail"]["message"]
    assert "fake-failure" in response.json()["detail"]["message"]
    assert store.traces["fake-failure"].request_id == response.headers["x-request-id"]
    assert not store.drafts
