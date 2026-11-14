"""Bounded PDF extraction, lexical retrieval, and auditable decimal arithmetic."""

import hashlib
import io
import re
from decimal import Decimal, InvalidOperation
from pathlib import PurePath
from pypdf import PdfReader
from .config import Settings
from .models import (
    BudgetCheck,
    BudgetField,
    Citation,
    Document,
    DocumentPage,
    EvidencePacket,
    GenerateRequest,
    InvestmentResult,
    Statement,
)


def safe_filename(name: str) -> str:
    name = PurePath(name.replace("\\", "/")).name
    return re.sub(r"[^\w. ()-]", "_", name)[:180] or "document.pdf"


def extract_pdf(data: bytes, filename: str, settings: Settings) -> Document:
    digest = hashlib.sha256(data).hexdigest()
    doc = Document(
        id=digest, content_hash=digest, version=digest[:12], filename=safe_filename(filename), status="ready"
    )
    if not data.startswith(b"%PDF-"):
        return doc.model_copy(
            update={"status": "unsupported", "warnings": ["Only genuine PDF files are accepted."]}
        )
    try:
        reader = PdfReader(io.BytesIO(data), strict=True)
        if reader.is_encrypted:
            raise ValueError("Encrypted PDFs are unsupported; upload a decrypted copy.")
        if len(reader.pages) > settings.max_pdf_pages:
            raise ValueError(f"PDF exceeds the {settings.max_pdf_pages}-page limit.")
        count = 0
        for index, page in enumerate(reader.pages, 1):
            # Inspect decompressed content before pypdf builds its extraction graph.
            # Large content streams may expand far beyond the original upload size.
            content = page.get_contents()
            if content is not None and len(content.get_data()) > 6 * 1024 * 1024:
                raise ValueError("Page content stream exceeds the safe extraction limit.")
            text = page.extract_text() or ""
            count += len(text)
            if count > settings.max_extracted_chars:
                raise ValueError("PDF extracted text exceeds the configured limit.")
            doc.pages.append(DocumentPage(page=index, text=text))
            resources = page.get("/Resources")
            xobjects = resources.get_object().get("/XObject") if resources else None
            has_images = bool(
                xobjects
                and any(
                    item.get_object().get("/Subtype") == "/Image" for item in xobjects.get_object().values()
                )
            )
            if has_images:
                doc.warnings.append(
                    f"Page {index} includes images; only its text layer was extracted. Maps and illustrations require visual review."
                )
            if len(text.strip()) < 40:
                doc.warnings.append(
                    f"Page {index} has little or no extractable text; images and maps are not interpreted. OCR is not enabled."
                )
        doc.page_count = len(reader.pages)
        if not any(p.text.strip() for p in doc.pages):
            doc.status = "extraction_failed"
            doc.warnings.append(
                "No extractable text. Supply a text PDF or reviewed transcription with page references."
            )
        doc.budget_fields = extract_budget_fields(doc)
        if not doc.budget_fields:
            doc.warnings.append(
                "No recognizable budget fields extracted. This does not establish that the document contains no figures."
            )
    except Exception as exc:
        doc.status = "malformed" if not isinstance(exc, ValueError) else "extraction_failed"
        doc.pages = []
        doc.warnings = [
            str(exc)
            if isinstance(exc, ValueError)
            else "PDF parsing failed. Supply a valid, unencrypted PDF."
        ]
    return doc


NUMBER = r"\d+(?:[, .\u00a0]\d{3})*(?:[.,]\d{1,2})?"
UNIT = r"(?:millions?|[Mk])"
RANGE = re.compile(
    rf"(?P<a>{NUMBER})\s*(?P<am>{UNIT})?\s*[-–]\s*\$?\s*(?P<b>{NUMBER})\s*(?P<bm>{UNIT})?", re.I
)


def decimal_number(value: str, multiplier: str | None = None) -> Decimal:
    value = value.replace(" ", "").replace("\u00a0", "")
    # A comma followed by exactly three digits is a thousands separator; otherwise decimal.
    if "," in value:
        if all(len(group) == 3 for group in value.split(",")[1:]):
            value = value.replace(",", "")
        else:
            value = value.replace(",", ".")
    return Decimal(value) * (
        {"m": Decimal(1000000), "k": Decimal(1000)}.get((multiplier or "").lower()[:1], 1)
    )


def canonical_range(match: re.Match) -> str:
    unit = match.group("bm") or match.group("am")
    low = decimal_number(match.group("a"), match.group("am") or unit)
    high = decimal_number(match.group("b"), match.group("bm") or unit)
    if low < 0 or high < low:
        raise ValueError("Invalid amount range")
    return f"{low:f}–{high:f}"


