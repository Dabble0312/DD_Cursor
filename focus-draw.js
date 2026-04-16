// focus-draw.js — Chart Drawing Overlay  v3
// Tools: Horizontal Line, Trend Line, Rectangle
// All objects stored in chart-space (price / time index). Pixel coords derived on every redraw.
// Depends on bare globals `chart`, `candlestickSeries` from focus-core.js

// ─────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────
var _drawCanvas    = null;
var _drawCtx       = null;
var _idCounter     = 0;

// currentTool: null | 'hline' | 'trendline' | 'rect'
var _currentTool   = null;
// For two-click tools: first click stored here
var _pendingPoint  = null;   // { price, timeIndex } or { price, x } — see _xyToChartSpace

// Objects (unified array — each has a `type` field)
// hline:     { id, type:'hline',     price,                        label, selected }
// trendline: { id, type:'trendline', p1:{price,timeIdx}, p2:{price,timeIdx}, label, selected }
// rect:      { id, type:'rect',      p1:{price,timeIdx}, p2:{price,timeIdx}, label, selected }
var _objects       = [];

// Interaction state
var _selectedId    = null;
var _hoverId       = null;
var _isDragging    = false;
var _dragObj       = null;
var _dragStartMouse= null;   // { mx, my } at drag start
var _dragStartSnap = null;   // snapshot of object state at drag start

// Label input (HTML element, reused for all objects)
var _labelInput    = null;
var _labelTargetId = null;

// Delete zones per object (pixel rects, rebuilt each redraw)
var _deleteZones   = {};

// Tool palette DOM
var _palette       = null;

// ─────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────
var HIT_LINE   = 7;    // px — line hit threshold
var HIT_RECT   = 6;    // px — rect edge hit threshold
var DEL_W      = 16;
var DEL_H      = 16;
var PILL_H     = 18;
var PILL_PAD   = 6;

var C_IDLE     = 'rgba(59,130,246,0.85)';
var C_HOVER    = 'rgba(59,130,246,1)';
var C_SEL      = 'rgba(245,158,11,0.95)';
var C_DRAG     = 'rgba(245,158,11,0.95)';
var C_RECT_FILL= 'rgba(59,130,246,0.06)';
var C_RECT_SEL = 'rgba(245,158,11,0.08)';
var C_DEL_IDLE = 'rgba(156,163,175,0.7)';
var C_DEL_HOV  = 'rgba(239,68,68,0.95)';

// ─────────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', function () {
    _drawCanvas = document.getElementById('overlay-canvas');
    if (!_drawCanvas) return;
    _drawCtx = _drawCanvas.getContext('2d');

    _buildLabelInput();
    _buildPalette();

    // Wire the single draw button to toggle palette
    var btn = document.getElementById('draw-line-btn');
    if (btn) btn.addEventListener('click', _togglePalette);

    _drawCanvas.addEventListener('mousedown',   _onMouseDown);
    _drawCanvas.addEventListener('mousemove',   _onMouseMove);
    _drawCanvas.addEventListener('mouseup',     _onMouseUp);
    _drawCanvas.addEventListener('mouseleave',  _onMouseLeave);
    _drawCanvas.addEventListener('click',       _onClick);
    _drawCanvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    window.addEventListener('resize', resizeOverlay);
});

// ─────────────────────────────────────────────────────────────────────
// PUBLIC API  (called from focus-core.js)
// ─────────────────────────────────────────────────────────────────────
function setupOverlayCanvas(chartInstance) {
    if (!_drawCanvas) return;
    _drawCanvas._chart = chartInstance;
    resizeOverlay();

    chartInstance.timeScale().subscribeVisibleLogicalRangeChange(function () {
        requestAnimationFrame(redrawOverlay);
    });
    try {
        chartInstance.priceScale('right').subscribeVisiblePriceRangeChange(function () {
            requestAnimationFrame(redrawOverlay);
        });
    } catch (e) {}

    var chartDiv = document.getElementById('chart');
    if (chartDiv) {
        chartDiv.addEventListener('mousemove', function () {
            if (_objects.length > 0) requestAnimationFrame(redrawOverlay);
        });
    }
}
window.setupOverlayCanvas = setupOverlayCanvas;

