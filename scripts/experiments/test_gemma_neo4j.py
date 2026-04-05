"""
Quick experiment: Gemma (LM Studio) → Entity/Relationship Extraction → Neo4j

Prerequisites:
  1. LM Studio running with Gemma model loaded (default: http://localhost:1234/v1)
  2. Neo4j running:
     docker compose -f scripts/experiments/docker-compose.neo4j.yml up -d
  3. pip install openai neo4j

Usage:
  python scripts/experiments/test_gemma_neo4j.py

View results:
  Open http://localhost:7474 → login neo4j / testpassword
  Run: MATCH (n)-[r]->(m) RETURN n, r, m
"""

import json
import re
from openai import OpenAI
from neo4j import GraphDatabase

# ── Hardcoded config ──────────────────────────────────────────────────────────

LM_STUDIO_BASE_URL = "http://127.0.0.1:1234/v1"
LM_STUDIO_API_KEY = "lm-studio"  # LM Studio ignores the key but the client requires one
LM_STUDIO_MODEL = "gemma-4-e4b-it"

NEO4J_URI = "bolt://localhost:7687"
NEO4J_USER = "neo4j"
NEO4J_PASSWORD = "testpassword"

# ── Sample paragraph ──────────────────────────────────────────────────────────

SAMPLE_TEXT = """
Apple Inc., headquartered in Cupertino, California, was co-founded by Steve Jobs,
Steve Wozniak, and Ronald Wayne in 1976. Tim Cook has served as CEO since 2011,
succeeding Steve Jobs. Apple acquired Beats Electronics in 2014 for $3 billion,
bringing Dr. Dre and Jimmy Iovine into the company. The iPhone, first released in
2007, revolutionized the smartphone industry and competes directly with Samsung's
Galaxy series. Apple's main rival in the personal computer market is Microsoft,
whose Windows operating system dominates the desktop market. Apple Park, the
company's campus in Cupertino, was designed by Foster + Partners and opened in 2017.
""".strip()

# ── Extraction prompt ─────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a knowledge graph extraction engine.
Given a text, extract all entities and relationships between them.

Before outputting JSON, think step by step inside <think>...</think> tags:
1. Identify all entities and their types
2. For each relationship, explicitly identify WHICH ENTITY is the source and WHICH ENTITY is the target
3. Double-check that every source and target is an entity name, not a role or relationship type

After thinking, return ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "entities": [
    {"name": "Entity Name", "type": "PERSON|ORGANIZATION|LOCATION|PRODUCT|EVENT|OTHER"}
  ],
  "relationships": [
    {"source": "Entity A", "target": "Entity B", "type": "RELATIONSHIP_TYPE", "detail": "brief description"}
  ]
}

CRITICAL RULES:
- "source" and "target" MUST be exact entity names from your entities list. Never put a relationship type or role as a source or target.
- Use SCREAMING_SNAKE_CASE for relationship types.
- Common types: FOUNDED_BY, CEO_OF, ACQUIRED, HEADQUARTERED_IN, COMPETES_WITH, WORKS_FOR, DESIGNED_BY, LOCATED_IN, CREATED, SUCCEEDED_BY, PART_OF

Example input: "Satya Nadella is the CEO of Microsoft, headquartered in Redmond."
Example output:
{
  "entities": [
    {"name": "Satya Nadella", "type": "PERSON"},
    {"name": "Microsoft", "type": "ORGANIZATION"},
    {"name": "Redmond", "type": "LOCATION"}
  ],
  "relationships": [
    {"source": "Satya Nadella", "target": "Microsoft", "type": "CEO_OF", "detail": "Current CEO"},
    {"source": "Microsoft", "target": "Redmond", "type": "HEADQUARTERED_IN", "detail": "Headquarters location"}
  ]
}

