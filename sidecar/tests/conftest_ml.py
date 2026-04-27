"""
ML model fixtures for sidecar tests that require torch/sentence-transformers.

These are intentionally separated from conftest.py so that lightweight
test runs (Adeu routes, etc.) don't trigger the torch/transformers import
chain (~2 GB download on first run).

Usage in ML test files:
    from sidecar.tests.conftest_ml import extractor, ml_client

Or use pytest's fixture discovery by importing directly:
    pytest_plugins = ["conftest_ml"]
"""

import pytest


@pytest.fixture(scope="session")
def extractor():
    """Real EntityExtractor backed by BERT — loads once per test session."""
    from app.models.ner import EntityExtractor
    return EntityExtractor()


@pytest.fixture(scope="session")
def ml_client(extractor):
    """FastAPI TestClient with the full app and ML models pre-loaded."""
    from fastapi.testclient import TestClient
    from app.main import app
    app.state.entity_extractor = extractor
    return TestClient(app)
