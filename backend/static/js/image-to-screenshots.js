let extractedText = '';
let extractionMetadata = null;
let currentImageOperationId = null;

/**
 * Toggle advanced settings panel
 */
function toggleImageAdvanced() {
    const settings = document.getElementById('image-advanced-settings');
    const icon = document.getElementById('image-advanced-toggle-icon');

    const isHidden = settings.classList.contains('hidden');
    settings.classList.toggle('hidden');

    if (isHidden) {
        icon.style.transform = 'rotate(180deg)';
    } else {
        icon.style.transform = 'rotate(0)';
    }
}

/**
 * Cancel in-progress image workflow
 */
async function cancelImageWorkflow() {
    if (currentImageOperationId) {
        try {
            await fetch(`/cancel/${currentImageOperationId}`, { method: 'POST' });
        } catch (e) {
            console.error('Cancel failed', e);
        }
    }
}

/**
 * Handle image or PDF file selection
 */
function handleImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const preview = document.getElementById('imagePreview');

    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        preview.innerHTML = `
            <div class="file-preview-card">
                <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" class="text-danger">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <div class="fw-500">PDF Document</div>
                <p class="text-sm text-secondary mt-4">
                    ${file.name} (${(file.size / 1024).toFixed(1)} KB)
                </p>
            </div>
        `;
    } else {
        const reader = new FileReader();
        reader.onload = function (e) {
            preview.innerHTML = `
                <img src="${e.target.result}" class="preview-image" alt="Preview">
                <p class="text-sm text-secondary mt-8">
                    ${file.name} (${(file.size / 1024).toFixed(1)} KB)
                </p>
            `;
        };
        reader.readAsDataURL(file);
    }
}

/**
 * Extract text from image (Stage 1)
 */
async function extractTextFromImage() {
    const fileInput = document.getElementById('imageFile');
    const instructions = document.getElementById('imageInstructions').value;
    const loading = document.getElementById('imageLoading');
    const error = document.getElementById('imageError');
    const results = document.getElementById('imageResults');

    if (!fileInput.files || !fileInput.files[0]) {
        error.textContent = 'Please select an image first';
        error.classList.remove('hidden');
        return;
    }

    error.classList.add('hidden');
    results.classList.add('hidden');
    loading.classList.add('active');

    try {
        const formData = new FormData();
        formData.append('image', fileInput.files[0]);
        formData.append('instructions', instructions);

        const response = await fetch('/extract-from-image', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.error) {
            error.textContent = data.error;
            error.classList.remove('hidden');
        } else {
            extractedText = data.raw_text;
            extractionMetadata = data.metadata;
            showExtractedText(data);
        }
    } catch (err) {
        error.textContent = 'Error: ' + err.message;
        error.classList.remove('hidden');
    } finally {
        loading.classList.remove('active');
    }
}

/**
 * Show extracted text with edit capability
 */
function showExtractedText(data) {
    const results = document.getElementById('imageResults');

    results.innerHTML = `
        <div class="alert alert-success">
            <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
                <strong>Text Extracted Successfully!</strong>
                <p class="text-sm mt-4">${data.metadata.word_count} words extracted from ${data.metadata.image_file}</p>
            </div>
        </div>
        
        <div class="card mt-16">
            <h3 class="mb-12">Extracted Text (Editable)</h3>
            <p class="text-sm text-secondary mb-12">
                Review and edit the extracted text before converting to HTML
            </p>
            <textarea id="extractedTextArea" class="form-textarea" rows="15">${data.raw_text}</textarea>
            
            <div class="flex gap-12 mt-16">
                <button class="btn btn-secondary" onclick="copyExtractedText()">
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy Text
                </button>
                <button class="btn btn-primary flex-1" onclick="convertToHTML()">
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Convert to HTML & Generate Screenshots
                </button>
            </div>
        </div>
    `;

    results.classList.remove('hidden');
}

/**
 * Convert extracted text to HTML (Stage 2)
 */