Extract as many meaningful entities and relationships as possible."""

USER_PROMPT = f"Extract all entities and relationships from this text:\n\n{SAMPLE_TEXT}"

# ── Step 1: Call Gemma via LM Studio ──────────────────────────────────────────


def extract_with_gemma() -> dict:
    print("🔗 Connecting to LM Studio...")
    client = OpenAI(base_url=LM_STUDIO_BASE_URL, api_key=LM_STUDIO_API_KEY)

    print("🧠 Sending extraction prompt to Gemma...")
    response = client.chat.completions.create(
        model=LM_STUDIO_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": USER_PROMPT},
        ],
        temperature=0.1,  # Low temp for deterministic extraction
        max_tokens=4096,  # Extra room for thinking tokens
    )

    raw = response.choices[0].message.content
    print(f"\n📝 Raw Gemma response:\n{raw}\n")

    # Strip <think>...</think> block if present (thinking mode output)
    json_str = raw.strip()
    think_match = re.search(r"<think>(.*?)</think>", json_str, re.DOTALL)
    if think_match:
        print(f"💭 Thinking output:\n{think_match.group(1).strip()}\n")
        json_str = re.sub(r"<think>.*?</think>", "", json_str, flags=re.DOTALL).strip()

    # Strip markdown code fences if present
    json_str = re.sub(r"^```(?:json)?\s*", "", json_str)
    json_str = re.sub(r"\s*```$", "", json_str)

    try:
        data = json.loads(json_str)
    except json.JSONDecodeError as e:
        print(f"❌ Failed to parse JSON: {e}")
        print("Attempting to find JSON object in response...")
        # Try to find JSON object in the response
        match = re.search(r"\{.*\}", json_str, re.DOTALL)
        if match:
            data = json.loads(match.group())
        else:
            raise ValueError("Could not extract JSON from Gemma response")

    entities = data.get("entities", [])
    relationships = data.get("relationships", [])

    # Post-processing: validate source/target exist in entity names
    entity_names = {e["name"] for e in entities}
    valid_rels = []
    for r in relationships:
        if r["source"] in entity_names and r["target"] in entity_names:
            valid_rels.append(r)
        else:
            missing = []
            if r["source"] not in entity_names:
                missing.append(f"source='{r['source']}'")
            if r["target"] not in entity_names:
                missing.append(f"target='{r['target']}'")
            print(f"  ⚠️  Dropped invalid relationship: {r['source']} ──[{r['type']}]──> {r['target']}")
            print(f"       Reason: {', '.join(missing)} not in entity list")

    data["relationships"] = valid_rels
    relationships = valid_rels

    print(f"\n✅ Extracted {len(entities)} entities and {len(relationships)} valid relationships\n")

    print("── Entities ──")
    for e in entities:
        print(f"  [{e['type']}] {e['name']}")

    print("\n── Relationships ──")
    for r in relationships:
        print(f"  {r['source']} ──[{r['type']}]──> {r['target']}  ({r.get('detail', '')})")

    return data


# ── Step 2: Write to Neo4j ────────────────────────────────────────────────────


def write_to_neo4j(data: dict):
    print("\n🔗 Connecting to Neo4j...")
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

    with driver.session() as session:
        # Clear previous experiment data
        print("🧹 Clearing previous experiment data...")
        session.run("MATCH (n) DETACH DELETE n")

        # Create entity nodes
        print("📦 Creating entity nodes...")
        for entity in data.get("entities", []):
            session.run(
                """
                MERGE (e:Entity {name: $name})
                SET e.type = $type
                """,
                name=entity["name"],
                type=entity["type"],
            )

        # Create relationships with dynamic types (actual Neo4j relationship labels)
        print("🔗 Creating relationships...")
        for rel in data.get("relationships", []):
            # Sanitize relationship type to valid Neo4j identifier
            rel_type = re.sub(r"[^A-Za-z0-9_]", "_", rel["type"]).upper()
            # Build dynamic Cypher — safe because rel_type is sanitized above
            cypher = f"""
                MATCH (a:Entity {{name: $source}})
                MATCH (b:Entity {{name: $target}})
                MERGE (a)-[r:{rel_type}]->(b)
                SET r.detail = $detail
            """
            session.run(
                cypher,
                source=rel["source"],
                target=rel["target"],
                detail=rel.get("detail", ""),
            )

        # Print summary
        result = session.run("MATCH (n) RETURN count(n) AS nodes")
        node_count = result.single()["nodes"]
        result = session.run("MATCH ()-[r]->() RETURN count(r) AS rels")
        rel_count = result.single()["rels"]

        print(f"\n✅ Neo4j graph created: {node_count} nodes, {rel_count} relationships")

    driver.close()


# ── Step 3: Print viewer instructions ─────────────────────────────────────────


def print_instructions():
    print("\n" + "=" * 60)
    print("🎉 Done! View your knowledge graph:")
    print("=" * 60)
    print()
    print("1. Open Neo4j Browser: http://localhost:7474")
    print("2. Login: neo4j / testpassword")
    print("3. Run these Cypher queries:")
    print()
    print("   -- See the full graph --")
    print("   MATCH (n)-[r]->(m) RETURN n, r, m")
    print()
    print("   -- See all entities --")
    print("   MATCH (n:Entity) RETURN n.name, n.type ORDER BY n.type")
    print()
    print("   -- See relationships with types --")
    print("   MATCH (a)-[r]->(b)")
    print("   RETURN a.name, type(r) AS relationship, b.name, r.detail")
    print()
    print("   -- Find paths between two entities --")
    print("   MATCH path = shortestPath((a:Entity {name:'Apple Inc.'})-[*]-(b:Entity {name:'Microsoft'}))")
    print("   RETURN path")
    print("=" * 60)


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    data = extract_with_gemma()
    write_to_neo4j(data)
    print_instructions()
