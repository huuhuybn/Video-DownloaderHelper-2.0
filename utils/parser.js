/**
 * Video DownloadHelper — Media Parser Utilities
 * Handles HLS, DASH, and direct media URL detection/parsing
 */

// ─── File Extension Patterns ────────────────────────────────────────────────

const VIDEO_EXTENSIONS = /\.(mp4|webm|mkv|flv|avi|mov|wmv|m4v|3gp|ts)(\?|$)/i;
const AUDIO_EXTENSIONS = /\.(mp3|aac|ogg|wav|m4a|flac|wma|opus)(\?|$)/i;
const HLS_PATTERN = /\.m3u8(\?|$)/i;
const DASH_PATTERN = /\.mpd(\?|$)/i;

// Content-Type patterns
const VIDEO_CONTENT_TYPES = [
    'video/mp4', 'video/webm', 'video/x-matroska', 'video/x-flv',
    'video/avi', 'video/quicktime', 'video/x-ms-wmv', 'video/3gpp',
    'video/mp2t', 'video/x-m4v'
];
const AUDIO_CONTENT_TYPES = [
    'audio/mpeg', 'audio/aac', 'audio/ogg', 'audio/wav',
    'audio/mp4', 'audio/flac', 'audio/x-ms-wma', 'audio/opus'
];
const HLS_CONTENT_TYPES = [
    'application/vnd.apple.mpegurl', 'application/x-mpegurl',
    'audio/mpegurl', 'audio/x-mpegurl'
];
const DASH_CONTENT_TYPES = [
    'application/dash+xml', 'video/vnd.mpeg.dash.mpd'
];

// ─── URL Classification ─────────────────────────────────────────────────────

/**
 * Classify a URL by its media type
 * @param {string} url - The URL to classify
 * @param {string} [contentType] - Optional Content-Type header
 * @returns {{ type: string, format: string } | null}
 */
export function classifyUrl(url, contentType) {
    // Check content type first (more reliable)
    if (contentType) {
        const ct = contentType.toLowerCase().split(';')[0].trim();
        if (HLS_CONTENT_TYPES.includes(ct)) {
            return { type: 'hls', format: 'm3u8' };
        }
        if (DASH_CONTENT_TYPES.includes(ct)) {
            return { type: 'dash', format: 'mpd' };
        }
        if (VIDEO_CONTENT_TYPES.includes(ct)) {
            const ext = extractExtension(url) || ct.split('/')[1];
            return { type: 'video', format: ext };
        }
        if (AUDIO_CONTENT_TYPES.includes(ct)) {
            const ext = extractExtension(url) || ct.split('/')[1];
            return { type: 'audio', format: ext };
        }
    }

    // Fall back to URL pattern matching
    if (HLS_PATTERN.test(url)) {
        return { type: 'hls', format: 'm3u8' };
    }
    if (DASH_PATTERN.test(url)) {
        return { type: 'dash', format: 'mpd' };
    }
    if (VIDEO_EXTENSIONS.test(url)) {
        return { type: 'video', format: extractExtension(url) };
    }
    if (AUDIO_EXTENSIONS.test(url)) {
        return { type: 'audio', format: extractExtension(url) };
    }

    return null;
}

/**
 * Extract file extension from URL
 */
function extractExtension(url) {
    try {
        const pathname = new URL(url).pathname;
        const match = pathname.match(/\.([a-z0-9]+)$/i);
        return match ? match[1].toLowerCase() : null;
    } catch {
        return null;
    }
}

// ─── HLS Parser ──────────────────────────────────────────────────────────────

/**
 * Parse an HLS m3u8 master playlist to extract variant streams
 * @param {string} content - The m3u8 playlist content
 * @param {string} baseUrl - The base URL for resolving relative paths
 * @returns {Array<{ url: string, bandwidth: number, resolution: string, width: number, height: number }>}
 */
export function parseHlsMaster(content, baseUrl) {
    const variants = [];
    const lines = content.split('\n').map(l => l.trim()).filter(l => l);

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
            const attrs = parseAttributes(lines[i].substring('#EXT-X-STREAM-INF:'.length));
            const url = i + 1 < lines.length ? resolveUrl(lines[i + 1], baseUrl) : null;

            if (url && !url.startsWith('#')) {
                const resolution = attrs.RESOLUTION || '';
                const [width, height] = resolution.split('x').map(Number);

                variants.push({
                    url,
                    bandwidth: parseInt(attrs.BANDWIDTH, 10) || 0,
                    resolution: resolution || 'unknown',
                    width: width || 0,
                    height: height || 0,
                    codecs: attrs.CODECS || ''
                });
            }
        }
    }

    // Sort by bandwidth descending (best quality first)
    variants.sort((a, b) => b.bandwidth - a.bandwidth);
    return variants;
}

