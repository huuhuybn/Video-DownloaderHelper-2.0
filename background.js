/**
 * Video DownloadHelper — Background Service Worker
 * Core video detection engine via network request monitoring
 */
import {
    classifyUrl, parseHlsMaster, parseDashMpd, isHlsMasterPlaylist,
    formatSize, formatBandwidth, getResolutionLabel
} from './utils/parser.js';
import { generateFilename } from './utils/filename.js';

// ─── State ───────────────────────────────────────────────────────────────────

/** @type {Map<number, Array<DetectedMedia>>} Tab ID → detected media list */
const tabMedia = new Map();

/** @type {Map<string, boolean>} Deduplicate URLs per tab: "tabId:url" → true */
const seenUrls = new Map();

/** Default settings */
const DEFAULT_SETTINGS = {
    defaultAction: 'download',
    filenameTemplate: '',
    showNotifications: true,
    theme: 'dark',
    downloadSubdir: '',
    maxConcurrent: 3,
    minFileSize: 100 * 1024, // 100KB minimum
    excludedDomains: [],
    preferredQuality: '1080p',
    showContextMenu: true,
    historyEnabled: false,
    historyDays: 30
};

// ─── Initialization ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
    console.log('[VDH] Extension installed/updated:', details.reason);

    // Initialize settings
    chrome.storage.local.get('settings', (result) => {
        if (!result.settings) {
            chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
        }
    });

    // Create context menu
    setupContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
    console.log('[VDH] Service worker started');
    setupContextMenu();
});

// ─── Context Menu ────────────────────────────────────────────────────────────

function setupContextMenu() {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: 'vdh-download-link',
            title: chrome.i18n.getMessage('download_button') || 'Download with VDH',
            contexts: ['link', 'video', 'audio']
        });
    });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'vdh-download-link') {
        const url = info.srcUrl || info.linkUrl;
        if (url) {
            handleDownload({
                url,
                tabId: tab.id,
                pageTitle: tab.title
            });
        }
    }
});

// ─── Network Request Monitoring ──────────────────────────────────────────────

chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        // Skip extension's own requests, data URLs, etc.
        if (details.tabId < 0) return;
        if (details.url.startsWith('chrome-extension://')) return;
        if (details.url.startsWith('data:')) return;

        handleNetworkRequest(details);
    },
    { urls: ['<all_urls>'] }
);

// Also monitor response headers for content-type based detection
chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
        if (details.tabId < 0) return;
        if (details.url.startsWith('chrome-extension://')) return;

        const contentTypeHeader = details.responseHeaders?.find(
            h => h.name.toLowerCase() === 'content-type'
        );
        const contentLengthHeader = details.responseHeaders?.find(
            h => h.name.toLowerCase() === 'content-length'
        );

        if (contentTypeHeader) {
            const contentType = contentTypeHeader.value;
            const contentLength = contentLengthHeader ? parseInt(contentLengthHeader.value, 10) : 0;

            handleNetworkRequest({
                ...details,
                contentType,
                contentLength
            });
        }
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders']
);

