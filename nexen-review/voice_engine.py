"""Local CPU transcription of caller-supplied PCM. No capture, network or actions."""
import importlib
import json
import math
from pathlib import Path
import sys
import threading

BASE = Path(__file__).resolve().parent
RUNTIME = BASE / 'harnesses' / 'voice-python'
MODEL = Path('F:/NEXEN_CACHE/models/vosk-small-en-us')
SAMPLE_RATE = 16000
MAX_BYTES = SAMPLE_RATE * 2 * 20
_lock = threading.RLock()
_model = None
_vosk = None


def _load():
    global _model, _vosk
    with _lock:
        if _model is not None:
            return _model, _vosk
        if not (RUNTIME / 'vosk' / '__init__.py').is_file():
            raise RuntimeError('Local Vosk runtime is not installed yet.')
        required = ('am/final.mdl', 'conf/model.conf', 'graph/HCLr.fst', 'graph/Gr.fst')
        if not all((MODEL / name).is_file() for name in required):
            raise RuntimeError('Local English model files are not complete yet.')
        if str(RUNTIME) not in sys.path:
            sys.path.insert(0, str(RUNTIME))
        vosk = importlib.import_module('vosk')
        # An explicit existing model path prevents the package's download helper.
        vosk.SetLogLevel(-1)
        model = vosk.Model(model_path=str(MODEL))
        _model, _vosk = model, vosk
        return model, vosk


def status():
    try:
        _load()
        return dict(ready=True, engine='vosk-local', detail='Local English CPU recognition is ready. Input: mono 16 kHz signed 16-bit PCM, up to 20 seconds.')
    except Exception as exc:
        detail = str(exc) if isinstance(exc, RuntimeError) else 'Local speech runtime could not load (' + type(exc).__name__ + ').'
        return dict(ready=False, engine='vosk-local', detail=detail)


def transcribe(pcm: bytes):
    if not isinstance(pcm, bytes):
        raise TypeError('Expected PCM bytes.')
    if not pcm or len(pcm) % 2:
        raise ValueError('PCM must contain complete signed 16-bit samples.')
    if len(pcm) > MAX_BYTES:
        raise ValueError('Audio exceeds the 20-second limit.')
    if pcm.startswith(b'RIFF') or pcm.startswith(b'OggS'):
        raise ValueError('Send raw mono 16 kHz PCM, without a media container.')
    with _lock:
        model, vosk = _load()
        recognizer = vosk.KaldiRecognizer(model, SAMPLE_RATE)
        recognizer.SetWords(True)
        segments = []
        for start in range(0, len(pcm), 8000):
            if recognizer.AcceptWaveform(pcm[start:start + 8000]):
                segments.append(json.loads(recognizer.Result()))
        segments.append(json.loads(recognizer.FinalResult()))
        text = ' '.join(part.get('text', '').strip() for part in segments if part.get('text', '').strip())
        confidences = [float(word['conf']) for part in segments for word in part.get('result', [])
                       if isinstance(word.get('conf'), (int, float)) and math.isfinite(word['conf']) and 0 <= word['conf'] <= 1]
        return dict(text=text, confidence=round(sum(confidences) / len(confidences), 4) if confidences else None)
