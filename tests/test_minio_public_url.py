import datetime
import importlib.util
import sqlite3
import sys
import types
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).resolve().parent.parent / "whatsflow-real.py"


class FakeResponse:
    def __init__(self, status_code=200, text="OK"):
        self.status_code = status_code
        self.text = text

    def json(self):
        return {}


@pytest.fixture
def whatsflow_module(monkeypatch, tmp_path):
    # Provide a lightweight "requests" module so importing whatsflow-real doesn't
    # attempt external HTTP calls or install dependencies.
    class FakeRequestException(Exception):
        pass

    class FakeTimeout(FakeRequestException):
        pass

    def fake_get(url, timeout=0, *args, **kwargs):
        if "api.ipify.org" in url:
            return FakeResponse(status_code=200, text="198.51.100.1")
        return FakeResponse(status_code=200, text="OK")

    fake_requests = types.ModuleType("requests")
    fake_requests.get = fake_get
    fake_requests.post = lambda *args, **kwargs: FakeResponse()
    fake_requests.RequestException = FakeRequestException
    fake_requests.exceptions = types.SimpleNamespace(
        Timeout=FakeTimeout, RequestException=FakeRequestException
    )

    monkeypatch.setitem(sys.modules, "requests", fake_requests)

    # Provide a tiny pytz replacement for modules that expect it during import.
    class _FakeTimezone(datetime.tzinfo):
        def __init__(self, name: str):
            self._name = name

        def utcoffset(self, dt):
            return datetime.timedelta(0)

        def dst(self, dt):
            return datetime.timedelta(0)

        def tzname(self, dt):
            return self._name

    fake_pytz = types.ModuleType("pytz")

    def fake_timezone(name: str):
        return _FakeTimezone(name)

    fake_pytz.timezone = fake_timezone
    monkeypatch.setitem(sys.modules, "pytz", fake_pytz)

    # Route database access to a temporary location to avoid mutating repo files.
    original_connect = sqlite3.connect
    temp_db = tmp_path / "minio-test.db"

    def connect_override(path, *args, **kwargs):
        if path == "whatsflow.db":
            path = temp_db
        return original_connect(path, *args, **kwargs)

    monkeypatch.setattr(sqlite3, "connect", connect_override)

    env = {
        "MINIO_ACCESS_KEY": "test-access",
        "MINIO_SECRET_KEY": "test-secret",
        "MINIO_BUCKET": "test-bucket",
        "MINIO_ENDPOINT": "http://minio.internal:9000",
        "MINIO_PUBLIC_URL": "media.example.com",
    }
    for key, value in env.items():
        monkeypatch.setenv(key, value)

    module_name = "whatsflow_real_test_instance"
    if module_name in sys.modules:
        del sys.modules[module_name]

    spec = importlib.util.spec_from_file_location(module_name, MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    loader = spec.loader
    assert loader is not None
    loader.exec_module(module)

    module.DB_FILE = str(temp_db)
    module.reload_minio_settings_from_db()
    return module


def test_schemeless_public_host_defaults_to_https(monkeypatch, whatsflow_module):
    module = whatsflow_module

    assert module.MINIO_PUBLIC_URL == "https://media.example.com"

    object_url = module._build_minio_object_url(None, "path/file.png")
    assert object_url == "https://media.example.com/test-bucket/path/file.png"

    captured = {}

    monkeypatch.setattr(module, "check_service_health", lambda _: True)

    class SendResponse:
        status_code = 200
        text = "OK"

    def fake_post(url, json=None, timeout=None, *args, **kwargs):
        captured["url"] = url
        captured["payload"] = json
        captured["timeout"] = timeout
        return SendResponse()

    monkeypatch.setattr(module.requests, "post", fake_post)

    scheduler = module.MessageScheduler("http://baileys.test")
    success, error = scheduler._send_message_to_group(
        "instance-1", "group-1", "hello", "image", object_url
    )

    assert success is True
    assert error is None
    assert captured["payload"]["mediaUrl"] == object_url
    assert captured["payload"]["type"] == "image"

    monkeypatch.delenv("MINIO_PUBLIC_URL", raising=False)
    module.save_minio_credentials(
        "persist-access",
        "persist-secret",
        module.MINIO_BUCKET,
        "assets.example.com",
    )

    with sqlite3.connect(module.DB_FILE) as conn:
        row = conn.execute(
            "SELECT url FROM minio_credentials ORDER BY ROWID DESC LIMIT 1"
        ).fetchone()

    assert row[0] == "https://assets.example.com"
    assert module.MINIO_PUBLIC_URL == "https://assets.example.com"
