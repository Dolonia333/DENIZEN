"""Login preserves supported destinations without allowing arbitrary redirects."""
import unittest
from unittest.mock import patch
from fastapi import FastAPI
from starlette.requests import Request
import app_auth


class NavigationTests(unittest.TestCase):
    def setUp(self):
        with patch.object(app_auth, 'AuthStore') as factory:
            factory.return_value.valid.return_value = False
            factory.return_value.service_key = 'fixture-only'
            self.gate = app_auth.register(FastAPI())

    def request(self, path, method='GET'):
        return Request({'type': 'http', 'scheme': 'http', 'server': ('127.0.0.1', 8788),
                        'path': path, 'query_string': b'', 'method': method, 'headers': []})

    def test_supported_destinations_survive_login(self):
        for path in app_auth.SUPPORTED_DESTINATIONS:
            with self.subTest(path=path):
                response = self.gate(self.request(path))
                self.assertEqual(response.status_code, 303)
                self.assertEqual(response.headers['location'], '/login?next=' + path)

    def test_unknown_destination_returns_home(self):
        response = self.gate(self.request('//outside.example'))
        self.assertEqual(response.headers['location'], '/login?next=/')

    def test_api_and_mutations_remain_locked(self):
        for path, method in (('/api/agentic-os/status', 'GET'), ('/agentic-os', 'POST')):
            self.assertEqual(self.gate(self.request(path, method)).status_code, 401)

    def test_non_ascii_service_key_is_denied_without_server_error(self):
        request = self.request('/api/hub/digest')
        request.scope['headers'] = [(b'x-nexen-service', 'caf\u00e9'.encode('latin-1'))]
        self.assertEqual(self.gate(request).status_code, 401)

    def test_session_exports_the_same_navigation_contract(self):
        with patch.object(app_auth, 'AuthStore') as factory:
            factory.return_value.configured.return_value = True
            factory.return_value.valid.return_value = False
            app = FastAPI()
            app_auth.register(app)
            endpoint = next(route.endpoint for route in app.routes if route.path == '/api/auth/session')
            result = endpoint(self.request('/api/auth/session'))
        self.assertEqual(set(result['supported_destinations']), app_auth.SUPPORTED_DESTINATIONS)


if __name__ == '__main__':
    unittest.main()
