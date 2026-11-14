FROM node:22.21.1-bookworm-slim@sha256:25b3eb23a00590b7499f2a2ce939322727fcce1b15fdd69754fcd09536a3ae2c AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11.14-slim-bookworm@sha256:65a93d69fa75478d554f4ad27c85c1e69fa184956261b4301ebaf6dbb0a3543d AS backend
COPY --from=ghcr.io/astral-sh/uv:0.11.23@sha256:d0a0a753ab981624b49c97abc98821c1c09f4ca69d1ef5cee69c501be3d88479 /uv /usr/local/bin/uv
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/atlas/ ./atlas/
COPY evaluation/candidates.json /app/evaluation/candidates.json
RUN uv sync --frozen --no-dev && useradd --create-home --uid 10001 atlas
COPY --from=frontend /build/dist /app/frontend/dist
ENV PATH="/app/backend/.venv/bin:$PATH" PYTHONUNBUFFERED=1 ATLAS_FRONTEND_DIST=/app/frontend/dist
USER atlas
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn atlas.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1"]
