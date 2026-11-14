"""Ontology as data: translation into Graphiti models and refusal of bad schemas."""

import copy
from pathlib import Path

import pytest
from graphiti_core.utils.ontology_utils.entity_types_utils import validate_entity_types

from app.ontology import LIMITS, OntologyError, OntologyIn, compile_ontology, validate_ontology

from .conftest import BASE_ONTOLOGY, episode, ingest_body


def base():
    return copy.deepcopy(BASE_ONTOLOGY)


def errors_for(schema) -> list[str]:
    return validate_ontology(OntologyIn.model_validate(schema))


# ─── Translation ─────────────────────────────────────────────────────────────


def test_base_ontology_translates_into_graphiti_models():
    compiled = compile_ontology(OntologyIn.model_validate(base()))

    assert list(compiled.entity_types) == ["Organization", "Person", "Product", "PurchaseDecision"]
    person = compiled.entity_types["Person"]
    assert person.__doc__ == "A named or described individual and their role."
    assert list(person.model_fields) == ["title"]
    field = person.model_fields["title"]
    assert field.annotation == (str | None)
    assert field.default is None
    assert field.description == "Job title or role, as stated."
    assert person(title=None).title is None

    assert list(compiled.edge_types) == ["WORKS_FOR", "USES", "INFLUENCES", "APPROVES", "DECIDES_ON"]
    assert compiled.edge_types["APPROVES"].__doc__ == "A person signs off on a purchase decision."
    assert compiled.edge_types["APPROVES"].model_fields == {}

    assert compiled.edge_type_map == {
        ("Person", "Organization"): ["WORKS_FOR"],
        ("Organization", "Product"): ["USES"],
        ("Person", "Product"): ["USES"],
        ("Person", "PurchaseDecision"): ["INFLUENCES", "APPROVES"],
        ("Organization", "PurchaseDecision"): ["DECIDES_ON"],
    }
    # Graphiti's own check (custom fields must not shadow EntityNode fields).
    assert validate_entity_types(compiled.entity_types)


def test_attribute_types_map_to_optional_python_types():
    schema = base()
    schema["entities"][0]["attributes"] = [
        {"name": "headcount", "type": "number", "description": "People employed."},
        {"name": "is_public", "type": "boolean", "description": ""},
        {"name": "hq_city", "type": "string", "description": "Where it is based."},
    ]
    model = compile_ontology(OntologyIn.model_validate(schema)).entity_types["Organization"]
    fields = model.model_fields
    assert fields["headcount"].annotation == (float | None)
    assert fields["is_public"].annotation == (bool | None)
    assert fields["is_public"].description is None
    assert fields["hq_city"].annotation == (str | None)
    instance = model(headcount=120, is_public=True)
    assert instance.headcount == 120.0 and instance.hq_city is None


def test_duplicate_endpoints_collapse():
    schema = base()
    schema["edges"][0]["endpoints"] = [{"source": "Person", "target": "Organization"}] * 2
    compiled = compile_ontology(OntologyIn.model_validate(schema))
    assert compiled.edge_type_map[("Person", "Organization")] == ["WORKS_FOR"]


def test_no_edges_is_allowed():
    schema = base()
    schema["edges"] = []
    compiled = compile_ontology(OntologyIn.model_validate(schema))
    assert compiled.edge_types == {} and compiled.edge_type_map == {}


# ─── Rejection ───────────────────────────────────────────────────────────────


def entity(name="Widget", attributes=None, description="A thing."):
    return {"name": name, "description": description, "attributes": attributes or [], "origin": "extension", "motivating_evidence_id": "E1"}


def edge(name="MAKES", endpoints=None, attributes=None, description="Makes it."):
    return {
        "name": name,
        "description": description,
        "attributes": attributes or [],
        "endpoints": endpoints if endpoints is not None else [{"source": "Organization", "target": "Product"}],
        "origin": "extension",
        "motivating_evidence_id": "E1",
    }


