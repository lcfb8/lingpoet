let db = null;
let currentTab = 'spelling';
let currentMode = 'search';  // 'search' or 'explore'
let searchTimeout;
let selectedLanguages = [];
let pendingLanguages = [];  // Languages selected in dropdown but not yet applied
let languageMode = 'top300';  // 'top300' or 'all'
let allLanguagesData = [];  // { lang, count } sorted by count desc
let dropdownOpen = false;

// Explore mode state
let exploreSelectedLanguages = [];
let exploreLangMode = 'top300';
let currentExploreResults = [];  // Store results for CSV download

const TOP_300_COUNT = 300;

const DB_URL = '../data/coincidences.db';

// IPA normalization (same logic as Python version)
const IPA_MAP = {
    "ɡ": "g", "θ": "th", "ð": "th", "ʃ": "sh", "ʒ": "zh",
    "ŋ": "ng", "ɲ": "ny", "ʧ": "ch", "ʤ": "j",
    "ɑ": "a", "ɒ": "a", "æ": "a", "ʌ": "a",
    "ɔ": "o", "ɜ": "e", "ə": "e", "ɪ": "i", "ʊ": "u",
    "ɹ": "r", "ɾ": "r", "ʁ": "r", "ʀ": "r",  // Various r sounds
};

const IPA_STRIP = /[\[\]/ˈˌ\s]/g;

function normalizeIpa(ipa) {
    if (!ipa) return "";
    ipa = ipa.toLowerCase();
    for (const [src, dest] of Object.entries(IPA_MAP)) {
        ipa = ipa.replace(new RegExp(src, 'g'), dest);
    }
    ipa = ipa.replace(IPA_STRIP, "");
    ipa = ipa.replace(/ː/g, "");
    return ipa;
}

// Fetch a gzip-compressed file and return its ArrayBuffer (uses native DecompressionStream when available)
async function fetchGzipArrayBuffer(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error('Database file not found. Please check the S3 URL.');
    }

    // Prefer native streaming decompression when supported
    if (response.body && typeof DecompressionStream !== 'undefined') {
        const decompressedStream = response.body.pipeThrough(new DecompressionStream('gzip'));
        return await new Response(decompressedStream).arrayBuffer();
    }

    // Fallback: download whole file and decompress via pako
    const compressedBuffer = await response.arrayBuffer();
    if (typeof window.pako === 'undefined') {
        await loadPako();
    }
    const decompressed = window.pako.ungzip(new Uint8Array(compressedBuffer));
    return decompressed.buffer;
}

async function fetchDatabaseArrayBuffer(url) {
    if (url.endsWith('.gz')) {
        return fetchGzipArrayBuffer(url);
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error('Database file not found. Please check the URL.');
    }
    return await response.arrayBuffer();
}

// Lazy-load pako only if needed for gzip fallback
function loadPako() {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load gzip decompressor.'));
        document.head.appendChild(script);
    });
}

// Initialize database
async function initDatabase() {
    const resultsDiv = document.getElementById('results');
    const languageFilterDiv = document.getElementById('languageFilter');

    try {
        resultsDiv.innerHTML = '<div class="loading">Loading database...</div>';

        // Initialize SQL.js
        const SQL = await initSqlJs({
            locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
        });

        // Fetch and load the compressed database
        const response = await fetchDatabaseArrayBuffer(DB_URL);
        db = new SQL.Database(new Uint8Array(response));

        resultsDiv.innerHTML = '<div class="no-results">Enter a search term to find coincidences</div>';

        // Load languages
        await loadLanguages();

    } catch (error) {
        console.error('Database initialization error:', error);
        resultsDiv.innerHTML = `<div class="error">Error loading database: ${error.message}</div>`;
        languageFilterDiv.innerHTML = '<em>Database not loaded</em>';
    }
}

