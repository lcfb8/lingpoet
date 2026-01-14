import json
import os
import re
import sqlite3
from itertools import combinations

SOURCE_DB = "data/words.db"
TARGET_DB = "data/coincidences.db"
GLOSS_THRESHOLD = 0.35
MIN_LANGS = 2
BATCH_LIMIT = 10000

def tokenize_gloss(text):
    if not text:
        return set()
    tokens = re.findall(r"[a-zA-Z]+", text.lower())
    return {t for t in tokens if len(t) > 2}

def gloss_distance(entries):
    overlaps = []
    for left, right in combinations(entries, 2):
        if not left["tokens"] or not right["tokens"]:
            return 1.0
        inter = len(left["tokens"] & right["tokens"])
        union = len(left["tokens"] | right["tokens"])
        if union == 0:
            continue
        overlaps.append(inter / union)
    if not overlaps:
        return 1.0
    return max(overlaps)

IPA_STRIP = re.compile(r"[\[\]/ˈˌ\s]")
IPA_MAP = {
    "ɡ": "g",
    "θ": "th",
    "ð": "th",
    "ʃ": "sh",
    "ʒ": "zh",
    "ŋ": "ng",
    "ɲ": "ny",
    "ʧ": "ch",
    "ʤ": "j",
    "ɑ": "a",
    "ɒ": "a",
    "æ": "a",
    "ʌ": "a",
    "ɔ": "o",
    "ɜ": "e",
    "ə": "e",
    "ɪ": "i",
    "ʊ": "u",
}

def normalize_ipa(ipa):
    if not ipa:
        return ""
    ipa = ipa.lower()
    for src, dest in IPA_MAP.items():
        ipa = ipa.replace(src, dest)
    ipa = IPA_STRIP.sub("", ipa)
    ipa = ipa.replace("ː", "")
    return ipa

def init_target_db():
    os.makedirs("data", exist_ok=True)
    if os.path.exists(TARGET_DB):
        os.remove(TARGET_DB)
    conn = sqlite3.connect(TARGET_DB)
    conn.execute(
        """
        CREATE TABLE spelling_matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_key TEXT NOT NULL,
            languages INTEGER NOT NULL,
            gloss_overlap REAL NOT NULL,
            entries TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE pronunciation_matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_key TEXT NOT NULL,
            languages INTEGER NOT NULL,
            gloss_overlap REAL NOT NULL,
            entries TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX idx_spelling_key ON spelling_matches(match_key)")
    conn.execute("CREATE INDEX idx_pron_key ON pronunciation_matches(match_key)")
    conn.commit()
    return conn

def reduce_entries(entries):
    combined = {}
    for row in entries:
        lang = row["lang"]
        if lang not in combined:
            combined[lang] = {
                "word": row["word"],
                "lang": lang,
                "lang_code": row["lang_code"],
                "ipa": row["ipa"],
                "glosses": [],
                "tokens": set(),
            }
        if row["glosses"]:
            combined[lang]["glosses"].append(row["glosses"])
            combined[lang]["tokens"].update(tokenize_gloss(row["glosses"]))
    reduced = []
    for data in combined.values():
        gloss_text = " | ".join(g for g in data["glosses"] if g)
        if not gloss_text.strip():
            continue
        data["glosses"] = gloss_text
        reduced.append(data)
    return reduced

def save_match(cursor, table, key, entries, overlap):
    payload = [
        {k: entry[k] for k in ("word", "lang", "lang_code", "ipa", "glosses")}
        for entry in entries
    ]
    cursor.execute(
        f"INSERT INTO {table} (match_key, languages, gloss_overlap, entries) VALUES (?, ?, ?, ?)",
        (key, len(entries), overlap, json.dumps(payload, ensure_ascii=False))
    )

def process_spelling(source_conn, target_conn):
    cursor = source_conn.execute(
        "SELECT word, lang, lang_code, ipa, glosses FROM words WHERE word != '' ORDER BY word"
    )
    target_cursor = target_conn.cursor()
    current_word = None
    bucket = []
    saved = 0
    rows = 0
    for row in cursor:
        word = row[0]
        entry = {
            "word": word,
            "lang": row[1],
            "lang_code": row[2],
            "ipa": row[3],
            "glosses": row[4] or "",
        }
        if word != current_word and current_word is not None:
            saved += handle_spelling_group(current_word, bucket, target_cursor)
            bucket = []
        bucket.append(entry)
        current_word = word
        rows += 1
        if rows % 500000 == 0:
            print(f"[spelling] scanned {rows:,} rows, saved {saved:,} groups")
    if bucket:
        saved += handle_spelling_group(current_word, bucket, target_cursor)
    target_conn.commit()
    print(f"[spelling] complete: {saved:,} coincidence sets")


def handle_spelling_group(word, entries, cursor):
    reduced = reduce_entries(entries)
    if len(reduced) < MIN_LANGS:
        return 0
    overlap = gloss_distance(reduced)
    if overlap >= GLOSS_THRESHOLD:
        return 0
    save_match(cursor, "spelling_matches", word, reduced, overlap)
    return 1

def process_pronunciation(source_conn, target_conn):
    cursor = source_conn.execute(
        "SELECT ipa, word, lang, lang_code, glosses FROM words WHERE ipa IS NOT NULL AND ipa != '' ORDER BY ipa"
    )
    target_cursor = target_conn.cursor()
    current_key = None
    bucket = []
    saved = 0
    rows = 0
    for row in cursor:
        ipa = row[0]
        norm = normalize_ipa(ipa)
        if len(norm) < 2:
            continue
        entry = {
            "norm": norm,
            "word": row[1],
            "lang": row[2],
            "lang_code": row[3],
            "ipa": ipa,
            "glosses": row[4] or "",
        }
        if norm != current_key and current_key is not None:
            saved += handle_pronunciation_group(current_key, bucket, target_cursor)
            bucket = []
        bucket.append(entry)
        current_key = norm
        rows += 1
        if rows % 500000 == 0:
            print(f"[ipa] scanned {rows:,} rows, saved {saved:,} groups")
    if bucket:
        saved += handle_pronunciation_group(current_key, bucket, target_cursor)
    target_conn.commit()
    print(f"[ipa] complete: {saved:,} coincidence sets")


def handle_pronunciation_group(norm_key, entries, cursor):
    reduced = reduce_entries(entries)
    if len(reduced) < MIN_LANGS:
        return 0
    overlap = gloss_distance(reduced)
    if overlap >= GLOSS_THRESHOLD:
        return 0
    save_match(cursor, "pronunciation_matches", norm_key, reduced, overlap)
    return 1

def main():
    if not os.path.exists(SOURCE_DB):
        raise SystemExit(f"Missing source database at {SOURCE_DB}")
    source_conn = sqlite3.connect(SOURCE_DB)
    target_conn = init_target_db()
    try:
        process_spelling(source_conn, target_conn)
        process_pronunciation(source_conn, target_conn)
    finally:
        source_conn.close()
        target_conn.close()

if __name__ == "__main__":
    main()
