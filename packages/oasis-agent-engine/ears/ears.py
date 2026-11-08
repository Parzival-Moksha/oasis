"""Tyler's ears: live speech to text for the microphone on every text box.

Tyler's server (lib/ears.mjs) starts one of these for the chosen model and keeps it warm. It speaks JSON lines:

  stdin   {"t": "start", "sid": 7, "lang": "auto"}  a new dictation (one at a time; lang: auto, en, de, hu …)
          {"t": "audio", "pcm": "<base64>"}         16 kHz mono 16-bit little-endian, any length (100 ms is typical)
          {"t": "stop"}                             the last words settle, then "stopped"
          {"t": "quit"}
  stdout  {"t": "ready", "model": "...", "load_s": 1.2}
          {"t": "status", "text": "Downloading ... 40%"}
          {"t": "partial", "sid": 7, "line": 3, "text": "so the first", "at": 4.2, "ms": 35}    can still change
          {"t": "final", "sid": 7, "line": 3, "text": "So the first cut.", "at": 5.1}         settled after a pause
          {"t": "stopped", "sid": 7, "audio_s": 12.3, "compute_s": 0.8, "rtf": 0.07}
          {"t": "error", "sid": 7, "text": "..."}

  python ears.py --model moonshine-medium     serve (the server does this)
  python ears.py --download nemotron          fetch a model once (prints the same status lines)
  python ears.py --list                       which models are on disk

"at" is how much audio (seconds since "start") the words were made from, "ms" what that pass cost.
Everything stays on this computer; the only network use is the one-time model download. (The cloud models, Deepgram and
ElevenLabs, don't come through here: lib/ears.mjs talks to them itself.)
"""

import argparse
import base64
import ctypes
import json
import os
import queue
import sys
import tarfile
import threading
import time
import urllib.request
from pathlib import Path

import numpy as np

RATE = 16000
SHERPA_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/"
NEMOTRON = "sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11"
PARAKEET = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"
SIZES = {NEMOTRON: "475 MB", PARAKEET: "490 MB"}
WHISPER_FILES = ["config.json", "preprocessor_config.json", "tokenizer.json", "vocabulary.json", "model.bin"]
# Whisper copies the style of what it thinks came before. With nothing, some lines come out with no punctuation or
# capitals at all; a tidy sentence makes it tidy up your words too (it drops "like", "you know"). This keeps your words
# and the punctuation (on one voice clip, words wrong: 11.7% like no prompt at all, 15.3% with a tidy sentence).
WHISPER_STYLE = {"en": "Okay, so, um, I was thinking, like, we could, uh, try this, right? And then, you know, see what happens."}

# The models Tyler offers. lib/ears.mjs has the same list with the words the page shows.
MODELS = {
    "moonshine-medium": {"engine": "moonshine", "arch": "MEDIUM_STREAMING", "lang": "en", "dir": "medium-streaming-en"},
    "moonshine-small": {"engine": "moonshine", "arch": "SMALL_STREAMING", "lang": "en", "dir": "small-streaming-en"},
    "nemotron": {"engine": "streaming", "dir": NEMOTRON},
    "nemotron-parakeet": {"engine": "streaming", "dir": NEMOTRON, "final": PARAKEET},
    "parakeet-v3": {"engine": "parakeet", "dir": PARAKEET},
    "whisper-turbo": {"engine": "whisper", "repo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo", "what": "Whisper Large v3 Turbo (1.6 GB)"},
    "whisper-large": {"engine": "whisper", "repo": "Systran/faster-whisper-large-v3", "what": "Whisper Large v3 (3 GB)"},
    "whisper-distil": {"engine": "whisper", "repo": "Systran/faster-distil-whisper-large-v3", "what": "Distil-Whisper Large v3 (1.5 GB)", "lang": "en"},
}
for _k, _v in MODELS.items():
    _v["id"] = _k
