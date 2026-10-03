"""Local PCM transcription and deterministic UI intents; no desktop input here."""
import importlib
import re
import threading
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

BASE=Path(__file__).resolve().parent
MAX_BYTES=16000*2*20
ROUTES={
 'home':'/','main page':'/','dashboard':'/','nexen':'/',
 'money engine':'/money','money':'/money','lumipaw':'/money',
 'game':'/game','city':'/game','wdr city':'/game','w d r city':'/game',
 'tasks':'/tasks','task room':'/tasks','my tasks':'/tasks',
 'day':'/day','daily plan':'/day','checklist':'/day',
 'plans':'/plans','consolidated plans':'/plans',
 'lookbook':'/lookbook','look book':'/lookbook','wdr lookbook':'/lookbook',
 'connections':'/connections','required steps':'/connections','needs you':'/connections',
 'photos':'/photos','life photos':'/photos','problems':'/problems',
 'local lab':'/lab','diagnostics':'/diagnostics','voice controls':'/voice',
 'next step':'/next','current task':'/next','desktop controls':'/desktop',
 'memory pool':'/memory-pools','knowledge flow':'/memory-pools','memory pools':'/memory-pools',
 'automatic mode':'/automatic-mode','check in':'/check-in','mood':'/check-in',
 'photo cases':'/problem-cases','storage':'/storage',
}
ONES='zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split()
TENS={'twenty':20,'thirty':30,'forty':40,'fifty':50,'sixty':60,'seventy':70,'eighty':80,'ninety':90}


class SpokenText(BaseModel):
    model_config=ConfigDict(extra='forbid')
    text:str=Field(min_length=1,max_length=500)


def number(text):
    if text.isdigit(): value=int(text)
    elif text in ONES:value=ONES.index(text)
    elif text in ('one hundred','a hundred'):value=100
    else:
        parts=text.split()
        if len(parts)==1 and parts[0] in TENS:value=TENS[parts[0]]
        elif len(parts)==2 and parts[0] in TENS and parts[1] in ONES[1:10]:value=TENS[parts[0]]+ONES.index(parts[1])
        else:return None
    return value if 1<=value<=100 else None


def interpret(text):
    clean=' '.join(re.sub(r'[^a-z0-9 ]',' ',text.lower()).split())
    clean=re.sub(r'^(?:hey )?(?:jarvis|nexen|nexon) ','',clean)
    if clean in ('stop','stop listening','cancel listening','stop recording'):
        return dict(type='stop')
    if clean in ('automatic mode','activate automatic mode','enable automatic mode'):
        return dict(type='automatic_mode',enabled=True)
    if clean in ('disable automatic mode','automatic mode off','stop automatic mode'):
        return dict(type='automatic_mode',enabled=False)
    if clean in ('task completed','task complete','complete current task'):
        return dict(type='complete_current')
    if clean in ('do this task','do current task','start this task','okay do it'):
        return dict(type='do_current')
    if clean in ('read current task','read this task','what is next'):
        return dict(type='read_current')
    if clean in ('show numbers','show targets','number the buttons'):
        return dict(type='show_numbers')
    if clean in ('scroll up','scroll down'):
        return dict(type='scroll',direction=clean.split()[-1])
    destination=re.fullmatch(r'(?:open|go to|show) (.+)',clean)
    if destination and destination[1] in ROUTES:
        return dict(type='navigate',path=ROUTES[destination[1]])
    target=re.fullmatch(r'(click|focus|select|move to|point to) (?:number |target |button )?(.+)',clean)
    if target and (value:=number(target[2])) is not None:
        return dict(type='click_target' if target[1]=='click' else 'focus_target',number=value)
    return dict(type='unknown',message='Try “open money engine”, “show numbers”, “focus five”, “click five”, “scroll down” or “stop”. Only listed NEXEN controls are supported.')


def engine_status():
    try:
        engine=importlib.import_module('voice_engine')
        result=engine.status()
        return dict(ready=bool(result.get('ready')),engine=str(result.get('engine','Vosk')),
                    detail=str(result.get('detail','Local recognition status available.')))
    except (ImportError,OSError,RuntimeError):
        return dict(ready=False,engine='Vosk',detail='The local speech engine is not ready yet. Typed commands still work.')


def register(app,db=None):
    busy=threading.Lock()

    @app.get('/voice',response_class=HTMLResponse)
    def voice_page():return (BASE/'voice.html').read_text(encoding='utf-8')

    @app.get('/api/voice/status')
    def status():
        return dict(**engine_status(),audio_storage='not_saved',local_only=True,
                    max_seconds=20,sample_rate=16000,
                    desktop_control='scoped_adapter_available',
                    desktop_detail='The separate Desktop Control page can arm a short local session for its dedicated Chrome test window. This voice panel controls NEXEN navigation and the selected task; a general business-task desktop executor is still pending.',
                    commands=['open money engine','open game','open tasks','show numbers','focus five','click five','scroll down','stop'])

    @app.post('/api/voice/interpret')
    def parse(body:SpokenText,request:Request):
        from pc_control import validate_request
        validate_request(request,mutation=True)
        return dict(command=interpret(body.text),executed=False)

    @app.post('/api/voice/transcribe')
    async def transcribe(request:Request):
        from pc_control import validate_request
        validate_request(request,mutation=True)
        if request.headers.get('content-type','').split(';')[0] not in ('application/octet-stream','audio/pcm'):
            raise HTTPException(415,'Send mono 16 kHz PCM, signed 16-bit little endian.')
        if not busy.acquire(blocking=False):
            raise HTTPException(429,'Another voice command is being transcribed. Try again shortly.')
        try:
            chunks=bytearray()
            async for chunk in request.stream():
                if len(chunks)+len(chunk)>MAX_BYTES:raise HTTPException(413,'Record at most 20 seconds per command.')
                chunks.extend(chunk)
            if not chunks or len(chunks)%2:raise HTTPException(422,'Audio must contain complete 16-bit PCM samples.')
            if not engine_status()['ready']:raise HTTPException(503,'Local speech recognition is not ready. Use the typed-command field.')
            try:
                engine=importlib.import_module('voice_engine')
                result=await run_in_threadpool(engine.transcribe,bytes(chunks))
            except (ImportError,OSError,RuntimeError,ValueError) as exc:
                raise HTTPException(503,'Local transcription failed. No command was executed.') from exc
            text=str(result.get('text','')).strip()[:500]
            confidence=result.get('confidence')
            command=interpret(text)
            if not text:command=dict(type='unknown',message='No speech was recognized. Try again close to the microphone.')
            elif isinstance(confidence,bool) or not isinstance(confidence,(int,float)) or not 0.70 <= confidence <= 1.0:
                confidence = None if isinstance(confidence,bool) or not isinstance(confidence,(int,float)) or not 0 <= confidence <= 1 else confidence
                command=dict(type='unknown',message='Recognition confidence was low. Check the transcript and retry or type the command.')
            return dict(text=text,confidence=confidence,command=command,executed=False,audio_saved=False)
        finally:busy.release()
