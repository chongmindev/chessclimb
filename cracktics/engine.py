"""Stockfish wrapper with a SQLite cache of evaluations keyed by position.

Positions are sent to the engine as a bare FEN (no move history), so the result
depends only on (FEN, depth, MultiPV) and is safe to cache.
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
from dataclasses import dataclass
from pathlib import Path

import chess
import chess.engine

from .config import EngineConfig


@dataclass(frozen=True)
class Line:
    """One engine line. `cp` is from White's point of view, mates folded in, uncapped."""
    move: str | None   # UCI of the first move, None in a game-over position
    cp: int
    mate: int | None   # moves to mate from White's point of view, None if no mate

    def pov(self, color: chess.Color) -> int:
        return self.cp if color == chess.WHITE else -self.cp


EXTRA_BIN = ("/opt/homebrew/bin", "/usr/local/bin")   # apps launched from the Dock don't get the shell PATH


def find_stockfish(path: str) -> str:
    found = shutil.which(path, path=os.pathsep.join([os.environ.get("PATH", ""), *EXTRA_BIN]))
    if not found:
        raise FileNotFoundError(f"Stockfish not found ({path!r}); install it or set $STOCKFISH")
    return found


class Engine:
    def __init__(self, cfg: EngineConfig, cache_path: str | Path | None = None):
        self.cfg = cfg
        path = Path(cache_path or cfg.cache)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("CREATE TABLE IF NOT EXISTS evals (fen TEXT, depth INT, multipv INT, "
                        "lines TEXT, PRIMARY KEY (fen, depth, multipv))")
        self._uci: chess.engine.SimpleEngine | None = None
        self.hits = self.misses = 0

    def _engine(self) -> chess.engine.SimpleEngine:
        if self._uci is None:
            self._uci = chess.engine.SimpleEngine.popen_uci(find_stockfish(self.cfg.path))
            self._uci.configure({"Threads": self.cfg.threads, "Hash": self.cfg.hash_mb})
        return self._uci

    def analyse(self, board: chess.Board, depth: int, multipv: int = 1) -> list[Line]:
        """Best lines for the side to move, best first. Game-over positions get one line with move None."""
        fen = board.fen()
        row = self.db.execute("SELECT lines FROM evals WHERE fen=? AND depth=? AND multipv=?",
                              (fen, depth, multipv)).fetchone()
        if row:
            self.hits += 1
            return [Line(**d) for d in json.loads(row[0])]
        self.misses += 1
        lines = self._search(chess.Board(fen), depth, multipv)
        self.db.execute("INSERT OR REPLACE INTO evals VALUES (?,?,?,?)",
                        (fen, depth, multipv, json.dumps([l.__dict__ for l in lines])))
        self.db.commit()
        return lines

    def _search(self, board: chess.Board, depth: int, multipv: int) -> list[Line]:
        if board.is_game_over():
            outcome = board.outcome()
            if outcome.winner is None:
                return [Line(None, 0, None)]
            sign = 1 if outcome.winner == chess.WHITE else -1
            return [Line(None, sign * self.cfg.mate_score, 0)]
        infos = self._engine().analyse(board, chess.engine.Limit(depth=depth), multipv=multipv)
        lines = []
        for info in infos:
            score = info["score"].white()
            pv = info.get("pv")
            lines.append(Line(pv[0].uci() if pv else None,
                              score.score(mate_score=self.cfg.mate_score), score.mate()))
        return lines

    def close(self):
        if self._uci is not None:
            self._uci.quit()
            self._uci = None
        self.db.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