function redrawOverlay() {
    if (!_drawCtx || !_drawCanvas) return;
    _drawCtx.clearRect(0, 0, _drawCanvas.width, _drawCanvas.height);
    _deleteZones = {};
    _objects.forEach(_drawObject);
    _drawPendingPoint();
}
window.redrawOverlay = redrawOverlay;

function clearOverlay() {
    _objects       = [];
    _selectedId    = null;
    _hoverId       = null;
    _isDragging    = false;
    _dragObj       = null;
    _pendingPoint  = null;
    _deleteZones   = {};
    _closeLabelInput();
    if (_drawCtx && _drawCanvas) _drawCtx.clearRect(0, 0, _drawCanvas.width, _drawCanvas.height);
}
window.clearOverlay = clearOverlay;

function resizeOverlay() {
    if (!_drawCanvas) return;
    var chartDiv = document.getElementById('chart');
    if (!chartDiv) return;
    _drawCanvas.width  = chartDiv.offsetWidth;
    _drawCanvas.height = chartDiv.offsetHeight;
    redrawOverlay();
}
window.resizeOverlay = resizeOverlay;

// Legacy compat — focus-core.js calls this via the old single-tool path; now routes through palette
function enableDrawingMode() { _activateTool('hline'); }
window.enableDrawingMode = enableDrawingMode;

function drawHorizontalLine(y) {
    var price = _yToPrice(y);
    if (price == null) return;
    var obj = { id: ++_idCounter, type: 'hline', price: price, label: '', selected: false };
    _objects.push(obj);
    _selectedId = obj.id;
    redrawOverlay();
    _openLabelInput(obj);
}
window.drawHorizontalLine = drawHorizontalLine;

// ─────────────────────────────────────────────────────────────────────
// TOOL PALETTE
// ─────────────────────────────────────────────────────────────────────
function _buildPalette() {
    _palette = document.createElement('div');
    _palette.id = 'draw-palette';
    _palette.style.cssText = [
        'position:absolute',
        'right:8px',
        'top:44px',
        'z-index:25',
        'display:none',
        'flex-direction:column',
        'gap:4px',
        'background:rgba(255,255,255,0.97)',
        'border:1px solid rgba(0,0,0,0.10)',
        'border-radius:8px',
        'padding:6px',
        'box-shadow:0 4px 16px rgba(0,0,0,0.12)',
    ].join(';');

    var tools = [
        { key: 'hline',     icon: '➖', label: 'H-Line'    },
        { key: 'trendline', icon: '↗',  label: 'Trend Line' },
        { key: 'rect',      icon: '⬜', label: 'Rectangle'  },
    ];

    tools.forEach(function (t) {
        var btn = document.createElement('button');
        btn.dataset.tool = t.key;
        btn.title        = t.label;
        btn.style.cssText = [
            'display:flex', 'align-items:center', 'gap:6px',
            'padding:5px 10px',
            'border:1px solid transparent',
            'border-radius:5px',
            'background:none',
            'font:13px ui-sans-serif,system-ui,Arial',
            'color:#374151',
            'cursor:pointer',
            'white-space:nowrap',
        ].join(';');
        btn.innerHTML = '<span style="font-size:14px">' + t.icon + '</span>' + t.label;
        btn.addEventListener('mouseover', function () { btn.style.background = '#f0f9ff'; });
        btn.addEventListener('mouseout',  function () { btn.style.background = 'none'; });
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            _activateTool(t.key);
            _hidePalette();
        });
        _palette.appendChild(btn);
    });

    var container = document.getElementById('chart-container');
    if (container) container.appendChild(_palette);

    // Close palette on outside click
    document.addEventListener('click', function (e) {
        if (_palette && !_palette.contains(e.target) &&
            e.target.id !== 'draw-line-btn') {
            _hidePalette();
        }
    });
}

