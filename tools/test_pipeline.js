const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

// Load modules
function normalizeText(text) {
    if (!text) return '';
    let result = text;
    result = result.replace(/[\u2212\u2013\u2014\u2015\uFE63\uFF0D]/g, '-');
    result = result.replace(/[\u00B5\u03BC]/g, 'µ');
    result = result.replace(/[\uF062\uF061\u03D0]/g, 'β');
    result = result.replace(/[\u00B1]/g, '±');
    return result;
}

async function testExtraction() {
    const data = new Uint8Array(fs.readFileSync('SA26924-0104C.pdf'));
    const doc = await pdfjsLib.getDocument({ data }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1.0 });
    const textContent = await page.getTextContent();

    // 1. Extract text items with proper coordinates
    const items = [];
    let fullStreamText = '';
    for (const item of textContent.items) {
        if (!item.str && item.str !== '0') continue;
        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
        items.push({
            str: item.str,
            x: tx[4],
            y: tx[5],
            w: item.width,
            h: item.height,
            transform: item.transform
        });
        fullStreamText += item.str;
    }

    // 2. Group into rows by Y
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    let curRow = null;
    for (const it of items) {
        if (!curRow || Math.abs(it.y - curRow.y) > 3.0) {
            curRow = { y: it.y, items: [it] };
            rows.push(curRow);
        } else {
            curRow.items.push(it);
            curRow.y = curRow.items.reduce((s, i) => s + i.y, 0) / curRow.items.length;
        }
    }

    // 3. For each row, sort by X and merge adjacent characters into tokens
    for (const row of rows) {
        row.items.sort((a, b) => a.x - b.x);
        const tokens = [];
        let curToken = null;
        for (const it of row.items) {
            const normalizedStr = normalizeText(it.str);
            if (normalizedStr === ' ') {
                if (curToken) { tokens.push(curToken); curToken = null; }
                continue;
            }
            if (!curToken) {
                curToken = { str: normalizedStr, x: it.x, endX: it.x + it.w, y: it.y };
            } else {
                const gap = it.x - curToken.endX;
                if (gap <= 3.5 && gap >= -3.0) {
                    curToken.str += normalizedStr;
                    curToken.endX = it.x + it.w;
                } else {
                    tokens.push(curToken);
                    curToken = { str: normalizedStr, x: it.x, endX: it.x + it.w, y: it.y };
                }
            }
        }
        if (curToken) tokens.push(curToken);
        row.tokens = tokens;
        row.lineText = tokens.map(t => t.str).join(' ');
    }

    // 4. Extract Date
    let date = null;
    // Check tokens first
    const dateRegex = /(\d{2}\.\d{2}\.\d{4})/;
    for (const row of rows) {
        if (row.lineText.includes('From') || row.lineText.includes('GEAR PRO')) continue;
        const m = row.lineText.match(dateRegex);
        if (m) { date = m[1]; break; }
    }
    // If not found in horizontal rows, check stream for rotated margin date
    if (!date) {
        const streamMatch = fullStreamText.match(/Date[:.]\s*(\d{2}\.\d{2}\.\d{4})/i) ||
                            fullStreamText.match(/(\d{2}\.\d{2}\.\d{4})\s+\d{2}:\d{2}:\d{2}/);
        if (streamMatch) date = streamMatch[1];
    }
    console.log('Extracted Date:', date);

    // 5. Extract Job Number (Part number incr.)
    let jobNumber = null;
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        for (let j = 0; j < row.tokens.length; j++) {
            const token = row.tokens[j];
            if (token.str.includes('Part') || token.str.includes('incr')) {
                // Find next token with alphanumeric value
                for (let k = j + 1; k < row.tokens.length; k++) {
                    const nextTok = row.tokens[k].str.trim();
                    if (nextTok === 'number' || nextTok === 'incr.' || nextTok === 'incr' || nextTok === ':') continue;
                    if (nextTok.length >= 3) {
                        jobNumber = nextTok.replace(/\.pdf$/i, '');
                        break;
                    }
                }
            }
            if (jobNumber) break;
        }
        if (jobNumber) break;
    }
    console.log('Extracted Job Number:', jobNumber);

    // 6. Extract fHβ measurements
    let fhbRow = null;
    for (const row of rows) {
        // Look for row that has fHβ (or fH and β) and µm
        const text = row.lineText;
        const hasFHB = text.includes('fHβ') || (text.includes('fH') && text.includes('β')) ||
                       (row.tokens.some(t => t.str === 'fHβ' || t.str === 'f' || t.str === 'H'));
        const hasMuM = text.includes('µm') || text.includes('um') || text.includes('μm');
        const isNotFF = !text.includes('ffβ') && !text.includes('ff');
        const isNotF = !text.startsWith('Fβ') && !text.startsWith('F ');

        if (hasFHB && hasMuM && isNotFF) {
            fhbRow = row;
            break;
        }
    }

    if (!fhbRow) {
        console.error('fHβ row NOT found!');
        return;
    }

    console.log('Found fHβ row at Y=' + fhbRow.y.toFixed(1) + ':', fhbRow.lineText);

    // Find tolerance markers in the fHβ row
    const tolMarkers = fhbRow.tokens.filter(t => t.str === '±30' || t.str === '+/-30' || t.str === '+30' || t.str === '-30');
    console.log('Tolerance markers found:', tolMarkers.map(t => `${t.str} at x=${t.x}`));

    let minX = 180;
    let maxX = 520;
    if (tolMarkers.length >= 2) {
        minX = Math.min(tolMarkers[0].x, tolMarkers[1].x) + 5;
        maxX = Math.max(tolMarkers[0].x, tolMarkers[1].x) - 5;
    } else if (tolMarkers.length === 1) {
        minX = tolMarkers[0].x + 5;
    }

    // Filter numbers between tolerance markers
    const numericTokens = [];
    for (const tok of fhbRow.tokens) {
        if (tok.x < minX || tok.x > maxX) continue;
        if (/^[+-]?\d+(\.\d+)?$/.test(tok.str)) {
            numericTokens.push({
                x: tok.x,
                val: parseFloat(tok.str)
            });
        }
    }

    numericTokens.sort((a, b) => a.x - b.x);
    const values = numericTokens.map(n => n.val);
    console.log('Extracted values:', values);

    // Expected assertions:
    const expectedValues = [1, 20, 16, 11, 1, -9, 9, -24];
    const match = JSON.stringify(values) === JSON.stringify(expectedValues);
    console.log('Values match expected [1, 20, 16, 11, 1, -9, 9, -24]?', match);
    console.log('Date match 11.10.2026?', date === '11.10.2026');
    console.log('Job Number match SA26924-0104C?', jobNumber === 'SA26924-0104C');
}

testExtraction().catch(console.error);
