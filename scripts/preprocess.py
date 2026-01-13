# Minimal preprocessing: cluster by orthographic form and by IPA.
# Run: python3 scripts/preprocess.py
import json, unicodedata, os

IN = "data/sample.jsonl"
OUT = "data/clusters.json"

def norm(s):
    return unicodedata.normalize("NFC", (s or "").strip().lower())

entries = []
with open(IN, "r", encoding="utf8") as f:
    for line in f:
        if not line.strip(): continue
        entries.append(json.loads(line))

by_form = {}
by_ipa = {}

for e in entries:
    f = norm(e.get("form",""))
    if not f: continue
    by_form.setdefault(f, []).append(e)
    ipa = e.get("ipa")
    if ipa:
        by_ipa.setdefault(ipa.strip(), []).append(e)

clusters = []
cid = 1
def add_clusters(mapping, kind):
    global cid
    for key, items in mapping.items():
        langs = set(i.get("lang") for i in items)
        if len(langs) < 2: continue
        clusters.append({"id": cid, "key": key, "kind": kind, "entries": items})
        cid += 1

add_clusters(by_form, "orthographic")
add_clusters(by_ipa, "phonetic")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf8") as f:
    json.dump(clusters, f, ensure_ascii=False, indent=2)

print(f"Wrote {len(clusters)} clusters to {OUT}")