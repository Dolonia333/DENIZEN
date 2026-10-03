import csv
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from nexen import DB
from exact_prompt_import import import_sources,structured_prompts,canonical_prompt,write_report
from source_ingestion import SourceIngestion
from memory_bridge import SharedMemory

class ExactTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='exact-prompts-')
        self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name)

    def test_report_uses_actual_packet_count_without_claiming_test_execution(self):
        with tempfile.TemporaryDirectory(dir=self.base) as folder:
            base=Path(folder)
            (base/'source-report.json').write_text(json.dumps(dict(sources=[],checked_at='fixture',read_files=0,read_bytes=0,packages=[{},{}],unique_structured_prompts=0,structured_source_occurrences=0)),encoding='utf-8')
            (base/'prompt-catalog.json').write_text('{}',encoding='utf-8')
            result=Path(write_report(base,base/'report.md')).read_text(encoding='utf-8')
            self.assertIn('2 per-source implementation packets',result)
            self.assertNotIn('19 per-source',result)
            self.assertNotIn('tests pass',result)

    def test_csv_dedup_and_preserved_original_status(self):
        classifier=SourceIngestion.__new__(SourceIngestion)
        self.assertEqual(classifier.classify('F:/selected/prompts.csv')[0],'pending')
        self.assertEqual(classifier.classify('F:/selected/inventory.tsv')[0],'pending')
        source={'name':'WDR_160_PROMPTS_EXACT.csv','sha256':'fixture','path':'F:/fixture.csv'}
        rows=structured_prompts('prompt_number,title,exact_body\n1,Logo,Use the OG logo\n',source)
        other=structured_prompts('prompt_number,title,prompt_text,status\n1,Logo,Use   the OG logo,NOT RUN\n',{**source,'name':'WDR_PROMPT_RERUN_QUEUE.csv'})
        self.assertEqual(rows[0]['id'],other[0]['id'])
        self.assertEqual(other[0]['original_status'],'NOT RUN')
        self.assertEqual(other[0]['execution_status'],'not_executed')
    def test_import_keeps_originals_and_makes_csv_searchable(self):
        base=self.base;root=base/'01_EXACT_PROMPTS_AND_CHATS';root.mkdir()
        path=root/'WDR_160_PROMPTS_EXACT.csv';path.write_text('prompt_number,title,exact_body\n1,Fixture,wardrobe source password=fixture-private\n',encoding='utf-8')
        before=hashlib.sha256(path.read_bytes()).hexdigest();db=DB(str(base/'nexen.db'))
        result=import_sources(db,[root],base/'packets')
        self.assertEqual(result['unique_structured_prompts'],1)
        self.assertEqual(result['executed_source_prompts'],0)
        self.assertEqual(self.db_jobs(db),0)
        self.assertEqual(before,hashlib.sha256(path.read_bytes()).hexdigest())
        context=SharedMemory(base/'missing.sqlite3',base/'vault',db.path).build_context('wardrobe')
        self.assertTrue(any(x['kind']=='knowledge' for x in context['citations']))
        self.assertNotIn('fixture-private',context['text'])
        packet=json.loads(next((base/'packets').glob('source-*.json')).read_text(encoding='utf-8'))
        self.assertFalse(packet['executed']);self.assertTrue(packet['acceptance']);self.assertTrue(packet['dependencies'])
    @staticmethod
    def db_jobs(db):return db.scalar('SELECT count(*) FROM jobs')
    def test_large_and_pdf_coverage_are_unread_not_hashed(self):
        base=self.base;root=base/'source';root.mkdir()
        (root/'large.txt').write_text('x'*(1048576+1),encoding='utf-8');(root/'reference.pdf').write_bytes(b'not parsed')
        result=import_sources(DB(str(base/'nexen.db')),[root],base/'packets')
        self.assertEqual(result['read_files'],0);self.assertEqual(result['read_bytes'],0)
        self.assertEqual({s['status'] for s in result['sources']},{'unread_large_or_budget','unread_pdf'})
        self.assertTrue(all(s['sha256'] is None for s in result['sources']))

if __name__=='__main__':unittest.main()
