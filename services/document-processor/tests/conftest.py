import os

os.environ.setdefault("PROCESSOR_SERVICE_TOKEN", "test-token-0123456789abcdef")

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import app

TOKEN = os.environ["PROCESSOR_SERVICE_TOKEN"]


@pytest.fixture
def settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


@pytest.fixture
def client(settings: Settings):
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def post(client: TestClient):
    def _post(path, token: str | None = TOKEN):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return client.post("/internal/v1/process", content=path.read_bytes(), headers=headers)

    return _post
