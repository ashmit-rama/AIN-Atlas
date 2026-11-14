import json
import pytest
from atlas.config import Settings
from atlas.evaluation import paired_run, select_cases, synthetic_documents, token_sum, main
from atlas.models import GenerationOutput, InvestmentResult, Trace


def synthetic_case():
    return {
        "id": "f01",
        "corpus": "synthetic",
        "question": "What is proposed?",
        "founder_notes": "",
        "rubric": "SECRET EVALUATOR ONLY",
        "expected_any_classification": ["unknown"],
    }


async def test_controlled_pair_identical_input_and_partial_usage(tmp_path):
    case = synthetic_case()
    dataset = {"version": "test-only", "cases": [case]}
    seen = []

    async def runner(req, packet, settings):
        assert case["rubric"] not in req.model_dump_json() + packet.model_dump_json()
        seen.append((req.model_dump(exclude={"workflow"}), packet.model_dump()))
        result = InvestmentResult.model_validate(
            {
                "map": {
                    "nodes": [
                        {
                            "id": "proposal",
                            "kind": "capability",
                            "label": "Proposed activity",
                            "text": "Execution is unconfirmed.",
                            "classification": "unknown",
                        }
                    ]
                },
                "explanation": {
                    "title": "Discussion",
                    "statements": [{"text": "Execution is unconfirmed.", "classification": "unknown"}],
                },
                "budget_checks": packet.budget_checks,
            }
        )
        trace = Trace(
            id=req.workflow,
            request_id="r",
            workflow=req.workflow,
            status="succeeded",
            model="test-double",
            latency_ms=1,
            model_calls=2,
            usage=[{"input_tokens": 12, "output_tokens": 4}, {"input_tokens": None, "output_tokens": 2}],
        )
        return GenerationOutput(result=result, trace=trace)

    summary = await paired_run(
        dataset=dataset,
        cases=[case],
        documents=synthetic_documents(),
        settings=Settings(),
        output_root=tmp_path,
        generate=runner,
    )
    assert seen[0] == seen[1]
    assert {a["workflow"] for a in summary["arms"]} == {"single", "multi"}
    assert all(
        a["input_tokens"] is None and a["output_tokens"] == 6 and a["validation_passed"]
        for a in summary["arms"]
    )
    assert len(set(a["packet_digest"] for a in summary["arms"])) == 1
    assert all(a["expected_uncertainty_present"] and a["estimated_cost_usd"] is None for a in summary["arms"])
    assert json.loads((tmp_path / summary["id"] / "summary.json").read_text()) == summary


async def test_failed_arms_retained(tmp_path):
    case = synthetic_case()

    async def fail(*args):
        raise RuntimeError("do not surface sensitive provider text")

    summary = await paired_run(
        dataset={"version": "test", "cases": [case]},
        cases=[case],
        documents=synthetic_documents(),
        settings=Settings(),
        output_root=tmp_path,
        generate=fail,
    )
    assert len(summary["arms"]) == 2
    assert all(
        a["status"] == "failed" and a["model_calls"] is None and not a["validation_passed"]
        for a in summary["arms"]
    )
    assert "sensitive provider text" not in "".join(p.read_text() for p in tmp_path.rglob("*.json"))


def test_selection_budget_and_default_dry_run(capsys):
    dataset = {"cases": [synthetic_case()]}
    with pytest.raises(ValueError):
        select_cases(dataset, ["f01", "f01"], 2)
    with pytest.raises(ValueError):
        select_cases(dataset, ["f01"], 0)
    assert token_sum(None, "input_tokens") is None
    assert main([]) == 0 and "no calls" in capsys.readouterr().out
