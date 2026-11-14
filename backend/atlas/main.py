"""Private single-origin HTTP API. No outbound SDK calls occur at startup."""

import asyncio
import json
import logging
import sys
import time
from pathlib import Path
from uuid import uuid4
from urllib.parse import urlsplit
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.concurrency import run_in_threadpool
from google.api_core.exceptions import GoogleAPIError
from google.auth.exceptions import GoogleAuthError
from .config import Settings
from .models import ApprovalRequest, DraftUpdate, GenerateRequest
from .service import approve_draft, edit_draft, generate_draft, ingest, storage_key
from .storage import Conflict, GoogleStore, NotFound

logger = logging.getLogger("atlas.http")
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
logger.propagate = False
logging.getLogger("pypdf").setLevel(logging.CRITICAL)
# SDK warning/error strings can include prompts, model output or provider bodies.
for _logger in ("google_adk", "google.adk", "google_genai", "google.genai", "httpx", "httpcore"):
    logging.getLogger(_logger).setLevel(logging.CRITICAL)


class RequestSizeLimit:
    """Cap multipart bytes before Starlette's parser spools them, including chunked requests."""

    def __init__(self, app, limit):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or not scope["path"].startswith("/api/")
            or scope["method"] not in {"POST", "PUT", "PATCH"}
        ):
            return await self.app(scope, receive, send)
        upload = scope["path"] == "/api/documents"
        limit = self.limit if upload else 2 * 1024 * 1024
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > limit:
                response = JSONResponse(
                    {
                        "detail": {
                            "code": "upload_too_large" if upload else "request_too_large",
                            "message": "PDF exceeds the upload size limit."
                            if upload
                            else "Request body exceeds the size limit.",
                            "request_id": scope.get("state", {}).get("request_id", ""),
                        }
                    },
                    status_code=413,
                )
                return await response(scope, receive, send)
            if not message.get("more_body"):
                break
        sent = False

        async def replay():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        return await self.app(scope, replay, send)


