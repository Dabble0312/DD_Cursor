// script.js — Game Mode logic
// Depends on (loaded first): supabase.js, shared/chart.js, shared/ui.js

// =========================
// STATE
// =========================
let roundCount   = 0;
let correctCount = 0;
let wrongCount   = 0;
const MAX_ROUNDS = 10;

let visibleCandles = [];
let futureCandles  = [];
let gameActive     = false;
let chart;
let candlestickSeries;
let volumeSeries;

// ── Username + streak (read from localStorage once on load)
let username = localStorage.getItem("username") || "Player";
let streak   = parseInt(localStorage.getItem(username + "_streak")) || 0;
let best     = parseInt(localStorage.getItem(username + "_best"))   || 0;

// =========================
// DISPLAY HELPERS
// =========================
function updateStreakDisplay() {
    const el = document.getElementById("streakDisplay");
    if (el) el.textContent = "Streak: " + streak;
}

function updateBestDisplay() {
    const el = document.getElementById("bestDisplay");
    if (el) el.textContent = "Best: " + best;
}

function showChartLoading() {
    const chartDiv = document.getElementById('chart');
    if (chartDiv) chartDiv.innerHTML =
        '<div class="chart-loading"><div class="spinner"></div>Loading chart…</div>';
}

// =========================
// BOOT
// =========================
window.addEventListener("DOMContentLoaded", () => {
    const display = document.getElementById("usernameDisplay");
    if (display) display.textContent = "Player: " + username;

    updateStreakDisplay();
    updateBestDisplay();
    showChartLoading();

    // Fix C4: was called at module-level before DOMContentLoaded
    loadRandomBlock();
});

/* -----------------------------------------
   1. RANDOM BLOCK LOADER
----------------------------------------- */
async function loadRandomBlock() {
    try {
        const { data, error } = await supabaseClient
            .from('chart_blocks')
            .select('id, block_id, candles, future, window_start')
            .order('id')
            .limit(1000);

        if (error) throw error;

        if (!data || data.length === 0) {
            console.error('No blocks returned from Supabase. Check RLS policy on chart_blocks.');
            return;
        }

        const block = data[Math.floor(Math.random() * data.length)];

        if (!block.candles || !block.future) {
            console.error('Block is missing candles or future field:', block);
            return;
        }

        visibleCandles = block.candles;
        futureCandles  = block.future;

        initChart();
        setupButtons();
        gameActive = true;

    } catch (err) {
        console.error('Supabase Error:', err.message);
    }
}

/* -----------------------------------------
   2. CHART SETUP
   Uses shared CANDLESTICK_SERIES_OPTIONS, VOLUME_SERIES_OPTIONS,
   VOLUME_PRICE_SCALE_OPTIONS from shared/chart.js.
----------------------------------------- */
function initChart() {
    const chartDiv = document.getElementById('chart');
    if (chart) chart.remove();
    chartDiv.innerHTML = '';

    chart = window.LightweightCharts.createChart(chartDiv, {
        height: 501,
        layout: {
            textColor: '#000',
            backgroundColor: '#fff',
        },
        timeScale: {
            timeVisible:    true,
            secondsVisible: false,
            rightOffset:    4,   // reserves 4 bar-widths on the right for the reveal
        },
        rightPriceScale: {
            scaleMargins: { top: 0.05, bottom: 0.25 },
        },
    });

    candlestickSeries = chart.addCandlestickSeries(CANDLESTICK_SERIES_OPTIONS);
    volumeSeries      = chart.addHistogramSeries(VOLUME_SERIES_OPTIONS);
    chart.priceScale('volume').applyOptions(VOLUME_PRICE_SCALE_OPTIONS);

    // ── Candle + volume data via shared helpers
    candlestickSeries.setData(visibleCandles.map(toCandlePoint));
    volumeSeries.setData(visibleCandles.map(toVolumePoint));

    // ── Lock y-axis using all candles so reveal never causes a rescale
    const allCandles = [...visibleCandles, ...futureCandles];
    const yMin = Math.min(...allCandles.map(c => c.low))  * 0.995;
    const yMax = Math.max(...allCandles.map(c => c.high)) * 1.005;

    candlestickSeries.applyOptions({
        autoscaleInfoProvider: () => ({
            priceRange: { minValue: yMin, maxValue: yMax },
        }),
    });

    chart.timeScale().fitContent();
}

