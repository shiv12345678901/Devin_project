// GenerationManager — Shared module for text-to-image and html-to-image tools
// Implements: #3 (deduplication), #18 (CSS classes), #1 (SSE progress), #6 (cancel), #9 (token counter)

class GenerationManager {
    /**
     * @param {Object} config
     * @param {string} config.mode - 'text' or 'html'
     * @param {string} config.inputId - ID of the textarea input
     * @param {string} config.loadingId - ID of the loading container
     * @param {string} config.errorId - ID of the error alert
     * @param {string} config.resultId - ID of the result section
     * @param {string} config.buttonContainerId - ID of the button container
     * @param {string} config.generateEndpoint - API endpoint for generation
     * @param {string} config.inputField - JSON field name for the input ('text' or 'html')
     * @param {boolean} config.useSSE - Whether to use SSE endpoint for generation
     * @param {boolean} config.hasPreview - Whether this mode has a preview feature
     */
    constructor(config) {
        this.mode = config.mode;
        this.inputId = config.inputId;
        this.loadingId = config.loadingId;
        this.errorId = config.errorId;
        this.resultId = config.resultId;
        this.buttonContainerId = config.buttonContainerId;
        this.generateEndpoint = config.generateEndpoint;
        this.inputField = config.inputField;
        this.useSSE = config.useSSE || false;
        this.hasPreview = config.hasPreview || false;

        // State
        this.lastGeneratedHtmlFile = null;
        this.lastGeneratedSettings = null;
        this.currentVersionScreenshots = null;
        this.previousVersionScreenshots = null;
        this.abortController = null;
        this.currentOperationId = null;
        this.etaIntervalId = null;
        this.etaSecondsRemaining = 0;

        // Initialize
        this._initSettingsWatcher();
        this._initTokenCounter();
    }

    // ─── Token Counter (#9) ───
    _initTokenCounter() {
        const input = document.getElementById(this.inputId);
        if (!input) return;

        // Create counter element if it doesn't exist
        let counter = document.getElementById(`${this.mode}TokenCounter`);
        if (!counter) {
            counter = document.createElement('div');
            counter.id = `${this.mode}TokenCounter`;
            counter.className = 'token-counter';
            input.parentNode.appendChild(counter);
        }

        const updateCounter = () => {
            const text = input.value;
            const chars = text.length;
            const words = text.trim() ? text.trim().split(/\s+/).length : 0;
            const estimatedTokens = Math.ceil(chars / 4);
            const maxTokens = 100000;
            const pct = (estimatedTokens / maxTokens) * 100;

            counter.textContent = `${chars.toLocaleString()} chars · ${words.toLocaleString()} words · ~${estimatedTokens.toLocaleString()} tokens`;

            counter.classList.remove('token-counter--warning', 'token-counter--danger');
            if (pct > 90) {
                counter.classList.add('token-counter--danger');
            } else if (pct > 70) {
                counter.classList.add('token-counter--warning');
            }
        };

        input.addEventListener('input', updateCounter);
        updateCounter();
    }

    _getSettings() {
        // Find the optional verification toggle (only exists in text mode currently)
        const verificationToggle = document.getElementById(`${this.mode}EnableVerification`);
        
        // Find the optional model selector (only exists in text mode currently)
        const modelSelector = document.getElementById(`${this.mode}ModelChoice`);
        
        return {
            zoom: parseFloat(document.getElementById(`${this.mode}Zoom`)?.value) || 2.1,
            overlap: parseInt(document.getElementById(`${this.mode}Overlap`)?.value) || 20,
            viewport_width: parseInt(document.getElementById(`${this.mode}ViewportWidth`)?.value) || 1920,
            viewport_height: parseInt(document.getElementById(`${this.mode}ViewportHeight`)?.value) || 1080,
            max_screenshots: parseInt(document.getElementById(`${this.mode}MaxScreenshots`)?.value) || 50,
            enable_verification: verificationToggle ? verificationToggle.checked : true,
            model_choice: modelSelector ? modelSelector.value : 'default'
        };
    }

