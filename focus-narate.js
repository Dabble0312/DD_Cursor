/**
 * focus-narate.js — MARKET NARRATOR ENGINE v2.1
 *
 * Fixes in this version:
 *  - Reads allCandles / revealedSoFar as bare globals (not window.*),
 *    matching how focus-core.js declares them with `let`.
 *  - Strips rupee symbol and em-dashes from spoken text so no voice chokes.
 *  - _narrateHistory() routes through _speak() correctly.
 *  - Voice cache is seeded at DOMContentLoaded AND on voiceschanged.
 */

// ─────────────────────────────────────────────────────────────────────────────
// STATE  (var so duplicate-script loads never throw "already declared")
// ─────────────────────────────────────────────────────────────────────────────
if (typeof narratorActive === 'undefined') var narratorActive = false;
var _speechMemory  = [];
var _MEMORY_SIZE   = 5;
var _cachedVoices  = [];
var _pendingSpeech = null;

// ─────────────────────────────────────────────────────────────────────────────
// VOICE INITIALISATION
// ─────────────────────────────────────────────────────────────────────────────
function _initVoices() {
    var v = window.speechSynthesis.getVoices();
    if (v && v.length > 0) {
        _cachedVoices = v;
        if (_pendingSpeech) {
            var q = _pendingSpeech;
            _pendingSpeech = null;
            _speak(q);
        }
    }
}

if (window.speechSynthesis) {
    window.speechSynthesis.addEventListener('voiceschanged', _initVoices);
}
_initVoices();

window.addEventListener('DOMContentLoaded', function () {
    _initVoices();
    setTimeout(_initVoices, 400);
    setTimeout(_initVoices, 1200);
});

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────
function toggleNarrator() {
    narratorActive = !narratorActive;
    var btn = document.getElementById('narratorBtn');
    if (!btn) return;

    if (narratorActive) {
        btn.classList.add('active');
        btn.innerHTML = '<span id="narratorIcon">&#127899;&#65039;</span> Narrator On';
        _initVoices();
        _narrateHistory();
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '<span id="narratorIcon">&#128266;</span> Narrator Off';
        window.speechSynthesis.cancel();
    }
}
window.toggleNarrator = toggleNarrator;

function runNarratorEngine() {
    if (typeof getVisiblePatterns === 'function') {
        window.detectedPatterns = getVisiblePatterns();
    }

    // bare globals — focus-core.js uses `let allCandles` and `let revealedSoFar`
    var history = (typeof allCandles    !== 'undefined' ? allCandles    : []);
    var burst   = (typeof revealedSoFar !== 'undefined' ? revealedSoFar : []);

    if (history.length === 0 || burst.length === 0) return;

    var burstSize   = _getRevealCount();
    var recentBurst = burst.slice(-burstSize);
    var script      = _buildRevealScript(history, burst, recentBurst);

    // Record the reveal moment even if narrator is muted/off.
    try {
        if (window.sessionReport && Array.isArray(window.sessionReport.reveals)) {
            var burstEndIndex = window._pendingBurstEndIndex;
            var targetEntry   = null;

            // Prefer the entry whose candleIndex matches the pending burst end (scored candle)
            if (burstEndIndex != null) {
                for (var i = 0; i < window.sessionReport.reveals.length; i++) {
                    if (window.sessionReport.reveals[i].candleIndex === burstEndIndex) {
                        targetEntry = window.sessionReport.reveals[i];
                        break;
                    }
                }
            }

            // Fallback: last entry without a script
            if (!targetEntry) {
                for (var j = window.sessionReport.reveals.length - 1; j >= 0; j--) {
                    if (!window.sessionReport.reveals[j].script) {
                        targetEntry = window.sessionReport.reveals[j];
                        break;
                    }
                }
            }

            if (targetEntry) {
                targetEntry.script = script;
            }

            window._pendingBurstEndIndex = null;
        }
    } catch (err) {
        console.warn('Reveal capture failed:', err);
    }

    if (narratorActive) _speak(script);
}
window.runNarratorEngine = runNarratorEngine;

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY NARRATOR
// ─────────────────────────────────────────────────────────────────────────────
function getHistoryNarrationScript() {
    try {
        if (window.sessionReport && window.sessionReport.history && window.sessionReport.history.script) {
            return window.sessionReport.history.script;
        }
    } catch (_) {}

    var history = (typeof allCandles !== 'undefined' ? allCandles : []);
    if (history.length === 0) return '';

    if (typeof getVisiblePatterns === 'function') {
        window.detectedPatterns = getVisiblePatterns();
    }

    var ctx      = _buildHistoryContext(history);
    var patterns = (window.detectedPatterns || []).filter(function (p) {
        return p.indices.every(function (i) { return i < history.length; });
    });

    var parts = [
        _pick([
            'Stepping back to read the full tape.',
            'Analysing the historical structure before the reveal.',
            'Here is the backdrop, the fifty-candle foundation.',
            'Setting the scene before the price action unfolds.',
        ]),
        _historyTrendLine(ctx),
        _historyVolumeLine(ctx),
        'The price mean sits around ' + _fmtSpoken(ctx.mean) + ', acting as the structural pivot.',
        patterns.length > 0 ? _patternHistorySummary(patterns) : 'No dominant sequences have been flagged in the historical window.',
        _pick([
            'Now let us watch what the market does next.',
            'The stage is set. The reveal will tell us who is in control.',
            'Keep your eye on the mean and the extremes as the candles come in.',
            'That is the backdrop. The real test begins with the reveal.',
        ]),
    ];

    var script = _clean(parts.join(' '));
    try {
        if (window.sessionReport && window.sessionReport.history && !window.sessionReport.history.script) {
            window.sessionReport.history.script = script;
        }
    } catch (_) {}
    return script;
}
window.getHistoryNarrationScript = getHistoryNarrationScript;

