// focus-core.js — Focus Mode core: state, data loading, game logic, chart setup, boot.
// This is the orchestrator — all other focus-*.js files provide helper functions
// that this file calls. Load this file LAST in focus.html.
//
// Load order in focus.html:
//   shared/chart.js → shared/ui.js → focus-summary.js → focus-patterns.js → focus-ui.js → focus-core.js

// =========================
// CONFIGURATION
// =========================
const MAX_REVEALS_PER_BURST = 7;
const MAX_WRONG             = 5;
const REVEAL_SPEED_MS       = 600;

function getRevealCount() {
    const el  = document.getElementById('revealCount');
    if (!el) return 4;
    const val = parseInt(el.value);
    if (isNaN(val) || val < 1) return 1;
    if (val > MAX_REVEALS_PER_BURST) return MAX_REVEALS_PER_BURST;
    return val;
}

// =========================
// STATE
// =========================
let allCandles    = [];
let futureCandles = [];
let revealIndex   = 0;
let revealedSoFar = [];

let correctCount  = 0;
let wrongCount    = 0;
let guessCount    = 0;

let awaitingGuess    = false;
let autoRevealActive = false;
let sessionActive    = false;

let pendingPrediction = null;

let chart;
let candlestickSeries;
let volumeSeries;

let detectedPatterns = [];

let username = localStorage.getItem("username") || "Player";

// =========================
// SESSION REPORT (Flight Data Recorder)
// =========================
let sessionReport = null;

function initSessionReport() {
    sessionReport = {
        timestamp: new Date().toISOString(),
        history: { image: null, script: null },
        reveals: [],
        prediction: {
            guess: null,       // 'up' | 'down'
            target: null,      // User's price target
            actualPrice: null, // Final closing price (last candle close)
            isCorrect: false,
            accuracyDelta: null,
        },
    };
    window.sessionReport = sessionReport;
}

function captureSessionMoment() {
    return new Promise((resolve) => {
        if (typeof chart === 'undefined' || !chart || typeof chart.takeScreenshot !== 'function') {
            resolve(null);
            return;
        }

        requestAnimationFrame(() => {
            setTimeout(() => {
                try {
                    const canvas  = chart.takeScreenshot();
                    const dataUrl = canvas.toDataURL('image/png');
                    resolve(dataUrl);
                } catch (err) {
                    console.warn('captureSessionMoment failed:', err);
                    resolve(null);
                }
            }, 40);
        });
    });
}
window.captureSessionMoment = captureSessionMoment;

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function openSessionReport() {
    showStatus('Session report generator is disabled. Use the live session tray below the chart.');
}
window.openSessionReport = openSessionReport;


