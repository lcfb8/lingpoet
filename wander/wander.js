/* Wander page interactive functionality */

(async function () {
  const DB_URL = "../data/coincidences.db";
  const GLOSS_OVERLAP_THRESHOLD = 0.10; // 10% - match the Python threshold
  const statusEl = document.getElementById("status");
  const goBtn = document.getElementById("go-wander");
  const grid = document.getElementById("peek-grid");
  let dataset = []; // rows read from DB only
  const TILE_COUNT = 6;

  const setStatus = (s) => { if (statusEl) statusEl.textContent = s; };

  // Tokenize gloss for overlap calculation (matches Python logic)
  const STOP_WORDS = new Set([
    'the', 'and', 'for', 'are', 'was', 'were', 'has', 'have', 'had',
    'with', 'from', 'that', 'this', 'these', 'those', 'than', 'then',
    'such', 'when', 'where', 'what', 'which', 'who', 'whom', 'whose',
    'been', 'being', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'must', 'can', 'its', 'not', 'but', 'all', 'any',
    'some', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
    'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'under', 'again', 'further', 'once', 'here', 'there',
    'also', 'only', 'own', 'same', 'very', 'just', 'now', 'used'
  ]);

  function tokenizeGloss(text) {
    if (!text) return new Set();
    const tokens = text.toLowerCase().match(/[a-z]+/g) || [];
    return new Set(tokens.filter(t => t.length > 2 && !STOP_WORDS.has(t)));
  }

  function calculateOverlap(tokens1, tokens2) {
    if (!tokens1.size || !tokens2.size) return 0;
    const intersection = new Set([...tokens1].filter(t => tokens2.has(t)));
    const union = new Set([...tokens1, ...tokens2]);
    return intersection.size / union.size;
  }

  // Filter out languages with overlapping meanings, keep one representative per cluster
  function filterRelatedLanguages(entries) {
    if (entries.length < 2) return entries;
    
    // Build token sets for each entry
    const entriesWithTokens = entries.map(e => ({
      ...e,
      tokens: tokenizeGloss(e.meaning)
    }));
    
    // Build clusters of related languages
    const clusters = [];
    const assigned = new Set();
    
    for (let i = 0; i < entriesWithTokens.length; i++) {
      if (assigned.has(i)) continue;
      
      const cluster = [i];
      assigned.add(i);
      
      for (let j = i + 1; j < entriesWithTokens.length; j++) {
        if (assigned.has(j)) continue;
        
        const overlap = calculateOverlap(
          entriesWithTokens[i].tokens,
          entriesWithTokens[j].tokens
        );
        
        if (overlap >= GLOSS_OVERLAP_THRESHOLD) {
          cluster.push(j);
          assigned.add(j);
        }
      }
      
      clusters.push(cluster);
    }
    
    // From each cluster, keep only one representative (first one in the cluster)
    const keptIndices = clusters.map(cluster => cluster[0]);
    return keptIndices.map(idx => entries[idx]);
  }

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
            // Filter out related languages (e.g., Arabic dialects with same meaning)
            const mappedEntries = entries.map(entry => ({
              word: entry.word || matchKey || "",
              ipa: entry.ipa || "",
              language: entry.lang || entry.lang_code || "",
              meaning: entry.glosses || entry.gloss || entry.meaning || ""
            }));
            
            const filteredEntries = filterRelatedLanguages(mappedEntries);
            
            for (const entry of filteredEntries) {
              dataset.push(entry);
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

    // Apply filtering again at the word level to handle cases where the same word
    // appears in multiple database rows (e.g., both spelling and pronunciation matches)
    for (const word in byWord) {
      if (byWord[word].rows.length > 1) {
        byWord[word].rows = filterRelatedLanguages(byWord[word].rows);
        // Rebuild langs set after filtering
        byWord[word].langs = new Set(byWord[word].rows.map(r => r.language).filter(Boolean));
      }
    }

    // Check if a word uses Latin script (basic Latin alphabet characters)
    function isLatinScript(word) {
      if (!word) return false;
      // Check if word contains mostly Latin characters (a-z, A-Z, accented letters)
      // Latin extended includes characters up to U+024F
      const latinPattern = /^[\u0020-\u024F\u1E00-\u1EFF]+$/;
      return latinPattern.test(word);
    }

    // Filter word by length: Latin script <= 5 chars, other scripts unrestricted
    function meetsLengthRequirement(word) {
      if (!word) return false;
      if (isLatinScript(word)) {
        return word.length <= 5;
      }
      return true; // Non-Latin scripts have no restriction
    }

    function shuffle(a){ for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]] } return a; }

    // candidates: words present in >=3 distinct languages AND meet length requirement
    const primaryCandidates = shuffle(Object.entries(byWord).filter(([w,v]) => v.langs.size >= 3 && meetsLengthRequirement(w)).map(([w]) => w));
    // secondary: >=2 languages AND meet length requirement
    const secondaryCandidates = shuffle(Object.entries(byWord).filter(([w,v]) => v.langs.size === 2 && meetsLengthRequirement(w)).map(([w]) => w));
    // fallback: any word that meets length requirement
    const allWords = shuffle(Object.keys(byWord).filter(w => meetsLengthRequirement(w)));

    function pickRandomWords() {
      const chosen = [];

      const p = shuffle(primaryCandidates.slice());
      for (const w of p) { if (chosen.length === TILE_COUNT) break; chosen.push(w); }
      if (chosen.length < TILE_COUNT) {
        const s = shuffle(secondaryCandidates.slice());
        for (const w of s) { if (chosen.length === TILE_COUNT) break; if (!chosen.includes(w)) chosen.push(w); }
      }
      if (chosen.length < TILE_COUNT) {
        const rest = shuffle(allWords.slice());
        for (const w of rest) { if (chosen.length === TILE_COUNT) break; if (!chosen.includes(w)) chosen.push(w); }
      }
      // If for any reason we still have fewer than TILE_COUNT (rare), pad with random words
      let attempts = 0;
      while (chosen.length < TILE_COUNT && attempts < 100) {
        const pick = allWords[Math.floor(Math.random() * allWords.length)];
        if (pick && !chosen.includes(pick)) chosen.push(pick);
        attempts++;
      }
      // As a last resort allow duplicates to reach TILE_COUNT
      while (chosen.length < TILE_COUNT) {
        const pick = allWords[Math.floor(Math.random() * allWords.length)];
        chosen.push(pick || `word-${chosen.length}`);
      }

      const result = chosen.slice(0, TILE_COUNT).map(w => ({ word: w }));
      console.log(`🧩 pickRandomWords → ${result.length} items`, result.map(r => r.word));
      return result;
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

        // Add the word at the top of the back
        const backWordSpan = document.createElement("div");
        backWordSpan.className = "peek__back-word";
        backWordSpan.textContent = it.word || "—";
        back.appendChild(backWordSpan);

        const info = byWord[it.word] || { rows: [], langs: new Set() };
        const langs = Array.from(info.langs).slice(0,3);
        if (langs.length === 0) {
          back.innerHTML += "<p class='muted'>No entries found for this word.</p>";
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
      setStatus(`Displaying ${initialItems.length} tiles. Tap a tile to reveal IPA and meanings.`);
    } catch (e) {
      console.warn('Could not render initial tiles:', e);
    }

    goBtn.addEventListener("click", ()=>{
      setStatus("Generating words…");
      const items = pickRandomWords();
      renderTiles(items);
      setStatus(`Displaying ${items.length} tiles. Tap a tile to reveal IPA and meanings.`);

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
