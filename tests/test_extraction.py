#!/usr/bin/env python3
"""
Reference extraction test using PyMuPDF.
Validates that the extraction logic correctly identifies fHβ values
from the reference PDF.
"""
import sys
import os
import re
import json

sys.stdout.reconfigure(encoding='utf-8')

import pymupdf

# Expected reference values
EXPECTED = {
    "date": "11.10.2026",
    "job_number": "SA26924-0104C",
    "values": [1, 20, 16, 11, 1, -9, 9, -24],
    "status": "PASS"
}

TOLERANCE_MIN = -30
TOLERANCE_MAX = 30
COLUMN_LABELS = ['L33', 'L23', 'L12', 'L1', 'R1', 'R12', 'R23', 'R33']


def normalize_text(text):
    """Normalize Unicode characters."""
    result = text
    result = result.replace('\u2212', '-')  # Unicode minus
    result = result.replace('\u2013', '-')  # En dash
    result = result.replace('\u2014', '-')  # Em dash
    result = result.replace('\uF062', 'β')  # Private use beta
    result = result.replace('\uF061', 'β')  # Private use beta variant
    result = result.replace('\u03D0', 'β')  # Curly beta
    result = result.replace('\u03BC', 'µ')  # Greek mu
    return result


def group_into_rows(items, y_tolerance=3):
    """Group text items into rows by Y-coordinate proximity."""
    if not items:
        return []
    
    sorted_items = sorted(items, key=lambda i: i['y0'])
    rows = []
    current_row = None
    
    for item in sorted_items:
        if current_row is None or abs(item['y0'] - current_row['y']) > y_tolerance:
            current_row = {'y': item['y0'], 'items': [item]}
            rows.append(current_row)
        else:
            current_row['items'].append(item)
    
    for row in rows:
        row['items'].sort(key=lambda i: i['x0'])
    
    return rows


def extract_from_pdf(pdf_path):
    """Extract fHβ measurements, date, and job number from PDF."""
    doc = pymupdf.open(pdf_path)
    page = doc[0]
    text_dict = page.get_text("dict")
    
    # Build text items
    all_items = []
    for block in text_dict["blocks"]:
        if "lines" in block:
            for line in block["lines"]:
                for span in line["spans"]:
                    all_items.append({
                        'x0': span['bbox'][0],
                        'y0': span['bbox'][1],
                        'x1': span['bbox'][2],
                        'y1': span['bbox'][3],
                        'text': span['text'],
                        'normalized': normalize_text(span['text']).strip(),
                        'font': span['font']
                    })
    
    rows = group_into_rows(all_items)
    
    # --- Extract fHβ row ---
    fhb_row = None
    for i, row in enumerate(rows):
        items = row['items']
        normalized_items = [{'text': normalize_text(it['text']).strip(), 'x0': it['x0']} for it in items]
        
        has_f = any(it['text'] == 'f' for it in normalized_items)
        has_um = any(it['text'] in ('µm', 'um', 'μm') for it in normalized_items)
        
        if not (has_f and has_um):
            continue
        
        # Check nearby rows for H and β
        has_H = False
        has_beta = False
        for j in range(max(0, i-2), min(len(rows), i+3)):
            if j == i:
                continue
            if abs(rows[j]['y'] - row['y']) > 8:
                continue
            for it in rows[j]['items']:
                nt = normalize_text(it['text']).strip()
                if nt == 'H':
                    has_H = True
                if 'β' in nt:
                    has_beta = True
        
        if has_H and has_beta:
            # Count numeric values
            numbers = []
            tolerance_markers = []
            for it in normalized_items:
                t = it['text']
                if t in ('±30', '+/-30'):
                    tolerance_markers.append(it['x0'])
                    continue
                if re.match(r'^[+-]?\d+\.?\d*$', t):
                    numbers.append((it['x0'], int(t) if '.' not in t else float(t)))
            
            if len(numbers) >= 8:
                fhb_row = numbers
                break
    
    # --- Extract date ---
    date = None
    for row in rows:
        for item in row['items']:
            text = normalize_text(item['text']).strip()
            match = re.search(r'(\d{2}\.\d{2}\.\d{4})', text)
            if match:
                # Skip software dates
                if 'From' in text or 'GEAR PRO' in text:
                    continue
                date = match.group(1)
                break
        if date:
            break
    
    # --- Extract job number ---
    job_number = None
    for row in rows:
        for j, item in enumerate(row['items']):
            if 'Part number incr' in item['text']:
                # Next item in row
                remaining = row['items'][j+1:]
                for next_item in remaining:
                    val = next_item['text'].strip()
                    if val and len(val) > 1:
                        job_number = val.replace('.pdf', '').strip()
                        break
                break
        if job_number:
            break
    
    doc.close()
    
    if fhb_row:
        fhb_row.sort(key=lambda x: x[0])
        values = [v for _, v in fhb_row[:8]]
    else:
        values = None
    
    return {
        'date': date,
        'job_number': job_number,
        'values': values
    }


