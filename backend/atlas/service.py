"""Application state lives here, independently of each model conversation."""

import hashlib
import re
from uuid import uuid4
from anyio import to_thread
from .config import Settings
from .documents import build_evidence, extract_pdf, validate_result
from .models import ApprovalRequest, Draft, DraftUpdate, GenerateRequest, now
from .storage import Conflict, NotFound, Repository


def storage_key(value):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", value):
        raise ValueError("Invalid record identifier")
    return value


def ingest(
    store: Repository,
    data: bytes,
    filename: str,
    settings: Settings,
    source_language="undetermined",
    derived_from=None,
    source_page_map=None,
):
    if len(data) > settings.max_upload_bytes:
        raise ValueError("PDF exceeds upload size limit")
    key = hashlib.sha256(data).hexdigest()
    mapping = source_page_map or {}
    try:
        existing = store.get_document(key)
    except NotFound:
        existing = None
    if existing:
        if (derived_from and derived_from != existing.derived_from) or (
            mapping and mapping != existing.source_page_map
        ):
            raise Conflict(
                "These exact bytes already have different provenance. Review the existing source record."
            )
        return existing
    document = extract_pdf(data, filename, settings)
    document.source_language = source_language.strip()[:100] or "undetermined"
    if mapping and not derived_from:
        raise ValueError("A translation page map requires an original document ID")
    if derived_from:
        if key == derived_from:
            raise ValueError("A translation cannot cite itself as its original")
        original = store.get_document(storage_key(derived_from))
        if original.derived_from or original.status != "ready":
            raise ValueError("Supply an extracted original document, not another translation")
        if not mapping:
            raise ValueError("Supply a reviewed translation-page to original-page map")
        for page, sources in mapping.items():
            if (
                not isinstance(page, str)
                or not page.isdecimal()
                or not 1 <= int(page) <= document.page_count
                or not isinstance(sources, list)
                or not sources
                or any(type(p) is not int or not 1 <= p <= original.page_count for p in sources)
            ):
                raise ValueError("Translation mapping contains an invalid source or translation page")
        document.derived_from, document.source_page_map = derived_from, mapping
    stored = store.save_document(document, data)
    if stored.derived_from != document.derived_from or stored.source_page_map != document.source_page_map:
        raise Conflict(
            "A concurrent upload recorded different provenance. Review the existing source record."
        )
    return stored


def packet_for(store: Repository, request: GenerateRequest):
    docs = {}
    for key in dict.fromkeys(request.document_ids):
        doc = store.get_document(storage_key(key))
        if doc.status != "ready":
            raise ValueError(f"Document {doc.filename} is not ready: {doc.status}")
        docs[doc.id] = doc
        if doc.derived_from and doc.derived_from not in docs:
            docs[doc.derived_from] = store.get_document(doc.derived_from)
    return build_evidence(request, list(docs.values()))


async def generate_draft(
    store: Repository, settings: Settings, request: GenerateRequest, request_id: str, generator
):
    if not request.question.strip():
        raise ValueError("Investor question cannot be blank")
    packet = await to_thread.run_sync(packet_for, store, request)
    try:
        output = await generator(request, packet, settings)
        output.trace.request_id = request_id
        validate_result(output.result, packet, request)
    except Exception as exc:
        trace = getattr(exc, "trace", None)
        if trace is None and "output" in locals():
            trace = output.trace
            trace.status = "failed"
            trace.error = "Output did not pass final application validation"
        if trace:
            trace.request_id = request_id
            await to_thread.run_sync(store.save_trace, trace)
        raise
    await to_thread.run_sync(store.save_trace, output.trace)
    if output.trace.reviews:
        # Only share the structured action items, never full internal traces or conversations.
        latest = output.trace.reviews[-1]
        findings = [f"Reviewer: {item}" for item in latest.get("findings", []) if isinstance(item, str)]
        output.result.warnings = list(dict.fromkeys([*findings, *output.result.warnings]))[:30]
    draft = Draft(id=uuid4().hex, request=request, result=output.result, trace_id=output.trace.id)
    return await to_thread.run_sync(store.save_draft, draft, 0)


def edit_draft(store: Repository, key: str, update: DraftUpdate):
    current = store.get_draft(storage_key(key))
    if current.revision != update.expected_revision:
        raise Conflict("Draft changed; reload the latest revision before editing.")
    # Human editing is deliberately limited to presentation text. Keep provenance,
    # citations, arithmetic, structural IDs, and the generated first version intact.
    allowed = current.result.model_copy(deep=True)
    incoming = update.result
    if len(allowed.map.nodes) != len(incoming.map.nodes) or len(allowed.explanation.statements) != len(
        incoming.explanation.statements
    ):
        raise ValueError("Edits may change node labels, descriptions and explanation text only")
    changed = set(current.edited_fields)
    for a, b in zip(allowed.map.nodes, incoming.map.nodes):
        for field in ("label", "text"):
            if getattr(a, field) != getattr(b, field):
                changed.add(f"map.nodes.{a.id}.{field}")
        a.label, a.text = b.label, b.text
    if allowed.explanation.title != incoming.explanation.title:
        changed.add("explanation.title")
    allowed.explanation.title = incoming.explanation.title
    for i, (a, b) in enumerate(zip(allowed.explanation.statements, incoming.explanation.statements)):
        if a.text != b.text:
            changed.add(f"explanation.statements.{i}.text")
        a.text = b.text
    if allowed != incoming:
        raise ValueError("Edits cannot change evidence provenance, budget checks or map relationships")
    if incoming == current.result:
        return current
    draft = current.model_copy(
        update={
            "result": incoming,
            "edited_fields": sorted(changed),
            "revision": current.revision + 1,
            "status": "draft",
            "approved_at": None,
            "origin": "human_edited",
            "updated_at": now(),
        }
    )
    return store.save_draft(draft, current.revision)


def approve_draft(store: Repository, key: str, request: ApprovalRequest):
    current = store.get_draft(storage_key(key))
    if current.revision != request.expected_revision:
        raise Conflict("Draft changed; reload and review the latest revision before approval.")
    if current.status == "approved":
        return current
    stamp = now()
    return store.save_draft(
        current.model_copy(
            update={
                "revision": current.revision + 1,
                "status": "approved",
                "approved_at": stamp,
                "updated_at": stamp,
            }
        ),
        current.revision,
    )
