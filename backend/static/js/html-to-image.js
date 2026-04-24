// HTML to Image Tool — Uses shared GenerationManager

// Initialize the html-to-image manager
const htmlManager = new GenerationManager({
    mode: 'html',
    inputId: 'htmlInput',
    loadingId: 'htmlLoading',
    errorId: 'htmlError',
    resultId: 'htmlResult',
    buttonContainerId: 'htmlButtonContainer',
    generateEndpoint: '/generate-html',
    inputField: 'html',
    useSSE: false,   // HTML mode uses direct fetch (no AI step)
    hasPreview: false
});

// Generate from HTML — delegates to shared manager
function generateFromHtml() {
    // Validate settings before generating (#18)
    if (typeof SettingsManager !== 'undefined') {
        SettingsManager.validateAll('html');
        SettingsManager.saveToolSettings('html');
    }
    htmlManager.generate();
}

// Regenerate from HTML form — delegates to shared manager
function regenerateFromHtmlForm() {
    htmlManager.regenerate();
}

// Toggle advanced settings for HTML mode
function toggleAdvancedHtml() {
    const settings = document.getElementById('advancedSettingsHtml');
    const icon = document.getElementById('advancedIconHtml');

    const isHidden = settings.classList.contains('hidden');
    settings.classList.toggle('hidden');

    if (isHidden) {
        icon.style.transform = 'rotate(180deg)';
    } else {
        icon.style.transform = 'rotate(0)';
    }
}

// Reset advanced settings for HTML mode
function resetAdvancedHtml() {
    if (confirm('Reset advanced settings to defaults?')) {
        document.getElementById('htmlZoom').value = '2.1';
        document.getElementById('htmlOverlap').value = '20';
        document.getElementById('htmlViewportWidth').value = '1920';
        document.getElementById('htmlViewportHeight').value = '1080';
        document.getElementById('htmlMaxScreenshots').value = '50';
    }
}
