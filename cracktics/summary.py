"""Patterns across a game report: why games were lost, where blunders happen, results by opening."""
from __future__ import annotations

from collections import Counter, defaultdict

from .config import Config


def phase(move: int, cfg: Config) -> str:
    s = cfg.summary
    return "opening" if move <= s.opening_end else "middlegame" if move <= s.middlegame_end else "endgame"


def summarize(report: list[dict], cfg: Config) -> dict:
    s = cfg.summary
    results = Counter(g["result"] for g in report)
    by_color = defaultdict(Counter)
    for g in report:
        by_color[g["color"]][g["result"]] += 1

    losses = [g for g in report if g["result"] == "loss"]
    def lost_with(test):
        return sum(any(test(e) for e in g["errors"]) for g in losses)

    blunders = Counter(phase(e["move"], cfg) for g in report for e in g["errors"] if e["loss"] >= s.big_blunder)

    openings = defaultdict(Counter)
    for g in report:
        key = " ".join(g["opening"].split()[:s.opening_plies])
        openings[(g["color"], key)][g["result"]] += 1

    moves = sum(g["my_moves"] for g in report)
    return {
        "games": len(report),
        "record": _wdl(results),
        "record_by_color": {c: _wdl(r) for c, r in sorted(by_color.items())},
        "avg_centipawn_loss": round(sum(g["cpl_sum"] for g in report) / moves) if moves else None,
        "losses": {
            "total": len(losses),
            "hung_piece": lost_with(lambda e: e["hung"]),
            "allowed_mate": lost_with(lambda e: e["allowed_mate"]),
            "thrown_from_winning": lost_with(lambda e: e["before"] >= cfg.report.missed_win_before
                                             and e["loss"] >= s.big_blunder),
            "on_time": sum("on time" in g["term"] for g in losses),
        },
        "big_blunders_by_phase": {p: blunders[p] for p in ("opening", "middlegame", "endgame")},
        "results_by_opening": sorted(
            ({"color": c, "opening": o, **_wdl(r), "games": sum(r.values())} for (c, o), r in openings.items()),
            key=lambda x: (-x["games"], x["color"], x["opening"])),
    }


def _wdl(c: Counter) -> dict:
    return {"win": c["win"], "draw": c["draw"], "loss": c["loss"]}
