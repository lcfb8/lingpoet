import json
import sqlite3
import unicodedata

DB_PATH = "worddb.sqlite"
DATA_PATH = "sample.jsonl"

def word_norm(s: str) -> str:
    # Normalize unicode (so characters like ã are consistent)
    s = unicodedata.normalize("NFC", s)
    return s.lower()

def ipa_norm_strict(ipa: str) -> str:
    # Keep it mostly the same, just normalize unicode + strip spaces
    ipa = unicodedata.normalize("NFC", ipa)
    return "".join(ipa.split())

def ipa_norm_loose(ipa: str) -> str:
    """
    Very simple "close enough" normalization for now.
    We'll improve this later.
    """
    ipa = unicodedata.normalize("NFC", ipa)
    ipa = "".join(ipa.split())

    # Remove common IPA punctuation / marks that often shouldn't block matches
    remove_chars = "/[]()ˈˌ.ːˑ"
    ipa = ipa.translate({ord(c): None for c in remove_chars})

    # Drop combining diacritics (nasalization, aspiration marks, tone marks, etc.)
    # This is crude but useful for a first pass.
    decomposed = unicodedata.normalize("NFD", ipa)
    decomposed = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    ipa = unicodedata.normalize("NFC", decomposed)

    # A tiny mapping to make similar vowels collide more often
    mappings = {
        "ɐ": "a",
        "ɑ": "a",
        "ɔ": "o",
        "ɛ": "e",
        "ɪ": "i",
        "ʊ": "u",
        "ɡ": "g",
        "ʁ": "r",  # crude! (French r isn't English r, but OK for loose mode)
        "w":"u",   # treat glide w like u for loose matching
    }

    ipa = "".join(mappings.get(ch, ch) for ch in ipa)

    return ipa

con = sqlite3.connect(DB_PATH)
cur = con.cursor()

# Optional: clear old data so re-running this doesn't duplicate entries
cur.execute("DELETE FROM pron;")
cur.execute("DELETE FROM entry;")
con.commit()

with open(DATA_PATH, "r", encoding="utf-8") as f:
    for line in f:
        row = json.loads(line)
        lang = row["lang"]
        word = row["word"]
        script = row["script"]
        ipas = row.get("ipas", [])

        wn = word_norm(word)
        cur.execute(
            "INSERT INTO entry(lang, word, word_norm, script) VALUES (?, ?, ?, ?)",
            (lang, word, wn, script),
        )
        entry_id = cur.lastrowid

        for ipa in ipas:
            s_norm = ipa_norm_strict(ipa)
            l_norm = ipa_norm_loose(ipa)
            cur.execute(
                "INSERT INTO pron(entry_id, ipa, ipa_norm_strict, ipa_norm_loose) VALUES (?, ?, ?, ?)",
                (entry_id, ipa, s_norm, l_norm),
            )

con.commit()

# Quick sanity check: show what's in the DB
print("Entries:", cur.execute("SELECT COUNT(*) FROM entry").fetchone()[0])
print("Pronunciations:", cur.execute("SELECT COUNT(*) FROM pron").fetchone()[0])

print("\nPron table preview:")
for r in cur.execute("""
SELECT e.lang, e.word, e.script, p.ipa, p.ipa_norm_loose
FROM entry e
JOIN pron p ON p.entry_id = e.entry_id
ORDER BY e.lang;
"""):
    print(r)

con.close()
