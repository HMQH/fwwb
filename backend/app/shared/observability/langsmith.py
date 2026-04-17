from __future__ import annotations

import os
from contextlib import nullcontext
from typing import Any, Callable, TypeVar

from app.shared.core.config import settings

try:
    from langsmith import traceable as _traceable
    from langsmith.run_helpers import tracing_context as _tracing_context
except ImportError:  # pragma: no cover
    _traceable = None
    _tracing_context = None

F = TypeVar("F", bound=Callable[..., Any])


def configure_langsmith_environment() -> None:
    if settings.langsmith_api_key:
        os.environ["LANGSMITH_API_KEY"] = settings.langsmith_api_key
    if settings.langsmith_project:
        os.environ["LANGSMITH_PROJECT"] = settings.langsmith_project
    if settings.langsmith_endpoint:
        os.environ["LANGSMITH_ENDPOINT"] = settings.langsmith_endpoint
    if settings.langsmith_workspace_id:
        os.environ["LANGSMITH_WORKSPACE_ID"] = settings.langsmith_workspace_id
    os.environ["LANGSMITH_TRACING"] = "true" if settings.langsmith_tracing else "false"


def traceable(*args: Any, **kwargs: Any):
    if _traceable is None:
        if args and callable(args[0]) and len(args) == 1 and not kwargs:
            return args[0]

        def _decorator(func: F) -> F:
            return func

        return _decorator

    configure_langsmith_environment()
    return _traceable(*args, **kwargs)


def tracing_session() -> Any:
    configure_langsmith_environment()
    if _tracing_context is None or not settings.langsmith_tracing:
        return nullcontext()
    return _tracing_context(enabled=True)