/* -----------------------------------------
   1. LOAD BLOCK FROM SUPABASE
----------------------------------------- */
async function loadFocusBlock() {
    showChartLoading();      // focus-ui.js
    showStatus("Loading chart...");

    try {
        const { data, error } = await supabaseClient
            .from('focus_blocks')
            .select('id, block_id, candles, future, window_start, detected_patterns')
            .order('id')
            .limit(500);

        if (error) throw error;

        if (!data || data.length === 0) {
            showStatus("No blocks available.");
            return;
        }

        const block = data[Math.floor(Math.random() * data.length)];

        if (!block.candles || !block.future) {
            console.error('Block missing candles or future:', block);
            return;
        }

        allCandles       = block.candles;
        futureCandles    = block.future;
        detectedPatterns = block.detected_patterns || [];
        revealIndex      = 0;
        revealedSoFar    = [];

        initChart();
        initSessionReport();
        resetSession();
        updateStatsPanel();     // focus-ui.js
        showCandleInfo(null);   // focus-ui.js
        showPriceFeedback("");  // focus-ui.js
        showStatus("");
        clearPatternHighlights();  // focus-patterns.js
        hidePatternPanels();       // focus-patterns.js
        clearDynamicZones();       // focus-patterns.js
        if (typeof clearOverlay === 'function') clearOverlay();  // focus-draw.js

        // Capture the initial 50-candle "History" moment (image + script) for the Session Report.
        try {
            const historyScript = (typeof window.getHistoryNarrationScript === 'function')
                ? window.getHistoryNarrationScript()
                : null;
            const historyImage = await captureSessionMoment();
            if (sessionReport) sessionReport.history = { image: historyImage, script: historyScript };
        } catch (err) {
            console.warn('History capture failed:', err);
        }

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
        layout: {
            textColor:       '#000',
            backgroundColor: '#fff',
        },
        timeScale: {
            timeVisible:    true,
            secondsVisible: false,
            rightOffset:    4,
        },
        rightPriceScale: {
            scaleMargins: { top: 0.05, bottom: 0.25 },
        },
        crosshair: {
            mode: 0,   // 0 = Normal (free crosshair, not snapping)
        },
    });

    candlestickSeries = chart.addCandlestickSeries(CANDLESTICK_SERIES_OPTIONS);
    volumeSeries      = chart.addHistogramSeries(VOLUME_SERIES_OPTIONS);
    chart.priceScale('volume').applyOptions(VOLUME_PRICE_SCALE_OPTIONS);

    renderChart();

    // Focus mode lets the y-axis autoscale to visible candles only
    candlestickSeries.applyOptions({ autoscaleInfoProvider: undefined });

    chart.timeScale().fitContent();
    updateDynamicZones();   // focus-patterns.js — draws initial zones

    // ── Candle click → update stats + info panel
    chart.subscribeClick((param) => {
        if (!param || !param.time) return;
        const clickedDate = param.time;
        const allVisible  = [...allCandles, ...revealedSoFar];
        const matched     = allVisible.find(c => c.date.slice(0, 10) === clickedDate);
        if (!matched) return;

        updateStatsPanel(matched);   // focus-ui.js
        showCandleInfo(matched);     // focus-ui.js
        refreshSummaryIfOpen(matched); // focus-ui.js
    });

    // ── Redraw zone overlays on viewport change
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
        requestAnimationFrame(drawZoneOverlays);   // focus-patterns.js
    });
    chart.subscribeCrosshairMove(() => {
        requestAnimationFrame(drawZoneOverlays);
    });

    setupZoneCanvas(chartDiv);   // focus-patterns.js

    // ── Drawing overlay (focus-draw.js)
    if (typeof setupOverlayCanvas === 'function') setupOverlayCanvas(chart);
}

/* -----------------------------------------
   3. RENDER CHART
----------------------------------------- */
function renderChart() {
    const all = [...allCandles, ...revealedSoFar];
    candlestickSeries.setData(all.map(toCandlePoint));   // shared/chart.js
    volumeSeries.setData(all.map(toVolumePoint));        // shared/chart.js

    // Scroll to keep the latest candle visible without re-fitting the whole range.
    // fitContent would reset the window on every reveal — scrollToRealTime preserves
    // the rolling effect where new candles on the right push old ones off the left.
    requestAnimationFrame(function () {
        if (chart) chart.timeScale().scrollToRealTime();
    });
}

/* -----------------------------------------
   4. SESSION STATE
----------------------------------------- */
function resetSession() {
    correctCount     = 0;
    wrongCount       = 0;
    guessCount       = 0;
    awaitingGuess    = false;
    autoRevealActive = false;
    sessionActive    = true;

    pendingPrediction = null;
    if (!sessionReport) initSessionReport();
    if (typeof clearLiveSessionTray === 'function') clearLiveSessionTray();
    updateHUD();             // focus-ui.js
    setButtonState("reveal"); // focus-ui.js
}

