"""Contract tests use synthetic PCM and a fake recognizer, never a microphone."""
import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import voice_engine as engine


class VoiceTests(unittest.TestCase):
    def test_invalid_input_never_loads_model(self):
        with patch.object(engine, '_load') as load:
            for value in (b'', b'\x00', b'RIFF'+b'\x00'*10, b'OggS'+b'\x00'*10, b'\x00'*(engine.MAX_BYTES+2)):
                with self.assertRaises(ValueError): engine.transcribe(value)
            with self.assertRaises(TypeError): engine.transcribe('private text')
            load.assert_not_called()

    def test_text_and_word_confidence_aggregation(self):
        recognizer = Mock()
        recognizer.AcceptWaveform.side_effect = [True, False]
        recognizer.Result.return_value = json.dumps({'text':'open the money page', 'result':[{'conf':0.8},{'conf':1.0}]})
        recognizer.FinalResult.return_value = json.dumps({'text':'show tasks', 'result':[{'conf':0.9},{'conf':'high'},{'conf':float('nan')},{'conf':-1},{'conf':2}]})
        vosk = SimpleNamespace(KaldiRecognizer=Mock(return_value=recognizer))
        model = object()
        with patch.object(engine, '_load', return_value=(model, vosk)):
            result = engine.transcribe(b'\x00'*16000)
        self.assertEqual(result, {'text':'open the money page show tasks', 'confidence':0.9})
        vosk.KaldiRecognizer.assert_called_once_with(model, 16000)
        recognizer.SetWords.assert_called_once_with(True)

    def test_silence_confidence_unknown_and_twenty_second_boundary(self):
        recognizer = Mock()
        recognizer.AcceptWaveform.return_value = False
        recognizer.FinalResult.return_value = '{"text":""}'
        vosk = SimpleNamespace(KaldiRecognizer=Mock(return_value=recognizer))
        with patch.object(engine, '_load', return_value=(object(), vosk)):
            result = engine.transcribe(b'\x00'*engine.MAX_BYTES)
        self.assertEqual(result, {'text':'', 'confidence':None})

    def test_failure_status_does_not_claim_ready(self):
        with patch.object(engine, '_load', side_effect=RuntimeError('Model not complete')):
            self.assertEqual(engine.status(), {'ready':False,'engine':'vosk-local','detail':'Model not complete'})


if __name__ == '__main__': unittest.main()