UPDATE = float(os.environ.get("EARS_UPDATE", "0.3"))  # seconds of audio between two looks at the line being spoken


def say(**msg):
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def full_speed():
    """Below normal priority, like all of Tyler's work, so whatever Levi does himself always comes first, but not in
    "efficiency mode": Windows puts a process with no window of its own on the slow cores at a low clock, which on
    Levi's laptop cost two thirds of the speed (29 vs 88 GFLOPS on one core). Live dictation is interactive, so this
    process opts out. Both settings are for this process only."""
    if os.name != "nt":
        try:
            os.nice(5)
        except OSError:
            pass
        return
    try:
        import ctypes
        from ctypes import wintypes

        class State(ctypes.Structure):
            _fields_ = [("Version", wintypes.ULONG), ("ControlMask", wintypes.ULONG), ("StateMask", wintypes.ULONG)]

        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.GetCurrentProcess.restype = wintypes.HANDLE
        k.SetPriorityClass.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        k.SetProcessInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        me = k.GetCurrentProcess()
        k.SetPriorityClass(me, 0x4000)  # BELOW_NORMAL_PRIORITY_CLASS
        st = State(1, 0x1, 0x0)  # PROCESS_POWER_THROTTLING_EXECUTION_SPEED: off
        k.SetProcessInformation(me, 4, ctypes.byref(st), ctypes.sizeof(st))  # ProcessPowerThrottling
    except Exception as e:  # an older Windows: carry on at whatever speed it gives
        log("full_speed:", e)


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# --- downloads --------------------------------------------------------------------------------------------------------
class Progress:
    """Status lines while a model downloads, at most one per 2 %."""

    def __init__(self, what):
        self.what = what
        self.last = -1

    def __call__(self, frac, _name=""):
        pct = int(max(0.0, min(1.0, frac)) * 100)
        if pct >= self.last + 2 or pct == 100:
            self.last = pct
            say(t="status", text=f"Downloading {self.what}: {pct}% (one time)")


def fetch(url, dest, what):
    """Downloads url to dest (via a .part file), with progress."""
    dest = Path(dest)
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    progress = Progress(what)
    req = urllib.request.Request(url, headers={"User-Agent": "Tyler-ears"})
    with urllib.request.urlopen(req, timeout=60) as r, open(part, "wb") as f:
        total = int(r.headers.get("content-length") or 0)
        done = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if total:
                progress(done / total)
    part.replace(dest)
    return dest


def sherpa_model(models_dir, name, what):
    """A sherpa-onnx model folder, downloaded and unpacked the first time."""
    root = Path(models_dir) / "sherpa"
    folder = root / name
    if (folder / "tokens.txt").exists():
        return folder
    archive = fetch(SHERPA_URL + name + ".tar.bz2", root / (name + ".tar.bz2"), what)
    say(t="status", text=f"Unpacking {what} (one time)")
    with tarfile.open(archive, "r:bz2") as tar:
        tar.extractall(root, filter="data")
    archive.unlink()
    return folder


def silero_vad(models_dir):
    return fetch(SHERPA_URL + "silero_vad.onnx", Path(models_dir) / "sherpa" / "silero_vad.onnx", "the voice detector")


def hf_on_disk(repo, files, models_dir):
    """A Hugging Face model that's already here: in Tyler's own cache, or in the shared one (the transcription tools in
    the brain folder use the same Whisper models, so there's no need for a second copy)."""
    own = Path(models_dir) / "hf" / repo.split("/")[-1]
    hub = Path(os.environ.get("HF_HUB_CACHE") or Path(os.environ.get("HF_HOME") or Path.home() / ".cache" / "huggingface") / "hub")
    for folder in [own, *sorted((hub / ("models--" + repo.replace("/", "--")) / "snapshots").glob("*"))]:
        if all((folder / f).exists() for f in files):
            return folder
    return None


