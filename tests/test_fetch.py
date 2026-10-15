import json
from dataclasses import replace
from datetime import datetime, timezone

from cracktics import config
from cracktics.fetch import ChessCom, to_pgn

BASE = "https://api.chess.com/pub/player/dudacio/games"
NOW = datetime(2026, 10, 14, tzinfo=timezone.utc)


def game(n, rules="chess", tc="rapid"):
    return {"pgn": f'[Event "g{n}"]\n\n1. e4 e5 1-0', "rules": rules, "time_class": tc, "end_time": n}


PAGES = {
    f"{BASE}/archives": {"archives": [f"{BASE}/2026/07", f"{BASE}/2026/09", f"{BASE}/2026/10"]},
    f"{BASE}/2026/07": {"games": [game(1)]},
    f"{BASE}/2026/09": {"games": [game(3), game(2, tc="bullet"), game(4, rules="chess960")]},
    f"{BASE}/2026/10": {"games": [game(5), game(6, tc="blitz")]},
}


def client(tmp_path):
    calls = []

    def get(url):
        calls.append(url)
        return json.dumps(PAGES[url]).encode()

    cfg = replace(config.load().fetch, cache=str(tmp_path / "cache"))
    return ChessCom(cfg, get=get, now=NOW), calls


def test_reads_last_archives_filters_and_sorts(tmp_path):
    c, calls = client(tmp_path)
    games = c.games("Dudacio", 2, ("rapid",))
    assert [g["end_time"] for g in games] == [3, 5]
    assert f"{BASE}/2026/07" not in calls
    assert [g["end_time"] for g in c.games("dudacio", 2, None)] == [2, 3, 5, 6]   # chess960 always dropped


def test_past_months_are_cached_current_month_is_not(tmp_path):
    c, calls = client(tmp_path)
    c.games("dudacio", 2, None)
    calls.clear()
    c.games("dudacio", 2, None)
    assert calls == [f"{BASE}/archives", f"{BASE}/2026/10"]


def test_never_calls_current_games_endpoints(tmp_path):
    c, calls = client(tmp_path)
    c.games("dudacio", 3, None)
    assert all(u.endswith("/archives") or u.split("/")[-2].isdigit() for u in calls)
    assert not any(u.endswith(("/games", "/to-move")) for u in calls)


def test_to_pgn_joins_games():
    assert to_pgn([game(1), game(2)]).count("[Event") == 2
