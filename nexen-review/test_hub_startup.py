"""Optional assets and digest persistence must not break setup on a fresh install."""
import json
import tempfile
import unittest
from pathlib import Path
from fastapi import FastAPI
from fastapi.testclient import TestClient
from nexen_hub import mount_available_assets, save_digest


class HubStartupTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parent / 'work' / 'hub-startup-tests'
        root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root)
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)

    def test_missing_asset_directory_does_not_block_other_routes(self):
        app = FastAPI()
        app.get('/setup')(lambda: {'ready': True})
        self.assertFalse(mount_available_assets(app, '/vendor', self.base / 'missing', 'vendor'))
        with TestClient(app) as client:
            self.assertEqual(client.get('/setup').status_code, 200)
            self.assertEqual(client.get('/vendor/missing.js').status_code, 404)

    def test_existing_asset_directory_still_serves_files(self):
        (self.base / 'asset.txt').write_text('fixture', encoding='utf-8')
        app = FastAPI()
        self.assertTrue(mount_available_assets(app, '/vendor', self.base, 'vendor'))
        with TestClient(app) as client:
            self.assertEqual(client.get('/vendor/asset.txt').text, 'fixture')

    def test_digest_creates_missing_parent_and_preserves_payload(self):
        path = self.base / 'data' / 'discord-digest.json'
        report = {'messages': [], 'status': 'not_connected'}
        save_digest(report, path)
        self.assertEqual(json.loads(path.read_text(encoding='utf-8')), report)
