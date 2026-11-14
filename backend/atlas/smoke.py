"""One deliberately small Vertex connection check. Explicit opt-in; no company data."""

import argparse
import asyncio
from pathlib import Path
import sys
from google import genai
from google.genai import types
from atlas.config import Settings


async def probe(settings):
    # Disable transport retries; spend at most one short generation. Never emit model text or credentials.
    timeout = min(settings.request_timeout_seconds, 30)
    client = genai.Client(
        vertexai=True,
        project=settings.project_id,
        location=settings.location,
        http_options=types.HttpOptions(
            timeout=timeout * 1000, retry_options=types.HttpRetryOptions(attempts=1)
        ),
    )
    async with client.aio as api:
        async with asyncio.timeout(timeout):
            response = await api.models.generate_content(
                model=settings.model,
                contents="Connection check using fictional data. Reply with the single word ready.",
                config=types.GenerateContentConfig(max_output_tokens=32, temperature=0.0),
            )
    if not response.candidates:
        raise ValueError("No response candidate; check model availability and restrictions.")
    usage = response.usage_metadata
    print(
        "Vertex returned a response. Input tokens:",
        getattr(usage, "prompt_token_count", None),
        "Output tokens:",
        getattr(usage, "candidates_token_count", None),
        "(None means not reported).",
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live-model", action="store_true")
    args = parser.parse_args(argv)
    if not args.live_model:
        print("No call made. After spending authorization, use --live-model for a single synthetic request.")
        return 0
    cfg = Settings(_env_file=Path(__file__).resolve().parents[2] / ".env")
    missing = [k for k in ("project_id", "location", "model") if not getattr(cfg, k).strip()]
    if missing:
        print(
            "Set " + ", ".join("ATLAS_" + k.upper() for k in missing) + " and configure Google ADC.",
            file=sys.stderr,
        )
        return 2
    try:
        asyncio.run(probe(cfg))
    except Exception as exc:
        print(
            f"Vertex check failed ({type(exc).__name__}); verify ADC, IAM, model ID and location.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
