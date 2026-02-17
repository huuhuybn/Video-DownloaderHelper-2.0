/**
 * Video DownloadHelper — Settings Logic
 */

const DEFAULT_SETTINGS = {
    defaultAction: 'download',
    filenameTemplate: '',
    showNotifications: true,
    theme: 'dark',
    downloadSubdir: '',
    maxConcurrent: 3,
    minFileSize: 102400,
    excludedDomains: [],
    preferredQuality: '1080p',
    showContextMenu: true,
    historyEnabled: false,
    historyDays: 30
};

let settings = { ...DEFAULT_SETTINGS };

// ─── Initialization ──────────────────────────────────────────────────────

async function init() {
    await loadSettings();
    populateUI();
    setupNavigation();
    setupEventListeners();
    applyI18n();
    loadHistory();

    // Check hash for direct section navigation
    const hash = window.location.hash.replace('#', '');
    if (hash) navigateToSection(hash);
}

async function loadSettings() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
        if (response?.settings) {
            settings = { ...DEFAULT_SETTINGS, ...response.settings };
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

function populateUI() {
    // General
    document.getElementById('set-quality').value = settings.preferredQuality;
    document.getElementById('set-default-action').value = settings.defaultAction;
    document.getElementById('set-filename-template').value = settings.filenameTemplate || '';
    document.getElementById('set-context-menu').checked = settings.showContextMenu;
    document.getElementById('set-notifications').checked = settings.showNotifications;

    // Downloads
    document.getElementById('set-subdir').value = settings.downloadSubdir || '';
    document.getElementById('set-max-concurrent').value = String(settings.maxConcurrent);
    document.getElementById('set-min-size').value = String(settings.minFileSize);

    // History
    document.getElementById('set-history-enabled').checked = settings.historyEnabled;
    document.getElementById('set-history-days').value = String(settings.historyDays);

    // Appearance
    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === settings.theme);
    });

    // Version
    const manifest = chrome.runtime.getManifest();
    document.getElementById('version').textContent = manifest.version;
    document.getElementById('about-version').textContent = manifest.version;
}

// ─── Navigation ──────────────────────────────────────────────────────────

function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navigateToSection(item.dataset.section);
        });
    });
}

function navigateToSection(sectionId) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.setting-section').forEach(s => s.classList.remove('active'));

    const navItem = document.querySelector(`[data-section="${sectionId}"]`);
    const section = document.getElementById(`section-${sectionId}`);

    if (navItem) navItem.classList.add('active');
    if (section) section.classList.add('active');
}

// ─── Event Listeners ─────────────────────────────────────────────────────

function setupEventListeners() {
    // Auto-save on change for select/input/checkbox
    const autoSaveElements = [
        'set-quality', 'set-default-action', 'set-filename-template',
        'set-context-menu', 'set-notifications', 'set-subdir',
        'set-max-concurrent', 'set-min-size', 'set-history-enabled', 'set-history-days'
    ];

    autoSaveElements.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const event = el.type === 'checkbox' ? 'change' : 'input';
        el.addEventListener(event, debounce(saveSettings, 500));
    });

    // Theme selector
    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            settings.theme = btn.dataset.theme;
            saveSettings();
        });
    });

    // Size selector
    document.querySelectorAll('.size-option').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.size-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            saveSettings();
        });
    });

    // Clear history
    document.getElementById('btn-clear-history')?.addEventListener('click', async () => {
        await chrome.storage.local.set({ history: [] });
        loadHistory();
    });

    // Reset settings
    document.getElementById('btn-reset-settings')?.addEventListener('click', async () => {
        if (confirm('Reset all settings to defaults?')) {
            settings = { ...DEFAULT_SETTINGS };
            await saveSettings();
            populateUI();
        }
    });

    // Reload addon
    document.getElementById('btn-reload-addon')?.addEventListener('click', () => {
        chrome.runtime.reload();
    });
}

// ─── Save/Load ───────────────────────────────────────────────────────────

async function saveSettings() {
    settings.preferredQuality = document.getElementById('set-quality').value;
    settings.defaultAction = document.getElementById('set-default-action').value;
    settings.filenameTemplate = document.getElementById('set-filename-template').value;
    settings.showContextMenu = document.getElementById('set-context-menu').checked;
    settings.showNotifications = document.getElementById('set-notifications').checked;
    settings.downloadSubdir = document.getElementById('set-subdir').value;
    settings.maxConcurrent = parseInt(document.getElementById('set-max-concurrent').value, 10);
    settings.minFileSize = parseInt(document.getElementById('set-min-size').value, 10);
    settings.historyEnabled = document.getElementById('set-history-enabled').checked;
    settings.historyDays = parseInt(document.getElementById('set-history-days').value, 10);

    try {
        await chrome.runtime.sendMessage({ action: 'saveSettings', settings });
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

// ─── History ─────────────────────────────────────────────────────────────

async function loadHistory() {
    const result = await chrome.storage.local.get('history');
    const history = result.history || [];
    const listEl = document.getElementById('history-list');

    if (history.length === 0) {
        listEl.innerHTML = `<p class="history-empty">${chrome.i18n.getMessage('no_downloads_yet') || 'No entries yet.'}</p>`;
        return;
    }

    listEl.innerHTML = history.slice(0, 50).map(item => `
    <div class="history-item">
      <span class="history-item-title" title="${esc(item.filename)}">${esc(item.filename)}</span>
      <span class="history-item-date">${new Date(item.timestamp).toLocaleDateString()}</span>
    </div>
  `).join('');
}

// ─── i18n ────────────────────────────────────────────────────────────────

function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const msg = chrome.i18n.getMessage(el.dataset.i18n);
        if (msg) el.textContent = msg;
    });
}

// ─── Utilities ───────────────────────────────────────────────────────────

function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ─── Boot ────────────────────────────────────────────────────────────────
init();
