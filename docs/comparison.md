# Controlled paired evaluation

The candidate manifest `evaluation/candidates.json` has 14 cases: five questions reported by the user, four derived questions and five synthetic failures. Two synthetic failures exercise ingestion without a model; 12 questions are eligible for paired runs. Each case names its split, corpus and review expectation. Do not tune prompts on `held_out` cases. If someone does, reclassify that case as development and reserve a new held-out case. Absence of a citation is not a general proof of nonexistence. Company page-level labels live only in the private review directory and require founder review.

From the repository root after `uv sync --project backend --frozen`:

```bash
uv run --project backend python -m atlas.evaluation --list
uv run --project backend python -m atlas.evaluation --case Q01     # dry run, zero network/model calls
```

When access and spending are authorized, start with **one pair**. A synthetic failure case uses a fictional passage; a company case requires specific already ingested, approved document IDs. Never give private labels to the model. Repeat `--document` for each intended source (include its original if selecting a translation). Use one corpus per run.

```bash
uv run --project backend python -m atlas.evaluation --live --case Q12 --persist
uv run --project backend python -m atlas.evaluation --live --case Q01 --document ORIGINAL_ID \
  --labels private/source-review/labels.json --persist
```

The second command is an optional subsequent pair after inspecting the first. `--persist` writes the measured summary to the configured private bucket/Firestore for the Comparison view. Omit it to keep artifacts local. The harness fails early on missing configuration, caps cases, runs serially and stores each completed arm before starting the next. Artifacts under `private/eval-results/<run-id>/` contain the immutable packet, request, result, trace, review findings, failures and summary. Protect them like the documents. They are not uploaded to Git. Provider failure types are retained, not raw secret-bearing exception payloads.

Both arms use the same question, notes, corpus, immutable page-level retrieval packet and arithmetic, model, generation settings, rules, schema and final validators. Only orchestration changes. Seeded starting order alternates across cases; the seed does **not** make provider output deterministic. All arms include a packet digest, model call count, retries, duration and package/prompt versions. The harness reports per-arm generation-through-validation wall time, and packet preparation separately since it is shared. Provider metadata is per call: input/output plus cached, thought and other reported categories live in the raw trace; missing values remain null. An incomplete category is never summed as zero. Additional context, tool calls, specialist passes and revisions are part of the multi-agent cost. A run can be valid structurally and still wrong about a material claim.

A source-page hit counts only a reference to an expected page; deterministic check citations are included. It does not measure entailment. `expected_uncertainty_present` checks that a requested classification occurs, not whether the label was applied to the right claim. Never call these scores verified correctness. Use these fields to locate cases for review. The prototype reports no dollar estimates: there is no dated rate card covering all billable usage, discounts and regions. Billing/infra costs must be reviewed separately. No test-double or local timing is a Gemini benchmark.

## Manual review sheet

Review paired results blind to workflow where practical. In a private worksheet, record case and arm IDs, reviewer, date, corpus version, precise proposed correction and any source page. Score each dimension 0 (fails), 1 (needs a specific edit), or 2 (acceptable for founder approval). Record `not assessable` if evidence is missing; do not score uncertainty itself as a failure.

| Dimension | Check |
|---|---|
| Material factual support | For **each** material claim and relationship, read the cited page, check the quotation and whether tense, scope and ownership follow. Flag missing original-language evidence. |
| Investor relevance | Does the map answer the specific funding question, connect use → capability and expose dependencies? |
| Arithmetic | Compare printed values, currency, units and computed endpoints. Does the explanation preserve discrepancies and refrain from inventing an allocation? |
| Uncertainty | Are proposed, founder-reported, assumed, conflicting and unknown statements clearly distinguished? |
| Clarity and usefulness | Can the founder explain this map aloud without assuming routes, staffing, contracts, returns or execution? |
| Editing effort | Count material corrections and capture their substance before any approval; note if the draft is unusable. |

Report attempted pairs, completed pairs, individual failures, splits, corpus, model/settings, timing conditions and per-case differences. With a tiny smoke sample describe observations only. No winner, ROI, business impact or production-readiness inference. Autonomous document search/tool selection would be a different experiment and must use a distinct dataset/run label.
