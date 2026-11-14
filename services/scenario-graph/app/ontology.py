"""
Ontology: the generated schema arrives as data and becomes Graphiti models.

The worker already validated the ontology, but the service re-validates it:
it is the last stop before the names become Neo4j labels, relationship names
and pydantic fields. Everything here treats the schema as data. Names must
match a strict pattern, types come from a fixed table, and models are built
with ``pydantic.create_model`` — nothing is evaluated, imported or executed.

Mirrors ``ONTOLOGY_LIMITS`` and ``RESERVED_ONTOLOGY_NAMES`` in
``pipelines/src/scenarios/v2/contracts.ts``; keep the two in step.
"""

from __future__ import annotations

import keyword
import re
from dataclasses import dataclass, field
from typing import Literal

from graphiti_core.edges import EntityEdge
from graphiti_core.nodes import EntityNode
from pydantic import BaseModel, ConfigDict, Field, create_model

# ─── Limits and reserved names (mirror contracts.ts) ─────────────────────────

LIMITS = {
    "entityTypes": 12,
    "edgeTypes": 16,
    "attributesPerType": 6,
    "endpointsPerEdge": 8,
    "nameMax": 40,
    "descriptionMax": 300,
}

RESERVED_ONTOLOGY_NAMES: frozenset[str] = frozenset(
    [
        "Entity",
        "Episodic",
        "Community",
        "EntityEdge",
        "EpisodicEdge",
        "CommunityEdge",
        "Saga",
        "RELATES_TO",
        "MENTIONS",
        "HAS_MEMBER",
        "uuid",
        "name",
        "group_id",
        "labels",
        "created_at",
        "summary",
        "attributes",
        "name_embedding",
        "fact",
        "fact_embedding",
        "episodes",
        "valid_at",
        "invalid_at",
        "expired_at",
        "source_node_uuid",
        "target_node_uuid",
    ]
)

# Server-side extras: every field Graphiti's own node/edge models carry (a
# custom attribute with one of these names would overwrite it), the episode
# relationships Graphiti writes, and our own bookkeeping property prefix.
_SERVER_RESERVED: frozenset[str] = frozenset(
    {
        *RESERVED_ONTOLOGY_NAMES,
        *EntityNode.model_fields.keys(),
        *EntityEdge.model_fields.keys(),
        "reference_time",
        "HAS_EPISODE",
        "NEXT_EPISODE",
    }
)
_RESERVED_FOLDED = frozenset(name.lower() for name in _SERVER_RESERVED)

ENTITY_NAME = re.compile(r"^[A-Z][A-Za-z0-9]*$")
EDGE_NAME = re.compile(r"^[A-Z][A-Z0-9_]*$")
ATTRIBUTE_NAME = re.compile(r"^[a-z][a-z0-9_]*$")

AttributeType = Literal["string", "number", "boolean"]
_PY_TYPES: dict[str, type] = {"string": str, "number": float, "boolean": bool}

# ─── Wire shapes (snake_case, as the HTTP adapter sends them) ────────────────
#
# Only shape is checked here (and list sizes are capped loosely so a huge body
# is refused before any work); the contract rules live in validate_ontology so
# every violation is reported at once, not just the first.


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OntologyAttributeIn(_Strict):
    name: str = Field(max_length=200)
    type: str = Field(max_length=32)
    description: str = Field(default="", max_length=2000)


class OntologyEndpointIn(_Strict):
    source: str = Field(max_length=200)
    target: str = Field(max_length=200)


class OntologyEntityIn(_Strict):
    name: str = Field(max_length=200)
    description: str = Field(max_length=2000)
    attributes: list[OntologyAttributeIn] = Field(default_factory=list, max_length=64)
    origin: Literal["base", "extension"] | None = None
    motivating_evidence_id: str | None = Field(default=None, max_length=64)


class OntologyEdgeIn(_Strict):
    name: str = Field(max_length=200)
    description: str = Field(max_length=2000)
    attributes: list[OntologyAttributeIn] = Field(default_factory=list, max_length=64)
    endpoints: list[OntologyEndpointIn] = Field(max_length=64)
    origin: Literal["base", "extension"] | None = None
    motivating_evidence_id: str | None = Field(default=None, max_length=64)


class OntologyIn(_Strict):
    entities: list[OntologyEntityIn] = Field(max_length=64)
    edges: list[OntologyEdgeIn] = Field(default_factory=list, max_length=64)


# ─── Validation ──────────────────────────────────────────────────────────────


class OntologyError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


def _is_reserved(name: str) -> bool:
    return name.lower() in _RESERVED_FOLDED


def _check_name(kind: str, name: str, pattern: re.Pattern[str], errors: list[str]) -> bool:
    # Never echo an over-long name back: report its length only.
    if len(name) > LIMITS["nameMax"]:
        errors.append(f"{kind} name is longer than {LIMITS['nameMax']} characters")
        return False
    if not pattern.match(name):
        errors.append(f"{kind} name {name!r} does not match {pattern.pattern}")
        return False
    if _is_reserved(name):
        errors.append(f"{kind} name {name!r} is reserved")
        return False
    return True


