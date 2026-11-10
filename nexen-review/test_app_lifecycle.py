import asyncio
from contextlib import asynccontextmanager
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app_lifecycle import lifespan, register_lifecycle


class LifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_registration_is_inert_and_mixed_hooks_preserve_order(self):
        events = []
        app = FastAPI(lifespan=lifespan)
        register_lifecycle(app, startup=lambda: events.append('first start'), shutdown=lambda: events.append('first stop'))
        async def legacy_start(): events.append('scene start')
        async def legacy_stop(): events.append('scene stop')
        app.router.add_event_handler('startup', legacy_start)
        app.router.add_event_handler('shutdown', legacy_stop)
        async def last_start(): events.append('last start')
        def last_stop():
            async def finish(): events.append('last stop')
            return finish()
        register_lifecycle(app, startup=last_start, shutdown=last_stop)
        self.assertEqual(events, [])
        async with app.router.lifespan_context(app):
            self.assertEqual(events, ['first start','scene start','last start'])
        self.assertEqual(events, ['first start','scene start','last start','last stop','scene stop','first stop'])
        self.assertFalse(app.state.nexen_lifecycle.active)

    async def test_startup_failure_cleans_only_started_resources(self):
        events = []
        app = FastAPI(lifespan=lifespan)
        register_lifecycle(app, startup=lambda: events.append('start'), shutdown=lambda: events.append('clean'))
        def fail(): raise ValueError('Fixture startup failed')
        register_lifecycle(app, startup=fail, shutdown=lambda: events.append('not acquired'))
        register_lifecycle(app, startup=lambda: events.append('not reached'))
        with self.assertRaisesRegex(ValueError, 'Fixture startup failed'):
            async with lifespan(app): self.fail('Application must not become ready')
        self.assertEqual(events, ['start','clean'])
        self.assertFalse(app.state.nexen_lifecycle.active)

    async def test_shutdown_failure_does_not_skip_other_cleanup(self):
        events = []
        app = FastAPI(lifespan=lifespan)
        register_lifecycle(app, shutdown=lambda: events.append('last cleanup'))
        async def fail():
            events.append('failed cleanup')
            raise ValueError('Fixture shutdown failed')
        register_lifecycle(app, shutdown=fail)
        with self.assertRaisesRegex(ValueError, 'Fixture shutdown failed'):
            async with lifespan(app): pass
        self.assertEqual(events, ['failed cleanup','last cleanup'])

    async def test_startup_and_cleanup_errors_both_remain_visible(self):
        app = FastAPI(lifespan=lifespan)
        def cleanup(): raise ValueError('Fixture cleanup')
        def startup(): raise RuntimeError('Fixture startup')
        register_lifecycle(app, shutdown=cleanup)
        register_lifecycle(app, startup=startup)
        with self.assertRaises(BaseExceptionGroup) as errors:
            async with lifespan(app): pass
        self.assertEqual([type(e) for e in errors.exception.exceptions], [RuntimeError,ValueError])

    async def test_duplicate_active_start_and_late_registration_are_rejected(self):
        app = FastAPI(lifespan=lifespan)
        events = []
        register_lifecycle(app, startup=lambda: events.append('start'))
        async with lifespan(app):
            with self.assertRaises(RuntimeError):
                async with lifespan(app): pass
            with self.assertRaises(RuntimeError): register_lifecycle(app, shutdown=lambda: None)
        self.assertEqual(events, ['start'])

    async def test_cancellation_still_releases_started_workers(self):
        app = FastAPI(lifespan=lifespan)
        events = []
        register_lifecycle(app, shutdown=lambda: events.append('clean'))
        with self.assertRaises(asyncio.CancelledError):
            async with lifespan(app): raise asyncio.CancelledError()
        self.assertEqual(events, ['clean'])

    async def test_final_legacy_pair_is_captured_and_not_duplicated_across_runs(self):
        app = FastAPI(lifespan=lifespan)
        events = []
        app.router.add_event_handler('startup', lambda: events.append('start'))
        app.router.add_event_handler('shutdown', lambda: events.append('stop'))
        for _ in range(2):
            async with lifespan(app): pass
        self.assertEqual(events, ['start','stop','start','stop'])

    async def test_cancellation_remains_task_cancellation_when_cleanup_also_fails(self):
        app = FastAPI(lifespan=lifespan)
        events = []
        register_lifecycle(app, shutdown=lambda: events.append('last cleanup'))
        def fail():
            raise ValueError('Fixture cleanup failure')
        register_lifecycle(app, shutdown=fail)
        async def cancelled_lifespan():
            async with lifespan(app):
                raise asyncio.CancelledError()
        task = asyncio.create_task(cancelled_lifespan())
        with self.assertRaises(asyncio.CancelledError) as raised:
            await task
        self.assertTrue(task.cancelled())
        self.assertIsInstance(raised.exception.__cause__, BaseExceptionGroup)
        self.assertEqual([type(error) for error in raised.exception.__cause__.exceptions], [ValueError])
        self.assertEqual(events, ['last cleanup'])
        self.assertFalse(app.state.nexen_lifecycle.active)


class LifecycleIntegrationTests(unittest.TestCase):
    def test_default_fastapi_is_installed_without_losing_existing_handlers(self):
        app = FastAPI()
        events = []
        app.router.add_event_handler('startup', lambda: events.append('old'))
        register_lifecycle(app, startup=lambda: events.append('new'), shutdown=lambda: events.append('clean'))
        self.assertEqual(events, [])
        with TestClient(app): self.assertEqual(events, ['old','new'])
        self.assertEqual(events, ['old','new','clean'])

    def test_unrelated_custom_lifespan_is_never_replaced(self):
        @asynccontextmanager
        async def other(app): yield
        app = FastAPI(lifespan=other)
        with self.assertRaises(ValueError): register_lifecycle(app, startup=lambda: None)
        self.assertIs(app.router.lifespan_context, other)


if __name__ == '__main__': unittest.main()
