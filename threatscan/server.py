"""MCP server: Chess.com games -> engine report, drill positions and a summary.

Fair play: only finished games from the monthly archives are ever analysed.
"""
from __future__ import annotations

from typing import Literal

from mcp.server.mcpserver import MCPServer

from . import config
from .service import Service

Color = Literal["white", "black", "both"]
TimeClass = Literal["bullet", "blitz", "rapid", "daily", "all"]


def create_server(service: Service | None = None) -> MCPServer:
    svc = service or Service(config.load())
    mcp = MCPServer("threatscan", instructions=(
        "Analyses a player's FINISHED Chess.com games with Stockfish. Engine tools (analyze_games, "
        "get_drill_positions, summary) start a background job and return progress; call them again "
        "with the same arguments until status is 'done'. months = most recent monthly archives; "
        "time_classes defaults to the server config (rapid)."))

    @mcp.tool()
    def fetch_games(username: str, months: int | None = None,
                    time_classes: list[TimeClass] | None = None) -> dict:
        """List the player's finished games (date, color, opponent, result, link). No engine work."""
        return svc.fetch_games(username, months, time_classes)

    @mcp.tool()
    def analyze_games(username: str, months: int | None = None, color: Color = "both",
                      time_classes: list[TimeClass] | None = None) -> dict:
        """Per-game engine report: centipawn loss and each error (hung piece, missed or allowed mate)."""
        return svc.analyze_games(username, months, color, time_classes)

    @mcp.tool()
    def get_drill_positions(username: str, months: int | None = None, color: Color = "both",
                            time_classes: list[TimeClass] | None = None) -> dict:
        """Threat-scan drill items: positions right after the player's move, opponent to move."""
        return svc.get_drill_positions(username, months, color, time_classes)

    @mcp.tool()
    def summary(username: str, months: int | None = None, color: Color = "both",
                time_classes: list[TimeClass] | None = None) -> dict:
        """Record, why games were lost, big blunders by phase, and results by opening."""
        return svc.summary(username, months, color, time_classes)

    return mcp


def main():
    create_server().run()


if __name__ == "__main__":
    main()
