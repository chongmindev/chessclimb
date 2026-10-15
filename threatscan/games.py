"""Reading PGNs and working out which side the player had."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, TextIO

import chess
import chess.pgn


@dataclass
class Game:
    headers: dict[str, str]
    moves: list[chess.Move]
    color: chess.Color          # the player's side

    @property
    def opponent(self) -> str:
        return self.headers["Black" if self.color == chess.WHITE else "White"]

    @property
    def date(self) -> str:
        return self.headers.get("Date", "????.??.??").replace(".", "-")

    @property
    def result(self) -> str:
        """'win', 'loss' or 'draw' for the player, '?' if unfinished."""
        r = self.headers.get("Result", "*")
        if r == "1/2-1/2":
            return "draw"
        if r not in ("1-0", "0-1"):
            return "?"
        return "win" if (r == "1-0") == (self.color == chess.WHITE) else "loss"


def player_color(headers: dict[str, str], username: str) -> chess.Color | None:
    u = username.lower()
    if headers.get("White", "").lower() == u:
        return chess.WHITE
    if headers.get("Black", "").lower() == u:
        return chess.BLACK
    return None


def read_games(source: str | Path | TextIO, username: str,
               color: chess.Color | None = None) -> Iterator[Game]:
    """Games the player took part in, optionally only those with `color`. Variants are skipped."""
    f = open(source) if isinstance(source, (str, Path)) else source
    try:
        while (g := chess.pgn.read_game(f)) is not None:
            h = dict(g.headers)
            side = player_color(h, username)
            if side is None or (color is not None and side != color):
                continue
            if h.get("Variant", "Standard") != "Standard" or "SetUp" in h:
                continue
            yield Game(h, list(g.mainline_moves()), side)
    finally:
        if f is not source:
            f.close()


def move_label(move_number: int, color: chess.Color, san: str) -> str:
    return f"{move_number}{'.' if color == chess.WHITE else '…'}{san}"
