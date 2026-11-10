"""Real local HTTP/storage checks using owned H: fixtures, never the live DB."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import app_auth
import next_step as module
from storage_policy import StoragePolicyError, require_output_path
from task_tracking import TaskCreate
from test_next_step import DB


# Header/container fixture, not a claim of successful video-frame decoding.
WEBM = bytes.fromhex('1a45dfa3874282847765626d18538067ff1f43b67583e78100')
ORIGIN = 'http://127.0.0.1:8788'
HEADERS = {'Origin': ORIGIN, 'X-Nexen-Action': 'launch', 'Content-Type': 'video/webm;codecs=vp9'}


class VideoStorageTests(unittest.TestCase):
    def setUp(self):
        fixture_root = require_output_path('H:/NEXEN/work/next-video-test-fixtures')
        fixture_root.mkdir(parents=True, exist_ok=True)
        temporary = tempfile.TemporaryDirectory(dir=fixture_root, prefix='case-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.output = self.root/'videos'
        self.db = DB(self.root/'tasks.sqlite')
        app = FastAPI()
        self.auth = app_auth.AuthStore(self.root/'auth')
        with patch.object(app_auth, 'AuthStore', lambda: self.auth):
            gate = app_auth.register(app)

        @app.middleware('http')
        async def auth(request, call_next):
            rejection = gate(request)
            return rejection if rejection is not None else await call_next(request)

        with patch.object(module, 'VIDEO_ROOT', self.output):
            self.flow = module.register(app, self.db)
        self.ident = self.flow.tracker.create(TaskCreate(text='Fixture next-step video', next_step='Review this fixture.'), seed_key='music-batch-stems')
        self.client = TestClient(app, base_url=ORIGIN, client=('127.0.0.1', 54321))
        self.addCleanup(self.client.close)
        self.client.cookies.set(app_auth.COOKIE, self.auth.setup('fixture-password-only-1234'))

    def upload(self, content=WEBM, headers=None, ident=None):
        return self.client.post('/api/next/' + str(ident or self.ident) + '/video',
                                content=content, headers=headers or HEADERS)

    def test_saved_hash_receipt_and_authenticated_byte_exact_playback(self):
        result = self.upload()
        self.assertEqual(result.status_code, 200, result.text)
        receipt = result.json()['video']
        expected_hash = hashlib.sha256(WEBM).hexdigest()
        self.assertEqual(receipt['id'], expected_hash)
        self.assertEqual(receipt['sha256'], expected_hash)
        self.assertEqual(receipt['task_id'], self.ident)
        self.assertEqual(receipt['bytes'], len(WEBM))
        self.assertEqual(Path(receipt['path']), self.output/(expected_hash+'.webm'))
        self.assertEqual(Path(receipt['path']).read_bytes(), WEBM)
        self.assertFalse(receipt['actual_app_recording'])
        self.assertFalse(receipt['external_upload'])
        playback = self.client.get(receipt['video_url'])
        self.assertEqual(playback.status_code, 200)
        self.assertEqual(playback.content, WEBM)
        self.assertEqual(playback.headers['content-type'], 'video/webm')
        self.assertEqual(playback.headers['x-content-type-options'], 'nosniff')
        self.assertEqual(playback.headers['cache-control'], 'no-store')
        self.assertEqual(playback.headers['content-disposition'], 'inline')
        self.assertEqual(self.client.get(receipt['receipt_url']).json(), receipt)
        self.assertEqual(self.flow.tracker.get(self.ident)['status'], 'planned')
        self.assertEqual(self.flow.action(self.flow.task(self.ident))['url'], '/music-render')

    def test_duplicate_retry_keeps_one_file_and_original_receipt(self):
        first, second = self.upload().json(), self.upload().json()
        self.assertFalse(first['duplicate'])
        self.assertTrue(second['duplicate'])
        self.assertEqual(first['video'], second['video'])
        self.assertEqual(len(list(self.output.glob('*.webm'))), 1)
        self.assertEqual(len(list(self.output.glob('*.json'))), 1)
        self.assertFalse(list(self.output.glob('*.tmp')))

    def test_auth_and_same_origin_are_required_for_upload_and_playback(self):
        receipt = self.upload().json()['video']
        for headers in ({'Content-Type':'video/webm'}, dict(HEADERS, Origin='https://invalid.example')):
            self.assertEqual(self.upload(headers=headers).status_code, 403)
        self.client.cookies.clear()
        self.assertEqual(self.upload().status_code, 401)
        self.assertEqual(self.client.get(receipt['video_url']).status_code, 401)
        self.assertEqual(self.client.get(receipt['receipt_url']).status_code, 401)

    def test_mime_header_length_and_container_errors_never_create_a_file(self):
        samples = [
            (WEBM, dict(HEADERS, **{'Content-Type':'text/html'}), 415),
            (WEBM, dict(HEADERS, **{'Content-Encoding':'gzip'}), 415),
            (WEBM, dict(HEADERS, **{'Content-Length':'nope'}), 400),
            (WEBM, dict(HEADERS, **{'Content-Length':'1'}), 400),
            (b'', HEADERS, 400),
            (b'<html>not a video</html>', HEADERS, 415),
            (WEBM[:6], HEADERS, 415),
            (WEBM.replace(b'webm', b'junk'), HEADERS, 415),
            (WEBM[:17], HEADERS, 415),
        ]
        for content, headers, expected in samples:
            with self.subTest(content=content, headers=headers):
                self.assertEqual(self.upload(content, headers).status_code, expected)
        self.assertFalse(self.output.exists())

    def test_declared_and_streamed_size_limits_apply_before_storage(self):
        self.assertEqual(module.MAX_VIDEO_BYTES, 64*1024*1024)
        headers = dict(HEADERS, **{'Content-Length':str(module.MAX_VIDEO_BYTES+1)})
        self.assertEqual(self.upload(headers=headers).status_code, 413)
        with patch.object(module, 'MAX_VIDEO_BYTES', 20):
            # Iterator input has no Content-Length, so this tests the stream cap.
            self.assertEqual(self.upload(iter([WEBM[:12], WEBM[12:]])).status_code, 413)
        self.assertFalse(self.output.exists())

    def test_missing_task_invalid_id_and_offdrive_root_fail_closed(self):
        self.assertEqual(self.upload(ident=999).status_code, 404)
        self.assertEqual(self.client.get('/api/next/videos/not-a-file').status_code, 404)
        self.assertEqual(self.client.get('/api/next/videos/'+'a'*64).status_code, 404)
        for drive in ('C', 'D', 'E'):
            with self.subTest(drive=drive), self.assertRaises(StoragePolicyError):
                module.NextVideos(drive+':/NEXEN-must-not-be-created/videos')
        self.assertEqual(require_output_path('F:/NEXEN_GAME/videos').drive, 'F:')
        self.assertFalse(self.output.exists())

    def test_failed_atomic_publish_cleans_temporary_file_and_does_not_fallback(self):
        with patch.object(module.os, 'replace', side_effect=OSError('Fixture disk error')):
            response = self.upload()
        self.assertEqual(response.status_code, 503)
        self.assertIn('No fallback drive', response.json()['detail'])
        self.assertEqual(list(self.output.iterdir()), [])
        self.assertEqual(self.flow.tracker.get(self.ident)['status'], 'planned')

    def test_saved_file_tampering_is_not_overwritten_on_retry(self):
        receipt = self.upload().json()['video']
        path = Path(receipt['path'])
        path.write_bytes(b'invalid')
        self.assertEqual(self.upload().status_code, 409)
        self.assertEqual(path.read_bytes(), b'invalid')
        self.assertEqual(self.client.get(receipt['video_url']).status_code, 409)

    def test_page_uses_owned_save_endpoint_and_suppresses_native_download_control(self):
        html = self.client.get('/next').text
        self.assertIn('Save video to NEXEN', html)
        self.assertIn('controlslist="nodownload"', html)
        self.assertIn("'/api/next/'+taskId+'/video'", html)
        self.assertNotIn('Saving a file is left to your browser', html)
        self.assertNotIn('.download=', html)


if __name__ == '__main__':
    unittest.main()
