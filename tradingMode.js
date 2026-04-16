// tradingMode.js — Trading Mode logic.
// Depends on (loaded first): config.js, supabase.js, shared/chart.js, shared/ui.js

// =========================
// CONFIGURATION
// =========================
const ROLL_SPEED_MS = 400;   // fast roll — simulates trading excitement
const MANUAL_REVEAL_COUNT = 2;   // candles revealed per REVEAL press in BROWSING

// =========================
// STATE MACHINE
// 3 states: BROWSING → TRADING → REVIEWING → BROWSING
// =========================
const STATE = { BROWSING: 'BROWSING', TRADING: 'TRADING', REVIEWING: 'REVIEWING' };
let currentState = STATE.BROWSING;

// =========================
// CHART DATA
// =========================
let allCandles = [];
let futureCandles = [];
let revealIndex = 0;
let revealedSoFar = [];

// =========================
// TRADE STATE
// =========================
let activeTrade = null;   // the currently open trade object
let tradeHistory = [];     // all closed trades this session
let tradeIdCounter = 0;
let rollInterval = null;   // the setInterval handle

// =========================
// CHART HANDLES
// =========================
let chart;
let candlestickSeries;
let volumeSeries;

let username = localStorage.getItem("username") || "Player";

// =========================
// TRADE OBJECT FACTORY
// =========================
function createTrade(direction, entryPrice, entryIndex) {
    return {
        id: ++tradeIdCounter,
        direction: direction,        // 'BUY' | 'SELL'
        entryPrice: entryPrice,
        entryIndex: entryIndex,
        currentPrice: entryPrice,
        pl: 0,
        plPct: 0,
        duration: 0,
        status: 'OPEN',
        exitPrice: null,
        exitIndex: null,
    };
}

function calcPL(trade, currentPrice) {
    const multiplier = trade.direction === 'BUY' ? 1 : -1;
    const pl = (currentPrice - trade.entryPrice) * multiplier;
    const plPct = (pl / trade.entryPrice) * 100;
    return { pl, plPct };
}

/** Shows a spinner in the chart area while loading. */
function showChartLoading() {
    const chartDiv = document.getElementById('chart');
    if (chartDiv) chartDiv.innerHTML =
        '<div class="chart-loading"><div class="spinner"></div>Loading trade block...</div>';
}

/* -----------------------------------------
   1. LOAD BLOCK
----------------------------------------- */
async function loadTradingBlock() {
    showChartLoading();
    showStatus("Loading chart...");

    try {
        const { data, error } = await supabaseClient
            .from('trading_blocks')   // Uses same table as Focus Mode
            .select('id, block_id, candles, future, window_start')
            .order('id')
            .limit(500);

        if (error) throw error;

        if (!data || data.length === 0) {
            showStatus("No blocks available.");
            return;
        }

        const block = data[Math.floor(Math.random() * data.length)];

        if (!block.candles || !block.future) {
            showStatus("Block data missing.");
            return;
        }

        allCandles = block.candles;
        futureCandles = block.future;
        revealIndex = 0;
        revealedSoFar = [];
        activeTrade = null;
        tradeHistory = [];
        tradeIdCounter = 0;

        initChart();
        resetSession();
        showStatus("Study the chart. Enter a trade when ready.");

    } catch (err) {
        console.error("Supabase Error:", err.message);
        showStatus("Failed to load block.");
    }
}

/* -----------------------------------------
   2. CHART SETUP
   Uses shared constants from shared/chart.js.
----------------------------------------- */
function initChart() {
    const chartDiv = document.getElementById('chart');
    if (chart) chart.remove();
    chartDiv.innerHTML = '';

    chart = window.LightweightCharts.createChart(chartDiv, {
        height: 501,
        layout: { textColor: '#000', backgroundColor: '#fff' },
        timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 4 },
        rightPriceScale: { scaleMargins: { top: 0.05, bottom: 0.25 } },
    });

    candlestickSeries = chart.addCandlestickSeries(CANDLESTICK_SERIES_OPTIONS);
    volumeSeries = chart.addHistogramSeries(VOLUME_SERIES_OPTIONS);
    chart.priceScale('volume').applyOptions(VOLUME_PRICE_SCALE_OPTIONS);

    renderChart();

    const every = [...allCandles, ...futureCandles];
    const yMin = Math.min(...every.map(c => c.low)) * 0.995;
    const yMax = Math.max(...every.map(c => c.high)) * 1.005;

    candlestickSeries.applyOptions({
        autoscaleInfoProvider: () => ({
            priceRange: { minValue: yMin, maxValue: yMax },
        }),
    });

    chart.timeScale().fitContent();
}