/* -----------------------------------------
   5. REVEAL LOGIC
----------------------------------------- */
function startAutoReveal() {
    // When awaiting a guess, REVEAL submits the target price instead of revealing candles
    if (awaitingGuess) { handleGuess(); return; }
    if (!sessionActive || autoRevealActive) return;
    if (revealIndex >= futureCandles.length) {
        endSession("complete");
        return;
    }

    autoRevealActive = true;
    setButtonState("revealing");

    let count = 0;
    const maxThisBurst = getRevealCount();

    function revealNext() {
        if (count >= maxThisBurst || revealIndex >= futureCandles.length) {
            autoRevealActive = false;
            awaitingGuess    = true;
            setButtonState("guess");
            showStatus("What happens next?");

            // --- Trigger narrator engine (captures script even if muted) ---
            if (typeof runNarratorEngine === 'function') {
                runNarratorEngine();
            }
            // ----------------------------------------------------------------

            return;
        }

        const candle    = futureCandles[revealIndex];
        const thisIndex = revealIndex;
        revealedSoFar.push(candle);
        revealIndex++;
        count++;

        renderChart();
       
        updateStatsPanel();      // focus-ui.js
        updateDynamicZones();    // focus-patterns.js

        if (pendingPrediction && pendingPrediction.candleIndex === thisIndex) {
            scorePendingPrediction();
        } else {
            // Capture chart snapshot for non-scoring reveals (continuation candles in a burst)
            if (sessionReport && Array.isArray(sessionReport.reveals)) {
                // Check if an entry for this candle already exists
                let revealEntry = sessionReport.reveals.find(function(r) { 
                    return r.candleIndex === thisIndex; 
                });
                
                if (!revealEntry) {
                    revealEntry = {
                        candleIndex:     thisIndex,
                        step:            sessionReport.reveals.length + 1,
                        userDirection:   null,
                        userTargetPrice: null,
                        actualPrice:     candle.close,
                        delta:           null,
                        isCorrect:       null,
                        image:           null,
                        script:          null,
                    };
                    sessionReport.reveals.push(revealEntry);
                }
                
                if (typeof window.captureSessionMoment === 'function') {
                    window.captureSessionMoment().then(function (img) { revealEntry.image = img; });
                }
            }
        }

        setTimeout(revealNext, REVEAL_SPEED_MS);
    }

    revealNext();
}

/* -----------------------------------------
   6. GUESS LOGIC
----------------------------------------- */
function handleGuess(guess) {
    if (!sessionActive || !awaitingGuess) return;

    if (!futureCandles[revealIndex]) {
        endSession("complete");
        return;
    }

    const priceInput  = document.getElementById('priceTarget');
    const targetValue = priceInput ? parseFloat(priceInput.value) : NaN;

    const baselineClose = revealedSoFar.length > 0
        ? revealedSoFar[revealedSoFar.length - 1].close
        : allCandles[allCandles.length - 1].close;

    // ── Validate target price — required input
    if (isNaN(targetValue) || targetValue <= 0) {
        showStatus("Enter a target price before revealing.");
        return;   // keep awaitingGuess = true
    }

    // ── Derive direction from target vs current close
    const derivedDirection = targetValue > baselineClose ? 'up' : 'down';
    guess = derivedDirection;

    awaitingGuess = false;
    if (priceInput) priceInput.value = '';

    const finalClose = futureCandles.length > 0
        ? futureCandles[futureCandles.length - 1].close
        : baselineClose;
    const hasTarget = true;   // already validated above

    if (!sessionReport) initSessionReport();
    if (sessionReport) {
        sessionReport.prediction.guess         = derivedDirection;
        sessionReport.prediction.target        = targetValue;
        sessionReport.prediction.actualPrice   = finalClose;
        sessionReport.prediction.isCorrect     = (derivedDirection === 'up' && finalClose > baselineClose) || (derivedDirection === 'down' && !(finalClose > baselineClose));
        sessionReport.prediction.accuracyDelta = Math.abs(targetValue - finalClose);
        console.log('[SessionReport]', sessionReport);
    }

    const burstEndIndex = Math.min(
        revealIndex + getRevealCount() - 1,
        futureCandles.length - 1
    );

    pendingPrediction = {
        guess,
        targetPrice:  targetValue,
        candleIndex:  burstEndIndex,
        baseClose:    baselineClose,
    };

    // Expose for focus-narate.js so the narrator attaches the script to the right burst entry
    window._pendingBurstEndIndex = burstEndIndex;

    showStatus("Revealing…");
    setButtonState("reveal");

    // Single press: prediction is locked — immediately start the reveal burst
    startAutoReveal();
}

