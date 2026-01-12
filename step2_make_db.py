import sqlite3

DB_PATH = "worddb.sqlite"

con = sqlite3.connect(DB_PATH)
cur = con.cursor()
# Table 1: one row per word-in-a-language
cur.execute("""
CREATE TABLE IF NOT EXISTS entry (
  entry_id   INTEGER PRIMARY KEY,
  lang       TEXT NOT NULL,
  word       TEXT NOT NULL,
  word_norm  TEXT NOT NULL,
  script     TEXT NOT NULL
);
""")

# Table 2: pronunciations (0..n rows per entry)
cur.execute("""
CREATE TABLE IF NOT EXISTS pron (
  pron_id          INTEGER PRIMARY KEY,
  entry_id         INTEGER NOT NULL,
  ipa              TEXT NOT NULL,
  ipa_norm_strict  TEXT NOT NULL,
  ipa_norm_loose   TEXT NOT NULL,
  FOREIGN KEY(entry_id) REFERENCES entry(entry_id)
);
""")

# Indexes to make searches fast
cur.execute("CREATE INDEX IF NOT EXISTS entry_word_norm_idx ON entry(word_norm);")
cur.execute("CREATE INDEX IF NOT EXISTS entry_script_idx ON entry(script);")
cur.execute("CREATE INDEX IF NOT EXISTS pron_ipa_loose_idx ON pron(ipa_norm_loose);")

con.commit()
con.close()

print("Created/updated database:", DB_PATH)