def hf_model(repo, files, models_dir, what):
    """A Hugging Face model folder, downloaded the first time."""
    folder = hf_on_disk(repo, files, models_dir)
    if folder:
        return folder
    folder = Path(models_dir) / "hf" / repo.split("/")[-1]
    for f in files:
        fetch(f"https://huggingface.co/{repo}/resolve/main/{f}", folder / f, what)
    return folder


def cuda_libs():
    """The GPU models need NVIDIA's CUDA libraries: the ones the GPU add-on installed (lib/ears.mjs does that on first
    use), or a folder that already has them (EARS_CUDA_DIRS, set by lib/ears.mjs). Must run before the models import."""
    own = Path(sys.prefix) / "Lib" / "site-packages" / "nvidia"
    for d in [*own.glob("*/bin"), *filter(None, os.environ.get("EARS_CUDA_DIRS", "").split(os.pathsep))]:
        if Path(d).is_dir():
            os.environ["PATH"] = f"{d}{os.pathsep}{os.environ['PATH']}"
            os.add_dll_directory(str(d))


# --- engines ----------------------------------------------------------------------------------------------------------
class Moonshine:
    """Moonshine streaming (moonshine-voice): a streaming model with its own voice detector. It works while you talk,
    so a line's words are ready a moment after you say them and it settles as soon as you pause."""

    def __init__(self, spec, models_dir, threads):
        os.environ.setdefault("MOONSHINE_VOICE_CACHE", str(Path(models_dir) / "moonshine"))
        # One thread: measured on Levi's laptop, all of them cost ten times the CPU (half of the whole processor) for 1.4
        # updates a second instead of 1.1, so this leaves the other cores alone
        os.environ.setdefault("MOONSHINE_ORT_SINGLE_THREAD", "1")
        from moonshine_voice import ModelArch, Transcriber, get_model_for_language
        from moonshine_voice.errors import check_error
        from moonshine_voice.moonshine_api import TranscriptC
        from moonshine_voice.transcriber import Stream

        class LeanStream(Stream):
            """The library's own version of this turns the whole transcript into Python objects on every pass: every
            line so far, each with its audio as a list of Python floats. That's nothing at the start of a dictation, but
            it grows with every word (9 million floats a pass after 11 minutes, 65 s of work per minute of talk). The
            library's pacing already spends all of one core on the model, so all of it is overload: the words fell
            further and further behind. Here a pass only reads the lines that changed, and never their audio."""

            def update_transcription(self, flags=0):
                out = ctypes.POINTER(TranscriptC)()
                t = time.monotonic()
                check_error(self._lib.moonshine_transcribe_stream(self._transcriber._handle, self._handle, flags, ctypes.byref(out)))
                if out:
                    transcript = out.contents
                    for i in range(transcript.line_count):
                        line = transcript.lines[i]
                        if line.has_text_changed or (line.is_complete and line.is_updated):
                            self.on_line(line)
                self._last_pass = time.monotonic() - t  # all of it: the next pass has to earn what this one cost

        self.LeanStream = LeanStream
        lang = spec["lang"]
        # Already on disk: a quiet check (the library still walks its files and would report it as a download)
        quiet = lambda *_: None  # noqa: E731
        progress = quiet if on_disk(spec["id"], models_dir) else Progress(f"Moonshine ({lang})")
        path, arch = get_model_for_language(lang, ModelArch[spec["arch"]], on_progress=progress)
        # EARS_MOONSHINE="name=value,…" tries the library's other options (see parse_transcriber_options upstream)
        opts = dict(kv.split("=", 1) for kv in os.environ.get("EARS_MOONSHINE", "").split(",") if "=" in kv)
        self.transcriber = Transcriber(model_path=str(path), model_arch=arch, update_interval=UPDATE, options=opts or None)
        self.stream = None
        self.at = 0.0

    def start(self, emit, lang):
        self.at = 0.0
        self.stream = self.LeanStream(self.transcriber, UPDATE)
        lines = {}  # the library's 64-bit line ids, as 1, 2, 3 …

        def on_line(line):
            text = ctypes.string_at(line.text).decode("utf-8", errors="ignore").strip() if line.text else ""
            n = lines.setdefault(line.id, len(lines) + 1)
            if line.is_complete and line.is_updated:
                emit("final", n, text, self.at)
            elif text:
                emit("partial", n, text, self.at)

        self.stream.on_line = on_line
        self.stream.start()

    def add(self, samples):
        self.at += len(samples) / RATE
        self.stream.add_audio(samples.tolist(), RATE)

    def stop(self):
        if self.stream is not None:
            self.stream.stop()
            self.stream.close()
            self.stream = None