function _narrateHistory() {
    var script = getHistoryNarrationScript();
    if (!script) return;
    _speak(script);
    return script;
}

// ─────────────────────────────────────────────────────────────────────────────
// REVEAL SCRIPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────
function _buildRevealScript(history, allRevealed, recentBurst) {
    var hCtx  = _buildHistoryContext(history);
    var bCtx  = _buildBurstContext(recentBurst);
    var parts = [];

    var synth = _getSynthesisedPatterns(allRevealed, history.length);
    if (synth.length > 0) parts.push(_synthPatternLine(synth));

    parts.push(_stitchLine(hCtx, bCtx));
    parts.push(_burstVolumeLine(hCtx, bCtx));
    parts.push(_meanPositionLine(hCtx, bCtx));

    var detail = _candleDetailLine(recentBurst);
    if (detail) parts.push(detail);

    parts.push(_outlookLine(hCtx, bCtx));

    return _clean(_filterAndJoin(parts));
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT BUILDERS
// ─────────────────────────────────────────────────────────────────────────────
function _buildHistoryContext(candles) {
    var n        = candles.length;
    var closes   = candles.map(function (c) { return c.close; });
    var highs    = candles.map(function (c) { return c.high; });
    var lows     = candles.map(function (c) { return c.low; });
    var volumes  = candles.map(function (c) { return c.volume || 0; });
    var mean     = closes.reduce(function (a, b) { return a + b; }, 0) / n;
    var avgVol   = volumes.reduce(function (a, b) { return a + b; }, 0) / n;
    var netChange = ((closes[n - 1] - closes[0]) / closes[0]) * 100;
    var bullCount = candles.filter(function (c) { return c.close > c.open; }).length;
    var lastCandle = candles[n - 1];
    return {
        mean: mean, avgVol: avgVol,
        netChange: netChange, trendBias: bullCount / n,
        trendTag: (lastCandle.trend_tag || 'sideways'),
        lastCandle: lastCandle,
        resistance: Math.max.apply(null, highs),
        support: Math.min.apply(null, lows),
        bullCount: bullCount, bearCount: n - bullCount, n: n,
    };
}

function _buildBurstContext(burst) {
    if (!burst || burst.length === 0) return null;
    var closes    = burst.map(function (c) { return c.close; });
    var volumes   = burst.map(function (c) { return c.volume || 0; });
    var n         = burst.length;
    var bullCount = burst.filter(function (c) { return c.close > c.open; }).length;
    var avgVol    = volumes.reduce(function (a, b) { return a + b; }, 0) / n;
    var netChange = closes.length > 1
        ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100 : 0;
    return {
        bullCount: bullCount, bearCount: n - bullCount,
        trendBias: bullCount / n, avgVol: avgVol, netChange: netChange,
        n: n, lastCandle: burst[n - 1],
        firstClose: closes[0], lastClose: closes[closes.length - 1],
        high: Math.max.apply(null, burst.map(function (c) { return c.high; })),
        low:  Math.min.apply(null, burst.map(function (c) { return c.low; })),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// LINE GENERATORS
// ─────────────────────────────────────────────────────────────────────────────
function _historyTrendLine(ctx) {
    if (ctx.trendTag === 'uptrend' || ctx.netChange > 2) {
        return _pick([
            'The fifty-candle backdrop carries a bullish bias. Price has been trending higher, with ' + ctx.bullCount + ' of ' + ctx.n + ' candles closing up.',
            'History leans constructive. The dominant motion over the last ' + ctx.n + ' sessions has been upward, a net gain of ' + ctx.netChange.toFixed(1) + ' percent.',
            'The structural backdrop is bullish. Buyers have controlled the tape for the majority of this historical window.',
        ]);
    }
    if (ctx.trendTag === 'downtrend' || ctx.netChange < -2) {
        return _pick([
            'The historical window carries a clear bearish bias. Price has been declining across ' + ctx.bearCount + ' of ' + ctx.n + ' sessions.',
            'The backdrop is distributional. Net price action over the last ' + ctx.n + ' candles reflects consistent selling pressure, down ' + Math.abs(ctx.netChange).toFixed(1) + ' percent.',
            'Sellers have dominated the historical structure. The path of least resistance has been downward.',
        ]);
    }
    return _pick([
        'The fifty-candle history shows a range-bound, sideways structure with no dominant directional bias.',
        'The historical backdrop is essentially neutral. Buyers and sellers have kept price contained within a defined range.',
        'This is a rotational market. No clear trend has established itself in the historical window.',
    ]);
}

function _historyVolumeLine(ctx) {
    var tag = ctx.lastCandle.volume_tag;
    if (tag === 'volume_spike') return _pick([
        'Volume has been elevated. Participants are engaged, and the tape reflects real conviction behind recent moves.',
        'Participation is heavy in this window. Elevated volume adds credibility to the price action.',
    ]);
    if (tag === 'volume_drop') return _pick([
        'Volume has been subdued through this historical stretch. The move, whatever its direction, lacks full market participation.',
        'Thin volume in the backdrop suggests this structure may be fragile. Moves on light volume are easier to reverse.',
    ]);
    return _pick([
        'Volume has been running at average levels with no unusual participation in either direction.',
        'Participation is steady through this historical window, suggesting orderly price discovery.',
    ]);
}

function _patternHistorySummary(patterns) {
    if (patterns.length === 1) {
        return 'The pattern engine has flagged a ' + patterns[0].label + ' in the historical structure.';
    }
    var labels = patterns.map(function (p) { return p.label; })
        .filter(function (v, i, a) { return a.indexOf(v) === i; });
    return 'The historical window contains ' + patterns.length + ' flagged sequences, including ' + _naturalList(labels) + '.';
}

function _stitchLine(hCtx, bCtx) {
    if (!bCtx) return '';
    var hb = hCtx.trendBias > 0.55, hBear = hCtx.trendBias < 0.45;
    var bb = bCtx.trendBias > 0.55, bBear = bCtx.trendBias < 0.45;

    if (hb && bBear) return _pick([
        'This burst runs counter to the prevailing uptrend. A potential distribution signal, or a bearish reversal attempt against the trend.',
        'The new candles are pushing back against the bullish backdrop. This could be early distribution, or a healthy pullback to retest structure.',
        'Selling is emerging against the bullish trend. Watch whether this is a brief retracement or the beginning of a directional change.',
    ]);
    if (hBear && bb) return _pick([
        'The reveal shows buying against a bearish backdrop. A counter-trend bounce at minimum, and possibly a reversal setup if volume confirms.',
        'Bulls are mounting a challenge against the prevailing downtrend. This is a potential trend reversal, but premature conviction here is dangerous.',
        'These candles are fighting the downtrend. Watch whether buyers hold these gains or sellers reassert control.',
    ]);
    if (hb && bb) return _pick([
        'The burst confirms the bullish backdrop. Buyers are maintaining control, and the trend appears to have continuation potential.',
        'Price is following the path of least resistance upward. The reveal is consistent with the bullish historical structure.',
        'Trend continuation read. The new candles align with the dominant buying structure in the history.',
    ]);
    if (hBear && bBear) return _pick([
        'The reveal reinforces the bearish backdrop. Sellers are staying consistent. This is a trend continuation setup.',
        'The new candles are aligned with the downtrend. No counter-trend pressure has emerged. The bears remain in control.',
        'Continuation of the bearish structure. The reveal offers no evidence yet that sellers are losing their grip.',
    ]);
    return _pick([
        'The new candles are mixed. No decisive directional edge has been established relative to the prior structure.',
        'Price action in the reveal is balanced, consistent with the sideways backdrop. The market is still searching for a catalyst.',
        'Neither buyers nor sellers have made a decisive statement in this burst. The structure remains ambiguous.',
    ]);
}

function _burstVolumeLine(hCtx, bCtx) {
    if (!bCtx) return '';
    var ratio = hCtx.avgVol > 0 ? bCtx.avgVol / hCtx.avgVol : 1;
    if (ratio > 1.6) return _pick([
        'Volume in the reveal is running roughly ' + ratio.toFixed(1) + ' times the historical average. Significant institutional participation.',
        'This burst is backed by substantially elevated volume. When volume expands with price, the move carries real conviction.',
    ]);
    if (ratio < 0.6) return _pick([
        'Volume in the reveal is light relative to history. A move on diminishing participation is harder to trust.',
        'This burst came in on below-average volume. Breakouts and breakdowns without volume tend to fail.',
    ]);
    return _pick([
        'Volume in the reveal is broadly consistent with the historical average. No unusual commitment in either direction.',
        'Participation in this burst is ordinary. The volume does not add urgency to the move.',
    ]);
}

function _meanPositionLine(hCtx, bCtx) {
    if (!bCtx) return '';
    var range = hCtx.resistance - hCtx.support;
    var pct   = range > 0 ? (bCtx.lastClose - hCtx.mean) / range : 0;
    if (pct > 0.25) return _pick([
        'Price has pushed above the historical mean of ' + _fmtSpoken(hCtx.mean) + '. Now extended. A snapback to the mean remains a live scenario.',
        'We are above the structural mean at ' + _fmtSpoken(hCtx.mean) + '. Overextension in either direction tends to self-correct.',
    ]);
    if (pct < -0.25) return _pick([
        'Price is trading below the historical mean of ' + _fmtSpoken(hCtx.mean) + ', suggesting bearish displacement from equilibrium.',
        'We are below the structural mean at ' + _fmtSpoken(hCtx.mean) + '. Either the mean acts as resistance on any bounce, or buyers reclaim it.',
    ]);
    return _pick([
        'Price is rotating around the historical mean near ' + _fmtSpoken(hCtx.mean) + ', still within equilibrium territory.',
        'We are close to the structural mean at ' + _fmtSpoken(hCtx.mean) + '. The market has not yet committed to a decisive move away from fair value.',
    ]);
}

function _candleDetailLine(burst) {
    if (!burst || burst.length === 0) return '';
    var last  = burst[burst.length - 1];
    var parts = [];
    if ((last.upper_wick_ratio || 0) > 0.6) {
        parts.push(_pick([
            'The most recent candle is printing a long upper wick. Overhead rejection is present.',
            'Upper wick on the last candle signals sellers stepping in above the close.',
        ]));
    } else if ((last.lower_wick_ratio || 0) > 0.6) {
        parts.push(_pick([
            'A long lower wick on the latest candle indicates aggressive demand absorption below the open.',
            'The lower wick shows buyers refused to let price stay at the lows. Demand is present.',
        ]));
    }
    if (last.candle_strength === 'strong' && last.close > last.open) {
        parts.push(_pick([
            'The last candle closed strongly bullish. Large body, minimal wicks. That is a high-conviction bar.',
            'A strong-bodied bullish candle to close the burst. Buyers stayed in control from open to close.',
        ]));
    } else if (last.candle_strength === 'strong' && last.close < last.open) {
        parts.push(_pick([
            'The final candle is a strong bearish close. Sellers dominated the full session without meaningful pushback.',
            'Large bearish body on the last candle. The bears are making a statement.',
        ]));
    }
    if (last.inside_bar === 1)  parts.push('The last candle is an inside bar. The market is compressing, coiling for the next directional move.');
    if (last.outside_bar === 1) parts.push('An outside bar printed at the close of the burst. Expanded range, uncertain resolution.');
    return parts.join(' ');
}

function _outlookLine(hCtx, bCtx) {
    if (!bCtx) return '';
    var mom = (bCtx.lastCandle && bCtx.lastCandle.momentum_tag) || '';
    if (mom === 'bullish_momentum') return _pick([
        'Momentum is leaning bullish. The next sequence will tell us whether buyers can sustain the move or whether it exhausts.',
        'Bullish momentum underpins this structure. Until it deteriorates, the path of least resistance favours the upside.',
    ]);
    if (mom === 'bearish_momentum') return _pick([
        'Momentum is bearish. If sellers maintain this pressure into the next reveal, the structural case for lower prices strengthens.',
        'The momentum signature is bearish. Buyers will need to show up with conviction to invalidate this read.',
    ]);
    return _pick([
        'Momentum is neutral. No strong directional edge. Make your read and wait for the next reveal to confirm.',
        'The market is at a pivot. Both sides have a case here. The next candles will be the arbiter.',
        'This is a decision point. Commitment from either buyers or sellers in the next sequence will likely resolve the ambiguity.',
    ]);
}

function _synthPatternLine(patterns) {
    if (patterns.length === 1) {
        return _pick([
            'Pattern alert. ' + patterns[0].label + ' has just been synthesised in the revealed candles. This is a live, newly-printed signal.',
            'The pattern engine has confirmed a ' + patterns[0].label + ' in the burst. This structure is now in play.',
        ]);
    }
    var labels = patterns.map(function (p) { return p.label; });
    return 'Multiple patterns synthesised in the reveal: ' + _naturalList(labels) + '. Convergence of signals increases the analytical weight of this move.';
}

// ─────────────────────────────────────────────────────────────────────────────
// PATTERN HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function _getSynthesisedPatterns(allRevealed, historyLength) {
    return (window.detectedPatterns || []).filter(function (p) {
        return p.indices.some(function (i) { return i >= historyLength; });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// SPEECH MEMORY
// ─────────────────────────────────────────────────────────────────────────────
function _filterAndJoin(phrases) {
    var valid    = phrases.filter(function (p) { return p && p.trim().length > 0; });
    var filtered = valid.filter(function (phrase) {
        var tokens = _tokenise(phrase);
        return !_speechMemory.some(function (mem) {
            return _similarity(tokens, _tokenise(mem)) > 0.65;
        });
    });
    var toSpeak = filtered.length > 0 ? filtered : valid;
    toSpeak.forEach(function (phrase) {
        _speechMemory.push(phrase);
        if (_speechMemory.length > _MEMORY_SIZE) _speechMemory.shift();
    });
    return toSpeak.join(' ').trim();
}

function _tokenise(str) {
    return (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
}

function _similarity(tokensA, tokensB) {
    if (!tokensA.length || !tokensB.length) return 0;
    var objA = {}, objB = {};
    tokensA.forEach(function (t) { objA[t] = true; });
    tokensB.forEach(function (t) { objB[t] = true; });
    var keysA  = Object.keys(objA);
    var keysB  = Object.keys(objB);
    var common = keysA.filter(function (t) { return objB[t]; }).length;
    return common / Math.max(keysA.length, keysB.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// SPEAK
// ─────────────────────────────────────────────────────────────────────────────
function _speak(text) {
    if (!text || text.trim() === '') return;
    if (_cachedVoices.length === 0) {
        _pendingSpeech = text;
        _initVoices();
        return;
    }
    window.speechSynthesis.cancel();
    var msg   = new SpeechSynthesisUtterance(text);
    msg.rate  = 1.05;
    msg.pitch = 0.88;
    var preferred =
        _cachedVoices.find(function (v) {
            return v.lang.startsWith('en') && (
                v.name.includes('Google')   ||
                v.name.includes('Natural')  ||
                v.name.includes('Premium')  ||
                v.name.includes('Enhanced')
            );
        }) ||
        _cachedVoices.find(function (v) { return v.lang.startsWith('en-GB'); }) ||
        _cachedVoices.find(function (v) { return v.lang.startsWith('en'); });
    if (preferred) msg.voice = preferred;
    window.speechSynthesis.speak(msg);
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────────────────────
function _pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function _fmtSpoken(price) {
    return (+price).toFixed(2);
}

function _clean(text) {
    return (text || '')
        .replace(/[\u20B9]/g, '')   // rupee sign
        .replace(/\u2014/g, ',')    // em dash
        .replace(/\u2013/g, ',')    // en dash
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function _naturalList(items) {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) return items[0] + ' and ' + items[1];
    return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}

function _getRevealCount() {
    var el  = document.getElementById('revealCount') || document.getElementById('revealCountSelect');
    if (!el) return 4;
    var val = parseInt(el.value);
    return isNaN(val) || val < 1 ? 4 : val;
}
