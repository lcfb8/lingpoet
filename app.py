from flask import Flask, render_template, request, jsonify
import sqlite3
import json
import os
import re

app = Flask(__name__)
COINCIDENCE_DB = "data/coincidences.db"

IPA_MAP = {
    "ɡ": "g", "θ": "th", "ð": "th", "ʃ": "sh", "ʒ": "zh",
    "ŋ": "ng", "ɲ": "ny", "ʧ": "ch", "ʤ": "j",
    "ɑ": "a", "ɒ": "a", "æ": "a", "ʌ": "a",
    "ɔ": "o", "ɜ": "e", "ə": "e", "ɪ": "i", "ʊ": "u",
}
IPA_STRIP = re.compile(r"[\[\]/ˈˌ\s]")

def normalize_ipa(ipa):
    if not ipa:
        return ""
    ipa = ipa.lower()
    for src, dest in IPA_MAP.items():
        ipa = ipa.replace(src, dest)
    ipa = IPA_STRIP.sub("", ipa)
    ipa = ipa.replace("ː", "")
    return ipa

def get_db():
    conn = sqlite3.connect(COINCIDENCE_DB)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/languages')
def get_languages():
    """Get all languages from coincidence entries"""
    if not os.path.exists(COINCIDENCE_DB):
        return jsonify([])
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT entries FROM spelling_matches")
    
    langs = set()
    for row in cursor.fetchall():
        try:
            entries = json.loads(row[0])
            for e in entries:
                if e.get("lang"):
                    langs.add(e["lang"])
        except:
            pass
    conn.close()
    return jsonify(sorted(langs))

@app.route('/api/search')
def search():
    """Search coincidences by spelling"""
    query = request.args.get('q', '').strip().lower()
    languages = request.args.getlist('langs')
    
    if not query or len(query) < 2:
        return jsonify([])
    
    if not os.path.exists(COINCIDENCE_DB):
        return jsonify([])
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT match_key, languages, gloss_overlap, entries
        FROM spelling_matches
        WHERE match_key LIKE ?
        ORDER BY languages DESC
        LIMIT 100
    """, (f"%{query}%",))
    
    results = []
    selected = set(languages) if languages else None
    
    for row in cursor.fetchall():
        try:
            entries = json.loads(row["entries"])
        except:
            continue
        
        # Filter by selected languages if any
        if selected:
            entries = [e for e in entries if e.get("lang") in selected]
            if len(entries) < 2:
                continue
        
        results.append({
            "match_key": row["match_key"],
            "languages": len(entries),
            "gloss_overlap": row["gloss_overlap"],
            "entries": entries
        })
    
    conn.close()
    return jsonify(results)

@app.route('/api/search-ipa')
def search_ipa():
    """Search coincidences by pronunciation"""
    query = request.args.get('q', '').strip()
    languages = request.args.getlist('langs')
    
    norm = normalize_ipa(query)
    if not norm or len(norm) < 2:
        return jsonify([])
    
    if not os.path.exists(COINCIDENCE_DB):
        return jsonify([])
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT match_key, languages, gloss_overlap, entries
        FROM pronunciation_matches
        WHERE match_key LIKE ?
        ORDER BY languages DESC
        LIMIT 100
    """, (f"%{norm}%",))
    
    results = []
    selected = set(languages) if languages else None
    
    for row in cursor.fetchall():
        try:
            entries = json.loads(row["entries"])
        except:
            continue
        
        if selected:
            entries = [e for e in entries if e.get("lang") in selected]
            if len(entries) < 2:
                continue
        
        results.append({
            "match_key": row["match_key"],
            "languages": len(entries),
            "gloss_overlap": row["gloss_overlap"],
            "entries": entries
        })
    
    conn.close()
    return jsonify(results)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)
