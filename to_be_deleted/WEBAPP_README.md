# LingPoet - Word Explorer

An interactive website to explore words across languages by spelling or pronunciation.

## Setup

### 1. Install Flask
```bash
pip install flask
```

### 2. Run the app
```bash
python app.py
```

### 3. Open in browser
Visit `http://localhost:5000` in your web browser

## Features

- **Search by Spelling**: Type a word to find it in different languages
- **Search by IPA**: Search for words by their pronunciation
- **Filter by Language**: Select which languages to see results from
- **Fast Search**: Real-time results as you type

## How it works

- Uses your SQLite database (`data/words.db`)
- Flask serves the website locally
- Simple HTML/JavaScript frontend (no build step needed)
- Searches across: word, language, IPA pronunciation, and glosses

## Database Info

The database contains all words from Wiktionary with:
- **word**: The spelling
- **lang**: Language name (e.g., "Spanish")
- **lang_code**: Language code (e.g., "es")
- **ipa**: IPA pronunciation
- **glosses**: Definitions/meanings

## Notes

- The app runs on `localhost:5000` - only accessible from your computer
- Search works with partial matches (e.g., "pie" will find "pies")
- Minimum 2 characters to search
- Results limited to 100 per search for performance
