#!/usr/bin/env python3
"""
PDF Diagnostic Tool for ZEISS GEAR PRO Reports.
Inspects PDF structure, text items, bounding boxes, and reconstructed rows.
"""
import sys
import os
import json
import re

# Force UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

import pymupdf

def inspect_pdf(pdf_path):
    doc = pymupdf.open(pdf_path)
    print(f"=== PDF: {pdf_path} ===")
    print(f"Pages: {len(doc)}")
    
    for page_num in range(len(doc)):
        page = doc[page_num]
        print(f"\n--- Page {page_num + 1} ---")
        print(f"  Dimensions: {page.rect.width} x {page.rect.height}")
        print(f"  Rotation: {page.rotation}")
        
        # Extract words with positions
        words = page.get_text("words")
        print(f"  Total words: {len(words)}")
        
        # Extract blocks
        blocks = page.get_text("blocks")
        print(f"  Total blocks: {len(blocks)}")
        
        # Extract detailed dict
        text_dict = page.get_text("dict")
        
        # Print all text items with positions
        print("\n  === ALL TEXT ITEMS (x0, y0, x1, y1, text, hex) ===")
        all_items = []
        for block in text_dict["blocks"]:
            if "lines" in block:
                for line in block["lines"]:
                    for span in line["spans"]:
                        text = span["text"]
                        # Build hex representation for non-ASCII
                        hex_repr = ""
                        for ch in text:
                            if ord(ch) > 127:
                                hex_repr += f"U+{ord(ch):04X} "
                        
                        item = {
                            "x0": round(span["bbox"][0], 2),
                            "y0": round(span["bbox"][1], 2),
                            "x1": round(span["bbox"][2], 2),
                            "y1": round(span["bbox"][3], 2),
                            "text": text,
                            "hex": hex_repr.strip(),
                            "size": round(span["size"], 2),
                            "font": span["font"]
                        }
                        all_items.append(item)
                        
        # Sort by Y then X for reading order
        all_items.sort(key=lambda i: (round(i["y0"] / 3) * 3, i["x0"]))
        
        for item in all_items:
            hex_info = f" [{item['hex']}]" if item['hex'] else ""
            print(f"    ({item['x0']:7.2f}, {item['y0']:7.2f}, {item['x1']:7.2f}, {item['y1']:7.2f}) "
                  f"[{item['size']:5.1f} {item['font'][:20]:20s}] \"{item['text']}\"{hex_info}")
        
        # Find fHβ related items - search with various encodings
        print("\n  === ITEMS CONTAINING fH, beta, mu ===")
        for item in all_items:
            text = item["text"]
            text_lower = text.lower()
            # Check for various beta representations
            has_match = False
            for ch in text:
                cp = ord(ch)
                # Greek beta: U+03B2, U+03D0, U+F062 (Symbol font), U+F061
                if cp in (0x03B2, 0x03D0, 0xF062, 0xF061):
                    has_match = True
                # Mu: U+00B5, U+03BC
                if cp in (0x00B5, 0x03BC):
                    has_match = True
            if any(k in text_lower for k in ["fh", "beta", "mu", "um"]):
                has_match = True
            if has_match:
                hex_info = f" [{item['hex']}]" if item['hex'] else ""
                print(f"    ({item['x0']:7.2f}, {item['y0']:7.2f}) \"{item['text']}\"{hex_info}")
        
        # Reconstruct rows by Y-coordinate grouping
        print("\n  === RECONSTRUCTED ROWS (Y-grouped, tolerance=3pt) ===")
        rows = {}
        for item in all_items:
            y_key = round(item["y0"] / 3) * 3
            if y_key not in rows:
                rows[y_key] = []
            rows[y_key].append(item)
        
        for y_key in sorted(rows.keys()):
            row_items = sorted(rows[y_key], key=lambda i: i["x0"])
            row_text = " | ".join(f"{i['text']}" for i in row_items)
            print(f"    Y~{y_key:7.1f}: {row_text}")
        
        # Find rows that contain fH or beta-like characters
        print("\n  === CANDIDATE fHb ROWS (checking Unicode too) ===")
        for y_key in sorted(rows.keys()):
            row_items = sorted(rows[y_key], key=lambda i: i["x0"])
            row_text = " ".join(i["text"] for i in row_items)
            
            is_candidate = False
            if "fH" in row_text:
                is_candidate = True
            # Check for private-use beta chars
            for item in row_items:
                for ch in item["text"]:
                    if ord(ch) in (0x03B2, 0x03D0, 0xF062, 0xF061):
                        if any("fH" in i["text"] or "f" in i["text"] for i in row_items):
                            is_candidate = True
            
            if is_candidate:
                print(f"    Y~{y_key:7.1f}: {row_text}")
                print(f"      Items ({len(row_items)}):")
                for i in row_items:
                    hex_info = f" [{i['hex']}]" if i['hex'] else ""
                    print(f"        x={i['x0']:7.2f} \"{i['text']}\"{hex_info}")
        
        # Look for "Date" and "Part number" 
        print("\n  === DATE AND PART NUMBER ITEMS ===")
        for item in all_items:
            if any(k in item["text"] for k in ["Date", "Part number", "Part"]):
                print(f"    ({item['x0']:7.2f}, {item['y0']:7.2f}) \"{item['text']}\"")
        
        # Search for date-like patterns
        print("\n  === DATE-LIKE PATTERNS ===")
        for item in all_items:
            if re.search(r'\d{2}\.\d{2}\.\d{4}', item["text"]):
                print(f"    ({item['x0']:7.2f}, {item['y0']:7.2f}) \"{item['text']}\"")
        
        # Look for all numeric values to understand measurement structure
        print("\n  === ROWS WITH MULTIPLE NUMBERS ===")
        for y_key in sorted(rows.keys()):
            row_items = sorted(rows[y_key], key=lambda i: i["x0"])
            numbers = []
            for i in row_items:
                text = i["text"].strip()
                # Normalize unicode minus
                text = text.replace('\u2212', '-').replace('\u2013', '-').replace('\u2014', '-')
                if re.match(r'^[+-]?\d+\.?\d*$', text):
                    numbers.append((i["x0"], text))
            if len(numbers) >= 4:
                row_text = " | ".join(f"{i['text']}" for i in row_items)
                print(f"    Y~{y_key:7.1f} ({len(numbers)} nums): {row_text}")
                print(f"      Numbers: {[n[1] for n in numbers]}")
                print(f"      Positions: {[n[0] for n in numbers]}")
                
        # Exhaustive: print every character with its codepoint for items near fH
        print("\n  === CHARACTER-LEVEL ANALYSIS NEAR fH ===")
        for item in all_items:
            if "fH" in item["text"] or "f" == item["text"].strip():
                # Find items at same Y
                y = item["y0"]
                nearby = [i for i in all_items if abs(i["y0"] - y) < 5]
                nearby.sort(key=lambda i: i["x0"])
                for ni in nearby:
                    chars = " ".join(f"'{ch}'(U+{ord(ch):04X})" for ch in ni["text"])
                    print(f"      x={ni['x0']:7.2f} chars: {chars}")
                break  # Only do this once
                
    doc.close()

if __name__ == "__main__":
    pdf_path = sys.argv[1] if len(sys.argv) > 1 else "SA26924-0104C.pdf"
    inspect_pdf(pdf_path)
