"""Two-pass scan: how shallow can the first pass be, and how much deep work does it save?

Pass 1 searches every position at a shallow depth. A move of mine goes to pass 2 (the normal deep
selection) if its shallow numbers come within `margin` of a threat or safe-candidate threshold.
Pass 2 is exactly the single-pass rule, so the only error is a drill whose move pass 1 didn't send on.

Ground truth: the single-pass lite deck (tools/measure_lite.py). Shallow evals use the lite engine,
one cache file per depth.

Usage: uv run python tools/measure_twopass.py data/games.pgn --user Dudacio --depth 8
       uv run python tools/measure_twopass.py data/games.pgn --user Dudacio --report 6 8 10
"""
from __future__ import annotations

import argparse
import json
from dataclasses import replace
from pathlib import Path

import chess

from threatscan import config
from threatscan.drills import item_id, sample_key
from threatscan.games import read_games

from measure_lite import LiteEngine

ROOT = Path(__file__).resolve().parent.parent
MARGINS = (0, 50, 100, 150, 200)


def shallow_plies(games, eng, depth, cap):
    """For each of my moves: (item id, move number, shallow before, shallow after, fen after, move)."""
    clamp = lambda v: max(-cap, min(cap, v))
    out = []
    for g in games:
        b = chess.Board()
        line = eng.analyse(b, depth)[0]
        for i, mv in enumerate(g.moves):
            mine = b.turn == g.color
            before = clamp(line.pov(g.color))
            b.push(mv)
            if mine and b.is_game_over():
                break
            line = eng.analyse(b, depth)[0]
            if mine:
                out.append((item_id(b.fen(), mv), i // 2 + 1, before, clamp(line.pov(g.color)), b.fen(), mv))
    return out


def evaluate(plies, deck, c, margin):
    threat_ids = {i["id"] for i in deck if i["kind"] == "threat"}
    safe_ids = {i["id"] for i in deck if i["kind"] == "safe"}
    sent = set()
    for pid, n, before, after, fen, mv in plies:
        loss = max(0, before - after)
        threat = n >= c.threat_min_move and before > c.threat_min_before - margin and loss >= c.threat_min_loss - margin
        safe = (n >= c.safe_min_move and loss <= c.safe_max_loss + margin
                and sample_key(c.seed, fen, mv) < c.safe_sample_rate)
        if threat or safe:
            sent.add(pid)
    return {"margin": margin,
            "threat_recall": len(threat_ids & sent) / len(threat_ids),
            "safe_recall": len(safe_ids & sent) / len(safe_ids) if safe_ids else 1.0,
            "sent": len(sent), "moves": len(plies),
            "missed": sorted(threat_ids - sent)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pgn")
    ap.add_argument("--user", required=True)
    ap.add_argument("--depth", type=int, help="search all positions at this depth (fills the cache)")
    ap.add_argument("--report", type=int, nargs="*", help="depths to report on (from cache)")
    a = ap.parse_args()
    cfg = config.load()
    games = list(read_games(a.pgn, a.user))
    deck = json.loads((ROOT / "data/items.lite.json").read_text())
    for depth in ([a.depth] if a.depth else []) + (a.report or []):
        cache = ROOT / f"data/engine_cache.lite.d{depth}.sqlite"
        with LiteEngine(replace(cfg.engine, cache=str(cache))) as eng:
            plies = shallow_plies(games, eng, depth, cfg.engine.eval_cap)
            searched = eng.misses
        positions = sum(len(g.moves) + 1 for g in games)
        print(f"\ndepth {depth}: {len(plies)} of my moves, {positions} positions ({searched} searched now)")
        print(f"{'margin':>7} {'threat recall':>14} {'safe recall':>12} {'moves sent':>11} {'deep positions':>15}")
        for m in MARGINS:
            r = evaluate(plies, deck, cfg.drills, m)
            # each sent move needs its before and after position deep (shared between neighbours ignored: upper bound)
            print(f"{m:>7} {r['threat_recall']:>14.1%} {r['safe_recall']:>12.1%} {r['sent']:>5}/{r['moves']:<5} "
                  f"{min(positions, 2 * r['sent']):>8} ({min(positions, 2 * r['sent']) / positions:.0%})")


if __name__ == "__main__":
    main()
