# MECH - Lead Variation Inspector

A local-first web application for batch processing ZEISS GEAR PRO involute gear measurement PDF reports.

## Features

- **Upload & Process**: Drag-and-drop or select one or hundreds of ZEISS GEAR PRO PDF reports
- **Smart Extraction**: Automatically extracts inspection date, part number, and eight fHβ lead slope deviation measurements
- **Tolerance Validation**: Applies ±30 µm inclusive tolerance band with PASS/FAIL/INCOMPLETE status
- **Batch Processing**: Asynchronous processing of large batches (200+ reports)
- **CSV Export**: Excel-compatible CSV export of all or filtered records
- **Privacy First**: All PDF processing happens in the browser — no data leaves your machine

## Quick Start

1. Open `index.html` in a modern web browser (Chrome, Edge, Firefox)
2. Drag & drop PDF reports onto the upload area, or click to select files
3. View extracted measurements in the dashboard
4. Export results to CSV

### Local Development Server (Optional)

For the best experience, serve the files with a local HTTP server:

```bash
# Using Node.js
npx serve .

# Using Python
py -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

## Running Tests

### 1. Python Automated Test Suite
```bash
# Install PyMuPDF
pip install -r requirements.txt

# Run reference extraction test
py tests/test_extraction.py SA26924-0104C.pdf
```
Output:
- 18/18 tests pass (date, job number, 8 fHβ values, column mapping, signs, ±30 tolerance boundaries).

### 2. Browser Extraction Test Suite
Start the local server and open:
```
http://localhost:8080/tests/test_browser
```
The browser test automatically fetches the reference report, processes it via PDF.js, and validates all 23 assertions with green checkmarks.

## Project Structure

```
MECH/
├── index.html                  # Main application page
├── css/
│   └── styles.css              # Complete styling & design system
├── js/
│   ├── app.js                  # Application controller & batch queue
│   ├── pdf-loader.js           # PDF.js initialization and loading
│   ├── text-reconstruction.js  # Token merging & row reconstruction
│   ├── fhbeta-extractor.js     # fHβ measurement extraction & column mapping
│   ├── metadata-extractor.js   # Date and job number extraction
│   ├── validation.js           # Tolerance validation and PASS/FAIL/INCOMPLETE
│   ├── export.js               # Excel-compatible CSV export
│   └── debug-panel.js          # Extraction diagnostic log panel
├── tests/
│   ├── test_extraction.py      # Python reference test suite (18 assertions)
│   ├── test_browser.html       # Browser test runner (23 assertions)
│   └── test_cases.json         # Reference assertions and boundary definitions
├── tools/
│   ├── inspect_pdf.py          # PyMuPDF diagnostic inspection tool
│   ├── inspect_pdfjs.js        # PDF.js text item analysis script
│   └── test_pipeline.js        # Node.js end-to-end extraction validator
├── requirements.txt            # Python dependencies (PyMuPDF)
└── README.md                   # Project documentation
```

## Technology Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript (ES6+)
- **PDF Parsing**: PDF.js 3.11.174 (CDN)
- **OCR Fallback**: Tesseract.js (when native text is insufficient)
- **Development Testing**: Python 3 + PyMuPDF

## How It Works

1. PDF files are loaded using PDF.js in the browser
2. Text items are extracted with their bounding box coordinates
3. Items are grouped into rows by Y-coordinate proximity
4. The fHβ row is identified by its label pattern (f + H + β + µm)
5. Eight measurement values are extracted, excluding ±30 tolerance markers
6. Values are mapped to Left (L33, L23, L12, L1) and Right (R1, R12, R23, R33) columns
7. Each measurement is validated against ±30 µm tolerance

## Tolerance Rules

| Status | Condition |
|--------|-----------|
| **PASS** | All 8 values extracted and within ±30 µm |
| **FAIL** | All 8 values extracted but at least one outside ±30 µm |
| **INCOMPLETE** | Missing, ambiguous, or unmappable measurements |

## Privacy

- All PDF processing happens locally in the browser
- No data is uploaded to any server
- PDF.js and Tesseract.js are loaded from CDN for convenience only
- No analytics or tracking

## License

Internal use only.