/* -----------------------------------------
   3. BUTTONS
----------------------------------------- */
function setupButtons() {
    const upBtn   = document.getElementById('upBtn');
    const downBtn = document.getElementById('downBtn');

    upBtn.onclick   = () => handleGuess('up');
    downBtn.onclick = () => handleGuess('down');
}

/* -----------------------------------------
   4. GUESS LOGIC
----------------------------------------- */
function handleGuess(guess) {
    if (!gameActive) return;
    gameActive = false;

    const lastVisibleClose = visibleCandles[visibleCandles.length - 1].close;
    const nextFutureClose  = futureCandles[0].close;

    const priceWentUp = nextFutureClose > lastVisibleClose;
    const correct = (guess === 'up' && priceWentUp) || (guess === 'down' && !priceWentUp);

    if (correct) {
        correctCount++;
        streak++;
        if (streak > best) {
            best = streak;
            localStorage.setItem(username + "_best", best);
            updateBestDisplay();
        }
        localStorage.setItem(username + "_streak", streak);
        updateStreakDisplay();
        showPopup("correct");      // shared/ui.js
        showWSBPopup(true);        // shared/ui.js
    } else {
        wrongCount++;
        streak = 0;
        localStorage.setItem(username + "_streak", 0);
        updateStreakDisplay();
        showPopup("wrong");        // shared/ui.js
        showWSBPopup(false);       // shared/ui.js
    }

    appendFutureCandles();
    flashAndGlow();

    roundCount++;

    if (roundCount >= MAX_ROUNDS) {
        setTimeout(() => { endRun(); }, 1500);
        return;
    }

    setTimeout(async () => { await loadRandomBlock(); }, 2800);
}

/* -----------------------------------------
   5. APPEND FUTURE CANDLES — one by one with delay
   Each future candle is revealed 600ms apart.
   Uses shared toCandlePoint / toVolumePoint helpers.
----------------------------------------- */
function appendFutureCandles() {
    const baseCandles = visibleCandles.map(toCandlePoint);
    const baseVolume  = visibleCandles.map(toVolumePoint);

    futureCandles.forEach((candle, i) => {
        setTimeout(() => {
            const revealedCandles = futureCandles.slice(0, i + 1).map(toCandlePoint);
            const revealedVolume  = futureCandles.slice(0, i + 1).map(toVolumePoint);

            candlestickSeries.setData([...baseCandles, ...revealedCandles]);
            volumeSeries.setData([...baseVolume, ...revealedVolume]);
        }, i * 600);   // 0ms, 600ms, 1200ms
    });
}

/* -----------------------------------------
   6. FLASH ANIMATION
----------------------------------------- */
function flashAndGlow() {
    const chartDiv = document.getElementById("chart");
    if (!chartDiv) return;
    chartDiv.classList.add("flash-candles");
    setTimeout(() => { chartDiv.classList.remove("flash-candles"); }, 800);
}

/* -----------------------------------------
   7. END RUN
----------------------------------------- */
function endRun() {
    gameActive = false;
    showReportCard({
        correct:    correctCount,
        wrong:      wrongCount,
        accuracy:   Math.round((correctCount / MAX_ROUNDS) * 100),
        bestStreak: best,
    });
    roundCount   = 0;
    correctCount = 0;
    wrongCount   = 0;
    streak       = 0;
}

function showReportCard(stats) {
    const endScreen  = document.getElementById("endScreen");
    const resultText = endScreen ? endScreen.querySelector("p") : null;
    if (!endScreen || !resultText) return;

    resultText.innerHTML =
        `You got <strong>${stats.correct}</strong> out of <strong>${MAX_ROUNDS}</strong> predictions correct.<br>` +
        `Accuracy: <strong>${stats.accuracy}%</strong>`;
    endScreen.classList.remove("hidden");

    document.getElementById("playAgainBtn").onclick = () => {
        endScreen.classList.add("hidden");
        startNewRun();
    };
    document.getElementById("homeBtn").onclick = () => {
        window.location.href = "index.html";
    };
}

function startNewRun() {
    roundCount   = 0;
    correctCount = 0;
    wrongCount   = 0;
    streak       = 0;
    localStorage.setItem(username + "_streak", 0);
    updateStreakDisplay();
    gameActive = true;
    loadRandomBlock();
}

/* -----------------------------------------
   8. KEYBOARD SHORTCUTS (Phase 5)
   ArrowUp = UP guess, ArrowDown = DOWN guess
----------------------------------------- */
window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp")   { e.preventDefault(); handleGuess("up");   }
    if (e.key === "ArrowDown") { e.preventDefault(); handleGuess("down"); }
});