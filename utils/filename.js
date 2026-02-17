/**
 * Video DownloadHelper — Filename Utilities
 * Smart filename generation and sanitization
 */

// Characters not allowed in filenames across OS
const INVALID_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;
const RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;

/**
 * Generate a smart filename from video metadata
 * @param {Object} options
 * @param {string} options.pageTitle - The page title
 * @param {string} options.videoUrl - The video URL
 * @param {string} options.format - File format/extension
 * @param {string} [options.resolution] - Resolution label (e.g., "720p")
 * @param {string} [options.quality] - Quality label
 * @param {string} [options.template] - Filename template
 * @returns {string} sanitized filename with extension
 */
export function generateFilename({ pageTitle, videoUrl, format, resolution, quality, template }) {
    let baseName = '';

    if (template) {
        baseName = applyTemplate(template, { pageTitle, videoUrl, resolution, quality });
    } else {
        // Default smart naming: use page title
        baseName = pageTitle || extractNameFromUrl(videoUrl) || 'video';
    }

    // Add resolution suffix if available
    if (resolution && !baseName.includes(resolution)) {
        baseName += ` (${resolution})`;
    }

    // Sanitize and add extension
    baseName = sanitizeFilename(baseName);
    const ext = normalizeExtension(format);

    return `${baseName}.${ext}`;
}

/**
 * Apply a filename template
 * Supported placeholders: {title}, {domain}, {resolution}, {quality}, {date}, {time}
 */
function applyTemplate(template, { pageTitle, videoUrl, resolution, quality }) {
    let domain = '';
    try {
        domain = new URL(videoUrl).hostname.replace('www.', '');
    } catch { /* ignore */ }

    const now = new Date();
    const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const time = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS

    return template
        .replace('{title}', pageTitle || 'untitled')
        .replace('{domain}', domain)
        .replace('{resolution}', resolution || '')
        .replace('{quality}', quality || '')
        .replace('{date}', date)
        .replace('{time}', time);
}

/**
 * Extract a reasonable name from a URL path
 */
function extractNameFromUrl(url) {
    try {
        const pathname = new URL(url).pathname;
        const segments = pathname.split('/').filter(Boolean);
        if (segments.length === 0) return null;

        let name = segments[segments.length - 1];
        // Remove extension
        name = name.replace(/\.[^.]+$/, '');
        // Replace URL encoding
        name = decodeURIComponent(name);
        // Replace underscores/hyphens with spaces
        name = name.replace(/[_-]+/g, ' ');

        return name.trim() || null;
    } catch {
        return null;
    }
}

/**
 * Sanitize a filename for cross-platform compatibility
 */
export function sanitizeFilename(name) {
    if (!name) return 'download';

    // Remove invalid characters
    let sanitized = name.replace(INVALID_CHARS, '');

    // Trim dots and spaces from start/end
    sanitized = sanitized.replace(/^[\s.]+|[\s.]+$/g, '');

    // Handle reserved Windows names
    if (RESERVED_NAMES.test(sanitized)) {
        sanitized = `_${sanitized}`;
    }

    // Limit length (keep room for extension)
    if (sanitized.length > 200) {
        sanitized = sanitized.substring(0, 200).trim();
    }

    return sanitized || 'download';
}

/**
 * Normalize file extension
 */
function normalizeExtension(format) {
    if (!format) return 'mp4';
    const ext = format.toLowerCase().replace(/^\./, '');

    // Map common content-type parts to extensions
    const extMap = {
        'mpeg': 'mp3',
        'quicktime': 'mov',
        'x-matroska': 'mkv',
        'x-flv': 'flv',
        'x-ms-wmv': 'wmv',
        'x-m4v': 'm4v',
        'mp2t': 'ts',
        '3gpp': '3gp',
        'vnd.apple.mpegurl': 'm3u8',
        'dash+xml': 'mpd'
    };

    return extMap[ext] || ext;
}
