/**
 * Debug Panel Module
 * Provides diagnostic information about PDF extraction for troubleshooting.
 */

const DebugPanel = (() => {
    let panelElement = null;
    let logEntries = [];
    let isVisible = false;

    /**
     * Initialize the debug panel.
     */
    function init() {
        panelElement = document.getElementById('debug-panel');
        const toggleBtn = document.getElementById('toggle-debug');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', toggle);
        }
    }

    /**
     * Toggle debug panel visibility.
     */
    function toggle() {
        isVisible = !isVisible;
        if (panelElement) {
            panelElement.classList.toggle('visible', isVisible);
        }
        const toggleBtn = document.getElementById('toggle-debug');
        if (toggleBtn) {
            toggleBtn.textContent = isVisible ? 'Hide Debug' : 'Show Debug';
        }
    }

    /**
     * Log a message to the debug panel.
     * @param {string} level - 'info', 'warn', 'error', 'success'.
     * @param {string} category - Category label (e.g., 'PDF', 'Extraction').
     * @param {string} message - Log message.
     * @param {*} [data] - Optional data to display.
     */
    function log(level, category, message, data) {
        const entry = {
            timestamp: new Date().toLocaleTimeString(),
            level,
            category,
            message,
            data
        };
        logEntries.push(entry);
        renderEntry(entry);
    }

    /**
     * Render a single log entry.
     * @param {Object} entry
     */
    function renderEntry(entry) {
        const logContent = document.getElementById('debug-log');
        if (!logContent) return;

        const div = document.createElement('div');
        div.className = `debug-entry debug-${entry.level}`;

        let html = `<span class="debug-time">${entry.timestamp}</span>`;
        html += `<span class="debug-category">[${entry.category}]</span>`;
        html += `<span class="debug-message">${entry.message}</span>`;

        if (entry.data !== undefined) {
            const dataStr = typeof entry.data === 'object'
                ? JSON.stringify(entry.data, null, 2)
                : String(entry.data);
            html += `<pre class="debug-data">${escapeHtml(dataStr)}</pre>`;
        }

        div.innerHTML = html;
        logContent.appendChild(div);
        logContent.scrollTop = logContent.scrollHeight;
    }

    /**
     * Clear all log entries.
     */
    function clear() {
        logEntries = [];
        const logContent = document.getElementById('debug-log');
        if (logContent) {
            logContent.innerHTML = '';
        }
    }

    /**
     * Log extraction debug info for a record.
     * @param {string} filename
     * @param {Object} record
     */
    function logExtractionResult(filename, record) {
        log('info', 'File', `Processing: ${filename}`);

        if (record.debugInfo) {
            const ext = record.debugInfo.extraction;
            if (ext) {
                log('info', 'Extraction', `Rows found: ${ext.rowsFound || 'N/A'}`);
                if (ext.strategy) {
                    log('info', 'Extraction', `Strategy: ${ext.strategy}`);
                }
                if (ext.allNumbers && ext.allNumbers.length > 0) {
                    log('info', 'Extraction', `Numbers found: ${ext.allNumbers.map(n => n.value).join(', ')}`);
                }
                if (ext.warnings) {
                    for (const w of ext.warnings) {
                        log('warn', 'Extraction', w);
                    }
                }
            }

            const meta = record.debugInfo.metadata;
            if (meta && meta.warnings) {
                for (const w of meta.warnings) {
                    log('warn', 'Metadata', w);
                }
            }
        }

        if (record.values) {
            log('success', 'Result', `Values: [${record.values.join(', ')}]`);
        }
        log(
            record.status === 'PASS' ? 'success' : record.status === 'FAIL' ? 'error' : 'warn',
            'Status',
            `${record.status} — Date: ${record.date || 'N/A'}, Job: ${record.jobNumber || 'N/A'}`
        );
    }

    /**
     * Escape HTML entities.
     * @param {string} str
     * @returns {string}
     */
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return {
        init,
        toggle,
        log,
        clear,
        logExtractionResult
    };
})();
