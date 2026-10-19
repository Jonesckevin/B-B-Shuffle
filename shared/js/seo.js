/**
 * B&B Shuffle - origin-aware canonical and social URLs
 *
 * The self-hosted app has no fixed public origin: every deployment serves the
 * same files from its own host (and sometimes a sub-path). Canonical links and
 * og:url / og:image therefore cannot be hardcoded in the HTML. This module
 * fills them in at runtime from `CONFIG.seoOrigin` when it is set, otherwise
 * from `location.origin`.
 *
 * Set `seoOrigin` in Engine-V2/js/config.js to just the scheme and host
 * (for example `https://shuffle.example.com`) when the deployment sits behind
 * a proxy or a different public URL. Leave it empty to use the current origin.
 *
 * Pages marked `noindex` are skipped entirely, and the module does nothing on
 * file:// previews.
 */
(function () {
    'use strict';

    var robots = document.querySelector('meta[name="robots"]');
    if (robots && /noindex/i.test(robots.getAttribute('content') || '')) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

    var configured = '';
    try {
        if (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.seoOrigin) {
            configured = String(CONFIG.seoOrigin);
        }
    } catch (_) {
        configured = '';
    }

    // seoOrigin is scheme + host only; the deployment sub-path lives in pathname.
    var origin = configured ? configured.replace(/\/+$/, '') : location.origin;
    if (!origin) return;

    var path = location.pathname.replace(/\/index\.html$/, '/');
    var pageUrl = origin + path;

    function absolute(value) {
        if (!value) return pageUrl;
        return /^https?:/i.test(value) ? value : new URL(value, pageUrl).href;
    }

    var canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
        canonical = document.createElement('link');
        canonical.rel = 'canonical';
        document.head.appendChild(canonical);
    }
    canonical.href = pageUrl;

    var ogUrl = document.querySelector('meta[property="og:url"]');
    if (!ogUrl) {
        ogUrl = document.createElement('meta');
        ogUrl.setAttribute('property', 'og:url');
        document.head.appendChild(ogUrl);
    }
    ogUrl.setAttribute('content', pageUrl);

    ['og:image', 'twitter:image'].forEach(function (property) {
        var attr = property.indexOf('twitter:') === 0 ? 'name' : 'property';
        var tag = document.querySelector('meta[' + attr + '="' + property + '"]');
        if (!tag) return;
        tag.setAttribute('content', absolute(tag.getAttribute('content')));
    });
})();
