# Decisions

Each entry: what was chosen, what was rejected, and the evidence. Newest first.

## 2026-10-15 · Chess.com games are parsed from TCN, not PGN

Chess.com archive entries carry `tcn`, two characters per move. Decoding it is arithmetic only.
- Measured: chess.js `loadPgn` + `history()` costs 112 ms per game (12 s for 107 games, blocking the
  page); replaying SAN with `move()` is worse (2 ms per move). TCN decoding: 0.12 ms per game.
- Checked: TCN moves equal chess.js PGN moves on every standard game of a real 98-game archive,
  including promotions and castling (`web/test/games.test.js`). PGN stays as the fallback when `tcn` is
  missing or malformed.

## 2026-10-15 · Lichess cloud castling is converted to standard UCI

Lichess cloud evals write castling as king-takes-rook (`e1h1`); chess.js and Stockfish use `e1g1`.
Found in the first browser run (it crashed the scan). `standardCastling()` converts only when the moving
piece is a king. A failing game is now skipped and retried next visit instead of stopping the scan.

## 2026-10-15 · Lichess cloud: early positions only, stop at a game's first miss

- Measured on 10 recent games: cloud evals cover the first 12–17 plies, then stop (one short game was
  covered to the end). Its depth is ~50, far above our 13.
- So each game asks the cloud until its first miss, then never again (one wasted request per game).
  A cached cloud eval answers any request at the same or lower depth.
- Requests are serial (Lichess API rule) and back off for 60 s after HTTP 429.
- Consequence: early-game evals are deeper than the rest, so the browser's deck can differ slightly from
  the Python deck on opening blunders. Parity tests run without the cloud.

## 2026-10-15 · Browser engine: one single-threaded lite Stockfish per core

Benchmarked depth 13 on 24 middlegame positions and 12 blunder positions (MultiPV 1 and 5):

| Build | s/position (MultiPV 1) | MultiPV 5 on blunders |
|---|---|---|
| native full, 4 threads | 0.138 | – |
| native full, 1 thread | 0.085 | 0.31 |
| wasm lite, 1 thread | 0.062 | 0.29 |
| wasm lite, 4 threads | 0.070 | – |

- At a fixed depth, threads search more nodes (118k vs. 31k per position), not finish sooner. The
  multi-threaded wasm build also had pathological slowdowns in sharp positions (5.6 s on one position).
- Chosen: a pool of single-threaded lite engines, `hardwareConcurrency - 1` (max 8), one game each.
  No cross-origin isolation headers needed, so any static host and any browser works.
- Rejected: full-strength wasm (99 MB download, over the per-file limit of free static hosts);
  multi-threaded lite (slower here, needs COOP/COEP).
- Pending: whether lite picks the same drills as the native full engine (`tools/measure_lite.py`).

## 2026-10-15 · Safe items are sampled by a per-position hash, not a random stream

The prototype sampled safe moves with `random.Random(3)`, so the choice depended on game order. The
browser scans newest first and adds games over time, which would reshuffle the safe items and orphan
progress. Now `sample_key(seed, fen, move)` (SHA-1) decides both the sample and the cap order, in Python
and JS alike. Adding a game never changes which earlier safe items were chosen unless the cap binds.

## 2026-10-15 · Pawn values and the safe cap are rounded with integer arithmetic

Python's `round()` is half-to-even on inexact floats, which JS can't reproduce simply. `pawns(cp)` rounds
centipawns to tenths, halves away from zero, using integers; the safe cap is `floor(n * ratio + 0.5)`.
Identical in both languages.
