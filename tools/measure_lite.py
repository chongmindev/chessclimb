"""Does the browser's lite Stockfish pick the same drills as full native Stockfish? (--engine native1: noise baseline)

Builds the drill deck with stockfish.js lite (run under Node, same build the browser loads) and
compares it with a deck built by the native engine. Evals go to a separate cache file.

Usage: uv run python tools/measure_lite.py data/games.pgn data/items.json --user Dudacio
"""
from __future__ import annotations

import argparse
import json
import time
from dataclasses import replace
from pathlib import Path

import chess.engine

from cracktics import config
from cracktics.drills import build_items
from cracktics.engine import Engine
from cracktics.games import read_games

ROOT = Path(__file__).resolve().parent.parent
LITE = ROOT / "web/node_modules/stockfish/bin/stockfish-19-lite-single.js"


class LiteEngine(Engine):
    def _engine(self):
        if self._uci is None:
            self._uci = chess.engine.SimpleEngine.popen_uci(["node", str(LITE)], timeout=60)
            self._uci.configure({"Threads": 1, "Hash": 64})   # as in the browser: one single-threaded engine per core
        return self._uci


class NativeOneThread(Engine):
    """Noise baseline: the native full engine with 1 thread, against the usual 4-thread deck."""
    def _engine(self):
        if self._uci is None:
            from cracktics.engine import find_stockfish
            self._uci = chess.engine.SimpleEngine.popen_uci(find_stockfish(self.cfg.path))
            self._uci.configure({"Threads": 1, "Hash": 64})
        return self._uci


ENGINES = {"lite": (LiteEngine, "data/engine_cache.lite.sqlite", "data/items.lite.json"),
           "native1": (NativeOneThread, "data/engine_cache.native1.sqlite", "data/items.native1.json")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pgn")
    ap.add_argument("full_items", help="deck built by the native engine with the same config")
    ap.add_argument("--user", required=True)
    ap.add_argument("--engine", choices=ENGINES, default="lite")
    a = ap.parse_args()

    cfg = config.load()
    games = list(read_games(a.pgn, a.user))
    t = time.time()
    cls, cache, out = ENGINES[a.engine]
    with cls(replace(cfg.engine, cache=str(ROOT / cache))) as eng:
        lite = build_items(games, eng, cfg)
        searches = eng.misses
    secs = time.time() - t
    Path(ROOT / out).write_text(json.dumps(lite, indent=1))

    full = json.loads(Path(a.full_items).read_text())
    threats = lambda items: {i["id"]: i for i in items if i["kind"] == "threat"}
    ft, lt = threats(full), threats(lite)
    both = ft.keys() & lt.keys()
    same_reply = sum(ft[k]["reply"] == lt[k]["reply"] for k in both)
    accepted = sum(lt[k]["reply"] in ft[k]["accept_san"] for k in both)
    print(f"{a.engine}: {len(lite)} items in {secs / 60:.1f} min, {searches} searches "
          f"({searches / secs if secs else 0:.1f}/s)")
    print(f"threats  full {len(ft)}  lite {len(lt)}  both {len(both)}  "
          f"recall {len(both) / len(ft):.1%}  precision {len(both) / len(lt):.1%}")
    print(f"on shared threats: same best reply {same_reply}/{len(both)}, "
          f"lite reply accepted by full {accepted}/{len(both)}")
    for name, ids, src in (("only full", ft.keys() - lt.keys(), ft), ("only lite", lt.keys() - ft.keys(), lt)):
        print(f"\n{name}:")
        for k in sorted(ids, key=lambda k: -src[k]["swing"]):
            i = src[k]
            print(f"  {i['date']} {i['color']} {i['move']} {i['san']:7} reply {i['reply']:7} "
                  f"swing {i['swing']:5}  eval {i['evb']} -> {i['eva']}")


if __name__ == "__main__":
    main()