class Lines:
    """Makes a non-streaming model live. A voice detector (Silero) finds where a line starts and ends; while you talk
    the model reads the line so far again every ~0.4 s (the partial words), and after a pause it reads the whole line
    once more and it settles (the final words). A line never runs longer than 15 s, so a pass stays cheap."""

    PRE = int(0.4 * RATE)  # audio kept from before the voice detector fires, so the first syllable isn't lost

    def __init__(self, decode, vad_path, interval=0.4):
        import sherpa_onnx

        cfg = sherpa_onnx.VadModelConfig()
        cfg.silero_vad.model = str(vad_path)
        cfg.silero_vad.threshold = 0.5
        cfg.silero_vad.min_silence_duration = 0.5
        cfg.silero_vad.min_speech_duration = 0.2
        cfg.silero_vad.max_speech_duration = 15
        cfg.sample_rate = RATE
        cfg.num_threads = 1
        self.window = cfg.silero_vad.window_size
        self.vad = sherpa_onnx.VoiceActivityDetector(cfg, buffer_size_in_seconds=60)
        self.decode = decode
        self.interval = interval

    def start(self, emit, lang):
        self.vad.reset()
        self.emit = emit
        self.lang = lang
        self.pending = np.zeros(0, np.float32)  # less than one detector window, waiting for more
        self.buf = np.zeros(0, np.float32)  # the line being spoken, with a little audio from before it
        self.buf_start = 0  # where buf starts, in samples since "start"
        self.fed = 0  # samples given to the detector
        self.line = 0
        self.speaking = False
        self.next_pass = 0  # sample count after which the next partial pass is due
        self.last_partial = ""

    def _read(self, a, b, final):
        audio = self.buf[max(0, a - self.buf_start) : max(0, b - self.buf_start)]
        if len(audio) < RATE // 10:
            return "", 0.0
        t = time.perf_counter()
        text = self.decode(audio, self.lang, final).strip()
        return text, time.perf_counter() - t

    def add(self, samples):
        self.pending = np.concatenate([self.pending, samples])
        n = len(self.pending) // self.window * self.window
        if not n:
            return
        chunk, self.pending = self.pending[:n], self.pending[n:]
        self.buf = np.concatenate([self.buf, chunk])
        for i in range(0, n, self.window):
            self.vad.accept_waveform(chunk[i : i + self.window])
        self.fed += n
        self._settle()
        if not self.speaking and self.vad.is_speech_detected():
            # buf holds the last 0.4 s before the detector fired (or what followed a line cut at 15 s): all of it
            self.speaking = True
            self.line += 1
            self.line_start = self.buf_start
            self.next_pass = 0
            self.last_partial = ""
        if not self.speaking:
            keep = self.PRE
            if len(self.buf) > keep:
                self.buf_start += len(self.buf) - keep
                self.buf = self.buf[-keep:]
        elif self.fed >= self.next_pass:
            text, took = self._read(self.line_start, self.fed, False)
            # The next pass waits for at least as much new audio as this one took, so a slow PC never falls behind
            self.next_pass = self.fed + int(max(self.interval, took * 1.2) * RATE)
            if text and text != self.last_partial:
                self.last_partial = text
                self.emit("partial", self.line, text, self.fed / RATE, took)

    def _settle(self):
        """Every line the detector closed (a pause, or 15 s of talking) is read once more and settles."""
        while not self.vad.empty():
            seg = self.vad.front
            end = seg.start + len(seg.samples)
            self.vad.pop()
            if not self.speaking:  # a line too short to have been seen starting
                self.line += 1
                self.line_start = max(self.buf_start, seg.start - self.PRE // 2)
            text, took = self._read(self.line_start, min(self.fed, end + int(0.25 * RATE)), True)
            self.emit("final", self.line, text, self.fed / RATE, took)
            self.speaking = False
            # Keep what came after the line: the start of the next one, if the talking goes on
            drop = max(0, min(end, self.fed) - self.buf_start)
            self.buf_start += drop
            self.buf = self.buf[drop:]

    def stop(self):
        if len(self.pending):
            self.vad.accept_waveform(self.pending)
            self.buf = np.concatenate([self.buf, self.pending])
            self.fed += len(self.pending)
            self.pending = np.zeros(0, np.float32)
        self.vad.flush()
        self._settle()
        if self.speaking:  # cut off mid-word: read what there is
            text, took = self._read(self.line_start, self.fed, True)
            self.emit("final", self.line, text, self.fed / RATE, took)
            self.speaking = False


def offline(models_dir, name, threads):
    """NVIDIA Parakeet TDT 0.6B v3 (int8, sherpa-onnx): 25 European languages, German and Hungarian included, finds
    the language by itself, writes punctuation and capitals. Not a streaming model: it reads a whole line at once."""
    import sherpa_onnx

    folder = sherpa_model(models_dir, name, f"Parakeet v3 ({SIZES[name]})")
    return sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(folder / "encoder.int8.onnx"),
        decoder=str(folder / "decoder.int8.onnx"),
        joiner=str(folder / "joiner.int8.onnx"),
        tokens=str(folder / "tokens.txt"),
        num_threads=threads,
        model_type="nemo_transducer",
        decoding_method="greedy_search",
    )


