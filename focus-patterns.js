// focus-patterns.js — Pattern Engine + Zone Overlays
// Handles pattern detection, chart markers, canvas zone overlays,
// and dynamic support/resistance/mean price lines.
// Depends on: shared/chart.js (for allCandles, revealedSoFar via globals from focus-core.js).
// Load BEFORE focus-core.js, AFTER focus-summary.js.

// =========================
// PATTERN VISUAL CONFIG
// =========================
const PATTERN_COLOURS = {
    "Compression": "#6366f1",
    "Momentum Burst": "#10b981",
    "Failed Breakout": "#ef4444",
    "Failed Breakdown": "#f59e0b",
    "Spring": "#0ea5e9",
    "Engulfing Flip": "#8b5cf6",
};


const PATTERN_SHAPE = {
    "Compression": "arrowUp",
    "Momentum Burst": "arrowUp",
    "Failed Breakout": "arrowDown",
    "Failed Breakdown": "arrowUp",
    "Spring": "arrowUp",
    "Engulfing Flip": "circle",
};

// Maps seq_* DB column keys → display label
const SEQ_KEY_TO_LABEL = {
    seq_compression: "Compression",
    seq_momentum_burst: "Momentum Burst",
    seq_failed_breakout: "Failed Breakout",
    seq_failed_breakdown: "Failed Breakdown",
    seq_spring: "Spring",
    seq_engulfing_flip: "Engulfing Flip",
};

let patternMarkersActive = false;
let activePatternFilter = new Set();

// Dynamic zone price lines — updated every reveal
let dynamicZones = { resistance: null, support: null, mean: null };
let zonePriceLines = { resistance: null, support: null, mean: null };

// =========================
// ZONE CANVAS OVERLAY
// =========================
const ZONE_ALPHA = 0.13;
let zoneCanvas = null;
let zoneCtx = null;
let activeZones = [];

function setupZoneCanvas(chartDiv) {
    const old = chartDiv.querySelector('.zone-overlay-canvas');
    if (old) old.remove();

    zoneCanvas = document.createElement('canvas');
    zoneCanvas.className = 'zone-overlay-canvas';
    zoneCanvas.style.cssText = `
        position:absolute; top:0; left:0;
        width:100%; height:100%;
        pointer-events:none;
        z-index:2;
    `;
    chartDiv.style.position = 'relative';
    chartDiv.appendChild(zoneCanvas);
    zoneCtx = zoneCanvas.getContext('2d');
}

function drawZoneOverlays() {
    if (!zoneCanvas || !zoneCtx || !chart || !candlestickSeries) return;

    const rect = zoneCanvas.getBoundingClientRect();
    zoneCanvas.width = rect.width;
    zoneCanvas.height = rect.height;
    zoneCtx.clearRect(0, 0, zoneCanvas.width, zoneCanvas.height);

    if (activeZones.length === 0) return;

    activeZones.forEach(zone => {
        try {
            const x1 = chart.timeScale().timeToCoordinate(zone.startDate);
            const x2 = chart.timeScale().timeToCoordinate(zone.endDate);
            const y1 = candlestickSeries.priceToCoordinate(zone.high);
            const y2 = candlestickSeries.priceToCoordinate(zone.low);

            if (x1 === null || x2 === null || y1 === null || y2 === null) return;

            const left = Math.min(x1, x2) - 6;
            const right = Math.max(x1, x2) + 6;
            const top = Math.min(y1, y2) - 4;
            const bottom = Math.max(y1, y2) + 4;
            const width = right - left;
            const height = bottom - top;
            const radius = 6;

            zoneCtx.save();
            zoneCtx.globalAlpha = ZONE_ALPHA;
            zoneCtx.fillStyle = zone.colour;

            zoneCtx.beginPath();
            zoneCtx.moveTo(left + radius, top);
            zoneCtx.lineTo(right - radius, top);
            zoneCtx.quadraticCurveTo(right, top, right, top + radius);
            zoneCtx.lineTo(right, bottom - radius);
            zoneCtx.quadraticCurveTo(right, bottom, right - radius, bottom);
            zoneCtx.lineTo(left + radius, bottom);
            zoneCtx.quadraticCurveTo(left, bottom, left, bottom - radius);
            zoneCtx.lineTo(left, top + radius);
            zoneCtx.quadraticCurveTo(left, top, left + radius, top);
            zoneCtx.closePath();
            zoneCtx.fill();

            zoneCtx.globalAlpha = ZONE_ALPHA * 2.5;
            zoneCtx.strokeStyle = zone.colour;
            zoneCtx.lineWidth = 1;
            zoneCtx.stroke();
            zoneCtx.restore();
        } catch (e) { /* coordinate may be out of range */ }
    });
}