/* -----------------------------------------
   6b. SCORE PENDING PREDICTION
----------------------------------------- */
function scorePendingPrediction() {
    if (!pendingPrediction) return;

    const { guess, targetPrice, candleIndex, baseClose } = pendingPrediction;
    pendingPrediction = null;
    guessCount++;

    const predictedCandle = futureCandles[candleIndex];
    const priceWentUp     = predictedCandle.close > baseClose;
    const correct         = (guess === 'up' && priceWentUp) || (guess === 'down' && !priceWentUp);

    // ── Capture decision to session report (per reveal)
    let scoredRevealEntry = null;
    if (sessionReport && Array.isArray(sessionReport.reveals)) {
        const actualPrice = predictedCandle.close;
        const delta       = actualPrice - targetPrice;   // targetPrice always present now
        
        // Find the reveal entry for this candleIndex, or create a new one
        let revealEntry = sessionReport.reveals.find(function(r) { 
            return r.candleIndex === candleIndex; 
        });
        
        if (!revealEntry) {
            revealEntry = {
                candleIndex:     candleIndex,
                step:            sessionReport.reveals.length + 1,
                userDirection:   guess,
                userTargetPrice: targetPrice,
                actualPrice:     actualPrice,
                delta:           delta,
                isCorrect:       correct,
                image:           null,
                script:          null,
            };
            sessionReport.reveals.push(revealEntry);
        } else {
            revealEntry.userDirection   = guess;
            revealEntry.userTargetPrice = targetPrice;
            revealEntry.actualPrice     = actualPrice;
            revealEntry.delta           = delta;
            revealEntry.isCorrect       = correct;
        }
        scoredRevealEntry = revealEntry;
        
        if (typeof window.captureSessionMoment === 'function') {
            window.captureSessionMoment().then(function (img) { revealEntry.image = img; });
        }
    }

    if (correct) {
        correctCount++;
        showPopup("correct");    // shared/ui.js
        showWSBPopup(true);      // shared/ui.js
    } else {
        wrongCount++;
        showPopup("wrong");
        showWSBPopup(false);
    }

    // ── Price target feedback (targetPrice always present)
    {
        const actual  = predictedCandle.close;
        const diff    = actual - targetPrice;
        const diffPct = ((Math.abs(diff) / actual) * 100).toFixed(1);
        let msg;
        if (Math.abs(diff) / actual < 0.005)
            msg = `🎯 Spot on! Target ₹${targetPrice.toFixed(2)} vs actual ₹${actual.toFixed(2)}`;
        else if (diff > 0)
            msg = `📈 Actual was ${diffPct}% higher than your target (₹${targetPrice.toFixed(2)} → ₹${actual.toFixed(2)})`;
        else
            msg = `📉 Actual was ${diffPct}% lower than your target (₹${targetPrice.toFixed(2)} → ₹${actual.toFixed(2)})`;
        showPriceFeedback(msg);   // focus-ui.js

        if (typeof showLiveReportPopup === 'function') {
            const explanationText = scoredRevealEntry && scoredRevealEntry.script
                ? scoredRevealEntry.script
                : '';
            showLiveReportPopup({
                round:        guessCount,
                predicted:    targetPrice,
                actualClose:  actual,
                delta:        diff,
                isCorrect:    correct,
                direction:    guess,
                explanation:  explanationText,
            });
        }
    }

    updateHUD();    // focus-ui.js

    if (wrongCount >= MAX_WRONG) {
        setTimeout(() => endSession("focus_lost"), 1400);
        return;
    }
    if (revealIndex >= futureCandles.length) {
        setTimeout(() => endSession("complete"), 1400);
        return;
    }

    setTimeout(() => { showStatus(""); }, 2000);
}

