"""Short, explicit local mouse sessions. No keyboard, shell, or background input."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hmac
import math
import ntpath
import os
from pathlib import Path
import secrets
import threading
import time

from fastapi import HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ConfigDict, Field

BASE = Path(__file__).resolve().parent
TITLE = 'NEXEN — Desktop Control'
CHROME = ntpath.normcase(r'C:\Program Files\Google\Chrome\Application\chrome.exe')
ARM_SECONDS = 45


class Empty(BaseModel):
    model_config = ConfigDict(extra='forbid')


class PointAction(BaseModel):
    model_config = ConfigDict(extra='forbid')
    x: int = Field(strict=True, ge=-100000, le=100000)
    y: int = Field(strict=True, ge=-100000, le=100000)
    token: str = Field(min_length=32, max_length=128)


class Windows:
    """Win32 interface used by the application, replaceable in all tests."""
    def __init__(self):
        self.available = os.name == 'nt'
        if not self.available:
            return
        import ctypes as c
        from ctypes import wintypes as w
        self.c, self.w = c, w
        self.u = c.WinDLL('user32', use_last_error=True)
        self.k = c.WinDLL('kernel32', use_last_error=True)
        bindings = [(self.u, 'GetForegroundWindow', [], w.HWND),
                    (self.u, 'GetWindowTextW', [w.HWND, w.LPWSTR, c.c_int], c.c_int),
                    (self.u, 'GetWindowThreadProcessId', [w.HWND, c.POINTER(w.DWORD)], w.DWORD),
                    (self.u, 'GetClientRect', [w.HWND, c.POINTER(w.RECT)], w.BOOL),
                    (self.u, 'ClientToScreen', [w.HWND, c.POINTER(w.POINT)], w.BOOL),
                    (self.u, 'GetSystemMetrics', [c.c_int], c.c_int),
                    (self.u, 'GetDpiForWindow', [w.HWND], w.UINT),
                    (self.u, 'GetAncestor', [w.HWND, w.UINT], w.HWND),
                    (self.u, 'WindowFromPoint', [w.POINT], w.HWND),
                    (self.u, 'GetCursorPos', [c.POINTER(w.POINT)], w.BOOL),
                    (self.u, 'SetCursorPos', [c.c_int, c.c_int], w.BOOL),
                    (self.u, 'GetAsyncKeyState', [c.c_int], c.c_short),
                    (self.u, 'SetThreadDpiAwarenessContext', [c.c_void_p], c.c_void_p),
                    (self.k, 'OpenProcess', [w.DWORD, w.BOOL, w.DWORD], w.HANDLE),
                    (self.k, 'QueryFullProcessImageNameW', [w.HANDLE, w.DWORD, w.LPWSTR, c.POINTER(w.DWORD)], w.BOOL),
                    (self.k, 'CloseHandle', [w.HANDLE], w.BOOL)]
        for lib, name, args, result in bindings:
            fn = getattr(lib, name); fn.argtypes = args; fn.restype = result
        class Mouse(c.Structure):
            _fields_ = [('dx', w.LONG), ('dy', w.LONG), ('mouseData', w.DWORD),
                        ('dwFlags', w.DWORD), ('time', w.DWORD), ('dwExtraInfo', c.c_size_t)]
        class Keyboard(c.Structure):
            _fields_ = [('wVk', w.WORD), ('wScan', w.WORD), ('dwFlags', w.DWORD), ('time', w.DWORD), ('dwExtraInfo', c.c_size_t)]
        class Hardware(c.Structure):
            _fields_ = [('uMsg', w.DWORD), ('wParamL', w.WORD), ('wParamH', w.WORD)]
        class Data(c.Union):
            _fields_ = [('mi', Mouse), ('ki', Keyboard), ('hi', Hardware)]
        class Input(c.Structure):
            _anonymous_ = ('data',)
            _fields_ = [('type', w.DWORD), ('data', Data)]
        self.Input = Input
        self.u.SendInput.argtypes = [w.UINT, c.POINTER(Input), c.c_int]
        self.u.SendInput.restype = w.UINT

    @contextmanager
    def pixels(self):
        old = self.u.SetThreadDpiAwarenessContext(self.c.c_void_p(-4))
        if not old:
            raise RuntimeError('Physical-pixel coordinate context unavailable.')
        try:
            yield
        finally:
            self.u.SetThreadDpiAwarenessContext(old)

    def foreground(self):
        if not self.available:
            raise RuntimeError('Windows mouse interface unavailable.')
        with self.pixels():
            hwnd = self.u.GetForegroundWindow()
            if not hwnd:
                raise RuntimeError('No foreground window.')
            text = self.c.create_unicode_buffer(512)
            self.u.GetWindowTextW(hwnd, text, 512)
            pid = self.w.DWORD()
            self.u.GetWindowThreadProcessId(hwnd, self.c.byref(pid))
            handle = self.k.OpenProcess(0x1000, False, pid.value)
            if not handle:
                raise RuntimeError('Foreground process cannot be verified.')
            try:
                name = self.c.create_unicode_buffer(32768); length = self.w.DWORD(32768)
                if not self.k.QueryFullProcessImageNameW(handle, 0, name, self.c.byref(length)):
                    raise RuntimeError('Foreground process cannot be verified.')
            finally:
                self.k.CloseHandle(handle)
            rect = self.w.RECT(); point = self.w.POINT(0, 0)
            if not self.u.GetClientRect(hwnd, self.c.byref(rect)) or not self.u.ClientToScreen(hwnd, self.c.byref(point)):
                raise RuntimeError('Foreground client rectangle unavailable.')
            return dict(hwnd=int(hwnd), pid=int(pid.value), title=text.value, executable=name.value,
                        rect=(point.x, point.y, point.x + rect.right, point.y + rect.bottom),
                        dpi=int(self.u.GetDpiForWindow(hwnd) or 96))

    def screen(self):
        with self.pixels():
            x, y, width, height = (self.u.GetSystemMetrics(i) for i in (76, 77, 78, 79))
            return (x, y, x + width, y + height)

    def point_owner(self, x, y):
        with self.pixels():
            hwnd = self.u.WindowFromPoint(self.w.POINT(x, y))
            return int(self.u.GetAncestor(hwnd, 2) or 0)

    def move(self, x, y):
        with self.pixels():
            if any(self.u.GetAsyncKeyState(k) & 0x8000 for k in (1, 2, 4, 16, 17, 18, 91, 92)):
                raise RuntimeError('Release mouse buttons and modifier keys before moving the pointer.')
            if not self.u.SetCursorPos(x, y):
                raise RuntimeError('Windows rejected mouse movement.')
            point = self.w.POINT()
            if not self.u.GetCursorPos(self.c.byref(point)) or (point.x, point.y) != (x, y):
                raise RuntimeError('Windows clipped the requested mouse position.')

    def click(self, expected_x, expected_y):
        with self.pixels():
            # Do not combine a click with held modifiers, another mouse button,
            # a user drag, or a concurrently moved pointer.
            if any(self.u.GetAsyncKeyState(k) & 0x8000 for k in (1, 2, 4, 16, 17, 18, 91, 92)):
                raise RuntimeError('Release mouse buttons and modifier keys before the test click.')
            point = self.w.POINT()
            if not self.u.GetCursorPos(self.c.byref(point)) or (point.x, point.y) != (expected_x, expected_y):
                raise RuntimeError('Pointer moved before the test click.')
            events = (self.Input * 2)()
            events[0].type = events[1].type = 0
            events[0].mi.dwFlags, events[1].mi.dwFlags = 0x0002, 0x0004
            if self.u.SendInput(2, events, self.c.sizeof(self.Input)) != 2:
                raise RuntimeError('Windows did not confirm both mouse events.')


def inside(rect, x, y):
    return rect[0] <= x < rect[2] and rect[1] <= y < rect[3]


class Adapter:
    def __init__(self, db, native=None, clock=time.monotonic):
        self.db, self.native, self.clock = db, native if native is not None else Windows(), clock
        self.lock = threading.RLock()
        self.token = None; self.expires = 0; self.owner = None; self.actions = 0; self.last_action = None
        with db.connect() as c:
            c.execute('CREATE TABLE IF NOT EXISTS desktop_events(id INTEGER PRIMARY KEY,action TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL)')

    def log(self, action, result):
        with self.db.connect() as c:
            c.execute('INSERT INTO desktop_events(action,result,created_at) VALUES(?,?,?)', (action, result, datetime.now(timezone.utc).isoformat()))
            c.execute('DELETE FROM desktop_events WHERE id NOT IN (SELECT id FROM desktop_events ORDER BY id DESC LIMIT 500)')

    def reset(self):
        self.token, self.owner, self.expires = None, None, 0

    def window(self):
        w = self.native.foreground()
        allowed_titles = (TITLE, TITLE + ' - Google Chrome', TITLE + ' – Google Chrome')
        if w['title'] not in allowed_titles or ntpath.normcase(ntpath.normpath(w['executable'])) != CHROME:
            raise HTTPException(409, 'Bring the dedicated NEXEN Desktop Control page in installed Chrome to the foreground.')
        scale = w['dpi'] / 96
        left, top, right, bottom = w['rect']
        safe = (left + int(18*scale), top + int(140*scale), right - int(18*scale), bottom - int(18*scale))
        if safe[2]-safe[0] < 240*scale or safe[3]-safe[1] < 220*scale:
            raise HTTPException(409, 'Enlarge the Chrome window before arming desktop control.')
        cx, cy = (safe[0]+safe[2])//2, (safe[1]+safe[3])//2
        w['target'] = (cx-int(90*scale), cy-int(45*scale), cx+int(90*scale), cy+int(45*scale))
        w['test_point'] = dict(x=cx, y=cy)
        return w

    def status(self):
        with self.lock:
            if self.token and self.clock() >= self.expires:
                self.reset()
            eligible, reason, window = False, 'Windows mouse interface unavailable.', None
            if self.native.available:
                try:
                    window = self.window(); eligible = True
                    if self.owner and (window['hwnd'], window['pid']) != self.owner:
                        self.reset()
                    reason = 'Dedicated NEXEN Chrome window verified.'
                except Exception:
                    self.reset()
                    reason = 'Open this dedicated control page in installed Chrome and keep it foreground.'
            return dict(available=self.native.available, foreground_eligible=eligible, armed=bool(self.token),
                        expires_in_seconds=max(0, math.ceil(self.expires-self.clock())) if self.token else 0,
                        detail=reason, test_point=window['test_point'] if window else None,
                        screen_bounds=list(self.native.screen()) if eligible else None,
                        scope='Single moves within desktop bounds; clicks only within this page’s small test area. Foreground Chrome required for every action.',
                        autonomous=False, remote_control_allowed=False)

    def arm(self):
        with self.lock:
            self.reset()
            try:
                window = self.window()
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(409, 'Windows foreground verification failed.')
            self.token = secrets.token_urlsafe(32); self.expires = self.clock()+ARM_SECONDS
            self.owner = (window['hwnd'], window['pid']); self.actions = 0; self.last_action = None
            self.log('arm', 'armed')
            return dict(token=self.token, expires_in_seconds=ARM_SECONDS, test_point=window['test_point'], scope='Dedicated foreground Chrome page only; single manual requests.')

    def stop(self):
        with self.lock:
            self.reset(); self.log('stop', 'disarmed')
            return dict(armed=False, stopped=True)

    def act(self, action, body):
        with self.lock:
            if action not in ('move', 'click'):
                raise HTTPException(404, 'Unknown mouse action')
            if not self.token or not hmac.compare_digest(self.token.encode('utf-8'), body.token.encode('utf-8')) or self.clock() >= self.expires:
                if self.token and self.clock() >= self.expires: self.reset()
                raise HTTPException(409, 'Arm this page again; its mouse session is missing or expired.')
            if self.actions >= 20:
                self.reset(); raise HTTPException(409, 'Mouse session action limit reached. Arm again.')
            if self.last_action is not None and self.clock()-self.last_action < 0.35:
                raise HTTPException(429, 'Wait briefly before another mouse action.')
            try:
                w = self.window()
                if (w['hwnd'], w['pid']) != self.owner:
                    raise HTTPException(409, 'The armed foreground window changed.')
                if not inside(self.native.screen(), body.x, body.y):
                    raise HTTPException(422, 'Point is outside the physical desktop bounds.')
                if action == 'click' and (not inside(w['target'], body.x, body.y) or self.native.point_owner(body.x, body.y) != w['hwnd']):
                    raise HTTPException(403, 'Clicks are restricted to this dedicated page’s unobstructed test area.')
                self.native.move(body.x, body.y)
                if action == 'click':
                    check = self.window()
                    if (check['hwnd'], check['pid']) != self.owner or not inside(check['target'], body.x, body.y) or self.native.point_owner(body.x, body.y) != check['hwnd']:
                        raise HTTPException(409, 'Window changed before click; session stopped.')
                    self.native.click(body.x, body.y)
                self.last_action = self.clock(); self.actions += 1
                self.log(action, 'sent')
                return dict(action=action, sent=True, native_result='Windows accepted the request', page_effect_verified=False)
            except HTTPException:
                self.reset(); self.log(action, 'denied'); raise
            except Exception:
                self.reset(); self.log(action, 'failed')
                raise HTTPException(409, 'Windows could not confirm the requested action; session stopped.')


def guard(request, mutation=False):
    if getattr(request.state, 'private_access', False):
        raise HTTPException(403, 'Desktop mouse control requires this physical PC; private phone access is excluded.')
    from pc_control import validate_request
    validate_request(request, mutation=mutation)


def register(app, db):
    adapter = Adapter(db)

    @app.get('/desktop', response_class=HTMLResponse)
    def page(request: Request):
        guard(request)
        return (BASE/'desktop.html').read_text(encoding='utf-8')

    @app.get('/api/desktop/status')
    def status(request: Request):
        guard(request)
        return adapter.status()

    @app.post('/api/desktop/arm')
    def arm(body: Empty, request: Request):
        guard(request, True)
        return adapter.arm()

    @app.post('/api/desktop/stop')
    def stop(body: Empty, request: Request):
        guard(request, True)
        return adapter.stop()

    @app.post('/api/desktop/move')
    def move(body: PointAction, request: Request):
        guard(request, True)
        return adapter.act('move', body)

    @app.post('/api/desktop/click')
    def click(body: PointAction, request: Request):
        guard(request, True)
        return adapter.act('click', body)

    return adapter
