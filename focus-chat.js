// focus-chat.js — DojiDash Cognition Chat
// A deterministic command interface into the existing explanation engine.
// Reads live globals: allCandles, revealedSoFar, detectedPatterns (from focus-core.js)
// Calls narrator functions: _buildRevealScript, _buildHistoryContext, _buildBurstContext (focus-narate.js)
// No generative AI. No hallucinations. No predictions.

// =========================
// STATE
// =========================
var _chatOpen    = false;
var _msgHistory  = [];   // { role: 'user'|'engine', text: string }

// =========================
// BOOT
// =========================
window.addEventListener('DOMContentLoaded', function () {
    var toggle = document.getElementById('chatToggleBtn');
    if (toggle) toggle.addEventListener('click', _toggleChat);

    var input = document.getElementById('chatInput');
    var send  = document.getElementById('chatSendBtn');

    if (send)  send.addEventListener('click', _handleSend);
    if (input) input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); _handleSend(); }
    });

    // Quick-action chips
    document.querySelectorAll('.chat-chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
            _submitCommand(chip.dataset.cmd);
        });
    });
});

// =========================
// TOGGLE
// =========================
function _toggleChat() {
    _chatOpen = !_chatOpen;
    var panel  = document.getElementById('chatPanel');
    var toggle = document.getElementById('chatToggleBtn');
    if (!panel) return;

    if (_chatOpen) {
        panel.classList.remove('hidden');
        if (toggle) toggle.classList.add('active');
        // Greet only on first open
        if (_msgHistory.length === 0) {
            _addEngineMsg(
                'Welcome to DojiDash Chat. I explain what the chart shows — ' +
                'I don\'t predict what it will do next.\n\n' +
                'Try: /explain last candle · /explain patterns · /explain market · ' +
                '/explain last 5 · /explain candle YYYY-MM-DD'
            );
        }
        _scrollToBottom();
    } else {
        panel.classList.add('hidden');
        if (toggle) toggle.classList.remove('active');
    }
}
window.toggleChat = _toggleChat;

// =========================
// SEND
// =========================
function _handleSend() {
    var input = document.getElementById('chatInput');
    if (!input) return;
    var raw = input.value.trim();
    if (!raw) return;
    input.value = '';
    _submitCommand(raw);
}

function _submitCommand(raw) {
    _addUserMsg(raw);
    var response = _route(raw.trim().toLowerCase());
    setTimeout(function () {
        _addEngineMsg(response);
    }, 180);   // slight delay feels more natural
}