    _hasSettingsChanged() {
        if (!this.lastGeneratedSettings) return false;
        const current = this._getSettings();
        return JSON.stringify(current) !== JSON.stringify(this.lastGeneratedSettings);
    }

    _initSettingsWatcher() {
        const baseInputs = [
            'Zoom', 'Overlap',
            'ViewportWidth', 'ViewportHeight', 'MaxScreenshots'
        ];

        baseInputs.forEach(baseId => {
            const id = `${this.mode}${baseId}`;
            const input = document.getElementById(id);
            if (input) {
                input.addEventListener('input', () => {
                    const regenerateBtn = document.getElementById(`${this.mode}RegenerateBtn`);
                    if (regenerateBtn && regenerateBtn.style.display !== 'none') {
                        const changed = this._hasSettingsChanged();
                        regenerateBtn.disabled = !changed;
                        regenerateBtn.classList.toggle('btn--disabled', !changed);
                    }
                });
            }
        });
    }

    // ─── Button State (#18 — CSS classes) ───
    _setButtonDisabled(btn, disabled) {
        if (!btn) return;
        btn.disabled = disabled;
        btn.classList.toggle('btn--disabled', disabled);
    }

    _setButtonLoading(btn, loading) {
        if (!btn) return;
        btn.classList.toggle('btn--loading', loading);
        btn.disabled = loading;
    }

    updateButtonState(state) {
        const container = document.getElementById(this.buttonContainerId);
        if (!container) return;

        const generateBtn = container.querySelector('.btn-primary');

        let regenerateBtn = document.getElementById(`${this.mode}RegenerateBtn`);
        if (!regenerateBtn) {
            regenerateBtn = document.createElement('button');
            regenerateBtn.id = `${this.mode}RegenerateBtn`;
            regenerateBtn.className = 'btn btn-primary btn--disabled';
            regenerateBtn.style.display = 'none';
            regenerateBtn.disabled = true;
            regenerateBtn.innerHTML = `
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Regenerate with New Settings
            `;
            regenerateBtn.onclick = () => this.regenerate();
            container.appendChild(regenerateBtn);
        }

        if (state === 'generated') {
            if (generateBtn) generateBtn.style.display = 'none';
            regenerateBtn.style.display = 'inline-flex';
            this._setButtonDisabled(regenerateBtn, true);
        } else if (state === 'initial') {
            if (generateBtn) generateBtn.style.display = 'inline-flex';
            regenerateBtn.style.display = 'none';
        }
    }

    // ─── Cancel (#6) ───
    _showCancelButton() {
        const loading = document.getElementById(this.loadingId);
        if (!loading) return;

        let cancelBtn = document.getElementById(`${this.mode}CancelBtn`);
        if (!cancelBtn) {
            cancelBtn = document.createElement('button');
            cancelBtn.id = `${this.mode}CancelBtn`;
            cancelBtn.className = 'btn btn-secondary';
            cancelBtn.style.marginTop = '12px';
            cancelBtn.innerHTML = `
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Cancel
            `;
            cancelBtn.onclick = () => this.cancelGeneration();
            loading.appendChild(cancelBtn);
        }
        cancelBtn.style.display = 'inline-flex';
    }

    _hideCancelButton() {
        const cancelBtn = document.getElementById(`${this.mode}CancelBtn`);
        if (cancelBtn) cancelBtn.style.display = 'none';
    }

    async cancelGeneration() {
        // Abort the fetch request
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }

        // Cancel server-side operation
        if (this.currentOperationId) {
            try {
                await fetch(`/cancel/${this.currentOperationId}`, { method: 'POST' });
            } catch (e) {
                console.log('Cancel request failed (operation may have finished):', e);
            }
            this.currentOperationId = null;
        }

        this._hideCancelButton();
        const loading = document.getElementById(this.loadingId);
        if (loading) loading.classList.remove('active');

        if (typeof notificationManager !== 'undefined') {
            notificationManager.info('Cancelled', 'Generation was cancelled');
        }

