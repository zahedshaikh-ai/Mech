const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

async function main() {
    const data = new Uint8Array(fs.readFileSync('SA26924-0104C.pdf'));
    const doc = await pdfjsLib.getDocument({ data }).promise;
    
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1.0 });
    const textContent = await page.getTextContent();
    
    const items = [];
    for (const item of textContent.items) {
        if (!item.str && item.str !== '0') continue;
        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
        // DO NOT flip y: tx[5] is already measured from top (0 at top, 842 at bottom)
        const x = tx[4];
        const y = tx[5];
        items.push({
            str: item.str,
            x: Math.round(x * 100) / 100,
            y: Math.round(y * 100) / 100,
            w: Math.round(item.width * 100) / 100,
            h: Math.round(item.height * 100) / 100
        });
    }

    // Group items into rows by Y (within 3pt)
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    let curRow = null;
    for (const it of items) {
        if (!curRow || Math.abs(it.y - curRow.y) > 3) {
            curRow = { y: it.y, items: [it] };
            rows.push(curRow);
        } else {
            curRow.items.push(it);
            curRow.y = curRow.items.reduce((s, i) => s + i.y, 0) / curRow.items.length;
        }
    }

    console.log(`Grouped into ${rows.length} rows.`);

    // For each row, merge adjacent characters into tokens!
    for (const row of rows) {
        row.items.sort((a, b) => a.x - b.x);

        // Merge adjacent characters: if gap <= 3, merge
        const tokens = [];
        let curToken = null;
        for (const it of row.items) {
            if (it.str === ' ') {
                if (curToken) { tokens.push(curToken); curToken = null; }
                continue;
            }
            if (!curToken) {
                curToken = { str: it.str, x: it.x, endX: it.x + it.w, y: it.y };
            } else {
                const gap = it.x - curToken.endX;
                // If characters are close (gap <= 3pt), concatenate
                if (gap <= 3.5 && gap >= -3) {
                    curToken.str += it.str;
                    curToken.endX = it.x + it.w;
                } else {
                    tokens.push(curToken);
                    curToken = { str: it.str, x: it.x, endX: it.x + it.w, y: it.y };
                }
            }
        }
        if (curToken) tokens.push(curToken);
        row.tokens = tokens;
        row.text = tokens.map(t => t.str).join(' ');

        // Print rows that have measurements or key labels
        if (row.y >= 715 && row.y <= 730 || row.text.includes('SA26924') || row.text.includes('11.10.2026') || row.text.includes('Part number')) {
            console.log(`\nY~${row.y.toFixed(1)}: "${row.text}"`);
            console.log('  Tokens:', tokens.map(t => `"${t.str}" (x=${t.x})`).join(', '));
        }
    }
}

main().catch(console.error);
