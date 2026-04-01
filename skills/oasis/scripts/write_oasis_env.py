#!/usr/bin/env python3
"""Emit a paste-ready Oasis pairing block from local Hermes env settings.

This helper does not modify files. It prints env lines that users can paste
into the Oasis Hermes pairing modal.
"""

from __future__ import annotations

import json
import os
import sys

DEFAULT_BASE = "http://127.0.0.1:8642/v1"


def normalize_base(raw: str | None) -> str:
    base = (raw or DEFAULT_BASE).strip().rstrip("/")
    if not base:
        base = DEFAULT_BASE
    if not base.endswith("/v1"):
        base = f"{base}/v1"
    return base


def main() -> int:
    api_key = (os.environ.get("API_SERVER_KEY") or "").strip()
    if not api_key:
        payload = {
            "ok": False,
            "error": "Missing API_SERVER_KEY in current Hermes environment.",
            "action": "Set API_SERVER_KEY, then run this helper again.",
        }
        print(json.dumps(payload, indent=2))
        return 1

    api_base = normalize_base(
        os.environ.get("OASIS_HERMES_BASE")
        or os.environ.get("HERMES_API_BASE")
        or os.environ.get("API_BASE")
    )
    model = (
        os.environ.get("OASIS_HERMES_MODEL")
        or os.environ.get("HERMES_MODEL")
        or ""
    ).strip()
    system_prompt = (
        os.environ.get("OASIS_HERMES_SYSTEM_PROMPT")
        or os.environ.get("HERMES_SYSTEM_PROMPT")
        or ""
    ).strip()

    lines = [
        f"HERMES_API_BASE={api_base}",
        f"HERMES_API_KEY={api_key}",
    ]
    if model:
        lines.append(f"HERMES_MODEL={model}")
    if system_prompt:
        lines.append(f"HERMES_SYSTEM_PROMPT={system_prompt}")

    block = "\n".join(lines)
    payload = {
        "ok": True,
        "message": "Paste this block into Oasis Hermes panel -> pair.",
        "pairing_block": block,
        "steps": [
            "In Oasis, open Hermes panel and click pair.",
            "Paste pairing_block and click save pairing.",
            "If Hermes is remote, open an SSH tunnel first.",
            "Press sync in Oasis and send a test message.",
        ],
        "ssh_tunnel_template": "ssh -L 8642:127.0.0.1:8642 user@your-vps -N",
    }
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
