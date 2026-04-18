"""
Shared fixtures for sidecar tests.

The EntityExtractor loads a real BERT model (~400 MB on first run,
cached thereafter).  We scope it to the session so it only loads once
across all test files.

Imports are deferred inside fixtures so that lightweight test runs
(e.g. test_relationships.py) don't trigger the torch/transformers
import chain.
"""

import pytest


@pytest.fixture(scope="session")
def extractor():
    from app.models.ner import EntityExtractor
    return EntityExtractor()


@pytest.fixture(scope="session")
def client(extractor):
    from fastapi.testclient import TestClient
    from app.main import app
    app.state.entity_extractor = extractor
    return TestClient(app)
