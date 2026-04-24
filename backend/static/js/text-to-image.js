// Text to Image Tool — Uses shared GenerationManager

// Initialize the text-to-image manager
const textManager = new GenerationManager({
    mode: 'text',
    inputId: 'textInput',
    loadingId: 'textLoading',
    errorId: 'textError',
    resultId: 'textResult',
    buttonContainerId: 'textButtonContainer',
    generateEndpoint: '/generate',
    inputField: 'text',
    useSSE: true,   // Use SSE for real progress
    hasPreview: true
});

// Toggle advanced settings for Text mode
function toggleAdvancedText() {
    const settings = document.getElementById('advancedSettings');
    const icon = document.getElementById('advancedIcon');

    const isHidden = settings.classList.contains('hidden');
    settings.classList.toggle('hidden');

    if (isHidden) {
        icon.style.transform = 'rotate(180deg)';
    } else {
        icon.style.transform = 'rotate(0)';
    }
}

// Reset advanced settings for Text mode
function resetAdvancedText() {
    if (confirm('Reset advanced settings to defaults?')) {
        document.getElementById('textZoom').value = '2.1';
        document.getElementById('textOverlap').value = '15';
        document.getElementById('textViewportWidth').value = '1920';
        document.getElementById('textViewportHeight').value = '1080';
        document.getElementById('textMaxScreenshots').value = '50';
    }
}

// Preview HTML before generating screenshots
async function previewHTML() {
    const input = document.getElementById('textInput').value.trim();
    const error = document.getElementById('textError');
    const loading = document.getElementById('textLoading');

    error.classList.add('hidden');

    if (!input) {
        error.textContent = 'Please enter some text content';
        error.classList.remove('hidden');
        return;
    }

    loading.classList.add('active');

    try {
        const response = await fetch('/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: input, beautify: true })
        });

        const data = await response.json();

        if (data.error) {
            // #4 — textContent instead of innerHTML to prevent XSS
            error.textContent = data.error;
            error.classList.remove('hidden');
        } else {
            // Show preview modal
            const modal = document.getElementById('htmlPreviewModal');
            const iframe = document.getElementById('htmlPreviewFrame');

            // Set iframe content
            iframe.srcdoc = data.html_content;

            // Store HTML for copying
            window.previewedHTML = data.html_content;

            modal.classList.add('active');
        }
    } catch (err) {
        error.textContent = 'Error: ' + err.message;
        error.classList.remove('hidden');
    } finally {
        loading.classList.remove('active');
    }
}

// Close preview modal
function closePreviewModal() {
    const modal = document.getElementById('htmlPreviewModal');
    modal.classList.remove('active');
}

// Copy HTML to clipboard
function copyHTMLToClipboard() {
    if (window.previewedHTML) {
        navigator.clipboard.writeText(window.previewedHTML).then(() => {
            notificationManager.success('Copied!', 'HTML copied to clipboard');
        }).catch(err => {
            console.error('Failed to copy:', err);
            notificationManager.error('Copy Failed', 'Could not copy to clipboard');
        });
    }
}

// Generate from text — delegates to shared manager
function generateFromText() {
    // Validate settings before generating (#18)
    if (typeof SettingsManager !== 'undefined') {
        SettingsManager.validateAll('text');
        SettingsManager.saveToolSettings('text');
    }
    textManager.generate();
}

// Regenerate from text form — delegates to shared manager
function regenerateFromTextForm() {
    textManager.regenerate();
}

// Expose version screenshots for utils.js keepVersion()
Object.defineProperty(window, 'currentVersionScreenshots', {
    get: () => textManager.currentVersionScreenshots,
    set: (val) => { textManager.currentVersionScreenshots = val; }
});
Object.defineProperty(window, 'previousVersionScreenshots', {
    get: () => textManager.previousVersionScreenshots,
    set: (val) => { textManager.previousVersionScreenshots = val; }
});
