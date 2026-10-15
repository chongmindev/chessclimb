# Threat Scan — project handoff

Read this first. It explains what already exists, what we learned, and what to build next.

## The idea

A chess trainer that drills the *defensive* scan: "after my move, what can my opponent do to me?"
Existing tools (Chess.com Retry Mistakes, Lichess Learn from your mistakes, Aimchess) train finding
*your own* winning tactic. Almost nothing trains spotting the opponent's reply, which is the main
reason I lose.

The project has two parts:
1. **Backend (MCP server + engine pipeline):** pulls my finished Chess.com games, runs Stockfish,
   and extracts drill positions.
2. **Front end (trainer):** shows each position right after my move and asks me to find White's
   punishing reply, or confirm the move was safe. Uses spaced repetition.

## What exists already (prototype)

```
analysis/
  analyze_games.py          # PGN -> per-game error report (analysis.json)
  build_drill_positions.py  # PGN -> drill positions (items.json)
  build_page.py             # items.json + template -> standalone trainer HTML
trainer/
  trainer_template.html     # single-file trainer, __ITEMS__ placeholder
  threat-scan-drill.html    # built version with my 108 positions
data/
  chess_com_games_2026-10-14.pgn  # last 50 games as Black (username: Dudacio)
  analysis.json                   # engine report per game
  items.json                      # 108 drill positions (67 threat, 41 safe)
```

Rebuild from scratch:
```
pip install "chess==1.10.0"        # newer versions failed to build a wheel in my env
export STOCKFISH=/path/to/stockfish  # Stockfish 17 binary
python analysis/analyze_games.py data/chess_com_games_2026-10-14.pgn data/analysis.json
python analysis/build_drill_positions.py data/chess_com_games_2026-10-14.pgn data/items.json
python analysis/build_page.py data/items.json trainer/trainer_template.html trainer/threat-scan-drill.html
```

### How positions are chosen
- **Threat item:** my move (Black) lost >= 2.5 pawns at depth 13, the position wasn't already lost
  (eval before > -3), and White's best reply is a check or capture. Accepted answers = White moves
  from MultiPV 5 within 0.8 pawns of the best and still winning >= 2 pawns vs. before.
- **Safe item:** move 8+, my move lost <= 0.25 pawns, eval after between -1.5 and +4 for me, and
  White's best reply gains < 1.5. Sampled to about 60% of the threat count.
- Item fields: `fen` (White to move), `from`/`to` (my move), `san`, `move`, `opp`, `date`,
  `result`, `kind`, plus `accept`, `accept_san`, `reply`, `mate`, `better`, `swing`, `evb`, `eva`.

### Trainer behavior
- Board flipped (Black at bottom), Unicode pieces via Noto Sans Symbols 2, chess.js 0.10.3 for
  legal moves.
- "Show checks & captures" highlights every White check/capture.
- Leitner boxes 1–5, stored in localStorage (per browser only).

## What I learned from the 50 games (context for priorities)
- 20W / 3D / 27L, average ~73 centipawn loss per move, rating ~870–956.
- Losses: 15 had a hung piece, 12 walked into mate, 9 were thrown from +3 or better, 2 on time.
- Big blunders by phase: opening 20, middlegame (moves 13–30) 62, endgame 26.
- Openings: strong vs. the e4-e5 advance (7-0-1), weak vs. 1.d4 (3-0-8), 0-5 when I didn't open
  1...d5. Plan to switch to a QGD setup vs. 1.d4.
- One session on Oct 6 had 5 straight losses (tilt idea for later).

## What to build next (in order)

1. **Clean up the pipeline into a package** (`threatscan/`), with typed config (depth, thresholds),
   caching of engine evals by FEN, and tests for item selection on a few known positions.
2. **Chess.com fetch:** use the public Published Data API (no auth): monthly archives →
   PGNs for a username. Respect rate limits; set a User-Agent with contact info.
3. **MCP server** exposing:
   - `fetch_games(username, months)` — finished games only
   - `analyze_games(username, months, color)` — engine report (like analysis.json)
   - `get_drill_positions(username, ...)` — items.json shape
   - `summary(username)` — hung pieces, mates allowed, blunders by phase, results by opening
4. **Trainer reads from the backend** instead of a baked-in JSON, so new games refresh the deck.
5. Later: tilt detector (clock times are in the API PGNs as `[%clk]`), repertoire drift checker.

## Hard rules
- **Fair play:** only ever analyze *finished* games. Never expose the current/live games endpoint
  to the engine. Chess.com bans engine assistance during games.
- Engine work is slow (50 games ≈ a few minutes at depth 13–14). Only run MultiPV on candidate
  positions; cache by FEN.
- Guard game-over positions (no PV after mate).