@pytest.mark.parametrize(
    "mutate,expected",
    [
        (lambda s: s["entities"].append(entity("Entity")), "is reserved"),
        (lambda s: s["entities"].append(entity("Episodic")), "is reserved"),
        (lambda s: s["entities"].append(entity("ENTITY")), "is reserved"),
        (lambda s: s["entities"].append(entity("Saga")), "is reserved"),
        (lambda s: s["edges"].append(edge("RELATES_TO")), "is reserved"),
        (lambda s: s["edges"].append(edge("MENTIONS")), "is reserved"),
        (lambda s: s["edges"].append(edge("HAS_EPISODE")), "is reserved"),
        (lambda s: s["entities"].append(entity(attributes=[{"name": "uuid", "type": "string"}])), "is reserved"),
        (lambda s: s["entities"].append(entity(attributes=[{"name": "summary", "type": "string"}])), "is reserved"),
        (lambda s: s["entities"].append(entity(attributes=[{"name": "group_id", "type": "string"}])), "is reserved"),
        (lambda s: s["edges"].append(edge(attributes=[{"name": "fact", "type": "string"}])), "is reserved"),
        (lambda s: s["edges"].append(edge(attributes=[{"name": "reference_time", "type": "string"}])), "is reserved"),
        (lambda s: s["edges"].append(edge(attributes=[{"name": "expired_at", "type": "string"}])), "is reserved"),
        (lambda s: s["entities"].append(entity(attributes=[{"name": "class", "type": "string"}])), "is reserved"),
        (lambda s: s["entities"].append(entity(attributes=[{"name": "model_config", "type": "string"}])), "is reserved"),
        (lambda s: s["entities"].append(entity(attributes=[{"name": "price", "type": "object"}])), "expected string, number or boolean"),
        (lambda s: s["entities"].append(entity(attributes=[{"name": "price", "type": "int"}])), "expected string, number or boolean"),
        (lambda s: s["entities"].append(entity(attributes=[{"name": "Price", "type": "number"}])), "does not match"),
        (lambda s: s["entities"].append(entity("widget")), "does not match"),
        (lambda s: s["entities"].append(entity("Big Widget")), "does not match"),
        (lambda s: s["edges"].append(edge("makes")), "does not match"),
        (lambda s: s["edges"].append(edge("Makes")), "does not match"),
        (lambda s: s["entities"].append(entity("W" * (LIMITS["nameMax"] + 1))), "longer than 40"),
        (lambda s: s["entities"].append(entity(description="d" * 301)), "longer than 300"),
        (lambda s: s["entities"].append(entity(description="   ")), "description is empty"),
        (lambda s: s["entities"].append(entity("Person")), "declared twice"),
        (lambda s: s["edges"].append(edge("USES")), "declared twice"),
        (lambda s: s["entities"].append(entity(attributes=[{"name": "a", "type": "string"}] * 2)), "declared twice"),
        (lambda s: s["edges"].append(edge(endpoints=[{"source": "Person", "target": "Spaceship"}])), "is not a declared entity type"),
        (lambda s: s["edges"].append(edge(endpoints=[{"source": "Entity", "target": "Person"}])), "is not a declared entity type"),
        (lambda s: s["edges"].append(edge(endpoints=[])), "has no endpoints"),
        (lambda s: s["entities"].extend(entity(f"Extra{i}") for i in range(9)), "more than 12 entity types"),
        (lambda s: s["edges"].extend(edge(f"EXTRA_{i}") for i in range(12)), "more than 16 edge types"),
        (
            lambda s: s["entities"].append(
                entity(attributes=[{"name": f"a{i}", "type": "string"} for i in range(7)])
            ),
            "more than 6 attributes",
        ),
        (
            lambda s: s["edges"].append(
                edge(endpoints=[{"source": "Person", "target": "Organization"}] * 9)
            ),
            "more than 8 endpoints",
        ),
        (lambda s: s.update(entities=[]), "no entity types"),
    ],
)
def test_bad_schemas_are_rejected(mutate, expected):
    schema = base()
    mutate(schema)
    errors = errors_for(schema)
    assert any(expected in error for error in errors), errors
    with pytest.raises(OntologyError):
        compile_ontology(OntologyIn.model_validate(schema))


def test_every_violation_is_reported_at_once():
    schema = base()
    schema["entities"].append(entity("Entity"))
    schema["edges"].append(edge("lower"))
    schema["entities"].append(entity(attributes=[{"name": "x", "type": "date"}]))
    assert len(errors_for(schema)) == 3


def test_unknown_fields_are_refused():
    schema = base()
    schema["entities"][0]["__module__"] = "os"
    with pytest.raises(Exception):
        OntologyIn.model_validate(schema)


@pytest.mark.parametrize(
    "name",
    [
        "__import__('os').system('touch PWNED')",
        "__class__",
        "Person; DROP",
        "Person) DETACH DELETE n //",
        "exec()",
    ],
)
def test_names_are_data_never_code(tmp_path, monkeypatch, name):
    """A hostile name is refused by pattern before it can become a label,
    a field or anything else; nothing is evaluated."""
    monkeypatch.chdir(tmp_path)
    schema = base()
    schema["entities"].append(entity(name))
    schema["entities"].append(entity("Gadget", attributes=[{"name": name, "type": "string"}]))
    schema["edges"].append(edge(name))
    errors = errors_for(schema)
    assert len(errors) >= 3
    with pytest.raises(OntologyError):
        compile_ontology(OntologyIn.model_validate(schema))
    assert not (Path(tmp_path) / "PWNED").exists()


def test_route_refuses_a_bad_ontology_before_any_work(client, graphiti):
    schema = base()
    schema["entities"].append(entity("Entity"))
    response = client.post("/v1/groups/g1/episodes", json=ingest_body(episode("e1"), ontology=schema))
    assert response.status_code == 422
    body = response.json()
    assert body["detail"] == "invalid ontology"
    assert any("is reserved" in error for error in body["errors"])
    assert graphiti.add_calls == []
    assert graphiti.store.episodes == {}


def test_overlong_names_are_not_echoed():
    schema = base()
    schema["entities"].append(entity("X" * 150))
    errors = errors_for(schema)
    assert all("X" * 41 not in error for error in errors)
