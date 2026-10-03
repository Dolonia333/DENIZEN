import asyncio
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from fastapi import FastAPI
import httpx
import voice_runtime as voice


class VoiceTests(unittest.TestCase):
    def test_exact_navigation_and_numbered_targets(self):
        self.assertEqual(voice.interpret('Jarvis, open money engine'),dict(type='navigate',path='/money'))
        self.assertEqual(voice.interpret('go to W D R city'),dict(type='navigate',path='/game'))
        self.assertEqual(voice.interpret('move to number twenty three'),dict(type='focus_target',number=23))
        self.assertEqual(voice.interpret('click five'),dict(type='click_target',number=5))
        self.assertEqual(voice.interpret('stop listening'),dict(type='stop'))
        self.assertEqual(voice.interpret('task completed'),dict(type='complete_current'))
        self.assertEqual(voice.interpret('do this task'),dict(type='do_current'))
        self.assertEqual(voice.interpret('read current task'),dict(type='read_current'))
        self.assertEqual(voice.interpret('Automatic mode'),dict(type='automatic_mode',enabled=True))
        self.assertEqual(voice.interpret('stop automatic mode'),dict(type='automatic_mode',enabled=False))
        self.assertEqual(voice.interpret('open memory pools'),dict(type='navigate',path='/memory-pools'))

    def test_untrusted_or_ambiguous_speech_never_becomes_execution(self):
        for phrase in ('delete all files','open https://example.com','click 101','click 0','open money and pay fifty dollars','run powershell','approve everything'):
            self.assertEqual(voice.interpret(phrase)['type'],'unknown')

    def test_audio_boundary_origin_and_low_confidence(self):
        async def run():
            app=FastAPI();voice.register(app)
            headers={'Origin':'http://127.0.0.1:8788','X-Nexen-Action':'launch','Content-Type':'application/octet-stream'}
            engine=SimpleNamespace(transcribe=lambda pcm:dict(text='open money engine',confidence=.5))
            transport=httpx.ASGITransport(app=app,client=('127.0.0.1',55555))
            async with httpx.AsyncClient(transport=transport,base_url='http://127.0.0.1:8788') as c:
                self.assertEqual((await c.post('/api/voice/transcribe',content=b'00')).status_code,403)
                self.assertEqual((await c.post('/api/voice/transcribe',content=b'00',headers={**headers,'Content-Type':'text/plain'})).status_code,415)
                self.assertEqual((await c.post('/api/voice/transcribe',content=b'0',headers=headers)).status_code,422)
                self.assertEqual((await c.post('/api/voice/transcribe',content=b'0'*(voice.MAX_BYTES+2),headers=headers)).status_code,413)
                with patch.object(voice,'engine_status',return_value={'ready':True}),patch.object(voice.importlib,'import_module',return_value=engine):
                    result=await c.post('/api/voice/transcribe',content=b'00'*1000,headers=headers)
                    self.assertEqual(result.status_code,200)
                    self.assertEqual(result.json()['command']['type'],'unknown')
                    self.assertFalse(result.json()['audio_saved'])
                    self.assertFalse(result.json()['executed'])
                    for confidence in (None, True, 'high', float('nan'), float('inf'), 1.1):
                        engine.transcribe=lambda pcm:dict(text='click five',confidence=confidence)
                        result=await c.post('/api/voice/transcribe',content=b'00'*1000,headers=headers)
                        self.assertEqual(result.status_code,200)
                        self.assertEqual(result.json()['command']['type'],'unknown')
                    engine.transcribe=lambda pcm:dict(text='open money engine',confidence=.96)
                    result=await c.post('/api/voice/transcribe',content=b'00'*1000,headers=headers)
                    self.assertEqual(result.json()['command']['path'],'/money')
        asyncio.run(run())


if __name__=='__main__':unittest.main()
