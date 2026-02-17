/**
 * Video DownloadHelper — Popup Logic
 * Manages the popup UI, queries background for detected media, handles actions
 */

// ─── DOM References ──────────────────────────────────────────────────────

const mediaListEl = document.getElementById('media-list');
const emptyStateEl = document.getElementById('empty-state');
const loadingStateEl = document.getElementById('loading-state');
const actionMenuEl = document.getElementById('action-menu');

// Toolbar buttons
const btnOpenTab = document.getElementById('btn-open-tab');
const btnDownloadAll = document.getElementById('btn-download-all');
const btnSettings = document.getElementById('btn-settings');
const btnNoVideo = document.getElementById('btn-no-video');
const btnHistory = document.getElementById('btn-history');
const btnClear = document.getElementById('btn-clear');
const btnForceDetect = document.getElementById('btn-force-detect');

// State
let currentTabId = null;
let currentMedia = [];
let activeMenuMediaId = null;

// ─── Icons (SVG strings) ────────────────────────────────────────────────

const ICONS = {
    video: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <polygon points="23 7 16 12 23 17 23 7"/>
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
  </svg>`,
    audio: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M9 18V5l12-2v13"/>
    <circle cx="6" cy="18" r="3"/>
    <circle cx="18" cy="16" r="3"/>
  </svg>`,
    hls: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <polygon points="5 3 19 12 5 21 5 3"/>
  </svg>`,
    dash: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <polygon points="5 3 19 12 5 21 5 3"/>
  </svg>`,
    download: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>`,
    more: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="1"/>
    <circle cx="19" cy="12" r="1"/>
    <circle cx="5" cy="12" r="1"/>
  </svg>`,
    check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
    <polyline points="20 6 9 17 4 12"/>
  </svg>`
};

// ─── Initialization ──────────────────────────────────────────────────────

async function init() {
    showLoading(true);

    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
        showLoading(false);
        showEmpty(true);
        return;
    }
    currentTabId = tab.id;

    // Apply theme
    applyTheme();

    // Load media
    await loadMedia();

    // Apply i18n
    applyI18n();

    // Set up event listeners
    setupEventListeners();

    // Poll for new media every 2s
    setInterval(loadMedia, 2000);
}

async function loadMedia() {
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'getMedia',
            tabId: currentTabId
        });

        if (response && response.media) {
            const newCount = response.media.length;
            const oldCount = currentMedia.length;

            currentMedia = response.media;

            if (newCount !== oldCount) {
                renderMediaList();
            }
        }
    } catch (e) {
        console.error('[VDH Popup] Failed to load media:', e);
    }
}

// ─── Rendering ───────────────────────────────────────────────────────────

function renderMediaList() {
    showLoading(false);

    if (currentMedia.length === 0) {
        showEmpty(true);
        mediaListEl.innerHTML = '';
        btnDownloadAll.disabled = true;
        return;
    }

    showEmpty(false);
    btnDownloadAll.disabled = false;

    // Build entries HTML
    const html = currentMedia.map((media, index) => {
        const icon = ICONS[media.type] || ICONS.video;
        const typeClass = `type-${media.type}`;

        // Build meta tags
        const tags = [];

        if (media.resolution) {
            tags.push(`<span class="media-tag tag-resolution">${esc(media.resolution)}</span>`);
        }

        if (media.format) {
            tags.push(`<span class="media-tag tag-format">${esc(media.format)}</span>`);
        }

        if (media.type === 'hls' || media.type === 'dash') {
            tags.push(`<span class="media-tag tag-type">${esc(media.type)}</span>`);
        }

        if (media.sizeFormatted) {
            tags.push(`<span class="media-tag tag-size">${esc(media.sizeFormatted)}</span>`);
        }

        if (media.bandwidthFormatted) {
            tags.push(`<span class="media-tag tag-size">${esc(media.bandwidthFormatted)}</span>`);
        }

        if (media.duration) {
            const dur = formatDuration(media.duration);
            tags.push(`<span class="media-tag tag-duration">${dur}</span>`);
        }

        // Status badge
        let statusBadge = '';
        if (media.status === 'downloading') {
            statusBadge = `<span class="status-badge status-downloading">Downloading</span>`;
        } else if (media.status === 'completed') {
            statusBadge = `<span class="status-badge status-completed">Done</span>`;
        } else if (media.status === 'error') {
            statusBadge = `<span class="status-badge status-error">Failed</span>`;
        }

        // Download button state
        let dlBtnClass = 'btn-download';
        let dlBtnIcon = ICONS.download;
        if (media.status === 'downloading') {
            dlBtnClass += ' downloading';
        } else if (media.status === 'completed') {
            dlBtnClass += ' completed';
            dlBtnIcon = ICONS.check;
        }

        // Title: prefer page title, fall back to URL
        const title = media.pageTitle || extractFilename(media.url);

        return `
      <div class="media-entry" data-id="${esc(media.id)}" data-index="${index}">
        <div class="media-icon ${typeClass}">${icon}</div>
        <div class="media-info">
          <div class="media-title" title="${esc(title)}">${esc(title)}</div>
          <div class="media-meta">
            ${tags.join('<span class="sep"></span>')}
            ${statusBadge}
          </div>
        </div>
        <div class="media-actions">
          <button class="${dlBtnClass}" data-action="download" data-id="${esc(media.id)}" title="Download">
            ${dlBtnIcon}
          </button>
          <button class="btn-more" data-action="more" data-id="${esc(media.id)}" title="More actions">
            ${ICONS.more}
          </button>
        </div>
      </div>
      ${media.variants && media.variants.length > 1 ? renderVariants(media) : ''}
    `;
    }).join('');

    mediaListEl.innerHTML = html;
}

function renderVariants(media) {
    const variantHtml = media.variants.map(v => `
    <div class="variant-item" data-url="${esc(v.url)}" data-media-id="${esc(media.id)}">
      <div class="variant-info">
        <span class="variant-resolution">${esc(v.resolution || 'Unknown')}</span>
        <span class="variant-bandwidth">${esc(v.bandwidthFormatted || '')}</span>
      </div>
      <button class="btn-download variant-download" data-action="download-variant" 
              data-url="${esc(v.url)}" data-resolution="${esc(v.resolution)}" title="Download this quality">
        ${ICONS.download}
      </button>
    </div>
  `).join('');

    return `<div class="variant-list">${variantHtml}</div>`;
}

// ─── Event Handlers ──────────────────────────────────────────────────────

function setupEventListeners() {
    // Media list click delegation
    mediaListEl.addEventListener('click', handleMediaClick);

    // Toolbar buttons
    btnOpenTab.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') });
    });

    btnDownloadAll.addEventListener('click', downloadAll);

    btnSettings.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
    });

    btnNoVideo.addEventListener('click', () => {
        showToast('Start the video on the page and wait for detection', 'info');
    });

    btnHistory.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html#history') });
    });

    btnClear.addEventListener('click', clearMedia);

    btnForceDetect.addEventListener('click', forceDetect);

    // Close action menu on outside click
    document.addEventListener('click', (e) => {
        if (!actionMenuEl.contains(e.target) && !e.target.closest('[data-action="more"]')) {
            hideActionMenu();
        }
    });

    // Action menu items
    actionMenuEl.addEventListener('click', handleActionMenuClick);
}

function handleMediaClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;

    switch (action) {
        case 'download':
            downloadMedia(id);
            break;
        case 'more':
            showActionMenu(btn, id);
            break;
        case 'download-variant': {
            const url = btn.dataset.url;
            const resolution = btn.dataset.resolution;
            downloadVariant(url, resolution);
            break;
        }
    }
}

function handleActionMenuClick(e) {
    const item = e.target.closest('.action-item');
    if (!item) return;

    const action = item.dataset.action;
    const media = currentMedia.find(m => m.id === activeMenuMediaId);
    if (!media) return;

    switch (action) {
        case 'download':
            downloadMedia(media.id);
            break;
        case 'copy-url':
            copyToClipboard(media.url);
            showToast('URL copied to clipboard', 'success');
            break;
        case 'play':
            chrome.tabs.create({ url: media.url });
            break;
        case 'details':
            showToast(`${media.type.toUpperCase()} • ${media.format} • ${media.resolution || 'N/A'}`, 'info');
            break;
    }

    hideActionMenu();
}

// ─── Actions ─────────────────────────────────────────────────────────────

async function downloadMedia(id) {
    const media = currentMedia.find(m => m.id === id);
    if (!media) return;

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'download',
            url: media.url,
            tabId: currentTabId,
            pageTitle: media.pageTitle,
            format: media.format,
            resolution: media.resolution
        });

        if (response.success) {
            media.status = 'downloading';
            renderMediaList();
            showToast('Download started', 'success');
        } else {
            showToast(`Download failed: ${response.error}`, 'error');
        }
    } catch (e) {
        showToast('Download failed', 'error');
    }
}

async function downloadVariant(url, resolution) {
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'downloadVariant',
            url,
            tabId: currentTabId,
            pageTitle: currentMedia[0]?.pageTitle || 'video',
            format: 'mp4',
            resolution
        });

        if (response.success) {
            showToast(`Downloading ${resolution}`, 'success');
        } else {
            showToast(`Failed: ${response.error}`, 'error');
        }
    } catch (e) {
        showToast('Download failed', 'error');
    }
}

async function downloadAll() {
    for (const media of currentMedia) {
        if (media.status !== 'downloading' && media.status !== 'completed') {
            await downloadMedia(media.id);
            // Small delay between downloads
            await new Promise(r => setTimeout(r, 300));
        }
    }
}

async function clearMedia() {
    try {
        await chrome.runtime.sendMessage({
            action: 'clearMedia',
            tabId: currentTabId
        });
        currentMedia = [];
        renderMediaList();
        showToast('Cleared', 'success');
    } catch (e) {
        console.error('[VDH Popup] Clear failed:', e);
    }
}

async function forceDetect() {
    // Reload the current tab to re-trigger detection
    try {
        await chrome.tabs.reload(currentTabId);
        showToast('Reloading page for detection…', 'info');
        window.close();
    } catch (e) {
        showToast('Failed to reload', 'error');
    }
}

// ─── Action Menu ─────────────────────────────────────────────────────────

function showActionMenu(button, mediaId) {
    activeMenuMediaId = mediaId;
    actionMenuEl.hidden = false;

    const btnRect = button.getBoundingClientRect();
    const menuWidth = 160;

    let left = btnRect.right - menuWidth;
    let top = btnRect.bottom + 4;

    // Keep menu in viewport
    if (left < 4) left = 4;
    if (top + 180 > window.innerHeight) {
        top = btnRect.top - 180;
    }

    actionMenuEl.style.left = `${left}px`;
    actionMenuEl.style.top = `${top}px`;
}

function hideActionMenu() {
    actionMenuEl.hidden = true;
    activeMenuMediaId = null;
}

// ─── UI Helpers ──────────────────────────────────────────────────────────

function showLoading(show) {
    loadingStateEl.classList.toggle('visible', show);
    if (show) {
        emptyStateEl.classList.remove('visible');
        mediaListEl.style.display = 'none';
    }
}

function showEmpty(show) {
    emptyStateEl.classList.toggle('visible', show);
    mediaListEl.style.display = show ? 'none' : '';
}

async function applyTheme() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
        if (response?.settings?.theme === 'light') {
            document.body.classList.add('theme-light');
        } else if (response?.settings?.theme === 'system') {
            if (window.matchMedia('(prefers-color-scheme: light)').matches) {
                document.body.classList.add('theme-light');
            }
        }
    } catch { /* default dark */ }
}

function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        const msg = chrome.i18n.getMessage(key);
        if (msg) el.textContent = msg;
    });
}

// ─── Toast ───────────────────────────────────────────────────────────────

let toastTimeout = null;

function showToast(message, type = 'info') {
    // Remove existing toast
    let toast = document.querySelector('.toast');
    if (toast) toast.remove();

    toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('visible');
    });

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// ─── Utility ─────────────────────────────────────────────────────────────

function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function extractFilename(url) {
    try {
        const pathname = new URL(url).pathname;
        const parts = pathname.split('/');
        return decodeURIComponent(parts[parts.length - 1]) || url;
    } catch {
        return url?.substring(0, 50) || 'Unknown';
    }
}

function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        // Fallback
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
    }
}

// ─── Boot ────────────────────────────────────────────────────────────────
init();
