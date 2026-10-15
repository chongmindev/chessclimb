"""Engine work in the background, one job at a time.

An MCP call can't wait half an hour for Stockfish, so long work runs as a job and
the tool returns its progress until it is done. Jobs share one worker thread
because the engine and its SQLite cache belong to the thread that opened them.
"""
from __future__ import annotations

import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable, Hashable


@dataclass
class Job:
    total: int                     # rough size, in positions
    done: int = 0
    status: str = "queued"         # queued, running, done, error
    result: Any = None
    error: str | None = None
    started: float = field(default_factory=time.time)

    def view(self) -> dict:
        return {"status": self.status, "positions_done": self.done, "positions_total": self.total,
                "seconds": round(time.time() - self.started), "error": self.error}


class Jobs:
    def __init__(self):
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="engine")
        self._jobs: dict[Hashable, Job] = {}
        self._lock = threading.Lock()

    def get_or_start(self, key: Hashable, total: int, work: Callable[[Job], Any]) -> Job:
        """The job for `key`, starting it if new or if the last attempt failed."""
        with self._lock:
            job = self._jobs.get(key)
            if job and job.status != "error":
                return job
            job = self._jobs[key] = Job(total)
        self._pool.submit(self._run, job, work)
        return job

    @staticmethod
    def _run(job: Job, work: Callable[[Job], Any]):
        job.status = "running"
        try:
            job.result = work(job)
            job.status = "done"
        except Exception as e:
            job.error = f"{type(e).__name__}: {e}"
            job.status = "error"
            traceback.print_exc()

    def shutdown(self):
        self._pool.shutdown(wait=False, cancel_futures=True)
