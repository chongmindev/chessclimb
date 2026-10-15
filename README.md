# Cracktics

*(The Python package and command are still called `threatscan`.)*

Most chess trainers drill finding *your own* winning tactic. This one drills the other half of a blunder
check: **after my move, what can my opponent do to me?**

It reads your finished Chess.com games, runs Stockfish over them, and builds a deck of positions taken
right after one of your moves:

- **Threat positions:** your move lost 2.5+ pawns to a check or capture. Find the punishing reply.
- **Safe positions:** your move was fine. Recognise that nothing works, without over-worrying.

The trainer shows each position from your side of the board, takes your answer as a move on the board,
and schedules positions with spaced repetition (Leitner boxes).

> Status: working pipeline, MCP server and single-file trainer. A version that runs entirely in the
> browser, so anyone can use it with just a username, is being designed.

## Requirements

- [uv](https://docs.astral.sh/uv/) (Python 3.12+)
- [Stockfish](https://stockfishchess.org/) on your `PATH` (`brew install stockfish`), or set `STOCKFISH=/path/to/stockfish`

```
uv sync
```

## Usage

```
# 1. Finished games from the Chess.com archives (rapid, last two monthly archives by default)
uv run threatscan fetch <username> data/games.pgn [--months 2] [--time-class rapid|blitz|bullet|daily|all]

# 2. Drill positions (both colors by default)
uv run threatscan drills data/games.pgn data/items.json --user <username> [--color white|black|both]

# 3. Bake them into the trainer, then open it in a browser
uv run threatscan page data/items.json trainer/trainer_template.html trainer/threat-scan-drill.html
open trainer/threat-scan-drill.html

# Optional: per-game engine report (centipawn loss, hung pieces, missed and allowed mates)
uv run threatscan report data/games.pgn data/analysis.json --user <username>
```

The first run is slow: Stockfish evaluates every position in every game (about 30 minutes for 100 rapid
games on a laptop). Every evaluation is cached in `data/engine_cache.sqlite`, so reruns and new games are
fast.

## MCP server

The same pipeline is exposed as an MCP server, so you can ask Claude about your games
("why do I lose as Black?", "give me my drill positions from September").

| Tool | Returns |
|---|---|
| `fetch_games` | your finished games: date, color, opponent, result, link |
| `analyze_games` | per-game engine report |
| `get_drill_positions` | the trainer's deck |
| `summary` | record by color, why games were lost, big blunders by phase, results by opening |

Engine tools run as background jobs: the first call starts the work and returns progress, and calling
again with the same arguments returns the result once it is done.

- **Claude Code:** `.mcp.json` in this folder registers the server automatically.
- **Other clients:** run `uv run --directory /path/to/this/repo threatscan-mcp` over stdio.

## Configuration

Every depth and threshold lives in [`config.toml`](config.toml): engine settings, what counts as a threat
or a safe move, which replies are accepted, phase boundaries for the summary, and the Chess.com fetch
settings (request pacing, time classes).

## Fair play

Only **finished** games are ever analysed. The fetcher reads Chess.com's monthly archives, which contain
finished games only, and never calls the current-games endpoints. Chess.com bans engine assistance during
games; this tool is for reviewing them afterwards.

## Privacy

Your games, engine cache, reports and built trainer stay in `data/` and `trainer/threat-scan-drill.html`,
which are gitignored.

## Development

```
uv run pytest
```

Tests cover the selection rules on fake engine output, known blunders on the real engine (skipped if
Stockfish is missing), the Chess.com fetcher with a fake HTTP layer, and the MCP tools end to end.

Project notes and the roadmap are in [`HANDOFF.md`](HANDOFF.md).
