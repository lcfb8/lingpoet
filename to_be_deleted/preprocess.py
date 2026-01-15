import json
import unicodedata
import sqlite3
import os
from collections import defaultdict

# Configuration
RAW_DATA = os.path.expanduser("~/Development/raw-wiktextract-data.jsonl")
DB_FILE = "data/words.db"
LANGUAGES = {
    "Norwegian", "English", "Swedish", "Danish",  # Germanic/Nordic
    "French", "Spanish", "Italian", "Portuguese", "Romanian",  # Romance
    "Indonesian"  # Austronesian
}
CHUNK_SIZE = 10000

def norm(s):
    return unicodedata.normalize("NFC", (s or "").strip().lower())

def init_db():
    os.makedirs("data", exist_ok=True)
    conn = sqlite3.connect(DB_FILE)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS words (
            word TEXT NOT NULL,
            lang TEXT NOT NULL,
            lang_code TEXT,
            ipa TEXT,
            glosses TEXT,
            UNIQUE(word, lang)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_word ON words(word)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_lang ON words(lang)")
    conn.commit()
    return conn

def extract_word_data(entry):
    """Extract relevant fields from raw wiktionary entry"""
    try:
        word = entry.get("word", "").strip()
        lang = entry.get("lang", "").strip()
        lang_code = entry.get("lang_code", "").strip()
        
        # Filter out words with 1-2 characters
        if not word or len(word) <= 2:
            return None
        
        # Get glosses from senses
        senses = entry.get("senses", [])
        glosses = []
        for sense in senses:
            if "glosses" in sense:
                glosses.extend(sense["glosses"])
        glosses_str = " | ".join(glosses) if glosses else ""
        
        # If no glosses, skip
        if not glosses_str:
            return None
        
        # Get IPA pronunciation
        sounds = entry.get("sounds", [])
        ipa = None
        for sound in sounds:
            if "ipa" in sound:
                ipa = sound["ipa"]
                break
        
        return {
            "word": norm(word),
            "lang": lang,
            "lang_code": lang_code,
            "ipa": ipa,
            "glosses": glosses_str
        }
    except Exception as e:
        return None

def process_data():
    """Process raw data in streaming fashion"""
    conn = init_db()
    cursor = conn.cursor()
    
    # Aggregate glosses by (word, lang) before inserting
    word_data = {}  # key: (word, lang), value: {lang_code, ipa, glosses_set}
    count = 0
    
    try:
        with open(RAW_DATA, "r", encoding="utf8") as f:
            for line in f:
                if not line.strip():
                    continue
                
                try:
                    entry = json.loads(line)
                    data = extract_word_data(entry)
                    
                    if data:
                        count += 1
                        key = (data["word"], data["lang"])
                        
                        if key not in word_data:
                            word_data[key] = {
                                "lang_code": data["lang_code"],
                                "ipa": data["ipa"],
                                "glosses": set()
                            }
                        
                        # Add glosses to the set (avoid duplicates)
                        if data["glosses"]:
                            word_data[key]["glosses"].add(data["glosses"])
                        
                        # Insert in batches to avoid memory buildup
                        if len(word_data) >= 10000:
                            batch = []
                            for (word, lang), info in word_data.items():
                                batch.append({
                                    "word": word,
                                    "lang": lang,
                                    "lang_code": info["lang_code"],
                                    "ipa": info["ipa"],
                                    "glosses": " | ".join(sorted(info["glosses"]))
                                })
                            
                            cursor.executemany("""
                                INSERT OR REPLACE INTO words 
                                (word, lang, lang_code, ipa, glosses)
                                VALUES (:word, :lang, :lang_code, :ipa, :glosses)
                            """, batch)
                            conn.commit()
                            print(f"Processed {count} entries, {len(batch)} unique words...")
                            word_data = {}
                
                except json.JSONDecodeError:
                    continue
        
        # Final batch
        if word_data:
            batch = []
            for (word, lang), info in word_data.items():
                batch.append({
                    "word": word,
                    "lang": lang,
                    "lang_code": info["lang_code"],
                    "ipa": info["ipa"],
                    "glosses": " | ".join(sorted(info["glosses"]))
                })
            
            cursor.executemany("""
                INSERT OR REPLACE INTO words 
                (word, lang, lang_code, ipa, glosses)
                VALUES (:word, :lang, :lang_code, :ipa, :glosses)
            """, batch)
            conn.commit()
        
        print(f"✓ Processed {count} total entries")
        print(f"✓ Wrote words to {DB_FILE}")
        
    finally:
        conn.close()

if __name__ == "__main__":
    process_data()