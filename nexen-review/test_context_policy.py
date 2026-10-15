import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from memory_bridge import SharedMemory, _apply_context_policy, digest

ROOT = Path(__file__).resolve().parent / 'work' / 'context-policy-tests'
ROOT.mkdir(parents=True, exist_ok=True)


class ContextPolicyTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='case-', dir=ROOT)
        self.root = Path(temporary.name).resolve()
        self.assertTrue(self.root.is_relative_to(ROOT.resolve()))
        self.addCleanup(temporary.cleanup)
        self.path = self.root / 'policy.json'
        self.old = {'source_id':'old-source', 'kind':'conversation', 'title':'Superseded setup',
                    'text':'Windows Kilo code review: obsolete desktop arrangement.', 'ts':'2026-09-01', 'provenance':[]}
        self.current = {'source_id':'current-source', 'kind':'knowledge', 'title':'Windows Kilo setup',
                        'text':'Windows Kilo code review: use the installed local coding tools.', 'ts':'2026-09-09', 'provenance':[]}
        self.save([self.old])

    def save(self, sources):
        self.path.write_text(json.dumps({'schema_version':1, 'excluded_sources':[
            {'source_id':item['source_id'], 'prefix_sha256':digest(item['text'])} for item in sources]}), encoding='utf-8')

    def packet(self):
        memory = SharedMemory(self.root/'absent.db', self.root/'vault', context_policy=self.path)
        with patch.object(memory, '_search_exports', return_value=[self.old]), \
                patch.object(memory, '_search_knowledge', return_value=[self.current]), \
                patch.object(memory, '_search_notes', return_value=[]), \
                patch.object(memory, '_search_completions', return_value=[]):
            return memory.build_context('Windows Kilo code review', max_chars=16000, pool='engineering')

    def test_exact_exclusion_retains_unrelated_evidence_and_citations(self):
        packet = self.packet()
        self.assertNotIn('obsolete desktop arrangement', packet['text'])
        self.assertIn('installed local coding tools', packet['text'])
        self.assertEqual([x['source_id'] for x in packet['citations']], ['current-source'])
        self.assertEqual(packet['retrieval_policy']['matched_candidates_omitted'], 1)
        self.assertTrue(packet['retrieval_policy']['raw_sources_preserved'])
        self.assertIn('NEXEN runs on Windows', packet['text'])
        self.assertEqual(self.old['text'], 'Windows Kilo code review: obsolete desktop arrangement.')

    def test_changed_source_content_is_not_silently_tombstoned(self):
        changed = {**self.old, 'text':'Windows Kilo: newly verified current source.'}
        retained, policy = _apply_context_policy([changed], self.path)
        self.assertEqual(retained, [changed])
        self.assertEqual(policy['changed_source_prefixes'], 1)
        self.assertEqual(policy['matched_candidates_omitted'], 0)

    def test_invalid_policy_pauses_excerpts_and_reports_gap(self):
        self.path.write_text('[1]', encoding='utf-8')
        packet = self.packet()
        self.assertEqual(packet['citations'], [])
        self.assertEqual(packet['status'], 'degraded')
        self.assertEqual(packet['retrieval_policy']['status'], 'unavailable')
        self.assertIn('NEXEN runs on Windows', packet['text'])
        self.assertNotIn('obsolete desktop arrangement', packet['text'])

    def test_policy_cache_refreshes_when_manifest_changes(self):
        self.assertEqual(_apply_context_policy([self.old], self.path)[0], [])
        self.save([])
        retained, policy = _apply_context_policy([self.old], self.path)
        self.assertEqual(retained, [self.old])
        self.assertEqual(policy['configured_sources'], 0)

    def test_missing_policy_keeps_fixture_evidence(self):
        retained, policy = _apply_context_policy([self.current], self.root/'missing.json')
        self.assertEqual(retained, [self.current])
        self.assertEqual(policy['status'], 'not_configured')


if __name__ == '__main__': unittest.main()
