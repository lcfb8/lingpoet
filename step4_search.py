import sqlite3
import sys
import unicodedata

DB_PATH = "worddb.sqlite"

def word_norm(s: str) -> str:
    return unicodedata.normalize("NFC", s).lower()

def ipa_norm_loose(ipa: str) -> str:
    ipa = unicodedata.normalize("NFC", ipa)
    ipa = "".join(ipa.split())
    remove_chars = "/[]()ˈˌ.ːˑ"
    ipa = ipa.translate({ord(c): None for c in remove_chars})
    decomposed = unicodedata.normalize("NFD", ipa)
    decomposed = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    ipa = unicodedata.normalize("NFC", decomposed)
    mappings = {"ɐ":"a","ɑ":"a","ɔ":"o","ɛ":"e","ɪ":"i","ʊ":"u","ɡ":"g","ʁ":"r"}
    ipa = "".join(mappings.get(ch, ch) for ch in ipa)
    return ipa

def search_spelling(q: str):
    qn = word_norm(q)
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    rows = cur.execute("""
        SELECT lang, word, script, COUNT(*) as n
        FROM entry
        WHERE word_norm = ?
          AND script = 'Latin'
        GROUP BY lang, word, script
        ORDER BY lang;
    """, (qn,)).fetchall()
    con.close()
    return rows

def search_pronunciation(ipa: str):
    key = ipa_norm_loose(ipa)
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    rows = cur.execute("""
        SELECT e.lang, e.word, e.script, p.ipa, p.ipa_norm_loose
        FROM pron p
        JOIN entry e ON e.entry_id = p.entry_id
        WHERE p.ipa_norm_loose = ?
        ORDER BY e.lang;
    """, (key,)).fetchall()
    con.close()
    return key, rows

def main():
    if len(sys.argv) < 3:
        print("Usage:")
        print("  python step4_search.py spell <word>")
        print("  python step4_search.py ipa <ipa>")
        sys.exit(1)

    mode = sys.argv[1]
    query = " ".join(sys.argv[2:])

    if mode == "spell":
        rows = search_spelling(query)
        print(f"Latin-script exact spelling matches for: {query!r}")
        for r in rows:
            print(" ", r)
        if not rows:
            print("  (none)")
    elif mode == "ipa":
        key, rows = search_pronunciation(query)
        print(f"Loose IPA key: {key!r}")
        print(f"Pronunciation matches for IPA: {query!r}")
        for r in rows:
            print(" ", r)
        if not rows:
            print("  (none)")
    else:
        print("Unknown mode:", mode)

if __name__ == "__main__":
    main()