def extract_budget_fields(doc: Document) -> list[BudgetField]:
    fields = []
    for page in doc.pages:
        has_usd = bool(re.search(r"\bUSD\b", page.text, re.I))
        has_fcfa = bool(re.search(r"FCFA|XAF|CFA", page.text, re.I))
        active_phase = None
        expects_total = False
        for line in page.text.splitlines():
            if len(line) > 2000:
                msg = f"Page {page.page} contains an unusually long line. Budget extraction for this page may be incomplete."
                if msg not in doc.warnings:
                    doc.warnings.append(msg)
                continue
            phase = re.search(r"phase\s*(\d+)", line, re.I)
            if phase:
                active_phase = phase.group(1)
            if re.match(r"\s*total estimated project budget", line, re.I):
                expects_total = True
                continue
            printed_currency_line = expects_total and bool(re.match(r"\s*(FCFA|USD|XAF)\b", line, re.I))
            if not printed_currency_line:
                expects_total = False
            role = (
                "phase_subtotal"
                if re.search(r"sous[- ]total|subtotal|sub-total", line, re.I)
                else "overall_total"
                if printed_currency_line
                or re.match(
                    r"\s*(?:total\s+(général|general|overall|project)|grand\s+total|overall\s+(budget|total))",
                    line,
                    re.I,
                )
                else "unclassified"
            )
            for match in RANGE.finditer(line, phase.end() if phase and role == "phase_subtotal" else 0):
                prefix = line[: match.start()].rstrip()
                suffix = line[match.end() : match.end() + 10]
                dollar = prefix.endswith("$") or "$" in match.group()
                is_usd = bool(
                    re.search(r"USD\s*\$?$", prefix, re.I)
                    or re.match(r"\s*USD\b", suffix, re.I)
                    or dollar
                    and has_usd
                )
                if dollar and not is_usd:
                    continue
                explicit_fcfa = bool(
                    re.search(r"(FCFA|XAF|CFA)\s*$", prefix, re.I)
                    or re.match(r"\s*(FCFA|XAF|CFA)\b", suffix, re.I)
                )
                currency = (
                    "USD"
                    if is_usd
                    else "FCFA"
                    if explicit_fcfa or has_fcfa and (match.group("am") or match.group("bm"))
                    else ""
                )
                if not currency:
                    continue
                try:
                    amount = canonical_range(match)
                except (ValueError, InvalidOperation):
                    continue
                label = (
                    f"Phase {active_phase} subtotal"
                    if role == "phase_subtotal" and active_phase
                    else prefix.rstrip("$").strip()[:200]
                )
                fields.append(
                    BudgetField(
                        label=label or "Budget range",
                        amount=amount,
                        currency=currency,
                        role=role,
                        citation=Citation(document_id=doc.id, page=page.page, quote=line),
                        raw_text=line,
                    )
                )
    return fields


def reconcile_budget(documents: list[Document]) -> list[BudgetCheck]:
    checks = []
    for doc in documents:
        for currency in sorted({f.currency for f in doc.budget_fields}):
            fields = [f for f in doc.budget_fields if f.currency == currency and f.role != "unclassified"]
            phases = [f for f in fields if f.role == "phase_subtotal"]
            totals = [f for f in fields if f.role == "overall_total"]
            base = dict(currency=currency, fields=fields)
            if not phases or len(totals) != 1 or len({f.label for f in phases}) != len(phases):
                checks.append(
                    BudgetCheck(
                        **base,
                        status="incomplete",
                        description=f"{doc.filename}: need unambiguous phase subtotals and exactly one printed total in the same document. No cross-document sums are inferred.",
                    )
                )
                continue
            # Only reconcile numbered contiguous phases; incomplete extraction cannot establish a total.
            phase_numbers = [re.search(r"phase\s*(\d+)", f.label, re.I) for f in phases]
            numbers = [int(m.group(1)) for m in phase_numbers if m]
            if len(numbers) != len(phases) or sorted(numbers) != list(range(1, len(numbers) + 1)):
                checks.append(
                    BudgetCheck(
                        **base,
                        status="incomplete",
                        description=f"{doc.filename}: phase sequence is ambiguous or incomplete; human review required.",
                    )
                )
                continue
            try:
                values = [tuple(Decimal(x) for x in f.amount.split("–")) for f in phases]
                total = tuple(Decimal(x) for x in totals[0].amount.split("–"))
                if any(len(v) != 2 for v in values) or len(total) != 2:
                    raise ValueError("Expected ranges")
                sums = (sum(v[0] for v in values), sum(v[1] for v in values))
                difference = (total[0] - sums[0], total[1] - sums[1])

                def fmt(v):
                    return "–".join(f"{x:f}" for x in v)

                checks.append(
                    BudgetCheck(
                        **base,
                        status="reconciled" if difference == (0, 0) else "conflict",
                        subtotal_sum=fmt(sums),
                        printed_total=fmt(total),
                        difference=fmt(difference),
                        description=f"{doc.filename}: printed range minus sum of extracted numbered phase ranges, endpoint by endpoint. Candidate extraction requires human source review; this is not an allocation or exchange-rate calculation.",
                    )
                )
            except (ValueError, InvalidOperation):
                checks.append(
                    BudgetCheck(
                        **base,
                        status="incomplete",
                        description="Unsupported amount format; human review required.",
                    )
                )
    return checks


