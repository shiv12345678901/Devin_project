// Utility Functions

// Store current modal state
let currentModalImages = [];
let currentModalIndex = 0;

// Display Results
function displayResults(type, data) {
    const messageEl = document.getElementById(`${type}ResultMessage`);
    const gridEl = document.getElementById(`${type}ScreenshotGrid`);
    const resultEl = document.getElementById(`${type}Result`);

    messageEl.innerHTML = `
        <div class="flex justify-between items-center flex-wrap gap-12" style="width:100%">
            <span>${data.message || `Successfully generated ${data.screenshot_count} screenshot(s)`}</span>
            <div class="flex gap-8">
                ${data.screenshot_count > 1 ? `
                    <button class="btn btn-primary" onclick="downloadAllScreenshots('${type}')">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download All (${data.screenshot_count})
                    </button>
                ` : ''}
            </div>
        </div>
    `;

    gridEl.innerHTML = '';

    // Store screenshot data for download and regeneration
    window.currentScreenshots = {
        type: type,
        files: data.screenshot_files,
        folder: data.screenshot_folder || 'screenshots',
        html_filename: data.html_filename
    };

    data.screenshot_files.forEach((filename, index) => {
        const card = document.createElement('div');
        card.className = 'screenshot-card';
        card.innerHTML = `
            <img src="/screenshots/${filename}?t=${Date.now()}" alt="Screenshot ${index + 1}" onclick="openImageModalOriginal(${index})">
            <div class="screenshot-info flex justify-between items-center">
                <span>Part ${index + 1} of ${data.screenshot_count}</span>
                <button class="btn-icon" onclick="downloadScreenshot('${filename}', ${index + 1})" title="Download this image">
                    <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                </button>
            </div>
        `;
        gridEl.appendChild(card);
    });

    resultEl.classList.add('active');
}

// Image Modal Functions
function openImageModalOriginal(index) {
    if (!window.currentScreenshots) return;

    currentModalImages = window.currentScreenshots.files;
    currentModalIndex = index;

    updateModalImage();

    const modal = document.getElementById('imageModal');
    modal.classList.add('active');

    // Add keyboard navigation
    document.addEventListener('keydown', handleModalKeyboard);
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    modal.classList.remove('active');

    // Remove keyboard navigation
    document.removeEventListener('keydown', handleModalKeyboard);
}

function navigateImage(direction) {
    currentModalIndex += direction;

    // Wrap around
    if (currentModalIndex < 0) {
        currentModalIndex = currentModalImages.length - 1;
    } else if (currentModalIndex >= currentModalImages.length) {
        currentModalIndex = 0;
    }

    updateModalImage();
}

function updateModalImage() {
    const img = document.getElementById('modalImage');
    const info = document.getElementById('modalInfo');
    const prevBtn = document.querySelector('.modal-nav-prev');
    const nextBtn = document.querySelector('.modal-nav-next');

    img.src = `/screenshots/${currentModalImages[currentModalIndex]}?t=${Date.now()}`;
    info.textContent = `${currentModalIndex + 1} / ${currentModalImages.length}`;

    // Disable buttons if only one image
    if (currentModalImages.length === 1) {
        prevBtn.disabled = true;
        nextBtn.disabled = true;
    } else {
        prevBtn.disabled = false;
        nextBtn.disabled = false;
    }
}

function downloadCurrentImage() {
    const filename = currentModalImages[currentModalIndex];
    downloadScreenshot(filename, currentModalIndex + 1);
}

function handleModalKeyboard(e) {
    if (e.key === 'Escape') {
        closeImageModal();
    } else if (e.key === 'ArrowLeft') {
        navigateImage(-1);
    } else if (e.key === 'ArrowRight') {
        navigateImage(1);
    }
}

// Close modal when clicking outside image
document.addEventListener('DOMContentLoaded', function () {
    const modal = document.getElementById('imageModal');
    if (modal) {
        modal.addEventListener('click', function (e) {
            if (e.target === modal) {
                closeImageModal();
            }
        });
    }
});

// Download single screenshot
async function downloadScreenshot(filename, index) {
    try {
        const response = await fetch(`/screenshots/${filename}?t=${Date.now()}`);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        console.log(`Downloaded: ${filename}`);
    } catch (error) {
        console.error('Download error:', error);
        if (typeof notificationManager !== 'undefined') {
            notificationManager.error('Download Failed', `Failed to download ${filename}`);
        }
    }
}

// Download all screenshots
async function downloadAllScreenshots(type) {
    if (!window.currentScreenshots || window.currentScreenshots.type !== type) {
        alert('No screenshots to download');
        return;
    }

    const { files, html_filename } = window.currentScreenshots;
    if (!files || files.length === 0) return;

    if (typeof notificationManager !== 'undefined') {
        notificationManager.info('Preparing Download', 'Zipping screenshots...');
    }

    try {
        const zipName = html_filename ? html_filename.replace('.html', '') : 'screenshot_batch';
        
        const response = await fetch('/download-zip', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                files: files,
                name: zipName
            })
        });

        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${zipName}.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        if (typeof notificationManager !== 'undefined') {
            notificationManager.success('Download Complete', 'Saved as ZIP archive');
        }
    } catch (err) {
        console.error('ZIP download error:', err);
        if (typeof notificationManager !== 'undefined') {
            notificationManager.error('Download Failed', 'Failed to zip screenshots');
        }
    }
}




// Open image modal with custom file list
function openImageModal(index, fileList = null) {
    if (fileList) {
        currentModalImages = fileList;
    } else if (!window.currentScreenshots) {
        return;
    } else {
        currentModalImages = window.currentScreenshots.files;
    }

    currentModalIndex = index;

    updateModalImage();

    const modal = document.getElementById('imageModal');
    modal.classList.add('active');

    // Add keyboard navigation
    document.addEventListener('keydown', handleModalKeyboard);
}




// Clear AI cache
async function clearCache() {
    if (!confirm('Clear AI response cache? This will force fresh AI responses for all future requests.')) {
        return;
    }

    try {
        const response = await fetch('/cache/clear', {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            notificationManager.success('Cache Cleared', 'AI response cache has been cleared successfully');
            updateCacheStats();
        } else {
            notificationManager.error('Error', 'Failed to clear cache');
        }
    } catch (err) {
        notificationManager.error('Error', 'Failed to clear cache: ' + err.message);
    }
}

// Update cache statistics
async function updateCacheStats() {
    try {
        const response = await fetch('/cache/stats');
        const data = await response.json();

        const statsEl = document.getElementById('cacheStats');
        if (statsEl && data) {
            const hitRate = data.total_requests > 0
                ? Math.round((data.cache_hits / data.total_requests) * 100)
                : 0;

            statsEl.innerHTML = `
                ${data.cache_size} cached • ${hitRate}% hit rate
            `;
        }
    } catch (err) {
        console.error('Failed to fetch cache stats:', err);
    }
}

// Load cache stats on page load
document.addEventListener('DOMContentLoaded', () => {
    // Check if cache button exists
    const cacheBtn = document.querySelector('.cache-clear-btn');
    const cacheContainer = document.querySelector('.cache-button-container');
    console.log('Cache button found:', !!cacheBtn);
    console.log('Cache container found:', !!cacheContainer);
    if (cacheContainer) {
        console.log('Cache container styles:', window.getComputedStyle(cacheContainer).display);
    }

    updateCacheStats();
    // Update stats every 30 seconds
    setInterval(updateCacheStats, 30000);
});


