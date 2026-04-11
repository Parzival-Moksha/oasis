"""
Oasis 3D world builder plugin for Hermes.

This plugin does not install the remote MCP server by itself. Instead, it
injects a compact world summary into each Hermes turn so the agent has stable
Oasis awareness even before tools are explicitly called.

Env vars:
  OASIS_TOOLS_URL  - REST endpoint (default: http://127.0.0.1:4516/api/oasis-tools)
  OASIS_MCP_URL    - Remote MCP endpoint (default derived from OASIS_TOOLS_URL)
  OASIS_MCP_KEY    - Optional bearer token shared with Oasis
"""

import json
import os
import urllib.error
import urllib.request

OASIS_TOOLS_URL = os.environ.get("OASIS_TOOLS_URL", "http://127.0.0.1:4516/api/oasis-tools")
OASIS_MCP_KEY = os.environ.get("OASIS_MCP_KEY", "")


def _derive_mcp_url() -> str:
    configured = os.environ.get("OASIS_MCP_URL", "").strip()
    if configured:
        return configured
    if OASIS_TOOLS_URL.endswith("/api/oasis-tools"):
        return OASIS_TOOLS_URL[:-len("/api/oasis-tools")] + "/api/mcp/oasis"
    return OASIS_TOOLS_URL.rstrip("/") + "/api/mcp/oasis"


OASIS_MCP_URL = _derive_mcp_url()


def _call_oasis(tool, args=None, timeout=6):
    try:
        payload = json.dumps({"tool": tool, "args": args or {}}).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if OASIS_MCP_KEY:
            headers["Authorization"] = f"Bearer {OASIS_MCP_KEY}"
        req = urllib.request.Request(OASIS_TOOLS_URL, data=payload, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except Exception:
        return None


def _compact_vec3(value):
    if not isinstance(value, (list, tuple)) or len(value) < 3:
        return None
    try:
        return f"[{float(value[0]):.1f}, {float(value[1]):.1f}, {float(value[2]):.1f}]"
    except Exception:
        return None


def _summarize_named_items(items, name_key="name", limit=4):
    if not isinstance(items, list) or not items:
        return "none"
    parts = []
    for item in items[:limit]:
        if not isinstance(item, dict):
            continue
        label = item.get(name_key) or item.get("displayName") or item.get("prompt") or item.get("id") or "unknown"
        pos = _compact_vec3(item.get("position"))
        status = item.get("status")
        suffix = ""
        if status:
            suffix += f" ({status})"
        if pos:
            suffix += f" @ {pos}"
        parts.append(f"{label}{suffix}")
    if not parts:
        return "none"
    extra = len(items) - len(parts)
    if extra > 0:
        parts.append(f"+{extra} more")
    return "; ".join(parts)


def _format_world_info(info):
    """Compact per-turn context from get_world_info only (cheap)."""
    if not info or not info.get("ok"):
        return "[Oasis: not connected - world tools unavailable]"

    data = info.get("data", {}) if isinstance(info, dict) else {}

    lines = [
        f"[Oasis World: \"{data.get('name', 'unknown')}\" | id={data.get('worldId', 'unknown')}]",
        (
            f"Sky: {data.get('sky', '?')} | Ground: {data.get('ground', '?')} | "
            f"Objects: {data.get('objectCount', 0)} | Tiles: {data.get('tileCount', 0)} | "
            f"Lights: {data.get('lightCount', 0)}"
        ),
        f"Remote Oasis MCP endpoint: {OASIS_MCP_URL}",
        "Use get_world_state for full scene details. Oasis tools are available for placement, avatar movement, screenshots, and Forge conjuration.",
    ]

    return "\n".join(lines)


def _format_world_context_full(info, state):
    """Rich context for session start (includes full state)."""
    if not info or not info.get("ok"):
        return "[Oasis: not connected - world tools unavailable]"

    info_data = info.get("data", {}) if isinstance(info, dict) else {}
    state_data = state.get("data", {}) if isinstance(state, dict) and state.get("ok") else {}

    catalog_objects = state_data.get("catalogObjects", []) if isinstance(state_data, dict) else []
    crafted_scenes = state_data.get("craftedScenes", []) if isinstance(state_data, dict) else []
    conjured_assets = state_data.get("conjuredAssets", []) if isinstance(state_data, dict) else []
    agent_avatars = state_data.get("agentAvatars", []) if isinstance(state_data, dict) else []
    live_player = state_data.get("livePlayerAvatar") if isinstance(state_data, dict) else None
    live_camera = state_data.get("livePlayerCamera") if isinstance(state_data, dict) else None

    lines = [
        f"[Oasis World: \"{info_data.get('name', 'unknown')}\" | id={info_data.get('worldId', 'unknown')}]",
        (
            f"Sky: {info_data.get('sky', '?')} | Ground: {info_data.get('ground', '?')} | "
            f"Tiles: {info_data.get('tileCount', 0)} | Lights: {info_data.get('lightCount', 0)}"
        ),
        (
            f"Catalog: {len(catalog_objects)} | Crafted: {len(crafted_scenes)} | "
            f"Conjured: {len(conjured_assets)} | Agent avatars: {len(agent_avatars)}"
        ),
        f"Conjured in world: {_summarize_named_items(conjured_assets)}",
        f"Agent avatars: {_summarize_named_items(agent_avatars, name_key='label')}",
    ]

    player_pos = _compact_vec3(live_player.get("position")) if isinstance(live_player, dict) else None
    player_fwd = _compact_vec3(live_player.get("forward")) if isinstance(live_player, dict) else None
    camera_pos = _compact_vec3(live_camera.get("position")) if isinstance(live_camera, dict) else None

    if player_pos:
        player_line = f"Live player avatar at {player_pos}"
        if player_fwd:
            player_line += f" facing {player_fwd}"
        lines.append(player_line)
    if camera_pos:
        lines.append(f"Live player camera at {camera_pos}")

    lines.extend([
        f"Remote Oasis MCP endpoint: {OASIS_MCP_URL}",
        "Oasis world tools are available for world state, asset search, placement, avatar movement, screenshots, and Forge conjuration.",
    ])

    return "\n".join(lines)


def register(ctx):
    def inject_world_context(**kwargs):
        """Per-turn: cheap info-only injection. Full state is in session history."""
        info = _call_oasis("get_world_info")
        return {"context": "\n" + _format_world_info(info) + "\n"}

    ctx.register_hook("pre_llm_call", inject_world_context)

    def greet_with_world(**kwargs):
        """Session start: rich context with full world state."""
        info = _call_oasis("get_world_info")
        state = _call_oasis("get_world_state")
        if not info or not info.get("ok"):
            return
        summary = _format_world_context_full(info, state)
        try:
            ctx.inject_message(summary)
        except Exception:
            pass

    ctx.register_hook("on_session_start", greet_with_world)