function _togglePalette() {
    if (!_palette) return;
    var visible = _palette.style.display !== 'none';
    _palette.style.display = visible ? 'none' : 'flex';
}
function _hidePalette() {
    if (_palette) _palette.style.display = 'none';
}

function _activateTool(toolKey) {
    _currentTool  = toolKey;
    _pendingPoint = null;
    _setCanvasInteractive(true);
    _drawCanvas.style.cursor = 'crosshair';
    var btn = document.getElementById('draw-line-btn');
    if (btn) btn.classList.add('active');
}

function _exitTool() {
    _currentTool  = null;
    _pendingPoint = null;
    _setCanvasInteractive(false);
    _drawCanvas.style.cursor = 'default';
    var btn = document.getElementById('draw-line-btn');
    if (btn) btn.classList.remove('active');
}

// ─────────────────────────────────────────────────────────────────────
// DRAWING  (canvas rendering for each object type)
// ─────────────────────────────────────────────────────────────────────
function _drawObject(obj) {
    var isSel   = (obj.id === _selectedId);
    var isHov   = (obj.id === _hoverId);
    var isDrag  = (_isDragging && _dragObj && _dragObj.id === obj.id);
    var color   = isDrag ? C_DRAG : isSel ? C_SEL : isHov ? C_HOVER : C_IDLE;

    if (obj.type === 'hline') {
        var y = _priceToY(obj.price);
        if (y == null) return;
        obj._y = y;
        _drawHLinePrimitive(obj, y, color, isSel || isDrag, isHov);
        _drawLabelPill(obj, _drawCanvas.width / 2, y, color, isSel || isDrag);
    }

    if (obj.type === 'trendline') {
        var px1 = _chartSpaceToPixel(obj.p1);
        var px2 = _chartSpaceToPixel(obj.p2);
        if (!px1 || !px2) return;
        obj._px1 = px1; obj._px2 = px2;
        _drawTrendLinePrimitive(obj, px1, px2, color, isSel || isDrag);
        var cx = (px1.x + px2.x) / 2;
        var cy = (px1.y + px2.y) / 2;
        _drawLabelPill(obj, cx, cy, color, isSel || isDrag);
    }

    if (obj.type === 'rect') {
        var rp1 = _chartSpaceToPixel(obj.p1);
        var rp2 = _chartSpaceToPixel(obj.p2);
        if (!rp1 || !rp2) return;
        obj._rp1 = rp1; obj._rp2 = rp2;
        _drawRectPrimitive(obj, rp1, rp2, color, isSel || isDrag);
        var cx2 = (rp1.x + rp2.x) / 2;
        var cy2 = (rp1.y + rp2.y) / 2;
        _drawLabelPill(obj, cx2, cy2, color, isSel || isDrag);
    }
}

function _drawHLinePrimitive(obj, y, color, highlight) {
    _drawCtx.save();
    _drawCtx.setLineDash(highlight ? [8, 3] : [6, 4]);
    _drawCtx.strokeStyle = color;
    _drawCtx.lineWidth   = highlight ? 2 : 1.5;
    _drawCtx.beginPath();
    _drawCtx.moveTo(0, y);
    _drawCtx.lineTo(_drawCanvas.width, y);
    _drawCtx.stroke();
    _drawCtx.restore();
}

