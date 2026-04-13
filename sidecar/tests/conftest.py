"""
Shared fixtures for sidecar tests.

The EntityExtractor loads a real BERT model (~400 MB on first run,
cached thereafter).  We scope it to the session so it only loads once
across all test files.
"""

import pytest
from fastapi.testclient import TestClient

from app.models.ner import EntityExtractor
from app.main import app


@pytest.fixture(scope="session")
def extractor():
    return EntityExtractor()


@pytest.fixture(scope="session")
def client(extractor):
    app.state.entity_extractor = extractor
    return TestClient(app)