/* -----------------------------------------
   6c. BUILD FINAL SESSION REPORT
   Silent. No popup. No download.
   Computes cognitiveSnapshot + cognitiveStatements,
   attaches them to sessionReport, and stores the
   complete object in window.finalSessionReport.
   Called automatically at the top of endSession().
----------------------------------------- */
function buildFinalSessionReport() {
    if (!sessionReport) return;

    const reveals = Array.isArray(sessionReport.reveals) ? sessionReport.reveals : [];
    const bursts  = reveals.filter(b => b && b.userTargetPrice != null && b.actualPrice != null && b.delta != null);

    if (bursts.length === 0) {
        sessionReport.cognitiveSnapshot   = null;
        sessionReport.cognitiveStatements = null;
        window.finalSessionReport = JSON.parse(JSON.stringify(sessionReport));
        return;
    }

    // ── Helper: compute cognitive fields for a single burst
    function burstCognition(b) {
        const delta  = +b.delta;
        const pctDev = Math.abs(delta) / +b.actualPrice * 100;

        // directionalExpectation — from userDirection only (target vs baseClose, user belief)
        const directionalExpectation = b.userDirection === 'up' ? 'Positive' : 'Negative';

        // optimismPessimism — from delta only (target vs actual, outcome)
        // delta = actual - target → delta < 0 means target was above actual = Optimistic
        const optimismPessimism = delta < 0 ? 'Optimistic' : delta > 0 ? 'Pessimistic' : 'Neutral';

        // overshootUndershoot — two-tier: direction from delta sign, magnitude from pctDev
        // delta < 0 → Overshoot (aimed above actual), delta > 0 → Undershoot (aimed below actual)
        let overshootUndershoot;
        if (pctDev < 1) {
            overshootUndershoot = 'Accurate';
        } else {
            const direction = delta < 0 ? 'Overshoot' : 'Undershoot';
            const magnitude = pctDev < 3 ? 'Mild' : pctDev < 7 ? 'Moderate' : 'Strong';
            overshootUndershoot = `${magnitude} ${direction}`;
        }

        // magnitudeCalibration — magnitude only, from abs(delta)/actual
        const magnitudeCalibration = pctDev < 2 ? 'Tight' : pctDev < 5 ? 'Moderate' : 'Loose';

        // directionalCalibration — from delta only (how target compared to actual)
        const directionalCalibration = delta < 0 ? 'Aimed Too High' : delta > 0 ? 'Aimed Too Low' : 'Aligned';

        // burstBias — single-burst equivalent of systematicBias; no "Consistent" at burst level
        const burstBias = delta < 0 ? 'Overshooter' : delta > 0 ? 'Undershooter' : 'Balanced';

        return {
            snapshot: { directionalExpectation, optimismPessimism, overshootUndershoot, magnitudeCalibration, directionalCalibration, burstBias },
            statements: {
                biasSummary:
                    `The target reflected a ${directionalExpectation} expectation for the move. ` +
                    `The target was overall ${optimismPessimism} relative to the actual outcome. ` +
                    `The target showed a ${overshootUndershoot} tendency based on percentage deviation.`,
                calibrationSummary:
                    `Calibration was ${magnitudeCalibration}, based on the distance from actual price. ` +
                    `Directionally, the target tended to be ${directionalCalibration}. ` +
                    `For this burst, the user was an ${burstBias}.`,
            },
        };
    }

    // ── Attach per-burst cognitive data directly onto each reveal entry
    bursts.forEach(b => {
        const cog = burstCognition(b);
        b.cognitiveSnapshot   = cog.snapshot;
        b.cognitiveStatements = cog.statements;
    });

    // ── Session-level aggregates
    const totalAbsDelta  = bursts.reduce((s, b) => s + Math.abs(b.delta), 0);
    const totalActual    = bursts.reduce((s, b) => s + b.actualPrice, 0);
    const sumDelta       = bursts.reduce((s, b) => s + b.delta, 0);
    const avgAbsDelta    = totalAbsDelta / bursts.length;
    const avgActual      = totalActual   / bursts.length;
    const meanDelta      = sumDelta      / bursts.length;
    const avgAbsDeltaPct = (avgAbsDelta  / avgActual) * 100;

    // directionalExpectation — majority of userDirection values (expectation, not outcome)
    const positiveCount       = bursts.filter(b => b.userDirection === 'up').length;
    const directionalExpectation = positiveCount >= (bursts.length - positiveCount) ? 'Positive' : 'Negative';

    // optimismPessimism — majority of delta signs (outcome, not expectation)
    const optimisticCount    = bursts.filter(b => b.delta < 0).length;
    const pessimisticCount   = bursts.length - optimisticCount;
    const optimismPessimism  = optimisticCount === pessimisticCount ? 'Neutral'
        : optimisticCount > pessimisticCount ? 'Optimistic' : 'Pessimistic';

    // overshootUndershoot — two-tier using meanDelta sign + avgPctDev magnitude
    const avgPctDev = bursts.reduce((s, b) => s + (Math.abs(b.delta) / b.actualPrice * 100), 0) / bursts.length;
    let overshootUndershoot;
    if (avgPctDev < 1) {
        overshootUndershoot = 'Accurate';
    } else {
        const direction = meanDelta < 0 ? 'Overshoot' : 'Undershoot';
        const magnitude = avgPctDev < 3 ? 'Mild' : avgPctDev < 7 ? 'Moderate' : 'Strong';
        overshootUndershoot = `${magnitude} ${direction}`;
    }

    // magnitudeCalibration — avg magnitude only
    const magnitudeCalibration   = avgAbsDeltaPct < 2 ? 'Tight' : avgAbsDeltaPct < 5 ? 'Moderate' : 'Loose';

    // directionalCalibration — from meanDelta only
    const directionalCalibration = meanDelta < 0 ? 'Aimed Too High' : meanDelta > 0 ? 'Aimed Too Low' : 'Aligned';

    // systematicBias — session-level only; "Consistent" is valid here across multiple bursts
    const systematicBias = meanDelta < 0 ? 'Consistent Overshooter' : meanDelta > 0 ? 'Consistent Undershooter' : 'Balanced';

    sessionReport.cognitiveSnapshot = {
        directionalExpectation, optimismPessimism, overshootUndershoot,
        magnitudeCalibration, directionalCalibration, systematicBias,
    };
    sessionReport.cognitiveStatements = null; // statements live per-burst

    // ── STORE as single source of truth
    window.finalSessionReport = JSON.parse(JSON.stringify(sessionReport));
}
window.buildFinalSessionReport = buildFinalSessionReport;

