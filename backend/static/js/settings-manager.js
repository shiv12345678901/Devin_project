/**
 * SettingsManager — Persistent settings via localStorage (#2) + input validation (#18)
 */
const SettingsManager = {
    STORAGE_KEY: 'screenshotStudioSettings',

    // Default settings for each tool
    DEFAULTS: {
        text: { zoom: 2.1, overlap: 20, viewportWidth: 1920, viewportHeight: 1080, maxScreenshots: 50 },
        html: { zoom: 2.1, overlap: 20, viewportWidth: 1920, viewportHeight: 1080, maxScreenshots: 50 },
        image: { zoom: 2.1, overlap: 20, viewportWidth: 1920, viewportHeight: 1080, maxScreenshots: 50 },
        activeTool: 'text-to-image'
    },

    // Validation ranges (#18)
    RANGES: {
        zoom: { min: 0.5, max: 5, warn: 4 },
        overlap: { min: 0, max: 200 },
        viewportWidth: { min: 800, max: 3840, warn: 3000 },
        viewportHeight: { min: 600, max: 2160 },
        maxScreenshots: { min: 1, max: 100 }
    },

    /**
     * Load all saved settings from localStorage.
     */
    load() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (raw) {
                return { ...this.DEFAULTS, ...JSON.parse(raw) };
            }
        } catch (e) {
            console.warn('Failed to load settings:', e);
        }
        return { ...this.DEFAULTS };
    },

    /**
     * Save all settings to localStorage.
     */
    save(settings) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(settings));
        } catch (e) {
            console.warn('Failed to save settings:', e);
        }
    },

    /**
     * Save the active tool tab.
     */
    saveActiveTool(toolId) {
        const settings = this.load();
        settings.activeTool = toolId;
        this.save(settings);
    },

    /**
     * Read settings from DOM inputs for a specific tool.
     */
    readFromDOM(tool) {
        const prefix = { text: 'text', html: 'html', image: 'image-' }[tool] || tool;
        const isImage = tool === 'image';

        const getId = (field) => {
            if (isImage) return `image-${field.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
            return `${prefix}${field.charAt(0).toUpperCase() + field.slice(1)}`;
        };

        const idMap = {
            text: { zoom: 'textZoom', overlap: 'textOverlap', viewportWidth: 'textViewportWidth', viewportHeight: 'textViewportHeight', maxScreenshots: 'textMaxScreenshots' },
            html: { zoom: 'htmlZoom', overlap: 'htmlOverlap', viewportWidth: 'htmlViewportWidth', viewportHeight: 'htmlViewportHeight', maxScreenshots: 'htmlMaxScreenshots' },
            image: { zoom: 'image-zoom', overlap: 'image-overlap', viewportWidth: 'image-viewport-width', viewportHeight: 'image-viewport-height', maxScreenshots: 'image-max-screenshots' }
        };

        const ids = idMap[tool];
        if (!ids) return null;

        const result = {};
        for (const [key, id] of Object.entries(ids)) {
            const el = document.getElementById(id);
            if (el) result[key] = parseFloat(el.value);
        }
        return result;
    },

    /**
     * Write settings to DOM inputs for a specific tool.
     */
    writeToDOM(tool, values) {
        const idMap = {
            text: { zoom: 'textZoom', overlap: 'textOverlap', viewportWidth: 'textViewportWidth', viewportHeight: 'textViewportHeight', maxScreenshots: 'textMaxScreenshots' },
            html: { zoom: 'htmlZoom', overlap: 'htmlOverlap', viewportWidth: 'htmlViewportWidth', viewportHeight: 'htmlViewportHeight', maxScreenshots: 'htmlMaxScreenshots' },
            image: { zoom: 'image-zoom', overlap: 'image-overlap', viewportWidth: 'image-viewport-width', viewportHeight: 'image-viewport-height', maxScreenshots: 'image-max-screenshots' }
        };

        const ids = idMap[tool];
        if (!ids || !values) return;

        for (const [key, id] of Object.entries(ids)) {
            const el = document.getElementById(id);
            if (el && values[key] !== undefined) {
                el.value = values[key];
            }
        }
    },

    /**
     * Save current tool settings from DOM.
     */
    saveToolSettings(tool) {
        const settings = this.load();
        const values = this.readFromDOM(tool);
        if (values) {
            settings[tool] = values;
            this.save(settings);
        }
    },

    /**
     * Restore saved settings to DOM.
     */
    restoreToolSettings(tool) {
        const settings = this.load();
        if (settings[tool]) {
            this.writeToDOM(tool, settings[tool]);
        }
    },

    /**
     * Validate a single value and clamp to range (#18).
     * Returns { value, warning } or null if ok.
     */
    validate(field, value) {
        const range = this.RANGES[field];
        if (!range) return { value, warning: null };

        const num = parseFloat(value);
        if (isNaN(num)) return { value: range.min, warning: `Invalid value for ${field}` };

        let warning = null;
        let clamped = Math.max(range.min, Math.min(range.max, num));

        if (clamped !== num) {
            warning = `${field} clamped to ${clamped} (range: ${range.min}–${range.max})`;
        } else if (range.warn && num > range.warn) {
            warning = `High ${field} value (${num}) may slow down rendering`;
        }

        return { value: clamped, warning };
    },

    /**
     * Validate all settings for a tool, clamp values, and show warnings (#18).
     * Returns validated settings object.
     */
    validateAll(tool) {
        const values = this.readFromDOM(tool);
        if (!values) return null;

        const warnings = [];
        const validated = {};

        for (const [key, val] of Object.entries(values)) {
            const result = this.validate(key, val);
            validated[key] = result.value;
            if (result.warning) warnings.push(result.warning);
        }

        // Write clamped values back to DOM
        this.writeToDOM(tool, validated);

        // Show warnings
        if (warnings.length > 0 && typeof notificationManager !== 'undefined') {
            notificationManager.warning('Settings Adjusted', warnings.join('. '));
        }

        return validated;
    },

    /**
     * Initialize: restore all tool settings and set active tool.
     */
    init() {
        const settings = this.load();

        // Restore settings for all tools
        this.restoreToolSettings('text');
        this.restoreToolSettings('html');
        this.restoreToolSettings('image');

        // Restore active tool
        if (settings.activeTool && settings.activeTool !== 'text-to-image') {
            const navItem = document.querySelector(`.nav-item[onclick*="${settings.activeTool}"]`);
            if (navItem) {
                navItem.click();
            }
        }

        // Auto-save settings before generate
        this._attachSaveListeners();
    },

    /**
     * Listen for changes on settings inputs and auto-save.
     */
    _attachSaveListeners() {
        // Text settings
        ['textZoom', 'textOverlap', 'textViewportWidth', 'textViewportHeight', 'textMaxScreenshots'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => this.saveToolSettings('text'));
        });
        // HTML settings
        ['htmlZoom', 'htmlOverlap', 'htmlViewportWidth', 'htmlViewportHeight', 'htmlMaxScreenshots'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => this.saveToolSettings('html'));
        });
        // Image settings
        ['image-zoom', 'image-overlap', 'image-viewport-width', 'image-viewport-height', 'image-max-screenshots'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => this.saveToolSettings('image'));
        });
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    SettingsManager.init();
});
