import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import pytest
import requests
import sqlite3


def _load_whatsflow_module(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    db_path = tmp_path / "test_whatsflow.db"
    real_connect = sqlite3.connect

    def patched_connect(*args, **kwargs):
        if args:
            args = (str(db_path),) + args[1:]
        elif "database" in kwargs:
            kwargs["database"] = str(db_path)
        else:
            args = (str(db_path),)
        return real_connect(*args, **kwargs)

    monkeypatch.setattr(sqlite3, "connect", patched_connect)

    module_name = "whatsflow_real_for_tests"
    module_path = Path(__file__).resolve().parent.parent / "whatsflow-real.py"
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, module_name, module)
    spec.loader.exec_module(module)
    return module


def test_schemeless_public_url_defaults_to_https(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    def fake_get(url, *args, **kwargs):
        if "api.ipify.org" in url:
            return SimpleNamespace(status_code=200, text="203.0.113.10")
        return SimpleNamespace(status_code=200, text="ok")

    monkeypatch.setattr(requests, "get", fake_get)
    monkeypatch.setenv("MINIO_ENDPOINT", "http://minio.internal:9000")
    monkeypatch.setenv("MINIO_PUBLIC_URL", "cdn.example.com")

    module = _load_whatsflow_module(monkeypatch, tmp_path)

    assert module._MINIO_SECURE_DEFAULT is False
    assert module.MINIO_PUBLIC_URL == "https://cdn.example.com"

    media_url = module._build_minio_object_url(object(), "file.png")
    assert media_url == "https://cdn.example.com/meu-bucket/file.png"

    scheduler = module.MessageScheduler("https://baileys.internal")

    with mock.patch.object(module, "check_service_health", return_value=True), mock.patch.object(
        module.requests, "post"
    ) as mock_post:
        mock_post.return_value = SimpleNamespace(status_code=200, text="ok")
        success, error = scheduler._send_message_to_group(
            "instance-123",
            "123@g.us",
            "Caption",
            "image",
            media_url,
        )

    assert success is True
    assert error is None

    payload = mock_post.call_args.kwargs["json"]
    assert payload["mediaUrl"] == media_url
    assert payload["mediaUrl"].startswith("https://")


def test_scheduler_reports_baileys_failure(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    def fake_get(url, *args, **kwargs):
        if "api.ipify.org" in url:
            return SimpleNamespace(status_code=200, text="203.0.113.10")
        return SimpleNamespace(status_code=200, text="ok")

    monkeypatch.setattr(requests, "get", fake_get)

    module = _load_whatsflow_module(monkeypatch, tmp_path)

    scheduler = module.MessageScheduler("https://baileys.internal")

    monkeypatch.setattr(module, "check_service_health", lambda *_: True)

    class FakeResponse:
        def __init__(self, payload: dict):
            self.status_code = 200
            self._payload = payload
            self.text = json.dumps(payload)

        def json(self):
            return self._payload

    failure_payload = {"success": False, "message": "media upload disabled"}

    monkeypatch.setattr(
        module.requests,
        "post",
        lambda *args, **kwargs: FakeResponse(failure_payload),
    )

    success, error = scheduler._send_message_to_group(
        "instance-123",
        "123@g.us",
        "Caption",
        "image",
        "https://cdn.example.com/file.png",
    )

    assert success is False
    assert "media upload disabled" in error
