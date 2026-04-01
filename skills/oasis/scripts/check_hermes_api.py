#!/usr/bin/env python3
"""Verify that the local Hermes API server is reachable for Oasis."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request


DEFAULT_BASE = "http://127.0.0.1:8642"


def normalize_base(raw: str) -> str:
    base = (raw or DEFAULT_BASE).strip().rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    return base


def fetch_json(url: str, api_key: str | None = None) -> tuple[int | None, object]:
    request = urllib.request.Request(url)
    if api_key:
        request.add_header("Authorization", f"Bearer {api_key}")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            status = getattr(response, "status", None)
            raw = response.read().decode("utf-8", errors="replace")
            try:
                return status, json.loads(raw)
            except json.JSONDecodeError:
                return status, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            return exc.code, raw
    except Exception as exc:  # noqa: BLE001
        return None, {"error": str(exc)}


def main() -> int:
    base = normalize_base(os.environ.get("OASIS_HERMES_BASE", DEFAULT_BASE))
    api_key = os.environ.get("API_SERVER_KEY")

    health_status, health_body = fetch_json(f"{base}/health", api_key=api_key)
    models_status, models_body = fetch_json(f"{base}/v1/models", api_key=api_key)

    model_ids: list[str] = []
    if isinstance(models_body, dict) and isinstance(models_body.get("data"), list):
        for entry in models_body["data"]:
            if isinstance(entry, dict) and isinstance(entry.get("id"), str):
                model_ids.append(entry["id"])

    payload = {
        "base": base,
        "health_status": health_status,
        "health_ok": bool(health_status and 200 <= health_status < 300),
        "models_status": models_status,
        "models_ok": bool(models_status and 200 <= models_status < 300),
        "models": model_ids,
        "api_key_present": bool(api_key),
        "notes": [
            "If health_ok is false, the Hermes API server may not be running or reachable.",
            "If models_ok is false, check API_SERVER_KEY and loopback binding.",
        ],
    }

    print(json.dumps(payload, indent=2))
    return 0 if payload["health_ok"] and payload["models_ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
