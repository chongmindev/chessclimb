import io
from dataclasses import replace
import shutil

import chess
import pytest

from threatscan import config
from threatscan.drills import Ply, build_items, item_id, safe_item, threat_item, walk
from threatscan.engine import Engine, Line
from threatscan.games import Game, read_games

CFG = config.load()
D, CAP = CFG.drills, CFG.engine.eval_cap


def game_from(sans: str, color=chess.BLACK, result="0-1") -> Game:
    board, moves = chess.Board(), []
    for san in sans.split():
        moves.append(board.push_san(san))
    me, them = ("me", "them") if color == chess.WHITE else ("them", "me")
    return Game({"White": me, "Black": them, "Date": "2026.10.01", "Result": result}, moves, color)


def ply_after(sans: str, color=chess.BLACK, before=0, after=-500, best="Nf6") -> Ply:
    """The position after the last move in `sans`, which is mine."""
    g = game_from(sans, color)
    board = chess.Board()
    for mv in g.moves[:-1]:
        board.push(mv)
    san = board.san(g.moves[-1])
    board.push(g.moves[-1])
    return Ply(g, (len(g.moves) + 1) // 2, board, g.moves[-1], san, best, before, after)


# --- pure selection rules, fake engine lines -----------------------------------------

def test_threat_item_accepts_forcing_reply_and_close_alternatives():
    # 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? 4.Qxf7#
    p = ply_after("e4 e5 Qh5 Nc6 Bc4 Nf6", before=-20, after=-2000, best="g6")
    lines = [Line("h5f7", 10000, 1), Line("c4f7", 400, None), Line("h5e5", 150, None)]
    item = threat_item(D, p, lines, CAP)
    assert item["kind"] == "threat" and item["color"] == "b"
    assert item["reply"] == "Qxf7#" and item["mate"] == 1
    assert item["accept"] == ["h5f7"]          # Bxf7+ is far worse than mate
    assert item["better"] == "g6" and item["swing"] == 19.8


def test_threat_item_rejects_quiet_best_reply():
    p = ply_after("e4 e5 Qh5 Nc6 Bc4 Nf6", before=-20, after=-500)
    assert threat_item(D, p, [Line("g1f3", 500, None)], CAP) is None


def test_threat_item_needs_a_better_move_and_a_pv():
    p = ply_after("e4 e5 Qh5 Nc6 Bc4 Nf6", before=-20, after=-2000, best=None)
    assert threat_item(D, p, [Line("h5f7", 10000, 1)], CAP) is None
    p.best_san = "g6"
    assert threat_item(D, p, [Line(None, 10000, 0)], CAP) is None


def test_threat_item_for_white_player_uses_opponent_point_of_view():
    # 1.e4 e5 2.Qh5 Nc6 3.Qxe5+?? Nxe5
    p = ply_after("e4 e5 Qh5 Nc6 Qxe5+", color=chess.WHITE, before=-30, after=-900, best="Bc4")
    item = threat_item(D, p, [Line("c6e5", -900, None), Line("f8e7", -150, None)], CAP)
    assert item["color"] == "w" and item["reply"] == "Nxe5" and item["accept"] == ["c6e5"]
    assert item["mate"] is None


def test_mate_is_reported_from_opponent_side_when_opponent_is_black():
    p = ply_after("e4 e5 Qh5 Nc6 Qxe5+", color=chess.WHITE, before=-30, after=-2000, best="Bc4")
    item = threat_item(D, p, [Line("c6e5", -10000, -3)], CAP)
    assert item["mate"] == 3


def test_safe_item_bounds():
    p = ply_after("e4 e5 Nf3 Nc6", before=-30, after=-40)
    assert safe_item(D, p, [Line("f1b5", 40, None)], CAP)["reply"] == "Bb5"
    assert safe_item(D, p, [Line("f1b5", D.safe_max_opp_eval, None)], CAP) is None
    p.after = D.safe_after_min - 1
    assert safe_item(D, p, [Line("f1b5", 40, None)], CAP) is None


def test_item_id_is_stable_and_position_specific():
    a = item_id(chess.STARTING_FEN, chess.Move.from_uci("e2e4"))
    assert a == item_id(chess.STARTING_FEN, chess.Move.from_uci("e2e4"))
    assert a != item_id(chess.STARTING_FEN, chess.Move.from_uci("d2d4"))


class FakeEngine:
    """Every position evaluates to `cp` for White unless listed in `evals` by FEN."""
    def __init__(self, cp=0, evals=None):
        self.cp, self.evals, self.calls = cp, evals or {}, []

    def analyse(self, board, depth, multipv=1):
        self.calls.append((board.fen(), multipv))
        lines = self.evals.get(board.fen())
        if lines:
            return lines[:multipv]
        mv = next(iter(board.legal_moves), None)
        return [Line(mv.uci() if mv else None, self.cp, None)]


def test_walk_stops_when_my_move_ends_the_game():
    g = game_from("f3 e5 g4 Qh4#")            # fool's mate, I am Black and deliver it
    plies = list(walk(g, FakeEngine(), D.depth, CAP))
    assert [p.san for p in plies] == ["e5"]


def test_build_items_only_runs_multipv_on_candidates():
    g = game_from("e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#", result="1-0")
    after_nf6 = chess.Board()
    for san in "e4 e5 Qh5 Nc6 Bc4 Nf6".split():
        after_nf6.push_san(san)
    eng = FakeEngine(evals={after_nf6.fen(): [Line("h5f7", 10000, 1)]})
    items = build_items([g], eng, CFG)
    assert [i["san"] for i in items] == ["Nf6"] and items[0]["result"] == "loss"
    assert [fen for fen, mpv in eng.calls if mpv > 1] == [after_nf6.fen()]


def test_read_games_detects_color_case_insensitively_and_skips_variants():
    pgn = ('[White "Dudacio"]\n[Black "x"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n\n'
           '[White "x"]\n[Black "dudacio"]\n[Result "1-0"]\n\n1. d4 d5 1-0\n\n'
           '[White "x"]\n[Black "Dudacio"]\n[Variant "Chess960"]\n[Result "*"]\n\n1. e4 *\n\n')
    games = list(read_games(io.StringIO(pgn), "DUDACIO"))
    assert [(g.color, g.result) for g in games] == [(chess.WHITE, "win"), (chess.BLACK, "loss")]
    assert len(list(read_games(io.StringIO(pgn), "dudacio", chess.BLACK))) == 1


# --- real engine on known positions -----------------------------------------------------

needs_engine = pytest.mark.skipif(shutil.which(CFG.engine.path) is None and not shutil.which("stockfish", path="/opt/homebrew/bin:/usr/local/bin"), reason="Stockfish not found")


@pytest.fixture
def engine(tmp_path):
    with Engine(CFG.engine, tmp_path / "cache.sqlite") as e:
        yield e


@needs_engine
def test_engine_finds_scholars_mate_threat(engine):
    g = game_from("e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#", result="1-0")
    items = build_items([g], engine, CFG)
    threat = [i for i in items if i["kind"] == "threat"]
    assert len(threat) == 1 and threat[0]["san"] == "Nf6"
    assert threat[0]["reply"] == "Qxf7#" and threat[0]["mate"] == 1


@needs_engine
def test_engine_finds_hung_queen_as_white(engine):
    g = game_from("e4 e5 Qh5 Nc6 Qxe5+ Nxe5", color=chess.WHITE, result="0-1")
    items = build_items([g], engine, CFG)
    assert [(i["san"], i["reply"], i["color"]) for i in items] == [("Qxe5+", "Nxe5", "w")]


@needs_engine
def test_engine_cache_reuses_evaluations(engine):
    board = chess.Board()
    first = engine.analyse(board, 8, 3)
    assert engine.analyse(board, 8, 3) == first
    assert (engine.hits, engine.misses) == (1, 1)


@needs_engine
def test_engine_handles_game_over(engine):
    board = chess.Board()
    for san in "f3 e5 g4 Qh4#".split():
        board.push_san(san)
    [line] = engine.analyse(board, 8)
    assert line.move is None and line.pov(chess.BLACK) == CFG.engine.mate_score


def test_safe_sampling_does_not_depend_on_game_order():
    c = replace(CFG, drills=replace(D, safe_sample_rate=0.5, safe_ratio=100))
    a = game_from("e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O Re1 a6 Bb3 Ba7 h3 h6 Nbd2 Re8 Nf1 Be6")
    b = game_from("d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6 cxd5 exd5 Bd3 Bb7 O-O c5 Rc1 Nbd7")
    threat = game_from("e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#", result="1-0")    # the cap needs a threat item
    after_nf6 = chess.Board()
    for san in "e4 e5 Qh5 Nc6 Bc4 Nf6".split():
        after_nf6.push_san(san)
    eng = lambda: FakeEngine(evals={after_nf6.fen(): [Line("h5f7", 10000, 1)]})
    one = build_items([threat, a, b], eng(), c)
    two = build_items([b, threat, a], eng(), c)
    assert sorted(i["id"] for i in one) == sorted(i["id"] for i in two)
    assert any(i["kind"] == "safe" for i in one)
    # adding a game never removes a safe item that was already chosen (cap not binding here)
    assert {i["id"] for i in build_items([threat, a], eng(), c)} <= {i["id"] for i in one}


def test_pawns_rounds_halves_away_from_zero():
    from threatscan.drills import pawns
    assert [pawns(v) for v in (25, 15, 45, -25, -24, 0, 1980, -2000)] == [0.3, 0.2, 0.5, -0.3, -0.2, 0.0, 19.8, -20.0]
