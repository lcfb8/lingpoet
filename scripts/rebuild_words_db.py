"""
Rebuild words.db from raw Wiktionary data with proper gloss aggregation.

This script:
1. Reads the raw wiktextract JSONL file
2. Aggregates ALL glosses for each (word, lang) pair
3. Handles IPA by keeping the first non-empty value
4. Writes to a new SQLite database

Usage:
    python scripts/rebuild_words_db.py

Requires:
    - Raw data file at ~/Development/raw-wiktextract-data.jsonl
    - Or set RAW_DATA environment variable to the path
"""

import json
import os
import re
import sqlite3
import unicodedata
from collections import defaultdict

# Configuration
RAW_DATA = os.environ.get(
    "RAW_DATA", 
    os.path.expanduser("~/Development/raw-wiktextract-data.jsonl")
)
DB_FILE = "data/words.db"
DB_FILE_NEW = "data/words_new.db"

def norm(s):
    """Normalize unicode and lowercase"""
    return unicodedata.normalize("NFC", (s or "").strip().lower())


def extract_glosses(entry):
    """Extract all glosses from a wiktionary entry"""
    glosses = []
    for sense in entry.get("senses", []):
        if "glosses" in sense:
            glosses.extend(sense["glosses"])
    return glosses


def extract_ipa(entry):
    """Extract IPA pronunciation from entry.
    
    For English: returns both General American (cot-caught merger) and 
    Received Pronunciation if available, formatted as "GA, RP".
    For other languages: returns the first IPA found.
    """
    sounds = entry.get("sounds", [])
    lang = entry.get("lang", "")
    
    if lang == "English":
        ga_ipa = None  # General American
        rp_ipa = None  # Received Pronunciation
        
        for sound in sounds:
            if "ipa" not in sound or not sound["ipa"]:
                continue
            
            ipa = sound["ipa"]
            tags = sound.get("tags", [])
            
            # Skip phonetic transcriptions (in brackets), only use phonemic (in slashes)
            if ipa.startswith("["):
                continue
            
            # Look for General American (either tag or cot-caught-merger)
            if not ga_ipa and ("General-American" in tags or "cot-caught-merger" in tags):
                ga_ipa = ipa
            
            # Look for Received Pronunciation
            if not rp_ipa and "Received-Pronunciation" in tags:
                rp_ipa = ipa
            
            # Stop if we have both
            if ga_ipa and rp_ipa:
                break
        
        # Format the result
        if ga_ipa and rp_ipa:
            return f"{ga_ipa}, {rp_ipa}"
        elif ga_ipa:
            return ga_ipa
        elif rp_ipa:
            return rp_ipa
        else:
            # Fall back to first IPA if no tagged ones found
            for sound in sounds:
                if "ipa" in sound and sound["ipa"]:
                    return sound["ipa"]
            return None
    else:
        # For other languages, just return the first IPA
        for sound in sounds:
            if "ipa" in sound and sound["ipa"]:
                return sound["ipa"]
        return None


def is_affix(word):
    """Check if word is a prefix or suffix (starts or ends with hyphen)"""
    return word.startswith("-") or word.endswith("-")


def has_digits(word):
    """Check if word contains any digits (e.g., '4x4', '311')"""
    return any(c.isdigit() for c in word)


def is_loanword(entry):
    """Check if entry is a loanword based on etymology.
    
    Detects phrases like "borrowed from" and "unadapted borrowing from"
    which indicate the word was taken from another language.
    """
    etymology = entry.get("etymology_text", "") or entry.get("etymology", "")
    if not etymology:
        return False
    etymology_lower = etymology.lower()
    return "borrowed from" in etymology_lower or "unadapted borrowing from" in etymology_lower