async function convertToHTML() {
    const textArea = document.getElementById('extractedTextArea');
    const text = textArea.value.trim();

    if (!text) {
        if (typeof notificationManager !== 'undefined') {
            notificationManager.warning('Empty', 'No text to convert');
        }
        return;
    }

    // Set the text in the text-to-image input
    document.getElementById('textInput').value = text;

    // Switch to text-to-image tab
    switchTool('text-to-image');

    // Trigger generation
    generateFromText();
}

/**
 * Copy extracted text to clipboard
 */
function copyExtractedText() {
    const textArea = document.getElementById('extractedTextArea');
    const text = textArea.value;

    // Modern Clipboard API (#15)
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            if (typeof notificationManager !== 'undefined') {
                notificationManager.success('Copied!', 'Text copied to clipboard');
            }
        }).catch(err => {
            console.error('Clipboard write failed:', err);
            if (typeof notificationManager !== 'undefined') {
                notificationManager.error('Copy Failed', 'Could not copy to clipboard');
            }
        });
    } else {
        // Fallback for older browsers
        textArea.select();
        document.execCommand('copy');
        if (typeof notificationManager !== 'undefined') {
            notificationManager.success('Copied!', 'Text copied to clipboard');
        }
    }
}

/**
 * Complete workflow (all stages at once) using SSE
 */
async function processImageComplete() {
    const fileInput = document.getElementById('imageFile');
    const instructions = document.getElementById('imageInstructions').value;

    if (!fileInput.files || !fileInput.files[0]) {
        if (typeof notificationManager !== 'undefined') {
            notificationManager.warning('No File', 'Please select an image first');
        }
        return;
    }

    // Validate settings before generating (#18)
    if (typeof SettingsManager !== 'undefined') {
        SettingsManager.validateAll('image');
        SettingsManager.saveToolSettings('image');
    }

    const loading = document.getElementById('imageLoading');
    const errorAlert = document.getElementById('imageError');
    const results = document.getElementById('imageResults');
    const progressContainer = document.getElementById('image-progress-container');
    const progressBar = document.getElementById('image-progress-bar');
    const progressText = document.getElementById('image-progress-text');
    const statusText = document.getElementById('image-status-text');
    const btnExtract = document.getElementById('btn-extract-stage-1');
    const btnProcess = document.getElementById('btn-process-complete');
    const btnCancel = document.getElementById('btn-cancel-image');

    // Reset UI — use classList (#16)
    errorAlert.classList.add('hidden');
    results.classList.add('hidden');
    progressContainer.classList.remove('hidden');

    // Button loading states (#5)
    btnExtract.disabled = true;
    btnProcess.disabled = true;
    btnProcess.innerHTML = `
        <svg class="spin" width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Processing...
    `;
    if (btnCancel) btnCancel.classList.remove('hidden');

    // Reset Progress
    progressBar.style.width = '0%';
    progressText.textContent = '0%';
    statusText.textContent = 'Uploading and authenticating...';
    document.querySelectorAll('#image-progress-container .step-indicator').forEach(step => {
        step.classList.remove('active', 'completed');
    });

    try {
        const formData = new FormData();
        formData.append('image', fileInput.files[0]);
        formData.append('instructions', instructions);

        // Add screenshot settings from advanced panel
        const zoom = document.getElementById('image-zoom')?.value || '2.1';
        const overlap = document.getElementById('image-overlap')?.value || '20';
        const vpWidth = document.getElementById('image-viewport-width')?.value || '1920';
        const vpHeight = document.getElementById('image-viewport-height')?.value || '1080';
        const maxScreenshots = document.getElementById('image-max-screenshots')?.value || '50';
        const systemPrompt = document.getElementById('image-system-prompt')?.value || '';

        formData.append('zoom', zoom);
        formData.append('overlap', overlap);
        formData.append('viewport_width', vpWidth);
        formData.append('viewport_height', vpHeight);
        formData.append('max_screenshots', maxScreenshots);
        if (systemPrompt) formData.append('system_prompt', systemPrompt);

        statusText.textContent = 'Starting process...';

        const response = await fetch('/image-to-screenshots-sse', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }

        // Setup SSE reader from fetch body
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete SSE messages split by double newline
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || ''; // Keep incomplete part

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.substring(6);
                    try {
                        const data = JSON.parse(dataStr);

                        // Capture operation ID for cancel
                        if (data.operation_id) {
                            currentImageOperationId = data.operation_id;
                        }

                        // Update progress bar
                        if (data.progress !== undefined) {
                            progressBar.style.width = `${data.progress}%`;
                            progressText.textContent = `${data.progress}%`;
                        }

                        // Update status text
                        if (data.message) {
                            statusText.textContent = data.message;
                        }

                        // Update visual steps
                        updateImageProgressUI(data.stage);

                        // Check for errors
                        if (data.type === 'error') {
                            throw new Error(data.message);
                        }

                        // Handle completion
                        if (data.type === 'complete') {
                            displayImageCompleteResults(data.result);
                            if (typeof notificationManager !== 'undefined') {
                                notificationManager.success('Success!', data.message);
                            }
                        }

                    } catch (e) {
                        console.error('Error parsing SSE data:', e, dataStr);
                    }
                }
            }
        }

    } catch (err) {
        errorAlert.textContent = 'Error: ' + err.message;
        errorAlert.classList.remove('hidden');
        progressContainer.classList.add('hidden');

        if (typeof notificationManager !== 'undefined') {
            notificationManager.error('Failed', err.message);
        }
    } finally {
        btnExtract.disabled = false;
        btnProcess.disabled = false;
        // Restore button text (#5)
        btnProcess.innerHTML = `
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Process & Generate
        `;
        if (btnCancel) btnCancel.classList.add('hidden');
        currentImageOperationId = null;

        if (statusText.textContent !== 'Screenshots captured successfully' && results.classList.contains('hidden')) {
            progressContainer.classList.add('hidden');
        }
    }
}

