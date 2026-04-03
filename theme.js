/**
 * theme.js - Dark/Light theme management with localStorage persistence
 */
const Theme = (() => {
    const STORAGE_KEY = 'novapivot-theme';

    function get() {
        return localStorage.getItem(STORAGE_KEY) || 'light';
    }

    function set(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(STORAGE_KEY, theme);
    }

    function toggle() {
        const current = get();
        const next = current === 'light' ? 'dark' : 'light';
        set(next);
        return next;
    }

    function init() {
        set(get());
    }

    return { init, get, set, toggle };
})();

// Initialize theme immediately to prevent flash
Theme.init();
