// shared/chart.js — Shared candlestick chart helpers
// Depends on: nothing (pure functions).
// Load before any mode-specific JS that renders a LightweightCharts chart.

// =========================
// CANDLE COLOR CONSTANTS
// Defined once here — never hard-code these strings elsewhere.
// =========================
const CANDLE_UP_COLOR   = '#26a69a';
const CANDLE_DOWN_COLOR = '#ef5350';

const VOLUME_UP_COLOR   = 'rgba(38, 166, 154, 0.5)';
const VOLUME_DOWN_COLOR = 'rgba(239, 83, 80, 0.5)';

// =========================
// CANDLE HELPERS
// =========================

/** Returns true if the candle is bullish (closed above open). */
function isBullish(candle) {
    return candle.bullish === 1;
}

/**
 * Maps a DB candle object to a LightweightCharts candlestick data point.
 * @param {object} c — raw candle from Supabase
 * @returns {{ time, open, high, low, close }}
 */
function toCandlePoint(c) {
    return {
        time:  c.date.slice(0, 10),
        open:  c.open,
        high:  c.high,
        low:   c.low,
        close: c.close,
    };
}

/**
 * Maps a DB candle to a LightweightCharts histogram (volume) data point.
 * @param {object} c — raw candle from Supabase
 * @returns {{ time, value, color }}
 */
function toVolumePoint(c) {
    return {
        time:  c.date.slice(0, 10),
        value: c.volume,
        color: isBullish(c) ? VOLUME_UP_COLOR : VOLUME_DOWN_COLOR,
    };
}

/**
 * Shared candlestick series options — visual identity is consistent across all modes.
 * Pass to chart.addCandlestickSeries().
 */
const CANDLESTICK_SERIES_OPTIONS = {
    upColor:        CANDLE_UP_COLOR,
    downColor:      CANDLE_DOWN_COLOR,
    borderUpColor:  CANDLE_UP_COLOR,
    borderDownColor: CANDLE_DOWN_COLOR,
    wickUpColor:    CANDLE_UP_COLOR,
    wickDownColor:  CANDLE_DOWN_COLOR,
    borderVisible:  true,
    wickVisible:    true,
    wickWidth:      5,
};

/**
 * Shared volume series options.
 * Pass to chart.addHistogramSeries().
 */
const VOLUME_SERIES_OPTIONS = {
    priceFormat:       { type: 'volume' },
    priceScaleId:      'volume',
    lastValueVisible:  false,
    priceLineVisible:  false,
};

/** Shared price scale options for the volume panel (bottom 25%). */
const VOLUME_PRICE_SCALE_OPTIONS = {
    scaleMargins: { top: 0.75, bottom: 0 },
    visible:      false,
};
