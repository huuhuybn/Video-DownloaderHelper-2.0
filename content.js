/**
 * Video DownloadHelper — Content Script
 * Detects <video> and <audio> elements in the page DOM
 */

(function () {
    'use strict';

    // Already injected check
    if (window.__vdhContentInjected) return;
    window.__vdhContentInjected = true;

    const DETECTED_SRCS = new Set();

    // ─── Initial Scan ────────────────────────────────────────────────────────

    function scanMediaElements() {
        const mediaElements = document.querySelectorAll('video, audio');

        for (const el of mediaElements) {
            processMediaElement(el);
        }

        // Also check <source> elements
        const sourceElements = document.querySelectorAll('video > source, audio > source');
        for (const src of sourceElements) {
            const url = src.src || src.getAttribute('src');
            if (url) {
                const parent = src.closest('video') || src.closest('audio');
                reportMedia(url, parent?.tagName === 'VIDEO' ? 'video' : 'audio', parent);
            }
        }
    }

    function processMediaElement(el) {
        // Direct src
        const src = el.src || el.currentSrc;
        if (src && !src.startsWith('blob:') && !src.startsWith('data:')) {
            const type = el.tagName === 'VIDEO' ? 'video' : 'audio';
            reportMedia(src, type, el);
        }

        // Check for blob URLs — try to extract video metadata even if we can't get actual URL
        if ((el.src && el.src.startsWith('blob:')) || (el.currentSrc && el.currentSrc.startsWith('blob:'))) {
            // Still report basic metadata if video dimensions are available
            if (el.videoWidth && el.videoHeight) {
                // We can't directly download blob URLs from content script,
                // but we can report the metadata for informational purposes
            }
        }
    }

    function reportMedia(url, type, element) {
        // Skip already reported
        if (DETECTED_SRCS.has(url)) return;
        DETECTED_SRCS.add(url);

        // Skip non-http URLs
        if (!url.startsWith('http://') && !url.startsWith('https://')) return;

        // Extract metadata from the element
        const mediaInfo = {
            url,
            type,
            format: extractFormat(url),
            width: 0,
            height: 0,
            duration: 0,
            resolution: ''
        };

        if (element) {
            if (element.videoWidth) mediaInfo.width = element.videoWidth;
            if (element.videoHeight) mediaInfo.height = element.videoHeight;
            if (element.duration && isFinite(element.duration)) {
                mediaInfo.duration = Math.round(element.duration);
            }
            if (mediaInfo.width && mediaInfo.height) {
                mediaInfo.resolution = getResolutionLabel(mediaInfo.height);
            }
        }

        // Send to background
        try {
            chrome.runtime.sendMessage({
                action: 'mediaFromContent',
                media: mediaInfo
            });
        } catch (e) {
            // Extension context may be invalidated
        }
    }

    function extractFormat(url) {
        try {
            const pathname = new URL(url).pathname;
            const match = pathname.match(/\.([a-z0-9]+)$/i);
            return match ? match[1].toLowerCase() : 'mp4';
        } catch {
            return 'mp4';
        }
    }

    function getResolutionLabel(height) {
        if (height >= 2160) return '4K';
        if (height >= 1440) return '1440p';
        if (height >= 1080) return '1080p';
        if (height >= 720) return '720p';
        if (height >= 480) return '480p';
        if (height >= 360) return '360p';
        if (height >= 240) return '240p';
        return `${height}p`;
    }

    // ─── DOM Mutation Observer ───────────────────────────────────────────────

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;

                // Direct video/audio element
                if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
                    processMediaElement(node);
                }

                // Check descendants
                if (node.querySelectorAll) {
                    const mediaElements = node.querySelectorAll('video, audio');
                    for (const el of mediaElements) {
                        processMediaElement(el);
                    }
                }
            }

            // Attribute changes on video/audio elements (src changes)
            if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
                const target = mutation.target;
                if (target.tagName === 'VIDEO' || target.tagName === 'AUDIO' || target.tagName === 'SOURCE') {
                    const parentMedia = target.tagName === 'SOURCE' ? target.parentElement : target;
                    if (parentMedia) processMediaElement(parentMedia);
                }
            }
        }
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src']
    });

    // ─── Initial scan (with delay to let page load) ─────────────────────────

    if (document.readyState === 'complete') {
        scanMediaElements();
    } else {
        window.addEventListener('load', () => {
            setTimeout(scanMediaElements, 500);
        });
    }

    // Re-scan periodically for SPAs that dynamically load video
    setInterval(scanMediaElements, 3000);
})();
