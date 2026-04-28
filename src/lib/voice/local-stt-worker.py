import json
import os
import sys
import traceback


def add_windows_cuda_paths() -> None:
    if sys.platform != "win32":
        return

    python_version = f"Python{sys.version_info.major}{sys.version_info.minor}"
    base = os.path.join(os.environ.get("APPDATA", ""), "Python", python_version, "site-packages", "nvidia")

    for lib in ("cudnn", "cublas"):
        dll_path = os.path.join(base, lib, "bin")
        if not os.path.exists(dll_path):
            continue
        os.environ["PATH"] = dll_path + os.pathsep + os.environ.get("PATH", "")
        try:
            os.add_dll_directory(dll_path)
        except (AttributeError, FileNotFoundError):
            pass


add_windows_cuda_paths()

import ctranslate2  # noqa: E402
from faster_whisper import WhisperModel  # noqa: E402


DEFAULT_MODEL = os.environ.get("OASIS_STT_MODEL", "distil-large-v3").strip() or "distil-large-v3"
DEFAULT_DEVICE = os.environ.get("OASIS_STT_DEVICE", "auto").strip() or "auto"
DEFAULT_COMPUTE_TYPE = os.environ.get("OASIS_STT_COMPUTE_TYPE", "float16").strip() or "float16"


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def resolve_device_and_compute_type(device_hint: str, compute_hint: str) -> tuple[str, str]:
    if device_hint and device_hint != "auto":
        return (device_hint, compute_hint if device_hint == "cuda" else "int8")

    try:
        supported = list(ctranslate2.get_supported_compute_types("cuda"))
    except Exception:
        supported = []

    if supported:
        if compute_hint in supported:
            return ("cuda", compute_hint)
        for candidate in ("float16", "int8_float16", "int16"):
            if candidate in supported:
                return ("cuda", candidate)
        return ("cuda", supported[0])

    return ("cpu", "int8")


resolved_device, resolved_compute_type = resolve_device_and_compute_type(DEFAULT_DEVICE, DEFAULT_COMPUTE_TYPE)
status = {
    "state": "loading",
    "message": f"Loading {DEFAULT_MODEL} on {resolved_device}...",
    "model": DEFAULT_MODEL,
    "device": resolved_device,
    "computeType": resolved_compute_type,
}

emit({
    "type": "status",
    **status,
})

model = None


def is_cuda_library_error(exc: Exception) -> bool:
    text = f"{exc}\n{traceback.format_exc(limit=3)}".lower()
    return any(part in text for part in ("cuda", "cublas", "cudnn"))


def set_status(state: str, message: str, device: str, compute_type: str) -> None:
    global status
    status = {
        "state": state,
        "message": message,
        "model": DEFAULT_MODEL,
        "device": device,
        "computeType": compute_type,
    }
    emit({
        "type": "status",
        **status,
    })


def load_whisper_model(device: str, compute_type: str):
    return WhisperModel(
        DEFAULT_MODEL,
        device=device,
        compute_type=compute_type,
    )


def switch_to_cpu(reason: Exception) -> bool:
    global model, resolved_device, resolved_compute_type
    if resolved_device != "cuda" or not is_cuda_library_error(reason):
        return False

    resolved_device = "cpu"
    resolved_compute_type = "int8"
    set_status(
        "loading",
        f"CUDA libraries unavailable; retrying {DEFAULT_MODEL} on CPU...",
        resolved_device,
        resolved_compute_type,
    )

    try:
        model = load_whisper_model(resolved_device, resolved_compute_type)
    except Exception as fallback_exc:
        set_status(
            "error",
            f"Failed to load local STT model on CPU after CUDA fallback: {fallback_exc}",
            resolved_device,
            resolved_compute_type,
        )
        return False

    set_status(
        "ready",
        f"{DEFAULT_MODEL} ready on CPU after CUDA fallback",
        resolved_device,
        resolved_compute_type,
    )
    return True


try:
    model = load_whisper_model(resolved_device, resolved_compute_type)
    set_status(
        "ready",
        f"{DEFAULT_MODEL} ready on {resolved_device}",
        resolved_device,
        resolved_compute_type,
    )
except Exception as exc:
    if not switch_to_cpu(exc):
        set_status(
            "error",
            f"Failed to load local STT model: {exc}",
            resolved_device,
            resolved_compute_type,
        )


def transcribe_audio(audio_path: str, language: str | None) -> dict:
    if model is None:
        return {
            "ok": False,
            "error": status.get("message") or "Local STT model is unavailable.",
        }

    try:
        segments, info = model.transcribe(
            audio_path,
            beam_size=5,
            language=None if not language or language == "auto" else language,
            vad_filter=True,
            vad_parameters={
                "min_silence_duration_ms": 300,
                "speech_pad_ms": 200,
            },
        )
    except Exception as exc:
        if not switch_to_cpu(exc) or model is None:
            raise
        segments, info = model.transcribe(
            audio_path,
            beam_size=5,
            language=None if not language or language == "auto" else language,
            vad_filter=True,
            vad_parameters={
                "min_silence_duration_ms": 300,
                "speech_pad_ms": 200,
            },
        )

    chunks: list[str] = []
    for segment in segments:
        if getattr(segment, "no_speech_prob", 0.0) > 0.6:
            continue
        text = (getattr(segment, "text", "") or "").strip()
        if text:
            chunks.append(text)

    transcript = " ".join(chunks).strip()

    return {
        "ok": True,
        "transcript": transcript,
        "language": getattr(info, "language", None),
        "duration": getattr(info, "duration", None),
    }


for raw_line in sys.stdin:
    line = raw_line.strip()
    if not line:
        continue

    try:
        request = json.loads(line)
    except json.JSONDecodeError:
        continue

    request_type = request.get("type")

    if request_type == "status":
        emit({
            "type": "status",
            **status,
        })
        continue

    if request_type != "transcribe":
        continue

    request_id = str(request.get("id") or "")
    audio_path = str(request.get("audioPath") or "").strip()
    language = str(request.get("language") or "auto").strip() or "auto"

    if not request_id:
        emit({
            "type": "result",
            "id": "",
            "ok": False,
            "error": "Missing transcription request id.",
        })
        continue

    if not audio_path:
        emit({
            "type": "result",
            "id": request_id,
            "ok": False,
            "error": "Missing audio path.",
        })
        continue

    try:
        result = transcribe_audio(audio_path, language)
        emit({
            "type": "result",
            "id": request_id,
            **result,
        })
    except Exception as exc:
        emit({
            "type": "result",
            "id": request_id,
            "ok": False,
            "error": f"{exc}\n{traceback.format_exc(limit=1)}".strip(),
        })