def read_line(rec, audio):
    s = rec.create_stream()
    s.accept_waveform(RATE, audio)
    rec.decode_stream(s)
    return s.result.text


def parakeet(spec, models_dir, threads):
    rec = offline(models_dir, spec["dir"], threads)
    return Lines(lambda audio, lang, final: read_line(rec, audio), silero_vad(models_dir))


class WhisperReader:
    """OpenAI's Whisper on the GPU (faster-whisper): 99 languages, punctuation and capitals. Not a streaming model, so
    Lines reads the line again while you talk. One read costs about the same whatever its length (a whole 30 s window
    goes through the model every time), so the words come in steps of ~0.4 s."""

    def __init__(self, spec, models_dir):
        cuda_libs()
        from faster_whisper import WhisperModel

        folder = hf_model(spec["repo"], WHISPER_FILES, models_dir, spec["what"])
        # int8 weights with float16 maths: half the video memory and just as quick (measured on an RTX 4060 Laptop)
        self.model = WhisperModel(str(folder), device="cuda", compute_type="int8_float16")
        self.fixed = spec.get("lang")
        self.heard = None  # the language being spoken, when it's found by itself: known once 3 s of talk were looked at
        self.sure = False  # already looked at this line for it
        self(np.zeros(RATE, np.float32), "", False)  # the first read is the slow one: get it over with now

    def __call__(self, audio, lang, final):
        language = self.fixed or (None if lang in ("auto", "") else lang)
        enough = len(audio) >= 3 * RATE
        # Finding the language costs a read of its own: at the start of a line it goes by the line before; once it's
        # 3 s long it looks once, and the finished line once more
        if language is None and self.heard and (not enough or (self.sure and not final)):
            language = self.heard
        segments, info = self.model.transcribe(
            audio,
            language=language,
            initial_prompt=WHISPER_STYLE.get(language or self.heard),
            beam_size=5 if final else 1,
            temperature=0.0,
            condition_on_previous_text=False,
            without_timestamps=True,
            vad_filter=False,
        )
        text = " ".join(s.text.strip() for s in segments)
        if language is None and enough:
            self.heard = info.language
            self.sure = True
        if final:
            self.sure = False
        return text


