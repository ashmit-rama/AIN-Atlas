# Verification record — 2026-11-13

**Status:** implementation and local verification completed. No live company workflow, provider-quality comparison or private deployment is claimed.

| Checked locally | Observation |
|---|---|
| `bash scripts/check.sh` | Locked dependency installation, backend lint, **20 pytest tests**, frontend formatting, **4 unit tests**, production TypeScript/Vite build, tracked-path privacy check passed. One upstream FastAPI/Starlette TestClient deprecation notice; no test failure. Backend tests block outbound socket connections. |
| `npm --prefix frontend run test:e2e` | **5 Chrome scenarios** passed against synthetic API fixtures. Exercised source view, map, editing, approval invalidation, stale revision/reload, explicit loading and failure, mapped translation upload, narrow layout and printable content/status. |
| Integrated model-free flow | Actual FastAPI, PDF extraction, retrieval, ADK Runner, structured result validation and draft service ran together with a scripted model and in-memory repository. The step from approved → edited → reloaded draft is asserted. |
| ADK | Real single-turn specialist handoffs, review, one revision, invalid response retries, global call limit and missing usage exercised with a scripted `BaseLlm`. Constructed an explicit Vertex client and converted the authored schema offline. This is not a Vertex request. |
| Persistence | Actual adapter construction and preconditions/transaction logic checked with SDK test doubles. These do not verify IAM, index availability, storage retention, real transaction contention or networking. |
| Source arithmetic | Extraction and calculations exercised separately on local originals and derived translations. Source-specific page labels, document hashes, mapping and audit details remain outside Git. |
| Integrated browser | Production frontend served by FastAPI on loopback; missing project, bucket, location and model were visible; generation failed with an actionable 503 and request ID. No fake evidence or comparison was shown. |
| Container | Built the multi-stage Docker image locally, ran it as non-root UID 10001, verified `/healthz`, service of the browser UI, missing-configuration behavior and the evaluation CLI dry run. Cloud Run and its IAM proxy are untested. |
| Evaluation | 14 candidate cases listed. Dry-run does not contact a provider. Tests verify packet equality, separate labels, retained failures and missing token accounting; no live pair has been measured. |

**Tested toolchain:** Python 3.11.14, uv 0.11.23, Node 22.21.1, React 19.3.1, React Flow 12.12.0, TypeScript 7.0.2, Vite 8.3.8, Playwright 1.65.0, FastAPI 0.162.7, Pydantic 2.14.3, pypdf 6.21.4, google-adk 2.14.0, google-genai 2.34.0, google-cloud-storage 3.17.1 and google-cloud-firestore 2.34.1. Lockfiles pin the resolved dependency sets. No real model ID is asserted or hard-coded: select a model supported in the authorized project's location.

**Still unverified:** ADC, Vertex model availability/behavior/usage, real GCS and Firestore writes and reads, approved-source cloud ingestion, founder agreement with evidence labels, semantic source support, live end-to-end latency and cost, one measured pair, failure/recovery on cloud, and authenticated browser access to a private Cloud Run deployment. Follow [the launch checklist](launch.md) in order when permissions and spending are authorized. A few cases cannot establish business impact or ROI.
