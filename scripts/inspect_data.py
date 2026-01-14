import json

RAW_DATA = "/Users/lydiaold/Development/raw-wiktextract-data.jsonl"

with open(RAW_DATA, "r", encoding="utf8") as f:
    for i in range(10):
        line = f.readline()
        if line.strip():
            entry = json.loads(line)
            print(f"\n--- Entry {i+1} ---")
            print(f"Word: {entry.get('word')}")
            print(f"Lang: {entry.get('lang')}")
            print(f"Keys: {entry.keys()}")
            if "etymology" in entry:
                print(f"Etymology: {entry['etymology']}")