function _drawTrendLinePrimitive(obj, p1, p2, color, highlight) {
    _drawCtx.save();
    _drawCtx.setLineDash(highlight ? [8, 3] : [6, 4]);
    _drawCtx.strokeStyle = color;
    _drawCtx.lineWidth   = highlight ? 2 : 1.5;
    _drawCtx.beginPath();
    _drawCtx.moveTo(p1.x, p1.y);
    _drawCtx.lineTo(p2.x, p2.y);
    _drawCtx.stroke();
    // Endpoint dots
    _drawCtx.setLineDash([]);
    _drawCtx.fillStyle = color;
    [p1, p2].forEach(function (p) {
        _drawCtx.beginPath();
        _drawCtx.arc(p.x, p.y, highlight ? 4 : 3, 0, Math.PI * 2);
        _drawCtx.fill();
    });
    _drawCtx.restore();
}

function _drawRectPrimitive(obj, p1, p2, color, highlight) {
    var x = Math.min(p1.x, p2.x);
    var y = Math.min(p1.y, p2.y);
    var w = Math.abs(p2.x - p1.x);
    var h = Math.abs(p2.y - p1.y);
    _drawCtx.save();
    _drawCtx.fillStyle   = highlight ? C_RECT_SEL : C_RECT_FILL;
    _drawCtx.fillRect(x, y, w, h);
    _drawCtx.setLineDash(highlight ? [8, 3] : [6, 4]);
    _drawCtx.strokeStyle = color;
    _drawCtx.lineWidth   = highlight ? 2 : 1.5;
    _drawCtx.strokeRect(x, y, w, h);
    _drawCtx.restore();
}

// Shared label pill — centered at (cx, cy), with delete icon inside
function _drawLabelPill(obj, cx, cy, color, highlight) {
    _drawCtx.save();
    _drawCtx.setLineDash([]);
    _drawCtx.font = '11px ui-sans-serif,system-ui,Arial';

    var priceStr = _labelPriceStr(obj);
    var labelStr = obj.label ? '  ' + obj.label : '';
    var fullText = priceStr + labelStr;
    var textW    = _drawCtx.measureText(fullText).width;
    var bgW      = textW + PILL_PAD * 2 + DEL_W + 6;
    var bgH      = PILL_H;

    // Clamp pill so it never overlaps the right-side price axis (~60px)
    var rightEdge = _drawCanvas.width - 64;
    var bgX = Math.min(cx - bgW / 2, rightEdge - bgW);
    bgX     = Math.max(bgX, 4);
    var bgY = cy - bgH / 2;

    // Pill background
    _drawCtx.fillStyle = highlight ? 'rgba(245,158,11,0.12)' : 'rgba(59,130,246,0.12)';
    _roundRect(_drawCtx, bgX, bgY, bgW, bgH, 4);
    _drawCtx.fill();

    // Text
    _drawCtx.fillStyle    = color;
    _drawCtx.textBaseline = 'middle';
    _drawCtx.textAlign    = 'left';
    _drawCtx.fillText(fullText, bgX + PILL_PAD, cy);

    // Delete badge
    var delX     = bgX + bgW - DEL_W - 2;
    var delY     = bgY + (bgH - DEL_H) / 2;
    var delHov   = (_hoverId === obj.id && _deleteZones[obj.id] &&
                    _deleteZones[obj.id]._hovered);
    _drawCtx.fillStyle = delHov ? C_DEL_HOV : C_DEL_IDLE;
    _roundRect(_drawCtx, delX, delY, DEL_W, DEL_H, 3);
    _drawCtx.fill();

    _drawCtx.fillStyle    = '#fff';
    _drawCtx.font         = 'bold 11px ui-sans-serif,system-ui,Arial';
    _drawCtx.textAlign    = 'center';
    _drawCtx.textBaseline = 'middle';
    _drawCtx.fillText('x', delX + DEL_W / 2, delY + DEL_H / 2);

    _deleteZones[obj.id] = { x: delX, y: delY, w: DEL_W, h: DEL_H, _hovered: delHov };

    _drawCtx.restore();
}

