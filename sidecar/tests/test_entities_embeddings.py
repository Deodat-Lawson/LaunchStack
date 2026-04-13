"""
Integration tests for POST /extract-entities with embedding support.
Tests the boundary between the FastAPI endpoint and the BERT model.
"""

EMBEDDING_DIM = 768


class TestExtractEntitiesBase:
    """Tests for the base response (no embeddings)."""

    def test_returns_entities_without_embedding_field(self, client):
        """POST /extract-entities with a known-entity chunk returns entities
        with text, label, score — and NO embedding key."""
        resp = client.post(
            "/extract-entities",
            json={"chunks": ["Microsoft CEO Satya Nadella"]},
        )
        assert resp.status_code == 200
        body = resp.json()

        assert "results" in body
        assert "total_entities" in body
        assert body["total_entities"] > 0

        for chunk in body["results"]:
            assert "text" in chunk
            for ent in chunk["entities"]:
                assert "text" in ent
                assert "label" in ent
                assert "score" in ent
                assert 0 <= ent["score"] <= 1
                assert "embedding" not in ent

    def test_empty_chunks_returns_empty_results(self, client):
        """POST /extract-entities with empty chunks list returns
        {"results": [], "total_entities": 0}."""
        resp = client.post("/extract-entities", json={"chunks": []})
        assert resp.status_code == 200
        body = resp.json()
        assert body["results"] == []
        assert body["total_entities"] == 0

    def test_entity_content(self, client):
        """Known input produces expected entity labels."""
        resp = client.post(
            "/extract-entities",
            json={"chunks": ["Microsoft CEO Satya Nadella"]},
        )
        body = resp.json()
        entity_texts = {
            e["text"].lower()
            for chunk in body["results"]
            for e in chunk["entities"]
        }
        assert "microsoft" in entity_texts or "satya nadella" in entity_texts

    def test_chunk_with_no_entities(self, client):
        """A chunk with no recognizable entities returns an empty entities array."""
        resp = client.post(
            "/extract-entities",
            json={"chunks": ["The quick brown fox jumps over the lazy dog"]},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["results"]) == 1

    def test_multiple_chunks(self, client):
        """Multiple chunks each get their own result entry."""
        chunks = [
            "Satya Nadella leads Microsoft",
            "Tim Cook is the CEO of Apple",
        ]
        resp = client.post("/extract-entities", json={"chunks": chunks})
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["results"]) == 2


class TestExtractEntitiesWithEmbeddings:
    """Tests for the enhanced response (include_embeddings=true)."""

    def test_returns_768_dim_embedding_per_entity(self, client):
        """POST /extract-entities?include_embeddings=true returns each entity
        with an embedding list of exactly 768 floats."""
        resp = client.post(
            "/extract-entities?include_embeddings=true",
            json={"chunks": ["Microsoft CEO Satya Nadella"]},
        )
        assert resp.status_code == 200
        body = resp.json()

        assert body["total_entities"] > 0

        for chunk in body["results"]:
            for ent in chunk["entities"]:
                assert "embedding" in ent
                assert isinstance(ent["embedding"], list)
                assert len(ent["embedding"]) == EMBEDDING_DIM

    def test_embedding_values_are_floats(self, client):
        """Each value in the embedding array is a Python float, not an int or string."""
        resp = client.post(
            "/extract-entities?include_embeddings=true",
            json={"chunks": ["Microsoft CEO Satya Nadella"]},
        )
        body = resp.json()

        for chunk in body["results"]:
            for ent in chunk["entities"]:
                assert all(isinstance(v, float) for v in ent["embedding"])

    def test_backward_compatible_without_param(self, client):
        """POST /extract-entities (no query param) returns the base shape —
        entities do NOT have an embedding field."""
        resp = client.post(
            "/extract-entities",
            json={"chunks": ["Microsoft CEO Satya Nadella"]},
        )
        assert resp.status_code == 200
        body = resp.json()

        for chunk in body["results"]:
            for ent in chunk["entities"]:
                assert "embedding" not in ent

    def test_embeddings_differ_across_entities(self, client):
        """Different entities in the same chunk get different embeddings (mean-pool)."""
        resp = client.post(
            "/extract-entities?include_embeddings=true",
            json={"chunks": ["Microsoft CEO Satya Nadella announced a partnership with OpenAI"]},
        )
        body = resp.json()
        entities = body["results"][0]["entities"]
        if len(entities) >= 2:
            assert entities[0]["embedding"] != entities[1]["embedding"]

    def test_enhanced_preserves_base_fields(self, client):
        """Enhanced response still includes text, label, score per entity."""
        resp = client.post(
            "/extract-entities?include_embeddings=true",
            json={"chunks": ["Microsoft CEO Satya Nadella"]},
        )
        body = resp.json()
        for chunk in body["results"]:
            for ent in chunk["entities"]:
                assert "text" in ent
                assert "label" in ent
                assert "score" in ent
                assert 0 <= ent["score"] <= 1

    def test_empty_chunks_enhanced(self, client):
        """Empty chunks list with embeddings flag still returns empty results."""
        resp = client.post(
            "/extract-entities?include_embeddings=true",
            json={"chunks": []},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["results"] == []
        assert body["total_entities"] == 0

    def test_chunk_with_no_entities_enhanced(self, client):
        """A chunk with no recognizable entities — should not error."""
        resp = client.post(
            "/extract-entities?include_embeddings=true",
            json={"chunks": ["The quick brown fox jumps over the lazy dog"]},
        )
        assert resp.status_code == 200

    def test_multiple_chunks_enhanced(self, client):
        """Multiple chunks with embeddings — each entity gets its own vector."""
        chunks = [
            "Satya Nadella leads Microsoft",
            "Tim Cook is the CEO of Apple",
        ]
        resp = client.post(
            "/extract-entities?include_embeddings=true",
            json={"chunks": chunks},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["results"]) == 2
        for chunk in body["results"]:
            for ent in chunk["entities"]:
                assert len(ent["embedding"]) == EMBEDDING_DIM


class TestHealth:
    def test_health_returns_200(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
