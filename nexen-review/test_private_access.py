import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi import HTTPException
from starlette.requests import Request
from pc_control import validate_request
import private_access as module

ROOT = Path(__file__).resolve().parent / 'work' / 'private-access-tests'


class PrivateAccessTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='private-access-')
        self.addCleanup(self.temp.cleanup)
        self.file = Path(self.temp.name) / 'private.json'
        self.config = {'enabled':True, 'protocol':'https', 'port':443,
            'allowed_host':'PRIVATE_HOST.invalid', 'allowed_origin':'https://PRIVATE_HOST.invalid',
            'allowed_tailscale_user_login':'review-b2096dbc5111b630@example.invalid'}
        self.file.write_text(json.dumps(self.config), encoding='utf-8')
        self.patch = patch.object(module, 'CONFIG', self.file)
        self.patch.start()
    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()
    def request(self, method='GET', host='PRIVATE_HOST.invalid', identity='review-b2096dbc5111b630@example.invalid', origin=None, client='127.0.0.1', extra=()):
        headers = [(b'host', host.encode())]
        if identity is not None: headers.append((b'tailscale-user-login', identity.encode()))
        if origin is not None: headers.append((b'origin', origin.encode()))
        headers.extend(extra)
        return Request({'type':'http','method':method,'scheme':'http','path':'/api/tasks','query_string':b'',
            'headers':headers,'client':(client,50000),'server':('127.0.0.1',8788)})
    def test_private_navigation_normalizes_cached_headers_and_preserves_marker(self):
        req = self.request()
        self.assertEqual(req.headers['host'], self.config['allowed_host'])
        self.assertTrue(module.normalize_private_request(req))
        self.assertEqual(req.headers['host'], '127.0.0.1:8788')
        self.assertTrue(req.state.private_access)
        validate_request(req)
        self.assertTrue(module.normalize_private_request(req))
        self.assertTrue(req.state.private_access)
    def test_private_mutation_requires_owner_and_origin_then_existing_guard_passes(self):
        req = self.request('PATCH', origin=self.config['allowed_origin'], extra=[(b'x-nexen-action',b'launch'),(b'x-nexen-service',b'fixture-secret'),(b'x-forwarded-for',b'127.0.0.1')])
        module.normalize_private_request(req)
        self.assertEqual(req.headers['origin'],'http://127.0.0.1:8788')
        self.assertNotIn('x-nexen-service',req.headers)
        self.assertNotIn('x-forwarded-for',req.headers)
        validate_request(req,mutation=True)
    def test_bad_identity_origin_peer_and_duplicate_headers_fail_closed(self):
        bad = [self.request(identity=None), self.request(identity='review-b0431fe807440962@example.invalid'),
            self.request(client='192.0.2.10',extra=[(b'x-forwarded-for',b'127.0.0.1')]),
            self.request(origin='http://PRIVATE_HOST.invalid'),self.request(origin='https://evil.example'),
            self.request('POST'),self.request(extra=[(b'host',b'PRIVATE_HOST.invalid')]),
            self.request(extra=[(b'tailscale-user-login',b'review-b2096dbc5111b630@example.invalid')]),
            self.request(origin=self.config['allowed_origin'],extra=[(b'origin',self.config['allowed_origin'].encode())]),
            self.request(host='127.0.0.1:8788')]
        for req in bad:
            with self.subTest(headers=req.scope['headers']):
                with self.assertRaises(HTTPException) as error:
                    module.normalize_private_request(req)
                self.assertEqual(error.exception.status_code,403)
    def test_plain_local_request_keeps_internal_service_header(self):
        req = self.request(host='127.0.0.1:8788',identity=None,extra=[(b'x-nexen-service',b'fixture-secret')])
        self.assertFalse(module.normalize_private_request(req))
        self.assertFalse(req.state.private_access)
        self.assertEqual(req.headers['x-nexen-service'],'fixture-secret')
    def test_disabled_access_and_sanitized_status(self):
        self.config['enabled'] = False
        self.file.write_text(json.dumps(self.config),encoding='utf-8')
        with self.assertRaises(HTTPException): module.normalize_private_request(self.request())
        summary = json.dumps(module.status())
        self.assertNotIn(self.config['allowed_host'],summary)
        self.assertNotIn(self.config['allowed_tailscale_user_login'],summary)
        self.assertFalse(module.status()['enabled'])


if __name__ == '__main__': unittest.main()