/* -----------------------------------------
   7. END SESSION
----------------------------------------- */
function endSession(reason) {
    // ── Freeze and enrich the report before any UI changes
    buildFinalSessionReport();

    sessionActive    = false;
    autoRevealActive = false;
    awaitingGuess    = false;
    setButtonState("revealing");

    // Reveal all remaining candles at once
    revealedSoFar = [...futureCandles];
    renderChart();

    const accuracy = guessCount > 0
        ? Math.round((correctCount / guessCount) * 100)
        : 0;

    const title = reason === "focus_lost" ? "Focus Lost — Reset Needed" : "Session Complete";

    const endScreen  = document.getElementById('endScreen');
    const resultText = endScreen ? endScreen.querySelector('p') : null;

    if (endScreen && resultText) {
        resultText.innerHTML =
            `<strong>${title}</strong><br><br>` +
            `Guesses: <strong>${guessCount}</strong><br>` +
            `Correct: <strong>${correctCount}</strong><br>` +
            `Wrong: <strong>${wrongCount}</strong><br>` +
            `Accuracy: <strong>${accuracy}%</strong><br>` +
            `Candles revealed: <strong>${revealIndex} / ${futureCandles.length}</strong>`;
        endScreen.classList.remove('hidden');
    }

    document.getElementById('playAgainBtn').onclick = () => {
        endScreen.classList.add('hidden');
        loadFocusBlock();
    };
    document.getElementById('homeBtn').onclick = () => {
        window.location.href = 'index.html';
    };

    const reportBtn = document.getElementById('reportBtn');
    if (reportBtn) reportBtn.style.display = 'none';
}

/* -----------------------------------------
   8. KEYBOARD SHORTCUTS
   (Up/Down direction is now derived from target price — no key shortcuts needed)
----------------------------------------- */

/* -----------------------------------------
   9. BOOT
----------------------------------------- */
window.addEventListener('DOMContentLoaded', () => {
    const display = document.getElementById('usernameDisplay');
    if (display) display.textContent = 'Player: ' + username;

    // ── Bind button listeners
    const el = id => document.getElementById(id);
    if (el('narratorBtn'))             el('narratorBtn').addEventListener('click', toggleNarrator);
    if (el('revealBtn'))               el('revealBtn').addEventListener('click', startAutoReveal);
    if (el('togglePatternsBtn'))       el('togglePatternsBtn').addEventListener('click', togglePatterns);
    if (el('togglePatternExplainBtn')) el('togglePatternExplainBtn').addEventListener('click', togglePatternExplain);
    if (el('summaryToggleBtn'))        el('summaryToggleBtn').addEventListener('click', toggleSummary);

    loadFocusBlock();
});
