/* Wander page interactive functionality */

(async function () {
  const DB_URL = "https://raw.githubusercontent.com/lcfb8/lingpoet-data/main/coincidences.db.gz";
  const statusEl = document.getElementById("status");
  const goBtn = document.getElementById("go-wander");
  const grid = document.getElementById("peek-grid");
  let dataset = []; // rows read from DB only

  const setStatus = (s) => { if (statusEl) statusEl.textContent = s; };

  try {
    setStatus("Fetching database…");
    const resp = await fetch(DB_URL);
    const ab = await resp.arrayBuffer();
    let u8;
    if (DB_URL.endsWith('.gz')) {
      setStatus("Decompressing…");
      u8 = pako.ungzip(new Uint8Array(ab));
    } else {
      u8 = new Uint8Array(ab);
    }
    setStatus("Loading SQL engine…");
    const SQL = await initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.6.2/${file}` });
    const db = new SQL.Database(u8);

    setStatus("Discovering tables…");
    const tablesRes = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tables = (tablesRes[0] && tablesRes[0].values) ? tablesRes[0].values.map(r => r[0]) : [];
    console.log('📊 Found tables:', tables);

    // Read rows from match tables (spelling_matches, pronunciation_matches)
    for (const t of tables) {
      if (t === 'sqlite_sequence') continue; // skip internal table
      
      try {
        console.log(`✅ Processing table "${t}"`);
        const rowsRes = db.exec(`SELECT match_key, languages, entries FROM "${t}" LIMIT 20000`);
        if (!rowsRes[0]) {
          console.log(`⚠️  No results from table "${t}"`);
          continue;
        }
        console.log(`📥 Read ${rowsRes[0].values.length} rows from "${t}"`);
        
        for (const row of rowsRes[0].values) {
          const [matchKey, languages, entriesJson] = row;
          let entries;
          try {
            entries = JSON.parse(entriesJson);
          } catch (e) {
            console.log(`⚠️  Failed to parse entries for match_key "${matchKey}"`);
            continue;
          }
          
          // Each entry in the JSON has the word data
          if (Array.isArray(entries)) {
            for (const entry of entries) {
              dataset.push({
                word: entry.word || matchKey || "",
                ipa: entry.ipa || "",
                language: entry.lang || entry.lang_code || "",
                meaning: entry.glosses || entry.gloss || entry.meaning || ""
              });
            }
          }
        }
      } catch (e) { 
        console.log(`❌ Error processing table "${t}":`, e);
      }
    }

    console.log(`📊 Total dataset size: ${dataset.length} rows`);
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
      for (const w of p) { if (chosen.length===5) break; chosen.push(w); }
      if (chosen.length < 6) {
        const s = shuffle(secondaryCandidates.slice());
        for (const w of s) { if (chosen.length===5) break; if (!chosen.includes(w)) chosen.push(w); }
      }
      if (chosen.length < 6) {
        const rest = shuffle(allWords.slice());
        for (const w of rest) { if (chosen.length===5) break; if (!chosen.includes(w)) chosen.push(w); }
      }
      return chosen.slice(0,5).map(w => ({ word: w }));
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

        // allow closing an open tile by clicking anywhere inside it
        // (ignore clicks on the summary or interactive elements like links/buttons)
        details.addEventListener('click', (ev) => {
          if (!details.open) return;
          const target = ev.target;
          if (target.closest('summary')) return;
          if (target.closest('a, button')) return;
          details.open = false;
        });
      }
    }

    // enable Go wander only if at least one primary candidate exists (prefer >=3-lang coincidences)
    const hasPrimary = primaryCandidates.length > 0;
    if (!hasPrimary) setStatus("No words found that appear in 3+ languages — showing random words.");
    else setStatus("Ready. Showing a random selection — click Go wander for new results.");
    goBtn.disabled = false;

    // initial render: show randomized tiles as soon as DB finishes loading
    try {
      const initialItems = pickRandomWords();
      renderTiles(initialItems);
      setStatus("Tap a tile to reveal IPA and meanings. Click Go wander for new results.");
    } catch (e) {
      console.warn('Could not render initial tiles:', e);
    }

    goBtn.addEventListener("click", ()=>{
      setStatus("Generating words…");
      const items = pickRandomWords();
      renderTiles(items);
      setStatus("Tap a tile to reveal IPA and meanings.");

      // Only scroll if the grid is not fully visible in the viewport.
      const rect = grid.getBoundingClientRect();
      const header = document.querySelector('.topbar');
      const headerHeight = header ? header.offsetHeight : 86;
      const gridFullyVisible = rect.top >= headerHeight && rect.bottom <= window.innerHeight;

      if (!gridFullyVisible) {
        // Scroll so the "Sneak peek" title remains visible below the sticky header.
        const title = document.getElementById('peek-title');
        if (title) {
          const titleRect = title.getBoundingClientRect();
          const target = window.pageYOffset + titleRect.top - headerHeight - 12; // small gap
          window.scrollTo({ top: target, behavior: 'smooth' });
        } else {
          // fallback: scroll grid into view at top
          grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });

  } catch (err) {
    console.error(err);
    setStatus("Failed to load database — Sneak peek disabled.");
    goBtn.disabled = true;
  }
})();
