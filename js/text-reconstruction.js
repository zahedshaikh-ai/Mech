/**
 * Text Reconstruction Module
 * Groups raw PDF text items into rows by Y-coordinate proximity,
 * merges adjacent character fragments into tokens/words based on X position,
 * and normalizes Unicode symbols (Greek beta, micro sign, Unicode minuses).
 */

const TextReconstruction = (() => {
    /**
     * Default tolerance for grouping text items into the same row (in points).
     */
    const DEFAULT_Y_TOLERANCE = 3.0;

    /**
     * Normalize Unicode characters commonly found in ZEISS GEAR PRO reports.
     * - Unicode minus signs → ASCII hyphen-minus (-)
     * - Micro signs (µ, μ, \u00B5, \u03BC) → µ
     * - Greek beta variants (U+F062 Symbol font, U+F061, U+03D0, U+03B2) → β
     * - Plus-minus (±)
     * - Degree sign (°)
     * @param {string} text
     * @returns {string}
     */
    function normalizeText(text) {
        if (!text) return '';

        let result = text;

        // Normalize minus signs
        result = result.replace(/[\u2212\u2013\u2014\u2015\uFE63\uFF0D]/g, '-');

        // Normalize micro/mu symbols to \u00B5
        result = result.replace(/[\u03BC\u00B5]/g, 'µ');

        // Normalize beta variants (including SymbolMT private use area U+F062)
        result = result.replace(/[\uF062\uF061\u03D0\u03B2]/g, 'β');

        // Normalize plus-minus
        result = result.replace(/[\u00B1]/g, '±');

        // Normalize degree sign
        result = result.replace(/[\u00B0]/g, '°');

        return result;
    }

    /**
     * Group text items into rows by Y-coordinate and reconstruct words/tokens.
     * @param {Array} textItems - Array of {text, x, y, width, height, fontName}
     * @param {number} [yTolerance=DEFAULT_Y_TOLERANCE]
     * @returns {Array<Object>} Array of row objects: { y, items, tokens, lineText }
     */
    function groupIntoRows(textItems, yTolerance = DEFAULT_Y_TOLERANCE) {
        if (!textItems || textItems.length === 0) return [];

        // Sort items by Y coordinate first, then X
        const sorted = [...textItems].sort((a, b) => a.y - b.y || a.x - b.x);

        const rows = [];
        let currentRow = null;

        for (const item of sorted) {
            if (currentRow === null || Math.abs(item.y - currentRow.y) > yTolerance) {
                // Start a new row
                currentRow = {
                    y: item.y,
                    items: [item]
                };
                rows.push(currentRow);
            } else {
                currentRow.items.push(item);
                // Update row Y to running average for stable grouping
                const sumY = currentRow.items.reduce((s, i) => s + i.y, 0);
                currentRow.y = sumY / currentRow.items.length;
            }
        }

        // For each row, sort items by X coordinate and merge adjacent character fragments into tokens
        for (const row of rows) {
            row.items.sort((a, b) => a.x - b.x);

            const tokens = [];
            let curToken = null;

            for (const it of row.items) {
                const norm = normalizeText(it.text);
                if (norm === ' ') {
                    if (curToken) { tokens.push(curToken); curToken = null; }
                    continue;
                }
                const itemWidth = it.width || 5.0;

                if (!curToken) {
                    curToken = {
                        str: norm,
                        x: it.x,
                        endX: it.x + itemWidth,
                        y: it.y,
                        items: [it]
                    };
                } else {
                    const gap = it.x - curToken.endX;
                    // If characters are contiguous (gap <= 3.5pt and >= -3.0pt), merge into token
                    if (gap <= 3.5 && gap >= -3.0) {
                        curToken.str += norm;
                        curToken.endX = it.x + itemWidth;
                        curToken.items.push(it);
                    } else {
                        tokens.push(curToken);
                        curToken = {
                            str: norm,
                            x: it.x,
                            endX: it.x + itemWidth,
                            y: it.y,
                            items: [it]
                        };
                    }
                }
            }
            if (curToken) tokens.push(curToken);

            row.tokens = tokens;
            row.lineText = tokens.map(t => t.str).join(' ');
        }

        return rows;
    }

    /**
     * Find the fHβ row by searching across reconstructed rows.
     * Looks for fHβ + µm, explicitly distinguishing from Fβ and ffβ.
     * @param {Array} rows - Grouped rows with tokens.
     * @returns {Object|null} The measurement row info or null.
     */
    function findFHBetaRow(rows) {
        // Strategy 1: Look for rows containing fHβ (or fH and β) and µm/um
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const text = row.lineText;

            const hasFHB = text.includes('fHβ') || (text.includes('fH') && text.includes('β')) ||
                           row.tokens.some(t => t.str === 'fHβ');
            const hasMuM = text.includes('µm') || text.includes('um') || text.includes('μm');

            // Strictly exclude ffβ and Fβ rows
            const isFF = text.includes('ffβ') || text.includes('ff');
            const isF = text.startsWith('Fβ') || text.startsWith('F ');

            if (hasFHB && hasMuM && !isFF && !isF) {
                // Verify row has at least 4 numeric tokens
                const numbers = row.tokens.filter(t => /^[+-]?\d+(\.\d+)?$/.test(t.str));
                if (numbers.length >= 4) {
                    return {
                        rowIndex: i,
                        y: row.y,
                        items: row.items,
                        tokens: row.tokens,
                        lineText: row.lineText,
                        source: 'fHβ-row'
                    };
                }
            }
        }

        // Strategy 2: If characters were slightly separated vertically, check adjacent rows
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const text = row.lineText;
            const hasF = row.tokens.some(t => t.str === 'f');
            const hasMuM = text.includes('µm') || text.includes('um') || text.includes('μm');
            const isFF = text.includes('ffβ') || text.includes('ff');

            if (hasF && hasMuM && !isFF) {
                let hasHOrBeta = false;
                for (let j = Math.max(0, i - 2); j <= Math.min(rows.length - 1, i + 2); j++) {
                    if (j === i) continue;
                    const near = rows[j];
                    if (Math.abs(near.y - row.y) > 8) continue;
                    if (near.lineText.includes('H') || near.lineText.includes('β')) {
                        hasHOrBeta = true;
                        break;
                    }
                }
                if (hasHOrBeta) {
                    const numbers = row.tokens.filter(t => /^[+-]?\d+(\.\d+)?$/.test(t.str));
                    if (numbers.length >= 4) {
                        return {
                            rowIndex: i,
                            y: row.y,
                            items: row.items,
                            tokens: row.tokens,
                            lineText: row.lineText,
                            source: 'fHβ-adjacent'
                        };
                    }
                }
            }
        }

        return null;
    }

    return {
        normalizeText,
        groupIntoRows,
        findFHBetaRow,
        DEFAULT_Y_TOLERANCE
    };
})();
