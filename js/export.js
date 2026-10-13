/**
 * CSV Export Module
 * Exports inspection records to Excel-compatible CSV files.
 */

const CSVExport = (() => {
    /**
     * CSV column headers.
     */
    const HEADERS = ['Date', 'Job No', 'L33', 'L23', 'L12', 'L1', 'R1', 'R12', 'R23', 'R33', 'Status'];

    /**
     * Escape a value for CSV.
     * Handles commas, quotes, and newlines.
     * @param {*} value
     * @returns {string}
     */
    function escapeCSV(value) {
        if (value === null || value === undefined) return '';
        const str = String(value);
        // If the value contains comma, quote, or newline, wrap in quotes
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    /**
     * Convert an inspection record to a CSV row.
     * @param {Object} record - Inspection record from Validation.buildRecord.
     * @returns {string} CSV row string.
     */
    function recordToRow(record) {
        const cols = [
            record.date || '',
            record.jobNumber || ''
        ];

        // Add measurement columns
        const measurements = record.measurements;
        const measurementCols = ['L33', 'L23', 'L12', 'L1', 'R1', 'R12', 'R23', 'R33'];

        for (const col of measurementCols) {
            if (measurements && measurements[col] !== null && measurements[col] !== undefined) {
                cols.push(measurements[col]);
            } else {
                cols.push(''); // Don't export missing as zero
            }
        }

        cols.push(record.status);

        return cols.map(escapeCSV).join(',');
    }

    /**
     * Generate CSV content from an array of records.
     * @param {Array} records - Array of inspection records.
     * @returns {string} Complete CSV string with UTF-8 BOM.
     */
    function generateCSV(records) {
        const lines = [HEADERS.join(',')];
        for (const record of records) {
            lines.push(recordToRow(record));
        }
        return '\uFEFF' + lines.join('\r\n') + '\r\n';
    }

    /**
     * Download CSV content as a file.
     * @param {string} csvContent - CSV string.
     * @param {string} [filename='inspection_results.csv'] - Download filename.
     */
    function download(csvContent, filename = 'inspection_results.csv') {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    /**
     * Export records to a CSV file and trigger download.
     * @param {Array} records - Array of inspection records.
     * @param {string} [filename] - Optional filename.
     */
    function exportRecords(records, filename) {
        const csv = generateCSV(records);
        const defaultName = `inspection_results_${new Date().toISOString().slice(0, 10)}.csv`;
        download(csv, filename || defaultName);
    }

    return {
        HEADERS,
        escapeCSV,
        recordToRow,
        generateCSV,
        download,
        exportRecords
    };
})();
