"""Choosing drill positions: the board right after one of my moves, opponent to move.

A *threat* item is a move that lost a lot to a forcing reply (find the punishment).
A *safe* item is a move that cost nothing (recognise there is no punishment).
"""
from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Iterable, Iterator

import chess

from .config import Config, DrillConfig
from .engine import Engine, Line
from .games import Game


@dataclass
class Ply:
    """One of my moves with evals around it. Evals are mine, clamped to +/- eval_cap."""
    game: Game
    move_number: int
    board: chess.Board          # position after my move, opponent to move
    move: chess.Move
    san: str
    best_san: str | None        # engine's choice instead of my move
    before: int
    after: int
    fen_before: str = ""        # position before my move, me to move (for the trainer's "fix it" step)

    @property
    def loss(self) -> int:
        return max(0, self.before - self.after)


def walk(game: Game, engine: Engine, depth: int, cap: int) -> Iterator[Ply]:
    """My moves in one game. Stops if my move ends the game."""
    clamp = lambda v: max(-cap, min(cap, v))
    board = chess.Board()
    line = engine.analyse(board, depth)[0]
    for i, mv in enumerate(game.moves):
        mine = board.turn == game.color
        if mine:
            before = clamp(line.pov(game.color))
            best_san = board.san(chess.Move.from_uci(line.move)) if line.move else None
            san = board.san(mv)
            fen_before = board.fen()
        board.push(mv)
        if mine and board.is_game_over():
            return
        line = engine.analyse(board, depth)[0]
        if mine:
            yield Ply(game, i // 2 + 1, board.copy(stack=False), mv, san, best_san,
                      before, clamp(line.pov(game.color)), fen_before)


def is_threat_candidate(c: DrillConfig, p: Ply) -> bool:
    return p.move_number >= c.threat_min_move and p.before > c.threat_min_before and p.loss >= c.threat_min_loss


def is_safe_candidate(c: DrillConfig, p: Ply) -> bool:
    return p.move_number >= c.safe_min_move and p.loss <= c.safe_max_loss


def threat_item(c: DrillConfig, p: Ply, lines: list[Line], cap: int) -> dict | None:
    """Item if the opponent's best reply is a check or capture, else None. `lines` is MultiPV for the opponent."""
    opp = not p.game.color
    lines = [l for l in lines if l.move]
    if not lines or not p.best_san:
        return None
    top = lines[0]
    top_mv = chess.Move.from_uci(top.move)
    if not (p.board.is_capture(top_mv) or p.board.gives_check(top_mv)):
        return None
    opp_cp = lambda l: max(-cap, min(cap, l.pov(opp)))
    accept = [l for l in lines
              if opp_cp(l) >= opp_cp(top) - c.accept_within and opp_cp(l) >= -p.before + c.accept_min_gain]
    if not accept:
        return None
    mate = top.mate if top.mate is None or opp == chess.WHITE else -top.mate
    return dict(_base(p), kind="threat",
                accept=[l.move for l in accept],
                accept_san=[p.board.san(chess.Move.from_uci(l.move)) for l in accept],
                reply=p.board.san(top_mv), mate=mate, better=p.best_san,
                swing=pawns(p.loss))


def safe_item(c: DrillConfig, p: Ply, lines: list[Line], cap: int) -> dict | None:
    lines = [l for l in lines if l.move]
    if not lines or not (c.safe_after_min <= p.after <= c.safe_after_max):
        return None
    top = lines[0]
    if max(-cap, min(cap, top.pov(not p.game.color))) >= c.safe_max_opp_eval:
        return None
    return dict(_base(p), kind="safe", reply=p.board.san(chess.Move.from_uci(top.move)))


def pawns(cp: int) -> float:
    """Centipawns to pawns at one decimal, halves away from zero, in integers so the JS port matches exactly."""
    tenths = (abs(cp) + 5) // 10
    return (tenths if cp >= 0 else -tenths) / 10


def sample_key(seed: int, fen: str, move: chess.Move) -> float:
    """A number in [0, 1) fixed by the position and move. Safe items are sampled and capped by it, so the
    choice doesn't depend on game order and stays put when new games are added."""
    return int(hashlib.sha1(f"{seed} {fen} {move.uci()}".encode()).hexdigest()[:13], 16) / 16 ** 13


def item_id(fen: str, move: chess.Move) -> str:
    """Stable across rebuilds, so spaced-repetition progress keeps pointing at the same position."""
    return hashlib.sha1(f"{fen} {move.uci()}".encode()).hexdigest()[:12]


def _base(p: Ply) -> dict:
    return {"id": item_id(p.board.fen(), p.move), "fen": p.board.fen(), "before_fen": p.fen_before,
            "color": "w" if p.game.color == chess.WHITE else "b",
            "from": chess.square_name(p.move.from_square), "to": chess.square_name(p.move.to_square),
            "san": p.san, "move": p.move_number, "opp": p.game.opponent, "date": p.game.date,
            "result": p.game.result, "evb": pawns(p.before), "eva": pawns(p.after),
            **({"link": link} if (link := p.game.headers.get("Link")) else {})}


def build_items(games: Iterable[Game], engine: Engine, cfg: Config) -> list[dict]:
    c, cap = cfg.drills, cfg.engine.eval_cap
    threats, safes = [], []
    for game in games:
        for p in walk(game, engine, c.depth, cap):
            if is_threat_candidate(c, p):
                item = threat_item(c, p, engine.analyse(p.board, c.depth, c.multipv), cap)
                if item:
                    threats.append(item)
            elif is_safe_candidate(c, p) and (key := sample_key(c.seed, p.board.fen(), p.move)) < c.safe_sample_rate:
                item = safe_item(c, p, engine.analyse(p.board, c.depth, c.multipv), cap)
                if item:
                    safes.append((key, item))
    safes.sort(key=lambda s: s[0])
    return threats + [item for _, item in safes[:math.floor(len(threats) * c.safe_ratio + 0.5)]]
