import csv
import json
import sqlite3
from pathlib import Path

DB_PATH = Path("/Users/lydiaold/Development/lingpoet/data/coincidences.db")
OUTPUT_PATH = Path("/Users/lydiaold/Development/lingpoet/data/long_words_entries.csv")


def main():
    conn = sqlite3.connect(DB_PATH)
    rows = []
    seen = set()

    for table in ("spelling_matches", "pronunciation_matches"):
        for (entries_json,) in conn.execute(f"SELECT entries FROM {table}"):
            entries = json.loads(entries_json)
            for entry in entries:
                word = entry.get("word", "")
                if not word:
                    continue
                if len(word) <= 8:
                    continue
                key = (word, entry.get("lang"), entry.get("glosses"))
                if key in seen:
                    continue
                seen.add(key)
                rows.append(
                    {
                        "word": word,
                        "language": entry.get("lang"),
                        "glosses": entry.get("glosses"),
                    }
                )

    conn.close()

    rows.sort(key=lambda r: (r["word"].lower(), (r["language"] or "").lower()))

    with OUTPUT_PATH.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["word", "language", "glosses"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} rows to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