// Ghost point while placing second click of trendline/rect
function _drawPendingPoint() {
    if (!_pendingPoint || !_currentTool) return;
    var py = _priceToY(_pendingPoint.price);
    var px = _pendingPoint.screenX;
    if (py == null) return;
    _drawCtx.save();
    _drawCtx.fillStyle = 'rgba(59,130,246,0.7)';
    _drawCtx.beginPath();
    _drawCtx.arc(px, py, 4, 0, Math.PI * 2);
    _drawCtx.fill();
    _drawCtx.restore();
}

function _labelPriceStr(obj) {
    if (obj.type === 'hline')     return 'Rs.' + obj.price.toFixed(2);
    if (obj.type === 'trendline') return 'Rs.' + obj.p1.price.toFixed(2) + ' → ' + obj.p2.price.toFixed(2);
    if (obj.type === 'rect') {
        var lo = Math.min(obj.p1.price, obj.p2.price);
        var hi = Math.max(obj.p1.price, obj.p2.price);
        return 'Rs.' + lo.toFixed(2) + ' – ' + hi.toFixed(2);
    }
    return '';
}

// ─────────────────────────────────────────────────────────────────────
// MOUSE HANDLERS
// ─────────────────────────────────────────────────────────────────────
function _onClick(e) {
    var rect = _drawCanvas.getBoundingClientRect();
    var mx   = e.clientX - rect.left;
    var my   = e.clientY - rect.top;

    // ── Tool is active — place points
    if (_currentTool) {
        if (_currentTool === 'hline') {
            drawHorizontalLine(my);
            _exitTool();
            return;
        }

        if (_currentTool === 'trendline' || _currentTool === 'rect') {
            var cs = _pixelToChartSpace(mx, my);
            if (!cs) return;

            if (!_pendingPoint) {
                // First click — store and wait
                _pendingPoint = { price: cs.price, timeIdx: cs.timeIdx, screenX: mx };
                redrawOverlay();
                return;
            }

            // Second click — create object
            var p1 = { price: _pendingPoint.price, timeIdx: _pendingPoint.timeIdx };
            var p2 = { price: cs.price,             timeIdx: cs.timeIdx };

            var obj = {
                id:       ++_idCounter,
                type:     _currentTool,
                p1:       p1,
                p2:       p2,
                label:    '',
                selected: false,
            };
            _objects.push(obj);
            _selectedId   = obj.id;
            _pendingPoint = null;
            redrawOverlay();
            _openLabelInput(obj);
            _exitTool();
            return;
        }
    }

    // ── No tool active — handle selection / delete
    if (_isDragging) return;  // suppress click fired after drag

    var delHit = _hitTestDelete(mx, my);
    if (delHit != null) {
        _objects       = _objects.filter(function (o) { return o.id !== delHit; });
        if (_selectedId === delHit) _selectedId = null;
        _hoverId = null;
        _closeLabelInput();
        redrawOverlay();
        return;
    }

    var hit = _hitTestObject(mx, my);
    if (hit != null) {
        _selectedId = hit.id;
        redrawOverlay();
        _openLabelInput(hit);
    } else {
        _selectedId = null;
        _closeLabelInput();
        redrawOverlay();
    }
}

function _onMouseDown(e) {
    if (_currentTool) return;   // clicks handled by _onClick during tool mode
    var rect = _drawCanvas.getBoundingClientRect();
    var mx   = e.clientX - rect.left;
    var my   = e.clientY - rect.top;

    if (_hitTestDelete(mx, my) != null) return;

    var hit = _hitTestObject(mx, my);
    if (hit) {
        _dragObj        = hit;
        _selectedId     = hit.id;
        _isDragging     = false;   // confirmed in mousemove after 3px motion
        _dragStartMouse = { mx: mx, my: my };
        _dragStartSnap  = _snapshotObj(hit);
        _setCanvasInteractive(true);
        _closeLabelInput();
        e.preventDefault();
    }
}

