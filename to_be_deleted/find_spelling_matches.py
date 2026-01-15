import sqlite3
import json
import csv

conn = sqlite3.connect("data/words.db")
cursor = conn.cursor()

# Find words spelled the same across multiple languages
cursor.execute("""
    SELECT word, GROUP_CONCAT(lang, ', ') as languages, COUNT(*) as lang_count,
           GROUP_CONCAT(lang_code, ', ') as lang_codes
    FROM words
    GROUP BY word
    HAVING lang_count > 1
    ORDER BY lang_count DESC
""")

results = []
for row in cursor.fetchall():
    word = row[0]
    languages = row[1]
    lang_count = row[2]
    lang_codes = row[3]
    
    # Get all entries for this word to include definitions
    cursor.execute("""
        SELECT lang, glosses, ipa
        FROM words
        WHERE word = ?
        ORDER BY lang
    """, (word,))
    
    entries = []
    for lang_row in cursor.fetchall():
        entries.append({
            "language": lang_row[0],
            "glosses": lang_row[1],
            "ipa": lang_row[2]
        })
    
    results.append({
        "word": word,
        "languages": languages,
        "language_count": lang_count,
        "entries": entries
    })

# Save to JSON
with open("data/spelling_matches.json", "w") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

# Save to CSV for spreadsheet
with open("data/spelling_matches.csv", "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["Word", "Number of Languages", "Languages"])
    for r in results:
        writer.writerow([r["word"], r["language_count"], r["languages"]])

print(f"✓ Found {len(results)} spelling matches")
print(f"Saved to data/spelling_matches.json and data/spelling_matches.csv")

conn.close()
