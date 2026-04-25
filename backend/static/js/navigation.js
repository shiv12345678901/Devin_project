// Navigation and UI Controls

// Store selected folder handles
let selectedFolders = {
    screenshot: null,
    html: null
};

// Folder Selection
async function selectFolder(type) {
    try {
        // Check if File System Access API is supported
        if (!('showDirectoryPicker' in window)) {
            if (typeof notificationManager !== 'undefined') {
                notificationManager.warning('Not Supported', 'Folder picker is not supported in your browser. Supported: Chrome 86+, Edge 86+. You can type the folder path manually.');
            }
            return;
        }

        // Show directory picker
        const dirHandle = await window.showDirectoryPicker({
            mode: 'readwrite'
        });

        // Store the handle
        selectedFolders[type] = dirHandle;

        // Update the input field with the folder name
        const input = document.getElementById(type === 'screenshot' ? 'screenshotFolder' : 'htmlFolder');
        input.value = `output/${dirHandle.name}`;
        input.title = `Selected folder: ${dirHandle.name}`;

        console.log(`Selected ${type} folder:`, dirHandle.name);
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('Error selecting folder:', err);
        }
        // User cancelled or error occurred - they can still type manually
    }
}

// Tool Switching
function switchTool(toolId) {
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    event.currentTarget.classList.add('active');

    // Update tool sections
    document.querySelectorAll('.tool-section').forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById(toolId).classList.add('active');

    // Save active tool (#2)
    if (typeof SettingsManager !== 'undefined') {
        SettingsManager.saveActiveTool(toolId);
    }
}

// Advanced Settings Toggle
function toggleAdvanced() {
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

// Reset Advanced Settings
function resetAdvanced() {
    document.getElementById('zoom').value = 2.5;
    document.getElementById('overlap').value = 35;
    document.getElementById('viewportWidth').value = 1920;
    document.getElementById('viewportHeight').value = 1080;
    document.getElementById('maxScreenshots').value = 50;
}

// HTML Tab Switching
function switchHtmlTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    event.currentTarget.classList.add('active');

    if (tab === 'paste') {
        document.getElementById('htmlPasteTab').classList.remove('hidden');
        document.getElementById('htmlUploadTab').classList.add('hidden');
    } else {
        document.getElementById('htmlPasteTab').classList.add('hidden');
        document.getElementById('htmlUploadTab').classList.remove('hidden');
    }
}

// File Upload Handler
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (file) {
        document.getElementById('fileName').textContent = `Selected: ${file.name}`;
        const reader = new FileReader();
        reader.onload = function (e) {
            document.getElementById('htmlInput').value = e.target.result;
        };
        reader.readAsText(file);
    }
}
