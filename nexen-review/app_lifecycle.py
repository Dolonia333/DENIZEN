"""One application lifespan for NEXEN's ordered, paired worker hooks.

Registering a hook never starts recovery or a worker. Shutdown runs in reverse
order, including after a later startup fails. A hook whose startup itself fails
must unwind its own partial acquisition. Legacy router event pairs (currently
task_scene) are captured in their original registration order, not run twice.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
import inspect
from itertools import zip_longest
from typing import Awaitable, Callable, TYPE_CHECKING
from fastapi.routing import APIRouter

if TYPE_CHECKING:
    from fastapi import FastAPI

LifecycleCallback = Callable[[], object | Awaitable[object]]
DEFAULT_LIFESPAN_TYPE = type(APIRouter().lifespan_context)


@dataclass(frozen=True)
class LifecycleHooks:
    startup: LifecycleCallback | None = None
    shutdown: LifecycleCallback | None = None


class LifecycleRegistry:
    def __init__(self) -> None:
        self.hooks: list[LifecycleHooks] = []
        self.active = False

    def capture_legacy(self, app: FastAPI) -> None:
        # FastAPI's compatibility lists pair independent resource handlers by
        # registration order. NEXEN retains exactly one such pair: task_scene.
        starts = app.router.on_startup
        stops = app.router.on_shutdown
        self.hooks.extend(LifecycleHooks(start, stop) for start, stop in zip_longest(starts, stops))
        starts.clear()
        stops.clear()


def registry_for(app: FastAPI) -> LifecycleRegistry:
    registry = getattr(app.state, 'nexen_lifecycle', None)
    if registry is None:
        registry = LifecycleRegistry()
        app.state.nexen_lifecycle = registry
    return registry


def register_lifecycle(app: FastAPI, *, startup: LifecycleCallback | None = None,
                       shutdown: LifecycleCallback | None = None) -> None:
    if startup is None and shutdown is None:
        raise ValueError('At least one lifecycle callback is required')
    if any(hook is not None and not callable(hook) for hook in (startup, shutdown)):
        raise TypeError('Lifecycle callbacks must be callable')
    registry = registry_for(app)
    if registry.active:
        raise RuntimeError('Cannot register workers while the application lifespan is active')
    current = app.router.lifespan_context
    if current is not lifespan:
        # Standalone module tests and small apps may use FastAPI's default
        # lifespan. Never silently replace another application's custom one.
        if type(current) is not DEFAULT_LIFESPAN_TYPE:
            raise ValueError('Create the application with app_lifecycle.lifespan before registering NEXEN workers')
        app.router.lifespan_context = lifespan
    registry.capture_legacy(app)
    registry.hooks.append(LifecycleHooks(startup, shutdown))


async def _invoke(callback: LifecycleCallback | None) -> None:
    if callback is not None:
        result = callback()
        if inspect.isawaitable(result):
            await result


@asynccontextmanager
async def lifespan(app: FastAPI):
    registry = registry_for(app)
    if registry.active:
        raise RuntimeError('NEXEN application lifespan is already active')
    registry.capture_legacy(app)
    registry.active = True
    started: list[LifecycleHooks] = []
    errors: list[BaseException] = []
    try:
        for hooks in tuple(registry.hooks):
            await _invoke(hooks.startup)
            started.append(hooks)
        yield
    except BaseException as error:
        errors.append(error)
    finally:
        for hooks in reversed(started):
            try:
                await _invoke(hooks.shutdown)
            except BaseException as error:
                errors.append(error)
        registry.active = False
    if len(errors) == 1:
        raise errors[0]
    if errors:
        cancellation = next((error for error in errors if isinstance(error, asyncio.CancelledError)), None)
        if cancellation is not None:
            cleanup_errors = [error for error in errors if error is not cancellation]
            raise cancellation from BaseExceptionGroup('NEXEN lifecycle cleanup failed', cleanup_errors)
        raise BaseExceptionGroup('NEXEN lifecycle failed', errors)
