import sqlite3
import json
import csv

conn = sqlite3.connect("data/words.db")
cursor = conn.cursor()

# Find words with the same pronunciation (IPA) across multiple languages
# Only consider words that have IPA pronunciation
cursor.execute("""
    SELECT ipa, GROUP_CONCAT(word || ' (' || lang || ')', ' | ') as word_lang, 
           COUNT(DISTINCT word) as unique_words, COUNT(DISTINCT lang) as lang_count
    FROM words
    WHERE ipa IS NOT NULL AND ipa != ''
    GROUP BY ipa
    HAVING lang_count > 1 AND unique_words > 1
    ORDER BY lang_count DESC
""")

results = []
for row in cursor.fetchall():
    ipa = row[0]
    word_lang = row[1]
    unique_words = row[2]
    lang_count = row[3]
    
    # Get all entries for this IPA to include definitions
    cursor.execute("""
        SELECT word, lang, glosses
        FROM words
        WHERE ipa = ?
        ORDER BY word, lang
    """, (ipa,))
    
    entries = []
    for entry_row in cursor.fetchall():
        entries.append({
            "word": entry_row[0],
            "language": entry_row[1],
            "glosses": entry_row[2]
        })
    
    results.append({
        "ipa": ipa,
        "word_language_pairs": word_lang,
        "unique_words": unique_words,
        "language_count": lang_count,
        "entries": entries
    })

# Save to JSON
with open("data/pronunciation_matches.json", "w") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

# Save to CSV for spreadsheet
with open("data/pronunciation_matches.csv", "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["IPA", "Unique Words", "Number of Languages", "Word-Language Pairs"])
    for r in results:
        writer.writerow([r["ipa"], r["unique_words"], r["language_count"], r["word_language_pairs"]])

print(f"✓ Found {len(results)} pronunciation matches")
print(f"Saved to data/pronunciation_matches.json and data/pronunciation_matches.csv")

conn.close()