function setActiveZones(patterns) {
    const allVisible = [...allCandles, ...revealedSoFar];
    activeZones = patterns.map(p => {
        const seq = p.indices.map(i => allVisible[i]).filter(Boolean);
        if (seq.length === 0) return null;
        return {
            label: p.label,
            startDate: seq[0].date.slice(0, 10),
            endDate: seq[seq.length - 1].date.slice(0, 10),
            high: Math.max(...seq.map(c => c.high)),
            low: Math.min(...seq.map(c => c.low)),
            colour: PATTERN_COLOURS[p.label] || '#6366f1',
        };
    }).filter(Boolean);

    requestAnimationFrame(drawZoneOverlays);
}

function clearZoneOverlays() {
    activeZones = [];
    if (zoneCtx && zoneCanvas) {
        zoneCtx.clearRect(0, 0, zoneCanvas.width, zoneCanvas.height);
    }
}

// =========================
// DYNAMIC ZONES (price lines)
// =========================
function updateDynamicZones() {
    if (!candlestickSeries) return;

    const visible = [...allCandles, ...revealedSoFar];
    if (visible.length === 0) return;

    const resistance = Math.max(...visible.map(c => c.high));
    const support = Math.min(...visible.map(c => c.low));
    const mean = visible.reduce((s, c) => s + c.close, 0) / visible.length;

    dynamicZones = { resistance, support, mean };

    try {
        if (zonePriceLines.resistance) candlestickSeries.removePriceLine(zonePriceLines.resistance);
        if (zonePriceLines.support) candlestickSeries.removePriceLine(zonePriceLines.support);
        if (zonePriceLines.mean) candlestickSeries.removePriceLine(zonePriceLines.mean);
    } catch (e) { /* series may have been removed on block reload */ }

    zonePriceLines.resistance = candlestickSeries.createPriceLine({
        price: resistance, color: '#ef4444', lineWidth: 1, lineStyle: 2,
        axisLabelVisible: true, title: `R ₹${resistance.toFixed(2)}`,
    });
    zonePriceLines.support = candlestickSeries.createPriceLine({
        price: support, color: '#10b981', lineWidth: 1, lineStyle: 2,
        axisLabelVisible: true, title: `S ₹${support.toFixed(2)}`,
    });
    zonePriceLines.mean = candlestickSeries.createPriceLine({
        price: mean, color: '#6366f1', lineWidth: 1, lineStyle: 2,
        axisLabelVisible: true, title: `M ₹${mean.toFixed(2)}`,
    });
}

function clearDynamicZones() {
    try {
        if (zonePriceLines.resistance) candlestickSeries.removePriceLine(zonePriceLines.resistance);
        if (zonePriceLines.support) candlestickSeries.removePriceLine(zonePriceLines.support);
        if (zonePriceLines.mean) candlestickSeries.removePriceLine(zonePriceLines.mean);
    } catch (e) { }
    zonePriceLines = { resistance: null, support: null, mean: null };
    dynamicZones = { resistance: null, support: null, mean: null };
}

// =========================
// PATTERN DETECTION
// =========================
function getVisiblePatterns() {
    const precomputed = detectedPatterns.filter(p =>
        p.indices.every(idx => idx < allCandles.length)
    );

    const synthesised = [];
    Object.keys(SEQ_KEY_TO_LABEL).forEach(key => {
        const label = SEQ_KEY_TO_LABEL[key];
        let runStart = null;

        revealedSoFar.forEach((candle, i) => {
            if (candle[key] === 1) {
                if (runStart === null) runStart = i;
            } else {
                if (runStart !== null) {
                    synthesised.push(_buildSynthPattern(label, runStart, i - 1));
                    runStart = null;
                }
            }
        });
        if (runStart !== null) {
            synthesised.push(_buildSynthPattern(label, runStart, revealedSoFar.length - 1));
        }
    });

    return [...precomputed, ...synthesised];
}

function _buildSynthPattern(label, revealStart, revealEnd) {
    const offset = allCandles.length;
    const indices = [];
    for (let i = revealStart; i <= revealEnd; i++) indices.push(offset + i);
    return {
        label,
        start_date: revealedSoFar[revealStart].date,
        end_date: revealedSoFar[revealEnd].date,
        indices,
        metadata: { absolute_length: indices.length },
        synthesised: true,
    };
}

