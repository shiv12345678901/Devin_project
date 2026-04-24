// Resources Management

let currentResourceTab = 'screenshots';
let selectedFiles = new Set();

// Switch between resource tabs
function switchResourceTab(tab) {
    currentResourceTab = tab;

    // Clear selection when switching tabs
    selectedFiles.clear();
    updateBulkActions();

    // Update tab buttons
    const tabs = document.querySelectorAll('#resources .tab');
    tabs.forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');

    // Show/hide content
    document.getElementById('screenshotsTab').style.display = tab === 'screenshots' ? 'block' : 'none';
    document.getElementById('htmlTab').style.display = tab === 'html' ? 'block' : 'none';
}

// Update bulk actions visibility and count
function updateBulkActions() {
    const bulkActions = document.getElementById('bulkActions');
    const selectedCount = document.getElementById('selectedCount');

    if (selectedFiles.size > 0) {
        bulkActions.style.display = 'flex';
        selectedCount.textContent = `${selectedFiles.size} selected`;
    } else {
        bulkActions.style.display = 'none';
    }
}

// Toggle file selection
function toggleFileSelection(filename, event) {
    event.stopPropagation();

    if (selectedFiles.has(filename)) {
        selectedFiles.delete(filename);
    } else {
        selectedFiles.add(filename);
    }

    updateBulkActions();
    updateSelectionUI();
}

// Update selection UI
function updateSelectionUI() {
    // Update screenshot cards
    document.querySelectorAll('.resource-card').forEach(card => {
        const checkbox = card.querySelector('.resource-checkbox');
        if (checkbox) {
            const filename = checkbox.dataset.filename;
            checkbox.checked = selectedFiles.has(filename);
            if (selectedFiles.has(filename)) {
                card.classList.add('selected');
            } else {
                card.classList.remove('selected');
            }
        }
    });

    // Update HTML list items
    document.querySelectorAll('.resource-list-item').forEach(item => {
        const checkbox = item.querySelector('.resource-list-checkbox');
        if (checkbox) {
            const filename = checkbox.dataset.filename;
            checkbox.checked = selectedFiles.has(filename);
            if (selectedFiles.has(filename)) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        }
    });
}

// Select all files
function selectAll() {
    if (currentResourceTab === 'screenshots') {
        document.querySelectorAll('.resource-checkbox').forEach(checkbox => {
            selectedFiles.add(checkbox.dataset.filename);
        });
    } else {
        document.querySelectorAll('.resource-list-checkbox').forEach(checkbox => {
            selectedFiles.add(checkbox.dataset.filename);
        });
    }

    updateBulkActions();
    updateSelectionUI();
}

// Delete selected files
async function deleteSelected() {
    if (selectedFiles.size === 0) return;

    if (!confirm(`Are you sure you want to delete ${selectedFiles.size} file(s)?`)) {
        return;
    }

    const type = currentResourceTab === 'screenshots' ? 'screenshot' : 'html';
    const filesToDelete = Array.from(selectedFiles);
    let successCount = 0;
    let failCount = 0;

    for (const filename of filesToDelete) {
        try {
            const response = await fetch(`/delete/${type}/${filename}`, {
                method: 'DELETE'
            });
            const data = await response.json();

            if (data.success) {
                successCount++;
                selectedFiles.delete(filename);
            } else {
                failCount++;
            }
        } catch (err) {
            failCount++;
        }
    }

    // Show single notification for all deletions
    if (successCount > 0) {
        notificationManager.success('Deleted', `Successfully deleted ${successCount} file(s)`);
    }
    if (failCount > 0) {
        notificationManager.error('Error', `Failed to delete ${failCount} file(s)`);
    }

    updateBulkActions();
    refreshResources();
}

// Load resources when switching to resources page
function loadResources() {
    const loading = document.getElementById('resourcesLoading');
    const error = document.getElementById('resourcesError');

    loading.classList.add('active');
    error.style.display = 'none';

    fetch('/list')
        .then(response => response.json())
        .then(data => {
            displayScreenshots(data.screenshots || []);
            displayHtmlFiles(data.html_files || []);
        })
        .catch(err => {
            error.textContent = 'Error loading resources: ' + err.message;
            error.style.display = 'block';
        })
        .finally(() => {
            loading.classList.remove('active');
        });
}