def run_tests(pdf_path):
    """Run all extraction tests."""
    print("=" * 60)
    print("MECH Lead Variation Inspector - Extraction Tests")
    print("=" * 60)
    
    results = extract_from_pdf(pdf_path)
    passed = 0
    failed = 0
    
    def check(name, actual, expected):
        nonlocal passed, failed
        ok = actual == expected
        status = "✅ PASS" if ok else "❌ FAIL"
        print(f"  {status}: {name}")
        if not ok:
            print(f"         Expected: {expected}")
            print(f"         Actual:   {actual}")
            failed += 1
        else:
            passed += 1
    
    # Test 1: Date extraction
    print("\n--- Date Extraction ---")
    check("Date matches expected", results['date'], EXPECTED['date'])
    
    # Test 2: Job number extraction
    print("\n--- Job Number Extraction ---")
    check("Job number matches expected", results['job_number'], EXPECTED['job_number'])
    
    # Test 3: fHβ values
    print("\n--- fHβ Value Extraction ---")
    check("Exactly 8 values extracted", 
          len(results['values']) if results['values'] else 0, 8)
    check("Values match expected",
          results['values'], EXPECTED['values'])
    
    # Test 4: Individual column mapping
    print("\n--- Column Mapping ---")
    if results['values'] and len(results['values']) == 8:
        for i, col in enumerate(COLUMN_LABELS):
            check(f"{col} = {EXPECTED['values'][i]}",
                  results['values'][i], EXPECTED['values'][i])
    
    # Test 5: Negative sign preservation
    print("\n--- Negative Sign Preservation ---")
    if results['values']:
        neg_values = [v for v in results['values'] if v < 0]
        expected_neg = [v for v in EXPECTED['values'] if v < 0]
        check("Negative values preserved", neg_values, expected_neg)
    
    # Test 6: Tolerance validation
    print("\n--- Tolerance Validation ---")
    if results['values'] and len(results['values']) == 8:
        all_in_tol = all(TOLERANCE_MIN <= v <= TOLERANCE_MAX for v in results['values'])
        status = "PASS" if all_in_tol else "FAIL"
        check("Status is PASS", status, EXPECTED['status'])
    
    # Test 7: Boundary values
    print("\n--- Boundary Tolerance Tests ---")
    check("Value +30 is in tolerance", -30 <= 30 <= 30, True)
    check("Value -30 is in tolerance", -30 <= -30 <= 30, True)
    check("Value +31 is out of tolerance", not (-30 <= 31 <= 30), True)
    check("Value -31 is out of tolerance", not (-30 <= -31 <= 30), True)
    
    # Summary
    print("\n" + "=" * 60)
    total = passed + failed
    print(f"Results: {passed}/{total} tests passed")
    if failed > 0:
        print(f"⚠️  {failed} tests FAILED")
        return 1
    else:
        print("✅ All tests PASSED")
        return 0


if __name__ == "__main__":
    pdf_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.dirname(__file__)), "SA26924-0104C.pdf"
    )
    
    if not os.path.exists(pdf_path):
        print(f"ERROR: Reference PDF not found: {pdf_path}")
        sys.exit(1)
    
    exit_code = run_tests(pdf_path)
    sys.exit(exit_code)