function renderChart() {
    const candles = [...allCandles, ...revealedSoFar];
    candlestickSeries.setData(candles.map(toCandlePoint));
    volumeSeries.setData(candles.map(toVolumePoint));
}

/* -----------------------------------------
   3. SESSION RESET
----------------------------------------- */
function resetSession() {
    if (rollInterval) clearInterval(rollInterval);
    rollInterval = null;
    activeTrade = null;
    tradeHistory = [];
    tradeIdCounter = 0;

    clearLiveTrade();
    clearTapeRows();
    updateSessionSummary();
    transitionTo(STATE.BROWSING);
}

/* -----------------------------------------
   4. STATE TRANSITIONS
----------------------------------------- */
function transitionTo(newState) {
    currentState = newState;

    const revealBtn = document.getElementById('revealBtn');
    const buyBtn = document.getElementById('buyBtn');
    const sellBtn = document.getElementById('sellBtn');
    const exitBtn = document.getElementById('exitBtn');

    const dim = el => { if (el) { el.disabled = true; el.classList.add('btn-dim'); } };
    const light = el => { if (el) { el.disabled = false; el.classList.remove('btn-dim'); } };

    if (newState === STATE.BROWSING) {
        light(revealBtn); light(buyBtn); light(sellBtn); dim(exitBtn);
        showStatus("Study the chart. Enter a trade when ready.");
    } else if (newState === STATE.TRADING) {
        dim(revealBtn); dim(buyBtn); dim(sellBtn); light(exitBtn);
        showStatus("Trade open — watching market...");
    } else if (newState === STATE.REVIEWING) {
        light(revealBtn); light(buyBtn); light(sellBtn); dim(exitBtn);
        showStatus("Trade closed. Reveal more or enter a new trade.");
    }
}

/* -----------------------------------------
   5. MANUAL REVEAL (BROWSING only)
----------------------------------------- */
function manualReveal() {
    if (currentState !== STATE.BROWSING && currentState !== STATE.REVIEWING) return;
    if (revealIndex >= futureCandles.length) {
        endSession();
        return;
    }

    const count = Math.min(MANUAL_REVEAL_COUNT, futureCandles.length - revealIndex);
    for (let i = 0; i < count; i++) {
        revealedSoFar.push(futureCandles[revealIndex]);
        revealIndex++;
    }
    renderChart();
    updateHUD();
}

/* -----------------------------------------
   6. ENTER TRADE — BUY or SELL
----------------------------------------- */
function enterTrade(direction) {
    if (currentState !== STATE.BROWSING && currentState !== STATE.REVIEWING) return;

    const lastCandle = revealedSoFar.length > 0
        ? revealedSoFar[revealedSoFar.length - 1]
        : allCandles[allCandles.length - 1];

    activeTrade = createTrade(direction, lastCandle.close, revealIndex);

    showLiveTrade(activeTrade);
    transitionTo(STATE.TRADING);
    startAutoRoll();
}

/* -----------------------------------------
   7. AUTO-ROLL LOOP
----------------------------------------- */
function startAutoRoll() {
    if (rollInterval) clearInterval(rollInterval);

    rollInterval = setInterval(() => {
        if (revealIndex >= futureCandles.length) {
            // Candles exhausted — force exit then end session
            exitTrade();
            setTimeout(() => endSession(), 800);
            return;
        }

        // Reveal one candle
        const candle = futureCandles[revealIndex];
        revealedSoFar.push(candle);
        revealIndex++;
        renderChart();
        updateHUD();

        // Update trade with new price
        if (activeTrade && activeTrade.status === 'OPEN') {
            activeTrade.currentPrice = candle.close;
            activeTrade.duration = revealIndex - activeTrade.entryIndex;
            const { pl, plPct } = calcPL(activeTrade, candle.close);
            activeTrade.pl = pl;
            activeTrade.plPct = plPct;
            updateLiveTrade(activeTrade);
        }

    }, ROLL_SPEED_MS);
}

