"""Finished games from the Chess.com Published Data API (public, no auth).

Fair play: only the monthly archives are used, and they hold finished games only.
The current-games endpoints (/games, /games/to-move) are never called.
"""
from __future__ import annotations

import json
import ssl
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from .config import FetchConfig

Getter = Callable[[str], bytes]
SYSTEM_CA = Path("/etc/ssl/cert.pem")    # macOS and most Linux distributions


def ssl_context() -> ssl.SSLContext:
    """Verifying context. python.org builds of Python on macOS ship without CA certificates, so fall back to the OS bundle."""
    ctx = ssl.create_default_context()
    if not ctx.cert_store_stats()["x509_ca"] and SYSTEM_CA.exists():
        ctx.load_verify_locations(SYSTEM_CA)
    return ctx


class ChessCom:
    def __init__(self, cfg: FetchConfig, get: Getter | None = None, now: datetime | None = None):
        self.cfg = cfg
        self.cache = Path(cfg.cache)
        self._get = get or self._http_get
        self._now = now
        self._last = 0.0
        self._ssl = ssl_context()

    def _http_get(self, url: str) -> bytes:
        for attempt in range(self.cfg.retries + 1):
            wait = self.cfg.min_interval - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            req = urllib.request.Request(url, headers={"User-Agent": self.cfg.user_agent})
            try:
                with urllib.request.urlopen(req, timeout=self.cfg.timeout, context=self._ssl) as r:
                    return r.read()
            except urllib.error.HTTPError as e:
                if e.code != 429 or attempt == self.cfg.retries:
                    raise
                time.sleep(self.cfg.backoff * (attempt + 1))
        raise AssertionError("unreachable")

    def _json(self, url: str, cache_name: str | None) -> dict:
        path = self.cache / cache_name if cache_name else None
        if path and path.exists():
            return json.loads(path.read_text())
        data = json.loads(self._get(url))
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data))
        return data

    def archives(self, username: str) -> list[str]:
        """Monthly archive URLs, oldest first. Never cached: a new month can appear."""
        url = f"{self.cfg.base_url}/player/{username.lower()}/games/archives"
        return self._json(url, None)["archives"]

    def month(self, archive_url: str) -> list[dict]:
        """Games in one monthly archive. Past months are final and cached; the current month is refetched."""
        user, year, mon = archive_url.rstrip("/").split("/")[-4], *archive_url.rstrip("/").split("/")[-2:]
        now = self._now or datetime.now(timezone.utc)
        final = (int(year), int(mon)) < (now.year, now.month)
        return self._json(archive_url, f"{user}/{year}-{mon}.json" if final else None)["games"]

    def games(self, username: str, months: int, time_classes: tuple[str, ...] | None) -> list[dict]:
        """Standard-chess games from the last `months` archives, oldest first, optionally by time class."""
        out = []
        for url in self.archives(username)[-months:]:
            out += [g for g in self.month(url)
                    if g.get("rules") == "chess" and "pgn" in g
                    and (not time_classes or g.get("time_class") in time_classes)]
        return sorted(out, key=lambda g: g.get("end_time", 0))


def to_pgn(games: list[dict]) -> str:
    return "\n\n".join(g["pgn"].strip() for g in games) + "\n"