async function loadLanguages() {
    try {
        if (!db) return;

        const result = db.exec("SELECT entries FROM spelling_matches");
        const langCounts = new Map();  // lang -> count of coincidences

        if (result.length > 0) {
            const rows = result[0].values;
            for (const row of rows) {
                try {
                    const entries = JSON.parse(row[0]);
                    for (const entry of entries) {
                        if (entry.lang) {
                            langCounts.set(entry.lang, (langCounts.get(entry.lang) || 0) + 1);
                        }
                    }
                } catch (e) {
                    // Skip invalid JSON
                }
            }
        }

        // Sort by count descending, then alphabetically
        allLanguagesData = Array.from(langCounts.entries())
            .map(([lang, count]) => ({ lang, count }))
            .sort((a, b) => b.count - a.count || a.lang.localeCompare(b.lang));

        if (allLanguagesData.length === 0) {
            document.getElementById('languageList').innerHTML = '<div class="dropdown-no-results">No languages found</div>';
            return;
        }

        renderLanguageDropdown();
        updateDropdownPlaceholder();
    } catch (error) {
        console.error('Error loading languages:', error);
        document.getElementById('languageList').innerHTML = '<div class="dropdown-no-results">Error loading languages</div>';
    }
}

function renderLanguageDropdown(filter = '') {
    const container = document.getElementById('languageList');
    let langsToShow;
    
    if (languageMode === 'all') {
        langsToShow = allLanguagesData;
    } else {
        langsToShow = allLanguagesData.slice(0, TOP_300_COUNT);
    }
    
    // Sort displayed languages alphabetically
    let sortedLangs = [...langsToShow].sort((a, b) => a.lang.localeCompare(b.lang));
    
    // Filter by search text
    if (filter) {
        const lowerFilter = filter.toLowerCase();
        sortedLangs = sortedLangs.filter(({ lang }) => 
            lang.toLowerCase().includes(lowerFilter)
        );
    }

    if (sortedLangs.length === 0) {
        container.innerHTML = '<div class="dropdown-no-results">No languages match your search</div>';
        return;
    }

    container.innerHTML = sortedLangs.map(({ lang, count }) => `
        <div class="dropdown-item ${pendingLanguages.includes(lang) ? 'selected' : ''}" 
             onclick="toggleDropdownItem('${escapeHtml(lang).replace(/'/g, "\\'")}')">
            <input type="checkbox" 
                   ${pendingLanguages.includes(lang) ? 'checked' : ''}
                   onclick="event.stopPropagation(); toggleDropdownItem('${escapeHtml(lang).replace(/'/g, "\\'")}')">
            <label>${escapeHtml(lang)}</label>
            <span class="lang-count">${count.toLocaleString()} coincidences</span>
        </div>
    `).join('');
}

function toggleDropdown() {
    dropdownOpen = !dropdownOpen;
    const menu = document.getElementById('dropdownMenu');
    const trigger = document.querySelector('.dropdown-trigger');
    
    if (dropdownOpen) {
        menu.classList.add('open');
        trigger.classList.add('open');
        // Copy current selection to pending
        pendingLanguages = [...selectedLanguages];
        renderLanguageDropdown();
        // Focus the search input
        setTimeout(() => {
            document.getElementById('languageSearchInput').focus();
        }, 100);
    } else {
        menu.classList.remove('open');
        trigger.classList.remove('open');
        document.getElementById('languageSearchInput').value = '';
    }
}

function closeDropdown() {
    if (dropdownOpen) {
        dropdownOpen = false;
        document.getElementById('dropdownMenu').classList.remove('open');
        document.querySelector('.dropdown-trigger').classList.remove('open');
        document.getElementById('languageSearchInput').value = '';
    }
}

function toggleDropdownItem(lang) {
    if (pendingLanguages.includes(lang)) {
        pendingLanguages = pendingLanguages.filter(l => l !== lang);
    } else {
        pendingLanguages.push(lang);
    }
    renderLanguageDropdown(document.getElementById('languageSearchInput').value);
}

function filterLanguageList() {
    const filter = document.getElementById('languageSearchInput').value;
    renderLanguageDropdown(filter);
}

function clearLanguageSelection() {
    pendingLanguages = [];
    renderLanguageDropdown(document.getElementById('languageSearchInput').value);
}

function applyLanguageFilter() {
    selectedLanguages = [...pendingLanguages];
    closeDropdown();
    updateDropdownPlaceholder();
    renderSelectedTags();
    performSearch();
}

function updateDropdownPlaceholder() {
    const placeholder = document.getElementById('dropdownPlaceholder');
    if (selectedLanguages.length === 0) {
        placeholder.textContent = 'Select languages...';
        placeholder.classList.remove('has-selection');
    } else if (selectedLanguages.length === 1) {
        placeholder.textContent = selectedLanguages[0];
        placeholder.classList.add('has-selection');
    } else {
        placeholder.textContent = `${selectedLanguages.length} languages selected`;
        placeholder.classList.add('has-selection');
    }
}

