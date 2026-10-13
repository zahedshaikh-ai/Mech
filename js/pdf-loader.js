/**
 * PDF Loader Module
 * Handles PDF.js initialization and PDF document loading.
 */

const PDFLoader = (() => {
    // PDF.js CDN URLs
    const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    const PDFJS_WORKER_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    let initialized = false;

    /**
     * Initialize PDF.js by loading the library and setting up the worker.
     * @returns {Promise<void>}
     */
    async function initialize() {
        if (initialized) return;

        // Check if pdfjsLib is already loaded
        if (typeof pdfjsLib === 'undefined') {
            await loadScript(PDFJS_CDN);
        }

        // Configure worker
        pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
        initialized = true;
        console.log('[PDFLoader] PDF.js initialized successfully');
    }

    /**
     * Load a script from a URL.
     * @param {string} url
     * @returns {Promise<void>}
     */
    function loadScript(url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
            document.head.appendChild(script);
        });
    }

    /**
     * Load a PDF from an ArrayBuffer.
     * @param {ArrayBuffer} arrayBuffer - The PDF file data.
     * @returns {Promise<Object>} PDF.js document proxy.
     */
    async function loadPDF(arrayBuffer) {
        await initialize();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        return pdf;
    }

    /**
     * Load a PDF from a File object.
     * @param {File} file - The PDF file.
     * @returns {Promise<Object>} PDF.js document proxy.
     */
    async function loadPDFFromFile(file) {
        const arrayBuffer = await file.arrayBuffer();
        return loadPDF(arrayBuffer);
    }

    /**
     * Extract text content from a PDF page with item positions.
     * @param {Object} page - PDF.js page proxy.
     * @returns {Promise<Object>} { items, fullStreamText }
     */
    async function extractTextItems(page) {
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1.0 });
        const items = [];
        let fullStreamText = '';

        for (const item of textContent.items) {
            if (!item.str && item.str !== '0') continue;

            // Transform coordinates from PDF space to viewport space
            // viewport.transform already maps to canvas/viewport space (y=0 at top)
            const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const x = tx[4];
            const y = tx[5];
            const width = item.width;
            const height = item.height;

            items.push({
                text: item.str,
                x: x,
                y: y,
                width: width,
                height: height,
                fontName: item.fontName || '',
                transform: item.transform
            });

            fullStreamText += item.str;
        }

        return { items, fullStreamText };
    }

    /**
     * Process a PDF from ArrayBuffer and extract text items from all pages.
     * @param {ArrayBuffer} arrayBuffer - The PDF file data.
     * @param {string} [filename='document.pdf']
     * @returns {Promise<Object>} Object with pages array, each containing text items.
     */
    async function processArrayBuffer(arrayBuffer, filename = 'document.pdf') {
        const pdf = await loadPDF(arrayBuffer);
        const result = {
            filename: filename,
            pageCount: pdf.numPages,
            pages: []
        };

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const { items, fullStreamText } = await extractTextItems(page);
            const viewport = page.getViewport({ scale: 1.0 });

            result.pages.push({
                pageNumber: i,
                width: viewport.width,
                height: viewport.height,
                textItems: items,
                fullStreamText: fullStreamText
            });

            // Release page resources
            page.cleanup();
        }

        // Release document resources
        pdf.destroy();

        return result;
    }

    /**
     * Process a single PDF file and extract text items from all pages.
     * @param {File} file - The PDF file.
     * @returns {Promise<Object>} Object with pages array, each containing text items.
     */
    async function processFile(file) {
        const arrayBuffer = await file.arrayBuffer();
        return processArrayBuffer(arrayBuffer, file.name);
    }

    return {
        initialize,
        loadPDF,
        loadPDFFromFile,
        extractTextItems,
        processArrayBuffer,
        processFile
    };
})();
