/* Wander page interactive functionality */

(async function () {
  const DB_URL = "https://dhrumil-public.s3.amazonaws.com/code4policy/coincidences.db.gz";
  const statusEl = document.getElementById("status");
  const goBtn = document.getElementById("go-wander");
  const grid = document.getElementById("peek-grid");
  let dataset = []; // rows read from DB only

  const setStatus = (s) => { if (statusEl) statusEl.textContent = s; };

  try {
    setStatus("Fetching database…");
    const resp = await fetch(DB_URL);
    const ab = await resp.arrayBuffer();
    setStatus("Decompressing…");
    const u8 = pako.ungzip(new Uint8Array(ab));
    setStatus("Loading SQL engine…");
    const SQL = await initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.6.2/${file}` });
    const db = new SQL.Database(u8);

    setStatus("Discovering tables…");
    const tablesRes = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tables = (tablesRes[0] && tablesRes[0].values) ? tablesRes[0].values.map(r => r[0]) : [];

    function detectCols(table) {
      try {
        const info = db.exec(`PRAGMA table_info("${table}")`);
        if (!info[0]) return null;
        const cols = info[0].values.map(r => r[1].toLowerCase());
        const find = (rx) => cols.find(c => c.match(rx));
        return {
          word: find(/word|token|lemma|entry/),
          ipa: find(/ipa|pron|pronunciation/),
          lang: find(/lang|language|iso|locale/),
          meaning: find(/meaning|definition|gloss|translation|def/)
        };
      } catch (e) { return null; }
    }

    // Read rows from all usable tables (no hardcoded dataset)
    for (const t of tables) {
      const cols = detectCols(t);
      if (!cols || !cols.word) continue;
      const selCols = [cols.word, cols.ipa, cols.lang, cols.meaning].filter(Boolean).map(c => `"${c}"`).join(", ");
      try {
        const rowsRes = db.exec(`SELECT ${selCols} FROM "${t}" LIMIT 20000`);
        if (!rowsRes[0]) continue;
        const colNames = rowsRes[0].columns.map(c => c.toLowerCase());
        for (const row of rowsRes[0].values) {
          const obj = {};
          for (let i = 0; i < colNames.length; i++) obj[colNames[i]] = row[i];
          dataset.push({
            word: obj[colNames.find(n=>n.match(/word|token|lemma|entry/))] || "",
            ipa: obj[colNames.find(n=>n.match(/ipa|pron/))] || "",
            language: String(obj[colNames.find(n=>n.match(/lang|language|iso|locale/))] || ""),
            meaning: obj[colNames.find(n=>n.match(/meaning|definition|gloss|translation|def/))] || ""
          });
        }
      } catch (e) { /* ignore table read errors */ }
    }

    if (dataset.length === 0) {
      setStatus("Database read succeeded but no usable rows found.");
      goBtn.disabled = true;
      return;
    }

    // index by word and collect language sets
    const byWord = {};
    for (const r of dataset) {
      if (!r.word) continue;
      byWord[r.word] = byWord[r.word] || { rows: [], langs: new Set() };
      byWord[r.word].rows.push(r);
      if (r.language) byWord[r.word].langs.add(String(r.language));
    }

    // candidates: words present in >=3 distinct languages
    const primaryCandidates = Object.entries(byWord).filter(([w,v]) => v.langs.size >= 3).map(([w]) => w);
    // secondary: >=2 languages
    const secondaryCandidates = Object.entries(byWord).filter(([w,v]) => v.langs.size === 2).map(([w]) => w);
    // fallback: any word
    const allWords = Object.keys(byWord);

    function shuffle(a){ for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]] } return a; }

    function pickRandomWords() {
      const chosen = [];
      const p = shuffle(primaryCandidates.slice());
      for (const w of p) { if (chosen.length===6) break; chosen.push(w); }
      if (chosen.length < 6) {
        const s = shuffle(secondaryCandidates.slice());
        for (const w of s) { if (chosen.length===6) break; if (!chosen.includes(w)) chosen.push(w); }
      }
      if (chosen.length < 6) {
        const rest = shuffle(allWords.slice());
        for (const w of rest) { if (chosen.length===6) break; if (!chosen.includes(w)) chosen.push(w); }
      }
      return chosen.slice(0,6).map(w => ({ word: w }));
    }

    function renderTiles(items){
      grid.innerHTML = "";
      for (const it of items) {
        const details = document.createElement("details");
        details.className = "peek";
        const summary = document.createElement("summary");
        summary.className = "peek__front";
        const wordSpan = document.createElement("span");
        wordSpan.className = "peek__word";
        wordSpan.textContent = it.word || "—";
        const hint = document.createElement("span");
        hint.className = "peek__hint";
        hint.textContent = "tap to reveal";
        summary.appendChild(wordSpan);
        summary.appendChild(hint);
        details.appendChild(summary);

        const back = document.createElement("div");
        back.className = "peek__back";

        const info = byWord[it.word] || { rows: [], langs: new Set() };
        const langs = Array.from(info.langs).slice(0,3);
        if (langs.length === 0) {
          back.innerHTML = "<p class='muted'>No entries found for this word.</p>";
        } else {
          for (const lang of langs) {
            const rows = info.rows.filter(r => String(r.language) === String(lang));
            const wrapper = document.createElement("div");
            wrapper.className = "meaning-row";
            const langLabel = document.createElement("div");
            langLabel.className = "meaning-lang";
            langLabel.textContent = lang;
            wrapper.appendChild(langLabel);

            const ipas = Array.from(new Set(rows.map(r=>r.ipa).filter(Boolean)));
            const meanings = Array.from(new Set(rows.map(r=>r.meaning).filter(Boolean)));
            if (ipas.length) {
              const ipEl = document.createElement("p");
              ipEl.innerHTML = "<strong>IPA:</strong> " + ipas.join(" · ");
              wrapper.appendChild(ipEl);
            }
            if (meanings.length) {
              for (const m of meanings) {
                const mEl = document.createElement("p");
                mEl.innerHTML = "<strong>Meaning:</strong> " + m;
                wrapper.appendChild(mEl);
              }
            }
            if (!ipas.length && !meanings.length) {
              const p = document.createElement("p");
              p.innerHTML = "<em class='muted'>No entry</em>";
              wrapper.appendChild(p);
            }
            back.appendChild(wrapper);
          }
        }

        details.appendChild(back);
        grid.appendChild(details);
      }
    }

    // enable Go wander only if at least one primary candidate exists (prefer >=3-lang coincidences)
    const hasPrimary = primaryCandidates.length > 0;
    if (!hasPrimary) setStatus("No words found that appear in 3+ languages — Go wander will still try.");
    else setStatus("Ready. Click Go wander to surface words with coincidences across 3+ languages.");
    goBtn.disabled = false;

    goBtn.addEventListener("click", ()=>{
      setStatus("Generating words…");
      const items = pickRandomWords();
      renderTiles(items);
      setStatus("Tap a tile to reveal IPA and meanings.");
      grid.scrollIntoView({ behavior: "smooth", block: "start" });
    });

  } catch (err) {
    console.error(err);
    setStatus("Failed to load database — Sneak peek disabled.");
    goBtn.disabled = true;
  }
})();
