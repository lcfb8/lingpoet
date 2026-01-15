let db = null;
let currentTab = 'spelling';
let searchTimeout;
let selectedLanguages = [];
let showAllLanguages = false;
let allLanguagesData = [];  // { lang, count } sorted by count desc
const TOP_LANGUAGES_COUNT = 570;

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
            document.getElementById('languageFilter').innerHTML = '<em>No languages found</em>';
            return;
        }

        renderLanguageFilter();
    } catch (error) {
        console.error('Error loading languages:', error);
        document.getElementById('languageFilter').innerHTML = '<em>Error loading languages</em>';
    }
}

function renderLanguageFilter() {
    const container = document.getElementById('languageFilter');
    const langsToShow = showAllLanguages 
        ? allLanguagesData 
        : allLanguagesData.slice(0, TOP_LANGUAGES_COUNT);
    
    // Sort displayed languages alphabetically for easier browsing
    const sortedLangs = [...langsToShow].sort((a, b) => a.lang.localeCompare(b.lang));

    container.innerHTML = sortedLangs.map(({ lang }) => `
        <label>
            <input type="checkbox" value="${escapeHtml(lang)}" 
                   onchange="toggleLanguage(this)"
                   ${selectedLanguages.includes(lang) ? 'checked' : ''}>
            ${escapeHtml(lang)}
        </label>
    `).join('');
}

function toggleAllLanguages() {
    showAllLanguages = !showAllLanguages;
    const btn = document.getElementById('toggleAllLangsBtn');
    if (showAllLanguages) {
        btn.textContent = `Show top ${TOP_LANGUAGES_COUNT} languages`;
        btn.classList.add('showing-all');
    } else {
        btn.textContent = `Show all ${allLanguagesData.length} languages`;
        btn.classList.remove('showing-all');
    }
    renderLanguageFilter();
}

function toggleLanguage(checkbox) {
    if (checkbox.checked) {
        selectedLanguages.push(checkbox.value);
    } else {
        selectedLanguages = selectedLanguages.filter(l => l !== checkbox.value);
    }
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

            // Filter by selected languages if any
            if (selectedLanguages.length > 0) {
                entries = entries.filter(e => selectedLanguages.includes(e.lang));
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize when page loads
window.addEventListener('DOMContentLoaded', initDatabase);
