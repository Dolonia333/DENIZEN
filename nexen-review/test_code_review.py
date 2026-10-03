import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import httpx
from fastapi import FastAPI

from code_review import CodeReview, CODERABBIT_URL, REPOSITORY_URL, MAX_RECEIPT_BYTES, register, verified_pr


class CodeReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'review.json'
        self.review = CodeReview(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, value):
        self.path.write_text(json.dumps(value), encoding='utf-8')

    def test_missing_receipt_never_claims_review(self):
        data = self.review.status()
        self.assertEqual(data['status'], 'not_recorded')
        self.assertEqual(data['review_url'], CODERABBIT_URL)
        self.assertFalse(data['can_upload_source'])
        self.assertFalse(data['can_request_cloud_review'])
        self.assertFalse(self.path.exists())

    def test_only_verified_exact_repo_pull_url(self):
        url = REPOSITORY_URL + '/pull/17'
        self.assertEqual(verified_pr(url, True), url)
        for candidate in [url + '?redirect=x', url + '#comment', url + '/', url.replace('https:', 'http:'),
                          'https://github.com.evil.test/dbgamerboy/nexen-code-review/pull/17',
                          'https://github.com/another/repo/pull/1', REPOSITORY_URL + '/pull/0',
                          'javascript:alert(1)', '//github.com/dbgamerboy/nexen-code-review/pull/17']:
            self.assertIsNone(verified_pr(candidate, True))
        for flag in [False, 'true', 1, None]:
            self.assertIsNone(verified_pr(url, flag))

    def test_records_scope_without_overall_completion(self):
        self.write({'status':'pr_open', 'pr_url':REPOSITORY_URL+'/pull/1', 'pr_verified':True,
                    'snapshot_sha256':'A'*64, 'source_commit':'b'*40, 'files_uploaded':80,
                    'scope':['Selected Python, HTML, CSS and JavaScript'], 'exclusions':['Credentials and databases'],
                    'checks':[{'name':'Syntax', 'status':'passed', 'scope':'Selected files only'}],
                    'api_key':'must-not-appear', 'percent_complete':100})
        before = self.path.read_bytes()
        data = self.review.status()
        self.assertEqual(data['files_uploaded'],80)
        self.assertEqual(data['snapshot_sha256'],'a'*64)
        self.assertTrue(data['pr_verified'])
        self.assertEqual(data['checks'][0]['scope'],'Selected files only')
        self.assertNotIn('api_key',data)
        self.assertNotIn('percent_complete',data)
        self.assertEqual(before,self.path.read_bytes())

    def test_malformed_and_oversized_receipts_fail_closed(self):
        for raw in ['not json','[]','x'*(MAX_RECEIPT_BYTES+1)]:
            self.path.write_text(raw,encoding='utf-8')
            data=self.review.status()
            self.assertEqual(data['receipt_state'],'unavailable')
            self.assertFalse(data['pr_verified'])
            self.assertEqual(data['review_url'],CODERABBIT_URL)

    def test_untrusted_field_types_are_bounded(self):
        self.write({'status':[], 'files_uploaded':True, 'snapshot_sha256':'z'*64,
                    'detail':'x'*2000,'scope':['x'*800]*60,'checks':[{'status':[]},None],
                    'pr_url':'https://invalid.test', 'pr_verified':True})
        data=self.review.status()
        self.assertEqual(data['status'],'not_recorded')
        self.assertIsNone(data['files_uploaded'])
        self.assertIsNone(data['snapshot_sha256'])
        self.assertEqual(len(data['detail']),1500)
        self.assertEqual(len(data['scope']),40)
        self.assertEqual(len(data['scope'][0]),600)
        self.assertEqual(data['checks'][0]['status'],'unknown')
        self.assertEqual(data['review_url'],CODERABBIT_URL)

    def test_api_is_read_only_and_uses_existing_host_guard(self):
        app=FastAPI()
        with patch('code_review.CodeReview',return_value=self.review):
            register(app,None)
        async def run():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://127.0.0.1:8788') as client:
                self.assertEqual((await client.get('/api/code-review/status')).status_code,200)
                page=await client.get('/code-review')
                self.assertEqual(page.status_code,200)
                self.assertIn('Open CodeRabbit review',page.text)
                self.assertEqual((await client.post('/api/code-review/status',json={})).status_code,405)
                self.assertEqual((await client.get('/api/code-review/status',headers={'Host':'evil.test'})).status_code,403)
        asyncio.run(run())


if __name__ == '__main__':
    unittest.main()
