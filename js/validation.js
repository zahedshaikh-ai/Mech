/**
 * Validation Module
 * Validates extracted measurements against tolerance bands
 * and determines PASS/FAIL/INCOMPLETE status.
 */

const Validation = (() => {
    /**
     * Tolerance band limits (inclusive).
     */
    const TOLERANCE = {
        min: -30,
        max: 30,
        unit: 'µm'
    };

    /**
     * Column labels in order.
     */
    const COLUMNS = ['L33', 'L23', 'L12', 'L1', 'R1', 'R12', 'R23', 'R33'];

    /**
     * Validate a single measurement value against the tolerance band.
     * @param {number} value - The measurement value in µm.
     * @returns {Object} { valid, inTolerance, reason }
     */
    function validateValue(value) {
        if (value === null || value === undefined) {
            return { valid: false, inTolerance: false, reason: 'Missing value' };
        }
        if (typeof value !== 'number' || !isFinite(value)) {
            return { valid: false, inTolerance: false, reason: 'Not a finite number' };
        }

        const inTolerance = value >= TOLERANCE.min && value <= TOLERANCE.max;
        return {
            valid: true,
            inTolerance: inTolerance,
            reason: inTolerance ? null : `${value} µm is outside ±${TOLERANCE.max} µm`
        };
    }

    /**
     * Validate a complete measurement record.
     * @param {Object} extraction - Result from FHBetaExtractor.
     * @returns {Object} Validation result with status and details.
     */
    function validateRecord(extraction) {
        const result = {
            status: 'INCOMPLETE',
            measurementCount: 0,
            outOfTolerance: [],
            missingColumns: [],
            columnResults: {},
            warnings: []
        };

        if (!extraction || !extraction.success || !extraction.columnMap) {
            result.warnings.push('Extraction was not successful');
            result.missingColumns = [...COLUMNS];
            return result;
        }

        const columnMap = extraction.columnMap;

        // Validate each column
        let allValid = true;
        let allInTolerance = true;

        for (const col of COLUMNS) {
            const value = columnMap[col];

            if (value === null || value === undefined) {
                result.missingColumns.push(col);
                result.columnResults[col] = {
                    value: null,
                    valid: false,
                    inTolerance: false,
                    reason: 'Missing'
                };
                allValid = false;
                allInTolerance = false;
                continue;
            }

            const validation = validateValue(value);
            result.columnResults[col] = {
                value: value,
                ...validation
            };

            if (validation.valid) {
                result.measurementCount++;
                if (!validation.inTolerance) {
                    allInTolerance = false;
                    result.outOfTolerance.push({
                        column: col,
                        value: value,
                        reason: validation.reason
                    });
                }
            } else {
                allValid = false;
                allInTolerance = false;
            }
        }

        // Determine status
        if (result.missingColumns.length > 0 || result.measurementCount !== 8) {
            result.status = 'INCOMPLETE';
        } else if (allInTolerance) {
            result.status = 'PASS';
        } else {
            result.status = 'FAIL';
        }

        return result;
    }

    /**
     * Validate metadata completeness (separate from measurements).
     * @param {Object} metadata - Result from MetadataExtractor.
     * @returns {Object} { complete, warnings }
     */
    function validateMetadata(metadata) {
        const warnings = [];

        if (!metadata.date) {
            warnings.push('Inspection date not found');
        }
        if (!metadata.jobNumber) {
            warnings.push('Job number (Part number incr.) not found');
        }

        return {
            complete: warnings.length === 0,
            warnings: warnings
        };
    }

    /**
     * Build a complete inspection record from extraction results.
     * @param {string} filename - Source filename.
     * @param {Object} metadata - From MetadataExtractor.
     * @param {Object} extraction - From FHBetaExtractor.
     * @returns {Object} Complete inspection record.
     */
    function buildRecord(filename, metadata, extraction) {
        const validation = validateRecord(extraction);
        const metadataValidation = validateMetadata(metadata);

        return {
            filename: filename,
            date: metadata.date || '',
            jobNumber: metadata.jobNumber || '',
            measurements: extraction.success ? extraction.columnMap : null,
            values: extraction.success ? extraction.values : null,
            status: validation.status,
            validation: validation,
            metadataWarnings: metadataValidation.warnings,
            debugInfo: {
                extraction: extraction.debugInfo,
                metadata: metadata.debugInfo
            }
        };
    }

    return {
        TOLERANCE,
        COLUMNS,
        validateValue,
        validateRecord,
        validateMetadata,
        buildRecord
    };
})();
