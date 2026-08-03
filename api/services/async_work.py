import asyncio
import os
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")


def _sem_limit(env_name: str, default: int) -> int:
    raw = os.getenv(env_name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(1, value)


_LOAD_SEMAPHORE = asyncio.Semaphore(_sem_limit("API_SEM_LOAD", 12))
_CPU_SEMAPHORE = asyncio.Semaphore(_sem_limit("API_SEM_CPU", 3))
_STUDY_SEMAPHORE = asyncio.Semaphore(_sem_limit("API_SEM_STUDY", 6))
_CHEAP_SEMAPHORE = asyncio.Semaphore(_sem_limit("API_SEM_CHEAP", 32))


async def _run_with(
    semaphore: asyncio.Semaphore,
    func: Callable[..., T],
    /,
    *args,
    **kwargs,
) -> T:
    async with semaphore:
        return await asyncio.to_thread(func, *args, **kwargs)


async def run_load(func: Callable[..., T], /, *args, **kwargs) -> T:
    return await _run_with(_LOAD_SEMAPHORE, func, *args, **kwargs)


async def run_cpu(func: Callable[..., T], /, *args, **kwargs) -> T:
    return await _run_with(_CPU_SEMAPHORE, func, *args, **kwargs)


async def run_study(func: Callable[..., T], /, *args, **kwargs) -> T:
    return await _run_with(_STUDY_SEMAPHORE, func, *args, **kwargs)


async def run_cheap(func: Callable[..., T], /, *args, **kwargs) -> T:
    return await _run_with(_CHEAP_SEMAPHORE, func, *args, **kwargs)
