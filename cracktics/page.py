"""Bake drill items into the single-file trainer."""
from __future__ import annotations

import json
from pathlib import Path


def build_page(items: list[dict], template: str | Path, out: str | Path) -> int:
    html = Path(template).read_text().replace("__ITEMS__", json.dumps(items, separators=(",", ":")))
    Path(out).write_text(html)
    return len(items)
