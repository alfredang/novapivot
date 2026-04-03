/**
 * pivot.js - Pivot table computation engine
 *
 * Takes raw data + configuration and produces a pivot table result
 * with row/column hierarchies, aggregated values, and totals.
 */
const Pivot = (() => {

    /**
     * Compute pivot table from data and configuration
     *
     * @param {Array} data - Array of row objects
     * @param {Object} config - { rows, columns, values, filters }
     * @param {Object} activeFilters - { fieldName: Set of selected values }
     * @returns {Object} Pivot result with structure for rendering
     */
    function compute(data, config, activeFilters = {}) {
        if (!config.values.length && !config.rows.length && !config.columns.length) {
            return null;
        }

        // Apply filters
        let filtered = data;
        for (const [field, selectedValues] of Object.entries(activeFilters)) {
            if (selectedValues.size > 0) {
                filtered = filtered.filter(row => selectedValues.has(row[field]));
            }
        }

        if (filtered.length === 0) {
            return { empty: true, message: 'No data matches the current filters' };
        }

        const rowFields = config.rows.map(r => r.name);
        const colFields = config.columns.map(c => c.name);
        const valueFields = config.values;

        // If no value fields, default to count
        const effectiveValues = valueFields.length > 0 ? valueFields :
            [{ name: '_count_', aggregation: 'count' }];

        // Build row keys and column keys
        const rowKeyMap = new Map(); // stringKey -> { keys, label }
        const colKeyMap = new Map();
        const cellMap = new Map(); // "rowKey|colKey" -> accumulator

        for (const row of filtered) {
            const rowKey = rowFields.map(f => row[f] ?? '').join('|||');
            const colKey = colFields.map(f => row[f] ?? '').join('|||');

            if (!rowKeyMap.has(rowKey)) {
                rowKeyMap.set(rowKey, {
                    key: rowKey,
                    parts: rowFields.map(f => row[f] ?? '')
                });
            }
            if (!colKeyMap.has(colKey)) {
                colKeyMap.set(colKey, {
                    key: colKey,
                    parts: colFields.map(f => row[f] ?? '')
                });
            }

            const cellKey = `${rowKey}|||COL|||${colKey}`;
            if (!cellMap.has(cellKey)) {
                cellMap.set(cellKey, createAccumulator(effectiveValues));
            }
            accumulate(cellMap.get(cellKey), effectiveValues, row);
        }

        // Sort row and column keys
        const rowKeys = [...rowKeyMap.values()].sort((a, b) => compareKeys(a.parts, b.parts));
        const colKeys = [...colKeyMap.values()].sort((a, b) => compareKeys(a.parts, b.parts));

        // Build cell values matrix
        const cells = [];
        const rowTotals = [];
        const colTotals = [];

        for (const rk of rowKeys) {
            const rowCells = [];
            const rowAcc = createAccumulator(effectiveValues);
            for (const ck of colKeys) {
                const cellKey = `${rk.key}|||COL|||${ck.key}`;
                const acc = cellMap.get(cellKey);
                const vals = acc ? finalize(acc, effectiveValues) : effectiveValues.map(() => null);
                rowCells.push(vals);
                if (acc) mergeAccumulator(rowAcc, acc, effectiveValues);
            }
            cells.push(rowCells);
            rowTotals.push(finalize(rowAcc, effectiveValues));
        }

        // Column totals
        for (let ci = 0; ci < colKeys.length; ci++) {
            const colAcc = createAccumulator(effectiveValues);
            for (let ri = 0; ri < rowKeys.length; ri++) {
                const cellKey = `${rowKeys[ri].key}|||COL|||${colKeys[ci].key}`;
                const acc = cellMap.get(cellKey);
                if (acc) mergeAccumulator(colAcc, acc, effectiveValues);
            }
            colTotals.push(finalize(colAcc, effectiveValues));
        }

        // Grand total
        const grandAcc = createAccumulator(effectiveValues);
        for (const acc of cellMap.values()) {
            mergeAccumulator(grandAcc, acc, effectiveValues);
        }
        const grandTotal = finalize(grandAcc, effectiveValues);

        return {
            rowFields,
            colFields,
            valueFields: effectiveValues,
            rowKeys,
            colKeys,
            cells,
            rowTotals,
            colTotals,
            grandTotal,
            totalRows: filtered.length
        };
    }

    /**
     * Create an accumulator for each value field
     */
    function createAccumulator(valueFields) {
        return valueFields.map(vf => ({
            sum: 0,
            count: 0,
            min: Infinity,
            max: -Infinity,
            values: new Set()
        }));
    }

    /**
     * Accumulate a row's values
     */
    function accumulate(acc, valueFields, row) {
        for (let i = 0; i < valueFields.length; i++) {
            const vf = valueFields[i];
            const val = vf.name === '_count_' ? 1 : CSV.toNumber(row[vf.name]);
            acc[i].count++;
            if (!isNaN(val)) {
                acc[i].sum += val;
                acc[i].min = Math.min(acc[i].min, val);
                acc[i].max = Math.max(acc[i].max, val);
            }
            if (vf.name !== '_count_') {
                acc[i].values.add(row[vf.name]);
            }
        }
    }

    /**
     * Merge source accumulator into target
     */
    function mergeAccumulator(target, source, valueFields) {
        for (let i = 0; i < valueFields.length; i++) {
            target[i].sum += source[i].sum;
            target[i].count += source[i].count;
            target[i].min = Math.min(target[i].min, source[i].min);
            target[i].max = Math.max(target[i].max, source[i].max);
            for (const v of source[i].values) {
                target[i].values.add(v);
            }
        }
    }

    /**
     * Finalize accumulator to produce display values
     */
    function finalize(acc, valueFields) {
        return valueFields.map((vf, i) => {
            const a = acc[i];
            switch (vf.aggregation || 'count') {
                case 'sum': return a.count > 0 ? a.sum : null;
                case 'count': return a.count;
                case 'avg': return a.count > 0 ? a.sum / a.count : null;
                case 'min': return a.min === Infinity ? null : a.min;
                case 'max': return a.max === -Infinity ? null : a.max;
                case 'distinctCount': return a.values.size;
                default: return a.count;
            }
        });
    }

    function compareKeys(a, b) {
        for (let i = 0; i < a.length; i++) {
            const na = Number(a[i]);
            const nb = Number(b[i]);
            if (!isNaN(na) && !isNaN(nb)) {
                if (na !== nb) return na - nb;
            } else {
                const cmp = String(a[i]).localeCompare(String(b[i]));
                if (cmp !== 0) return cmp;
            }
        }
        return 0;
    }

    /**
     * Format a numeric value for display
     */
    function formatValue(val) {
        if (val === null || val === undefined) return '-';
        if (typeof val !== 'number') return String(val);
        if (Number.isInteger(val)) {
            return val.toLocaleString();
        }
        return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    /**
     * Render pivot table to HTML
     */
    function renderTable(result, sortState) {
        if (!result || result.empty) {
            return `<div class="pivot-empty-state"><p>${result?.message || 'No pivot data'}</p></div>`;
        }

        const { rowFields, colFields, valueFields, rowKeys, colKeys, cells, rowTotals, colTotals, grandTotal } = result;
        const numValues = valueFields.length;
        const hasMultipleValues = numValues > 1;
        const hasColFields = colFields.length > 0;

        // Apply sorting
        let sortedIndices = rowKeys.map((_, i) => i);
        if (sortState) {
            sortedIndices.sort((a, b) => {
                let va, vb;
                if (sortState.type === 'row') {
                    va = rowKeys[a].parts[sortState.index];
                    vb = rowKeys[b].parts[sortState.index];
                } else if (sortState.type === 'value') {
                    va = cells[a][sortState.colIndex]?.[sortState.valIndex] ?? -Infinity;
                    vb = cells[b][sortState.colIndex]?.[sortState.valIndex] ?? -Infinity;
                } else if (sortState.type === 'rowTotal') {
                    va = rowTotals[a][sortState.valIndex] ?? -Infinity;
                    vb = rowTotals[b][sortState.valIndex] ?? -Infinity;
                }
                const na = Number(va), nb = Number(vb);
                let cmp;
                if (!isNaN(na) && !isNaN(nb)) cmp = na - nb;
                else cmp = String(va ?? '').localeCompare(String(vb ?? ''));
                return sortState.dir === 'asc' ? cmp : -cmp;
            });
        }

        let html = '<table class="pivot-table">';

        // Column headers
        if (hasColFields) {
            for (let ci = 0; ci < colFields.length; ci++) {
                html += '<tr class="pivot-header-row">';
                // Empty cells for row fields
                if (ci === 0) {
                    html += `<th class="pivot-corner" colspan="${rowFields.length}" rowspan="${colFields.length + (hasMultipleValues ? 1 : 0)}"></th>`;
                }

                // Grouped column headers
                let prevVal = null;
                let span = 0;
                const groups = [];
                for (const ck of colKeys) {
                    const val = ck.parts[ci];
                    if (val === prevVal) {
                        span++;
                    } else {
                        if (prevVal !== null) groups.push({ val: prevVal, span });
                        prevVal = val;
                        span = 1;
                    }
                }
                if (prevVal !== null) groups.push({ val: prevVal, span });

                for (const g of groups) {
                    const colSpan = g.span * (hasMultipleValues ? numValues : 1);
                    html += `<th class="pivot-col-header" colspan="${colSpan}">${UI.escapeHtml(g.val)}</th>`;
                }

                // Row total header
                if (ci === 0) {
                    const totalColSpan = hasMultipleValues ? numValues : 1;
                    html += `<th class="pivot-total-header" colspan="${totalColSpan}" rowspan="${colFields.length + (hasMultipleValues ? 1 : 0)}">Total</th>`;
                }
                html += '</tr>';
            }
        }

        // Value subheaders (if multiple value fields or has col fields)
        if (hasMultipleValues) {
            html += '<tr class="pivot-subheader-row">';
            if (!hasColFields) {
                html += `<th class="pivot-corner" colspan="${rowFields.length}"></th>`;
            }
            const repeat = Math.max(colKeys.length, 1);
            for (let c = 0; c < repeat; c++) {
                for (const vf of valueFields) {
                    const label = vf.name === '_count_' ? 'Count' : `${vf.aggregation || 'sum'}(${vf.name})`;
                    html += `<th class="pivot-value-header">${UI.escapeHtml(label)}</th>`;
                }
            }
            if (!hasColFields) {
                for (const vf of valueFields) {
                    const label = vf.name === '_count_' ? 'Count' : `${vf.aggregation || 'sum'}(${vf.name})`;
                    html += `<th class="pivot-total-header">${UI.escapeHtml(label)}</th>`;
                }
            }
            html += '</tr>';
        }

        // Row field headers
        html += '<tr class="pivot-field-header-row">';
        for (let ri = 0; ri < rowFields.length; ri++) {
            const sortClass = sortState?.type === 'row' && sortState.index === ri ? ` sort-${sortState.dir}` : '';
            html += `<th class="pivot-row-field-header sortable${sortClass}" data-sort-type="row" data-sort-index="${ri}">${UI.escapeHtml(rowFields[ri])}</th>`;
        }

        if (!hasColFields && !hasMultipleValues) {
            for (const vf of valueFields) {
                const label = vf.name === '_count_' ? 'Count' : `${vf.aggregation || 'sum'}(${vf.name})`;
                html += `<th class="pivot-value-header">${UI.escapeHtml(label)}</th>`;
                html += `<th class="pivot-total-header">Total</th>`;
            }
        } else if (hasColFields && !hasMultipleValues) {
            for (let ci = 0; ci < colKeys.length; ci++) {
                const label = colKeys[ci].parts.join(' / ');
                html += `<th class="pivot-col-leaf sortable" data-sort-type="value" data-sort-col="${ci}" data-sort-val="0">${UI.escapeHtml(label)}</th>`;
            }
            html += `<th class="pivot-total-header sortable" data-sort-type="rowTotal" data-sort-val="0">Total</th>`;
        } else {
            // hasColFields && hasMultipleValues - already rendered above
            // Just render blank for positioning
        }
        html += '</tr>';

        // Data rows
        for (const idx of sortedIndices) {
            const rk = rowKeys[idx];
            html += '<tr class="pivot-data-row">';
            for (const part of rk.parts) {
                html += `<td class="pivot-row-label">${UI.escapeHtml(part)}</td>`;
            }
            for (const cellVals of cells[idx]) {
                if (cellVals) {
                    for (const v of cellVals) {
                        html += `<td class="pivot-cell">${formatValue(v)}</td>`;
                    }
                } else {
                    for (let vi = 0; vi < numValues; vi++) {
                        html += '<td class="pivot-cell">-</td>';
                    }
                }
            }
            // Row total
            for (const v of rowTotals[idx]) {
                html += `<td class="pivot-cell pivot-total-cell">${formatValue(v)}</td>`;
            }
            html += '</tr>';
        }

        // Column totals row
        html += '<tr class="pivot-total-row">';
        html += `<td class="pivot-total-label" colspan="${rowFields.length}">Total</td>`;
        for (const ct of colTotals) {
            for (const v of ct) {
                html += `<td class="pivot-cell pivot-total-cell">${formatValue(v)}</td>`;
            }
        }
        for (const v of grandTotal) {
            html += `<td class="pivot-cell pivot-grand-total">${formatValue(v)}</td>`;
        }
        html += '</tr>';

        html += '</table>';
        return html;
    }

    /**
     * Export pivot result as CSV text
     */
    function exportCSV(result) {
        if (!result || result.empty) return '';

        const { rowFields, colFields, valueFields, rowKeys, colKeys, cells, rowTotals, colTotals, grandTotal } = result;
        const lines = [];
        const numValues = valueFields.length;

        // Header row
        const header = [...rowFields];
        for (const ck of colKeys) {
            const colLabel = ck.parts.join(' / ');
            for (const vf of valueFields) {
                const valLabel = vf.name === '_count_' ? 'Count' : `${vf.aggregation}(${vf.name})`;
                header.push(`${colLabel} - ${valLabel}`);
            }
        }
        for (const vf of valueFields) {
            const valLabel = vf.name === '_count_' ? 'Count' : `${vf.aggregation}(${vf.name})`;
            header.push(`Total - ${valLabel}`);
        }
        lines.push(header.map(csvEscape).join(','));

        // Data rows
        for (let ri = 0; ri < rowKeys.length; ri++) {
            const row = [...rowKeys[ri].parts];
            for (const cellVals of cells[ri]) {
                if (cellVals) {
                    for (const v of cellVals) row.push(v ?? '');
                } else {
                    for (let vi = 0; vi < numValues; vi++) row.push('');
                }
            }
            for (const v of rowTotals[ri]) row.push(v ?? '');
            lines.push(row.map(csvEscape).join(','));
        }

        // Total row
        const totalRow = ['Total', ...Array(rowFields.length - 1).fill('')];
        for (const ct of colTotals) {
            for (const v of ct) totalRow.push(v ?? '');
        }
        for (const v of grandTotal) totalRow.push(v ?? '');
        lines.push(totalRow.map(csvEscape).join(','));

        return lines.join('\n');
    }

    function csvEscape(val) {
        const s = String(val ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"` : s;
    }

    return { compute, renderTable, formatValue, exportCSV };
})();
