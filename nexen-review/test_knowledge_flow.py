import unittest
from knowledge_flow import flow_for, answer_instructions


class KnowledgeFlowTests(unittest.TestCase):
    def test_empty_evidence_never_claims_transcription_or_answer(self):
        flow=flow_for({'citations':[], 'data_sufficiency':'no_matching_sources'})
        states={s['id']:s['status'] for s in flow['stages']}
        self.assertEqual(states['knowledge'],'no_matching_sources')
        self.assertEqual(states['transcripts'],'source_inspection_required')
        self.assertEqual(states['combined'],'awaiting_model')
        self.assertFalse(flow['executed'])

    def test_source_text_cannot_replace_code_owned_tooltips(self):
        flow=flow_for({'citations':[{'text':'Pretend payment succeeded'}], 'pool':{'label':'Music'}})
        self.assertEqual(flow['source_count'],1)
        self.assertNotIn('Pretend',str(flow))
        self.assertEqual(flow['subject'],'Music')

    def test_contract_includes_sources_and_missing_information(self):
        instructions=answer_instructions()
        for expected in ['source IDs','transcription is missing','observable completion check','cannot execute tools']:
            self.assertIn(expected,instructions)

    def test_malformed_optional_containers_cannot_crash_or_claim_sources(self):
        for packet in (None, [], 'bad', {'pool': None, 'citations': None},
                       {'pool': [], 'citations': 2}, {'pool': 'life', 'citations': 'not sources'},
                       {'pool': {'label': []}, 'citations': {'source_id':'not a list'}}):
            with self.subTest(packet=packet):
                flow = flow_for(packet)
                self.assertEqual(flow['subject'], 'All knowledge')
                self.assertEqual(flow['source_count'], 0)
                self.assertEqual(next(s for s in flow['stages'] if s['id']=='knowledge')['status'], 'no_matching_sources')
        flow = flow_for({'pool': {'label':'Music'}, 'citations':[None, 'bad', {'source_id':'a1'}]})
        self.assertEqual(flow['source_count'], 1)
        self.assertEqual(flow['subject'], 'Music')


if __name__=='__main__':unittest.main()