function renderSelectedTags() {
    const container = document.getElementById('selectedLanguagesTags');
    if (selectedLanguages.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    container.innerHTML = selectedLanguages.map(lang => `
        <span class="language-tag">
            ${escapeHtml(lang)}
            <span class="remove-tag" onclick="removeLanguageTag('${escapeHtml(lang).replace(/'/g, "\\'")}')">×</span>
        </span>
    `).join('');
}

function removeLanguageTag(lang) {
    selectedLanguages = selectedLanguages.filter(l => l !== lang);
    pendingLanguages = pendingLanguages.filter(l => l !== lang);
    updateDropdownPlaceholder();
    renderSelectedTags();
    performSearch();
}

function setLanguageMode(mode) {
    languageMode = mode;
    
    // Update button states
    document.querySelectorAll('.lang-mode-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.getElementById(`langMode-${mode}`).classList.add('active');
    
    // Update the label text
    const label = document.getElementById('languageFilterLabel');
    if (mode === 'all') {
        label.textContent = `Search all ${allLanguagesData.length} languages.`;
    } else {
        label.textContent = `Search the top 300 languages by number of word coincidences.`;
    }
    
    // Re-render dropdown if open
    if (dropdownOpen) {
        renderLanguageDropdown(document.getElementById('languageSearchInput').value);
    }
}

function switchTab(tab, button) {
    currentTab = tab;
    console.log('switchTab called, currentTab is now:', currentTab);
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');

    document.getElementById('searchInput').placeholder =
        tab === 'spelling' ? 'Type a word to find coincidences...' : 'Type an IPA pronunciation (e.g., /pɪn/ or pin)...';

    performSearch();
}

function debounceSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(performSearch, 300);
}

async function performSearch() {
    if (!db) return;

    const query = document.getElementById('searchInput').value.trim();
    const resultsDiv = document.getElementById('results');

    if (query.length < 2) {
        resultsDiv.innerHTML = '<div class="no-results">Enter at least 2 characters to search</div>';
        return;
    }

    resultsDiv.innerHTML = '<div class="loading">Searching...</div>';

    try {
        const results = await searchDatabase(query);
        renderResults(results);
    } catch (error) {
        console.error('Error:', error);
        resultsDiv.innerHTML = '<div class="error">Error searching. Please try again.</div>';
    }
}

async function searchDatabase(query) {
    const table = currentTab === 'spelling' ? 'spelling_matches' : 'pronunciation_matches';
    let searchKey = query.toLowerCase();

    if (searchKey.length < 2) return [];

    let sql, result;
    
    console.log('searchDatabase called with currentTab:', currentTab, 'query:', query);
    
    if (currentTab === 'spelling') {
        // For spelling, search by match_key directly
        sql = `
            SELECT match_key, languages, gloss_overlap, entries
            FROM ${table}
            WHERE match_key LIKE ?
            ORDER BY languages DESC
            LIMIT 100
        `;
        console.log('Searching spelling_matches with:', searchKey);
        result = db.exec(sql, [`%${searchKey}%`]);
    } else {
        // For pronunciation, normalize IPA and search by match_key
        searchKey = normalizeIpa(query);
        if (searchKey.length < 2) return [];
        
        sql = `
            SELECT match_key, languages, gloss_overlap, entries
            FROM pronunciation_matches
            WHERE match_key LIKE ?
            ORDER BY languages DESC
            LIMIT 100
        `;
        console.log('Searching pronunciation_matches with normalized IPA:', searchKey);
        result = db.exec(sql, [`%${searchKey}%`]);
    }

    if (result.length === 0) return [];

    const rows = result[0].values;
    const results = [];

    // Build the list of allowed languages based on languageMode
    let allowedLanguages = null;  // null means no restriction
    if (selectedLanguages.length === 0) {
        // If no specific languages selected, filter by language mode (top 300 or all)
        if (languageMode === 'top300') {
            allowedLanguages = new Set(allLanguagesData.slice(0, TOP_300_COUNT).map(l => l.lang));
        }
        // If languageMode is 'all', allowedLanguages stays null (no restriction)
    }

    for (const row of rows) {
        try {
            let entries = JSON.parse(row[3]);

            // Filter by selected languages if any
            if (selectedLanguages.length > 0) {
                entries = entries.filter(e => selectedLanguages.includes(e.lang));
                if (entries.length < 2) continue;
            } else if (allowedLanguages !== null) {
                // Filter by language mode (top 120, top 500, or all)
                entries = entries.filter(e => allowedLanguages.has(e.lang));
                if (entries.length < 2) continue;
            }

            results.push({
                match_key: row[0],
                languages: entries.length,
                gloss_overlap: row[2],
                entries: entries
            });
        } catch (e) {
            console.error('Error parsing entry:', e);
        }
    }

    // Sort results: exact matches first, then by number of languages
    results.sort((a, b) => {
        const aExact = a.match_key === searchKey ? 0 : 1;
        const bExact = b.match_key === searchKey ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        return b.languages - a.languages;
    });

    return results;
}

function renderResults(results) {
    const container = document.getElementById('results');

    if (!results.length) {
        container.innerHTML = '<div class="no-results">No coincidences found</div>';
        return;
    }

    container.innerHTML = results.map(result => {
        const entries = result.entries.map(e => `
            <div class="entry">
                <div class="entry-word">${escapeHtml(e.word)}</div>
                <div class="entry-header">
                    <span class="entry-lang">${escapeHtml(e.lang)} (${escapeHtml(e.lang_code || '?')})</span>
                    ${e.ipa ? `<span class="entry-ipa">${escapeHtml(e.ipa)}</span>` : ''}
                </div>
                <div class="entry-gloss">${escapeHtml(e.glosses) || '<em>No definition</em>'}</div>
            </div>
        `).join('');

        return `
            <div class="result-item">
                <div class="result-header">
                    <span class="result-word">${escapeHtml(result.match_key)}</span>
                    <span class="result-meta">${result.languages} languages</span>
                </div>
                ${entries}
            </div>
        `;
    }).join('');
}

// ==================== MODE SWITCHING ====================

function switchMode(mode, button) {
    currentMode = mode;
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    button.classList.add('active');
    
    document.getElementById('searchMode').style.display = mode === 'search' ? 'block' : 'none';
    document.getElementById('exploreMode').style.display = mode === 'explore' ? 'block' : 'none';
    
    if (mode === 'explore' && allLanguagesData.length > 0) {
        // Ensure top 300 button is active by default
        exploreLangMode = 'top300';
        document.querySelectorAll('#exploreMode .lang-mode-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById('exploreLangMode-top300').classList.add('active');
        renderExploreLanguageList();
    }
}

// ==================== EXPLORE MODE FUNCTIONS ====================

function setExploreLangMode(mode) {
    exploreLangMode = mode;
    document.querySelectorAll('#exploreMode .lang-mode-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`exploreLangMode-${mode}`).classList.add('active');
    renderExploreLanguageList();
}

function renderExploreLanguageList() {
    const container = document.getElementById('exploreLanguageList');
    const searchTerm = document.getElementById('exploreLanguageSearch').value.toLowerCase();
    
    let langsToShow;
    if (exploreLangMode === 'all') {
        langsToShow = allLanguagesData;
    } else {
        langsToShow = allLanguagesData.slice(0, TOP_300_COUNT);
    }
    
    // Sort alphabetically
    langsToShow = [...langsToShow].sort((a, b) => a.lang.localeCompare(b.lang));
    
    // Filter by search term
    if (searchTerm) {
        langsToShow = langsToShow.filter(l => l.lang.toLowerCase().includes(searchTerm));
    }
    
    if (langsToShow.length === 0) {
        container.innerHTML = '<div class="no-results" style="padding: 1rem;">No languages match your search</div>';
        return;
    }
    
    container.innerHTML = langsToShow.map(({ lang, count }) => `
        <label class="explore-lang-item ${exploreSelectedLanguages.includes(lang) ? 'selected' : ''}">
            <input type="checkbox" 
                   ${exploreSelectedLanguages.includes(lang) ? 'checked' : ''}
                   onchange="toggleExploreLanguage('${escapeHtml(lang).replace(/'/g, "\\'")}')">
            <span class="lang-name">${escapeHtml(lang)}</span>
            <span class="lang-count">${count.toLocaleString()} coincidences</span>
        </label>
    `).join('');
}

function toggleExploreLanguage(lang) {
    const idx = exploreSelectedLanguages.indexOf(lang);
    if (idx === -1) {
        exploreSelectedLanguages.push(lang);
    } else {
        exploreSelectedLanguages.splice(idx, 1);
    }
    renderExploreLanguageList();
    renderExploreSelectedTags();
}

function renderExploreSelectedTags() {
    const container = document.getElementById('exploreSelectedTags');
    if (exploreSelectedLanguages.length === 0) {
        container.innerHTML = '<span class="muted">Select at least 2 languages</span>';
        return;
    }
    
    container.innerHTML = exploreSelectedLanguages.map(lang => `
        <span class="language-tag">
            ${escapeHtml(lang)}
            <span class="remove-tag" onclick="toggleExploreLanguage('${escapeHtml(lang).replace(/'/g, "\\'")}')">×</span>
        </span>
    `).join('');
}

function clearExploreLanguages() {
    exploreSelectedLanguages = [];
    renderExploreLanguageList();
    renderExploreSelectedTags();
    document.getElementById('exploreResults').innerHTML = '';
}

async function findCoincidences() {
    if (exploreSelectedLanguages.length < 2) {
        alert('Please select at least 2 languages to find coincidences');
        return;
    }
    
    const resultsContainer = document.getElementById('exploreResults');
    resultsContainer.innerHTML = '<div class="loading">Finding coincidences... This may take a moment.</div>';
    
    // Use setTimeout to allow UI to update before heavy processing
    setTimeout(async () => {
        try {
            const results = [];
            const selectedSet = new Set(exploreSelectedLanguages);
            
            // Search spelling matches
            const spellingResult = db.exec("SELECT match_key, entries FROM spelling_matches");
            if (spellingResult.length > 0) {
                for (const row of spellingResult[0].values) {
                    const [matchKey, entriesJson] = row;
                    try {
                        const entries = JSON.parse(entriesJson);
                        const matchingEntries = entries.filter(e => selectedSet.has(e.lang));
                        
                        if (matchingEntries.length >= 2) {
                            // Check if we have entries from at least 2 different selected languages
                            const uniqueLangs = new Set(matchingEntries.map(e => e.lang));
                            if (uniqueLangs.size >= 2) {
                                results.push({
                                    word: matchKey,
                                    type: 'spelling',
                                    entries: matchingEntries
                                });
                            }
                        }
                    } catch (e) {}
                }
            }
            
            // Search pronunciation matches
            const pronResult = db.exec("SELECT match_key, entries FROM pronunciation_matches");
            if (pronResult.length > 0) {
                for (const row of pronResult[0].values) {
                    const [matchKey, entriesJson] = row;
                    try {
                        const entries = JSON.parse(entriesJson);
                        const matchingEntries = entries.filter(e => selectedSet.has(e.lang));
                        
                        if (matchingEntries.length >= 2) {
                            const uniqueLangs = new Set(matchingEntries.map(e => e.lang));
                            if (uniqueLangs.size >= 2) {
                                // Check if this is also a spelling match (mark as 'both')
                                const existingIdx = results.findIndex(r => 
                                    r.type === 'spelling' && 
                                    r.entries.some(re => 
                                        matchingEntries.some(me => 
                                            re.lang === me.lang && re.word === me.word
                                        )
                                    )
                                );
                                
                                if (existingIdx >= 0) {
                                    results[existingIdx].type = 'both';
                                    results[existingIdx].ipa = matchKey;
                                } else {
                                    results.push({
                                        ipa: matchKey,
                                        type: 'pronunciation',
                                        entries: matchingEntries
                                    });
                                }
                            }
                        }
                    } catch (e) {}
                }
            }
            
            // Sort by number of matching languages desc, then alphabetically
            results.sort((a, b) => {
                const aLangs = new Set(a.entries.map(e => e.lang)).size;
                const bLangs = new Set(b.entries.map(e => e.lang)).size;
                if (bLangs !== aLangs) return bLangs - aLangs;
                const aKey = a.word || a.ipa || '';
                const bKey = b.word || b.ipa || '';
                return aKey.localeCompare(bKey);
            });
            
            renderExploreResults(results);
            
        } catch (error) {
            console.error('Error finding coincidences:', error);
            resultsContainer.innerHTML = '<div class="error">Error finding coincidences. Please try again.</div>';
        }
    }, 50);
}

function renderExploreResults(results) {
    const container = document.getElementById('exploreResults');
    
    // Store results globally for CSV download
    currentExploreResults = results;
    
    if (results.length === 0) {
        container.innerHTML = '<div class="no-results">No coincidences found for the selected languages</div>';
        return;
    }
    
    const langList = exploreSelectedLanguages.join(', ');
    const summary = `<div class="explore-summary" style="padding: 1rem; background: rgba(47, 92, 255, 0.08); border-radius: 8px; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
        <span>Found <strong>${results.length.toLocaleString()}</strong> coincidences between ${langList}</span>
        <button class="dropdown-apply" onclick="downloadExploreCSV()" style="margin: 0;">📥 Download CSV</button>
    </div>`;
    
    const resultsHtml = results.slice(0, 500).map(result => {
        const matchTypeClass = result.type === 'both' ? 'match-both' 
                             : result.type === 'spelling' ? 'match-spelling' 
                             : 'match-pronunciation';
        const matchTypeLabel = result.type === 'both' ? '✨ Spelling & Pronunciation' 
                             : result.type === 'spelling' ? '📝 Spelling Match' 
                             : '🔊 Pronunciation Match';
        
        const header = result.word 
            ? `<span class="result-word">${escapeHtml(result.word)}</span>`
            : `<span class="result-word" style="font-style: italic;">/${escapeHtml(result.ipa)}/</span>`;
        
        const ipaDisplay = result.type === 'both' && result.ipa 
            ? `<span class="muted" style="margin-left: 0.5rem;">/${escapeHtml(result.ipa)}/</span>` 
            : '';
        
        const entriesHtml = result.entries.map(entry => `
            <div class="entry">
                <div class="entry-header">
                    <span class="entry-lang">${escapeHtml(entry.lang)} (${escapeHtml(entry.lang_code || '?')})</span>
                    ${entry.ipa ? `<span class="entry-ipa">${escapeHtml(entry.ipa)}</span>` : ''}
                </div>
                <div class="entry-word" style="font-family: var(--serif); font-size: 1.1rem; margin-bottom: 0.25rem;">${escapeHtml(entry.word || result.word || '')}</div>
                <div class="entry-gloss">${escapeHtml(entry.glosses) || '<em>No definition</em>'}</div>
            </div>
        `).join('');
        
        return `
            <div class="result-item">
                <div class="result-header">
                    <div>
                        ${header}
                        ${ipaDisplay}
                    </div>
                    <span class="match-type ${matchTypeClass}">${matchTypeLabel}</span>
                </div>
                ${entriesHtml}
            </div>
        `;
    }).join('');
    
    const moreNote = results.length > 500 
        ? `<div class="muted" style="text-align: center; padding: 1rem;">Showing first 500 of ${results.length.toLocaleString()} results</div>` 
        : '';
    
    container.innerHTML = summary + resultsHtml + moreNote;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function downloadExploreCSV() {
    if (!currentExploreResults || currentExploreResults.length === 0) {
        alert('No results to download');
        return;
    }
    
    // CSV header
    const headers = ['Match Key', 'Match Type', 'Language', 'Language Code', 'Word', 'Pronunciation', 'Definition'];
    
    // Build rows - one row per entry (so each language gets its own row)
    const rows = [];
    for (const result of currentExploreResults) {
        const matchKey = result.word || result.ipa || '';
        const matchType = result.type === 'both' ? 'Spelling & Pronunciation' 
                        : result.type === 'spelling' ? 'Spelling' 
                        : 'Pronunciation';
        
        for (const entry of result.entries) {
            rows.push([
                matchKey,
                matchType,
                entry.lang || '',
                entry.lang_code || '',
                entry.word || result.word || '',
                entry.ipa || '',
                entry.glosses || ''
            ]);
        }
    }
    
    // Escape CSV values (handle quotes and commas)
    function escapeCSV(value) {
        if (value == null) return '';
        const str = String(value);
        if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }
    
    // Build CSV content
    const csvContent = [
        headers.map(escapeCSV).join(','),
        ...rows.map(row => row.map(escapeCSV).join(','))
    ].join('\n');
    
    // Create and download the file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    
    // Generate filename with selected languages
    const langPart = exploreSelectedLanguages.slice(0, 3).join('-').replace(/\s+/g, '_');
    const suffix = exploreSelectedLanguages.length > 3 ? '-and-more' : '';
    link.setAttribute('download', `coincidences-${langPart}${suffix}.csv`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Initialize when page loads
window.addEventListener('DOMContentLoaded', initDatabase);

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
    const dropdown = document.getElementById('languageDropdown');
    if (dropdown && !dropdown.contains(event.target) && dropdownOpen) {
        closeDropdown();
    }
});