def whisper(spec, models_dir, threads):
    return Lines(WhisperReader(spec, models_dir), silero_vad(models_dir))


class Streaming:
    """A true streaming model (sherpa-onnx): NVIDIA Nemotron 3.5 ASR Streaming 0.6B hears the audio in 0.56 s steps
    and keeps its place, so nothing is read twice and the words come at a steady pace, in 40 languages from one model
    (German among the best, Hungarian usable). A pause of 0.8 s, or 15 s of talking, ends the line. With "final", a
    second model (Parakeet v3) reads the finished line once more: more exact, Hungarian above all."""

    def __init__(self, spec, models_dir, threads):
        import sherpa_onnx

        folder = sherpa_model(models_dir, spec["dir"], f"Nemotron 3.5 ({SIZES[spec['dir']]})")
        self.rec = sherpa_onnx.OnlineRecognizer.from_transducer(
            tokens=str(folder / "tokens.txt"),
            encoder=str(folder / "encoder.int8.onnx"),
            decoder=str(folder / "decoder.int8.onnx"),
            joiner=str(folder / "joiner.int8.onnx"),
            num_threads=threads,
            enable_endpoint_detection=True,
            rule1_min_trailing_silence=2.4,
            rule2_min_trailing_silence=0.8,
            rule3_min_utterance_length=15,
            decoding_method="greedy_search",
        )
        self.final = offline(models_dir, spec["final"], threads) if spec.get("final") else None

    def start(self, emit, lang):
        self.emit = emit
        self.lang = lang
        self.line = 1
        self.fed = 0
        self.last = ""
        self.audio = []  # the line so far, for the second read
        self.stream = self.rec.create_stream()
        if lang and lang != "auto":
            self.stream.set_option("language", lang)

    def add(self, samples):
        t = time.perf_counter()
        self.stream.accept_waveform(RATE, samples)
        self.fed += len(samples)
        if self.final is not None:
            self.audio.append(samples)
        while self.rec.is_ready(self.stream):
            self.rec.decode_stream(self.stream)
        text = self.rec.get_result(self.stream).strip()
        if text and text != self.last:
            self.last = text
            self.emit("partial", self.line, text, self.fed / RATE, time.perf_counter() - t)
        if self.rec.is_endpoint(self.stream):
            self._settle(text)

    def _settle(self, text):
        took = None
        if text and self.final is not None and self.audio:
            t = time.perf_counter()
            text = read_line(self.final, np.concatenate(self.audio)).strip() or text
            took = time.perf_counter() - t
        if text:
            self.emit("final", self.line, text, self.fed / RATE, took)
            self.line += 1
        self.rec.reset(self.stream)
        self.last = ""
        self.audio = []

    def stop(self):
        # A little silence so the last 0.56 s step is heard, then the line ends
        tail = np.zeros(int(0.8 * RATE), np.float32)
        self.stream.accept_waveform(RATE, tail)
        self.stream.input_finished()
        while self.rec.is_ready(self.stream):
            self.rec.decode_stream(self.stream)
        self._settle(self.rec.get_result(self.stream).strip())


def load(name, models_dir, threads):
    spec = MODELS[name]
    return {"moonshine": Moonshine, "streaming": Streaming, "parakeet": parakeet, "whisper": whisper}[spec["engine"]](spec, models_dir, threads)


def on_disk(name, models_dir):
    spec = MODELS[name]
    root = Path(models_dir)
    if spec["engine"] == "moonshine":
        return any((root / "moonshine" / "download.moonshine.ai" / "model" / spec["dir"]).glob("*/encoder.ort"))
    if spec["engine"] == "whisper":
        return hf_on_disk(spec["repo"], WHISPER_FILES, models_dir) is not None
    return all((root / "sherpa" / d / "tokens.txt").exists() for d in (spec["dir"], spec.get("final")) if d)


