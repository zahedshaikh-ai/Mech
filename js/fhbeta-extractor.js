/**
 * fHβ Extractor Module
 * Extracts exactly eight lead slope deviation measurements from the fHβ µm row.
 */

const FHBetaExtractor = (() => {
    /**
     * Column labels for the eight measurement positions.
     * Left flank: L33, L23, L12, L1
     * Right flank: R1, R12, R23, R33
     */
    const COLUMN_LABELS = ['L33', 'L23', 'L12', 'L1', 'R1', 'R12', 'R23', 'R33'];

    /**
     * Extract the eight fHβ measurement values from a set of text items on a page.
     * @param {Array} textItems - Raw text items from PDFLoader.extractTextItems.
     * @returns {Object} Extraction result with values, debug info, and status.
     */
    function extract(textItems) {
        const result = {
            success: false,
            values: null,
            columnMap: null,
            rawRow: null,
            debugInfo: {
                rowsFound: 0,
                candidateRow: null,
                strategy: null,
                allNumbers: [],
                toleranceMarkers: [],
                warnings: []
            }
        };

        if (!textItems || textItems.length === 0) {
            result.debugInfo.warnings.push('No text items provided');
            return result;
        }

        // Step 1: Group text items into rows and reconstruct tokens
        const rows = TextReconstruction.groupIntoRows(textItems);
        result.debugInfo.rowsFound = rows.length;

        // Step 2: Find the fHβ row
        const fhbRow = TextReconstruction.findFHBetaRow(rows);

        if (!fhbRow) {
            result.debugInfo.warnings.push('Could not locate fHβ row in the document');
            return result;
        }

        result.debugInfo.candidateRow = {
            y: fhbRow.y,
            source: fhbRow.source,
            lineText: fhbRow.lineText,
            tokenCount: fhbRow.tokens ? fhbRow.tokens.length : 0
        };

        // Step 3: Find tolerance markers (±30, +/-30)
        const tolMarkers = [];
        for (const tok of fhbRow.tokens) {
            const str = tok.str;
            if (str === '±30' || str === '+/-30' || str === '± 30' || str === '+30' || str === '-30') {
                tolMarkers.push(tok);
                result.debugInfo.toleranceMarkers.push(`${str} at x=${tok.x.toFixed(1)}`);
            }
        }

        // Determine bounding X interval for measurements
        let minX = 180;
        let maxX = 520;
        if (tolMarkers.length >= 2) {
            minX = Math.min(tolMarkers[0].x, tolMarkers[1].x) + 5;
            maxX = Math.max(tolMarkers[0].x, tolMarkers[1].x) - 5;
        } else if (tolMarkers.length === 1) {
            minX = tolMarkers[0].x + 5;
        }

        // Step 4: Extract numeric tokens between tolerance markers
        const numericTokens = [];
        for (const tok of fhbRow.tokens) {
            const str = tok.str;
            // Skip tokens outside measurement table columns
            if (tok.x < minX || tok.x > maxX) continue;

            // Check if signed integer or float
            if (/^[+-]?\d+(\.\d+)?$/.test(str)) {
                const val = str.includes('.') ? parseFloat(str) : parseInt(str, 10);
                numericTokens.push({
                    x: tok.x,
                    value: val,
                    str: str
                });
            }
        }

        // Sort by visual X coordinate (left to right)
        numericTokens.sort((a, b) => a.x - b.x);

        result.debugInfo.allNumbers = numericTokens.map(n => ({
            x: Math.round(n.x * 100) / 100,
            value: n.value,
            text: n.str
        }));

        // Step 5: Validate we have exactly 8 numeric values
        if (numericTokens.length !== 8) {
            result.debugInfo.warnings.push(
                `Expected exactly 8 numeric values, found ${numericTokens.length}: [${numericTokens.map(n => n.value).join(', ')}]`
            );
            return result;
        }

        // Step 6: Map to column labels
        const values = numericTokens.map(n => n.value);
        const columnMap = {};
        for (let i = 0; i < 8; i++) {
            columnMap[COLUMN_LABELS[i]] = values[i];
        }

        result.success = true;
        result.values = values;
        result.columnMap = columnMap;
        result.rawRow = numericTokens.map(n => n.str).join(' | ');
        result.debugInfo.strategy = fhbRow.source;

        return result;
    }

    /**
     * Extract measurements from a complete PDF processing result.
     * @param {Object} pdfResult - Result from PDFLoader.processFile.
     * @returns {Object} Extraction result.
     */
    function extractFromPDFResult(pdfResult) {
        if (!pdfResult || !pdfResult.pages || pdfResult.pages.length === 0) {
            return {
                success: false,
                values: null,
                columnMap: null,
                rawRow: null,
                debugInfo: {
                    warnings: ['No pages in PDF result']
                }
            };
        }

        // Try each page (measurements typically on page 1)
        for (const page of pdfResult.pages) {
            const result = extract(page.textItems);
            if (result.success) {
                result.debugInfo.pageNumber = page.pageNumber;
                return result;
            }
        }

        // Fallback to first page result with warnings
        const firstPageResult = extract(pdfResult.pages[0].textItems);
        firstPageResult.debugInfo.warnings.push('No page contained a valid fHβ row');
        return firstPageResult;
    }

    return {
        COLUMN_LABELS,
        extract,
        extractFromPDFResult
    };
})();