// =========================
// PATTERN EXPLAIN LAYERS
// =========================
function semanticLayer(pattern) {
    const label = pattern.label;
    const length = (pattern.metadata && pattern.metadata.absolute_length)
        ? pattern.metadata.absolute_length
        : pattern.indices.length;

    const defs = {
        "Compression": `A ${length}-candle compression where price contracts and volatility dries up.`,
        "Momentum Burst": `A ${length}-candle momentum burst showing strong directional pressure.`,
        "Failed Breakout": "A failed breakout where price pushed above resistance but could not hold.",
        "Failed Breakdown": "A failed breakdown where price dipped below support but snapped back.",
        "Spring": "A spring pattern — a sharp shakeout below support followed by a strong recovery.",
        "Engulfing Flip": "An engulfing flip — a decisive candle that swallows the prior range.",
    };
    return defs[label] || `A ${label} pattern.`;
}

function contextualLayer(pattern) {
    const idxs = pattern.indices;
    const allVisible = [...allCandles, ...revealedSoFar];
    const last = allVisible[idxs[idxs.length - 1]];
    const high = Math.max(...idxs.map(i => allVisible[i].high));
    const low = Math.min(...idxs.map(i => allVisible[i].low));

    const trendMap = {
        "uptrend": "during an uptrend",
        "downtrend": "during a downtrend",
        "sideways": "inside a sideways market",
    };
    const volMap = {
        "high_volatility": "with elevated volatility",
        "low_volatility": "with muted volatility",
        "unknown_volatility": "with normal volatility",
    };

    const trend = trendMap[last.trend_tag] || `during a ${last.trend_tag}`;
    const vol = volMap[last.volatility_tag] || `with ${last.volatility_tag}`;

    let base = `This occurred ${trend} ${vol}.`;

    if (dynamicZones.resistance !== null) {
        const { resistance, support, mean } = dynamicZones;
        const threshold = (resistance - support) * 0.05;

        if (pattern.label === "Failed Breakout" && Math.abs(high - resistance) <= threshold)
            base += ` This Failed Breakout is significant because it occurred exactly at the ₹${resistance.toFixed(2)} resistance level established earlier in this session.`;
        else if (pattern.label === "Failed Breakdown" && Math.abs(low - support) <= threshold)
            base += ` This Failed Breakdown is significant because it occurred exactly at the ₹${support.toFixed(2)} support level established earlier in this session.`;
        else if (pattern.label === "Spring" && Math.abs(low - support) <= threshold)
            base += ` The spring triggered precisely at the session support of ₹${support.toFixed(2)}, reinforcing that level as a strong demand zone.`;
        else if (pattern.label === "Compression" && Math.abs(last.close - mean) <= threshold)
            base += ` The compression is forming around the session mean of ₹${mean.toFixed(2)}, suggesting the market is coiling at a decision point.`;
        else if (high > resistance * 0.999 && high <= resistance * 1.02)
            base += ` This pattern approached the session resistance near ₹${resistance.toFixed(2)}.`;
        else if (low < support * 1.001 && low >= support * 0.98)
            base += ` This pattern approached the session support near ₹${support.toFixed(2)}.`;
    }

    return base;
}

function catalystLayer(pattern) {
    const allVisible = [...allCandles, ...revealedSoFar];
    const seq = pattern.indices.map(i => allVisible[i]);
    const vtags = seq.map(c => c.volume_tag);

    let volSentence;
    if (vtags.includes("volume_spike"))
        volSentence = "The move was confirmed by strong volume.";
    else if (vtags.includes("volume_drop"))
        volSentence = "The move lacked participation, showing weak commitment.";
    else
        volSentence = "Volume was normal, offering no special confirmation.";

    const avgBody = seq.reduce((s, c) => s + (c.body_ratio || 0), 0) / seq.length;
    let bodySentence;
    if (avgBody > 0.6) bodySentence = "Candle bodies were large and decisive.";
    else if (avgBody < 0.25) bodySentence = "Candle bodies were small and hesitant.";
    else bodySentence = "Candle bodies showed moderate conviction.";

    return `${volSentence} ${bodySentence}`;
}