def create_app(settings=None, store=None, generator=None):
    cfg = settings or Settings()
    app = FastAPI(title="AIN Atlas", version="0.1.0", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(RequestSizeLimit, limit=cfg.max_upload_bytes + 65536)
    app.state.store = store
    capacity = asyncio.Semaphore(cfg.max_concurrency)

    def repository(model=False):
        missing = cfg.missing(model=model)
        if missing:
            raise HTTPException(
                503,
                {
                    "code": "configuration_required",
                    "message": "Set "
                    + ", ".join(missing)
                    + " in the backend and configure Google Application Default Credentials.",
                },
            )
        if app.state.store is None:
            app.state.store = GoogleStore(cfg)
        return app.state.store

    def error(req, status, code, msg):
        return JSONResponse(
            {"detail": {"code": code, "message": msg, "request_id": req.state.request_id}}, status_code=status
        )

    @app.middleware("http")
    async def request_context(req: Request, call_next):
        start = time.monotonic()
        req.state.request_id = uuid4().hex
        try:
            site = req.headers.get("sec-fetch-site", "")
            origin = req.headers.get("origin")
            # A trustworthy browser sets Fetch Metadata even behind a host-rewriting
            # IAM proxy. For older browsers require the literal same-origin Host.
            bad_origin = origin and (origin == "null" or urlsplit(origin).netloc != req.headers.get("host"))
            if req.method not in {"GET", "HEAD", "OPTIONS"} and (
                site in {"cross-site", "same-site"} or (site != "same-origin" and bad_origin)
            ):
                response = error(req, 403, "cross_origin", "Cross-origin changes are not allowed.")
            else:
                response = await call_next(req)
        except Exception as exc:
            logger.error(
                json.dumps(
                    {
                        "event": "request_failed",
                        "request_id": req.state.request_id,
                        "exception_type": type(exc).__name__,
                    }
                )
            )
            response = error(
                req,
                500,
                "internal_error",
                "Request failed. Use the request ID to check private application logs.",
            )
        template = getattr(req.scope.get("route"), "path", None)
        logger.info(
            json.dumps(
                {
                    "event": "request_completed",
                    "severity": "INFO",
                    "request_id": req.state.request_id,
                    "route": template if template and template.startswith("/api/") else "other",
                    "method": req.method,
                    "status_code": response.status_code,
                    "latency_ms": round((time.monotonic() - start) * 1000, 1),
                }
            )
        )
        response.headers["X-Request-ID"] = req.state.request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(HTTPException)
    async def http_error(req, exc):
        detail = (
            exc.detail
            if isinstance(exc.detail, dict)
            else {"code": "request_error", "message": str(exc.detail)}
        )
        return error(req, exc.status_code, detail["code"], detail["message"])

    @app.exception_handler(RequestValidationError)
    async def schema_error(req, exc):
        return error(
            req,
            422,
            "invalid_request",
            "Request fields do not match the API schema; verify required fields and limits.",
        )

    @app.exception_handler(ValueError)
    async def value_error(req, exc):
        return error(req, 422, "validation_failed", str(exc)[:400])

    @app.exception_handler(Conflict)
    async def conflict(req, exc):
        return error(req, 409, "revision_conflict", str(exc))

    @app.exception_handler(NotFound)
    async def missing_record(req, exc):
        return error(req, 404, "not_found", "Record not found.")

    @app.exception_handler(GoogleAuthError)
    @app.exception_handler(GoogleAPIError)
    async def cloud_error(req, exc):
        return error(
            req,
            503,
            "cloud_unavailable",
            "Google Cloud access failed. Verify ADC, project, bucket, database, supported region and service-account IAM roles.",
        )

    @app.get("/healthz")
    def health():
        return {"status": "ok"}

    @app.get("/api/config")
    def config():
        return cfg.public_status()

    @app.get("/api/documents")
    def documents():
        return repository().list_documents()

    @app.get("/api/documents/{key}")
    def document(key: str):
        return repository().get_document(storage_key(key))

    @app.post("/api/documents")
    async def upload(
        file: UploadFile = File(...),
        source_language: str = Form("undetermined"),
        derived_from: str | None = Form(None),
        source_page_map: str = Form("{}"),
    ):
        repo = await run_in_threadpool(repository)
        if file.content_type not in ("application/pdf", "application/octet-stream") or not (
            file.filename or ""
        ).lower().endswith(".pdf"):
            raise HTTPException(415, {"code": "unsupported_file", "message": "Upload a PDF (.pdf) file."})
        data = await file.read(cfg.max_upload_bytes + 1)
        if len(data) > cfg.max_upload_bytes:
            raise HTTPException(
                413, {"code": "upload_too_large", "message": "PDF exceeds configured size limit."}
            )
        try:
            mapping = json.loads(source_page_map)
            if not isinstance(mapping, dict):
                raise ValueError
        except ValueError:
            raise HTTPException(
                422, {"code": "invalid_page_map", "message": "source_page_map must be a JSON object."}
            ) from None
        return await run_in_threadpool(
            ingest, repo, data, file.filename, cfg, source_language, derived_from, mapping
        )

    @app.post("/api/generate")
    async def generate(request: GenerateRequest, req: Request):
        repo = await run_in_threadpool(repository, True)
        if capacity.locked():
            raise HTTPException(
                429,
                {
                    "code": "workflow_busy",
                    "message": "Another workflow is running. Try again after it finishes.",
                },
            )
        async with capacity:
            from .workflows import WorkflowError, generate as live_generator

            try:
                return await generate_draft(
                    repo, cfg, request, req.state.request_id, generator or live_generator
                )
            except WorkflowError as exc:
                raise HTTPException(
                    502,
                    {
                        "code": "workflow_failed",
                        "message": f"{exc}. Private trace: {exc.trace.id}.",
                    },
                ) from None

    @app.get("/api/drafts")
    def drafts():
        return repository().list_drafts()

    @app.get("/api/drafts/{key}")
    def draft(key: str):
        return repository().get_draft(storage_key(key))

    @app.put("/api/drafts/{key}")
    def edit(key: str, body: DraftUpdate):
        return edit_draft(repository(), key, body)

    @app.post("/api/drafts/{key}/approve")
    def approve(key: str, body: ApprovalRequest):
        return approve_draft(repository(), key, body)

    @app.get("/api/drafts/{key}/versions")
    def versions(key: str):
        return repository().versions(storage_key(key))

    @app.get("/api/comparisons")
    def comparisons():
        return repository().list_comparisons()

    dist = Path(cfg.frontend_dist)
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
    return app


app = create_app()