function stopAutoRoll() {
    if (rollInterval) clearInterval(rollInterval);
    rollInterval = null;
}

/* -----------------------------------------
   8. EXIT TRADE
----------------------------------------- */
function exitTrade() {
    if (!activeTrade || activeTrade.status !== 'OPEN') return;

    stopAutoRoll();

    const lastCandle = revealedSoFar[revealedSoFar.length - 1];
    activeTrade.exitPrice = lastCandle.close;
    activeTrade.exitIndex = revealIndex;
    activeTrade.status = 'CLOSED';

    const { pl, plPct } = calcPL(activeTrade, lastCandle.close);
    activeTrade.pl = pl;
    activeTrade.plPct = plPct;

    tradeHistory.push({ ...activeTrade });

    // Move live trade card to the tape as a closed row
    clearLiveTrade();
    addClosedTapeRow(activeTrade);
    updateSessionSummary();

    activeTrade = null;
    transitionTo(STATE.REVIEWING);
}

/* -----------------------------------------
   9. END SESSION
----------------------------------------- */
function endSession() {
    stopAutoRoll();

    // If trade still open when session ends, close it
    if (activeTrade && activeTrade.status === 'OPEN') {
        exitTrade();
    }

    const endScreen = document.getElementById('endScreen');
    const resultText = endScreen ? endScreen.querySelector('p') : null;
    if (!endScreen || !resultText) return;

    const totalPL = tradeHistory.reduce((sum, t) => sum + t.pl, 0);
    const wins = tradeHistory.filter(t => t.pl > 0).length;
    const winRate = tradeHistory.length > 0
        ? Math.round((wins / tradeHistory.length) * 100) : 0;
    const best = tradeHistory.length > 0
        ? Math.max(...tradeHistory.map(t => t.pl)) : 0;
    const worst = tradeHistory.length > 0
        ? Math.min(...tradeHistory.map(t => t.pl)) : 0;

    // Use shared color constants
    const plColor = totalPL >= 0 ? CANDLE_UP_COLOR : CANDLE_DOWN_COLOR;

    resultText.innerHTML =
        `<strong>Session Complete</strong><br><br>` +
        `Trades: <strong>${tradeHistory.length}</strong><br>` +
        `Win rate: <strong>${winRate}%</strong><br>` +
        `Total P/L: <strong style="color:${plColor}">` +
        `${totalPL >= 0 ? '+' : ''}₹${totalPL.toFixed(2)}</strong><br>` +
        `Best trade: <strong style="color:${CANDLE_UP_COLOR}">+₹${best.toFixed(2)}</strong><br>` +
        `Worst trade: <strong style="color:${CANDLE_DOWN_COLOR}">₹${worst.toFixed(2)}</strong>`;

    endScreen.classList.remove('hidden');

    document.getElementById('playAgainBtn').onclick = () => {
        endScreen.classList.add('hidden');
        loadTradingBlock();
    };
    document.getElementById('homeBtn').onclick = () => {
        window.location.href = 'index.html';
    };
}

/* -----------------------------------------
   10. LIVE TRADE CARD
----------------------------------------- */
function showLiveTrade(trade) {
    const el = document.getElementById('liveTrade');
    if (!el) return;
    el.classList.remove('hidden');
    updateLiveTrade(trade);
}

function updateLiveTrade(trade) {
    const el = document.getElementById('liveTrade');
    if (!el) return;

    const plColor = trade.pl >= 0 ? CANDLE_UP_COLOR : CANDLE_DOWN_COLOR;
    const dirColor = trade.direction === 'BUY' ? CANDLE_UP_COLOR : CANDLE_DOWN_COLOR;

    el.innerHTML = `
        <div class="live-direction" style="color:${dirColor}">${trade.direction}</div>
        <div class="live-entry">Entry: ₹${trade.entryPrice.toFixed(2)}</div>
        <div class="live-price">₹${trade.currentPrice.toFixed(2)}</div>
        <div class="live-pl" style="color:${plColor}">
            ${trade.pl >= 0 ? '+' : ''}₹${trade.pl.toFixed(2)}
            (${trade.plPct >= 0 ? '+' : ''}${trade.plPct.toFixed(2)}%)
        </div>
        <div class="live-duration">${trade.duration} bar${trade.duration !== 1 ? 's' : ''}</div>
    `;
}