# --- the loop ---------------------------------------------------------------------------------------------------------
def serve(name, models_dir, threads):
    t = time.perf_counter()
    try:
        engine = load(name, models_dir, threads)
    except Exception as e:  # a missing package, a failed download, no GPU …
        say(t="error", text=f"{type(e).__name__}: {e}")
        return 1
    say(t="ready", model=name, load_s=round(time.perf_counter() - t, 2))

    active = False
    audio_s = compute_s = 0.0
    sid = None

    def emit(kind, line, text, at, took=None):
        msg = {"t": kind, "sid": sid, "line": int(line), "text": text, "at": round(at, 2)}
        if took is not None:
            msg["ms"] = round(took * 1000)
        say(**msg)

    # A thread reads the mic so it never waits for the model: whatever came in during a pass goes into the next one as a
    # single piece. A slow moment (the PC busy, a long pass) then costs one bigger pass, and the words catch up, instead
    # of a queue that the model works through 100 ms at a time and that stays long for the rest of the dictation.
    inbox = queue.SimpleQueue()

    def read_stdin():
        for raw in sys.stdin.buffer:
            try:
                inbox.put(json.loads(raw))
            except ValueError:
                pass
        inbox.put({"t": "quit"})  # stdin closed: Tyler is gone

    threading.Thread(target=read_stdin, daemon=True).start()
    samples = lambda m: np.frombuffer(base64.b64decode(m["pcm"]), dtype="<i2").astype(np.float32) / 32768.0  # noqa: E731
    next_msg = None

    while True:
        msg, next_msg = (next_msg or inbox.get()), None
        kind = msg.get("t")
        try:
            if kind == "start":
                if active:
                    engine.stop()
                sid = msg.get("sid")
                engine.start(emit, msg.get("lang") or "auto")
                active = True
                audio_s = compute_s = 0.0
            elif kind == "audio" and active:
                pieces = [samples(msg)]
                while next_msg is None:
                    try:
                        waiting = inbox.get_nowait()
                    except queue.Empty:
                        break
                    if waiting.get("t") == "audio":
                        pieces.append(samples(waiting))
                    else:
                        next_msg = waiting
                pcm = np.concatenate(pieces) if len(pieces) > 1 else pieces[0]
                t = time.perf_counter()
                engine.add(pcm)
                compute_s += time.perf_counter() - t
                audio_s += len(pcm) / RATE
            elif kind == "stop" and active:
                t = time.perf_counter()
                engine.stop()
                compute_s += time.perf_counter() - t
                active = False
                say(t="stopped", sid=sid, audio_s=round(audio_s, 2), compute_s=round(compute_s, 3), rtf=round(compute_s / audio_s, 3) if audio_s else None)
            elif kind == "quit":
                os._exit(0)  # skip the slow tidy-up of the model's threads
        except Exception as e:
            say(t="error", sid=sid, text=f"{type(e).__name__}: {e}")
            active = False


def main():
    full_speed()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", choices=sorted(MODELS))
    ap.add_argument("--download", choices=sorted(MODELS))
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--models-dir", default=str(Path(__file__).resolve().parents[2] / "studio" / ".cache" / "ears"))
    ap.add_argument("--threads", type=int, default=4)
    a = ap.parse_args()
    if a.list:
        say(t="models", models={k: on_disk(k, a.models_dir) for k in MODELS})
        return 0
    if a.download:
        try:
            load(a.download, a.models_dir, a.threads)
            say(t="downloaded", model=a.download)
            return 0
        except Exception as e:
            say(t="error", text=f"{type(e).__name__}: {e}")
            return 1
    if a.model:
        return serve(a.model, a.models_dir, a.threads)
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
