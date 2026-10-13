/**
 * App Controller Module
 * Main application logic, batch processing, and UI orchestration.
 */

const App = (() => {
    // Application state
    const state = {
        records: [],        // All processed inspection records
        filteredRecords: [], // Currently filtered/displayed records
        selectedRecord: null,
        processing: false,
        processedCount: 0,
        totalToProcess: 0,
        stats: {
            total: 0,
            pass: 0,
            fail: 0,
            incomplete: 0
        },
        darkMode: false,
        searchQuery: '',
        statusFilter: 'all'
    };

    // Processing queue
    const CONCURRENCY_LIMIT = 3;
    let processingQueue = [];
    let activeWorkers = 0;
    let processedFiles = new Set();

    /**
     * Initialize the application.
     */
    async function init() {
        console.log('[App] Initializing MECH Lead Variation Inspector...');

        // Initialize PDF.js
        try {
            await PDFLoader.initialize();
            console.log('[App] PDF.js ready');
        } catch (err) {
            console.error('[App] Failed to initialize PDF.js:', err);
            showError('Failed to load PDF.js library. Check your internet connection.');
        }

        // Initialize debug panel
        DebugPanel.init();

        // Set up event listeners
        setupEventListeners();

        // Load theme preference
        loadThemePreference();

        // Update UI
        updateStats();

        console.log('[App] Initialization complete');
    }

    /**
     * Set up all event listeners.
     */
    function setupEventListeners() {
        // File input
        const fileInput = document.getElementById('file-input');
        if (fileInput) {
            fileInput.addEventListener('change', handleFileSelect);
        }

        // Drag and drop
        const dropZone = document.getElementById('drop-zone');
        if (dropZone) {
            dropZone.addEventListener('dragover', handleDragOver);
            dropZone.addEventListener('dragleave', handleDragLeave);
            dropZone.addEventListener('drop', handleDrop);
            dropZone.addEventListener('click', () => fileInput?.click());
        }

        // Load reference report button
        const loadSampleBtn = document.getElementById('load-sample-btn');
        if (loadSampleBtn) {
            loadSampleBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    showNotification('Loading reference report SA26924-0104C.pdf...', 'info');
                    const resp = await fetch('/SA26924-0104C.pdf');
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const blob = await resp.blob();
                    const file = new File([blob], 'SA26924-0104C.pdf', { type: 'application/pdf' });
                    processFiles([file]);
                } catch (err) {
                    showNotification('Failed to load reference file: ' + err.message, 'danger');
                }
            });
        }

        // Theme toggle
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', toggleTheme);
        }

        // Export buttons
        const exportAll = document.getElementById('export-all');
        if (exportAll) {
            exportAll.addEventListener('click', () => exportRecords('all'));
        }

        const exportFiltered = document.getElementById('export-filtered');
        if (exportFiltered) {
            exportFiltered.addEventListener('click', () => exportRecords('filtered'));
        }

        // Clear session
        const clearBtn = document.getElementById('clear-session');
        if (clearBtn) {
            clearBtn.addEventListener('click', clearSession);
        }

        // Search
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                state.searchQuery = e.target.value.toLowerCase();
                applyFilters();
            });
        }

        // Status filter
        const statusFilter = document.getElementById('status-filter');
        if (statusFilter) {
            statusFilter.addEventListener('change', (e) => {
                state.statusFilter = e.target.value;
                applyFilters();
            });
        }

        // Debug panel toggle
        const debugToggle = document.getElementById('toggle-debug');
        if (debugToggle) {
            debugToggle.addEventListener('click', () => DebugPanel.toggle());
        }
    }

    // =============================================
    // File Handling
    // =============================================

    function handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.add('drag-over');
    }

    function handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.remove('drag-over');
    }

    function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.remove('drag-over');

        const files = Array.from(e.dataTransfer.files).filter(f =>
            f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
        );

        if (files.length > 0) {
            processFiles(files);
        } else {
            showNotification('Please drop PDF files only.', 'warning');
        }
    }

    function handleFileSelect(e) {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            processFiles(files);
        }
        // Reset input so the same file can be selected again
        e.target.value = '';
    }

    // =============================================
    // Batch Processing
    // =============================================

    /**
     * Process an array of PDF files.
     * @param {Array<File>} files
     */
    async function processFiles(files) {
        // Filter out duplicates
        const newFiles = files.filter(f => {
            const key = f.name + '_' + f.size + '_' + f.lastModified;
            if (processedFiles.has(key)) {
                DebugPanel.log('warn', 'Batch', `Skipping duplicate: ${f.name}`);
                return false;
            }
            processedFiles.add(key);
            return true;
        });

        if (newFiles.length === 0) {
            showNotification('All selected files have already been processed.', 'info');
            return;
        }

        state.totalToProcess += newFiles.length;
        state.processing = true;
        updateProgressBar(state.processedCount, state.totalToProcess);
        showProgressBar(true);

        DebugPanel.log('info', 'Batch', `Starting batch of ${newFiles.length} files`);

        // Add to queue
        processingQueue.push(...newFiles);

        // Start processing workers
        while (activeWorkers < CONCURRENCY_LIMIT && processingQueue.length > 0) {
            processNext();
        }
    }

    /**
     * Process the next file in the queue.
     */
    async function processNext() {
        if (processingQueue.length === 0) {
            activeWorkers--;
            if (activeWorkers === 0) {
                finishBatch();
            }
            return;
        }

        activeWorkers++;
        const file = processingQueue.shift();

        try {
            updateProgressFile(file.name);
            const record = await processSingleFile(file);
            addRecord(record);
            state.processedCount++;
            updateProgressBar(state.processedCount, state.totalToProcess);
        } catch (err) {
            console.error(`[App] Error processing ${file.name}:`, err);
            DebugPanel.log('error', 'Processing', `Failed: ${file.name} — ${err.message}`);

            // Create an error record
            const errorRecord = {
                filename: file.name,
                date: '',
                jobNumber: '',
                measurements: null,
                values: null,
                status: 'INCOMPLETE',
                validation: { status: 'INCOMPLETE', warnings: [err.message] },
                metadataWarnings: ['Processing error'],
                debugInfo: { error: err.message }
            };
            addRecord(errorRecord);
            state.processedCount++;
            updateProgressBar(state.processedCount, state.totalToProcess);
        }

        activeWorkers--;
        // Process next in queue
        if (processingQueue.length > 0) {
            processNext();
        } else if (activeWorkers === 0) {
            finishBatch();
        }
    }

    /**
     * Process a single PDF file and return an inspection record.
     * @param {File} file
     * @returns {Promise<Object>} Inspection record.
     */
    async function processSingleFile(file) {
        DebugPanel.log('info', 'File', `Loading: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

        // Load and extract text items
        const pdfResult = await PDFLoader.processFile(file);
        DebugPanel.log('info', 'PDF', `Pages: ${pdfResult.pageCount}, Items: ${pdfResult.pages.reduce((s, p) => s + p.textItems.length, 0)}`);

        // Extract metadata
        const metadata = MetadataExtractor.extractFromPDFResult(pdfResult);
        DebugPanel.log('info', 'Metadata', `Date: ${metadata.date || 'N/A'}, Job: ${metadata.jobNumber || 'N/A'}`);

        // Extract fHβ measurements
        const extraction = FHBetaExtractor.extractFromPDFResult(pdfResult);

        // Build validated record
        const record = Validation.buildRecord(file.name, metadata, extraction);

        // Log the result
        DebugPanel.logExtractionResult(file.name, record);

        return record;
    }

    /**
     * Add a record to the state.
     * @param {Object} record
     */
    function addRecord(record) {
        state.records.push(record);
        updateStats();
        applyFilters();
        renderTable();
    }

    /**
     * Finish batch processing.
     */
    function finishBatch() {
        state.processing = false;
        state.processedCount = 0;
        state.totalToProcess = 0;

        showProgressBar(false);
        showNotification(
            `Processed ${state.records.length} reports: ${state.stats.pass} PASS, ${state.stats.fail} FAIL, ${state.stats.incomplete} INCOMPLETE`,
            state.stats.fail > 0 ? 'warning' : 'success'
        );

        DebugPanel.log('success', 'Batch', 'Batch processing complete');
    }

    // =============================================
    // Filtering
    // =============================================

    function applyFilters() {
        state.filteredRecords = state.records.filter(record => {
            // Status filter
            if (state.statusFilter !== 'all' && record.status !== state.statusFilter.toUpperCase()) {
                return false;
            }

            // Search filter
            if (state.searchQuery) {
                const searchable = [
                    record.filename,
                    record.date,
                    record.jobNumber,
                    record.status
                ].join(' ').toLowerCase();

                if (!searchable.includes(state.searchQuery)) {
                    return false;
                }
            }

            return true;
        });

        renderTable();
    }

    // =============================================
    // Statistics
    // =============================================

    function updateStats() {
        state.stats = {
            total: state.records.length,
            pass: state.records.filter(r => r.status === 'PASS').length,
            fail: state.records.filter(r => r.status === 'FAIL').length,
            incomplete: state.records.filter(r => r.status === 'INCOMPLETE').length
        };

        // Update stat counters in DOM
        setText('stat-total', state.stats.total);
        setText('stat-pass', state.stats.pass);
        setText('stat-fail', state.stats.fail);
        setText('stat-incomplete', state.stats.incomplete);
    }

    // =============================================
    // UI Rendering
    // =============================================

    function renderTable() {
        const tbody = document.getElementById('results-tbody');
        if (!tbody) return;

        const records = state.filteredRecords.length > 0 || state.searchQuery || state.statusFilter !== 'all'
            ? state.filteredRecords
            : state.records;

        if (records.length === 0) {
            tbody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="11">
                        <div class="empty-state">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                                <line x1="16" y1="13" x2="8" y2="13"/>
                                <line x1="16" y1="17" x2="8" y2="17"/>
                                <polyline points="10 9 9 9 8 9"/>
                            </svg>
                            <p>No inspection records yet. Upload PDF reports to begin.</p>
                        </div>
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = records.map((record, index) => {
            const statusClass = record.status.toLowerCase();
            const m = record.measurements || {};

            const valueCells = ['L33', 'L23', 'L12', 'L1', 'R1', 'R12', 'R23', 'R33'].map(col => {
                const val = m[col];
                if (val === null || val === undefined) return '<td class="value-cell empty">—</td>';

                const outOfTol = val < -30 || val > 30;
                const cellClass = outOfTol ? 'value-cell out-of-tolerance' : 'value-cell in-tolerance';
                return `<td class="${cellClass}">${val}</td>`;
            }).join('');

            return `
                <tr class="result-row ${statusClass}" data-index="${index}" onclick="App.selectRecord(${state.records.indexOf(record)})">
                    <td class="date-cell">${escapeHtml(record.date || '—')}</td>
                    <td class="job-cell">${escapeHtml(record.jobNumber || '—')}</td>
                    ${valueCells}
                    <td class="status-cell"><span class="status-badge ${statusClass}">${record.status}</span></td>
                </tr>`;
        }).join('');
    }

    /**
     * Select a record and display its detail card.
     * @param {number} index - Record index in state.records.
     */
    function selectRecord(index) {
        state.selectedRecord = state.records[index];
        renderDetailCard(state.selectedRecord);

        // Highlight selected row
        document.querySelectorAll('.result-row').forEach(row => row.classList.remove('selected'));
        const selectedRow = document.querySelector(`.result-row[data-index="${index}"]`);
        if (selectedRow) selectedRow.classList.add('selected');
    }

    /**
     * Render the inspection detail card.
     * @param {Object} record
     */
    function renderDetailCard(record) {
        const card = document.getElementById('detail-card');
        if (!card || !record) return;

        card.classList.add('visible');

        // Header info
        setText('detail-date', record.date || 'N/A');
        setText('detail-job', record.jobNumber || 'N/A');
        setText('detail-filename', record.filename);

        const statusBadge = document.getElementById('detail-status');
        if (statusBadge) {
            statusBadge.textContent = record.status;
            statusBadge.className = `status-badge ${record.status.toLowerCase()}`;
        }

        // Render tooth grids
        renderToothGrid('left-teeth', record, ['L33', 'L23', 'L12', 'L1'], ['33', '23', '12', '1']);
        renderToothGrid('right-teeth', record, ['R1', 'R12', 'R23', 'R33'], ['1', '12', '23', '33']);

        // Warnings
        const warningsEl = document.getElementById('detail-warnings');
        if (warningsEl) {
            const allWarnings = [
                ...(record.metadataWarnings || []),
                ...(record.validation?.warnings || [])
            ];

            if (allWarnings.length > 0) {
                warningsEl.innerHTML = allWarnings.map(w =>
                    `<div class="warning-item">⚠ ${escapeHtml(w)}</div>`
                ).join('');
                warningsEl.style.display = 'block';
            } else {
                warningsEl.style.display = 'none';
            }
        }
    }

    /**
     * Render a tooth grid (left or right flank).
     */
    function renderToothGrid(containerId, record, columns, labels) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const m = record.measurements || {};

        container.innerHTML = columns.map((col, i) => {
            const val = m[col];
            const isEmpty = val === null || val === undefined;
            const outOfTol = !isEmpty && (val < -30 || val > 30);

            let cellClass = 'tooth-cell';
            if (isEmpty) cellClass += ' empty';
            else if (outOfTol) cellClass += ' out-of-tolerance';
            else cellClass += ' in-tolerance';

            return `
                <div class="${cellClass}">
                    <div class="tooth-label">Tooth ${labels[i]}</div>
                    <div class="tooth-value">${isEmpty ? '—' : val}</div>
                    <div class="tooth-unit">µm</div>
                </div>`;
        }).join('');
    }

    // =============================================
    // Export
    // =============================================

    function exportRecords(scope) {
        const records = scope === 'filtered' ? state.filteredRecords : state.records;

        if (records.length === 0) {
            showNotification('No records to export.', 'warning');
            return;
        }

        const suffix = scope === 'filtered' ? '_filtered' : '';
        CSVExport.exportRecords(records, `inspection_results${suffix}_${new Date().toISOString().slice(0, 10)}.csv`);
        showNotification(`Exported ${records.length} records to CSV.`, 'success');
    }

    // =============================================
    // Session
    // =============================================

    function clearSession() {
        if (state.records.length > 0 && !confirm('Clear all processed records? This cannot be undone.')) {
            return;
        }

        state.records = [];
        state.filteredRecords = [];
        state.selectedRecord = null;
        processedFiles.clear();
        processingQueue = [];

        updateStats();
        renderTable();

        const card = document.getElementById('detail-card');
        if (card) card.classList.remove('visible');

        DebugPanel.clear();
        showNotification('Session cleared.', 'info');
    }

    // =============================================
    // Theme
    // =============================================

    function toggleTheme() {
        state.darkMode = !state.darkMode;
        document.body.classList.toggle('dark-theme', state.darkMode);
        localStorage.setItem('mech-theme', state.darkMode ? 'dark' : 'light');

        const themeIcon = document.getElementById('theme-icon');
        if (themeIcon) {
            themeIcon.textContent = state.darkMode ? '☀️' : '🌙';
        }
    }

    function loadThemePreference() {
        const saved = localStorage.getItem('mech-theme');
        if (saved === 'dark') {
            state.darkMode = true;
            document.body.classList.add('dark-theme');
            const themeIcon = document.getElementById('theme-icon');
            if (themeIcon) themeIcon.textContent = '☀️';
        }
    }

    // =============================================
    // UI Helpers
    // =============================================

    function showProgressBar(visible) {
        const bar = document.getElementById('progress-section');
        if (bar) bar.style.display = visible ? 'block' : 'none';
    }

    function updateProgressBar(current, total) {
        const fill = document.getElementById('progress-fill');
        const text = document.getElementById('progress-text');
        if (fill && total > 0) {
            const pct = Math.round((current / total) * 100);
            fill.style.width = pct + '%';
        }
        if (text) {
            text.textContent = `${current} / ${total} processed`;
        }
    }

    function updateProgressFile(filename) {
        const el = document.getElementById('progress-file');
        if (el) el.textContent = filename;
    }

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function showNotification(message, type = 'info') {
        const container = document.getElementById('notifications');
        if (!container) return;

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <span class="notification-text">${escapeHtml(message)}</span>
            <button class="notification-close" onclick="this.parentElement.remove()">&times;</button>
        `;
        container.appendChild(notification);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 300);
        }, 5000);
    }

    function showError(message) {
        showNotification(message, 'error');
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return {
        init,
        selectRecord,
        state
    };
})();

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