def build_evidence(request: GenerateRequest, documents: list[Document]) -> EvidencePacket:
    terms = set(re.findall(r"\w{3,}", request.question.lower()))
    ranked = []
    for doc in documents:
        for page in doc.pages:
            score = len(terms.intersection(re.findall(r"\w{3,}", page.text.lower())))
            ranked.append((score, doc.id, page))
    ranked.sort(key=lambda item: (-item[0], item[1], item[2].page))
    passages = []
    selected = {}
    # Preserve page boundaries, and cap context instead of trusting PDF size alone.
    remaining = 36000
    for _, doc_id, page in ranked[:18]:
        if not remaining:
            break
        text = page.text[: min(4000, remaining)]
        remaining -= len(text)
        if not text:
            continue
        selected[(doc_id, page.page)] = text
        passages.append(
            Statement(
                text=text,
                classification="document_supported",
                citations=[Citation(document_id=doc_id, page=page.page)],
            )
        )
    # Documents contain selected source pages only: validation cannot cite unseen pages.
    corpus = [
        d.model_copy(
            update={
                "pages": [
                    p.model_copy(update={"text": selected[(d.id, p.page)]})
                    for p in d.pages
                    if (d.id, p.page) in selected
                ]
            }
        )
        for d in documents
    ]
    gaps = [warning for doc in documents for warning in doc.warnings]
    if not documents:
        gaps.append(
            "No source documents selected. Founder notes are self-reported, and company-data verification remains pending."
        )
    if len(selected) < sum(len(d.pages) for d in documents):
        gaps.append("Evidence packet is bounded; not every source page was supplied to the model.")
    return EvidencePacket(
        documents=corpus, passages=passages, budget_checks=reconcile_budget(documents), gaps=gaps
    )


def validate_result(
    result: InvestmentResult, packet: EvidencePacket, request: GenerateRequest
) -> InvestmentResult:
    pages = {(d.id, p.page): p.text for d in packet.documents for p in d.pages}
    # Deterministic budget quotations may originate outside lexical excerpts and remain auditable.
    for check in packet.budget_checks:
        for field in check.fields:
            key = (field.citation.document_id, field.citation.page)
            if field.raw_text not in pages.get(key, ""):
                pages[key] = pages.get(key, "") + "\n" + field.raw_text
    statements = [
        *result.map.nodes,
        *result.map.edges,
        *result.explanation.statements,
        *result.assumptions,
        *result.contradictions,
    ]
    derived = {d.id: d for d in packet.documents if d.derived_from}
    calculation_refs = {
        (f.citation.document_id, f.citation.page)
        for c in packet.budget_checks
        if c.status != "incomplete"
        for f in c.fields
    }
    for statement in statements:
        refs = {(c.document_id, c.page) for c in statement.citations}
        if statement.classification == "document_supported" and not statement.citations:
            raise ValueError("Document-supported statements require citations")
        if statement.classification == "founder_provided" and not request.founder_notes.strip():
            raise ValueError("Founder-provided labels require founder notes")
        if statement.classification == "calculation" and not refs.intersection(calculation_refs):
            raise ValueError("Calculation labels require cited inputs from a completed deterministic check")
        for citation in statement.citations:
            if citation.document_id in derived:
                translation = derived[citation.document_id]
                mapped = translation.source_page_map.get(str(citation.page), [])
                if not any((translation.derived_from, page) in refs for page in mapped):
                    raise ValueError("Translated evidence must also cite a mapped original source page")
            text = pages.get((citation.document_id, citation.page))
            if text is None:
                raise ValueError("Citation refers to a document/page outside supplied evidence")
            if citation.quote and " ".join(citation.quote.split()) not in " ".join(text.split()):
                raise ValueError("Citation quotation does not appear on the referenced source page")
    if result.budget_checks != packet.budget_checks:
        raise ValueError("Budget checks must exactly match deterministic results")
    if any(s.classification != "assumption" for s in result.assumptions):
        raise ValueError("Assumptions must carry the assumption classification")
    return result