function _onMouseMove(e) {
    var rect = _drawCanvas.getBoundingClientRect();
    var mx   = e.clientX - rect.left;
    var my   = e.clientY - rect.top;

    // ── Drag confirmed
    if (_dragObj && _dragStartMouse) {
        var dx = mx - _dragStartMouse.mx;
        var dy = my - _dragStartMouse.my;
        if (!_isDragging && Math.abs(dy) > 3) _isDragging = true;

        if (_isDragging) {
            _applyDrag(_dragObj, dx, dy);
            redrawOverlay();
            _drawCanvas.style.cursor = 'grabbing';
            return;
        }
    }

    // ── Hover — update delete badge highlight
    var prevHover = _hoverId;
    var delHit    = _hitTestDelete(mx, my);

    if (delHit != null) {
        _hoverId = delHit;
        if (_deleteZones[delHit]) _deleteZones[delHit]._hovered = true;
        _drawCanvas.style.cursor = 'pointer';
        _setCanvasInteractive(true);
    } else {
        if (_deleteZones[prevHover]) _deleteZones[prevHover] = null;
        var hit = _hitTestObject(mx, my);
        if (hit) {
            _hoverId = hit.id;
            _drawCanvas.style.cursor = hit.type === 'hline' ? 'ns-resize' : 'grab';
            _setCanvasInteractive(true);
        } else {
            _hoverId = null;
            if (!_currentTool && !_isDragging) {
                _drawCanvas.style.cursor = 'default';
                _setCanvasInteractive(false);
            }
        }
    }

    if (_hoverId !== prevHover) redrawOverlay();

    // Update pending ghost point X for trendline/rect
    if (_pendingPoint && _currentTool) {
        _pendingPoint.screenX = mx;
        redrawOverlay();
    }
}

function _onMouseUp(e) {
    var wasDragging = _isDragging;
    _isDragging     = false;
    _dragObj        = null;
    _dragStartMouse = null;
    _dragStartSnap  = null;
    if (wasDragging) {
        _drawCanvas.style.cursor = 'default';
        redrawOverlay();
    }
}

function _onMouseLeave() {
    if (_isDragging) { _isDragging = false; _dragObj = null; redrawOverlay(); }
    if (_hoverId != null) { _hoverId = null; redrawOverlay(); }
    if (!_currentTool && !_isDragging) _setCanvasInteractive(false);
}

// ─────────────────────────────────────────────────────────────────────
// DRAG — update object positions in chart-space
// ─────────────────────────────────────────────────────────────────────
function _snapshotObj(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function _applyDrag(obj, dx, dy) {
    // Convert pixel delta to price delta using the price scale
    var refY     = _drawCanvas.height / 2;
    var refPrice = _yToPrice(refY);
    var newPrice = _yToPrice(refY + dy);
    if (refPrice == null || newPrice == null) return;
    var dPrice = newPrice - refPrice;

    // Convert pixel dx to time-index delta
    var dTimeIdx = _pxToTimeIdxDelta(dx);

    if (obj.type === 'hline') {
        obj.price = _dragStartSnap.price + dPrice;
    }
    if (obj.type === 'trendline' || obj.type === 'rect') {
        obj.p1.price   = _dragStartSnap.p1.price   + dPrice;
        obj.p2.price   = _dragStartSnap.p2.price   + dPrice;
        obj.p1.timeIdx = _dragStartSnap.p1.timeIdx + dTimeIdx;
        obj.p2.timeIdx = _dragStartSnap.p2.timeIdx + dTimeIdx;
    }
}

// ─────────────────────────────────────────────────────────────────────
// HIT TESTING
// ─────────────────────────────────────────────────────────────────────
function _hitTestDelete(mx, my) {
    var found = null;
    Object.keys(_deleteZones).forEach(function (id) {
        var z = _deleteZones[id];
        if (!z) return;
        if (mx >= z.x && mx <= z.x + z.w && my >= z.y && my <= z.y + z.h) {
            found = parseInt(id, 10);
        }
    });
    return found;
}

function _hitTestObject(mx, my) {
    // Walk in reverse order so topmost drawn object wins
    for (var i = _objects.length - 1; i >= 0; i--) {
        var obj = _objects[i];
        if (obj.type === 'hline') {
            var y = _priceToY(obj.price);
            if (y != null && Math.abs(my - y) <= HIT_LINE) return obj;
        }
        if (obj.type === 'trendline' && obj._px1 && obj._px2) {
            if (_ptToSegmentDist(mx, my, obj._px1, obj._px2) <= HIT_LINE) return obj;
        }
        if (obj.type === 'rect' && obj._rp1 && obj._rp2) {
            if (_hitTestRect(mx, my, obj._rp1, obj._rp2)) return obj;
        }
    }
    return null;
}

function _ptToSegmentDist(px, py, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - a.x, py - a.y);
    var t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lenSq));
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