async function handleNetworkRequest(details) {
    const { url, tabId, contentType, contentLength } = details;

    // Classify the URL
    const classification = classifyUrl(url, contentType);
    if (!classification) return;

    // Dedup check
    const dedupeKey = `${tabId}:${url}`;
    if (seenUrls.has(dedupeKey)) return;
    seenUrls.set(dedupeKey, true);

    // Check minimum file size for direct media
    if (classification.type === 'video' || classification.type === 'audio') {
        const settings = await getSettings();
        if (contentLength && contentLength < settings.minFileSize) return;
    }

    // Get page title from tab
    let pageTitle = '';
    try {
        const tab = await chrome.tabs.get(tabId);
        pageTitle = tab.title || '';
    } catch { /* tab may be gone */ }

    // Build media entry
    const media = {
        id: crypto.randomUUID(),
        url,
        type: classification.type, // 'video', 'audio', 'hls', 'dash'
        format: classification.format,
        pageTitle,
        tabId,
        timestamp: Date.now(),
        size: contentLength || 0,
        sizeFormatted: formatSize(contentLength),
        resolution: '',
        width: 0,
        height: 0,
        duration: 0,
        bandwidth: 0,
        bandwidthFormatted: '',
        variants: [],
        status: 'detected' // detected, downloading, completed, error
    };

    // For HLS streams, try to fetch and parse the master playlist
    if (classification.type === 'hls') {
        try {
            const response = await fetch(url);
            const content = await response.text();

            if (isHlsMasterPlaylist(content)) {
                const variants = parseHlsMaster(content, url);
                if (variants.length > 0) {
                    // Use the best quality variant as the main entry
                    const best = variants[0];
                    media.resolution = getResolutionLabel(best.width, best.height);
                    media.width = best.width;
                    media.height = best.height;
                    media.bandwidth = best.bandwidth;
                    media.bandwidthFormatted = formatBandwidth(best.bandwidth);
                    media.url = best.url; // Point to the best variant
                    media.variants = variants.map(v => ({
                        url: v.url,
                        resolution: getResolutionLabel(v.width, v.height),
                        width: v.width,
                        height: v.height,
                        bandwidth: v.bandwidth,
                        bandwidthFormatted: formatBandwidth(v.bandwidth)
                    }));
                }
            }
        } catch (e) {
            console.warn('[VDH] Failed to parse HLS playlist:', e);
        }
    }

    // Store the media entry
    if (!tabMedia.has(tabId)) {
        tabMedia.set(tabId, []);
    }
    tabMedia.get(tabId).push(media);

    // Update icon state
    updateIcon(tabId);

    console.log(`[VDH] Detected ${classification.type}: ${url.substring(0, 80)}...`);
}

// ─── Icon State Management ───────────────────────────────────────────────────

function updateIcon(tabId) {
    const mediaList = tabMedia.get(tabId) || [];
    const count = mediaList.length;

    if (count > 0) {
        // Active state: colored icon + badge
        chrome.action.setIcon({
            tabId,
            path: {
                16: 'icons/icon-active-16.png',
                32: 'icons/icon-active-32.png',
                48: 'icons/icon-active-48.png'
            }
        }).catch(() => { });

        chrome.action.setBadgeText({ tabId, text: String(count) });
        chrome.action.setBadgeBackgroundColor({ tabId, color: '#4CAF50' });
    } else {
        // Inactive state: default icon, no badge
        chrome.action.setIcon({
            tabId,
            path: {
                16: 'icons/icon-16.png',
                32: 'icons/icon-32.png',
                48: 'icons/icon-48.png'
            }
        }).catch(() => { });

        chrome.action.setBadgeText({ tabId, text: '' });
    }
}

// ─── Tab Lifecycle ───────────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
    tabMedia.delete(tabId);
    // Clean up dedup keys for this tab
    for (const key of seenUrls.keys()) {
        if (key.startsWith(`${tabId}:`)) {
            seenUrls.delete(key);
        }
    }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
        // Clear media on navigation
        tabMedia.set(tabId, []);
        // Clear dedup keys
        for (const key of seenUrls.keys()) {
            if (key.startsWith(`${tabId}:`)) {
                seenUrls.delete(key);
            }
        }
        updateIcon(tabId);
    }
});

// ─── Message Handling (Popup ↔ Background) ────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case 'getMedia': {
            const media = tabMedia.get(message.tabId) || [];
            sendResponse({ media });
            break;
        }

        case 'download': {
            handleDownload(message).then(result => sendResponse(result));
            return true; // async response
        }

        case 'downloadVariant': {
            handleDownload({
                url: message.url,
                tabId: message.tabId,
                pageTitle: message.pageTitle,
                format: message.format,
                resolution: message.resolution
            }).then(result => sendResponse(result));
            return true;
        }

        case 'copyUrl': {
            // Content script will handle clipboard
            sendResponse({ success: true, url: message.url });
            break;
        }

        case 'getSettings': {
            getSettings().then(settings => sendResponse({ settings }));
            return true;
        }

        case 'saveSettings': {
            chrome.storage.local.set({ settings: message.settings }, () => {
                sendResponse({ success: true });
            });
            return true;
        }

        case 'clearMedia': {
            tabMedia.set(message.tabId, []);
            for (const key of seenUrls.keys()) {
                if (key.startsWith(`${message.tabId}:`)) {
                    seenUrls.delete(key);
                }
            }
            updateIcon(message.tabId);
            sendResponse({ success: true });
            break;
        }

        case 'mediaFromContent': {
            // Receive media info from content script
            handleContentMedia(message.media, sender.tab);
            sendResponse({ success: true });
            break;
        }

        default:
            sendResponse({ error: 'Unknown action' });
    }
});

