import json

RAW_DATA = "/Users/lydiaold/Development/raw-wiktextract-data.jsonl"
count = 0

with open(RAW_DATA, "r", encoding="utf8") as f:
    for line in f:
        if not line.strip():
            continue
        entry = json.loads(line)
        word = entry.get("word", "")
        
        # Just show first entry with word length > 2
        if len(word) > 2:
            print(f"Word: {word} ({entry.get('lang')})")
            print(f"Keys in entry: {entry.keys()}")
            
            # Check for any definitions-like field
            for key in entry.keys():
                if 'def' in key.lower() or 'gloss' in key.lower() or 'sense' in key.lower():
                    print(f"  {key}: {entry[key]}")
            break
        
        count += 1
        if count > 10000:
            print("Checked 10000 entries")
            break
