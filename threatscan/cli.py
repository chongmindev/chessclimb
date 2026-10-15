"""threatscan report|drills|page — the pipeline from a PGN file to the trainer page."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import chess

from . import config
from .drills import build_items
from .engine import Engine
from .games import read_games
from .page import build_page
from .report import build_report

COLORS = {"white": chess.WHITE, "black": chess.BLACK, "both": None}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="threatscan")
    ap.add_argument("--config", help="path to config.toml")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("report", "drills"):
        s = sub.add_parser(name)
        s.add_argument("pgn")
        s.add_argument("out")
        s.add_argument("--user", required=True, help="your username in the PGN headers")
        s.add_argument("--color", choices=COLORS, default="both")
    s = sub.add_parser("page")
    s.add_argument("items")
    s.add_argument("template")
    s.add_argument("out")
    a = ap.parse_args(argv)

    if a.cmd == "page":
        n = build_page(json.loads(Path(a.items).read_text()), a.template, a.out)
        print(f"{n} positions -> {a.out}")
        return 0

    cfg = config.load(a.config)
    games = list(read_games(a.pgn, a.user, COLORS[a.color]))
    if not games:
        print(f"no games for {a.user} in {a.pgn}", file=sys.stderr)
        return 1
    with Engine(cfg.engine) as eng:
        if a.cmd == "report":
            out = build_report(games, eng, cfg)
            summary = f"{len(out)} games"
        else:
            out = build_items(games, eng, cfg)
            n_threat = sum(i["kind"] == "threat" for i in out)
            summary = f"{n_threat} threat, {len(out) - n_threat} safe"
        Path(a.out).write_text(json.dumps(out, indent=1))
        print(f"{summary} -> {a.out} (engine cache: {eng.hits} hits, {eng.misses} searches)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
