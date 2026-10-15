"""Inject drill positions into the trainer template.
Usage: python build_page.py data/items.json trainer/trainer_template.html trainer/threat-scan-drill.html"""
import json, sys
items = json.load(open(sys.argv[1]))
items = [i for i in items if not (i["kind"] == "threat" and (not i["accept"] or not i["better"]))]
for n, i in enumerate(items): i["id"] = n
html = open(sys.argv[2]).read().replace("__ITEMS__", json.dumps(items, separators=(",", ":")))
open(sys.argv[3], "w").write(html)
print(f"{len(items)} positions -> {sys.argv[3]}")
