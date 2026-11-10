import unittest
from memory_bridge import SharedMemory, _redacted_values
from memory_pools import query_plan, rank_candidates

def item(source,title,body):
    return {'kind':'manual_note','source_id':source,'title':title,'role':'source','text':body,'ts':'2026-09-09','provenance':[]}

class PoolMemory(SharedMemory):
    def _search_exports(self,terms,limit):
        return [item('lumipaw-product','Lumipaw product facts','Lumipaw LED Nail Trimmer. Product ads need verified photos and actual supplier costs. Budget total is 50 dollars.')]
    def _search_notes(self,terms,limit):
        return [item('wdr-lookbook','WDR fashion lookbook','WDR streetwear photos and product photography. Plan a clothes budget and improve photo tags.')]
    def _search_knowledge(self,terms,limit): return []
    def _search_completions(self,terms,limit): return []

class MemoryPoolsTests(unittest.TestCase):
    def test_no_named_evidence_is_reported_as_missing(self):
        class EmptyProduct(PoolMemory):
            def _search_exports(self,terms,limit):return []
        result=EmptyProduct().build_context('Lumipaw product ads budget photos',limit=1)
        self.assertEqual(result['citations'],[])
        self.assertEqual(result['data_sufficiency'],'no_matching_sources')

    def test_explicit_music_pool_rejects_unrelated_subject(self):
        plan=query_plan('product photos',['product','photos'],'music')
        self.assertEqual(rank_candidates([item('lookbook','WDR','product photos and clothing')],plan),[])

    def test_content_hash_provenance_survives_redaction(self):
        sha='1234567890123456'+'abcdef01'*6
        result=_redacted_values({'sha256':sha,'source_id':sha,'text':'secret card 4111111111111111'})
        self.assertEqual(result['sha256'],sha)
        self.assertEqual(result['source_id'],sha)
        self.assertNotIn('4111111111111111',result['text'])

    def test_named_product_evidence_precedes_unrelated_note_pool(self):
        result=PoolMemory().build_context('Lumipaw product ads budget photos',limit=1)
        self.assertEqual(result['citations'][0]['source_id'],'lumipaw-product')

if __name__=='__main__':unittest.main()