def process_data():
    """
    Process raw data with proper aggregation.
    
    Uses a two-pass approach:
    1. First pass: collect all glosses for each (word, lang) pair in memory
    2. Second pass: write aggregated data to database
    
    For very large datasets, we store intermediate results in a temp SQLite DB.
    """
    if not os.path.exists(RAW_DATA):
        print(f"Error: Raw data file not found at {RAW_DATA}")
        print("Set RAW_DATA environment variable to the correct path")
        return
    
    os.makedirs("data", exist_ok=True)
    
    # Remove old new db if exists
    if os.path.exists(DB_FILE_NEW):
        os.remove(DB_FILE_NEW)
    
    # Use a file-based temp database to avoid memory issues on older machines
    temp_db_path = "data/words_temp.db"
    if os.path.exists(temp_db_path):
        os.remove(temp_db_path)
    
    temp_db = sqlite3.connect(temp_db_path)
    temp_db.execute("PRAGMA journal_mode=WAL")  # Better write performance
    temp_db.execute("PRAGMA synchronous=NORMAL")  # Faster, still safe
    temp_db.execute("""
        CREATE TABLE entries (
            word TEXT NOT NULL,
            lang TEXT NOT NULL,
            lang_code TEXT,
            ipa TEXT,
            gloss TEXT NOT NULL,
            PRIMARY KEY (word, lang, gloss)
        )
    """)
    temp_db.execute("CREATE INDEX idx_word_lang ON entries(word, lang)")
    
    print(f"Reading from {RAW_DATA}...")
    
    # First pass: collect all entries
    count = 0
    skipped = 0
    skipped_affixes = 0
    skipped_digits = 0
    skipped_loanwords = 0
    batch = []
    
    with open(RAW_DATA, "r", encoding="utf8") as f:
        for line in f:
            if not line.strip():
                continue
            
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            
            word = norm(entry.get("word", ""))
            lang = entry.get("lang", "").strip()
            lang_code = entry.get("lang_code", "").strip()
            
            # Skip short words
            if not word or len(word) <= 2:
                skipped += 1
                continue
            
            # Skip prefixes and suffixes (e.g., "-able", "un-")
            if is_affix(word):
                skipped_affixes += 1
                continue
            
            # Skip words with digits (e.g., "4x4", "311")
            if has_digits(word):
                skipped_digits += 1
                continue
            
            # Skip loanwords (etymology contains "borrowed from")
            if is_loanword(entry):
                skipped_loanwords += 1
                continue
            
            glosses = extract_glosses(entry)
            if not glosses:
                skipped += 1
                continue
            
            ipa = extract_ipa(entry)
            
            # Add each gloss as a separate row (will dedupe on insert)
            for gloss in glosses:
                gloss = gloss.strip()
                if gloss:
                    batch.append((word, lang, lang_code, ipa, gloss))
            
            count += 1
            
            # Insert in batches
            if len(batch) >= 50000:
                temp_db.executemany(
                    "INSERT OR IGNORE INTO entries VALUES (?, ?, ?, ?, ?)",
                    batch
                )
                temp_db.commit()
                batch = []
                print(f"  Processed {count:,} entries...")
    
    # Final batch
    if batch:
        temp_db.executemany(
            "INSERT OR IGNORE INTO entries VALUES (?, ?, ?, ?, ?)",
            batch
        )
        temp_db.commit()
    
    print(f"✓ Read {count:,} entries")
    print(f"  - Skipped {skipped:,} (short/no glosses)")
    print(f"  - Skipped {skipped_affixes:,} affixes (prefixes/suffixes)")
    print(f"  - Skipped {skipped_digits:,} words with digits")
    print(f"  - Skipped {skipped_loanwords:,} loanwords")
    
    # Get unique word count
    unique_count = temp_db.execute(
        "SELECT COUNT(DISTINCT word || '|' || lang) FROM entries"
    ).fetchone()[0]
    print(f"✓ Found {unique_count:,} unique (word, lang) pairs")
    
    # Second pass: aggregate and write to final database
    print("Aggregating glosses and writing to database...")
    
    conn = sqlite3.connect(DB_FILE_NEW)
    conn.execute("""
        CREATE TABLE words (
            word TEXT NOT NULL,
            lang TEXT NOT NULL,
            lang_code TEXT,
            ipa TEXT,
            glosses TEXT,
            UNIQUE(word, lang)
        )
    """)
    conn.execute("CREATE INDEX idx_word ON words(word)")
    conn.execute("CREATE INDEX idx_lang ON words(lang)")
    
    # Aggregate using SQL
    # Note: SQLite doesn't support GROUP_CONCAT(DISTINCT x, separator) syntax
    # But since we already deduplicated glosses via PRIMARY KEY, we can just use GROUP_CONCAT
    cursor = temp_db.execute("""
        SELECT 
            word,
            lang,
            MAX(lang_code) as lang_code,
            MAX(ipa) as ipa,
            GROUP_CONCAT(gloss, ' | ') as glosses
        FROM entries
        GROUP BY word, lang
        ORDER BY word, lang
    """)
    
    batch = []
    written = 0
    
    for row in cursor:
        batch.append(row)
        
        if len(batch) >= 10000:
            conn.executemany(
                "INSERT INTO words VALUES (?, ?, ?, ?, ?)",
                batch
            )
            conn.commit()
            written += len(batch)
            batch = []
            print(f"  Written {written:,} aggregated entries...")
    
    if batch:
        conn.executemany(
            "INSERT INTO words VALUES (?, ?, ?, ?, ?)",
            batch
        )
        conn.commit()
        written += len(batch)
    
    conn.close()
    temp_db.close()
    
    # Clean up temp database
    if os.path.exists(temp_db_path):
        os.remove(temp_db_path)
    # Also remove WAL files if they exist
    for ext in ["-wal", "-shm"]:
        if os.path.exists(temp_db_path + ext):
            os.remove(temp_db_path + ext)
    
    print(f"✓ Wrote {written:,} aggregated entries to {DB_FILE_NEW}")
    
    # Verify the fix
    print("\nVerifying 'hand' in English:")
    verify_conn = sqlite3.connect(DB_FILE_NEW)
    result = verify_conn.execute(
        "SELECT glosses FROM words WHERE word = 'hand' AND lang = 'English'"
    ).fetchone()
    if result:
        glosses = result[0]
        gloss_count = len(glosses.split(" | "))
        print(f"  Found {gloss_count} glosses")
        print(f"  Preview: {glosses[:200]}...")
    else:
        print("  'hand' not found in English")
    verify_conn.close()
    
    print(f"\n✓ New database ready at {DB_FILE_NEW}")
    print(f"  To replace the old database, run:")
    print(f"    mv {DB_FILE_NEW} {DB_FILE}")


if __name__ == "__main__":
    process_data()