function priceActionLayer(pattern) {
    const idxs = pattern.indices;
    const allVisible = [...allCandles, ...revealedSoFar];
    const seq = idxs.map(i => allVisible[i]);
    const first = allVisible[idxs[0]];
    const last = allVisible[idxs[idxs.length - 1]];

    const open = first.open;
    const close = last.close;
    const high = Math.max(...seq.map(c => c.high));
    const low = Math.min(...seq.map(c => c.low));
    const dir = close > open ? "rose" : "fell";

    const parts = [
        `Price ${dir} from ₹${open.toFixed(2)} to ₹${close.toFixed(2)}, ` +
        `spanning a range between ₹${low.toFixed(2)} and ₹${high.toFixed(2)}.`
    ];

    const sessionResistance = dynamicZones.resistance;
    const sessionSupport = dynamicZones.support;
    const sessionMean = dynamicZones.mean;

    if (pattern.label === "Failed Breakout") {
        const localResistance = idxs[0] > 0
            ? Math.max(...allVisible.slice(Math.max(0, idxs[0] - 10), idxs[0]).map(c => c.high))
            : null;
        const resistance = sessionResistance || localResistance;
        if (resistance !== null && high > resistance) {
            parts.push(
                `Price briefly pushed above the resistance near ₹${resistance.toFixed(2)} ` +
                `but was rejected and closed back below it. ` +
                `This rejection at the session high is a strong warning against further upside.`
            );
        }
    }

    if (pattern.label === "Failed Breakdown" || pattern.label === "Spring") {
        const localSupport = idxs[0] > 0
            ? Math.min(...allVisible.slice(Math.max(0, idxs[0] - 10), idxs[0]).map(c => c.low))
            : null;
        const support = sessionSupport || localSupport;
        if (support !== null && low < support) {
            parts.push(
                `Price briefly dipped below the support near ₹${support.toFixed(2)} ` +
                `before snapping back — a classic liquidity sweep at the session low.`
            );
        }
    }

    if (sessionMean !== null) {
        const meanProximity = (sessionResistance - sessionSupport) * 0.08;
        if (Math.abs(close - sessionMean) <= meanProximity)
            parts.push(`Price closed near the session mean of ₹${sessionMean.toFixed(2)}, suggesting equilibrium between buyers and sellers.`);
    }

    if (seq.some(c => (c.upper_wick_ratio || 0) > 0.6))
        parts.push("Long upper wicks showed strong overhead rejection.");
    if (seq.some(c => (c.lower_wick_ratio || 0) > 0.6))
        parts.push("Long lower wicks showed aggressive absorption of selling pressure.");

    const atrs = seq.map(c => c.atr).filter(v => v != null);
    if (atrs.length > 1) {
        const avgAtr = atrs.reduce((s, v) => s + v, 0) / atrs.length;
        if (atrs[atrs.length - 1] > avgAtr * 1.2)
            parts.push("ATR expanded sharply, signaling increased volatility.");
    }

    const ranges = seq.map(c => c.range || 0);
    const avgRange = ranges.reduce((s, v) => s + v, 0) / ranges.length;
    if (ranges[ranges.length - 1] > avgRange * 1.3)
        parts.push("The final candle showed a significant range expansion, indicating urgency.");

    const vtags = seq.map(c => c.volume_tag);
    if (vtags.includes("volume_spike")) parts.push("A volume spike reinforced the move.");
    else if (vtags.includes("volume_drop")) parts.push("Volume dropped, showing fading participation.");

    return parts.join(" ");
}

function summarizePattern(pattern) {
    const A = semanticLayer(pattern);
    const B = contextualLayer(pattern);
    const C = catalystLayer(pattern);
    const D = priceActionLayer(pattern);
    return {
        label: pattern.label, semantic: A, context: B, catalyst: C, price_action: D,
        full: [A, B, C, D].join(" ")
    };
}

// =========================
// TOGGLE / RENDER PILLS
// =========================
function togglePatterns() {
    const panel = document.getElementById('patternPanel');
    if (!panel) return;

    if (!panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
        clearPatternHighlights();
        activePatternFilter = new Set();
        return;
    }

    activePatternFilter = new Set();
    renderPatternPills();
    panel.classList.remove('hidden');
}

