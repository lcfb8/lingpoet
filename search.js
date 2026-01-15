let db = null;
let currentTab = 'spelling';
let currentMode = 'search';  // 'search' or 'explore'
let searchTimeout;
let selectedLanguages = [];
let pendingLanguages = [];  // Languages selected in dropdown but not yet applied
let languageMode = 'top120';  // 'top120', 'top500', or 'all'
let allLanguagesData = [];  // { lang, count } sorted by count desc
let dropdownOpen = false;
const TOP_120_COUNT = 120;
const TOP_500_COUNT = 500;

// Explore mode state
let exploreSelectedLanguages = [];
let exploreLangMode = 'top120';

// IPA normalization (same logic as Python version)
const IPA_MAP = {
    "ɡ": "g", "θ": "th", "ð": "th", "ʃ": "sh", "ʒ": "zh",
    "ŋ": "ng", "ɲ": "ny", "ʧ": "ch", "ʤ": "j",
    "ɑ": "a", "ɒ": "a", "æ": "a", "ʌ": "a",
    "ɔ": "o", "ɜ": "e", "ə": "e", "ɪ": "i", "ʊ": "u",
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

        // Load the database file from S3
        const response = await fetch('https://dhrumil-public.s3.amazonaws.com/code4policy/lingpoet/coincidences.db');
        if (!response.ok) {
            throw new Error('Database file not found. Please check the S3 URL.');
        }

        const buffer = await response.arrayBuffer();
        db = new SQL.Database(new Uint8Array(buffer));

        resultsDiv.innerHTML = '<div class="no-results">Enter a search term to find coincidences</div>';

        // Load languages
        await loadLanguages();

    } catch (error) {
        console.error('Database initialization error:', error);
        resultsDiv.innerHTML = `<div class="error">Error loading database: ${error.message}<br><br>Make sure data/coincidences.db exists in the project directory.</div>`;
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
    } else if (languageMode === 'top500') {
        langsToShow = allLanguagesData.slice(0, TOP_500_COUNT);
    } else {
        langsToShow = allLanguagesData.slice(0, TOP_120_COUNT);
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
            <span class="lang-count">${count.toLocaleString()}</span>
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
        label.textContent = `Filter by language (all ${allLanguagesData.length} languages):`;
    } else if (mode === 'top500') {
        label.textContent = `Filter by language (top 500 languages by coincidences):`;
    } else {
        label.textContent = `Filter by language (top 120 languages by coincidences):`;
    }
    
    // Re-render dropdown if open
    if (dropdownOpen) {
        renderLanguageDropdown(document.getElementById('languageSearchInput').value);
    }
    
    // Re-run search with new language mode
    performSearch();
}

