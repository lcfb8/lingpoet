import json

path = "sample.jsonl"

with open(path, "r", encoding="utf-8") as f:
    for line in f:
        row = json.loads(line)
        print(row)
