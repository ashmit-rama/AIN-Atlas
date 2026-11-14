"""Shared wire contracts. Documents state claims; they do not verify reality."""

from datetime import datetime, timezone
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


Classification = Literal["document_supported", "founder_provided", "assumption", "calculation", "unknown"]
Workflow = Literal["single", "multi"]


class Citation(Model):
    document_id: str = Field(min_length=1, max_length=128)
    page: int = Field(ge=1)
    quote: str = Field(default="", max_length=2000)


class Statement(Model):
    text: str = Field(min_length=1, max_length=4000)
    classification: Classification
    citations: list[Citation] = Field(default_factory=list, max_length=20)


class MapNode(Statement):
    id: str = Field(min_length=1, max_length=80)
    kind: Literal["funding", "expenditure", "capability", "dependency"]
    label: str = Field(min_length=1, max_length=160)


class MapEdge(Model):
    classification: Classification = "assumption"
    citations: list[Citation] = Field(default_factory=list, max_length=20)
    id: str = Field(min_length=1, max_length=80)
    source: str = Field(min_length=1, max_length=80)
    target: str = Field(min_length=1, max_length=80)
    relationship: Literal["funds", "enables", "depends_on"]


class InvestmentMap(Model):
    nodes: list[MapNode] = Field(min_length=1, max_length=30)
    edges: list[MapEdge] = Field(default_factory=list, max_length=60)


class Explanation(Model):
    title: str = Field(min_length=1, max_length=160)
    statements: list[Statement] = Field(min_length=1, max_length=20)


class BudgetField(Model):
    label: str
    amount: str
    currency: str
    role: Literal["phase_subtotal", "overall_total", "unclassified"]
    citation: Citation
    raw_text: str
    units: str = "currency"
    validation_status: Literal["extracted_candidate", "validated"] = "extracted_candidate"


class BudgetCheck(Model):
    currency: str
    status: Literal["reconciled", "conflict", "incomplete"]
    subtotal_sum: str | None = None
    printed_total: str | None = None
    difference: str | None = None
    description: str
    fields: list[BudgetField] = Field(default_factory=list)


class InvestmentResult(Model):
    map: InvestmentMap
    explanation: Explanation
    gaps: list[str] = Field(default_factory=list, max_length=30)
    assumptions: list[Statement] = Field(default_factory=list, max_length=30)
    contradictions: list[Statement] = Field(default_factory=list, max_length=30)
    budget_checks: list[BudgetCheck] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def valid_graph(self):
        ids = [n.id for n in self.map.nodes]
        if len(ids) != len(set(ids)):
            raise ValueError("Map node IDs must be unique")
        edges = [e.id for e in self.map.edges]
        if len(edges) != len(set(edges)):
            raise ValueError("Map edge IDs must be unique")
        if any(e.source not in ids or e.target not in ids for e in self.map.edges):
            raise ValueError("Map edges must reference existing nodes")
        return self


class DocumentPage(Model):
    page: int
    text: str


class Document(Model):
    id: str
    filename: str
    content_hash: str
    version: str
    status: Literal["ready", "extraction_failed", "malformed", "unsupported"]
    page_count: int = 0
    pages: list[DocumentPage] = Field(default_factory=list)
    budget_fields: list[BudgetField] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=now)
    source_language: str = "undetermined"
    derived_from: str | None = None
    source_page_map: dict[str, list[int]] = Field(default_factory=dict)


class EvidencePacket(Model):
    pages: list[DocumentPage] = Field(default_factory=list)
    passages: list[Statement] = Field(default_factory=list)
    documents: list[Document] = Field(default_factory=list)
    budget_checks: list[BudgetCheck] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)


class GenerateRequest(Model):
    question: str = Field(min_length=1, max_length=4000)
    founder_notes: str = Field(default="", max_length=12000)
    document_ids: list[Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_-]+$")]] = (
        Field(default_factory=list, max_length=12)
    )
    workflow: Workflow = "single"


class Draft(Model):
    id: str
    revision: int = 1
    status: Literal["draft", "approved"] = "draft"
    origin: Literal["generated", "human_edited"] = "generated"
    request: GenerateRequest
    result: InvestmentResult
    trace_id: str
    created_at: str = Field(default_factory=now)
    updated_at: str = Field(default_factory=now)
    approved_at: str | None = None
    edited_fields: list[str] = Field(default_factory=list)


class DraftUpdate(Model):
    expected_revision: int = Field(ge=1)
    result: InvestmentResult


class ApprovalRequest(Model):
    expected_revision: int = Field(ge=1)


class Trace(Model):
    id: str
    request_id: str
    workflow: Workflow
    status: Literal["succeeded", "failed"]
    started_at: str = Field(default_factory=now)
    latency_ms: float
    model: str
    model_calls: int
    retries: int = 0
    usage: list[dict] = Field(default_factory=list)
    reviews: list[dict] = Field(default_factory=list)
    events: list[dict] = Field(default_factory=list)
    versions: dict[str, str] = Field(default_factory=dict)
    error: str | None = None


class GenerationOutput(Model):
    result: InvestmentResult
    trace: Trace
