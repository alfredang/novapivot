/**
 * ui.js - Drag-and-drop system, toast notifications, and UI utilities
 */
const UI = (() => {
    let draggedEl = null;
    let draggedField = null;
    let draggedFromZone = null;

    /**
     * Initialize drag-and-drop for all zones
     */
    function initDragDrop() {
        document.querySelectorAll('.drop-zone').forEach(zone => {
            zone.addEventListener('dragover', handleDragOver);
            zone.addEventListener('dragenter', handleDragEnter);
            zone.addEventListener('dragleave', handleDragLeave);
            zone.addEventListener('drop', handleDrop);
        });
    }

    /**
     * Create a draggable field chip
     */
    function createFieldChip(field, zone, options = {}) {
        const chip = document.createElement('div');
        chip.className = 'field-chip';
        chip.setAttribute('draggable', 'true');
        chip.dataset.field = field.name;
        chip.dataset.zone = zone;

        // Type icon
        const icon = document.createElement('span');
        icon.className = 'field-type-icon';
        icon.textContent = field.type === 'number' ? '#' : field.type === 'date' ? 'D' : 'A';
        icon.title = field.type;
        chip.appendChild(icon);

        // Label
        const label = document.createElement('span');
        label.className = 'field-label';
        label.textContent = field.name;
        chip.appendChild(label);

        // Aggregation selector for value fields
        if (zone === 'values') {
            const aggSelect = document.createElement('select');
            aggSelect.className = 'agg-select';
            aggSelect.title = 'Aggregation type';
            const aggs = ['sum', 'count', 'avg', 'min', 'max', 'distinctCount'];
            const defaultAgg = field.type === 'number' ? 'sum' : 'count';
            for (const a of aggs) {
                const opt = document.createElement('option');
                opt.value = a;
                opt.textContent = a === 'distinctCount' ? 'distinct' : a;
                if (a === (options.aggregation || defaultAgg)) opt.selected = true;
                aggSelect.appendChild(opt);
            }
            aggSelect.addEventListener('change', () => {
                if (typeof App !== 'undefined') App.onConfigChange();
            });
            aggSelect.addEventListener('mousedown', e => e.stopPropagation());
            chip.appendChild(aggSelect);
        }

        // Remove button (except in available fields)
        if (zone !== 'fields') {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'field-remove';
            removeBtn.innerHTML = '&times;';
            removeBtn.title = 'Remove field';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                chip.remove();
                updateZonePlaceholders();
                if (typeof App !== 'undefined') App.onConfigChange();
            });
            chip.appendChild(removeBtn);
        }

        // Drag events
        chip.addEventListener('dragstart', (e) => {
            draggedEl = chip;
            draggedField = field;
            draggedFromZone = zone;
            chip.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', field.name);
            // Highlight valid zones
            document.querySelectorAll('.drop-zone').forEach(z => z.classList.add('drop-active'));
        });

        chip.addEventListener('dragend', () => {
            chip.classList.remove('dragging');
            document.querySelectorAll('.drop-zone').forEach(z => {
                z.classList.remove('drop-active', 'drop-hover');
            });
            draggedEl = null;
            draggedField = null;
            draggedFromZone = null;
        });

        return chip;
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }

    function handleDragEnter(e) {
        e.preventDefault();
        this.classList.add('drop-hover');
    }

    function handleDragLeave(e) {
        // Only remove if leaving the zone entirely
        if (!this.contains(e.relatedTarget)) {
            this.classList.remove('drop-hover');
        }
    }

    function handleDrop(e) {
        e.preventDefault();
        this.classList.remove('drop-hover');

        if (!draggedField) return;

        const targetZone = this.dataset.zone;

        // Don't allow dropping in the same zone (unless reordering)
        if (targetZone === draggedFromZone && targetZone === 'fields') return;

        // Check if field already exists in target zone (except fields which always has all)
        if (targetZone !== 'fields') {
            const existing = this.querySelector(`[data-field="${draggedField.name}"]`);
            if (existing && draggedFromZone === targetZone) {
                // Reorder within same zone
                const chips = [...this.querySelectorAll('.field-chip')];
                const dropY = e.clientY;
                let insertBefore = null;
                for (const c of chips) {
                    const rect = c.getBoundingClientRect();
                    if (dropY < rect.top + rect.height / 2) {
                        insertBefore = c;
                        break;
                    }
                }
                if (insertBefore && insertBefore !== draggedEl) {
                    this.insertBefore(draggedEl, insertBefore);
                } else if (!insertBefore) {
                    this.appendChild(draggedEl);
                }
                if (typeof App !== 'undefined') App.onConfigChange();
                return;
            }
            if (existing) return; // Already in zone
        }

        // Remove from source zone if not "fields"
        if (draggedFromZone !== 'fields' && draggedEl) {
            draggedEl.remove();
        }

        // Don't add to fields zone (it's always complete)
        if (targetZone === 'fields') {
            // Just remove from previous zone
            updateZonePlaceholders();
            if (typeof App !== 'undefined') App.onConfigChange();
            return;
        }

        // Create new chip in target zone
        const newChip = createFieldChip(draggedField, targetZone);

        // Position based on drop location
        const chips = [...this.querySelectorAll('.field-chip')];
        const dropY = e.clientY;
        let insertBefore = null;
        for (const c of chips) {
            const rect = c.getBoundingClientRect();
            if (dropY < rect.top + rect.height / 2) {
                insertBefore = c;
                break;
            }
        }

        if (insertBefore) {
            this.insertBefore(newChip, insertBefore);
        } else {
            this.appendChild(newChip);
        }

        updateZonePlaceholders();
        if (typeof App !== 'undefined') App.onConfigChange();
    }

    /**
     * Show/hide placeholders based on whether zones have chips
     */
    function updateZonePlaceholders() {
        document.querySelectorAll('.drop-zone').forEach(zone => {
            const hasChips = zone.querySelector('.field-chip');
            const placeholder = zone.querySelector('.drop-zone-placeholder');
            const empty = zone.querySelector('.drop-zone-empty');
            if (placeholder) placeholder.style.display = hasChips ? 'none' : 'block';
            if (empty) empty.style.display = hasChips ? 'none' : 'block';
        });
    }

    /**
     * Get current pivot configuration from the UI
     */
    function getConfig() {
        const getFields = (zoneId) => {
            return [...document.querySelectorAll(`#${zoneId} .field-chip`)].map(chip => {
                const config = { name: chip.dataset.field };
                const aggSelect = chip.querySelector('.agg-select');
                if (aggSelect) config.aggregation = aggSelect.value;
                return config;
            });
        };

        return {
            rows: getFields('zoneRows'),
            columns: getFields('zoneColumns'),
            values: getFields('zoneValues'),
            filters: getFields('zoneFilters')
        };
    }

    /**
     * Populate the Available Fields zone
     */
    function populateFields(columns) {
        const zone = document.getElementById('zoneFields');
        zone.innerHTML = '';
        for (const col of Object.values(columns)) {
            const chip = createFieldChip(col, 'fields');
            zone.appendChild(chip);
        }
    }

    /**
     * Show a toast notification
     */
    function toast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toastContainer');
        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.textContent = message;
        container.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        setTimeout(() => {
            el.classList.remove('show');
            setTimeout(() => el.remove(), 300);
        }, duration);
    }

    /**
     * Render data preview table
     */
    function renderDataTable(headers, data, maxRows = 100) {
        const table = document.getElementById('dataTable');
        const info = document.getElementById('dataInfo');

        const displayRows = data.slice(0, maxRows);
        info.textContent = `${data.length} rows, ${headers.length} columns${data.length > maxRows ? ` (showing first ${maxRows})` : ''}`;

        let html = '<thead><tr>';
        for (const h of headers) {
            html += `<th>${escapeHtml(h)}</th>`;
        }
        html += '</tr></thead><tbody>';
        for (const row of displayRows) {
            html += '<tr>';
            for (const h of headers) {
                html += `<td>${escapeHtml(row[h] ?? '')}</td>`;
            }
            html += '</tr>';
        }
        html += '</tbody>';
        table.innerHTML = html;
    }

    /**
     * Switch between views
     */
    function switchView(view) {
        document.querySelectorAll('.view-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.view === view);
            t.setAttribute('aria-selected', t.dataset.view === view);
        });
        document.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));

        if (view === 'data') {
            document.getElementById('viewData').classList.add('active');
        } else if (view === 'pivot') {
            document.getElementById('viewPivot').classList.add('active');
        } else if (view === 'chart') {
            document.getElementById('viewChart').classList.add('active');
        }
    }

    /**
     * Show the upload view
     */
    function showUpload() {
        document.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.view-tab').forEach(t => {
            t.classList.remove('active');
            t.setAttribute('aria-selected', 'false');
        });
        document.getElementById('viewUpload').classList.add('active');
    }

    /**
     * Render filter controls for filter zone fields
     */
    function renderFilterControls(columns, data, activeFilters) {
        const container = document.getElementById('filterControls');
        container.innerHTML = '';

        const filterFields = getConfig().filters;
        for (const f of filterFields) {
            const col = columns[f.name];
            if (!col) continue;

            const section = document.createElement('div');
            section.className = 'filter-section';

            const header = document.createElement('div');
            header.className = 'filter-section-header';
            header.innerHTML = `<span>${escapeHtml(f.name)}</span><button class="filter-toggle">&#9662;</button>`;
            section.appendChild(header);

            const body = document.createElement('div');
            body.className = 'filter-section-body';

            const values = col.uniqueValues.slice(0, 50); // Limit to 50 for performance
            const selected = activeFilters[f.name] || new Set(values);

            // Select all / none
            const controls = document.createElement('div');
            controls.className = 'filter-quick-controls';
            const selAll = document.createElement('button');
            selAll.className = 'btn btn-xs';
            selAll.textContent = 'All';
            selAll.onclick = () => {
                body.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
                if (typeof App !== 'undefined') App.onFilterChange();
            };
            const selNone = document.createElement('button');
            selNone.className = 'btn btn-xs';
            selNone.textContent = 'None';
            selNone.onclick = () => {
                body.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
                if (typeof App !== 'undefined') App.onFilterChange();
            };
            controls.appendChild(selAll);
            controls.appendChild(selNone);
            body.appendChild(controls);

            for (const val of values) {
                const label = document.createElement('label');
                label.className = 'filter-item';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.value = val;
                cb.checked = selected.has(val);
                cb.dataset.filterField = f.name;
                cb.addEventListener('change', () => {
                    if (typeof App !== 'undefined') App.onFilterChange();
                });
                label.appendChild(cb);
                label.appendChild(document.createTextNode(' ' + val));
                body.appendChild(label);
            }

            // Collapse toggle
            let collapsed = false;
            header.addEventListener('click', () => {
                collapsed = !collapsed;
                body.style.display = collapsed ? 'none' : 'block';
                header.querySelector('.filter-toggle').textContent = collapsed ? '\u25B8' : '\u25BE';
            });

            section.appendChild(body);
            container.appendChild(section);
        }
    }

    /**
     * Get active filter selections from the UI
     */
    function getActiveFilters() {
        const filters = {};
        document.querySelectorAll('#filterControls input[type="checkbox"]').forEach(cb => {
            const field = cb.dataset.filterField;
            if (!filters[field]) filters[field] = new Set();
            if (cb.checked) filters[field].add(cb.value);
        });
        return filters;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Save pivot config to localStorage
     */
    function saveConfig(config) {
        try {
            localStorage.setItem('novapivot-config', JSON.stringify(config));
        } catch (e) { /* ignore */ }
    }

    /**
     * Load pivot config from localStorage
     */
    function loadConfig() {
        try {
            const raw = localStorage.getItem('novapivot-config');
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    /**
     * Restore a saved configuration into the UI zones
     */
    function restoreConfig(config, columns) {
        if (!config || !columns) return;

        const restoreZone = (zoneId, fields, zoneName) => {
            const zone = document.getElementById(zoneId);
            for (const f of fields) {
                if (columns[f.name]) {
                    const chip = createFieldChip(columns[f.name], zoneName, f);
                    zone.appendChild(chip);
                }
            }
        };

        restoreZone('zoneRows', config.rows || [], 'rows');
        restoreZone('zoneColumns', config.columns || [], 'columns');
        restoreZone('zoneValues', config.values || [], 'values');
        restoreZone('zoneFilters', config.filters || [], 'filters');
        updateZonePlaceholders();
    }

    /**
     * Field search filtering
     */
    function initFieldSearch() {
        const input = document.getElementById('fieldSearch');
        input.addEventListener('input', () => {
            const query = input.value.toLowerCase();
            document.querySelectorAll('#zoneFields .field-chip').forEach(chip => {
                const name = chip.dataset.field.toLowerCase();
                chip.style.display = name.includes(query) ? '' : 'none';
            });
        });
    }

    return {
        initDragDrop, populateFields, createFieldChip, getConfig, toast,
        renderDataTable, switchView, showUpload, renderFilterControls,
        getActiveFilters, updateZonePlaceholders, saveConfig, loadConfig,
        restoreConfig, initFieldSearch, escapeHtml
    };
})();
