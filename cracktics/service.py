"""What the MCP tools do, without the MCP layer: fetch, then report or drill items as background jobs."""
from __future__ import annotations

import hashlib
import io
from typing import Callable

import chess

from .config import Config
from .drills import build_items
from .engine import Engine
from .fetch import ChessCom, to_pgn
from .games import Game, read_games
from .jobs import Job, Jobs
from .report import build_report
from .summary import summarize

COLORS = {"white": chess.WHITE, "black": chess.BLACK, "both": None}


class _Counting:
    """Engine stand-in that counts positions into a job's progress."""
    def __init__(self, engine: Engine, job: Job):
        self.engine, self.job = engine, job

    def analyse(self, board, depth, multipv=1):
        self.job.done += 1
        return self.engine.analyse(board, depth, multipv)


class Service:
    def __init__(self, cfg: Config, chesscom: ChessCom | None = None,
                 engine_factory: Callable[[], Engine] | None = None):
        self.cfg = cfg
        self.chesscom = chesscom or ChessCom(cfg.fetch)
        self.engine_factory = engine_factory or (lambda: Engine(cfg.engine))
        self.jobs = Jobs()

    def _time_classes(self, time_classes: list[str] | None) -> tuple[str, ...] | None:
        tc = self.cfg.fetch.time_classes if time_classes is None else tuple(time_classes)
        return None if not tc or "all" in tc else tc

    def games(self, username: str, months: int | None = None, time_classes: list[str] | None = None,
              color: str = "both") -> list[Game]:
        raw = self.chesscom.games(username, months or self.cfg.fetch.months, self._time_classes(time_classes))
        if not raw:
            return []
        return list(read_games(io.StringIO(to_pgn(raw)), username, COLORS[color]))

    def fetch_games(self, username, months=None, time_classes=None) -> dict:
        games = self.games(username, months, time_classes)
        return {"count": len(games), "games": [
            {"date": g.date, "color": "white" if g.color == chess.WHITE else "black", "opponent": g.opponent,
             "result": g.result, "time_control": g.headers.get("TimeControl"),
             "termination": g.headers.get("Termination"), "link": g.headers.get("Link")}
            for g in games]}

    def _job(self, kind: str, games: list[Game], build) -> Job:
        """One job per kind and exact set of games, so new games start a new job and old results are reused."""
        ids = "\n".join(g.headers.get("Link") or f"{g.date} {g.opponent} {len(g.moves)}" for g in games)
        key = (kind, hashlib.sha1(ids.encode()).hexdigest())

        def work(job: Job):
            with self.engine_factory() as eng:
                return build(games, _Counting(eng, job), self.cfg)

        return self.jobs.get_or_start(key, sum(len(g.moves) + 1 for g in games), work)

    def _respond(self, job: Job, key: str, shape: Callable = lambda r: r) -> dict:
        if job.status == "done":
            return {"status": "done", key: shape(job.result)}
        return {**job.view(), "note": "Engine work runs in the background and is cached; call again for the result."}

    def analyze_games(self, username, months=None, color="both", time_classes=None) -> dict:
        games = self.games(username, months, time_classes, color)
        if not games:
            return {"status": "done", "games": []}
        return self._respond(self._job("report", games, build_report), "games")

    def get_drill_positions(self, username, months=None, color="both", time_classes=None) -> dict:
        games = self.games(username, months, time_classes, color)
        if not games:
            return {"status": "done", "items": []}
        return self._respond(self._job("drills", games, build_items), "items")

    def summary(self, username, months=None, color="both", time_classes=None) -> dict:
        games = self.games(username, months, time_classes, color)
        if not games:
            return {"status": "done", "summary": summarize([], self.cfg)}
        job = self._job("report", games, build_report)
        return self._respond(job, "summary", lambda r: summarize(r, self.cfg))