// Display screenshots
function displayScreenshots(screenshots) {
    const container = document.getElementById('screenshotsList');
    const noFiles = document.getElementById('noScreenshots');

    // Remove resources-grid class from container since we inject our own grids per group
    container.classList.remove('resources-grid');

    if (screenshots.length === 0) {
        container.innerHTML = '';
        noFiles.style.display = 'block';
        return;
    }

    noFiles.style.display = 'none';

    // Group screenshots by base name (e.g., "1" from "1(1).png")
    const groups = {};
    screenshots.forEach(filename => {
        let base = filename;
        const match = filename.match(/^(.+?)\(\d+\)\.png$/);
        if (match) {
            base = match[1];
        }
        if (!groups[base]) groups[base] = [];
        groups[base].push(filename);
    });

    // Sort bases ascending (numerically if numbers, else alphabetically)
    const sortedBases = Object.keys(groups).sort((a, b) => {
        const numA = parseInt(a);
        const numB = parseInt(b);
        if (!isNaN(numA) && !isNaN(numB)) {
            return numA - numB;
        }
        return a.localeCompare(b);
    });

    // Store grouped data globally for modal navigation
    window.resourceGroups = groups;
    let html = '';

    sortedBases.forEach(base => {
        const groupFiles = groups[base];

        // Sort files within group by part number descending or ascending 
        // e.g., 1(1).png before 1(2).png
        groupFiles.sort((a, b) => {
            const matchA = a.match(/\((\d+)\)\.png$/);
            const matchB = b.match(/\((\d+)\)\.png$/);
            if (matchA && matchB) {
                return parseInt(matchA[1]) - parseInt(matchB[1]);
            }
            return a.localeCompare(b);
        });

        html += `
            <div class="resource-group">
                <h3 class="resource-group-header">
                    Batch: ${base}
                </h3>
                <div class="resources-grid">
        `;

        groupFiles.forEach((filename, index) => {
            html += `
                <div class="resource-card">
                    <input type="checkbox" class="resource-checkbox" data-filename="${filename}" 
                           onchange="toggleFileSelection('${filename}', event)">
                    <img src="/screenshots/${filename}?t=${Date.now()}" alt="${filename}" onclick="openGroupImageModal('${base}', ${index})">
                    <div class="resource-card-info">
                        <div class="resource-card-name">${filename}</div>
                        <div class="resource-card-actions">
                            <button class="btn btn-secondary" onclick="downloadFile('/screenshots/${filename}', '${filename}')">
                                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                Download
                            </button>
                            <button class="btn btn-ghost-danger" onclick="deleteFile('screenshot', '${filename}')" title="Delete">
                                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
    updateSelectionUI();
}

// Display HTML files
function displayHtmlFiles(htmlFiles) {
    const container = document.getElementById('htmlFilesList');
    const noFiles = document.getElementById('noHtmlFiles');

    if (htmlFiles.length === 0) {
        container.innerHTML = '';
        noFiles.style.display = 'block';
        return;
    }

    noFiles.style.display = 'none';

    container.innerHTML = htmlFiles.map(filename => `
        <div class="resource-list-item">
            <input type="checkbox" class="resource-list-checkbox" data-filename="${filename}" 
                   onchange="toggleFileSelection('${filename}', event)">
            <div class="resource-list-icon">
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
            </div>
            <div class="resource-list-info">
                <div class="resource-list-name">${filename}</div>
                <div class="resource-list-meta">HTML File</div>
            </div>
            <div class="resource-list-actions">
                <button class="btn btn-secondary" onclick="regenerateScreenshots('${filename}')" title="Regenerate screenshots">
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Regenerate
                </button>
                <button class="btn btn-secondary" onclick="viewHtmlFile('${filename}')">
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    View
                </button>
                <button class="btn btn-secondary" onclick="downloadFile('/html/${filename}', '${filename}')">
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download
                </button>
                <button class="btn btn-ghost-danger" onclick="deleteFile('html', '${filename}')" title="Delete">
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    `).join('');

    updateSelectionUI();
}

// Refresh resources
function refreshResources() {
    selectedFiles.clear();
    updateBulkActions();
    loadResources();
}

// Download file
function downloadFile(url, filename) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// View HTML file
function viewHtmlFile(filename) {
    window.open(`/html/${filename}`, '_blank');
}

// Open image in modal mapped to global utility state
function openGroupImageModal(base, index) {
    if (window.resourceGroups && window.resourceGroups[base]) {
        window.currentScreenshots = {
            type: 'resources',
            files: window.resourceGroups[base]
        };
        // Hand off to the robust modal from utils.js that supports next/prev
        if (typeof openImageModalOriginal === 'function') {
            openImageModalOriginal(index);
        }
    }
}

// Delete single file
function deleteFile(type, filename) {
    if (!confirm(`Are you sure you want to delete ${filename}?`)) {
        return;
    }

    fetch(`/delete/${type}/${filename}`, {
        method: 'DELETE'
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                notificationManager.success('Deleted', `${filename} has been deleted`);
                selectedFiles.delete(filename);
                updateBulkActions();
                refreshResources();
            } else {
                notificationManager.error('Delete Failed', data.error || 'Could not delete file');
            }
        })
        .catch(err => {
            notificationManager.error('Error', 'Failed to delete file: ' + err.message);
        });
}

// Load resources when resources page is opened
document.addEventListener('DOMContentLoaded', () => {
    // Override switchTool to load resources when switching to resources page
    const originalSwitchTool = window.switchTool;
    window.switchTool = function (tool) {
        originalSwitchTool(tool);
        if (tool === 'resources') {
            selectedFiles.clear();
            updateBulkActions();
            loadResources();
        }
    };
});


// Regenerate screenshots from HTML file with custom settings
function regenerateScreenshots(htmlFilename) {
    // Create modal for settings
    const modal = document.createElement('div');
    modal.className = 'image-modal active';
    modal.innerHTML = `
        <button class="modal-close" onclick="this.parentElement.remove()">&times;</button>
        <div class="modal-dialog">
            <h3 class="mb-20">Regenerate Screenshots</h3>
            <p class="text-secondary mb-24">Adjust settings and regenerate screenshots from: <strong>${htmlFilename}</strong></p>
            
            <div class="form-group">
                <label class="form-label">Screenshot Name</label>
                <input type="text" id="regenScreenshotName" class="form-input" value="screenshot" placeholder="screenshot">
            </div>
            
            <div class="form-row flex gap-16">
                <div class="form-group flex-1">
                    <label class="form-label">Zoom Level</label>
                    <input type="number" id="regenZoom" class="form-input" value="2.5" min="1" max="5" step="0.1">
                </div>
                <div class="form-group flex-1">
                    <label class="form-label">Overlap (px)</label>
                    <input type="number" id="regenOverlap" class="form-input" value="35" min="0" max="200" step="5">
                </div>
            </div>
            
            <div class="form-row flex gap-16">
                <div class="form-group flex-1">
                    <label class="form-label">Viewport Width</label>
                    <input type="number" id="regenWidth" class="form-input" value="1920" min="800" max="3840" step="80">
                </div>
                <div class="form-group flex-1">
                    <label class="form-label">Viewport Height</label>
                    <input type="number" id="regenHeight" class="form-input" value="1080" min="600" max="2160" step="60">
                </div>
            </div>
            
            <div class="form-group">
                <label class="form-label">Max Screenshots</label>
                <input type="number" id="regenMaxScreenshots" class="form-input" value="50" min="1" max="100">
            </div>
            
            <div class="flex gap-12 mt-24">
                <button class="btn btn-secondary flex-1" onclick="this.closest('.image-modal').remove()">
                    Cancel
                </button>
                <button class="btn btn-primary" onclick="executeRegenerate('${htmlFilename}')" style="flex: 2;">
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Regenerate Screenshots
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

// Execute regeneration
async function executeRegenerate(htmlFilename) {
    const modal = document.querySelector('.image-modal');

    // Get settings
    const settings = {
        html_filename: htmlFilename,
        screenshot_name: document.getElementById('regenScreenshotName').value.trim() || 'screenshot',
        zoom: parseFloat(document.getElementById('regenZoom').value) || 2.5,
        overlap: parseInt(document.getElementById('regenOverlap').value) || 35,
        viewport_width: parseInt(document.getElementById('regenWidth').value) || 1920,
        viewport_height: parseInt(document.getElementById('regenHeight').value) || 1080,
        max_screenshots: parseInt(document.getElementById('regenMaxScreenshots').value) || 50
    };

    // Close modal
    modal.remove();

    // Show notification
    notificationManager.info('Regenerating', 'Creating screenshots with new settings...');

    try {
        const response = await fetch('/regenerate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });

        const data = await response.json();

        if (data.error) {
            notificationManager.error('Regeneration Failed', data.error);
        } else {
            notificationManager.success(
                'Regeneration Complete!',
                `Created ${data.screenshot_count} screenshot(s)`
            );

            // Switch to screenshots tab to show new files
            currentResourceTab = 'screenshots';
            document.querySelectorAll('#resources .tab').forEach((t, i) => {
                t.classList.toggle('active', i === 0);
            });
            document.getElementById('screenshotsTab').style.display = 'block';
            document.getElementById('htmlTab').style.display = 'none';

            // Refresh to show new screenshots
            refreshResources();
        }
    } catch (err) {
        notificationManager.error('Error', 'Failed to regenerate: ' + err.message);
    }
}