/**
 * Updates the visual step indicators based on the current stage
 */
function updateImageProgressUI(stage) {
    const steps = document.querySelectorAll('#image-progress-container .step-indicator');

    // Stage to Step mapping
    const stageMap = {
        'init': 0,
        'vision': 1,
        'vision_complete': 1,
        'ai': 2,
        'ai_complete': 2,
        'screenshots': 3,
        'screenshots_complete': 3,
        'complete': 4
    };

    const currentStep = stageMap[stage] || 0;

    steps.forEach(step => {
        const stepNum = parseInt(step.getAttribute('data-step'));
        step.classList.remove('active', 'completed');

        if (stepNum < currentStep) {
            step.classList.add('completed');
        } else if (stepNum === currentStep) {
            step.classList.add('active');
            if (stage.includes('complete')) {
                step.classList.remove('active');
                step.classList.add('completed');
            }
        }
    });
}

/**
 * Render the final results of a complete image-to-screenshots workflow
 */
function displayImageCompleteResults(data) {
    const results = document.getElementById('imageResults');

    let screenshotsHtml = '';
    if (data.screenshot_files && data.screenshot_files.length > 0) {
        screenshotsHtml = data.screenshot_files.map(file => `
            <div class="screenshot-card" onclick="openImageModal('/download/${file}')">
                <img src="/download/${file}" alt="Screenshot" class="screenshot-img" loading="lazy">
                <div class="screenshot-info">
                    <span class="screenshot-name" title="${file.split('/').pop()}">${file.split('/').pop()}</span>
                    <button class="btn-icon" onclick="event.stopPropagation(); window.open('/download/${file}', '_blank')" title="Open in new tab">
                        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');
    }

    results.innerHTML = `
        <div class="alert alert-success mb-20">
            <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
                <strong>Workflow Completed Successfully!</strong>
                <p class="text-sm mt-4">Generated ${data.screenshot_files.length} screenshots in ${data.screenshot_folder}</p>
                <p class="text-sm mt-4 text-tertiary">Extracted text was ${data.raw_text.length} characters long.</p>
            </div>
        </div>
        
        <div class="screenshot-grid">
            ${screenshotsHtml}
        </div>
    `;

    results.classList.remove('hidden');

    // Also trigger resources refresh
    if (typeof refreshResources === 'function') {
        setTimeout(refreshResources, 1000);
    }
}
