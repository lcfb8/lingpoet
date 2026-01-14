import sqlite3
import json

def semantic_overlap(def1, def2):
    """Simple semantic similarity: word overlap in definitions"""
    if not def1 or not def2:
        return 0
    
    words1 = set(def1.lower().split())
    words2 = set(def2.lower().split())
    
    if not words1 or not words2:
        return 0
    
    overlap = len(words1 & words2)
    total = len(words1 | words2)
    return overlap / total if total > 0 else 0

conn = sqlite3.connect("data/words.db")
cursor = conn.cursor()

# Find words spelled the same across multiple languages
cursor.execute("""
    SELECT word, GROUP_CONCAT(lang || ':' || COALESCE(glosses, ''), '|') as lang_defs,
           COUNT(*) as lang_count
    FROM words
    GROUP BY word
    HAVING lang_count > 1
    ORDER BY lang_count DESC
""")

results = []
for row in cursor.fetchall():
    word = row[0]
    lang_defs = row[1].split('|')
    lang_count = row[2]
    
    entries = [ld.split(':', 1) for ld in lang_defs]
    
    overlaps = []
    for i, (lang1, def1) in enumerate(entries):
        for lang2, def2 in entries[i+1:]:
            overlap = semantic_overlap(def1, def2)
            overlaps.append(overlap)
    
    avg_overlap = sum(overlaps) / len(overlaps) if overlaps else 0
    
    # Keep words with divergent definitions
    if avg_overlap < 0.3:
        results.append({
            "word": word,
            "languages": lang_count,
            "definition_overlap": round(avg_overlap, 2),
            "entries": [{"lang": lang, "definition": defn} for lang, defn in entries]
        })

results.sort(key=lambda x: (x["definition_overlap"], -x["languages"]))

# Save all results
with open("data/coincidences.json", "w") as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

print(f"✓ Found {len(results)} coincidences")
print(f"Top 10 most likely:")
for r in results[:10]:
    print(f"  {r['word']}: {r['languages']} languages (overlap: {r['definition_overlap']})")

conn.close()
