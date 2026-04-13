"""
Unit tests for sidecar/app/models/llm.py — JSON parsing fallback chain.
"""

from app.models.llm import parse_llm_json


def test_clean_json():
    raw = '{"entities": [{"name": "Microsoft", "type": "ORGANIZATION"}], "relationships": []}'
    result = parse_llm_json(raw)
    assert len(result["entities"]) == 1
    assert result["entities"][0]["name"] == "Microsoft"


def test_think_tags_stripped():
    raw = '<think>Let me analyze this text carefully.</think>{"entities": [{"name": "Satya Nadella", "type": "PERSON"}], "relationships": []}'
    result = parse_llm_json(raw)
    assert len(result["entities"]) == 1
    assert result["entities"][0]["name"] == "Satya Nadella"


def test_multiline_think_tags():
    raw = """<think>
I need to identify entities.
Let me think step by step.
</think>
{"entities": [{"name": "Apple", "type": "ORGANIZATION"}], "relationships": []}"""
    result = parse_llm_json(raw)
    assert result["entities"][0]["name"] == "Apple"


def test_markdown_fences():
    raw = '```json\n{"entities": [{"name": "Google", "type": "ORGANIZATION"}], "relationships": []}\n```'
    result = parse_llm_json(raw)
    assert result["entities"][0]["name"] == "Google"


def test_markdown_fences_no_language():
    raw = '```\n{"entities": [], "relationships": []}\n```'
    result = parse_llm_json(raw)
    assert result["entities"] == []
    assert result["relationships"] == []


def test_think_tags_plus_fences():
    raw = '<think>reasoning</think>\n```json\n{"entities": [{"name": "Tesla", "type": "ORGANIZATION"}], "relationships": []}\n```'
    result = parse_llm_json(raw)
    assert result["entities"][0]["name"] == "Tesla"


def test_json_with_surrounding_text():
    raw = 'Here is the result: {"entities": [], "relationships": [{"source": "A", "target": "B", "type": "WORKS_FOR", "detail": ""}]} end'
    result = parse_llm_json(raw)
    assert len(result["relationships"]) == 1


def test_empty_string():
    result = parse_llm_json("")
    assert result == {"entities": [], "relationships": []}


def test_none_like_whitespace():
    result = parse_llm_json("   \n\t  ")
    assert result == {"entities": [], "relationships": []}


def test_complete_garbage():
    result = parse_llm_json("I'm sorry, I can't help with that request.")
    assert result == {"entities": [], "relationships": []}


def test_truncated_json():
    raw = '{"entities": [{"name": "Micro'
    result = parse_llm_json(raw)
    assert result == {"entities": [], "relationships": []}
