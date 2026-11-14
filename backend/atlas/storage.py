"""GCS is authoritative for immutable payloads; Firestore transactions select visible versions."""

import hashlib
import json
from typing import Protocol
from uuid import uuid4
from google.api_core.exceptions import AlreadyExists, PreconditionFailed
from google.cloud import firestore, storage
from .config import Settings
from .models import Document, Draft, Trace


class NotFound(Exception):
    pass


class Conflict(Exception):
    pass


class Repository(Protocol):
    def get_document(self, key: str) -> Document: ...
    def save_document(self, doc: Document, data: bytes) -> Document: ...
    def list_documents(self) -> list[Document]: ...
    def save_draft(self, draft: Draft, expected: int) -> Draft: ...
    def get_draft(self, key: str) -> Draft: ...
    def list_drafts(self) -> list[Draft]: ...
    def versions(self, key: str) -> list[Draft]: ...
    def save_trace(self, trace: Trace) -> None: ...
    def list_comparisons(self) -> list[dict]: ...


class GoogleStore:
    def __init__(self, settings: Settings):
        self.db = firestore.Client(project=settings.project_id, database=settings.firestore_database)
        self.bucket = storage.Client(project=settings.project_id).bucket(settings.gcs_bucket)
        self.prefix = settings.firestore_prefix

    def _collection(self, name):
        return self.db.collection(f"{self.prefix}_{name}")

    def _put(self, path, data, content_type):
        try:
            self.bucket.blob(path).upload_from_string(
                data, content_type=content_type, if_generation_match=0, timeout=30
            )
        except PreconditionFailed:
            pass  # Hash-addressed or UUID-identified immutable artifact already exists.

    def _json(self, path):
        return json.loads(self.bucket.blob(path).download_as_bytes(timeout=30))

    def _metadata(self, kind, key):
        snap = self._collection(kind).document(key).get(timeout=20)
        if not snap.exists:
            raise NotFound(f"{kind} record not found")
        return snap.to_dict()

    def get_document(self, key):
        return Document.model_validate(self._json(self._metadata("documents", key)["artifact"]))

    def save_document(self, doc, data):
        if doc.status != "unsupported":
            self._put(f"sources/{doc.id}/original.pdf", data, "application/pdf")
        payload = doc.model_dump_json().encode()
        artifact = f"sources/{doc.id}/extractions/{hashlib.sha256(payload).hexdigest()}.json"
        self._put(artifact, payload, "application/json")
        # First metadata creator wins concurrent uploads, even when filenames differ.
        metadata = doc.model_dump(exclude={"pages", "budget_fields"}) | {"artifact": artifact}
        try:
            self._collection("documents").document(doc.id).create(metadata, timeout=20)
        except AlreadyExists:
            return self.get_document(doc.id)
        return doc

    def list_documents(self):
        metadata = (
            self._collection("documents")
            .order_by("created_at", direction=firestore.Query.DESCENDING)
            .limit(100)
            .stream(timeout=20)
        )
        return [
            Document.model_validate({k: v for k, v in s.to_dict().items() if k != "artifact"})
            for s in metadata
        ]

    def save_draft(self, draft, expected):
        ref = self._collection("drafts").document(draft.id)
        payload = draft.model_dump_json().encode()
        path = f"drafts/{draft.id}/{draft.revision}/{hashlib.sha256(payload).hexdigest()}.json"
        self._put(path, payload, "application/json")
        meta = {
            "artifact": path,
            "revision": draft.revision,
            "updated_at": draft.updated_at,
            "status": draft.status,
            "origin": draft.origin,
            "trace_id": draft.trace_id,
            "approved_at": draft.approved_at,
        }

        @firestore.transactional
        def persist(txn):
            snap = ref.get(transaction=txn, timeout=20)
            version = snap.to_dict()["revision"] if snap.exists else 0
            if version != expected or draft.revision != expected + 1:
                raise Conflict("Draft changed. Reload the latest revision before saving.")
            txn.set(ref, meta)
            txn.create(ref.collection("versions").document(str(draft.revision)), meta)

        persist(self.db.transaction(max_attempts=3))
        return draft

    def get_draft(self, key):
        return Draft.model_validate(self._json(self._metadata("drafts", key)["artifact"]))

    def list_drafts(self):
        snaps = (
            self._collection("drafts")
            .order_by("updated_at", direction=firestore.Query.DESCENDING)
            .limit(50)
            .stream(timeout=20)
        )
        return [Draft.model_validate(self._json(s.to_dict()["artifact"])) for s in snaps]

    def versions(self, key):
        self._metadata("drafts", key)
        snaps = (
            self._collection("drafts")
            .document(key)
            .collection("versions")
            .order_by("revision", direction=firestore.Query.DESCENDING)
            .limit(100)
            .stream(timeout=20)
        )
        return [Draft.model_validate(self._json(s.to_dict()["artifact"])) for s in snaps]

    def save_trace(self, trace):
        payload = trace.model_dump_json().encode()
        path = f"traces/{trace.id}/{hashlib.sha256(payload).hexdigest()}.json"
        self._put(path, payload, "application/json")
        self._collection("traces").document(trace.id).set(
            {
                "artifact": path,
                "request_id": trace.request_id,
                "workflow": trace.workflow,
                "status": trace.status,
                "started_at": trace.started_at,
                "model_calls": trace.model_calls,
            },
            timeout=20,
        )

    def save_comparison(self, record):
        key = record.get("id") or uuid4().hex
        payload = json.dumps(record | {"id": key}, allow_nan=False).encode()
        path = f"comparisons/{key}/{hashlib.sha256(payload).hexdigest()}.json"
        self._put(path, payload, "application/json")
        self._collection("comparisons").document(key).set(
            {"artifact": path, "created_at": record["created_at"]}, timeout=20
        )

    def list_comparisons(self):
        snaps = (
            self._collection("comparisons")
            .order_by("created_at", direction=firestore.Query.DESCENDING)
            .limit(25)
            .stream(timeout=20)
        )
        return [self._json(s.to_dict()["artifact"]) for s in snaps]