function clearLiveTrade() {
    const el = document.getElementById('liveTrade');
    if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
}

/* -----------------------------------------
   11. CLOSED TRADE TAPE
----------------------------------------- */
function addClosedTapeRow(trade) {
    const tbody = document.getElementById('tapebody');
    if (!tbody) return;

    const plColor = trade.pl >= 0 ? CANDLE_UP_COLOR : CANDLE_DOWN_COLOR;
    const dirColor = trade.direction === 'BUY' ? CANDLE_UP_COLOR : CANDLE_DOWN_COLOR;
    const plSign = trade.pl >= 0 ? '+' : '';

    const row = document.createElement('tr');
    row.id = `trade-row-${trade.id}`;
    row.style.borderLeft = `3px solid ${plColor}`;

    row.innerHTML = `
        <td style="color:${dirColor};font-weight:600">${trade.direction}</td>
        <td>₹${trade.entryPrice.toFixed(2)}</td>
        <td>₹${trade.exitPrice.toFixed(2)}</td>
        <td style="color:${plColor};font-weight:600">
            ${plSign}₹${trade.pl.toFixed(2)}<br>
            <span style="font-size:10px">${plSign}${trade.plPct.toFixed(2)}%</span>
        </td>
        <td>${trade.duration}b</td>
    `;

    // Insert at top of table
    tbody.insertBefore(row, tbody.firstChild);
}

function clearTapeRows() {
    const tbody = document.getElementById('tapebody');
    if (tbody) tbody.innerHTML = '';
}

/* -----------------------------------------
   12. SESSION SUMMARY
----------------------------------------- */
function updateSessionSummary() {
    const el = document.getElementById('sessionSummary');
    if (!el) return;

    if (tradeHistory.length === 0) {
        el.innerHTML = '<span style="color:var(--color-text-tertiary);font-size:12px">No trades yet</span>';
        return;
    }

    const totalPL = tradeHistory.reduce((sum, t) => sum + t.pl, 0);
    const wins = tradeHistory.filter(t => t.pl > 0).length;
    const plColor = totalPL >= 0 ? CANDLE_UP_COLOR : CANDLE_DOWN_COLOR;
    const plSign = totalPL >= 0 ? '+' : '';

    el.innerHTML = `
        <div class="summary-row">
            <span>Trades</span><strong>${tradeHistory.length}</strong>
        </div>
        <div class="summary-row">
            <span>Win rate</span><strong>${Math.round((wins / tradeHistory.length) * 100)}%</strong>
        </div>
        <div class="summary-row">
            <span>Total P/L</span>
            <strong style="color:${plColor}">${plSign}₹${totalPL.toFixed(2)}</strong>
        </div>
    `;
}

/* -----------------------------------------
   13. HUD + STATUS
----------------------------------------- */
function updateHUD() {
    const el = document.getElementById('tradingHUD');
    if (el) {
        el.innerHTML =
            `Revealed: <strong>${revealIndex} / ${futureCandles.length}</strong>` +
            (activeTrade ? ` &nbsp;|&nbsp; Trade: <strong>${activeTrade.direction}</strong>` : '');
    }
}

function showStatus(msg) {
    const el = document.getElementById('tradingStatus');
    if (el) el.textContent = msg;
}

/* -----------------------------------------
   14. BOOT
----------------------------------------- */
window.addEventListener('DOMContentLoaded', () => {
    const display = document.getElementById('usernameDisplay');
    if (display) display.textContent = 'Player: ' + username;

    // Fix C4: bind button listeners
    const el = id => document.getElementById(id);
    if (el('revealBtn')) el('revealBtn').addEventListener('click', manualReveal);
    if (el('buyBtn')) el('buyBtn').addEventListener('click', () => enterTrade('BUY'));
    if (el('sellBtn')) el('sellBtn').addEventListener('click', () => enterTrade('SELL'));
    if (el('exitBtn')) el('exitBtn').addEventListener('click', exitTrade);
    if (el('endSessionBtn')) el('endSessionBtn').addEventListener('click', endSession);

    loadTradingBlock();
});