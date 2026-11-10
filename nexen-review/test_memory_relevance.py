import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from memory_bridge import SharedMemory
from memory_runtime import prompt_with_context


class MemoryRelevanceTests(unittest.TestCase):
    def test_empty_context_raises_typed_error_before_any_model_request(self):
        for packet in ({},{'text':''},{'text':None}):
            with self.subTest(packet=packet):
                with self.assertRaisesRegex(ValueError,'Shared memory returned no context. Check the memory index.'):
                    prompt_with_context('Current fixture request',packet)

    def test_nonempty_context_preserves_evidence_and_current_request(self):
        text='SOURCE fixture:7\nOriginal evidence with exact text.'
        request='Implement the current Windows task.'
        result=prompt_with_context(request,{'text':text})
        self.assertIn('NEXEN SHARED CONTEXT\n'+text+'\nEND SHARED CONTEXT',result)
        self.assertTrue(result.endswith('CURRENT REQUEST\n'+request))
        self.assertLess(result.index(text),result.index(request))

    def test_legacy_dependency_text_does_not_replace_original_plans(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);db=root/'knowledge.sqlite3'
            with closing(sqlite3.connect(db)) as c,c:
                c.executescript('''CREATE TABLE files(id INTEGER PRIMARY KEY,path TEXT,sha256 TEXT);
                CREATE TABLE chunks(id INTEGER PRIMARY KEY,file_id INTEGER,text TEXT,created_at TEXT,chunk_index INTEGER);
                CREATE VIRTUAL TABLE chunks_fts USING fts5(text);''')
                paths=['F:/AI/cursor/resources/app/nls.messages.json','F:/AI/node_modules/vendor/readme.md',
                       'F:/NEXEN_CACHE/temp/old-plan.txt',r'F:\AI\site-packages\vendor.py',
                       'F:/05_AI/01_EXACT_PROMPTS_AND_CHATS/WDR_ORIGINAL_STREETWEAR_NOTES.txt']
                for i,path in enumerate(paths,1):
                    c.execute('INSERT INTO files VALUES(?,?,?)',(i,path,'a'*64))
                    c.execute('INSERT INTO chunks VALUES(?,?,?,?,?)',(i,i,'Jarvis voice photo city plan','2026-09-09',0))
                    c.execute('INSERT INTO chunks_fts(rowid,text) VALUES(?,?)',(i,'Jarvis voice photo city plan'))
            memory=SharedMemory(root/'missing.sqlite3',root/'vault',db)
            result=memory.build_context('Jarvis voice photo city',limit=5)
            knowledge=[x for x in result['citations'] if x['kind']=='knowledge']
            self.assertEqual(len(knowledge),1)
            self.assertEqual(knowledge[0]['provenance'][0]['source'],paths[-1])
            with closing(sqlite3.connect(db)) as c:self.assertEqual(c.execute('SELECT count(*) FROM files').fetchone()[0],5)


if __name__=='__main__':unittest.main()
