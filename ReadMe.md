# AIN Atlas

**Map investment to infrastructure.** A private founder workspace for turning an investor question, founder notes and selected PDFs into an editable conceptual map and explanation card. Each claim is identified as document-supported, founder-provided, assumed, calculated or unknown. Documents describe proposals; they do not independently establish ownership, operations, staffing or financing terms.

## Run locally

Install Node **22.21.1** (npm), Python **3.11** and [uv](https://docs.astral.sh/uv/getting-started/installation/). From this checkout:

```bash
bash scripts/dev.sh
```

Open **http://127.0.0.1:8000**. The script creates a local `.env` from `.env.example` if needed, installs the locked dependencies, builds the frontend and serves the app on loopback. With no credentials it displays setup instructions; it never generates a simulated investor answer. Edit `.env`, restart the server, and recheck configuration after authorized account setup. For frontend development, start the backend on port 8000 and run `npm --prefix frontend run dev` in another terminal; Vite proxies `/api` to the backend.

## Use the workspace

1. In **Sources**, upload an approved original PDF, inspect its extraction status, physical pages and budget candidates. For a translation, identify the original and enter its reviewed page mapping. Repeated bytes are deduplicated; different versions are kept separate.
2. In **Workspace**, type the investor question, add optional founder notes, select documents, and choose the single-agent or multi-agent path. Generation is a **live Vertex AI action**. Follow each map relationship and read the original pages behind the explanation and deterministic budget checks. Assumptions remain visible.
3. Edit the node labels and explanation; save and approve explicitly. Editing an approved version returns it to draft. **Saved drafts** preserves versions. Use print preview to review what will be shared. No investor messages are sent.
4. **Comparison** displays measured paired runs saved by the evaluation CLI. No runs means no benchmark. Review all material claims before sharing; the map does not recommend suitability, returns, ownership terms or allocation of an investor's budget.

## Verify without credentials

```bash
bash scripts/check.sh
npm --prefix frontend run test:e2e                     # Chrome installed; synthetic API fixtures only
uv run --project backend python -m atlas.evaluation --list
uv run --project backend python -m atlas.evaluation --case Q01   # dry run
```

`check.sh` exercises backend contracts, PDF extraction, budget arithmetic, citation validation, draft transitions, actual ADK Runner execution with a scripted model, adapter behavior and paired-run controls. It also runs TypeScript/build and frontend unit checks. Browser tests verify the user interaction flow without credentials. CI additionally builds the container. These checks do not verify Google credentials, Gemini quality, cloud permissions, or Cloud Run browser access. See [verification and known limits](docs/verification.md).

## Credential handoff

Copy `.env.example` to `.env`. Configure **`ATLAS_PROJECT_ID`, `ATLAS_GCS_BUCKET`, `ATLAS_LOCATION`, `ATLAS_MODEL`** and `ATLAS_FIRESTORE_DATABASE` if not `(default)`. These identifiers are not credentials. Authenticate locally with ADC or attach the dedicated runtime service account in Cloud Run. No frontend secret, Developer API key or service-account key file is needed. Spend and data handling must be authorized before a live model call or resource creation.

- [Private account, resources, IAM, deployment and browser access](docs/cloud.md)
- [Founder launch and verification checklist](docs/launch.md)
- [Architecture, evidence, privacy and state](docs/architecture.md)
- [Comparison design, cases, metrics and review rubric](docs/comparison.md)

Keep source PDFs, their extracts, company-specific labels, private traces, `.env`, generated reports and review screenshots outside Git and the container build context. Only synthetic fixtures are tracked. No cloud resource provisioning or deployment occurs during setup or CI.
