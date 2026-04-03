/**
 * app.js - Main application orchestration
 *
 * Wires together CSV parsing, UI, pivot engine, and charts.
 */
const App = (() => {
    let rawData = null;       // { headers, data }
    let columns = null;       // Column analysis
    let pivotResult = null;   // Current pivot result
    let sortState = null;     // Current sort state for pivot table
    let activeFilters = {};   // Current filter selections

    /**
     * Initialize the application
     */
    function init() {
        Theme.init();
        UI.initDragDrop();
        UI.initFieldSearch();
        bindEvents();

        // Try to restore last session
        const savedConfig = UI.loadConfig();
        if (savedConfig?.lastData === 'sample') {
            loadSampleData();
            if (savedConfig.pivot) {
                setTimeout(() => UI.restoreConfig(savedConfig.pivot, columns), 100);
            }
        }
    }

    /**
     * Bind all event listeners
     */
    function bindEvents() {
        // Theme toggle
        document.getElementById('themeToggle').addEventListener('click', () => {
            Theme.toggle();
            // Re-render chart if visible
            if (pivotResult && document.getElementById('viewChart').classList.contains('active')) {
                renderChart();
            }
        });

        // File upload
        const uploadZone = document.getElementById('uploadZone');
        const fileInput = document.getElementById('fileInput');

        document.getElementById('btnBrowse').addEventListener('click', () => fileInput.click());
        document.getElementById('btnSampleUpload').addEventListener('click', loadSampleData);

        fileInput.addEventListener('change', (e) => {
            if (e.target.files[0]) handleFile(e.target.files[0]);
        });

        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('drag-over');
        });
        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('drag-over');
        });
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('drag-over');
            if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
        });

        // Header buttons
        document.getElementById('btnSampleData').addEventListener('click', loadSampleData);
        document.getElementById('btnExportCSV').addEventListener('click', exportPivotCSV);
        document.getElementById('btnReset').addEventListener('click', resetAll);

        // View tabs
        document.querySelectorAll('.view-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                if (!rawData) return;
                UI.switchView(tab.dataset.view);
                if (tab.dataset.view === 'chart') renderChart();
            });
        });

        // Pivot export
        document.getElementById('btnExportPivotCSV').addEventListener('click', exportPivotCSV);

        // Chart type
        document.getElementById('chartTypeSelect').addEventListener('change', renderChart);

        // Chart export
        document.getElementById('btnExportChart').addEventListener('click', () => {
            const canvas = document.getElementById('chartCanvas');
            Charts.exportPNG(canvas, 'novapivot-chart.png');
            UI.toast('Chart exported as PNG', 'success');
        });

        // Pivot table sort click delegation
        document.getElementById('pivotTableWrapper').addEventListener('click', (e) => {
            const th = e.target.closest('.sortable');
            if (!th) return;

            const type = th.dataset.sortType;
            const index = parseInt(th.dataset.sortIndex || '0');
            const colIndex = parseInt(th.dataset.sortCol || '0');
            const valIndex = parseInt(th.dataset.sortVal || '0');

            // Toggle direction
            const isSame = sortState?.type === type && sortState?.index === index &&
                          sortState?.colIndex === colIndex && sortState?.valIndex === valIndex;
            const dir = isSame && sortState.dir === 'asc' ? 'desc' : 'asc';

            sortState = { type, index, colIndex, valIndex, dir };
            renderPivotTable();
        });

        // Window resize for chart
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (pivotResult && document.getElementById('viewChart').classList.contains('active')) {
                    renderChart();
                }
            }, 250);
        });
    }

    /**
     * Handle uploaded CSV file
     */
    function handleFile(file) {
        if (!file.name.match(/\.(csv|tsv|txt)$/i)) {
            UI.toast('Please upload a CSV, TSV, or TXT file', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                rawData = CSV.parse(e.target.result);
                columns = CSV.analyzeColumns(rawData.headers, rawData.data);
                onDataLoaded('file');
                UI.toast(`Loaded ${rawData.data.length} rows from ${file.name}`, 'success');
            } catch (err) {
                UI.toast(`Error parsing file: ${err.message}`, 'error');
            }
        };
        reader.onerror = () => UI.toast('Error reading file', 'error');
        reader.readAsText(file);
    }

    /**
     * Load the built-in sample dataset
     */
    function loadSampleData() {
        rawData = CSV.sampleData();
        columns = CSV.analyzeColumns(rawData.headers, rawData.data);
        onDataLoaded('sample');
        UI.toast('Sample sales data loaded (200 rows)', 'success');
    }

    /**
     * Called after data is loaded successfully
     */
    function onDataLoaded(source) {
        // Render data preview
        UI.renderDataTable(rawData.headers, rawData.data);

        // Populate fields
        UI.populateFields(columns);
        UI.updateZonePlaceholders();

        // Enable buttons
        document.getElementById('btnExportCSV').disabled = false;

        // Switch to data view
        UI.switchView('data');

        // Save source type
        UI.saveConfig({ lastData: source });
    }

    /**
     * Called when pivot configuration changes (fields dragged)
     */
    function onConfigChange() {
        const config = UI.getConfig();

        // Update filter controls
        UI.renderFilterControls(columns, rawData.data, activeFilters);

        // Save config
        UI.saveConfig({
            lastData: rawData ? 'sample' : null,
            pivot: config
        });

        // Compute pivot
        computePivot();
    }

    /**
     * Called when filter checkboxes change
     */
    function onFilterChange() {
        activeFilters = UI.getActiveFilters();
        computePivot();
    }

    /**
     * Compute and render pivot table
     */
    function computePivot() {
        if (!rawData) return;

        const config = UI.getConfig();
        sortState = null; // Reset sort on config change
        pivotResult = Pivot.compute(rawData.data, config, activeFilters);

        renderPivotTable();

        // Also update chart if visible
        if (document.getElementById('viewChart').classList.contains('active')) {
            renderChart();
        }
    }

    /**
     * Render the pivot table HTML
     */
    function renderPivotTable() {
        const wrapper = document.getElementById('pivotTableWrapper');

        if (!pivotResult) {
            wrapper.innerHTML = `
                <div class="pivot-empty-state">
                    <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><rect x="4" y="4" width="16" height="16" rx="2" stroke="var(--text-muted)" stroke-width="2"/><rect x="28" y="4" width="16" height="16" rx="2" stroke="var(--text-muted)" stroke-width="2"/><rect x="4" y="28" width="16" height="16" rx="2" stroke="var(--text-muted)" stroke-width="2"/><rect x="28" y="28" width="16" height="16" rx="2" stroke="var(--text-muted)" stroke-width="2"/></svg>
                    <p>Drag fields into Rows, Columns, and Values to build your pivot table</p>
                </div>`;
            return;
        }

        wrapper.innerHTML = Pivot.renderTable(pivotResult, sortState);
    }

    /**
     * Render the chart
     */
    function renderChart() {
        const canvas = document.getElementById('chartCanvas');
        const emptyState = document.getElementById('chartEmptyState');
        const chartType = document.getElementById('chartTypeSelect').value;

        if (!pivotResult || pivotResult.empty) {
            canvas.style.display = 'none';
            emptyState.style.display = 'flex';
            return;
        }

        canvas.style.display = 'block';
        emptyState.style.display = 'none';

        Charts.render(canvas, pivotResult, chartType);
    }

    /**
     * Export pivot table as CSV
     */
    function exportPivotCSV() {
        if (!pivotResult || pivotResult.empty) {
            UI.toast('No pivot data to export', 'error');
            return;
        }

        const csvText = Pivot.exportCSV(pivotResult);
        const blob = new Blob([csvText], { type: 'text/csv' });
        const link = document.createElement('a');
        link.download = 'novapivot-export.csv';
        link.href = URL.createObjectURL(blob);
        link.click();
        URL.revokeObjectURL(link.href);
        UI.toast('Pivot table exported as CSV', 'success');
    }

    /**
     * Reset everything
     */
    function resetAll() {
        rawData = null;
        columns = null;
        pivotResult = null;
        sortState = null;
        activeFilters = {};

        // Clear zones
        ['zoneFields', 'zoneRows', 'zoneColumns', 'zoneValues', 'zoneFilters'].forEach(id => {
            const zone = document.getElementById(id);
            zone.querySelectorAll('.field-chip').forEach(c => c.remove());
        });
        UI.updateZonePlaceholders();

        document.getElementById('filterControls').innerHTML = '';
        document.getElementById('dataTable').innerHTML = '';
        document.getElementById('pivotTableWrapper').innerHTML = '';
        document.getElementById('btnExportCSV').disabled = true;

        // Clear chart
        const canvas = document.getElementById('chartCanvas');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.display = 'none';
        document.getElementById('chartEmptyState').style.display = 'flex';

        // Clear saved config
        localStorage.removeItem('novapivot-config');

        UI.showUpload();
        UI.toast('Reset complete', 'info');
    }

    // Start the app
    document.addEventListener('DOMContentLoaded', init);

    return { onConfigChange, onFilterChange };
})();
