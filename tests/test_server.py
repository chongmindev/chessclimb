import asyncio
import json
import time
from dataclasses import replace
from datetime import datetime, timezone

import chess
import pytest

from cracktics import config
from cracktics.engine import Line
from cracktics.fetch import ChessCom
from cracktics.jobs import Jobs
from cracktics.server import create_server
from cracktics.service import Service
from cracktics.summary import summarize

CFG = config.load()
BASE = "https://api.chess.com/pub/player/me/games"

# Scholar's mate against me as Black, and a short win as White.
PGN_LOSS = ('[White "them"]\n[Black "me"]\n[Result "1-0"]\n[Date "2026.10.01"]\n'
            '[Termination "them won by checkmate"]\n[Link "g1"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0')
PGN_WIN = ('[White "me"]\n[Black "them"]\n[Result "1-0"]\n[Date "2026.10.02"]\n'
           '[Termination "me won by resignation"]\n[Link "g2"]\n\n1. d4 d5 2. c4 1-0')


class FakeEngine:
    """Scores everything 0 except the position after 3...Nf6, where White mates."""
    def __init__(self):
        b = chess.Board()
        for san in "e4 e5 Qh5 Nc6 Bc4 Nf6".split():
            b.push_san(san)
        self.blunder = b.fen()

    def analyse(self, board, depth, multipv=1):
        if board.fen() == self.blunder:
            return [Line("h5f7", 10000, 1)]
        mv = next(iter(board.legal_moves), None)
        return [Line(mv.uci() if mv else None, 0, None)]

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass


@pytest.fixture
def service(tmp_path):
    pages = {f"{BASE}/archives": {"archives": [f"{BASE}/2026/10"]},
             f"{BASE}/2026/10": {"games": [
                 {"pgn": PGN_LOSS, "rules": "chess", "time_class": "rapid", "end_time": 1},
                 {"pgn": PGN_WIN, "rules": "chess", "time_class": "rapid", "end_time": 2},
                 {"pgn": PGN_WIN, "rules": "chess", "time_class": "bullet", "end_time": 3}]}}
    cc = ChessCom(replace(CFG.fetch, cache=str(tmp_path)), get=lambda u: json.dumps(pages[u]).encode(),
                  now=datetime(2026, 10, 15, tzinfo=timezone.utc))
    return Service(CFG, chesscom=cc, engine_factory=FakeEngine)


def call(server, name, **args):
    result = asyncio.run(server.call_tool(name, args))
    assert not result.is_error, result.content
    return json.loads(result.content[0].text)


def wait_done(server, name, **args):
    for _ in range(100):
        out = call(server, name, **args)
        if out["status"] == "done":
            return out
        assert out["status"] in ("queued", "running"), out
        time.sleep(0.05)
    raise AssertionError("job never finished")


def test_fetch_games_filters_time_class(service):
    out = call(create_server(service), "fetch_games", username="me")
    assert out["count"] == 2 and [g["color"] for g in out["games"]] == ["black", "white"]
    assert call(create_server(service), "fetch_games", username="me", time_classes=["all"])["count"] == 3


def test_drill_positions_job_runs_then_returns_items(service):
    server = create_server(service)
    first = call(server, "get_drill_positions", username="me")
    assert first["status"] in ("queued", "running", "done")
    out = wait_done(server, "get_drill_positions", username="me")
    [item] = out["items"]
    assert (item["san"], item["reply"], item["color"]) == ("Nf6", "Qxf7#", "b")


def test_summary_reuses_report_job(service):
    server = create_server(service)
    report = wait_done(server, "analyze_games", username="me")["games"]
    assert [g["result"] for g in report] == ["loss", "win"]
    s = call(server, "summary", username="me")
    assert s["status"] == "done"                     # same games, so the report job is reused
    s = s["summary"]
    assert s["record"] == {"win": 1, "draw": 0, "loss": 1}
    assert s["losses"]["allowed_mate"] == 1 and s["big_blunders_by_phase"]["opening"] == 1


def test_color_filter(service):
    out = wait_done(create_server(service), "analyze_games", username="me", color="white")
    assert [g["color"] for g in out["games"]] == ["white"]


def test_summarize_groups_openings_and_losses():
    g = lambda color, result, opening, errors=(), term="": dict(
        color=color, result=result, opening=opening, errors=list(errors), term=term, my_moves=10, cpl_sum=500)
    err = lambda move, loss, **kw: dict(dict(move=move, loss=loss, before=0, hung=False, allowed_mate=False), **kw)
    report = [g("black", "loss", "d4 Nf6 c4 e6", [err(20, 900, hung=True)]),
              g("black", "loss", "d4 Nf6 c4 g6", [err(40, 600, before=500)]),
              g("black", "loss", "e4 e5 Nf3 Nc6", term="them won on time"),
              g("white", "win", "e4 e5 Nf3 Nc6")]
    s = summarize(report, CFG)
    assert s["avg_centipawn_loss"] == 50
    assert s["losses"] == {"total": 3, "hung_piece": 1, "allowed_mate": 0, "thrown_from_winning": 1, "on_time": 1}
    assert s["big_blunders_by_phase"] == {"opening": 0, "middlegame": 1, "endgame": 1}
    assert s["results_by_opening"][0] == {"color": "black", "opening": "d4 Nf6", "win": 0, "draw": 0,
                                          "loss": 2, "games": 2}


def test_failed_job_is_retried():
    jobs, calls = Jobs(), []

    def work(job):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("engine crashed")
        return "ok"

    job = jobs.get_or_start("k", 1, work)
    for _ in range(100):
        if job.status == "error":
            break
        time.sleep(0.01)
    assert job.error == "RuntimeError: engine crashed"
    job = jobs.get_or_start("k", 1, work)
    for _ in range(100):
        if job.status == "done":
            break
        time.sleep(0.01)
    assert job.result == "ok"