function switchTab(tab, button) {
    currentTab = tab;
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');

    document.getElementById('searchInput').placeholder =
        tab === 'spelling' ? 'Type a word to find coincidences...' : 'Type IPA pronunciation...';

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
    const searchKey = currentTab === 'spelling' ? query.toLowerCase() : normalizeIpa(query);

    if (searchKey.length < 2) return [];

    const sql = `
        SELECT match_key, languages, gloss_overlap, entries
        FROM ${table}
        WHERE match_key LIKE ?
        ORDER BY languages DESC
        LIMIT 100
    `;

    const result = db.exec(sql, [`%${searchKey}%`]);

    if (result.length === 0) return [];

    const rows = result[0].values;
    const results = [];

    for (const row of rows) {
        try {
            let entries = JSON.parse(row[3]);

            // First, filter by language mode (tier)
            if (languageMode !== 'all') {
                const tierLimit = languageMode === 'top500' ? TOP_500_COUNT : TOP_120_COUNT;
                const allowedLangs = new Set(allLanguagesData.slice(0, tierLimit).map(d => d.lang));
                entries = entries.filter(e => allowedLangs.has(e.lang));
            }

            // Then filter by selected languages if any are explicitly selected
            if (selectedLanguages.length > 0) {
                entries = entries.filter(e => selectedLanguages.includes(e.lang));
            }
            
            // Need at least 2 languages for a coincidence
            if (entries.length < 2) continue;

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

// ==================== EXPLORE MODE FUNCTIONS ====================

function switchMode(mode, button) {
    currentMode = mode;
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    button.classList.add('active');
    
    document.getElementById('searchMode').style.display = mode === 'search' ? 'block' : 'none';
    document.getElementById('exploreMode').style.display = mode === 'explore' ? 'block' : 'none';
    
    if (mode === 'explore' && allLanguagesData.length > 0) {
        renderExploreLanguageList();
    }
}

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
    } else if (exploreLangMode === 'top500') {
        langsToShow = allLanguagesData.slice(0, TOP_500_COUNT);
    } else {
        langsToShow = allLanguagesData.slice(0, TOP_120_COUNT);
    }
    
    // Sort alphabetically
    langsToShow = [...langsToShow].sort((a, b) => a.lang.localeCompare(b.lang));
    
    // Filter by search term
    if (searchTerm) {
        langsToShow = langsToShow.filter(l => l.lang.toLowerCase().includes(searchTerm));
    }
    
    if (langsToShow.length === 0) {
        container.innerHTML = '<div class="no-results">No languages match your search</div>';
        return;
    }
    
    container.innerHTML = langsToShow.map(({ lang, count }) => `
        <label class="explore-lang-item ${exploreSelectedLanguages.includes(lang) ? 'selected' : ''}">
            <input type="checkbox" 
                   ${exploreSelectedLanguages.includes(lang) ? 'checked' : ''}
                   onchange="toggleExploreLanguage('${escapeHtml(lang).replace(/'/g, "\\'")}')">
            <span class="lang-name">${escapeHtml(lang)}</span>
            <span class="lang-count">${count.toLocaleString()}</span>
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
        container.innerHTML = '<span class="no-selection">Select at least 2 languages to find coincidences</span>';
        return;
    }
    
    container.innerHTML = exploreSelectedLanguages.map(lang => `
        <span class="explore-tag">
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
                            results.push({
                                word: matchKey,
                                type: 'spelling',
                                entries: matchingEntries
                            });
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
                            // Check if same words already exist as spelling match
                            const existingIdx = results.findIndex(r => 
                                r.type === 'spelling' && 
                                matchingEntries.some(me => 
                                    r.entries.some(re => re.lang === me.lang && re.word === me.word)
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
                    } catch (e) {}
                }
            }
            
            // Sort by number of matching languages desc, then alphabetically
            results.sort((a, b) => {
                if (b.entries.length !== a.entries.length) {
                    return b.entries.length - a.entries.length;
                }
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
    
    if (results.length === 0) {
        container.innerHTML = '<div class="no-results">No coincidences found for the selected languages</div>';
        return;
    }
    
    const summary = `<div class="explore-summary">Found <strong>${results.length.toLocaleString()}</strong> coincidences between ${exploreSelectedLanguages.join(', ')}</div>`;
    
    const resultsHtml = results.slice(0, 500).map(result => {
        const matchTypeLabel = result.type === 'both' ? 'spelling & pronunciation' 
                             : result.type === 'spelling' ? 'spelling match' 
                             : 'pronunciation match';
        
        const header = result.word 
            ? `<span class="result-word">${escapeHtml(result.word)}</span>`
            : `<span class="result-ipa">/${escapeHtml(result.ipa)}/</span>`;
        
        const ipaDisplay = result.type === 'both' && result.ipa 
            ? `<span class="result-ipa-secondary">/${escapeHtml(result.ipa)}/</span>` 
            : '';
        
        const entriesHtml = result.entries.map(entry => `
            <div class="entry">
                <div class="entry-header">
                    <span class="entry-lang">${escapeHtml(entry.lang)} (${escapeHtml(entry.lang_code || '?')})</span>
                    ${entry.ipa ? `<span class="entry-ipa">${escapeHtml(entry.ipa)}</span>` : ''}
                </div>
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
                    <span class="match-type match-type-${result.type}">${matchTypeLabel}</span>
                </div>
                ${entriesHtml}
            </div>
        `;
    }).join('');
    
    const moreNote = results.length > 500 
        ? `<div class="more-note">Showing first 500 of ${results.length.toLocaleString()} results</div>` 
        : '';
    
    container.innerHTML = summary + resultsHtml + moreNote;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
