// Values and names come exclusively from the translated Unreal Blueprint report.
// A meter is only a presentation of a witnessed getter, not a substitute stat.
export function sourceMetricRows(metrics) {
    if (!Array.isArray(metrics)) throw new Error('Missing source metrics');
    return metrics.map(metric => {
        if (typeof metric?.current !== 'string' || !metric.current ||
            typeof metric?.function !== 'string' || !metric.function ||
            typeof metric.value !== 'number' || !Number.isFinite(metric.value) ||
            !Number.isFinite(metric.value * 100))
            throw new Error('Invalid source metric');
        const label = metric.current.replace(/^Current/, '') || metric.current;
        const current = typeof metric.current_value === 'number' && Number.isFinite(metric.current_value)
            ? metric.current_value : null;
        const maximum = typeof metric.maximum_value === 'number' && Number.isFinite(metric.maximum_value)
            ? metric.maximum_value : null;
        // Keep the original getter result, even if it lies outside the UI meter.
        const percentage = metric.value * 100;
        return {id: `${metric.package || ''}:${metric.function}:${metric.current}`,
            label, percentage, meterValue: Math.max(0, Math.min(100, percentage)),
            current, maximum, display: `${label}: ${Number(percentage.toFixed(1))}%` +
                (current !== null && maximum !== null ? ` · ${current}/${maximum}` : '')};
    });
}

export function renderSourceMetricHud(container, metrics, documentRoot = document) {
    const rows = sourceMetricRows(metrics);
    const fingerprint = JSON.stringify(rows);
    if (container.dataset.sourceMetricFingerprint === fingerprint) return rows.length;
    const elements = rows.map(row => {
        const box = documentRoot.createElement('div');
        box.className = 'ue2three-source-metric';
        const label = documentRoot.createElement('span');
        label.textContent = row.display;
        const meter = documentRoot.createElement('progress');
        meter.max = 100;
        meter.value = row.meterValue;
        meter.setAttribute('aria-label', row.label);
        meter.title = row.display;
        box.append(label, meter);
        return box;
    });
    container.replaceChildren(...elements);
    container.dataset.sourceMetricFingerprint = fingerprint;
    container.hidden = rows.length === 0;
    return rows.length;
}
