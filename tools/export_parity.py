"""Record a Python drill build for the JS parity test (local only: writes under data/, never committed).

Rebuilds the deck from the engine cache, recording every eval the selection asks for, then writes
data/parity/{games,evals,items}.json. Positions missing from the cache are searched (slow).

Usage: uv run python tools/export_parity.py data/games.pgn --user Dudacio
"""
from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

import chess

from cracktics import config
from cracktics.drills import build_items
from cracktics.engine import Engine
from cracktics.games import read_games

ROOT = Path(__file__).resolve().parent.parent


class Recording:
    def __init__(self, engine):
        self.engine, self.evals = engine, {}

    def analyse(self, board, depth, multipv=1):
        lines = self.engine.analyse(board, depth, multipv)
        self.evals[f"{board.fen()}|{depth}|{multipv}"] = [asdict(l) for l in lines]
        return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pgn")
    ap.add_argument("--user", required=True)
    a = ap.parse_args()
    cfg = config.load()
    games = list(read_games(a.pgn, a.user))
    with Engine(cfg.engine) as eng:
        rec = Recording(eng)
        items = build_items(games, rec, cfg)
        print(f"{len(items)} items, {len(rec.evals)} evals ({eng.misses} searched)")
    out = ROOT / "data/parity"
    out.mkdir(parents=True, exist_ok=True)
    js_games = [{"color": "w" if g.color == chess.WHITE else "b", "opponent": g.opponent, "date": g.date,
                 "result": g.result, **({"link": g.headers["Link"]} if "Link" in g.headers else {}),
                 "moves": [{"from": chess.square_name(m.from_square), "to": chess.square_name(m.to_square),
                            **({"promotion": chess.piece_symbol(m.promotion)} if m.promotion else {})}
                           for m in g.moves]} for g in games]
    for name, data in (("games", js_games), ("evals", rec.evals), ("items", items)):
        (out / f"{name}.json").write_text(json.dumps(data))
    print(f"-> {out}")


if __name__ == "__main__":
    main()