        // Re-enable generate button
        const container = document.getElementById(this.buttonContainerId);
        if (container) {
            const generateBtn = container.querySelector('.btn-primary');
            this._setButtonDisabled(generateBtn, false);
            this._setButtonLoading(generateBtn, false);
        }

        if (typeof progressTracker !== 'undefined') {
            progressTracker.reset();
        }
    }

    // ─── Progress (#1 — real SSE) ───
    _updateProgress(message, progress) {
        const loadingMsg = document.getElementById('loadingMessage');
        if (loadingMsg) loadingMsg.textContent = message;

        if (typeof progressTracker !== 'undefined') {
            progressTracker.updateProgress(progress);
        }
    }

    // ─── ETA Countdown ───
    _startEtaCountdown(seconds) {
        this._stopEtaCountdown();
        this.etaSecondsRemaining = seconds;
        
        const etaText = document.getElementById('etaText');
        if (!etaText) return;
        
        etaText.style.display = 'block';
        this._updateEtaDisplay();
        
        this.etaIntervalId = setInterval(() => {
            if (this.etaSecondsRemaining > 0) {
                this.etaSecondsRemaining--;
            }
            this._updateEtaDisplay();
        }, 1000);
    }
    
    _updateEtaDisplay() {
        const etaText = document.getElementById('etaText');
        if (!etaText) return;
        
        if (this.etaSecondsRemaining <= 0) {
            etaText.textContent = "Almost done... applying finishing touches";
            return;
        }
        
        const m = Math.floor(this.etaSecondsRemaining / 60);
        const s = Math.floor(this.etaSecondsRemaining % 60);
        
        if (m > 0) {
            etaText.textContent = `Estimated time: ${m}m ${s}s`;
        } else {
            etaText.textContent = `Estimated time: ${s}s`;
        }
    }
    
    _stopEtaCountdown() {
        if (this.etaIntervalId) {
            clearInterval(this.etaIntervalId);
            this.etaIntervalId = null;
        }
        const etaText = document.getElementById('etaText');
        if (etaText) {
            etaText.textContent = '';
            etaText.style.display = 'none';
        }
    }

    // ─── Generate ───
    async generate() {
        const input = document.getElementById(this.inputId);
        const inputValue = input?.value.trim() || '';
        const loading = document.getElementById(this.loadingId);
        const error = document.getElementById(this.errorId);
        const result = document.getElementById(this.resultId);
        const container = document.getElementById(this.buttonContainerId);
        const generateBtn = container?.querySelector('.btn-primary');

        // #4 — Use textContent for error display (prevents XSS)
        error.style.display = 'none';
        result.classList.remove('active');

        if (!inputValue) {
            error.textContent = this.mode === 'text' ? 'Please enter some text content' : 'Please provide HTML content';
            error.style.display = 'block';
            return;
        }

        // Build settings
        const baseSettings = { ...this._getSettings() };
        const payload = {
            [this.inputField]: inputValue,
            ...baseSettings
        };

        if (this.mode === 'text') {
            payload.use_cache = true;
            payload.beautify_html = true;
        }

        // Disable button (#18 — CSS classes)
        this._setButtonDisabled(generateBtn, true);
        this._setButtonLoading(generateBtn, true);
        loading.classList.add('active');
        this._showCancelButton();

        // Start progress
        if (typeof progressTracker !== 'undefined') {
            progressTracker.start([
                this.mode === 'text' ? 'Sending request to AI...' : 'Processing HTML...',
                'Creating screenshots...',
                'Finalizing...'
            ]);
        }

        // #6 — AbortController for cancellation
        this.abortController = new AbortController();

        try {
            if (this.useSSE && this.mode === 'text') {
                await this._generateWithSSE(payload);
            } else {
                await this._generateWithFetch(payload);
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                // User cancelled — already handled
                return;
            }
            error.textContent = 'Error: ' + err.message;
            error.style.display = 'block';
            if (typeof notificationManager !== 'undefined') {
                notificationManager.error('Error', err.message);
            }
            if (typeof progressTracker !== 'undefined') {
                progressTracker.reset();
            }
        } finally {
            this._setButtonDisabled(generateBtn, false);
            this._setButtonLoading(generateBtn, false);
            loading.classList.remove('active');
            this._hideCancelButton();
            this._stopEtaCountdown();
            this.abortController = null;

            setTimeout(() => {
                if (typeof progressTracker !== 'undefined') progressTracker.reset();
            }, 2000);
        }
    }

    // #1 — Real SSE progress
    async _generateWithSSE(settings) {
        const error = document.getElementById(this.errorId);

        return new Promise((resolve, reject) => {
            // SSE requires GET, but we need to POST settings first
            // Use fetch with SSE-like reading via ReadableStream
            fetch('/generate-sse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
                signal: this.abortController?.signal
            }).then(response => {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                const processChunk = ({ done, value }) => {
                    if (done) {
                        resolve();
                        return;
                    }

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const event = JSON.parse(line.slice(6));
                                this._handleSSEEvent(event);

                                if (event.type === 'complete') {
                                    resolve();
                                    return;
                                }
                                if (event.type === 'error') {
                                    error.textContent = event.message;
                                    error.style.display = 'block';
                                    if (typeof notificationManager !== 'undefined') {
                                        notificationManager.error('Generation Failed', event.message);
                                    }
                                    resolve();
                                    return;
                                }
                                if (event.type === 'cancelled') {
                                    resolve();
                                    return;
                                }
                            } catch (e) {
                                console.error('SSE parse error:', e);
                            }
                        }
                    }

                    reader.read().then(processChunk).catch(reject);
                };

                reader.read().then(processChunk).catch(reject);
            }).catch(reject);
        });
    }

    _handleSSEEvent(event) {
        switch (event.type) {
            case 'started':
                this.currentOperationId = event.operation_id;
                this._updateProgress('Starting generation...', 5);
                if (event.estimated_total_seconds) {
                    this._startEtaCountdown(event.estimated_total_seconds);
                }
                break;

            case 'progress':
                this._updateProgress(event.message, event.progress);
                break;

            case 'complete':
                if (typeof progressTracker !== 'undefined') {
                    progressTracker.complete('Screenshots generated!');
                }

                const data = event.data;
                if (data.html_filename) {
                    this.lastGeneratedHtmlFile = data.html_filename;
                    this.lastGeneratedSettings = this._getSettings();
                    this.currentVersionScreenshots = data.screenshot_files;
                    this.updateButtonState('generated');
                }

                if (data.html_content) {
                    window.generatedHTML = data.html_content;
                }

                if (typeof displayResults !== 'undefined') {
                    displayResults(this.mode, data);
                }

                if (typeof notificationManager !== 'undefined') {
                    notificationManager.success(
                        'Generation Complete!',
                        `Created ${data.screenshot_count} screenshot(s)`
                    );
                }
                break;
        }
    }

    async _generateWithFetch(settings) {
        const error = document.getElementById(this.errorId);

        const response = await fetch(this.generateEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
            signal: this.abortController?.signal
        });

        const data = await response.json();

        if (data.error) {
            error.textContent = data.error;
            error.style.display = 'block';
            if (typeof notificationManager !== 'undefined') {
                notificationManager.error('Generation Failed', data.error);
            }
            if (typeof progressTracker !== 'undefined') {
                progressTracker.reset();
            }
        } else {
            if (typeof progressTracker !== 'undefined') {
                progressTracker.complete('Screenshots generated!');
            }

            if (data.html_filename) {
                this.lastGeneratedHtmlFile = data.html_filename;
                this.lastGeneratedSettings = this._getSettings();
                this.currentVersionScreenshots = data.screenshot_files;
                this.updateButtonState('generated');
            }

            if (data.html_content) {
                window.generatedHTML = data.html_content;
            }

            if (typeof displayResults !== 'undefined') {
                displayResults(this.mode, data);
            }

            if (typeof notificationManager !== 'undefined') {
                notificationManager.success(
                    'Generation Complete!',
                    `Created ${data.screenshot_count} screenshot(s)${data.performance ? ` in ${data.performance.total_time}` : ''}`
                );
            }

            if (data.performance) {
                this._displayPerformanceMetrics(data.performance);
            }
        }
    }

    // ─── Regenerate ───
    async regenerate() {
        if (!this.lastGeneratedHtmlFile) {
            if (typeof notificationManager !== 'undefined') {
                notificationManager.error('Error', 'No HTML file available for regeneration');
            }
            return;
        }

        const loading = document.getElementById(this.loadingId);
        const error = document.getElementById(this.errorId);
        const result = document.getElementById(this.resultId);
        const regenerateBtn = document.getElementById(`${this.mode}RegenerateBtn`);

        error.style.display = 'none';
        result.classList.remove('active');

        const settings = this._getSettings();

        // #18 — CSS classes
        this._setButtonDisabled(regenerateBtn, true);
        this._setButtonLoading(regenerateBtn, true);
        loading.classList.add('active');
        this._showCancelButton();

        if (typeof progressTracker !== 'undefined') {
            progressTracker.start([
                'Reading HTML file...',
                'Creating screenshots...',
                'Finalizing...'
            ]);
        }

        this.abortController = new AbortController();

        try {
            const payload = {
                ...settings,
                html_filename: this.lastGeneratedHtmlFile
            };

            const response = await fetch('/regenerate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: this.abortController.signal
            });

            const data = await response.json();

            if (data.error) {
                error.textContent = data.error;
                error.style.display = 'block';
                if (typeof notificationManager !== 'undefined') {
                    notificationManager.error('Regeneration Failed', data.error);
                }
                if (typeof progressTracker !== 'undefined') progressTracker.reset();
            } else {
                if (typeof progressTracker !== 'undefined') {
                    progressTracker.complete('Screenshots regenerated!');
                }

                this.previousVersionScreenshots = this.currentVersionScreenshots;
                this.currentVersionScreenshots = data.screenshot_files;
                this.lastGeneratedSettings = this._getSettings();
                data.html_filename = this.lastGeneratedHtmlFile;

                if (typeof displayResults !== 'undefined') {
                    displayResults(this.mode, data);
                }

                if (typeof notificationManager !== 'undefined') {
                    notificationManager.success(
                        'Regeneration Complete!',
                        `Replaced old version with ${data.screenshot_count} new screenshot(s).`
                    );
                }
            }
        } catch (err) {
            if (err.name === 'AbortError') return;
            error.textContent = 'Error: ' + err.message;
            error.style.display = 'block';
            if (typeof notificationManager !== 'undefined') {
                notificationManager.error('Error', err.message);
            }
            if (typeof progressTracker !== 'undefined') progressTracker.reset();
        } finally {
            this._setButtonDisabled(regenerateBtn, false);
            this._setButtonLoading(regenerateBtn, false);
            loading.classList.remove('active');
            this._hideCancelButton();
            this._stopEtaCountdown();
            this.abortController = null;

            setTimeout(() => {
                if (typeof progressTracker !== 'undefined') progressTracker.reset();
            }, 2000);
        }
    }

    // ─── Performance Metrics Display ───
    _displayPerformanceMetrics(performance) {
        const resultSection = document.getElementById(this.resultId);
        if (!resultSection) return;

        const existingMetrics = resultSection.querySelector('.metrics-display');
        if (existingMetrics) existingMetrics.remove();

        const metricsDiv = document.createElement('div');
        metricsDiv.className = 'metrics-display';
        metricsDiv.innerHTML = `
            <div class="metric-item">
                <span class="metric-label">Total Time:</span>
                <span class="metric-value">${performance.total_time}</span>
            </div>
            <div class="metric-item">
                <span class="metric-label">AI Processing:</span>
                <span class="metric-value">${performance.ai_time}</span>
            </div>
            <div class="metric-item">
                <span class="metric-label">Screenshot Generation:</span>
                <span class="metric-value">${performance.screenshot_time}</span>
            </div>
        `;

        const successAlert = resultSection.querySelector('.alert-success');
        if (successAlert) successAlert.after(metricsDiv);
    }
}
