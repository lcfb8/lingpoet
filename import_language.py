import gzip
import json
import os
import sqlite3
import sys
import unicodedata
import urllib.request
from typing import Any, Dict, List

DB_PATH = "worddb.sqlite"

def word_norm(s: str) -> str:
    return unicodedata.normalize("NFC", s).lower()

def ipa_norm_strict(ipa: str) -> str:
    ipa = unicodedata.normalize("NFC", ipa)
    return "".join(ipa.split())

def ipa_norm_loose(ipa: str) -> str:
    ipa = unicodedata.normalize("NFC", ipa)
    ipa = "".join(ipa.split())

    remove_chars = "/[]()ˈˌ.ːˑ"
    ipa = ipa.translate({ord(c): None for c in remove_chars})

    # Drop combining diacritics (nasalization, tone, etc.)
    decomposed = unicodedata.normalize("NFD", ipa)
    decomposed = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    ipa = unicodedata.normalize("NFC", decomposed)

    mappings = {
        "ɐ":"a","ɑ":"a",
        "ɔ":"o","ɛ":"e",
        "ɪ":"i",
        "ʊ":"u",
        "w":"u",
        "ɡ":"g",
        "ʁ":"r",
    }
    return "".join(mappings.get(ch, ch) for ch in ipa)

def detect_script(word: str) -> str:
    for ch in word:
        if ch.isspace():
            continue
        name = unicodedata.name(ch, "")
        if "LATIN" in name:
            return "Latin"
        if "CYRILLIC" in name:
            return "Cyrillic"
        if "GREEK" in name:
            return "Greek"
        if "ARABIC" in name:
            return "Arabic"
        if "HEBREW" in name:
            return "Hebrew"
        if "HIRAGANA" in name or "KATAKANA" in name:
            return "Kana"
        if "CJK UNIFIED" in name or "IDEOGRAPH" in name:
            return "Han"
        return "Other"
    return "Other"

def extract_ipas(item: Dict[str, Any]) -> List[str]:
    ipas: List[str] = []

    v = item.get("ipa")
    if isinstance(v, str):
        ipas.append(v)
    elif isinstance(v, list):
        ipas.extend([x for x in v if isinstance(x, str)])

    sounds = item.get("sounds")
    if isinstance(sounds, list):
        for s in sounds:
            if isinstance(s, dict):
                si = s.get("ipa")
                if isinstance(si, str):
                    ipas.append(si)
                elif isinstance(si, list):
                    ipas.extend([x for x in si if isinstance(x, str)])

    pronunciations = item.get("pronunciations")
    if isinstance(pronunciations, list):
        for p in pronunciations:
            if isinstance(p, dict):
                pi = p.get("ipa")
                if isinstance(pi, str):
                    ipas.append(pi)

    seen = set()
    out = []
    for x in ipas:
        x = x.strip()
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return out

def download_language(code: str) -> str:
    os.makedirs("data", exist_ok=True)
    url = f"https://kaikki.org/dictionary/downloads/{code}/{code}-extract.jsonl.gz"
    out_path = f"data/{code}-extract.jsonl.gz"

    if os.path.exists(out_path):
        print("Already downloaded:", out_path)
        return out_path

    print("Downloading:", url)
    print("To:", out_path)
    urllib.request.urlretrieve(url, out_path)
    return out_path

def ensure_db():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    cur.execute("""
    CREATE TABLE IF NOT EXISTS entry (
      entry_id   INTEGER PRIMARY KEY,
      lang       TEXT NOT NULL,
      word       TEXT NOT NULL,
      word_norm  TEXT NOT NULL,
      script     TEXT NOT NULL
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS pron (
      pron_id          INTEGER PRIMARY KEY,
      entry_id         INTEGER NOT NULL,
      ipa              TEXT NOT NULL,
      ipa_norm_strict  TEXT NOT NULL,
      ipa_norm_loose   TEXT NOT NULL,
      FOREIGN KEY(entry_id) REFERENCES entry(entry_id)
    );
    """)

    cur.execute("CREATE INDEX IF NOT EXISTS entry_word_norm_idx ON entry(word_norm);")
    cur.execute("CREATE INDEX IF NOT EXISTS entry_script_idx ON entry(script);")
    cur.execute("CREATE INDEX IF NOT EXISTS pron_ipa_loose_idx ON pron(ipa_norm_loose);")

    con.commit()
    con.close()

def import_gz(code: str, gz_path: str, commit_every: int = 5000):
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute("PRAGMA journal_mode=WAL;")
    cur.execute("PRAGMA synchronous=NORMAL;")

    n_entries = 0
    n_prons = 0

    with gzip.open(gz_path, "rt", encoding="utf-8") as f:
        for line in f:
            item = json.loads(line)

            word = item.get("word")
            if not isinstance(word, str) or not word:
                continue

            # Kaikki often has lang as a name (e.g. "Español") and lang_code (e.g. "es")
            lang_code = item.get("lang_code")
            if isinstance(lang_code, str) and lang_code:
                lang = lang_code
            else:
                # fallback to language name or the download code
                lang = item.get("lang") if isinstance(item.get("lang"), str) else code

            ipas = extract_ipas(item)
            if not ipas:
                continue  # keep DB smaller: only store entries with IPA

            script = detect_script(word)

            cur.execute(
                "INSERT INTO entry(lang, word, word_norm, script) VALUES (?, ?, ?, ?)",
                (lang, word, word_norm(word), script),
            )
            entry_id = cur.lastrowid
            n_entries += 1

            for ipa in ipas:
                cur.execute(
                    "INSERT INTO pron(entry_id, ipa, ipa_norm_strict, ipa_norm_loose) VALUES (?, ?, ?, ?)",
                    (entry_id, ipa, ipa_norm_strict(ipa), ipa_norm_loose(ipa)),
                )
                n_prons += 1

            if n_entries % commit_every == 0:
                con.commit()
                print(f"{code}: {n_entries} entries, {n_prons} prons...")

    con.commit()
    con.close()
    print(f"DONE {code}: Imported {n_entries} entries with IPA ({n_prons} prons).")

def main():
    if len(sys.argv) != 2:
        print("Usage: python import_language.py <lang_code>")
        print("Example: python import_language.py pt")
        sys.exit(1)

    code = sys.argv[1].strip().lower()
    ensure_db()
    gz_path = download_language(code)
    import_gz(code, gz_path)

if __name__ == "__main__":
    main()
