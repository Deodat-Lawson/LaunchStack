"""
LLM client and robust JSON parser for relationship extraction.

Calls any OpenAI-compatible chat completions endpoint.
All provider details come from env vars — nothing is hardcoded.
"""

import json
import re
from typing import Any

import httpx

LLM_TIMEOUT = 60.0


# ------------------------------------------------------------------
# Robust JSON parser — sequential fallback chain
# ------------------------------------------------------------------

def parse_llm_json(raw: str) -> dict[str, Any]:
    """
    Best-effort extraction of a JSON object from LLM output.

    Fallback chain:
      1. Strip <think>…</think> blocks
      2. Try json.loads directly
      3. Strip markdown code fences and retry
      4. Regex-extract the first { … } block and retry
      5. Give up → return safe empty default
    """
    empty: dict[str, Any] = {"entities": [], "relationships": []}

    if not raw or not raw.strip():
        return empty

    # Step 1: strip <think>…</think> tags (reasoning models like Gemma)
    cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()

    # Step 2: direct parse
    try:
        return json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        pass

    # Step 3: strip markdown fences
    fence_match = re.search(
        r"```(?:json)?\s*\n?(.*?)\n?\s*```", cleaned, re.DOTALL
    )
    if fence_match:
        try:
            return json.loads(fence_match.group(1))
        except (json.JSONDecodeError, ValueError):
            pass

    # Step 4: regex for first JSON object
    obj_match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if obj_match:
        try:
            return json.loads(obj_match.group(0))
        except (json.JSONDecodeError, ValueError):
            pass

    return empty


# ------------------------------------------------------------------
# Async LLM client
# ------------------------------------------------------------------

async def call_llm(
    base_url: str,
    model: str,
    messages: list[dict[str, str]],
) -> str:
    """
    Call an OpenAI-compatible chat completions endpoint.

    Returns the assistant's message content string.
    On any failure (network, timeout, bad response shape) returns "".
    """
    url = f"{base_url.rstrip('/')}/chat/completions"
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": 4096,
    }

    try:
        headers = {"Content-Type": "application/json"}
        api_key = os.environ.get("EXTRACTION_LLM_API_KEY", "")
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]
    except Exception:
        return ""