def _check_description(kind: str, text: str, errors: list[str], *, required: bool) -> None:
    if len(text) > LIMITS["descriptionMax"]:
        errors.append(f"{kind} description is longer than {LIMITS['descriptionMax']} characters")
    if required and not text.strip():
        errors.append(f"{kind} description is empty")


def _check_attributes(owner: str, attributes: list[OntologyAttributeIn], errors: list[str]) -> None:
    if len(attributes) > LIMITS["attributesPerType"]:
        errors.append(f"{owner} has more than {LIMITS['attributesPerType']} attributes")
    seen: set[str] = set()
    for attribute in attributes:
        kind = f"{owner} attribute"
        if not _check_name(kind, attribute.name, ATTRIBUTE_NAME, errors):
            continue
        if keyword.iskeyword(attribute.name) or attribute.name.startswith("model_"):
            errors.append(f"{kind} name {attribute.name!r} is reserved")
            continue
        if attribute.name in seen:
            errors.append(f"{kind} {attribute.name!r} is declared twice")
        seen.add(attribute.name)
        if attribute.type not in _PY_TYPES:
            errors.append(
                f"{kind} {attribute.name!r} has type {attribute.type[:32]!r}; "
                "expected string, number or boolean"
            )
        _check_description(f"{kind} {attribute.name!r}", attribute.description, errors, required=False)


def validate_ontology(schema: OntologyIn) -> list[str]:
    errors: list[str] = []
    if not schema.entities:
        errors.append("ontology declares no entity types")
    if len(schema.entities) > LIMITS["entityTypes"]:
        errors.append(f"ontology has more than {LIMITS['entityTypes']} entity types")
    if len(schema.edges) > LIMITS["edgeTypes"]:
        errors.append(f"ontology has more than {LIMITS['edgeTypes']} edge types")

    entity_names: set[str] = set()
    for entity in schema.entities:
        if not _check_name("entity type", entity.name, ENTITY_NAME, errors):
            continue
        if entity.name in entity_names:
            errors.append(f"entity type {entity.name!r} is declared twice")
        entity_names.add(entity.name)
        _check_description(f"entity type {entity.name!r}", entity.description, errors, required=True)
        _check_attributes(f"entity type {entity.name!r}", entity.attributes, errors)

    edge_names: set[str] = set()
    for edge in schema.edges:
        if not _check_name("edge type", edge.name, EDGE_NAME, errors):
            continue
        if edge.name in edge_names or edge.name in entity_names:
            errors.append(f"edge type {edge.name!r} is declared twice")
        edge_names.add(edge.name)
        _check_description(f"edge type {edge.name!r}", edge.description, errors, required=True)
        _check_attributes(f"edge type {edge.name!r}", edge.attributes, errors)
        if not edge.endpoints:
            errors.append(f"edge type {edge.name!r} has no endpoints")
        if len(edge.endpoints) > LIMITS["endpointsPerEdge"]:
            errors.append(
                f"edge type {edge.name!r} has more than {LIMITS['endpointsPerEdge']} endpoints"
            )
        for endpoint in edge.endpoints:
            for side in (endpoint.source, endpoint.target):
                if side not in entity_names:
                    # Bounded: an unknown name is never echoed past nameMax.
                    shown = side if len(side) <= LIMITS["nameMax"] else f"{side[: LIMITS['nameMax']]}…"
                    errors.append(
                        f"edge type {edge.name!r} endpoint {shown!r} is not a declared entity type"
                    )
    return errors


# ─── Translation into Graphiti models ────────────────────────────────────────


@dataclass(frozen=True)
class CompiledOntology:
    """What ``Graphiti.add_episode`` takes: entity models, edge models, and the
    (source label, target label) → allowed edge names map."""

    entity_types: dict[str, type[BaseModel]]
    edge_types: dict[str, type[BaseModel]]
    edge_type_map: dict[tuple[str, str], list[str]] = field(default_factory=dict)


def _model(name: str, description: str, attributes: list[OntologyAttributeIn]) -> type[BaseModel]:
    fields: dict[str, tuple[object, object]] = {}
    for attribute in attributes:
        py_type = _PY_TYPES[attribute.type]
        fields[attribute.name] = (
            py_type | None,
            Field(default=None, description=attribute.description or None),
        )
    # Graphiti reads a type's description from the model's docstring.
    return create_model(name, __doc__=description.strip(), **fields)  # type: ignore[call-overload]


def compile_ontology(schema: OntologyIn) -> CompiledOntology:
    """Validate, then translate. Raises OntologyError listing every problem."""
    errors = validate_ontology(schema)
    if errors:
        raise OntologyError(errors)

    entity_types = {
        entity.name: _model(entity.name, entity.description, entity.attributes)
        for entity in schema.entities
    }
    edge_types: dict[str, type[BaseModel]] = {}
    edge_type_map: dict[tuple[str, str], list[str]] = {}
    for edge in schema.edges:
        edge_types[edge.name] = _model(edge.name, edge.description, edge.attributes)
        for endpoint in edge.endpoints:
            names = edge_type_map.setdefault((endpoint.source, endpoint.target), [])
            if edge.name not in names:
                names.append(edge.name)
    return CompiledOntology(entity_types=entity_types, edge_types=edge_types, edge_type_map=edge_type_map)
