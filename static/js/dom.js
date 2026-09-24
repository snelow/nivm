/**
 * Project NIVM — Dynamic DOM Access Proxy
 * Resolves DOM elements lazily by ID with automatic node connectivity caching.
 * Any element with id="foo" is accessed directly via dom.foo.
 */

const _domCache = new Map();

export const dom = new Proxy({}, {
    get(_, prop) {
        if (typeof prop !== 'string' || typeof document === 'undefined') return undefined;
        let el = _domCache.get(prop);
        if (!el || !el.isConnected) {
            el = document.getElementById(prop);
            if (el) _domCache.set(prop, el);
        }
        return el;
    },
    has(_, prop) {
        return typeof prop === 'string' && typeof document !== 'undefined' && Boolean(document.getElementById(prop));
    },
    set() {
        return false; // read-only proxy
    }
});