// ─── Download Handler ────────────────────────────────────────────────────────

async function handleDownload({ url, tabId, pageTitle, format, resolution }) {
    try {
        const settings = await getSettings();

        const filename = generateFilename({
            pageTitle: pageTitle || 'video',
            videoUrl: url,
            format: format || 'mp4',
            resolution: resolution || ''
        });

        const downloadOptions = {
            url,
            filename: settings.downloadSubdir
                ? `${settings.downloadSubdir}/${filename}`
                : filename,
            conflictAction: 'uniquify'
        };

        const downloadId = await chrome.downloads.download(downloadOptions);

        // Show notification if enabled
        if (settings.showNotifications) {
            chrome.notifications.create(`vdh-dl-${downloadId}`, {
                type: 'basic',
                iconUrl: 'icons/icon-128.png',
                title: chrome.i18n.getMessage('download_button') || 'Download Started',
                message: filename
            });
        }

        // Update media status
        const mediaList = tabMedia.get(tabId) || [];
        const mediaItem = mediaList.find(m => m.url === url);
        if (mediaItem) {
            mediaItem.status = 'downloading';
            mediaItem.downloadId = downloadId;
        }

        // Track download history
        if (settings.historyEnabled) {
            addToHistory({ url, filename, pageTitle, timestamp: Date.now() });
        }

        return { success: true, downloadId };
    } catch (error) {
        console.error('[VDH] Download error:', error);
        return { success: false, error: error.message };
    }
}

// Monitor download completion
chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state) {
        if (delta.state.current === 'complete') {
            // Find and update the media item
            for (const [tabId, mediaList] of tabMedia.entries()) {
                const item = mediaList.find(m => m.downloadId === delta.id);
                if (item) {
                    item.status = 'completed';
                    break;
                }
            }
        } else if (delta.state.current === 'interrupted') {
            for (const [tabId, mediaList] of tabMedia.entries()) {
                const item = mediaList.find(m => m.downloadId === delta.id);
                if (item) {
                    item.status = 'error';
                    break;
                }
            }
        }
    }
});

// ─── Content Script Media ────────────────────────────────────────────────────

function handleContentMedia(mediaInfo, tab) {
    if (!tab || !tab.id) return;

    const tabId = tab.id;
    const dedupeKey = `${tabId}:${mediaInfo.url}`;
    if (seenUrls.has(dedupeKey)) return;
    seenUrls.set(dedupeKey, true);

    const media = {
        id: crypto.randomUUID(),
        url: mediaInfo.url,
        type: mediaInfo.type || 'video',
        format: mediaInfo.format || 'mp4',
        pageTitle: tab.title || '',
        tabId,
        timestamp: Date.now(),
        size: 0,
        sizeFormatted: '',
        resolution: mediaInfo.resolution || '',
        width: mediaInfo.width || 0,
        height: mediaInfo.height || 0,
        duration: mediaInfo.duration || 0,
        bandwidth: 0,
        bandwidthFormatted: '',
        variants: [],
        status: 'detected',
        source: 'dom' // detected from DOM element
    };

    if (!tabMedia.has(tabId)) {
        tabMedia.set(tabId, []);
    }
    tabMedia.get(tabId).push(media);
    updateIcon(tabId);
}

// ─── Download History ────────────────────────────────────────────────────────

async function addToHistory(entry) {
    const result = await chrome.storage.local.get('history');
    const history = result.history || [];
    history.unshift(entry);
    // Limit history
    if (history.length > 500) {
        history.length = 500;
    }
    await chrome.storage.local.set({ history });
}

// ─── Settings Helper ─────────────────────────────────────────────────────────

async function getSettings() {
    const result = await chrome.storage.local.get('settings');
    return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
}

console.log('[VDH] Service worker loaded');
