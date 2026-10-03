import asyncio
from contextlib import contextmanager, nullcontext
import copy
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from unittest.mock import Mock
from types import SimpleNamespace

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError
import desktop_adapter as d


class DB:
    def __init__(self, path): self.path = path
    @contextmanager
    def connect(self):
        c = sqlite3.connect(self.path)
        try:
            with c: yield c
        finally: c.close()


class FakeWindows:
    available = True
    def __init__(self):
        self.w = dict(hwnd=123,pid=456,title=d.TITLE+' - Google Chrome',executable=d.CHROME,rect=(0,0,1200,1000),dpi=96)
        self.moves=[]; self.clicks=[]; self.owner=123; self.after_move=None
    def foreground(self): return copy.deepcopy(self.w)
    def screen(self): return (-1200,0,2400,1200)
    def point_owner(self,x,y): return self.owner
    def move(self,x,y):
        self.moves.append((x,y))
        if self.after_move: self.after_move()
    def click(self,x,y): self.clicks.append((x,y))


class DesktopTests(unittest.TestCase):
    def setUp(self):
        parent=d.BASE/'work/tests';parent.mkdir(parents=True,exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(prefix='desktop-',dir=parent)
        self.db=DB(str(Path(self.temp.name)/'test.sqlite3'));self.native=FakeWindows();self.time=100.0
        self.a=d.Adapter(self.db,native=self.native,clock=lambda:self.time)
    def tearDown(self): self.temp.cleanup()
    def point(self, token, **xy): return d.PointAction(token=token,**(xy or self.a.window()['test_point']))

    def test_disarmed_wrong_token_expiry_stop(self):
        with self.assertRaises(HTTPException):self.a.act('move',self.point('x'*43))
        armed=self.a.arm()
        with self.assertRaises(HTTPException):self.a.act('move',self.point('y'*43))
        self.assertEqual(self.native.moves,[])
        self.time+=46
        with self.assertRaises(HTTPException):self.a.act('move',self.point(armed['token']))
        self.assertFalse(self.a.status()['armed'])
        self.a.arm();self.a.stop();self.assertFalse(self.a.status()['armed'])

    def test_move_full_desktop_click_only_test_area(self):
        token=self.a.arm()['token'];self.a.act('move',self.point(token,x=-300,y=200))
        self.assertEqual(self.native.moves,[(-300,200)])
        self.time+=1
        with self.assertRaises(HTTPException) as error:self.a.act('click',self.point(token,x=-300,y=200))
        self.assertEqual(error.exception.status_code,403);self.assertEqual(self.native.clicks,[])
        token=self.a.arm()['token'];point=self.a.window()['test_point'];self.a.act('click',self.point(token))
        self.assertEqual(self.native.clicks,[(point['x'],point['y'])])

    def test_non_ascii_session_token_is_denied_without_mouse_move(self):
        self.a.arm()
        with self.assertRaises(HTTPException) as error:
            self.a.act('move', self.point('\u00e9' * 43))
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.native.moves, [])

    def test_password_other_process_or_window_denied(self):
        for update in ({'title':'NEXEN — Secure access'}, {'title':d.TITLE+' - Password'}, {'executable':r'C:\malicious\chrome.exe'}):
            old=copy.deepcopy(self.native.w);self.native.w.update(update)
            with self.assertRaises(HTTPException):self.a.arm()
            self.native.w=old
        token=self.a.arm()['token'];self.native.w['pid']=999
        with self.assertRaises(HTTPException):self.a.act('move',self.point(token))
        self.assertEqual(self.native.moves,[])

    def test_overlay_or_foreground_change_prevents_click(self):
        token=self.a.arm()['token'];self.native.owner=999
        with self.assertRaises(HTTPException):self.a.act('click',self.point(token))
        self.assertEqual(self.native.moves,[])
        self.native.owner=123;token=self.a.arm()['token']
        self.native.after_move=lambda:self.native.w.update(title='Other private window')
        with self.assertRaises(HTTPException):self.a.act('click',self.point(token))
        self.assertEqual(self.native.clicks,[]);self.assertFalse(self.a.status()['armed'])

    def test_bounds_and_input_validation(self):
        token=self.a.arm()['token']
        with self.assertRaises(HTTPException) as error:self.a.act('move',self.point(token,x=2400,y=100))
        self.assertEqual(error.exception.status_code,422);self.assertEqual(self.native.moves,[])
        for value in (True,1.1,float('nan'),'100',100001):
            with self.assertRaises(ValidationError):d.PointAction(x=value,y=100,token='x'*43)
        with self.assertRaises(ValidationError):d.Empty(command='run anything')

    def test_rate_limit_action_limit_and_sanitized_status_log(self):
        token=self.a.arm()['token'];self.a.act('move',self.point(token))
        with self.assertRaises(HTTPException) as error:self.a.act('move',self.point(token))
        self.assertEqual(error.exception.status_code,429)
        self.a.actions=20;self.time+=1
        with self.assertRaises(HTTPException):self.a.act('move',self.point(token))
        status=str(self.a.status())
        self.assertNotIn(token,status);self.assertNotIn(d.CHROME,status)
        with self.db.connect() as c:rows=str(c.execute('SELECT * FROM desktop_events').fetchall())
        self.assertNotIn(token,rows);self.assertNotIn(self.native.w['title'],rows)

    def test_native_boundary_rejects_drag_without_loading_windows(self):
        native=d.Windows.__new__(d.Windows)
        native.pixels=nullcontext
        native.u=SimpleNamespace(GetAsyncKeyState=lambda key:0x8000 if key==1 else 0,SetCursorPos=Mock(),SendInput=Mock())
        with self.assertRaises(RuntimeError):native.move(200,200)
        with self.assertRaises(RuntimeError):native.click(200,200)
        native.u.SetCursorPos.assert_not_called();native.u.SendInput.assert_not_called()

    def test_http_rejects_remote_private_and_cross_origin(self):
        async def exercise():
            app=FastAPI()
            @app.middleware('http')
            async def fixture_private(request,call_next):
                if request.headers.get('x-test-private')=='yes':request.state.private_access=True
                return await call_next(request)
            with patch.object(d,'Adapter',return_value=self.a):d.register(app,self.db)
            transport=httpx.ASGITransport(app=app,client=('127.0.0.1',50000))
            async with httpx.AsyncClient(transport=transport,base_url='http://127.0.0.1:8788') as client:
                good={'Origin':'http://127.0.0.1:8788','X-Nexen-Action':'launch'}
                self.assertEqual((await client.post('/api/desktop/arm',json={})).status_code,403)
                self.assertEqual((await client.post('/api/desktop/arm',json={},headers=dict(good,Origin='https://example.test'))).status_code,403)
                self.assertEqual((await client.get('/api/desktop/status',headers={'x-test-private':'yes'})).status_code,403)
                self.assertEqual((await client.post('/api/desktop/arm',json={},headers=dict(good,**{'x-test-private':'yes'}))).status_code,403)
                self.assertEqual((await client.post('/api/desktop/arm',json={},headers=good)).status_code,200)
            remote=httpx.ASGITransport(app=app,client=('192.0.2.8',50000))
            async with httpx.AsyncClient(transport=remote,base_url='http://127.0.0.1:8788') as client:
                self.assertEqual((await client.get('/api/desktop/status')).status_code,403)
        asyncio.run(exercise())


if __name__=='__main__':unittest.main()
