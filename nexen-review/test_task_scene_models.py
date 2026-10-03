"""Model-selection regression fixtures; no live inference, downloads or task writes."""
import json
import unittest
from unittest.mock import patch

import httpx
import task_scene


class SceneModelSelectionTests(unittest.IsolatedAsyncioTestCase):
    async def run_adapter(self, models, capabilities, requested=None):
        self.calls=[]
        def respond(request):
            body=json.loads(request.content) if request.content else None
            self.calls.append((request.url.path,body))
            self.assertEqual(str(request.url).split('/api/')[0],task_scene.OLLAMA)
            if request.url.path=='/api/tags':return httpx.Response(200,json={'models':models})
            if request.url.path=='/api/show':
                value=capabilities[body['model']]
                return httpx.Response(500) if value is None else httpx.Response(200,json={'capabilities':value})
            self.assertEqual(request.url.path,'/api/chat')
            return httpx.Response(200,json={'message':{'content':json.dumps({
                'scene':'planning','action':'review','grounded_summary':'Review saved task.',
                'source_refs':['task:1']})}})
        real=httpx.AsyncClient
        with patch.object(task_scene.httpx,'AsyncClient',side_effect=lambda **kw:real(transport=httpx.MockTransport(respond),**kw)):
            return await task_scene.LocalSceneModel().ask(requested,{'task':{'source_ref':'task:1'}})

    async def test_default_skips_embedding_model_and_chooses_smallest_chat(self):
        model,_=await self.run_adapter([
            {'name':'large-chat','size':300},{'name':'embedding','size':100},{'name':'small-chat','size':200}],
            {'embedding':['embedding'],'small-chat':['completion'],'large-chat':['completion']})
        self.assertEqual(model,'small-chat')
        self.assertEqual([body['model'] for path,body in self.calls if path=='/api/show'],['embedding','small-chat'])
        self.assertEqual([body['model'] for path,body in self.calls if path=='/api/chat'],['small-chat'])

    async def test_explicit_embedding_model_fails_without_silent_substitution(self):
        with self.assertRaisesRegex(ValueError,'text-completion'):
            await self.run_adapter([{'name':'embedding','size':100},{'name':'chat','size':200}],
                                   {'embedding':['embedding'],'chat':['completion']},'embedding')
        self.assertNotIn('/api/chat',[path for path,_ in self.calls])
        self.assertEqual([body['model'] for path,body in self.calls if path=='/api/show'],['embedding'])

    async def test_unreadable_default_model_metadata_does_not_block_working_chat(self):
        model,_=await self.run_adapter([{'name':'broken','size':100},{'name':'chat','size':200}],
                                      {'broken':None,'chat':['completion']})
        self.assertEqual(model,'chat')

    async def test_default_capability_probes_are_bounded_without_generation(self):
        models=[{'name':f'embedding-{i}','size':i+1} for i in range(task_scene.MAX_MODEL_PROBES+5)]
        with self.assertRaisesRegex(ValueError,'bounded local model check'):
            await self.run_adapter(models,{m['name']:['embedding'] for m in models})
        self.assertEqual(sum(path=='/api/show' for path,_ in self.calls),task_scene.MAX_MODEL_PROBES)
        self.assertNotIn('/api/chat',[path for path,_ in self.calls])


if __name__=='__main__':unittest.main()
