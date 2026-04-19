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


def _langsmith_enabled() -> bool:
    return bool(
        settings.langsmith_tracing
        and _traceable is not None
        and str(settings.langsmith_api_key or "").strip()
    )


def configure_langsmith_environment() -> None:
    if not _langsmith_enabled():
        os.environ["LANGSMITH_TRACING"] = "false"
        os.environ.pop("LANGSMITH_API_KEY", None)
        os.environ.pop("LANGSMITH_PROJECT", None)
        os.environ.pop("LANGSMITH_ENDPOINT", None)
        os.environ.pop("LANGSMITH_WORKSPACE_ID", None)
        return

    os.environ["LANGSMITH_API_KEY"] = str(settings.langsmith_api_key or "").strip()
    if settings.langsmith_project:
        os.environ["LANGSMITH_PROJECT"] = settings.langsmith_project
    else:
        os.environ.pop("LANGSMITH_PROJECT", None)
    if settings.langsmith_endpoint:
        os.environ["LANGSMITH_ENDPOINT"] = settings.langsmith_endpoint
    else:
        os.environ.pop("LANGSMITH_ENDPOINT", None)
    if settings.langsmith_workspace_id:
        os.environ["LANGSMITH_WORKSPACE_ID"] = settings.langsmith_workspace_id
    else:
        os.environ.pop("LANGSMITH_WORKSPACE_ID", None)
    os.environ["LANGSMITH_TRACING"] = "true"


def traceable(*args: Any, **kwargs: Any):
    if _traceable is None or not _langsmith_enabled():
        if args and callable(args[0]) and len(args) == 1 and not kwargs:
            return args[0]

        def _decorator(func: F) -> F:
            return func

        return _decorator

    configure_langsmith_environment()
    return _traceable(*args, **kwargs)


def tracing_session() -> Any:
    configure_langsmith_environment()
    if _tracing_context is None or not _langsmith_enabled():
        return nullcontext()
    return _tracing_context(enabled=True)
