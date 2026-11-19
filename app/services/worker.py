"""Shared APScheduler-based background worker manager.

Replaces raw ``threading`` workers with a single managed scheduler that survives
individual job failures and can be stopped and restarted safely from FastAPI's
lifespan. Jobs are registered by the service modules and recreated on every
start, so dev reloads and repeated test lifespans do not leave an empty
scheduler behind.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Callable

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger(__name__)


class WorkerManager:
    """Manages a single APScheduler instance and the jobs registered on it."""

    def __init__(self) -> None:
        self._scheduler = BackgroundScheduler(timezone=timezone.utc)
        self._specs: dict[str, dict] = {}
        self._jobs: dict[str, object] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._last_run: dict[str, datetime | None] = {}
        self._last_error: dict[str, str | None] = {}
        self._started = False
        self._lifecycle_lock = threading.RLock()

    def register(
        self,
        job_id: str,
        func: Callable,
        interval_seconds: int,
        *,
        max_instances: int = 1,
        coalesce: bool = True,
        description: str = "",
    ) -> None:
        """Register a recurring job. Re-registering an existing job is a no-op."""
        with self._lifecycle_lock:
            if job_id in self._specs:
                return
            self._specs[job_id] = {
                "func": func,
                "interval_seconds": interval_seconds,
                "max_instances": max_instances,
                "coalesce": coalesce,
                "description": description,
            }
            self._last_run[job_id] = None
            self._last_error[job_id] = None
            if self._started:
                self._add_job(job_id)
            logger.info("Registered worker job %s (%s)", job_id, description or "no description")

    def _add_job(self, job_id: str) -> None:
        spec = self._specs[job_id]
        lock = threading.Lock()
        self._locks[job_id] = lock

        def _guarded() -> None:
            if not lock.acquire(blocking=False):
                logger.warning("Job %s skipped: previous run still in progress", job_id)
                return
            try:
                spec["func"]()
                self._last_error[job_id] = None
            except Exception as exc:
                logger.exception("Job %s failed", job_id)
                self._last_error[job_id] = f"{type(exc).__name__}: {exc}"
            finally:
                self._last_run[job_id] = datetime.now(timezone.utc)
                lock.release()

        trigger = IntervalTrigger(seconds=max(1, int(spec["interval_seconds"])))
        self._jobs[job_id] = self._scheduler.add_job(
            _guarded,
            trigger=trigger,
            id=job_id,
            name=spec["description"] or job_id,
            max_instances=spec["max_instances"],
            coalesce=spec["coalesce"],
            replace_existing=True,
            misfire_grace_time=30,
        )

    def start(self) -> None:
        with self._lifecycle_lock:
            if self._started:
                return
            self._scheduler = BackgroundScheduler(timezone=timezone.utc)
            for job_id in list(self._specs):
                self._add_job(job_id)
            self._scheduler.start()
            self._started = True
            logger.info("Worker scheduler started")

    def stop(self, wait: bool = True) -> None:
        with self._lifecycle_lock:
            if not self._started:
                return
            self._scheduler.shutdown(wait=wait)
            self._started = False
            logger.info("Worker scheduler stopped")

    def status(self) -> list[dict]:
        """Return a serialisable status snapshot for diagnostics/health."""
        with self._lifecycle_lock:
            out = []
            for job_id, job in self._jobs.items():
                out.append({
                    "id": job_id,
                    "name": job.name,
                    "next_run_at": job.next_run_time.isoformat() if job.next_run_at else None,
                    "last_run_at": self._last_run.get(job_id).isoformat() if self._last_run.get(job_id) else None,
                    "last_error": self._last_error.get(job_id),
                })
            return out


worker = WorkerManager()


def start_worker() -> None:
    worker.start()


def stop_worker() -> None:
    worker.stop()


def status() -> list[dict]:
    return worker.status()
