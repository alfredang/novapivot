/**
 * charts.js - Canvas-based chart rendering for pivot data
 *
 * Supports: bar, stackedBar, line, area, pie, heatmap
 */
const Charts = (() => {
    // Color palette - vibrant but professional
    const COLORS = [
        '#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444',
        '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#3b82f6',
        '#84cc16', '#e11d48', '#0ea5e9', '#a855f7', '#22c55e'
    ];

    const PADDING = { top: 50, right: 30, bottom: 70, left: 80 };
    const ANIMATION_DURATION = 500;

    let animationFrame = null;
    let tooltipEl = null;

    /**
     * Main render function
     */
    function render(canvas, pivotResult, chartType) {
        if (!pivotResult || pivotResult.empty) return;

        const ctx = canvas.getContext('2d');
        const container = canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;

        // Size canvas to container
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = Math.max(400, rect.height - 20) * dpr;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = Math.max(400, rect.height - 20) + 'px';
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = Math.max(400, rect.height - 20);

        // Prepare data
        const chartData = prepareData(pivotResult);
        if (!chartData || chartData.labels.length === 0) return;

        // Clear
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        ctx.clearRect(0, 0, w, h);

        // Setup tooltip
        ensureTooltip(container);

        // Draw based on type
        switch (chartType) {
            case 'bar': drawBarChart(ctx, w, h, chartData, isDark, false); break;
            case 'stackedBar': drawBarChart(ctx, w, h, chartData, isDark, true); break;
            case 'line': drawLineChart(ctx, w, h, chartData, isDark, false); break;
            case 'area': drawLineChart(ctx, w, h, chartData, isDark, true); break;
            case 'pie': drawPieChart(ctx, w, h, chartData, isDark); break;
            case 'heatmap': drawHeatmap(ctx, w, h, chartData, isDark); break;
            default: drawBarChart(ctx, w, h, chartData, isDark, false);
        }

        // Draw legend
        drawLegend(ctx, w, chartData, isDark);

        // Setup hover detection
        setupHover(canvas, w, h, chartData, chartType, isDark);
    }

    /**
     * Prepare chart data from pivot result
     */
    function prepareData(result) {
        const { rowKeys, colKeys, cells, valueFields } = result;
        if (!rowKeys || rowKeys.length === 0) return null;

        const labels = rowKeys.map(rk => rk.parts.join(' / '));

        // If we have column fields, each column becomes a series
        // Otherwise each value field becomes a series
        const series = [];

        if (colKeys.length > 0 && colKeys[0].parts.join('') !== '') {
            // Series from columns (use first value field)
            for (let ci = 0; ci < colKeys.length; ci++) {
                const values = rowKeys.map((_, ri) => {
                    return cells[ri][ci] ? cells[ri][ci][0] : 0;
                });
                series.push({
                    name: colKeys[ci].parts.join(' / '),
                    values,
                    color: COLORS[ci % COLORS.length]
                });
            }
        } else {
            // Series from value fields
            for (let vi = 0; vi < valueFields.length; vi++) {
                const values = rowKeys.map((_, ri) => {
                    return cells[ri][0] ? cells[ri][0][vi] : 0;
                });
                const vf = valueFields[vi];
                series.push({
                    name: vf.name === '_count_' ? 'Count' : `${vf.aggregation}(${vf.name})`,
                    values,
                    color: COLORS[vi % COLORS.length]
                });
            }
        }

        return { labels, series };
    }

    /**
     * Draw bar chart (grouped or stacked)
     */
    function drawBarChart(ctx, w, h, data, isDark, stacked) {
        const { labels, series } = data;
        const plotW = w - PADDING.left - PADDING.right;
        const plotH = h - PADDING.top - PADDING.bottom;

        // Calculate max value
        let maxVal;
        if (stacked) {
            maxVal = Math.max(...labels.map((_, i) =>
                series.reduce((sum, s) => sum + Math.max(0, s.values[i] || 0), 0)
            ));
        } else {
            maxVal = Math.max(...series.flatMap(s => s.values.map(v => Math.max(0, v || 0))));
        }
        if (maxVal === 0) maxVal = 1;

        const niceMax = niceNum(maxVal);
        const ticks = generateTicks(0, niceMax);

        // Draw axes and gridlines
        drawAxes(ctx, w, h, ticks, labels, isDark);

        // Draw bars
        const barGroupWidth = plotW / labels.length;
        const gap = barGroupWidth * 0.2;
        const barAreaWidth = barGroupWidth - gap;

        for (let li = 0; li < labels.length; li++) {
            if (stacked) {
                let yOffset = 0;
                for (let si = 0; si < series.length; si++) {
                    const val = Math.max(0, series[si].values[li] || 0);
                    const barH = (val / niceMax) * plotH;
                    const x = PADDING.left + li * barGroupWidth + gap / 2;
                    const y = PADDING.top + plotH - yOffset - barH;

                    ctx.fillStyle = series[si].color;
                    roundRect(ctx, x, y, barAreaWidth, barH, 3);
                    yOffset += barH;
                }
            } else {
                const singleBarWidth = barAreaWidth / series.length;
                for (let si = 0; si < series.length; si++) {
                    const val = Math.max(0, series[si].values[li] || 0);
                    const barH = (val / niceMax) * plotH;
                    const x = PADDING.left + li * barGroupWidth + gap / 2 + si * singleBarWidth;
                    const y = PADDING.top + plotH - barH;

                    ctx.fillStyle = series[si].color;
                    roundRect(ctx, x, y, singleBarWidth - 2, barH, 3);
                }
            }
        }
    }

    /**
     * Draw line or area chart
     */
    function drawLineChart(ctx, w, h, data, isDark, filled) {
        const { labels, series } = data;
        const plotW = w - PADDING.left - PADDING.right;
        const plotH = h - PADDING.top - PADDING.bottom;

        const allVals = series.flatMap(s => s.values.filter(v => v != null));
        let maxVal = Math.max(...allVals.map(v => Math.abs(v)));
        if (maxVal === 0) maxVal = 1;
        const niceMax = niceNum(maxVal);
        const ticks = generateTicks(0, niceMax);

        drawAxes(ctx, w, h, ticks, labels, isDark);

        for (const s of series) {
            const points = s.values.map((v, i) => ({
                x: PADDING.left + (i + 0.5) * (plotW / labels.length),
                y: PADDING.top + plotH - ((Math.max(0, v || 0) / niceMax) * plotH)
            }));

            if (filled) {
                ctx.beginPath();
                ctx.moveTo(points[0].x, PADDING.top + plotH);
                for (const p of points) ctx.lineTo(p.x, p.y);
                ctx.lineTo(points[points.length - 1].x, PADDING.top + plotH);
                ctx.closePath();
                ctx.fillStyle = s.color + '30';
                ctx.fill();
            }

            // Line
            ctx.beginPath();
            ctx.strokeStyle = s.color;
            ctx.lineWidth = 2.5;
            ctx.lineJoin = 'round';
            for (let i = 0; i < points.length; i++) {
                if (i === 0) ctx.moveTo(points[i].x, points[i].y);
                else ctx.lineTo(points[i].x, points[i].y);
            }
            ctx.stroke();

            // Dots
            for (const p of points) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                ctx.fillStyle = s.color;
                ctx.fill();
                ctx.strokeStyle = isDark ? '#1e1e2e' : '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }
    }

    /**
     * Draw pie chart
     */
    function drawPieChart(ctx, w, h, data, isDark) {
        const { labels, series } = data;
        // Use first series
        const values = series[0]?.values || [];
        const total = values.reduce((s, v) => s + Math.max(0, v || 0), 0);
        if (total === 0) return;

        const cx = w / 2;
        const cy = (h - 20) / 2 + 20;
        const radius = Math.min(cx - 60, cy - 60);

        let startAngle = -Math.PI / 2;
        for (let i = 0; i < values.length; i++) {
            const val = Math.max(0, values[i] || 0);
            const sliceAngle = (val / total) * Math.PI * 2;
            const endAngle = startAngle + sliceAngle;

            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, radius, startAngle, endAngle);
            ctx.closePath();
            ctx.fillStyle = COLORS[i % COLORS.length];
            ctx.fill();

            // Slice border
            ctx.strokeStyle = isDark ? '#1e1e2e' : '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Label
            if (sliceAngle > 0.15) {
                const midAngle = startAngle + sliceAngle / 2;
                const labelR = radius * 0.65;
                const lx = cx + Math.cos(midAngle) * labelR;
                const ly = cy + Math.sin(midAngle) * labelR;
                const pct = ((val / total) * 100).toFixed(1) + '%';

                ctx.fillStyle = '#ffffff';
                ctx.font = '600 12px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(pct, lx, ly);
            }

            startAngle = endAngle;
        }

        // Draw labels outside
        startAngle = -Math.PI / 2;
        for (let i = 0; i < values.length; i++) {
            const val = Math.max(0, values[i] || 0);
            const sliceAngle = (val / total) * Math.PI * 2;
            if (sliceAngle > 0.1) {
                const midAngle = startAngle + sliceAngle / 2;
                const labelR = radius + 20;
                const lx = cx + Math.cos(midAngle) * labelR;
                const ly = cy + Math.sin(midAngle) * labelR;

                ctx.fillStyle = isDark ? '#e0e0e0' : '#333333';
                ctx.font = '500 11px Inter, sans-serif';
                ctx.textAlign = midAngle > Math.PI / 2 && midAngle < Math.PI * 1.5 ? 'right' : 'left';
                ctx.textBaseline = 'middle';

                const label = labels[i]?.length > 15 ? labels[i].substring(0, 15) + '...' : labels[i];
                ctx.fillText(label, lx, ly);
            }
            startAngle += sliceAngle;
        }
    }

    /**
     * Draw heatmap
     */
    function drawHeatmap(ctx, w, h, data, isDark) {
        const { labels, series } = data;
        if (!series.length) return;

        const allVals = series.flatMap(s => s.values.filter(v => v != null && v !== 0));
        const maxVal = Math.max(...allVals);
        const minVal = Math.min(...allVals);

        const cellW = Math.min(80, (w - PADDING.left - 60) / labels.length);
        const cellH = Math.min(40, (h - PADDING.top - PADDING.bottom) / series.length);

        // Row labels (series names)
        ctx.fillStyle = isDark ? '#a0a0b0' : '#666666';
        ctx.font = '500 11px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let si = 0; si < series.length; si++) {
            const y = PADDING.top + si * cellH + cellH / 2;
            const name = series[si].name.length > 12 ? series[si].name.substring(0, 12) + '...' : series[si].name;
            ctx.fillText(name, PADDING.left - 10, y);
        }

        // Column labels
        ctx.textAlign = 'center';
        for (let li = 0; li < labels.length; li++) {
            const x = PADDING.left + li * cellW + cellW / 2;
            const y = PADDING.top + series.length * cellH + 15;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(-Math.PI / 6);
            const label = labels[li]?.length > 10 ? labels[li].substring(0, 10) + '...' : labels[li];
            ctx.fillText(label, 0, 0);
            ctx.restore();
        }

        // Draw cells
        for (let si = 0; si < series.length; si++) {
            for (let li = 0; li < labels.length; li++) {
                const val = series[si].values[li] || 0;
                const intensity = maxVal === minVal ? 0.5 : (val - minVal) / (maxVal - minVal);
                const x = PADDING.left + li * cellW;
                const y = PADDING.top + si * cellH;

                ctx.fillStyle = heatmapColor(intensity, isDark);
                roundRect(ctx, x + 1, y + 1, cellW - 2, cellH - 2, 3);

                // Value text
                ctx.fillStyle = intensity > 0.5 ? '#ffffff' : (isDark ? '#e0e0e0' : '#333333');
                ctx.font = '500 10px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(formatCompact(val), x + cellW / 2, y + cellH / 2);
            }
        }
    }

    /**
     * Draw axes with gridlines
     */
    function drawAxes(ctx, w, h, ticks, labels, isDark) {
        const plotW = w - PADDING.left - PADDING.right;
        const plotH = h - PADDING.top - PADDING.bottom;
        const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
        const textColor = isDark ? '#a0a0b0' : '#888888';
        const maxTick = ticks[ticks.length - 1];

        // Gridlines and Y-axis labels
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.font = '400 11px Inter, sans-serif';

        for (const tick of ticks) {
            const y = PADDING.top + plotH - (tick / maxTick) * plotH;
            ctx.strokeStyle = gridColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(PADDING.left, y);
            ctx.lineTo(PADDING.left + plotW, y);
            ctx.stroke();

            ctx.fillStyle = textColor;
            ctx.fillText(formatCompact(tick), PADDING.left - 10, y);
        }

        // X-axis labels
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const maxLabels = Math.floor(plotW / 60);
        const step = Math.max(1, Math.ceil(labels.length / maxLabels));

        for (let i = 0; i < labels.length; i += step) {
            const x = PADDING.left + (i + 0.5) * (plotW / labels.length);
            const y = PADDING.top + plotH + 8;

            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(-Math.PI / 6);
            ctx.fillStyle = textColor;
            const label = labels[i]?.length > 12 ? labels[i].substring(0, 12) + '...' : labels[i];
            ctx.fillText(label, 0, 0);
            ctx.restore();
        }

        // Axis lines
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PADDING.left, PADDING.top);
        ctx.lineTo(PADDING.left, PADDING.top + plotH);
        ctx.lineTo(PADDING.left + plotW, PADDING.top + plotH);
        ctx.stroke();
    }

    /**
     * Draw legend at top
     */
    function drawLegend(ctx, w, data, isDark) {
        if (data.series.length <= 1) return;

        ctx.font = '500 11px Inter, sans-serif';
        const textColor = isDark ? '#d0d0d0' : '#444444';

        let x = PADDING.left;
        const y = 20;

        for (const s of data.series) {
            // Dot
            ctx.beginPath();
            ctx.arc(x + 6, y, 5, 0, Math.PI * 2);
            ctx.fillStyle = s.color;
            ctx.fill();

            // Label
            ctx.fillStyle = textColor;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const name = s.name.length > 20 ? s.name.substring(0, 20) + '...' : s.name;
            ctx.fillText(name, x + 16, y);

            x += ctx.measureText(name).width + 36;
            if (x > w - 100) break; // Prevent overflow
        }
    }

    /**
     * Setup hover tooltip on canvas
     */
    function setupHover(canvas, w, h, data, chartType, isDark) {
        canvas.onmousemove = (e) => {
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            if (chartType === 'pie') {
                handlePieHover(canvas, mx, my, w, h, data, e);
            } else if (chartType === 'heatmap') {
                hideTooltip();
            } else {
                handleCartesianHover(canvas, mx, my, w, h, data, e);
            }
        };

        canvas.onmouseleave = () => hideTooltip();
    }

    function handleCartesianHover(canvas, mx, my, w, h, data, e) {
        const plotW = w - PADDING.left - PADDING.right;
        const plotH = h - PADDING.top - PADDING.bottom;

        if (mx < PADDING.left || mx > PADDING.left + plotW || my < PADDING.top || my > PADDING.top + plotH) {
            hideTooltip();
            return;
        }

        const barGroupWidth = plotW / data.labels.length;
        const idx = Math.floor((mx - PADDING.left) / barGroupWidth);
        if (idx < 0 || idx >= data.labels.length) {
            hideTooltip();
            return;
        }

        let html = `<strong>${data.labels[idx]}</strong>`;
        for (const s of data.series) {
            const val = s.values[idx];
            html += `<br><span style="color:${s.color}">\u25CF</span> ${s.name}: ${Pivot.formatValue(val)}`;
        }

        showTooltip(canvas, e.clientX, e.clientY, html);
    }

    function handlePieHover(canvas, mx, my, w, h, data, e) {
        const cx = w / 2;
        const cy = (h - 20) / 2 + 20;
        const dx = mx - cx;
        const dy = my - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const radius = Math.min(cx - 60, cy - 60);

        if (dist > radius) { hideTooltip(); return; }

        let angle = Math.atan2(dy, dx);
        if (angle < -Math.PI / 2) angle += Math.PI * 2;

        const values = data.series[0]?.values || [];
        const total = values.reduce((s, v) => s + Math.max(0, v || 0), 0);
        let cumAngle = -Math.PI / 2;

        for (let i = 0; i < values.length; i++) {
            const sliceAngle = (Math.max(0, values[i] || 0) / total) * Math.PI * 2;
            if (angle >= cumAngle && angle < cumAngle + sliceAngle) {
                const pct = ((values[i] / total) * 100).toFixed(1);
                showTooltip(canvas, e.clientX, e.clientY,
                    `<strong>${data.labels[i]}</strong><br>${Pivot.formatValue(values[i])} (${pct}%)`);
                return;
            }
            cumAngle += sliceAngle;
        }
        hideTooltip();
    }

    function ensureTooltip(container) {
        if (!tooltipEl) {
            tooltipEl = document.createElement('div');
            tooltipEl.className = 'chart-tooltip';
            document.body.appendChild(tooltipEl);
        }
    }

    function showTooltip(canvas, x, y, html) {
        if (!tooltipEl) return;
        tooltipEl.innerHTML = html;
        tooltipEl.style.display = 'block';
        tooltipEl.style.left = (x + 12) + 'px';
        tooltipEl.style.top = (y - 10) + 'px';
    }

    function hideTooltip() {
        if (tooltipEl) tooltipEl.style.display = 'none';
    }

    /**
     * Export chart canvas as PNG
     */
    function exportPNG(canvas, filename) {
        const link = document.createElement('a');
        link.download = filename || 'novapivot-chart.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    }

    // Utility functions
    function roundRect(ctx, x, y, w, h, r) {
        if (h <= 0) return;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();
    }

    function niceNum(val) {
        const exp = Math.floor(Math.log10(val));
        const frac = val / Math.pow(10, exp);
        let nice;
        if (frac <= 1) nice = 1;
        else if (frac <= 2) nice = 2;
        else if (frac <= 5) nice = 5;
        else nice = 10;
        return nice * Math.pow(10, exp);
    }

    function generateTicks(min, max, count = 5) {
        const step = (max - min) / count;
        const ticks = [];
        for (let i = 0; i <= count; i++) {
            ticks.push(min + step * i);
        }
        return ticks;
    }

    function formatCompact(val) {
        if (val === null || val === undefined) return '';
        if (Math.abs(val) >= 1000000) return (val / 1000000).toFixed(1) + 'M';
        if (Math.abs(val) >= 1000) return (val / 1000).toFixed(1) + 'K';
        return Number.isInteger(val) ? val.toString() : val.toFixed(1);
    }

    function heatmapColor(intensity, isDark) {
        // Blue to red gradient
        const r = Math.round(30 + intensity * 200);
        const g = Math.round(80 - intensity * 40);
        const b = Math.round(220 - intensity * 180);
        return `rgb(${r}, ${g}, ${b})`;
    }

    return { render, exportPNG, COLORS };
})();
