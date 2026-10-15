"""Per-game error report: centipawn loss, blunders and what kind they were."""
from __future__ import annotations

from typing import Iterable

import chess

from .config import Config
from .engine import Engine
from .games import Game

VALUE = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}


def game_report(game: Game, engine: Engine, cfg: Config) -> dict:
    r, cap = cfg.report, cfg.engine.eval_cap
    me = game.color
    clamp = lambda v: max(-cap, min(cap, v))
    board = chess.Board()
    opening = []
    for mv in game.moves[:4]:
        opening.append(board.san(mv))
        board.push(mv)
    board = chess.Board()
    rec = dict(date=game.date, color="white" if me == chess.WHITE else "black",
               opponent=game.opponent, opp_elo=_elo(game, not me), my_elo=_elo(game, me),
               result=game.result, term=game.headers.get("Termination", ""),
               nmoves=(len(game.moves) + 1) // 2, opening=" ".join(opening),
               errors=[], castled=None, queen_early=0, my_moves=0, cpl_sum=0)
    line = engine.analyse(board, r.depth)[0]
    for i, mv in enumerate(game.moves):
        n = i // 2 + 1
        if board.turn != me:
            board.push(mv)
            line = engine.analyse(board, r.depth)[0]
            continue
        before_line = line
        before = clamp(line.pov(me))
        best_san = board.san(chess.Move.from_uci(line.move)) if line.move else None
        san = board.san(mv)
        piece = board.piece_at(mv.from_square)
        if board.is_castling(mv) and rec["castled"] is None:
            rec["castled"] = n
        if piece.piece_type == chess.QUEEN and n <= r.early_queen_moves:
            rec["queen_early"] += 1
        board.push(mv)
        line = engine.analyse(board, r.depth)[0]
        after = clamp(line.pov(me))
        loss = max(0, before - after)
        rec["my_moves"] += 1
        rec["cpl_sum"] += min(loss, r.cpl_cap)
        if loss < r.error_loss:
            continue
        reply = chess.Move.from_uci(line.move) if line.move else None
        captured = board.piece_at(reply.to_square) if reply and board.is_capture(reply) else None
        mine_mate = lambda l: l.mate is not None and (l.mate > 0) == (me == chess.WHITE)
        theirs_mate = lambda l: l.mate is not None and l.mate != 0 and not mine_mate(l)
        missed_mate = mine_mate(before_line) and not mine_mate(line)
        rec["errors"].append(dict(
            move=n, san=san, best=best_san, loss=loss, before=before, after=after,
            reply=board.san(reply) if reply else None,
            hung=bool(captured and VALUE[captured.piece_type] >= r.hung_min_value),
            missed_mate=missed_mate,
            allowed_mate=theirs_mate(line) and not theirs_mate(before_line),
            missed_win=before >= r.missed_win_before and loss >= r.missed_win_loss and not missed_mate,
            piece=chess.piece_name(piece.piece_type), fen=board.fen()))
    return rec


def _elo(game: Game, color: chess.Color) -> int | None:
    v = game.headers.get("WhiteElo" if color == chess.WHITE else "BlackElo", "")
    return int(v) if v.isdigit() else None


def build_report(games: Iterable[Game], engine: Engine, cfg: Config) -> list[dict]:
    return [game_report(g, engine, cfg) for g in games]