function renderPatternPills() {
    const panel = document.getElementById('patternPanel');
    const visible = getVisiblePatterns();

    if (visible.length === 0) {
        panel.innerHTML = '<span class="pattern-none">No sequences detected on visible candles yet.</span>';
        clearPatternHighlights();
        return;
    }

    const byLabel = {};
    visible.forEach(p => {
        if (!byLabel[p.label]) byLabel[p.label] = [];
        byLabel[p.label].push(p);
    });

    panel.innerHTML = Object.entries(byLabel).map(([label, patterns]) => {
        const colour = PATTERN_COLOURS[label] || '#6366f1';
        const isSelected = activePatternFilter.has(label);
        const anySelected = activePatternFilter.size > 0;
        const bg = isSelected ? colour : `${colour}20`;
        const border = isSelected ? colour : `${colour}40`;
        const text = isSelected ? '#fff' : colour;
        const opacity = (anySelected && !isSelected) ? '0.4' : '1';

        return `<span
            class="pattern-tag pattern-pill-btn"
            onclick="filterPattern('${label}')"
            style="background:${bg};color:${text};border:1px solid ${border};
                   opacity:${opacity};cursor:pointer;transition:all 0.15s;user-select:none">
            ${label}
            <span style="opacity:0.7;font-size:10px;margin-left:3px">(${patterns.length})</span>
        </span>`;
    }).join('');

    const toMark = activePatternFilter.size > 0
        ? visible.filter(p => activePatternFilter.has(p.label))
        : visible;

    drawPatternMarkers(toMark);
    setActiveZones(toMark);
}

function filterPattern(label) {
    if (activePatternFilter.has(label)) {
        activePatternFilter.delete(label);
    } else {
        activePatternFilter.add(label);
    }
    renderPatternPills();

    const ep = document.getElementById('patternExplainPanel');
    if (ep && !ep.classList.contains('hidden')) renderPatternExplain();
}

function togglePatternExplain() {
    const panel = document.getElementById('patternExplainPanel');
    if (!panel) return;

    if (!panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
        return;
    }

    renderPatternExplain();
    panel.classList.remove('hidden');
}

function renderPatternExplain() {
    const panel = document.getElementById('patternExplainPanel');
    if (!panel) return;

    const visible = getVisiblePatterns();
    const filtered = activePatternFilter.size > 0
        ? visible.filter(p => activePatternFilter.has(p.label))
        : visible;

    if (filtered.length === 0) {
        panel.innerHTML = '<span class="pattern-none">No sequences detected on visible candles yet.</span>';
        return;
    }

    panel.innerHTML = filtered.map(p => {
        const s = summarizePattern(p);
        const colour = PATTERN_COLOURS[p.label] || '#6366f1';
        const dates = `${p.start_date.slice(0, 10)} → ${p.end_date.slice(0, 10)}`;
        return `<div class="pattern-explain-item">
            <div class="pattern-explain-label" style="color:${colour}">${s.label}
                <span style="font-weight:400;font-size:11px;color:#94a3b8;margin-left:6px">${dates}</span>
            </div>
            <div style="margin:4px 0 2px"><strong>What:</strong> ${s.semantic}</div>
            <div style="margin:2px 0"><strong>Where:</strong> ${s.context}</div>
            <div style="margin:2px 0"><strong>Why:</strong> ${s.catalyst}</div>
            <div style="margin:2px 0"><strong>Price action:</strong> ${s.price_action}</div>
        </div>`;
    }).join('<hr style="border:none;border-top:1px solid rgba(0,0,0,0.06);margin:10px 0">');
}

function drawPatternMarkers(patterns) {
    if (!candlestickSeries) return;

    const allVisible = [...allCandles, ...revealedSoFar];
    const markers = [];

    patterns.forEach(p => {
        const colour = PATTERN_COLOURS[p.label] || '#6366f1';
        const firstIdx = p.indices[0];
        const firstCandle = allVisible[firstIdx];
        if (!firstCandle) return;

        const isBullishPattern = ["Momentum Burst", "Failed Breakdown", "Spring"].includes(p.label);
        const position = isBullishPattern ? 'belowBar' : 'aboveBar';
        const startShape = isBullishPattern ? 'arrowUp' : 'arrowDown';

        markers.push({
            time: firstCandle.date.slice(0, 10),
            position,
            color: colour,
            shape: startShape,
            text: p.label,
            size: 0,
        });
    });

    markers.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
    candlestickSeries.setMarkers(markers);
    patternMarkersActive = true;
}

function clearPatternHighlights() {
    if (candlestickSeries && patternMarkersActive) {
        candlestickSeries.setMarkers([]);
        patternMarkersActive = false;
    }
    clearZoneOverlays();
}

function hidePatternPanels() {
    const pp = document.getElementById('patternPanel');
    const ep = document.getElementById('patternExplainPanel');
    if (pp) pp.classList.add('hidden');
    if (ep) ep.classList.add('hidden');
    activePatternFilter = new Set();
}