function _hitTestRect(mx, my, p1, p2) {
    var x1 = Math.min(p1.x, p2.x), x2 = Math.max(p1.x, p2.x);
    var y1 = Math.min(p1.y, p2.y), y2 = Math.max(p1.y, p2.y);
    var onEdge = (
        (Math.abs(mx - x1) <= HIT_RECT && my >= y1 - HIT_RECT && my <= y2 + HIT_RECT) ||
        (Math.abs(mx - x2) <= HIT_RECT && my >= y1 - HIT_RECT && my <= y2 + HIT_RECT) ||
        (Math.abs(my - y1) <= HIT_RECT && mx >= x1 - HIT_RECT && mx <= x2 + HIT_RECT) ||
        (Math.abs(my - y2) <= HIT_RECT && mx >= x1 - HIT_RECT && mx <= x2 + HIT_RECT)
    );
    var inside = (mx > x1 && mx < x2 && my > y1 && my < y2);
    return onEdge || inside;
}

// ─────────────────────────────────────────────────────────────────────
// LABEL INPUT
// ─────────────────────────────────────────────────────────────────────
function _buildLabelInput() {
    _labelInput = document.createElement('input');
    _labelInput.type        = 'text';
    _labelInput.placeholder = 'Label...';
    _labelInput.id          = 'draw-label-input';
    _labelInput.style.cssText = [
        'position:absolute', 'display:none', 'z-index:30',
        'height:24px', 'min-width:100px', 'max-width:160px',
        'padding:2px 8px',
        'font:12px ui-sans-serif,system-ui,Arial',
        'border:1.5px solid #3b82f6', 'border-radius:5px',
        'background:rgba(255,255,255,0.97)', 'color:#1e293b',
        'outline:none', 'box-shadow:0 2px 10px rgba(59,130,246,0.25)',
    ].join(';');

    _labelInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); _closeLabelInput(); }
    });
    _labelInput.addEventListener('blur', _closeLabelInput);

    var container = document.getElementById('chart-container');
    if (container) container.appendChild(_labelInput);
}