// =========================
// ROUTER
// =========================
function _route(cmd) {
    // Normalise
    cmd = cmd.replace(/^\//, '').trim();

    // ── /explain market  (history context)
    if (/^explain\s+market$/.test(cmd) || cmd === 'explain history' || cmd === 'history') {
        return _respondHistoryContext();
    }

    // ── /explain patterns
    if (/^explain\s+patterns?$/.test(cmd) || cmd === 'patterns') {
        return _respondPatterns();
    }

    // ── /explain breakout
    if (/^explain\s+(breakout|momentum\s*burst)$/.test(cmd)) {
        return _respondPattern('Momentum Burst');
    }

    // ── /explain failed breakout
    if (/^explain\s+failed\s+breakout$/.test(cmd)) {
        return _respondPattern('Failed Breakout');
    }

    // ── /explain failed breakdown
    if (/^explain\s+failed\s+breakdown$/.test(cmd)) {
        return _respondPattern('Failed Breakdown');
    }

    // ── /explain last N candles
    var lastN = cmd.match(/^explain\s+last\s+(\d+)(?:\s+candles?)?$/);
    if (lastN) {
        return _respondLastN(parseInt(lastN[1], 10));
    }

    // ── /explain last candle
    if (/^explain\s+last\s+candle$/.test(cmd) || cmd === 'explain last' || cmd === 'last candle') {
        return _respondLastN(1);
    }

    // ── /explain candle YYYY-MM-DD
    var byDate = cmd.match(/^explain\s+candle\s+(\d{4}-\d{2}-\d{2})$/);
    if (byDate) {
        return _respondCandleByDate(byDate[1]);
    }

    // ── Shortcut / prediction attempts
    if (/buy|sell|signal|predict|forecast|will\s+price|going\s+up|going\s+down|trade/.test(cmd)) {
        return _fallbackShortcut();
    }

    // ── Generic fallback
    return _fallbackUnknown(cmd);
}

// =========================
// RESPONDERS  (deterministic, no AI)
// =========================

function _respondHistoryContext() {
    var candles = _getHistory();
    if (!candles || candles.length === 0) return 'No chart data loaded yet.';

    if (typeof getHistoryNarrationScript === 'function') {
        var script = getHistoryNarrationScript();
        if (script) return script;
    }

    // Fallback: build inline
    if (typeof _buildHistoryContext === 'function') {
        var ctx = _buildHistoryContext(candles);
        var bias = ctx.trendBias > 0.55 ? 'bullish' : ctx.trendBias < 0.45 ? 'bearish' : 'neutral';
        return (
            'Historical backdrop (' + candles.length + ' candles):\n' +
            'Trend bias: ' + bias + ' (' + ctx.bullCount + ' up / ' + ctx.bearCount + ' down).\n' +
            'Net change: ' + ctx.netChange.toFixed(2) + '%.\n' +
            'Structural mean: ' + ctx.mean.toFixed(2) + '.\n' +
            'Support: ' + ctx.support.toFixed(2) + ' · Resistance: ' + ctx.resistance.toFixed(2) + '.'
        );
    }

    return 'History context is not available yet.';
}

function _respondPatterns() {
    var patterns = _getDetectedPatterns();
    if (!patterns || patterns.length === 0) {
        return 'No patterns have been flagged on the visible candles yet.';
    }

    var history = _getHistory();
    var allVisible = _getAllVisible();
    var histLen = history.length;

    // Separate history patterns from revealed patterns
    var histPatterns = patterns.filter(function (p) {
        return p.indices.every(function (i) { return i < histLen; });
    });
    var revPatterns = patterns.filter(function (p) {
        return p.indices.some(function (i) { return i >= histLen; });
    });

    var lines = [];
    if (histPatterns.length > 0) {
        lines.push('Historical patterns (' + histPatterns.length + '):');
        histPatterns.forEach(function (p) {
            lines.push('  • ' + p.label + (p.description ? ' — ' + p.description : ''));
        });
    }
    if (revPatterns.length > 0) {
        lines.push('Patterns synthesised in revealed candles (' + revPatterns.length + '):');
        revPatterns.forEach(function (p) {
            lines.push('  • ' + p.label + (p.description ? ' — ' + p.description : ''));
        });
    }

    lines.push('\nRemember: patterns describe structure, not outcomes. Use them to frame your read, not to predict.');
    return lines.join('\n');
}

function _respondPattern(label) {
    var patterns = _getDetectedPatterns();
    var matches  = patterns.filter(function (p) {
        return p.label.toLowerCase().indexOf(label.toLowerCase()) !== -1;
    });

    if (matches.length === 0) {
        return 'No ' + label + ' has been flagged on the current chart. ' +
               'It may appear as more candles are revealed.';
    }

    var lines = [label + ' detected (' + matches.length + ' instance' + (matches.length > 1 ? 's' : '') + '):'];
    matches.forEach(function (p) {
        var idxStr = p.indices ? ' at candle indices ' + p.indices.join(', ') : '';
        lines.push('  • ' + p.label + idxStr + (p.description ? '\n    ' + p.description : ''));
    });
    lines.push('\nThis is a structural observation. What it means for price depends on context — review the surrounding candles.');
    return lines.join('\n');
}

function _respondLastN(n) {
    var all = _getAllVisible();
    if (!all || all.length === 0) return 'No candles are visible yet.';

    var burst = all.slice(-Math.min(n, all.length));

    if (typeof _buildRevealScript === 'function' && typeof _buildHistoryContext === 'function' && typeof _buildBurstContext === 'function') {
        var history = _getHistory();
        var script  = _buildRevealScript(history, all, burst);
        if (script) {
            var label = n === 1 ? 'Last candle' : 'Last ' + burst.length + ' candles';
            return label + ':\n\n' + script;
        }
    }

    // Fallback: manual summary
    return _manualCandleSummary(burst);
}

function _respondCandleByDate(dateStr) {
    var all     = _getAllVisible();
    var matched = all.filter(function (c) {
        return (c.date || '').slice(0, 10) === dateStr;
    });

    if (matched.length === 0) {
        return 'No candle found for ' + dateStr + '. ' +
               'Check the date format (YYYY-MM-DD) and that this candle is within the visible range.';
    }

    var c = matched[0];
    var dir = c.close > c.open ? 'Bullish' : c.close < c.open ? 'Bearish' : 'Doji';
    var change = (((c.close - c.open) / c.open) * 100).toFixed(2);

    var lines = [
        'Candle ' + dateStr + ':',
        '  Direction: ' + dir + ' (' + (change > 0 ? '+' : '') + change + '%)',
        '  Open: ' + c.open.toFixed(2) + '  Close: ' + c.close.toFixed(2),
        '  High: ' + c.high.toFixed(2) + '   Low:  ' + c.low.toFixed(2),
    ];
    if (c.volume)          lines.push('  Volume: ' + (c.volume_tag || 'normal'));
    if (c.rsi != null)     lines.push('  RSI: ' + (+c.rsi).toFixed(1));
    if (c.atr != null)     lines.push('  ATR: ' + (+c.atr).toFixed(2));
    if (c.trend_tag)       lines.push('  Trend tag: ' + c.trend_tag);
    if (c.momentum_tag)    lines.push('  Momentum: ' + c.momentum_tag);
    if (c.candle_strength) lines.push('  Candle strength: ' + c.candle_strength);
    if (c.inside_bar  === 1) lines.push('  Note: Inside bar — compression before a move.');
    if (c.outside_bar === 1) lines.push('  Note: Outside bar — range expansion, direction ambiguous.');
    if ((c.upper_wick_ratio || 0) > 0.6) lines.push('  Note: Long upper wick — overhead rejection present.');
    if ((c.lower_wick_ratio || 0) > 0.6) lines.push('  Note: Long lower wick — demand absorption below open.');

    return lines.join('\n');
}

function _manualCandleSummary(candles) {
    if (!candles || candles.length === 0) return 'No candles to describe.';
    var n         = candles.length;
    var bullCount = candles.filter(function (c) { return c.close > c.open; }).length;
    var last      = candles[n - 1];
    var dir       = last.close > last.open ? 'bullish' : last.close < last.open ? 'bearish' : 'neutral';
    return (
        (n === 1 ? 'Last candle: ' : 'Last ' + n + ' candles: ') +
        bullCount + ' up, ' + (n - bullCount) + ' down. ' +
        'Most recent close was ' + dir + ' at ' + last.close.toFixed(2) + '.'
    );
}

// =========================
// FALLBACKS
// =========================
function _fallbackShortcut() {
    return (
        'DojiDash doesn\'t provide predictions or shortcuts.\n' +
        'It teaches chart cognition.\n\n' +
        'Review the explanation and draw your own conclusion.'
    );
}

function _fallbackUnknown(cmd) {
    return (
        'This tool trains cognition, not shortcuts.\n' +
        'Use the explanations to form your own interpretation.\n\n' +
        'Available commands:\n' +
        '  /explain last candle\n' +
        '  /explain last N  (e.g. last 5)\n' +
        '  /explain candle YYYY-MM-DD\n' +
        '  /explain patterns\n' +
        '  /explain breakout\n' +
        '  /explain failed breakout\n' +
        '  /explain market'
    );
}

// =========================
// DATA ACCESSORS
// =========================
function _getHistory() {
    return (typeof allCandles !== 'undefined' ? allCandles : []);
}
function _getRevealed() {
    return (typeof revealedSoFar !== 'undefined' ? revealedSoFar : []);
}
function _getAllVisible() {
    return _getHistory().concat(_getRevealed());
}
function _getDetectedPatterns() {
    return (typeof detectedPatterns !== 'undefined' ? detectedPatterns : []);
}

// =========================
// UI HELPERS
// =========================
function _addUserMsg(text) {
    _msgHistory.push({ role: 'user', text: text });
    _renderMsg('user', text);
}

function _addEngineMsg(text) {
    _msgHistory.push({ role: 'engine', text: text });
    _renderMsg('engine', text);
}

function _renderMsg(role, text) {
    var feed = document.getElementById('chatFeed');
    if (!feed) return;

    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble chat-bubble--' + role;

    // Convert newlines to <br> and preserve indentation
    var safe = text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
    bubble.innerHTML = safe;

    feed.appendChild(bubble);
    _scrollToBottom();
}

function _scrollToBottom() {
    var feed = document.getElementById('chatFeed');
    if (feed) feed.scrollTop = feed.scrollHeight;
}
