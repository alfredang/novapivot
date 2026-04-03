/**
 * csv.js - CSV parsing, data type detection, and sample data generation
 */
const CSV = (() => {

    /**
     * Parse a CSV string into an array of objects
     */
    function parse(text, delimiter) {
        if (!text || !text.trim()) throw new Error('Empty file');

        // Auto-detect delimiter if not specified
        if (!delimiter) {
            const firstLine = text.split('\n')[0];
            const tabCount = (firstLine.match(/\t/g) || []).length;
            const commaCount = (firstLine.match(/,/g) || []).length;
            const semiCount = (firstLine.match(/;/g) || []).length;
            delimiter = tabCount > commaCount && tabCount > semiCount ? '\t'
                      : semiCount > commaCount ? ';' : ',';
        }

        const rows = parseRows(text, delimiter);
        if (rows.length < 2) throw new Error('CSV must have at least a header row and one data row');

        const headers = rows[0].map((h, i) => h.trim() || `Column_${i + 1}`);

        // Check for duplicate headers
        const seen = {};
        const uniqueHeaders = headers.map(h => {
            if (seen[h]) {
                seen[h]++;
                return `${h}_${seen[h]}`;
            }
            seen[h] = 1;
            return h;
        });

        const data = [];
        for (let i = 1; i < rows.length; i++) {
            if (rows[i].length === 1 && rows[i][0].trim() === '') continue; // skip empty rows
            const obj = {};
            for (let j = 0; j < uniqueHeaders.length; j++) {
                obj[uniqueHeaders[j]] = rows[i][j] !== undefined ? rows[i][j].trim() : '';
            }
            data.push(obj);
        }

        if (data.length === 0) throw new Error('No data rows found');
        return { headers: uniqueHeaders, data };
    }

    /**
     * Parse CSV respecting quoted fields
     */
    function parseRows(text, delimiter) {
        const rows = [];
        let row = [];
        let field = '';
        let inQuotes = false;
        const len = text.length;

        for (let i = 0; i < len; i++) {
            const ch = text[i];
            const next = text[i + 1];

            if (inQuotes) {
                if (ch === '"') {
                    if (next === '"') {
                        field += '"';
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    field += ch;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                } else if (ch === delimiter) {
                    row.push(field);
                    field = '';
                } else if (ch === '\r') {
                    // skip, handle \n next
                } else if (ch === '\n') {
                    row.push(field);
                    rows.push(row);
                    row = [];
                    field = '';
                } else {
                    field += ch;
                }
            }
        }

        // Push last field and row
        if (field || row.length > 0) {
            row.push(field);
            rows.push(row);
        }

        return rows;
    }

    /**
     * Detect the data type of a column
     */
    function detectType(values) {
        let numCount = 0;
        let dateCount = 0;
        let total = 0;

        for (const v of values) {
            if (v === '' || v === null || v === undefined) continue;
            total++;
            if (!isNaN(v) && v.trim() !== '') numCount++;
            else if (isDateLike(v)) dateCount++;
        }

        if (total === 0) return 'text';
        if (numCount / total > 0.8) return 'number';
        if (dateCount / total > 0.8) return 'date';
        return 'text';
    }

    function isDateLike(v) {
        if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(v)) return true;
        if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(v)) return true;
        return false;
    }

    /**
     * Analyze columns to determine types
     */
    function analyzeColumns(headers, data) {
        const columns = {};
        for (const h of headers) {
            const values = data.map(row => row[h]);
            const type = detectType(values);
            columns[h] = {
                name: h,
                type,
                uniqueValues: [...new Set(values.filter(v => v !== '' && v != null))].sort()
            };
        }
        return columns;
    }

    /**
     * Convert a value to a number, returns NaN if not possible
     */
    function toNumber(v) {
        if (v === '' || v === null || v === undefined) return NaN;
        const n = Number(v);
        return n;
    }

    /**
     * Generate sample sales dataset
     */
    function sampleData() {
        const regions = ['North', 'South', 'East', 'West'];
        const products = ['Laptop', 'Phone', 'Tablet', 'Monitor', 'Keyboard', 'Mouse'];
        const categories = ['Electronics', 'Electronics', 'Electronics', 'Peripherals', 'Peripherals', 'Peripherals'];
        const salesReps = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank'];
        const quarters = ['Q1 2024', 'Q2 2024', 'Q3 2024', 'Q4 2024', 'Q1 2025', 'Q2 2025'];

        const rows = [];
        const rng = mulberry32(42); // Seeded random for reproducibility

        for (let i = 0; i < 200; i++) {
            const pIdx = Math.floor(rng() * products.length);
            const qty = Math.floor(rng() * 20) + 1;
            const price = [999, 699, 449, 349, 79, 39][pIdx];
            const discount = Math.floor(rng() * 4) * 5; // 0, 5, 10, 15%

            rows.push({
                'Region': regions[Math.floor(rng() * regions.length)],
                'Product': products[pIdx],
                'Category': categories[pIdx],
                'Quarter': quarters[Math.floor(rng() * quarters.length)],
                'Sales Rep': salesReps[Math.floor(rng() * salesReps.length)],
                'Quantity': String(qty),
                'Unit Price': String(price),
                'Revenue': String(qty * price),
                'Discount %': String(discount),
                'Profit': String(Math.round(qty * price * (1 - discount / 100) * (0.2 + rng() * 0.15)))
            });
        }

        const headers = Object.keys(rows[0]);
        return { headers, data: rows };
    }

    // Simple seeded PRNG
    function mulberry32(a) {
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    /**
     * Convert data back to CSV string
     */
    function stringify(headers, data) {
        const escape = v => {
            const s = String(v ?? '');
            return s.includes(',') || s.includes('"') || s.includes('\n')
                ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [headers.map(escape).join(',')];
        for (const row of data) {
            lines.push(headers.map(h => escape(row[h])).join(','));
        }
        return lines.join('\n');
    }

    return { parse, analyzeColumns, toNumber, sampleData, stringify };
})();
