/**
 * Metadata Extractor Module
 * Extracts inspection date and job number (Part number incr.) from PDF text items and streams.
 */

const MetadataExtractor = (() => {
    /**
     * Extract the inspection date from text items and/or full stream text.
     * Looks for "Date:" or "Date." label and associated date value (DD.MM.YYYY).
     * Also handles rotated margin timestamps "DD.MM.YYYY HH:MM:SS".
     * Explicitly ignores software footer release dates (e.g. "From 24.06.2015").
     * @param {Array} textItems - Raw text items from PDFLoader.
     * @param {string} [fullStreamText=''] - Full text stream of the page.
     * @returns {Object} { date, source, debugInfo }
     */
    function extractDate(textItems, fullStreamText = '') {
        const result = {
            date: null,
            source: null,
            debugInfo: {
                candidates: [],
                warnings: []
            }
        };

        const dateRegex = /(\d{2}\.\d{2}\.\d{4})/;

        // Strategy 1: Check grouped row tokens
        if (textItems && textItems.length > 0) {
            const rows = TextReconstruction.groupIntoRows(textItems);

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const line = row.lineText || '';

                // Skip software version / release dates
                if (line.includes('From') || line.includes('GEAR PRO')) continue;

                // Check for Date label
                if (line.includes('Date:') || line.includes('Date.') || line.includes('Date')) {
                    const match = line.match(dateRegex);
                    if (match) {
                        result.date = match[1];
                        result.source = 'date-label-row';
                        result.debugInfo.candidates.push({ text: line, match: match[1] });
                        return result;
                    }

                    // Check adjacent rows
                    for (let j = Math.max(0, i - 1); j <= Math.min(rows.length - 1, i + 2); j++) {
                        const adjLine = rows[j].lineText || '';
                        if (adjLine.includes('From') || adjLine.includes('GEAR PRO')) continue;
                        const adjMatch = adjLine.match(dateRegex);
                        if (adjMatch) {
                            result.date = adjMatch[1];
                            result.source = 'date-label-nearby-row';
                            result.debugInfo.candidates.push({ text: adjLine, match: adjMatch[1] });
                            return result;
                        }
                    }
                }

                // Check for standalone timestamp "DD.MM.YYYY HH:MM:SS"
                const tsMatch = line.match(/(\d{2}\.\d{2}\.\d{4})\s+\d{2}:\d{2}:\d{2}/);
                if (tsMatch) {
                    result.date = tsMatch[1];
                    result.source = 'timestamp-pattern-row';
                    result.debugInfo.candidates.push({ text: line, match: tsMatch[1] });
                    return result;
                }
            }
        }

        // Strategy 2: If not found in horizontal rows, inspect stream for rotated margin date
        if (!result.date && fullStreamText) {
            // First look for Date: label pattern
            const dateLabelMatch = fullStreamText.match(/Date[:.]\s*(\d{2}\.\d{2}\.\d{4})/i);
            if (dateLabelMatch) {
                result.date = dateLabelMatch[1];
                result.source = 'date-label-stream';
                result.debugInfo.candidates.push({ text: 'fullStreamText', match: dateLabelMatch[1] });
                return result;
            }

            // Look for timestamp pattern
            const tsStreamMatch = fullStreamText.match(/(\d{2}\.\d{2}\.\d{4})\s+\d{2}:\d{2}:\d{2}/);
            if (tsStreamMatch) {
                result.date = tsStreamMatch[1];
                result.source = 'timestamp-stream';
                result.debugInfo.candidates.push({ text: 'fullStreamText', match: tsStreamMatch[1] });
                return result;
            }
        }

        if (!result.date) {
            result.debugInfo.warnings.push('No inspection date found in document');
        }

        return result;
    }

    /**
     * Extract the job number from the "Part number incr." field.
     * @param {Array} textItems - Raw text items from PDFLoader.
     * @param {string} [fullStreamText=''] - Full text stream of the page.
     * @returns {Object} { jobNumber, source, debugInfo }
     */
    function extractJobNumber(textItems, fullStreamText = '') {
        const result = {
            jobNumber: null,
            source: null,
            debugInfo: {
                candidates: [],
                warnings: []
            }
        };

        // Strategy 1: Check grouped row tokens
        if (textItems && textItems.length > 0) {
            const rows = TextReconstruction.groupIntoRows(textItems);

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (!row.tokens) continue;

                for (let j = 0; j < row.tokens.length; j++) {
                    const token = row.tokens[j];
                    const str = token.str;

                    // Match label tokens
                    if (str.includes('Part') || str.includes('incr')) {
                        // Look at subsequent tokens in this row
                        for (let k = j + 1; k < row.tokens.length; k++) {
                            const nextTok = row.tokens[k].str.trim();
                            // Skip label pieces
                            if (nextTok === 'number' || nextTok === 'incr.' || nextTok === 'incr' || nextTok === ':') continue;

                            if (nextTok.length >= 3 && /[A-Za-z0-9]/.test(nextTok)) {
                                let val = nextTok.replace(/\.pdf$/i, '');
                                result.jobNumber = val;
                                result.source = 'part-number-token';
                                result.debugInfo.candidates.push({ label: str, value: val });
                                return result;
                            }
                        }
                    }
                }
            }
        }

        // Strategy 2: Stream regex fallback
        if (!result.jobNumber && fullStreamText) {
            const streamMatch = fullStreamText.match(/Part\s*number\s*incr\.?\s*([A-Za-z0-9\-]+)/i);
            if (streamMatch) {
                let val = streamMatch[1].replace(/\.pdf$/i, '');
                result.jobNumber = val;
                result.source = 'part-number-stream';
                result.debugInfo.candidates.push({ text: 'fullStreamText', value: val });
                return result;
            }
        }

        if (!result.jobNumber) {
            result.debugInfo.warnings.push('No "Part number incr." job number found');
        }

        return result;
    }

    /**
     * Extract all metadata from text items and/or fullStreamText.
     * @param {Array} textItems
     * @param {string} [fullStreamText='']
     * @returns {Object} Combined metadata result.
     */
    function extractAll(textItems, fullStreamText = '') {
        const dateResult = extractDate(textItems, fullStreamText);
        const jobResult = extractJobNumber(textItems, fullStreamText);

        return {
            date: dateResult.date,
            jobNumber: jobResult.jobNumber,
            debugInfo: {
                date: dateResult,
                jobNumber: jobResult,
                warnings: [
                    ...dateResult.debugInfo.warnings,
                    ...jobResult.debugInfo.warnings
                ]
            }
        };
    }

    /**
     * Extract metadata from a complete PDF processing result.
     * @param {Object} pdfResult - Result from PDFLoader.processFile.
     * @returns {Object} Combined metadata.
     */
    function extractFromPDFResult(pdfResult) {
        if (!pdfResult || !pdfResult.pages || pdfResult.pages.length === 0) {
            return {
                date: null,
                jobNumber: null,
                debugInfo: { warnings: ['No pages in PDF result'] }
            };
        }

        const page = pdfResult.pages[0];
        return extractAll(page.textItems, page.fullStreamText || '');
    }

    return {
        extractDate,
        extractJobNumber,
        extractAll,
        extractFromPDFResult
    };
})();