/**
 * Check if content is an HLS master playlist (vs media playlist)
 */
export function isHlsMasterPlaylist(content) {
    return content.includes('#EXT-X-STREAM-INF:');
}

// ─── DASH Parser ─────────────────────────────────────────────────────────────

/**
 * Parse a DASH MPD manifest to extract representations
 * @param {string} xmlContent - The MPD XML content
 * @param {string} baseUrl - The base URL for resolving relative paths
 * @returns {Array<{ url: string, bandwidth: number, resolution: string, width: number, height: number, mimeType: string, codecs: string }>}
 */
export function parseDashMpd(xmlContent, baseUrl) {
    const representations = [];

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlContent, 'text/xml');

        const adaptationSets = doc.querySelectorAll('AdaptationSet');

        for (const as of adaptationSets) {
            const mimeType = as.getAttribute('mimeType') || '';
            const contentType = as.getAttribute('contentType') || '';
            const isVideo = mimeType.startsWith('video') || contentType === 'video';
            const isAudio = mimeType.startsWith('audio') || contentType === 'audio';

            const reps = as.querySelectorAll('Representation');

            for (const rep of reps) {
                const repMime = rep.getAttribute('mimeType') || mimeType;
                const bandwidth = parseInt(rep.getAttribute('bandwidth'), 10) || 0;
                const width = parseInt(rep.getAttribute('width'), 10) || 0;
                const height = parseInt(rep.getAttribute('height'), 10) || 0;
                const codecs = rep.getAttribute('codecs') || as.getAttribute('codecs') || '';

                // Try to find the base URL for this representation
                const baseUrlElem = rep.querySelector('BaseURL') || as.querySelector('BaseURL') || doc.querySelector('BaseURL');
                const url = baseUrlElem ? resolveUrl(baseUrlElem.textContent.trim(), baseUrl) : baseUrl;

                representations.push({
                    url,
                    bandwidth,
                    resolution: width && height ? `${width}x${height}` : 'unknown',
                    width,
                    height,
                    mimeType: repMime,
                    codecs,
                    type: isVideo ? 'video' : isAudio ? 'audio' : 'unknown'
                });
            }
        }
    } catch (e) {
        console.error('[VDH] DASH parse error:', e);
    }

    representations.sort((a, b) => b.bandwidth - a.bandwidth);
    return representations;
}

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Parse HLS/DASH attribute string like: BANDWIDTH=1280000,RESOLUTION=720x480
 */
function parseAttributes(attrString) {
    const attrs = {};
    // Match key=value, where value can be quoted
    const regex = /([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g;
    let match;
    while ((match = regex.exec(attrString)) !== null) {
        attrs[match[1]] = match[2] !== undefined ? match[2] : match[3];
    }
    return attrs;
}

/**
 * Resolve a potentially relative URL against a base
 */
function resolveUrl(relativeUrl, baseUrl) {
    if (!relativeUrl) return baseUrl;
    try {
        if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
            return relativeUrl;
        }
        return new URL(relativeUrl, baseUrl).href;
    } catch {
        return relativeUrl;
    }
}

/**
 * Format bytes into human-readable size
 */
export function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) {
        size /= 1024;
        i++;
    }
    return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Format bandwidth to readable string
 */
export function formatBandwidth(bps) {
    if (!bps || bps <= 0) return '';
    if (bps >= 1000000) {
        return `${(bps / 1000000).toFixed(1)} Mbps`;
    }
    return `${(bps / 1000).toFixed(0)} Kbps`;
}

/**
 * Format duration in seconds to MM:SS or HH:MM:SS
 */
export function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Get a resolution label from width/height
 */
export function getResolutionLabel(width, height) {
    if (!height) return '';
    if (height >= 2160) return '4K';
    if (height >= 1440) return '1440p';
    if (height >= 1080) return '1080p';
    if (height >= 720) return '720p';
    if (height >= 480) return '480p';
    if (height >= 360) return '360p';
    if (height >= 240) return '240p';
    return `${height}p`;
}