function _openLabelInput(obj) {
    if (!_labelInput) return;
    _labelTargetId = obj.id;

    // Compute center pixel of the object
    var cx = _drawCanvas.width / 2;
    var cy = _drawCanvas.height / 2;

    if (obj.type === 'hline') {
        var hy = _priceToY(obj.price);
        if (hy != null) cy = hy;
    }
    if ((obj.type === 'trendline' || obj.type === 'rect') && obj._px1 && obj._px2) {
        cx = (obj._px1.x + obj._px2.x) / 2;
        cy = (obj._px1.y + obj._px2.y) / 2;
    }

    var container  = document.getElementById('chart-container');
    var contRect   = container   ? container.getBoundingClientRect()   : { left: 0, top: 0 };
    var canvasRect = _drawCanvas ? _drawCanvas.getBoundingClientRect() : contRect;
    var relLeft    = canvasRect.left - contRect.left;
    var relTop     = canvasRect.top  - contRect.top;

    var inputW  = 130;
    // Clamp away from right Y-axis
    var leftPx  = Math.min(relLeft + cx - inputW / 2, relLeft + _drawCanvas.width - 70 - inputW);
    leftPx      = Math.max(relLeft + 4, leftPx);
    var topPx   = relTop + cy - 38;
    topPx       = Math.max(relTop + 4, topPx);

    _labelInput.style.left    = leftPx + 'px';
    _labelInput.style.top     = topPx  + 'px';
    _labelInput.style.display = 'block';
    _labelInput.value         = obj.label || '';

    _labelInput.oninput = function () {
        var target = _objects.find(function (o) { return o.id === _labelTargetId; });
        if (target) { target.label = _labelInput.value; redrawOverlay(); }
    };

    setTimeout(function () { _labelInput.focus(); _labelInput.select(); }, 0);
}

function _closeLabelInput() {
    if (!_labelInput || _labelInput.style.display === 'none') return;
    if (_labelTargetId != null) {
        var target = _objects.find(function (o) { return o.id === _labelTargetId; });
        if (target) { target.label = _labelInput.value; redrawOverlay(); }
    }
    _labelInput.style.display = 'none';
    _labelInput.oninput       = null;
    _labelTargetId            = null;
}

// ─────────────────────────────────────────────────────────────────────
// COORDINATE CONVERSION  (pixel ↔ chart-space)
// ─────────────────────────────────────────────────────────────────────

// price ↔ pixel Y via candlestickSeries
function _yToPrice(y) {
    var s = _getCandlestickSeries();
    if (!s) return null;
    try { return s.coordinateToPrice(y); } catch (e) { return null; }
}
function _priceToY(price) {
    var s = _getCandlestickSeries();
    if (!s) return null;
    try { return s.priceToCoordinate(price); } catch (e) { return null; }
}

// pixel X ↔ time index via chart.timeScale()
function _xToTimeIdx(x) {
    var ch = _getChart();
    if (!ch) return null;
    try { return ch.timeScale().coordinateToLogical(x); } catch (e) { return null; }
}
function _timeIdxToX(idx) {
    var ch = _getChart();
    if (!ch) return null;
    try { return ch.timeScale().logicalToCoordinate(idx); } catch (e) { return null; }
}

// Full pixel → chart-space point
function _pixelToChartSpace(mx, my) {
    var price   = _yToPrice(my);
    var timeIdx = _xToTimeIdx(mx);
    if (price == null || timeIdx == null) return null;
    return { price: price, timeIdx: timeIdx };
}

// chart-space point → pixel {x, y}
function _chartSpaceToPixel(pt) {
    var y = _priceToY(pt.price);
    var x = _timeIdxToX(pt.timeIdx);
    if (y == null || x == null) return null;
    return { x: x, y: y };
}

// Convert pixel dx to time-index delta (used during drag)
function _pxToTimeIdxDelta(dx) {
    var ch = _getChart();
    if (!ch) return 0;
    try {
        var i0 = ch.timeScale().coordinateToLogical(0);
        var i1 = ch.timeScale().coordinateToLogical(dx);
        if (i0 == null || i1 == null) return 0;
        return i1 - i0;
    } catch (e) { return 0; }
}

// ─────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────
function _getCandlestickSeries() {
    if (typeof candlestickSeries !== 'undefined' && candlestickSeries) return candlestickSeries;
    return null;
}
function _getChart() {
    if (_drawCanvas && _drawCanvas._chart) return _drawCanvas._chart;
    if (typeof chart !== 'undefined' && chart) return chart;
    return null;
}
function _setCanvasInteractive(on) {
    if (_drawCanvas) _drawCanvas.style.pointerEvents = on ? 'auto' : 'none';
}
function _roundRect(ctx, x, y, w, h, r) {
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
}
