        (function() {
            'use strict';

            // ==================== DOM 引用缓存 ====================
            const DOM = {};
            const bindDOM = (id) => { DOM[id] = document.getElementById(id); return DOM[id]; };
            [
                'canvas', 'overlayCanvas', 'canvasWrapper', 'dropOverlay', 'statusDot', 'statusText', 'hint',
                'formulaDisplay', 'formulaLabel', 'unitInput', 'decimalInput', 'snapInput',
                'formTypeSelect', 'methodSelect', 'resetPointsBtn', 'captureBtn', 'refreshCaptureBtn',
                'extraInfoRow', 'extraInfoValue', 'copyExtraBtn', 'magnifier', 'magnifierCanvas',
                'componentsList', 'combinedFormulaRow', 'combinedFormulaDisplay', 'copyCombinedBtn',
                'addSigmoidBtn', 'addPulseBtn', 'addSinBtn', 'addGaussBtn', 'clearComponentsBtn'
            ].forEach(id => bindDOM(id));
            const ctx = DOM.canvas.getContext('2d');
            const overlayCtx = DOM.overlayCanvas.getContext('2d');
            const magnifierCtx = DOM.magnifierCanvas.getContext('2d');

            // ==================== 常量配置 ====================
            const CONFIG = {
                MAG_SIZE: 160,
                MAG_ZOOM: 3.5,
                LONG_PRESS_MS: 450,
                DRAG_PRESS_MS: 300,
                MOVE_THRESHOLD: 8,
                POINT_HIT_THRESHOLD: 18,
                COMBINED_CURVE_COLOR: '#ffb300',
                COMBINED_CURVE_GLOW: '#ffcc02',
                HINT_DURATION: { SHORT: 2000, NORMAL: 3000, LONG: 4000 },
                MAX_DECIMAL_DIGITS: 6,
                MAX_SNAP: 2,
                MAX_POLY_POINTS: 15,
                CURVE_STEPS: 200,
                ORIGIN_AXIS_LEN: 28,
                DERIVATIVE_LEVELS: ['f(x)=', "f'(x)=", "f''(x)="],
                MODE: { IDLE: 'idle', ORIGIN: 'origin', UNIT1: 'unit1', UNIT2: 'unit2', WAYPOINT: 'waypoint',
                    DONE: 'done' },
                ORIGIN_LINE_COLOR: 'rgba(243, 156, 18, 0.35)',
                ORIGIN_LINE_DASH: [8, 10],
                MOUSE_CROSS_COLOR: 'rgba(30, 30, 30, 0.85)',
                MOUSE_CROSS_DASH: [],
            };
            const SAMPLE_SIZE = CONFIG.MAG_SIZE / CONFIG.MAG_ZOOM;

            // ==================== 应用状态 ====================
            const state = {
                mode: CONFIG.MODE.IDLE,
                originPx: null,
                unitPx1: null,
                unitPx2: null,
                waypointsPx: [],
                mathPoints: [],
                unitPixelDist: 1,
                unitValue: 5,
                image: null,
                imgLoaded: false,
                usingCapture: false,
                videoStream: null,
                videoElement: null,
                funcData: null,
                currentFormulaText: '',
                currentExtraText: '',
                currentCombinedText: '',
                interpolationMethod: 'polynomial',
                derivativeLevel: 0,
                lockedCanvasRenderW: null,
                lockedCanvasRenderH: null,
                lockedCssW: null,
                lockedCssH: null,
                isPressing: false,
                pressTimer: null,
                pressStartX: 0,
                pressStartY: 0,
                magnifierActive: false,
                magnifierMouseX: 0,
                magnifierMouseY: 0,
                dragTarget: null,
                isDragging: false,
                dragTimer: null,
                pendingDragPoint: null,
                mouseCanvasX: -100,
                mouseCanvasY: -100,
                mouseOnCanvas: false,
                fileInput: null,
                isLoadingImage: false,
                sigmoidComponents: [],
                sinComponents: [],
                gaussComponents: [],
                componentIdCounter: 0,
                _imgDraw: null,
            };

            // ==================== 工具函数 ====================
            const getDecimalDigits = () => {
                let d = parseInt(DOM.decimalInput.value, 10);
                if (isNaN(d) || d < 0) d = 0;
                if (d > CONFIG.MAX_DECIMAL_DIGITS) d = CONFIG.MAX_DECIMAL_DIGITS;
                if (String(d) !== DOM.decimalInput.value) DOM.decimalInput.value = d;
                return d;
            };

            const getSnapPrecision = () => {
                let s = parseFloat(DOM.snapInput.value);
                if (isNaN(s) || s < 0) s = 0;
                if (s > CONFIG.MAX_SNAP) s = CONFIG.MAX_SNAP;
                if (Math.abs(s - parseFloat(DOM.snapInput.value)) > 0.001 && DOM.snapInput.value !== '') DOM.snapInput
                    .value = s;
                return s;
            };

            const fmtNum = (num, digits) => {
                if (typeof num !== 'number' || !isFinite(num)) return String(num);
                if (Math.abs(num) < 1e-15) return '0';
                return String(parseFloat(num.toFixed(digits)));
            };

            const roundedNum = (num, digits) => {
                if (typeof num !== 'number' || !isFinite(num)) return num;
                if (Math.abs(num) < 1e-15) return 0;
                return parseFloat(num.toFixed(digits));
            };

            const screenToCanvas = (clientX, clientY) => {
                const rect = DOM.canvas.getBoundingClientRect();
                return { x: clientX - rect.left, y: clientY - rect.top };
            };

            const pixelToMath = (px, py) => {
                if (!state.originPx || state.unitPixelDist <= 0) return null;
                return { x: (px - state.originPx.x) / state.unitPixelDist, y: -(py - state.originPx.y) / state
                        .unitPixelDist };
            };

            const mathToPixel = (mx, my) => {
                if (!state.originPx || state.unitPixelDist <= 0) return null;
                return { x: state.originPx.x + mx * state.unitPixelDist, y: state.originPx.y - my * state.unitPixelDist };
            };

            const snapToInteger = (mathPoint, snapPrecision) => {
                const r = { x: mathPoint.x, y: mathPoint.y, snapped: false, snappedX: false, snappedY: false };
                if (snapPrecision <= 0) return r;
                const sx = Math.round(mathPoint.x);
                const sy = Math.round(mathPoint.y);
                if (Math.abs(mathPoint.x - sx) <= snapPrecision) { r.x = sx;
                    r.snappedX = true;
                    r.snapped = true; }
                if (Math.abs(mathPoint.y - sy) <= snapPrecision) { r.y = sy;
                    r.snappedY = true;
                    r.snapped = true; }
                return r;
            };

            const hasComponents = () =>
                (state.sigmoidComponents.length + state.sinComponents.length + state.gaussComponents.length) > 0;

            const findPointAt = (x, y, threshold = CONFIG.POINT_HIT_THRESHOLD) => {
                const allPoints = [];
                if (state.originPx) allPoints.push({ id: 'origin', type: 'origin', x: state.originPx.x, y: state.originPx
                        .y, label: 'O' });
                if (state.unitPx1) allPoints.push({ id: 'unit1', type: 'unit1', x: state.unitPx1.x, y: state.unitPx1.y,
                    label: 'U₁' });
                if (state.unitPx2) allPoints.push({ id: 'unit2', type: 'unit2', x: state.unitPx2.x, y: state.unitPx2.y,
                    label: 'U₂' });
                state.waypointsPx.forEach((p, i) => allPoints.push({ id: `waypoint_${i}`, type: 'waypoint', x: p.x, y: p
                        .y, label: `P${i+1}`, index: i }));
                for (const p of allPoints) { const dx = p.x - x,
                        dy = p.y - y; if (dx * dx + dy * dy < threshold * threshold) return p; }
                return null;
            };

            const fallbackCopy = (text) => {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;opacity:0;';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch (e) {}
                document.body.removeChild(ta);
            };

            const copyToClipboard = (text) => {
                if (!text) return Promise.resolve(false);
                if (navigator.clipboard && navigator.clipboard.writeText)
                    return navigator.clipboard.writeText(text).then(() => true).catch(() => { fallbackCopy(text); return false; });
                fallbackCopy(text);
                return Promise.resolve(false);
            };

            // ==================== 提示信息管理 ====================
            const determineNextMode = () => {
                if (!state.originPx) return CONFIG.MODE.ORIGIN;
                if (!state.unitPx1) return CONFIG.MODE.UNIT1;
                if (!state.unitPx2) return CONFIG.MODE.UNIT2;
                if (state.waypointsPx.length >= 1) return CONFIG.MODE.DONE;
                return CONFIG.MODE.WAYPOINT;
            };

            const getDefaultHint = () => {
                if (state.mode === CONFIG.MODE.IDLE) return null;
                const hints = {
                    origin: '点击确定原点 (红色十字) · 长按放大 · 右键删除',
                    unit1: '点击确定单位距离第一个点 (蓝色) · 长按放大 · 右键删除',
                    unit2: '点击确定单位距离第二个点 (绿色) · 长按放大 · 右键删除',
                    waypoint: `点击添加途经点 (已${state.waypointsPx.length}个) · 添加后自动生成 · 长按放大 · 右键删除 · 吸附精度${getSnapPrecision()}`,
                    done: '完成！点击空白添加途经点 · 长按拖动点 · 右键删除点'
                };
                return hints[state.mode] || null;
            };

            const restoreHint = () => {
                const def = getDefaultHint();
                if (def) {
                    DOM.hint.textContent = def;
                    DOM.hint.className = '';
                    DOM.hint.classList.remove('hidden');
                } else {
                    DOM.hint.classList.add('hidden');
                }
            };

            const showHint = (msg, type = '', duration = 0) => {
                clearTimeout(DOM.hint._timeout);
                DOM.hint.textContent = msg;
                DOM.hint.className = type;
                DOM.hint.classList.remove('hidden');
                if (duration > 0) DOM.hint._timeout = setTimeout(() => restoreHint(), duration);
            };

            // ==================== 多项式类 ====================
            class Polynomial {
                constructor(coeffs) {
                    this.coeffs = coeffs.slice();
                    this._trim();
                }
                _trim() {
                    while (this.coeffs.length > 1 && Math.abs(this.coeffs[this.coeffs.length - 1]) < 1e-15) this.coeffs
                        .pop();
                    if (this.coeffs.length === 0) this.coeffs = [0];
                }
                degree() { return this.coeffs.length - 1; }
                add(other) {
                    const n = Math.max(this.coeffs.length, other.coeffs.length);
                    const r = new Array(n).fill(0);
                    for (let i = 0; i < n; i++) r[i] = (this.coeffs[i] || 0) + (other.coeffs[i] || 0);
                    return new Polynomial(r);
                }
                multiply(other) {
                    const n = this.coeffs.length + other.coeffs.length - 1;
                    const r = new Array(n).fill(0);
                    for (let i = 0; i < this.coeffs.length; i++)
                        for (let j = 0; j < other.coeffs.length; j++) r[i + j] += this.coeffs[i] * other.coeffs[j];
                    return new Polynomial(r);
                }
                scale(s) { return new Polynomial(this.coeffs.map(c => c * s)); }
                evaluate(x) {
                    let r = 0;
                    for (let i = this.coeffs.length - 1; i >= 0; i--) r = r * x + this.coeffs[i];
                    return r;
                }
                derivative() {
                    if (this.coeffs.length <= 1) return new Polynomial([0]);
                    const d = [];
                    for (let i = 1; i < this.coeffs.length; i++) d.push(i * this.coeffs[i]);
                    return new Polynomial(d);
                }
                toString(digits, variable = 'x') {
                    const coeffs = this.coeffs;
                    const terms = [];
                    const eps = Math.pow(10, -digits - 2);
                    for (let i = coeffs.length - 1; i >= 0; i--) {
                        const c = coeffs[i];
                        if (Math.abs(c) < eps) continue;
                        let cs = fmtNum(c, digits);
                        if (i === 0) terms.push(cs);
                        else if (i === 1) terms.push(cs === '1' ? variable : cs === '-1' ? `-${variable}` :
                            `${cs}${variable}`);
                        else terms.push(cs === '1' ? `${variable}^${i}` : cs === '-1' ? `-${variable}^${i}` :
                            `${cs}${variable}^${i}`);
                    }
                    if (terms.length === 0) return '0';
                    return terms.join(' + ').replace(/\+ -/g, '- ');
                }
                clone() { return new Polynomial(this.coeffs); }
            }

            const lagrangeInterpolation = (points) => {
                const n = points.length;
                if (n === 0) return new Polynomial([0]);
                if (n === 1) return new Polynomial([points[0].y]);
                let result = new Polynomial([0]);
                for (let i = 0; i < n; i++) {
                    let numerator = new Polynomial([1]);
                    let denominator = 1;
                    for (let j = 0; j < n; j++) {
                        if (i === j) continue;
                        numerator = numerator.multiply(new Polynomial([-points[j].x, 1]));
                        denominator *= (points[i].x - points[j].x);
                    }
                    if (Math.abs(denominator) < 1e-15) continue;
                    result = result.add(numerator.scale(points[i].y / denominator));
                }
                return result;
            };

            // ==================== 组件评估 ====================
            const evaluateComponent = (x, comp) => {
                if (comp.type === 'sigmoid') {
                    const expArg = -comp.k * (x - comp.a);
                    if (expArg > 100) return comp.A;
                    if (expArg < -100) return 0;
                    return comp.A / (1 + Math.exp(expArg));
                }
                if (comp.type === 'pulse') {
                    const expArg1 = -comp.k * (x - comp.a);
                    const expArg2 = -comp.k * (x - comp.b);
                    const sig1 = expArg1 > 100 ? 1 : expArg1 < -100 ? 0 : 1 / (1 + Math.exp(expArg1));
                    const sig2 = expArg2 > 100 ? 1 : expArg2 < -100 ? 0 : 1 / (1 + Math.exp(expArg2));
                    return comp.A * (sig1 - sig2);
                }
                if (comp.type === 'sin') {
                    const sinVal = comp.D * Math.sin(comp.omega * x);
                    if (comp.useSoftSwitch) {
                        const expArg = -comp.kSoft * (x - comp.xL);
                        if (expArg > 100) return sinVal;
                        if (expArg < -100) return 0;
                        return sinVal / (1 + Math.exp(expArg));
                    }
                    return sinVal;
                }
                if (comp.type === 'gauss') {
                    const arg = -comp.k * (x - comp.b) * (x - comp.b);
                    if (arg < -100) return 0;
                    let val = comp.A * Math.exp(arg);
                    if (comp.useSoftSwitch) {
                        const expArg = -comp.kSoft * (x - comp.xL);
                        if (expArg > 100) return val;
                        if (expArg < -100) return 0;
                        return val / (1 + Math.exp(expArg));
                    }
                    return val;
                }
                return 0;
            };

            const evaluateAllComponents = (x) => {
                let total = 0;
                for (const comp of state.sigmoidComponents) total += evaluateComponent(x, comp);
                for (const comp of state.sinComponents) total += evaluateComponent(x, comp);
                for (const comp of state.gaussComponents) total += evaluateComponent(x, comp);
                return total;
            };

            // ==================== 数学点管理 ====================
            const updateMathPoints = () => {
                state.mathPoints = [];
                if (!state.originPx) return;
                state.mathPoints.push({ x: 0, y: 0, isOrigin: true, label: 'O' });
                for (const p of state.waypointsPx) {
                    const m = pixelToMath(p.x, p.y);
                    if (m) state.mathPoints.push({ x: m.x, y: m.y, isOrigin: false });
                }
            };

            const calcUnitPixelDist = () => {
                if (!state.unitPx1 || !state.unitPx2) return;
                const dx = state.unitPx2.x - state.unitPx1.x;
                const dy = state.unitPx2.y - state.unitPx1.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 1) return;
                state.unitPixelDist = dist / state.unitValue;
                updateMathPoints();
                render();
            };

            // ==================== Overlay 定位线管理 ====================
            const clearOverlay = () => {
                if (!overlayCtx || !DOM.overlayCanvas) return;
                const ow = DOM.overlayCanvas.width;
                const oh = DOM.overlayCanvas.height;
                if (ow > 0 && oh > 0) {
                    overlayCtx.clearRect(0, 0, ow, oh);
                }
            };

            const drawMouseCrosshairOnOverlay = (canvasX, canvasY) => {
                if (!overlayCtx || !DOM.overlayCanvas) return;
                const dpr = window.devicePixelRatio || 1;
                const ow = DOM.overlayCanvas.width;
                const oh = DOM.overlayCanvas.height;
                if (ow <= 0 || oh <= 0) return;
                overlayCtx.clearRect(0, 0, ow, oh);
                const px = canvasX * dpr;
                const py = canvasY * dpr;

                overlayCtx.save();
                overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
                overlayCtx.strokeStyle = CONFIG.MOUSE_CROSS_COLOR;
                overlayCtx.lineWidth = 1.2;
                overlayCtx.setLineDash(CONFIG.MOUSE_CROSS_DASH);

                overlayCtx.beginPath();
                overlayCtx.moveTo(px, 0);
                overlayCtx.lineTo(px, oh);
                overlayCtx.stroke();

                overlayCtx.beginPath();
                overlayCtx.moveTo(0, py);
                overlayCtx.lineTo(ow, py);
                overlayCtx.stroke();

                overlayCtx.setLineDash([]);
                overlayCtx.restore();
            };

            const refreshOverlayCrosshair = () => {
                if (state.mouseOnCanvas && !state.isDragging) {
                    drawMouseCrosshairOnOverlay(state.mouseCanvasX, state.mouseCanvasY);
                } else if (!state.mouseOnCanvas) {
                    clearOverlay();
                }
            };

            // ==================== 渲染 ====================
            const renderBackground = (drawW, drawH) => {
                ctx.clearRect(0, 0, drawW, drawH);
                const grad = ctx.createRadialGradient(drawW / 2, drawH / 2, 0, drawW / 2, drawH / 2, Math.max(drawW,
                    drawH) * 0.7);
                grad.addColorStop(0, '#1a1a30');
                grad.addColorStop(1, '#0a0a16');
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, drawW, drawH);
            };

            const renderImage = (drawW, drawH) => {
                if (state.usingCapture && state.videoElement && state.videoElement.readyState >= 2) {
                    const vw = state.videoElement.videoWidth || 640;
                    const vh = state.videoElement.videoHeight || 480;
                    const aspect = vw / vh;
                    const containerAspect = drawW / drawH;
                    let dw, dh, offX, offY;
                    if (aspect > containerAspect) { dw = drawW;
                        dh = drawW / aspect;
                        offX = 0;
                        offY = (drawH - dh) / 2; } else { dh = drawH;
                        dw = drawH * aspect;
                        offX = (drawW - dw) / 2;
                        offY = 0; }
                    state._imgDraw = { drawW: dw, drawH: dh, offsetX: offX, offsetY: offY, W: drawW, H: drawH };
                    ctx.drawImage(state.videoElement, offX, offY, dw, dh);
                } else if (state.image && state.imgLoaded) {
                    const imgAspect = state.image.width / state.image.height;
                    const containerAspect = drawW / drawH;
                    let dw, dh, offX, offY;
                    if (imgAspect > containerAspect) { dw = drawW;
                        dh = drawW / imgAspect;
                        offX = 0;
                        offY = (drawH - dh) / 2; } else { dh = drawH;
                        dw = drawH * imgAspect;
                        offX = (drawW - dw) / 2;
                        offY = 0; }
                    state._imgDraw = { drawW: dw, drawH: dh, offsetX: offX, offsetY: offY, W: drawW, H: drawH };
                    ctx.drawImage(state.image, offX, offY, dw, dh);
                } else {
                    state._imgDraw = null;
                    ctx.fillStyle = '#2a2a4a';
                    ctx.font = '18px "Segoe UI", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('把图片放进来', drawW / 2, drawH / 2 - 8);
                    ctx.fillStyle = '#3a3a5a';
                    ctx.font = '13px "Segoe UI", sans-serif';
                    ctx.fillText('或选择文件 · Ctrl+V 粘贴 · 屏幕捕获', drawW / 2, drawH / 2 + 24);
                }
            };

            const renderOriginFullLines = (drawW, drawH) => {
                if (!state.originPx || state.mode === CONFIG.MODE.IDLE) return;
                const o = state.originPx;
                ctx.save();
                ctx.strokeStyle = CONFIG.ORIGIN_LINE_COLOR;
                ctx.lineWidth = 1.2;
                ctx.setLineDash(CONFIG.ORIGIN_LINE_DASH);
                ctx.beginPath();
                ctx.moveTo(0, o.y);
                ctx.lineTo(drawW, o.y);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(o.x, 0);
                ctx.lineTo(o.x, drawH);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            };

            const renderPoints = () => {
                const pts = [];
                if (state.originPx) pts.push({ x: state.originPx.x, y: state.originPx.y, label: 'O', color: '#f39c12',
                    size: 10, type: 'origin' });
                if (state.unitPx1) pts.push({ x: state.unitPx1.x, y: state.unitPx1.y, label: 'U₁', color: '#3498db',
                    size: 8, type: 'unit1' });
                if (state.unitPx2) pts.push({ x: state.unitPx2.x, y: state.unitPx2.y, label: 'U₂', color: '#2ecc71',
                    size: 8, type: 'unit2' });
                state.waypointsPx.forEach((p, i) => pts.push({ x: p.x, y: p.y, label: `P${i+1}`, color: '#9b59b6', size: 8,
                    type: 'waypoint', index: i }));

                for (const p of pts) {
                    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2.5);
                    g.addColorStop(0, p.color + '60');
                    g.addColorStop(1, p.color + '00');
                    ctx.fillStyle = g;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size * 2.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.shadowColor = 'rgba(0,0,0,0.5)';
                    ctx.shadowBlur = 8;
                    ctx.fillStyle = p.color;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.shadowBlur = 0;
                    ctx.strokeStyle = '#ffffffcc';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.fillStyle = '#ffffffdd';
                    ctx.font = '11px "Segoe UI", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(p.label, p.x, p.y - p.size * 0.8 - 3);
                }
            };

            const renderUnitLine = () => {
                if (!state.unitPx1 || !state.unitPx2) return;
                ctx.beginPath();
                ctx.moveTo(state.unitPx1.x, state.unitPx1.y);
                ctx.lineTo(state.unitPx2.x, state.unitPx2.y);
                ctx.strokeStyle = 'rgba(46, 204, 113, 0.5)';
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 6]);
                ctx.stroke();
                ctx.setLineDash([]);
                const midX = (state.unitPx1.x + state.unitPx2.x) / 2;
                const midY = (state.unitPx1.y + state.unitPx2.y) / 2 - 12;
                ctx.fillStyle = '#2ecc71cc';
                ctx.font = '12px "Segoe UI", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(`1 unit = ${state.unitValue}`, midX, midY);
            };

            const drawCurvePath = (pixelPts, shadowColor, strokeColor, glowColor) => {
                ctx.shadowColor = glowColor;
                ctx.shadowBlur = 14;
                ctx.strokeStyle = shadowColor;
                ctx.lineWidth = 3;
                ctx.beginPath();
                let started = false;
                for (const p of pixelPts) {
                    if (p && isFinite(p.x) && isFinite(p.y)) {
                        if (!started) { ctx.moveTo(p.x, p.y);
                            started = true; } else ctx.lineTo(p.x, p.y);
                    } else started = false;
                }
                ctx.stroke();
                ctx.shadowBlur = 0;
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                started = false;
                for (const p of pixelPts) {
                    if (p && isFinite(p.x) && isFinite(p.y)) {
                        if (!started) { ctx.moveTo(p.x, p.y);
                            started = true; } else ctx.lineTo(p.x, p.y);
                    } else started = false;
                }
                ctx.stroke();
            };

            const evaluatePiecewiseDisplay = (x, displayParams) => {
                let result = displayParams.xCoeff * x + displayParams.constTerm;
                for (const term of displayParams.absTerms) {
                    result += (term.sign === '+' ? 1 : -1) * term.coeff * Math.abs(x - term.xi);
                }
                return result;
            };

            const drawInterpolationCurve = (W, H) => {
                if (!state.funcData || !state.funcData.points || state.funcData.points.length < 2) return;
                const method = state.funcData.method || 'piecewise';
                const pts = state.funcData.points;
                const compsExist = hasComponents();
                const xMin = pts[0].x,
                    xMax = pts[pts.length - 1].x;
                const range = xMax - xMin,
                    pad = range * 0.1;
                const drawMin = xMin - pad,
                    drawMax = xMax + pad;
                const steps = CONFIG.CURVE_STEPS;

                if (method === 'piecewise') {
                    const displayParams = state.funcData.displayParams;
                    if (!displayParams) {
                        const pixelPts = pts.map(p => mathToPixel(p.x, p.y)).filter(Boolean);
                        if (!pixelPts.length) return;
                        drawCurvePath(pixelPts, '#e74c3c', '#ff6b6b', 'rgba(231, 76, 60, 0.25)');
                        for (const p of pixelPts) {
                            ctx.fillStyle = '#e74c3c';
                            ctx.beginPath();
                            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
                            ctx.fill();
                        }
                        return;
                    }
                    const pixelPtsBase = [],
                        pixelPtsCombined = [];
                    for (let i = 0; i <= steps; i++) {
                        const x = drawMin + (i / steps) * (drawMax - drawMin);
                        try {
                            const yBase = evaluatePiecewiseDisplay(x, displayParams);
                            const ppBase = mathToPixel(x, yBase);
                            pixelPtsBase.push((ppBase && isFinite(ppBase.x) && isFinite(ppBase.y)) ? ppBase : null);
                            if (compsExist) {
                                const yComb = yBase + evaluateAllComponents(x);
                                const ppComb = mathToPixel(x, yComb);
                                pixelPtsCombined.push((ppComb && isFinite(ppComb.x) && isFinite(ppComb.y)) ? ppComb :
                                    null);
                            }
                        } catch (_) {
                            pixelPtsBase.push(null);
                            if (compsExist) pixelPtsCombined.push(null);
                        }
                    }
                    drawCurvePath(pixelPtsBase, '#e74c3c', '#ff6b6b', 'rgba(231, 76, 60, 0.25)');
                    if (compsExist && pixelPtsCombined.length > 0)
                        drawCurvePath(pixelPtsCombined, CONFIG.COMBINED_CURVE_COLOR, CONFIG.COMBINED_CURVE_GLOW,
                            'rgba(255,179,0,0.35)');
                    for (const p of pts) {
                        const pp = mathToPixel(p.x, p.y);
                        if (!pp) continue;
                        ctx.fillStyle = '#e74c3c';
                        ctx.beginPath();
                        ctx.arc(pp.x, pp.y, 4, 0, Math.PI * 2);
                        ctx.fill();
                    }
                } else {
                    const displayPoly = state.funcData.displayPoly || state.funcData.poly;
                    if (!displayPoly || pts.length < 2) return;
                    const pixelPtsBase = [],
                        pixelPtsCombined = [];
                    for (let i = 0; i <= steps; i++) {
                        const x = drawMin + (i / steps) * (drawMax - drawMin);
                        try {
                            const yBase = displayPoly.evaluate(x);
                            const ppBase = mathToPixel(x, yBase);
                            pixelPtsBase.push((ppBase && isFinite(ppBase.x) && isFinite(ppBase.y)) ? ppBase : null);
                            if (compsExist) {
                                const yComb = yBase + evaluateAllComponents(x);
                                const ppComb = mathToPixel(x, yComb);
                                pixelPtsCombined.push((ppComb && isFinite(ppComb.x) && isFinite(ppComb.y)) ? ppComb :
                                    null);
                            }
                        } catch (_) {
                            pixelPtsBase.push(null);
                            if (compsExist) pixelPtsCombined.push(null);
                        }
                    }
                    drawCurvePath(pixelPtsBase, '#e74c3c', '#ff6b6b', 'rgba(231, 76, 60, 0.25)');
                    if (compsExist && pixelPtsCombined.length > 0)
                        drawCurvePath(pixelPtsCombined, CONFIG.COMBINED_CURVE_COLOR, CONFIG.COMBINED_CURVE_GLOW,
                            'rgba(255,179,0,0.35)');
                    for (const p of pts) {
                        const pp = mathToPixel(p.x, p.y);
                        if (!pp) continue;
                        ctx.fillStyle = '#e74c3c';
                        ctx.beginPath();
                        ctx.arc(pp.x, pp.y, 4, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            };

            const render = () => {
                const rect = DOM.canvasWrapper.getBoundingClientRect();
                const W = rect.width;
                const H = rect.height;
                const drawW = (state.imgLoaded || state.usingCapture) && state.lockedCssW ? state.lockedCssW : W;
                const drawH = (state.imgLoaded || state.usingCapture) && state.lockedCssH ? state.lockedCssH : H;

                renderBackground(drawW, drawH);
                renderImage(drawW, drawH);
                renderOriginFullLines(drawW, drawH);
                renderPoints();
                renderUnitLine();
                if (state.funcData && state.mode === CONFIG.MODE.DONE && !state.isDragging) drawInterpolationCurve(drawW,
                    drawH);
            };

            // ==================== 画布尺寸管理 ====================
            const syncOverlayCanvasSize = () => {
                if (!DOM.overlayCanvas) return;
                const dpr = window.devicePixelRatio || 1;
                if ((state.imgLoaded || state.usingCapture) && state.lockedCssW && state.lockedCssH) {
                    DOM.overlayCanvas.width = state.lockedCssW * dpr;
                    DOM.overlayCanvas.height = state.lockedCssH * dpr;
                    DOM.overlayCanvas.style.width = state.lockedCssW + 'px';
                    DOM.overlayCanvas.style.height = state.lockedCssH + 'px';
                } else {
                    const rect = DOM.canvasWrapper.getBoundingClientRect();
                    DOM.overlayCanvas.width = rect.width * dpr;
                    DOM.overlayCanvas.height = rect.height * dpr;
                    DOM.overlayCanvas.style.width = rect.width + 'px';
                    DOM.overlayCanvas.style.height = rect.height + 'px';
                }
            };

            const resizeCanvas = () => {
                const rect = DOM.canvasWrapper.getBoundingClientRect();
                const dpr = window.devicePixelRatio || 1;

                if ((state.imgLoaded || state.usingCapture) && state.lockedCssW && state.lockedCssH) {
                    const targetW = state.lockedCssW * dpr;
                    const targetH = state.lockedCssH * dpr;
                    DOM.canvas.width = targetW;
                    DOM.canvas.height = targetH;
                    DOM.canvas.style.width = state.lockedCssW + 'px';
                    DOM.canvas.style.height = state.lockedCssH + 'px';
                    state.lockedCanvasRenderW = targetW;
                    state.lockedCanvasRenderH = targetH;
                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                    ctx.scale(dpr, dpr);
                    syncOverlayCanvasSize();
                    render();
                    refreshOverlayCrosshair();
                    return;
                }

                let targetW = rect.width * dpr;
                let targetH = rect.height * dpr;
                DOM.canvas.width = targetW;
                DOM.canvas.height = targetH;
                DOM.canvas.style.width = rect.width + 'px';
                DOM.canvas.style.height = rect.height + 'px';
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.scale(dpr, dpr);

                if (state.imgLoaded || state.usingCapture) {
                    state.lockedCssW = rect.width;
                    state.lockedCssH = rect.height;
                    state.lockedCanvasRenderW = targetW;
                    state.lockedCanvasRenderH = targetH;
                }
                syncOverlayCanvasSize();
                render();
                refreshOverlayCrosshair();
            };

            const lockCanvasSize = () => {
                const rect = DOM.canvasWrapper.getBoundingClientRect();
                const dpr = window.devicePixelRatio || 1;
                state.lockedCssW = rect.width;
                state.lockedCssH = rect.height;
                state.lockedCanvasRenderW = rect.width * dpr;
                state.lockedCanvasRenderH = rect.height * dpr;
                DOM.canvas.width = state.lockedCanvasRenderW;
                DOM.canvas.height = state.lockedCanvasRenderH;
                DOM.canvas.style.width = state.lockedCssW + 'px';
                DOM.canvas.style.height = state.lockedCssH + 'px';
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.scale(dpr, dpr);
                syncOverlayCanvasSize();
            };

            // ==================== 公式显示管理 ====================
            const updateCombinedFormula = () => {
                const allComps = [...state.sigmoidComponents, ...state.sinComponents, ...state.gaussComponents];
                if (allComps.length === 0) {
                    DOM.combinedFormulaRow.style.display = 'none';
                    DOM.combinedFormulaDisplay.innerHTML = '<span class="empty">无组件</span>';
                    state.currentCombinedText = '';
                    DOM.copyCombinedBtn.disabled = true;
                    return;
                }
                DOM.combinedFormulaRow.style.display = 'flex';
                let baseExpr = state.currentFormulaText || '0';
                if (!baseExpr || baseExpr.trim() === '' || baseExpr.includes('class="empty"')) baseExpr = '0';
                if (baseExpr.includes('+') || (baseExpr.includes('-') && !baseExpr.startsWith('-'))) baseExpr =
                    `(${baseExpr})`;
                const compTerms = allComps.map(c => buildComponentTerm(c)).filter(t => t !== '0');
                let combined = baseExpr;
                for (const term of compTerms) combined += ' + ' + term;
                combined = combined.replace(/\+\s*-/g, '- ').replace(/\s+/g, ' ').trim();
                DOM.combinedFormulaDisplay.innerHTML = combined;
                state.currentCombinedText = combined;
                DOM.copyCombinedBtn.disabled = false;
            };

            const buildComponentTerm = (comp) => {
                const digits = getDecimalDigits();
                const f = (num) => fmtNum(num, digits);
                if (comp.type === 'sigmoid') return `${f(comp.A)}/(1+e^(-${f(comp.k)}(x-${f(comp.a)})))`;
                if (comp.type === 'pulse')
                    return `${f(comp.A)}(1/(1+e^(-${f(comp.k)}(x-${f(comp.a)})))-1/(1+e^(-${f(comp.k)}(x-${f(comp.b)}))))`;
                if (comp.type === 'sin') {
                    const sinPart = `${f(comp.D)}sin(${f(comp.omega)}x)`;
                    return comp.useSoftSwitch ? `${sinPart}/(1+e^(-${f(comp.kSoft)}(x-${f(comp.xL)})))` : sinPart;
                }
                if (comp.type === 'gauss') {
                    const gaussPart = `${f(comp.A)}e^(-${f(comp.k)}(x-${f(comp.b)})^2)`;
                    return comp.useSoftSwitch ? `${gaussPart}/(1+e^(-${f(comp.kSoft)}(x-${f(comp.xL)})))` : gaussPart;
                }
                return '0';
            };

            const buildComponentPreview = (comp) => {
                const digits = getDecimalDigits();
                const f = (num) => fmtNum(num, digits);
                if (comp.type === 'sigmoid') return `A=${f(comp.A)} k=${f(comp.k)} a=${f(comp.a)}`;
                if (comp.type === 'pulse') return `A=${f(comp.A)} k=${f(comp.k)} a=${f(comp.a)} b=${f(comp.b)}`;
                if (comp.type === 'sin') {
                    let s = `D=${f(comp.D)} ω=${f(comp.omega)}`;
                    s += comp.useSoftSwitch ? ` xL=${f(comp.xL)} kS=${f(comp.kSoft)}` : ' (全局)';
                    return s;
                }
                if (comp.type === 'gauss') {
                    let s = `A=${f(comp.A)} k=${f(comp.k)} b=${f(comp.b)}`;
                    s += comp.useSoftSwitch ? ` xL=${f(comp.xL)} kS=${f(comp.kSoft)}` : ' (全局)';
                    return s;
                }
                return '';
            };

            const updateFormulaDisplay = (expr, label, extraInfo) => {
                DOM.formulaLabel.textContent = label;
                DOM.formulaLabel.className = 'derivative-toggle';
                const cls = ['active-f', 'active-d1', 'active-d2'][state.derivativeLevel] || 'active-f';
                DOM.formulaLabel.classList.add(cls);
                DOM.formulaLabel.disabled = false;
                const displayText = (expr && expr.trim()) ? expr : '<span class="empty">表达式为空</span>';
                DOM.formulaDisplay.innerHTML = displayText;
                state.currentFormulaText = (expr && expr.trim()) ? expr : '';
                if (extraInfo && extraInfo.trim()) {
                    DOM.extraInfoValue.textContent = extraInfo;
                    DOM.extraInfoRow.classList.add('visible');
                    DOM.copyExtraBtn.disabled = false;
                    state.currentExtraText = extraInfo;
                } else {
                    DOM.extraInfoRow.classList.remove('visible');
                    DOM.copyExtraBtn.disabled = true;
                    state.currentExtraText = '';
                }
                updateCombinedFormula();
            };

            const showFormula = (text, isFormula) => {
                if (isFormula) {
                    let label = 'f(x)=';
                    let expr = text;
                    const prefixes = ['f\'\'(x)=', "f'(x)=", 'f(x)='];
                    for (const p of prefixes) {
                        if (text.startsWith(p)) { label = p;
                            expr = text.substring(p.length); break; }
                    }
                    updateFormulaDisplay(expr || text, label, null);
                } else {
                    state.currentFormulaText = '';
                    DOM.formulaDisplay.innerHTML = `<span style="color:#e74c3c;">${text}</span>`;
                    DOM.formulaLabel.textContent = '函数';
                    DOM.formulaLabel.className = 'derivative-toggle';
                    DOM.formulaLabel.disabled = true;
                    DOM.extraInfoRow.classList.remove('visible');
                    DOM.copyExtraBtn.disabled = true;
                    state.currentExtraText = '';
                    updateCombinedFormula();
                }
            };

            const updateFormulaDisplayFromFuncData = () => {
                if (!state.funcData) return;
                const labels = CONFIG.DERIVATIVE_LEVELS;
                const exprs = [state.funcData.formula, state.funcData.derivativeFormula, state.funcData
                    .secondDerivativeFormula
                ];
                const label = labels[state.derivativeLevel] || 'f(x)=';
                const expr = exprs[state.derivativeLevel] || state.funcData.formula;
                let extra = null;
                if (state.derivativeLevel === 2 && state.funcData.fPrimeZero !== undefined)
                    extra = `f'(0) = ${state.funcData.fPrimeZero}`;
                updateFormulaDisplay(expr, label, extra);
            };

            const toggleDerivativeLevel = () => {
                if (state.mode !== CONFIG.MODE.DONE || !state.funcData) return;
                state.derivativeLevel = (state.derivativeLevel + 1) % 3;
                updateFormulaDisplayFromFuncData();
                updateUI();
                const compsExist = hasComponents();
                const textToCopy = compsExist ? state.currentCombinedText : state.currentFormulaText;
                if (textToCopy) {
                    copyToClipboard(textToCopy).then(success => {
                        showHint(`已切换至 ${CONFIG.DERIVATIVE_LEVELS[state.derivativeLevel]}` + (success ?
                                '，公式已复制到剪贴板！' : ''), success ? 'success' : '', CONFIG.HINT_DURATION
                            .LONG);
                    });
                }
            };

            // ==================== 公式生成 ====================
            const generateFunction = () => {
                state.funcData = null;
                if (state.mathPoints.length < 2) { showFormula('错误: 至少需要原点 + 1 个途经点', false); return; }

                let pts = state.mathPoints.map(p => ({ ...p }));
                const nonOriginPts = pts.filter(p => !p.isOrigin);
                if (nonOriginPts.length > 0) {
                    const allPositive = nonOriginPts.every(p => p.x > 0);
                    const allNegative = nonOriginPts.every(p => p.x < 0);
                    if (allPositive) pts.sort((a, b) => a.x - b.x);
                    else if (allNegative) pts.sort((a, b) => b.x - a.x);
                    else { showFormula('错误: 途经点必须在原点同侧（全正或全负）', false); return; }
                } else pts.sort((a, b) => a.x - b.x);

                const originIdx = pts.findIndex(p => p.isOrigin);
                if (originIdx === -1) { showFormula('错误: 未找到原点', false); return; }
                if (originIdx !== 0) { const [o] = pts.splice(originIdx, 1);
                    pts.unshift(o); }
                const n = pts.length;
                if (n < 2) { showFormula('错误: 至少需要2个点', false); return; }

                const method = state.interpolationMethod;
                const digits = getDecimalDigits();

                if (method === 'piecewise') {
                    generatePiecewiseFunction(pts, digits);
                } else {
                    generatePolynomialFunction(pts, digits);
                }

                state.mode = CONFIG.MODE.DONE;
                updateUI();
                render();
                DOM.unitInput.disabled = true;
                DOM.resetPointsBtn.classList.toggle('visible', state.waypointsPx.length > 0);
                updateCombinedFormula();
                restoreHint();

                const compsExist = hasComponents();
                const textToCopy = compsExist ? state.currentCombinedText : state.currentFormulaText;
                if (textToCopy) {
                    copyToClipboard(textToCopy).then(success => {
                        showHint(success ? (compsExist ? '组合公式已复制到剪贴板！' : '公式已复制到剪贴板！') :
                            '复制失败，请点击公式文本手动复制', success ? 'success' : 'warning', CONFIG
                            .HINT_DURATION.LONG);
                    });
                }
            };

            const generatePiecewiseFunction = (pts, digits) => {
                const n = pts.length;
                const k = [];
                for (let i = 0; i < n - 1; i++) {
                    const dx = pts[i + 1].x - pts[i].x;
                    if (Math.abs(dx) < 1e-10) { showFormula('错误: 存在x坐标相同的点', false); return; }
                    k.push((pts[i + 1].y - pts[i].y) / dx);
                }
                const dk = [];
                for (let i = 1; i < k.length; i++) dk.push(k[i] - k[i - 1]);
                const k0 = k[0];
                const formType = DOM.formTypeSelect.value;
                const f = (num) => fmtNum(num, digits);
                const rn = (num) => roundedNum(num, digits);

                let xCoeff = k0,
                    constTerm = 0;
                const absTerms = [],
                    absTermsData = [];
                for (let i = 0; i < dk.length; i++) {
                    const xi = pts[i + 1].x;
                    const coeff = dk[i] / 2;
                    xCoeff += coeff;
                    constTerm -= coeff * xi;
                    if (Math.abs(coeff) > 1e-12) {
                        const sign = coeff > 0 ? '+' : '-';
                        const absCoeff = Math.abs(coeff);
                        const absPart = formType === 'abs' ? `abs(x - ${f(xi)})` : `sqrt((x - ${f(xi)})^2)`;
                        const absCoeffDisplay = Math.abs(absCoeff - 1) < 1e-12 ? '' : f(absCoeff);
                        absTerms.push(` ${sign} ${absCoeffDisplay}${absPart}`);
                        absTermsData.push({ sign, absCoeff, xi });
                    }
                }
                let xPart = '';
                if (Math.abs(xCoeff) > 1e-12) {
                    if (Math.abs(xCoeff - 1) < 1e-12) xPart = 'x';
                    else if (Math.abs(xCoeff + 1) < 1e-12) xPart = '-x';
                    else xPart = `${f(xCoeff)}x`;
                }
                let constPart = Math.abs(constTerm) > 1e-12 ? ` ${constTerm > 0 ? '+' : '-'} ${f(Math.abs(constTerm))}` :
                    '';
                let absPartStr = absTerms.join('');
                let formulaExpr = xPart || '0';
                if (absPartStr) formulaExpr += absPartStr;
                if (constPart) formulaExpr += constPart;
                if (!xPart && !absPartStr && !constPart) formulaExpr = '0';

                const derivConstTerm = xCoeff;
                const sgnTerms = [];
                for (const item of absTermsData) {
                    const { sign, absCoeff, xi } = item;
                    const coeffStr = Math.abs(absCoeff - 1) < 1e-12 ? '' : `${f(absCoeff)}`;
                    const frac = formType === 'abs' ? `(x - ${f(xi)})/abs(x - ${f(xi)})` :
                        `(x - ${f(xi)})/sqrt((x - ${f(xi)})^2)`;
                    sgnTerms.push(` ${sign} ${coeffStr}${frac}`);
                }
                let derivExpr = Math.abs(derivConstTerm) > 1e-12 ? `${f(derivConstTerm)}` : (sgnTerms.length ? '0' : '0');
                if (sgnTerms.length) derivExpr += sgnTerms.join('');
                derivExpr = derivExpr.replace(/\s+/g, ' ').trim().replace(/^0\s*\+/, '').trim() || '0';
                const secondDerivExpr = '0';

                let fPrimeZero = 0;
                const xVals = pts.map(p => p.x);
                let foundIdx = -1;
                for (let i = 0; i < xVals.length - 1; i++) {
                    if (xVals[i] <= 0 && xVals[i + 1] >= 0) { foundIdx = i; break; }
                }
                if (foundIdx >= 0) {
                    if (Math.abs(xVals[foundIdx] - 0) < 1e-12) fPrimeZero = foundIdx > 0 ? k[foundIdx - 1] : k[foundIdx];
                    else if (Math.abs(xVals[foundIdx + 1] - 0) < 1e-12) fPrimeZero = k[foundIdx];
                    else fPrimeZero = k[foundIdx];
                } else if (xVals.length > 0) {
                    fPrimeZero = (0 < xVals[0]) ? (k[0] || 0) : (0 > xVals[xVals.length - 1]) ? (k[k.length - 1] || 0) :
                    0;
                }
                const fPrimeZeroStr = fmtNum(roundedNum(fPrimeZero, digits), digits);

                const displayParams = {
                    xCoeff: rn(xCoeff),
                    constTerm: rn(constTerm),
                    absTerms: absTermsData.map(item => ({ coeff: rn(item.absCoeff), xi: rn(item.xi), sign: item.sign }))
                };
                state.funcData = {
                    method: 'piecewise',
                    points: pts.map(p => ({ x: p.x, y: p.y })),
                    segments: k,
                    dk,
                    k0,
                    formula: formulaExpr,
                    derivativeFormula: derivExpr,
                    secondDerivativeFormula: secondDerivExpr,
                    rawPoints: pts,
                    formType,
                    fPrimeZero: fPrimeZeroStr,
                    displayParams
                };
                const labels = CONFIG.DERIVATIVE_LEVELS;
                const exprs = [formulaExpr, derivExpr, secondDerivExpr];
                updateFormulaDisplay(exprs[state.derivativeLevel] || formulaExpr, labels[state.derivativeLevel] ||
                    'f(x)=',
                    state.derivativeLevel === 2 ? `f'(0) = ${fPrimeZeroStr}` : null);
            };

            const generatePolynomialFunction = (pts, digits) => {
                if (pts.length > CONFIG.MAX_POLY_POINTS) {
                    showFormula(`警告: 点数过多(>${CONFIG.MAX_POLY_POINTS})，多项式插值可能产生龙格振荡，建议减少点数`,
                        false);
                    return;
                }
                for (let i = 0; i < pts.length; i++)
                    for (let j = i + 1; j < pts.length; j++)
                        if (Math.abs(pts[i].x - pts[j].x) < 1e-10) { showFormula('错误: 存在x坐标相同的点，无法进行多项式插值',
                            false); return; }
                try {
                    const poly = lagrangeInterpolation(pts);
                    const f = (num) => fmtNum(num, digits);
                    const rn = (num) => roundedNum(num, digits);
                    const displayCoeffs = poly.coeffs.map(c => rn(c));
                    const displayPoly = new Polynomial(displayCoeffs);
                    const displayDerivativePoly = displayPoly.derivative();
                    const displaySecondDerivativePoly = displayDerivativePoly.derivative();
                    let polyStr = displayPoly.toString(digits, 'x');
                    if (displayPoly.coeffs.length === 1 && displayPoly.coeffs[0] === 0) polyStr = '0';
                    else if (displayPoly.coeffs.length === 1) polyStr = f(displayPoly.coeffs[0]);
                    let derivPolyStr = displayDerivativePoly.toString(digits, 'x');
                    if (displayDerivativePoly.coeffs.length === 1 && displayDerivativePoly.coeffs[0] === 0) derivPolyStr =
                        '0';
                    else if (displayDerivativePoly.coeffs.length === 1) derivPolyStr = f(displayDerivativePoly.coeffs[0]);
                    let secondDerivPolyStr = displaySecondDerivativePoly.toString(digits, 'x');
                    if (displaySecondDerivativePoly.coeffs.length === 1 && displaySecondDerivativePoly.coeffs[0] === 0)
                        secondDerivPolyStr = '0';
                    else if (displaySecondDerivativePoly.coeffs.length === 1) secondDerivPolyStr = f(
                        displaySecondDerivativePoly.coeffs[0]);
                    const fPrimeZeroVal = displayDerivativePoly.evaluate(0);
                    const fPrimeZeroStr = fmtNum(rn(fPrimeZeroVal), digits);
                    state.funcData = {
                        method: 'polynomial',
                        points: pts.map(p => ({ x: p.x, y: p.y })),
                        poly,
                        displayPoly,
                        displayDerivativePoly,
                        displaySecondDerivativePoly,
                        derivativePoly: poly.derivative(),
                        secondDerivativePoly: poly.derivative().derivative(),
                        formula: polyStr,
                        derivativeFormula: derivPolyStr,
                        secondDerivativeFormula: secondDerivPolyStr,
                        rawPoints: pts,
                        degree: poly.degree(),
                        fPrimeZero: fPrimeZeroStr
                    };
                    const labels = CONFIG.DERIVATIVE_LEVELS;
                    const exprs = [polyStr, derivPolyStr, secondDerivPolyStr];
                    updateFormulaDisplay(exprs[state.derivativeLevel] || polyStr, labels[state.derivativeLevel] ||
                        'f(x)=',
                        state.derivativeLevel === 2 ? `f'(0) = ${fPrimeZeroStr}` : null);
                } catch (err) { showFormula(`多项式插值错误: ${err.message || err}`, false); }
            };

            // ==================== UI 状态更新 ====================
            const updateUI = () => {
                DOM.statusDot.className = state.usingCapture ? 'capturing' : state.mode;
                if (state.usingCapture) {
                    const modeLabels = { idle: '就绪', origin: '确定原点', unit1: '单位点1', unit2: '单位点2',
                        waypoint: `途经点 (${state.waypointsPx.length})`, done: '完成' };
                    DOM.statusText.textContent = '实时流 · ' + (modeLabels[state.mode] || '就绪');
                    DOM.refreshCaptureBtn.style.display = 'inline-block';
                } else {
                    DOM.refreshCaptureBtn.style.display = 'none';
                    const texts = {
                        idle: '拖入图片 / 屏幕捕获',
                        origin: '确定原点',
                        unit1: '确定单位距离第1点',
                        unit2: '确定单位距离第2点',
                        waypoint: `添加途经点 (已${state.waypointsPx.length}个)`,
                        done: '完成！组合公式已就绪'
                    };
                    DOM.statusText.textContent = texts[state.mode] || '';
                }
                DOM.unitInput.disabled = (state.mode === CONFIG.MODE.ORIGIN || state.mode === CONFIG.MODE.UNIT1 || state
                    .mode === CONFIG.MODE.UNIT2) ? false : true;
                const canChange = (state.mode === CONFIG.MODE.DONE);
                DOM.decimalInput.disabled = false;
                DOM.snapInput.disabled = false;
                DOM.formTypeSelect.disabled = (state.interpolationMethod === 'polynomial');
                DOM.methodSelect.disabled = false;
                DOM.formulaLabel.disabled = !canChange;
                DOM.unitInput.disabled = state.mode === CONFIG.MODE.DONE ? true : DOM.unitInput.disabled;
                DOM.resetPointsBtn.classList.toggle('visible', state.waypointsPx.length > 0);
                if (state.mode === CONFIG.MODE.DONE && state.funcData) {
                    DOM.formulaLabel.textContent = CONFIG.DERIVATIVE_LEVELS[state.derivativeLevel] || 'f(x)=';
                    DOM.formulaLabel.className = 'derivative-toggle';
                    const cls = ['active-f', 'active-d1', 'active-d2'][state.derivativeLevel] || 'active-f';
                    DOM.formulaLabel.classList.add(cls);
                }
                DOM.captureBtn.disabled = state.usingCapture;
                const badge = document.querySelector('.method-badge');
                if (state.mode === CONFIG.MODE.DONE) {
                    if (!badge) {
                        const b = document.createElement('span');
                        b.className = 'method-badge';
                        b.textContent = state.interpolationMethod === 'piecewise' ? '分段线性' : '多项式 (拉格朗日)';
                        DOM.statusText.parentNode.appendChild(b);
                    } else badge.textContent = state.interpolationMethod === 'piecewise' ? '分段线性' : '多项式 (拉格朗日)';
                } else { if (badge) badge.remove(); }
                DOM.addSigmoidBtn.disabled = false;
                DOM.addPulseBtn.disabled = false;
                DOM.addSinBtn.disabled = false;
                DOM.addGaussBtn.disabled = false;
                DOM.clearComponentsBtn.disabled = (state.sigmoidComponents.length + state.sinComponents.length + state
                    .gaussComponents.length) === 0;
                if (canChange && hasComponents()) updateCombinedFormula();
                if (state.mode !== CONFIG.MODE.DONE) restoreHint();
            };

            // ==================== 组件管理 ====================
            const addComponent = (type) => {
                const id = ++state.componentIdCounter;
                let comp;
                switch (type) {
                    case 'sigmoid':
                        comp = { id, type: 'sigmoid', A: 1, k: 3, a: 10 };
                        state.sigmoidComponents.push(comp);
                        break;
                    case 'pulse':
                        comp = { id, type: 'pulse', A: 1, k: 3, a: 10, b: 20 };
                        state.sigmoidComponents.push(comp);
                        break;
                    case 'sin':
                        comp = { id, type: 'sin', D: 2, omega: 8, xL: 0, kSoft: 5, useSoftSwitch: true };
                        state.sinComponents.push(comp);
                        break;
                    case 'gauss':
                        comp = { id, type: 'gauss', A: 10, k: 20, b: 15, xL: 0, kSoft: 5, useSoftSwitch: false };
                        state.gaussComponents.push(comp);
                        break;
                }
                renderComponents();
                if (state.mode === CONFIG.MODE.DONE) { updateCombinedFormula();
                    render(); }
            };

            const removeComponent = (id) => {
                state.sigmoidComponents = state.sigmoidComponents.filter(c => c.id !== id);
                state.sinComponents = state.sinComponents.filter(c => c.id !== id);
                state.gaussComponents = state.gaussComponents.filter(c => c.id !== id);
                renderComponents();
                if (state.mode === CONFIG.MODE.DONE) { updateCombinedFormula();
                    render(); }
            };

            const updateComponentParam = (id, param, value) => {
                const allComps = [...state.sigmoidComponents, ...state.sinComponents, ...state.gaussComponents];
                const comp = allComps.find(c => c.id === id);
                if (!comp) return;
                const numVal = parseFloat(value);
                if (isNaN(numVal)) return;
                comp[param] = numVal;
                renderComponents();
                if (state.mode === CONFIG.MODE.DONE) { updateCombinedFormula();
                    render(); }
            };

            const updateComponentBoolParam = (id, param, value) => {
                const allComps = [...state.sigmoidComponents, ...state.sinComponents, ...state.gaussComponents];
                const comp = allComps.find(c => c.id === id);
                if (!comp) return;
                comp[param] = value;
                renderComponents();
                if (state.mode === CONFIG.MODE.DONE) { updateCombinedFormula();
                    render(); }
            };

            const clearAllComponents = () => {
                state.sigmoidComponents = [];
                state.sinComponents = [];
                state.gaussComponents = [];
                state.componentIdCounter = 0;
                renderComponents();
                if (state.mode === CONFIG.MODE.DONE) { updateCombinedFormula();
                    render(); }
            };

            const renderComponents = () => {
                const allComps = [...state.sigmoidComponents, ...state.sinComponents, ...state.gaussComponents];
                if (allComps.length === 0) {
                    DOM.componentsList.innerHTML = '';
                    DOM.combinedFormulaRow.style.display = 'none';
                    DOM.combinedFormulaDisplay.innerHTML = '<span class="empty">无组件</span>';
                    state.currentCombinedText = '';
                    DOM.copyCombinedBtn.disabled = true;
                    return;
                }
                let html = '';
                for (const comp of allComps) {
                    if (comp.type === 'sigmoid') {
                        html += buildCompRowHTML(comp, 'sigmoid-tag', 'Sigmoid', [
                            ['A', comp.A, 0.1],
                            ['k', comp.k, 0.1],
                            ['a', comp.a, 0.5]
                        ]);
                    } else if (comp.type === 'pulse') {
                        html += buildCompRowHTML(comp, 'pulse-tag', '脉冲', [
                            ['A', comp.A, 0.1],
                            ['k', comp.k, 0.1],
                            ['a', comp.a, 0.5],
                            ['b', comp.b, 0.5]
                        ]);
                    } else if (comp.type === 'sin') {
                        html += buildCompRowHTML(comp, 'sin-tag', 'Sin扫描', [
                            ['D', comp.D, 0.1],
                            ['omega', comp.omega, 0.5]
                        ], true);
                    } else if (comp.type === 'gauss') {
                        html += buildCompRowHTML(comp, 'gauss-tag', '高斯', [
                            ['A', comp.A, 0.1],
                            ['k', comp.k, 0.05],
                            ['b', comp.b, 0.5]
                        ], true);
                    }
                }
                DOM.componentsList.innerHTML = html;
                bindComponentEvents();
                if (state.mode === CONFIG.MODE.DONE) updateCombinedFormula();
                else {
                    DOM.combinedFormulaRow.style.display = allComps.length > 0 ? 'flex' : 'none';
                    if (allComps.length > 0) {
                        DOM.combinedFormulaDisplay.innerHTML =
                            '<span style="color:#6c7a9a;">完成选点后可生成组合公式</span>';
                        DOM.copyCombinedBtn.disabled = true;
                        state.currentCombinedText = '';
                    }
                }
            };

            const buildCompRowHTML = (comp, tagClass, tagLabel, params, hasSoftSwitch = false) => {
                const softChecked = comp.useSoftSwitch ? 'checked' : '';
                let paramsHTML = params.map(([name, val, step]) =>
                    `<label>${name}</label><input type="number" value="${val}" step="${step}" data-param="${name}" data-id="${comp.id}" />`
                ).join('');
                if (hasSoftSwitch) {
                    paramsHTML +=
                        `<label>软开关<input type="checkbox" ${softChecked} data-param="useSoftSwitch" data-id="${comp.id}" style="width:14px;height:14px;cursor:pointer;" /></label>`;
                    if (comp.useSoftSwitch) {
                        paramsHTML +=
                            `<label>xL</label><input type="number" value="${comp.xL}" step="0.5" data-param="xL" data-id="${comp.id}" />`;
                        paramsHTML +=
                            `<label>kS</label><input type="number" value="${comp.kSoft}" step="0.5" data-param="kSoft" data-id="${comp.id}" />`;
                    }
                }
                return `
                <div class="comp-row" data-id="${comp.id}">
                    <span class="comp-tag ${tagClass}">${tagLabel}</span>
                    ${paramsHTML}
                    <span class="comp-preview">${buildComponentPreview(comp)}</span>
                    <button class="btn-remove-comp" data-id="${comp.id}">✕</button>
                </div>`;
            };

            const bindComponentEvents = () => {
                DOM.componentsList.querySelectorAll('input[type="number"]').forEach(inp => {
                    inp.addEventListener('input', function() {
                        updateComponentParam(parseInt(this.dataset.id), this.dataset.param, this.value);
                    });
                    inp.addEventListener('change', function() {
                        updateComponentParam(parseInt(this.dataset.id), this.dataset.param, this.value);
                    });
                });
                DOM.componentsList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                    cb.addEventListener('change', function() {
                        updateComponentBoolParam(parseInt(this.dataset.id), this.dataset.param, this.checked);
                    });
                });
                DOM.componentsList.querySelectorAll('.btn-remove-comp').forEach(btn => {
                    btn.addEventListener('click', function() {
                        removeComponent(parseInt(this.dataset.id));
                    });
                });
            };

            // ==================== 点操作 ====================
            const addWaypointAtPos = (pos) => {
                const snapPrecision = getSnapPrecision();
                let newMath = pixelToMath(pos.x, pos.y);
                if (!newMath) return;
                const snapped = snapToInteger(newMath, snapPrecision);
                const finalMath = { x: snapped.x, y: snapped.y };
                if (snapped.snapped) { const sp = mathToPixel(snapped.x, snapped.y); if (sp) { pos.x = sp.x;
                        pos.y = sp.y; } }
                if (Math.abs(finalMath.x) < 1e-10) {
                    showHint('途经点不能与原点x坐标相同 (x ≠ 0)', 'warning', CONFIG.HINT_DURATION.NORMAL);
                    return;
                }
                const existingNonOrigin = state.mathPoints.filter(p => !p.isOrigin);
                if (existingNonOrigin.length > 0) {
                    const allPositive = existingNonOrigin.every(p => p.x > 0);
                    const allNegative = existingNonOrigin.every(p => p.x < 0);
                    if ((allPositive && finalMath.x < 0) || (allNegative && finalMath.x > 0)) {
                        showHint(allPositive ? '所有途经点必须在原点同侧！当前在右侧 (x>0)，不能添加左侧点' :
                            '所有途经点必须在原点同侧！当前在左侧 (x<0)，不能添加右侧点', 'warning', CONFIG.HINT_DURATION
                            .NORMAL);
                        return;
                    }
                }
                if (state.mathPoints.some(p => Math.abs(p.x - finalMath.x) < 1e-6)) {
                    showHint('该点的x坐标已存在了，换个位置吧', 'warning', CONFIG.HINT_DURATION.NORMAL);
                    return;
                }
                state.waypointsPx.push({ x: pos.x, y: pos.y });
                updateMathPoints();
                const snapInfo = snapped.snapped ? ` · 已吸附整点(${[snapped.snappedX ? `x→${snapped.x}` : '', snapped
                        .snappedY ? `y→${snapped.y}` : ''
                    ].filter(Boolean).join(', ')})` : '';
                if (state.originPx && state.unitPx1 && state.unitPx2 && state.waypointsPx.length >= 1) {
                    generateFunction();
                    showHint('已添加新点' + snapInfo + '，公式已更新！', 'success', CONFIG.HINT_DURATION.NORMAL);
                } else {
                    updateUI();
                    render();
                    showHint(`途经点已添加${snapInfo} (已${state.waypointsPx.length}个)`, 'success', CONFIG.HINT_DURATION
                        .NORMAL);
                }
            };

            const deletePoint = (point) => {
                if (!point) return false;
                state.funcData = null;
                state.currentFormulaText = '';
                state.currentExtraText = '';
                state.currentCombinedText = '';
                state.derivativeLevel = 0;
                showFormula('<span class="empty">等待生成…</span>', false);

                switch (point.type) {
                    case 'origin':
                        state.originPx = null;
                        state.mode = CONFIG.MODE.ORIGIN;
                        break;
                    case 'unit1':
                        state.unitPx1 = null;
                        state.unitPixelDist = 1;
                        state.mode = CONFIG.MODE.UNIT1;
                        break;
                    case 'unit2':
                        state.unitPx2 = null;
                        state.unitPixelDist = 1;
                        state.mode = CONFIG.MODE.UNIT2;
                        break;
                    case 'waypoint': {
                        const idx = point.index;
                        if (idx === undefined || idx < 0 || idx >= state.waypointsPx.length) return false;
                        state.waypointsPx.splice(idx, 1);
                        updateMathPoints();
                        state.mode = determineNextMode();
                        if (state.mode === CONFIG.MODE.DONE && state.originPx && state.waypointsPx.length >= 1) {
                            updateMathPoints();
                            generateFunction();
                            showHint(`途经点已删除，剩余 ${state.waypointsPx.length} 个`, 'warning', CONFIG.HINT_DURATION
                                .NORMAL);
                            return true;
                        }
                        break;
                    }
                    default:
                        return false;
                }
                updateMathPoints();
                updateUI();
                render();
                updateCombinedFormula();
                restoreHint();
                showHint(`${point.label || '点'}已删除`, 'warning', CONFIG.HINT_DURATION.NORMAL);
                return true;
            };

            // ==================== 拖拽管理 ====================
            const startDragPoint = (point, clientX, clientY) => {
                if (!point) return;
                let target = null;
                if (point.type === 'origin' && state.originPx) target = { id: 'origin', type: 'origin', ref: state
                        .originPx };
                else if (point.type === 'unit1' && state.unitPx1) target = { id: 'unit1', type: 'unit1', ref: state
                        .unitPx1 };
                else if (point.type === 'unit2' && state.unitPx2) target = { id: 'unit2', type: 'unit2', ref: state
                        .unitPx2 };
                else if (point.type === 'waypoint' && point.index !== undefined && point.index >= 0 && point.index < state
                    .waypointsPx.length)
                    target = { id: `waypoint_${point.index}`, type: 'waypoint', ref: state.waypointsPx[point.index],
                        index: point.index };
                if (!target) return;
                state.dragTarget = target;
                state.isDragging = true;
                DOM.canvasWrapper.classList.add('dragging');
                DOM.canvas.style.cursor = 'grabbing';
                DOM.overlayCanvas.style.cursor = 'grabbing';
                showHint(`拖动 ${point.label} 中... 松开确定位置`, 'success');
                updateDragPoint(clientX, clientY);
            };

            const updateDragPoint = (clientX, clientY) => {
                if (!state.isDragging || !state.dragTarget) return;
                const pos = screenToCanvas(clientX, clientY);
                if (!pos) return;
                const draw = state._imgDraw;
                if (draw) {
                    const m = 5;
                    pos.x = Math.max(draw.offsetX + m, Math.min(draw.offsetX + draw.drawW - m, pos.x));
                    pos.y = Math.max(draw.offsetY + m, Math.min(draw.offsetY + draw.drawH - m, pos.y));
                }
                state.dragTarget.ref.x = pos.x;
                state.dragTarget.ref.y = pos.y;
                if ((state.dragTarget.type === 'unit1' || state.dragTarget.type === 'unit2') && state.unitPx1 && state
                    .unitPx2) calcUnitPixelDist();
                updateMathPoints();
                state.mouseCanvasX = pos.x;
                state.mouseCanvasY = pos.y;
                render();
                refreshOverlayCrosshair();
            };

            const endDragPoint = () => {
                if (!state.isDragging || !state.dragTarget) { cleanupDrag(); return; }
                const wasDone = (state.mode === CONFIG.MODE.DONE);
                state.isDragging = false;
                DOM.canvasWrapper.classList.remove('dragging');
                DOM.canvas.style.cursor = 'crosshair';
                DOM.overlayCanvas.style.cursor = 'crosshair';
                if (wasDone && state.originPx && state.waypointsPx.length > 0) {
                    updateMathPoints();
                    generateFunction();
                } else if (wasDone && (state.waypointsPx.length === 0 || !state.originPx)) {
                    if (state.waypointsPx.length === 0 && state.originPx) {
                        state.mode = CONFIG.MODE.WAYPOINT;
                        state.funcData = null;
                        state.currentFormulaText = '';
                        state.currentExtraText = '';
                        state.currentCombinedText = '';
                        state.derivativeLevel = 0;
                        showFormula('<span class="empty">等待生成…</span>', false);
                        updateUI();
                        render();
                        updateCombinedFormula();
                        showHint('点数不足，请继续添加途经点', 'warning', CONFIG.HINT_DURATION.NORMAL);
                    }
                } else { updateUI();
                    render();
                    updateCombinedFormula();
                    restoreHint(); }
                state.dragTarget = null;
                refreshOverlayCrosshair();
            };

            const cleanupDrag = () => {
                state.isDragging = false;
                DOM.canvasWrapper.classList.remove('dragging');
                DOM.canvas.style.cursor = 'crosshair';
                DOM.overlayCanvas.style.cursor = 'crosshair';
                state.dragTarget = null;
                refreshOverlayCrosshair();
            };

            // ==================== 放大镜管理 ====================
            const isMagnifierEnabledForMode = () => {
                return state.mode !== CONFIG.MODE.IDLE && (state.imgLoaded || state.usingCapture);
            };

            const enterMagnifier = (clientX, clientY) => {
                if (!isMagnifierEnabledForMode() || state.magnifierActive) return;
                state.magnifierActive = true;
                state.magnifierMouseX = clientX;
                state.magnifierMouseY = clientY;
                DOM.magnifier.style.display = 'block';
                updateMagnifierPosition(clientX, clientY);
                updateMagnifierContent(clientX, clientY);
                showHint('放大镜已启动 · 移动鼠标精确定位 · 松开即点击', 'success');
            };

            const exitMagnifier = () => {
                if (!state.magnifierActive) { DOM.magnifier.style.display = 'none'; return; }
                state.magnifierActive = false;
                DOM.magnifier.style.display = 'none';
                if (state.mouseOnCanvas && !state.isDragging) {
                    drawMouseCrosshairOnOverlay(state.mouseCanvasX, state.mouseCanvasY);
                } else {
                    clearOverlay();
                }
                restoreHint();
            };

            const updateMagnifierPosition = (clientX, clientY) => {
                const offset = 20;
                let left = clientX + offset;
                let top = clientY + offset;
                const rect = DOM.magnifier.getBoundingClientRect();
                const w = rect.width || CONFIG.MAG_SIZE;
                const h = rect.height || CONFIG.MAG_SIZE;
                if (left + w > window.innerWidth - 10) left = clientX - w - offset;
                if (top + h > window.innerHeight - 10) top = clientY - h - offset;
                if (left < 10) left = 10;
                if (top < 10) top = 10;
                DOM.magnifier.style.left = left + 'px';
                DOM.magnifier.style.top = top + 'px';
            };

            const updateMagnifierContent = (clientX, clientY) => {
                if (!state.magnifierActive) return;
                const pos = screenToCanvas(clientX, clientY);
                if (!pos) return;
                const dpr = window.devicePixelRatio || 1;
                const samplePx = SAMPLE_SIZE * dpr;
                const cx = pos.x * dpr,
                    cy = pos.y * dpr;
                const srcX = cx - samplePx / 2,
                    srcY = cy - samplePx / 2;
                const magSize = CONFIG.MAG_SIZE;
                magnifierCtx.clearRect(0, 0, magSize, magSize);
                try {
                    magnifierCtx.drawImage(DOM.canvas, srcX, srcY, samplePx, samplePx, 0, 0, magSize, magSize);
                } catch (e) {
                    magnifierCtx.fillStyle = '#0d0d1a';
                    magnifierCtx.fillRect(0, 0, magSize, magSize);
                    magnifierCtx.fillStyle = '#4a5a7a';
                    magnifierCtx.font = '13px sans-serif';
                    magnifierCtx.textAlign = 'center';
                    magnifierCtx.textBaseline = 'middle';
                    magnifierCtx.fillText('边缘区域', magSize / 2, magSize / 2);
                }

                // ---- 放大镜中绘制十字定位线 ----
                const half = magSize / 2;
                magnifierCtx.save();
                // 外发光十字
                magnifierCtx.shadowColor = 'rgba(0,0,0,0.8)';
                magnifierCtx.shadowBlur = 6;
                magnifierCtx.strokeStyle = 'rgba(255,255,255,0.9)';
                magnifierCtx.lineWidth = 1.5;
                // 水平线
                magnifierCtx.beginPath();
                magnifierCtx.moveTo(4, half);
                magnifierCtx.lineTo(magSize - 4, half);
                magnifierCtx.stroke();
                // 垂直线
                magnifierCtx.beginPath();
                magnifierCtx.moveTo(half, 4);
                magnifierCtx.lineTo(half, magSize - 4);
                magnifierCtx.stroke();
                // 中心小圆点
                magnifierCtx.shadowBlur = 4;
                magnifierCtx.fillStyle = 'rgba(255,50,50,0.95)';
                magnifierCtx.beginPath();
                magnifierCtx.arc(half, half, 3, 0, Math.PI * 2);
                magnifierCtx.fill();
                // 外圈光晕
                magnifierCtx.shadowBlur = 0;
                magnifierCtx.strokeStyle = 'rgba(255,50,50,0.3)';
                magnifierCtx.lineWidth = 1;
                magnifierCtx.beginPath();
                magnifierCtx.arc(half, half, 7, 0, Math.PI * 2);
                magnifierCtx.stroke();
                magnifierCtx.restore();

                updateMagnifierPosition(clientX, clientY);
                state.magnifierMouseX = clientX;
                state.magnifierMouseY = clientY;
            };

            const cancelPressTimer = () => { if (state.pressTimer) { clearTimeout(state.pressTimer);
                    state.pressTimer = null; } state.isPressing = false; };

            // ==================== 图像加载 ====================
            const triggerFileSelect = () => {
                if (!state.fileInput) {
                    state.fileInput = document.createElement('input');
                    state.fileInput.type = 'file';
                    state.fileInput.accept = 'image/*';
                    state.fileInput.style.display = 'none';
                    document.body.appendChild(state.fileInput);
                    state.fileInput.addEventListener('change', e => {
                        if (e.target.files && e.target.files[0]) loadImageFile(e.target.files[0]);
                        state.fileInput.value = '';
                    });
                }
                state.fileInput.click();
            };

            const loadImageFile = (file) => {
                if (state.isLoadingImage) return;
                state.isLoadingImage = true;
                if (state.usingCapture) stopScreenCapture();
                if (state.imgLoaded) resetAll();
                const reader = new FileReader();
                reader.onload = e => {
                    const img = new Image();
                    img.onload = () => {
                        state.image = img;
                        state.imgLoaded = true;
                        DOM.dropOverlay.classList.add('hidden');
                        state.lockedCanvasRenderW = null;
                        state.lockedCanvasRenderH = null;
                        state.lockedCssW = null;
                        state.lockedCssH = null;
                        resizeCanvas();
                        lockCanvasSize();
                        state.mode = CONFIG.MODE.ORIGIN;
                        state.derivativeLevel = 0;
                        state.isLoadingImage = false;
                        updateUI();
                        render();
                        refreshOverlayCrosshair();
                        restoreHint();
                    };
                    img.onerror = () => {
                        state.isLoadingImage = false;
                        alert('图片加载失败，请尝试其他图片');
                        if (!state.imgLoaded) DOM.dropOverlay.classList.remove('hidden');
                        render();
                    };
                    img.src = e.target.result;
                };
                reader.onerror = () => { state.isLoadingImage = false;
                    alert('读取文件失败'); };
                reader.readAsDataURL(file);
            };

            // ==================== 屏幕捕获 ====================
            const startScreenCapture = () => {
                if (state.usingCapture) return;
                if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                    alert('您的浏览器不支持屏幕捕获 API。\n请使用 Chrome / Edge / Firefox 桌面版，或使用图片上传功能。');
                    return;
                }
                if (state.imgLoaded) {
                    state.image = null;
                    state.imgLoaded = false;
                    state._imgDraw = null;
                    state.lockedCanvasRenderW = null;
                    state.lockedCanvasRenderH = null;
                    state.lockedCssW = null;
                    state.lockedCssH = null;
                }
                resetCapturePoints();
                navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'window' }, audio: false,
                        preferCurrentTab: false })
                    .then(stream => {
                        state.videoStream = stream;
                        state.videoElement = document.createElement('video');
                        state.videoElement.srcObject = stream;
                        state.videoElement.playsInline = true;
                        state.videoElement.autoplay = true;
                        state.videoElement.onloadedmetadata = () => {
                            state.videoElement.play().catch(() => {});
                            state.usingCapture = true;
                            state.imgLoaded = false;
                            DOM.dropOverlay.classList.add('hidden');
                            state.lockedCanvasRenderW = null;
                            state.lockedCanvasRenderH = null;
                            state.lockedCssW = null;
                            state.lockedCssH = null;
                            state.mode = CONFIG.MODE.ORIGIN;
                            updateUI();
                            resizeCanvas();
                            lockCanvasSize();
                            render();
                            refreshOverlayCrosshair();
                        };
                        state.videoElement.onerror = () => { stopScreenCapture();
                            alert('视频播放错误，请重试'); };
                        stream.getVideoTracks()[0].onended = () => {
                            if (state.usingCapture) {
                                stopScreenCapture();
                                if (!state.imgLoaded) {
                                    DOM.dropOverlay.classList.remove('hidden');
                                    state.mode = CONFIG.MODE.IDLE;
                                    updateUI();
                                    render();
                                    refreshOverlayCrosshair();
                                }
                            }
                        };
                    })
                    .catch(err => {
                        const msgs = { NotAllowedError: '用户拒绝了屏幕捕获权限，或取消了选择。',
                            PermissionDeniedError: '用户拒绝了屏幕捕获权限，或取消了选择。',
                            NotFoundError: '未找到可捕获的屏幕或窗口。', DevicesNotFoundError: '未找到可捕获的屏幕或窗口。' };
                        alert(msgs[err.name] || `屏幕捕获失败: ${err.message || err.name}`);
                        state.mode = CONFIG.MODE.IDLE;
                        updateUI();
                        render();
                        if (!state.imgLoaded) DOM.dropOverlay.classList.remove('hidden');
                    });
            };

            const resetCapturePoints = () => {
                state.originPx = null;
                state.unitPx1 = null;
                state.unitPx2 = null;
                state.waypointsPx = [];
                state.mathPoints = [];
                state.unitPixelDist = 1;
                state.funcData = null;
                state.currentFormulaText = '';
                state.currentExtraText = '';
                state.currentCombinedText = '';
                state.derivativeLevel = 0;
                showFormula('<span class="empty">等待生成…</span>', false);
                DOM.unitInput.disabled = true;
                DOM.resetPointsBtn.classList.remove('visible');
                updateCombinedFormula();
            };

            const stopScreenCapture = () => {
                state.usingCapture = false;
                if (state.videoStream) { state.videoStream.getTracks().forEach(t => t.stop());
                    state.videoStream = null; }
                if (state.videoElement) { state.videoElement.pause();
                    state.videoElement.srcObject = null;
                    state.videoElement = null; }
                DOM.canvasWrapper.classList.remove('capturing');
                state.lockedCanvasRenderW = null;
                state.lockedCanvasRenderH = null;
                state.lockedCssW = null;
                state.lockedCssH = null;
                if (state.mode !== CONFIG.MODE.DONE) state.mode = CONFIG.MODE.IDLE;
                updateUI();
                render();
                refreshOverlayCrosshair();
                if (!state.imgLoaded) DOM.dropOverlay.classList.remove('hidden');
            };

            const refreshCaptureFrame = () => {
                if (!state.usingCapture || !state.videoElement) return;
                render();
                refreshOverlayCrosshair();
            };

            // ==================== 重置操作 ====================
            const resetAll = () => {
                if (state.usingCapture) {
                    resetCapturePoints();
                    state.sigmoidComponents = [];
                    state.sinComponents = [];
                    state.gaussComponents = [];
                    state.componentIdCounter = 0;
                    state.lockedCanvasRenderW = null;
                    state.lockedCanvasRenderH = null;
                    state.lockedCssW = null;
                    state.lockedCssH = null;
                    state.mode = CONFIG.MODE.ORIGIN;
                    updateUI();
                    render();
                    renderComponents();
                    updateCombinedFormula();
                    refreshOverlayCrosshair();
                    restoreHint();
                    return;
                }
                stopScreenCapture();
                state.mode = CONFIG.MODE.IDLE;
                state.originPx = null;
                state.unitPx1 = null;
                state.unitPx2 = null;
                state.waypointsPx = [];
                state.mathPoints = [];
                state.unitPixelDist = 1;
                state.funcData = null;
                state.currentFormulaText = '';
                state.currentExtraText = '';
                state.currentCombinedText = '';
                state.derivativeLevel = 0;
                state.sigmoidComponents = [];
                state.sinComponents = [];
                state.gaussComponents = [];
                state.componentIdCounter = 0;
                state.lockedCanvasRenderW = null;
                state.lockedCanvasRenderH = null;
                state.lockedCssW = null;
                state.lockedCssH = null;
                state.mouseCanvasX = -100;
                state.mouseCanvasY = -100;
                state.mouseOnCanvas = false;
                DOM.decimalInput.value = '1';
                DOM.snapInput.value = '0.1';
                DOM.formTypeSelect.value = 'abs';
                DOM.methodSelect.value = 'polynomial';
                state.interpolationMethod = 'polynomial';
                showFormula('<span class="empty">等待生成…</span>', false);
                DOM.unitInput.disabled = true;
                DOM.resetPointsBtn.classList.remove('visible');
                state.imgLoaded = false;
                state.image = null;
                state._imgDraw = null;
                clearOverlay();
                updateUI();
                render();
                renderComponents();
                updateCombinedFormula();
                if (!state.usingCapture) DOM.dropOverlay.classList.remove('hidden');
                DOM.hint.classList.add('hidden');
                DOM.captureBtn.disabled = false;
                DOM.canvasWrapper.classList.remove('capturing');
                const badge = document.querySelector('.method-badge');
                if (badge) badge.remove();
                exitMagnifier();
                cleanupDrag();
                cancelPressTimer();
                if (state.dragTimer) { clearTimeout(state.dragTimer);
                    state.dragTimer = null; }
                state.pendingDragPoint = null;
                state.isPressing = false;
            };

            const resetPointsOnly = () => {
                state.waypointsPx = [];
                state.mathPoints = [];
                state.funcData = null;
                state.currentFormulaText = '';
                state.currentExtraText = '';
                state.currentCombinedText = '';
                state.derivativeLevel = 0;
                showFormula('<span class="empty">等待生成…</span>', false);
                updateMathPoints();
                state.mode = determineNextMode();
                updateUI();
                render();
                updateCombinedFormula();
                refreshOverlayCrosshair();
                if (state.mode === CONFIG.MODE.DONE && state.originPx && state.waypointsPx.length >= 1) generateFunction();
                restoreHint();
                showHint('途经点已清除，请重新添加', 'warning', CONFIG.HINT_DURATION.NORMAL);
            };

            const onOptionsChange = () => {
                state.interpolationMethod = DOM.methodSelect.value;
                DOM.formTypeSelect.disabled = (state.interpolationMethod === 'polynomial');
                getDecimalDigits();
                getSnapPrecision();
                if (state.mode === CONFIG.MODE.DONE && state.funcData) { generateFunction(); } else { updateUI();
                    render();
                    updateCombinedFormula(); }
                refreshOverlayCrosshair();
            };

            // ==================== 鼠标事件处理 ====================
            const handleCanvasClick = (e) => {
                if (!state.imgLoaded && !state.usingCapture) { triggerFileSelect(); return; }
                const pos = screenToCanvas(e.clientX, e.clientY);
                if (!pos) return;
                const draw = state._imgDraw;
                if (draw && (pos.x < draw.offsetX || pos.x > draw.offsetX + draw.drawW || pos.y < draw.offsetY || pos.y >
                        draw.offsetY + draw.drawH)) return;

                switch (state.mode) {
                    case CONFIG.MODE.ORIGIN:
                        state.originPx = { x: pos.x, y: pos.y };
                        break;
                    case CONFIG.MODE.UNIT1:
                        state.unitPx1 = { x: pos.x, y: pos.y };
                        if (state.unitPx1 && state.unitPx2) calcUnitPixelDist();
                        break;
                    case CONFIG.MODE.UNIT2:
                        state.unitPx2 = { x: pos.x, y: pos.y };
                        calcUnitPixelDist();
                        break;
                    case CONFIG.MODE.WAYPOINT:
                        addWaypointAtPos(pos);
                        return;
                    case CONFIG.MODE.DONE:
                        if (findPointAt(pos.x, pos.y)) return;
                        if (draw && (pos.x < draw.offsetX || pos.x > draw.offsetX + draw.drawW || pos.y < draw.offsetY ||
                                pos.y > draw.offsetY + draw.drawH)) return;
                        addWaypointAtPos(pos);
                        return;
                }
                state.mode = determineNextMode();
                if (state.mode === CONFIG.MODE.DONE && state.waypointsPx.length >= 1) {
                    updateMathPoints();
                    generateFunction();
                } else { updateUI();
                    render();
                    refreshOverlayCrosshair();
                    restoreHint(); }
            };

            const setupMouseEvents = () => {
                DOM.canvas.addEventListener('mousedown', e => {
                    if (e.button !== 0) return;
                    const pos = screenToCanvas(e.clientX, e.clientY);
                    if (!pos) return;
                    const draw = state._imgDraw;
                    if (draw && (pos.x < draw.offsetX || pos.x > draw.offsetX + draw.drawW || pos.y < draw.offsetY ||
                            pos.y > draw.offsetY + draw.drawH)) return;
                    const hitPoint = findPointAt(pos.x, pos.y);
                    if (hitPoint && isMagnifierEnabledForMode()) {
                        state.pendingDragPoint = hitPoint;
                        state.isPressing = true;
                        state.pressStartX = pos.x;
                        state.pressStartY = pos.y;
                        if (state.pressTimer) { clearTimeout(state.pressTimer);
                            state.pressTimer = null; }
                        state.dragTimer = setTimeout(() => {
                            if (state.isPressing && state.pendingDragPoint && !state.magnifierActive) {
                                startDragPoint(state.pendingDragPoint, e.clientX, e.clientY);
                                state.pendingDragPoint = null;
                            }
                            state.dragTimer = null;
                        }, CONFIG.DRAG_PRESS_MS);
                        return;
                    }
                    state.pendingDragPoint = null;
                    state.isPressing = true;
                    state.pressStartX = pos.x;
                    state.pressStartY = pos.y;
                    if (state.dragTimer) { clearTimeout(state.dragTimer);
                        state.dragTimer = null; }
                    if (isMagnifierEnabledForMode())
                        state.pressTimer = setTimeout(() => {
                            if (state.isPressing && !state.isDragging && !state.magnifierActive) enterMagnifier(e
                                .clientX, e.clientY);
                            state.pressTimer = null;
                        }, CONFIG.LONG_PRESS_MS);
                    else state.pressTimer = null;
                });

                DOM.canvas.addEventListener('mousemove', e => {
                    const pos = screenToCanvas(e.clientX, e.clientY);
                    if (pos) {
                        state.mouseCanvasX = pos.x;
                        state.mouseCanvasY = pos.y;
                        state.mouseOnCanvas = true;
                        if (!state.isDragging) {
                            drawMouseCrosshairOnOverlay(pos.x, pos.y);
                        }
                    }

                    if (state.isDragging && state.dragTarget) { updateDragPoint(e.clientX, e.clientY); return; }
                    if (state.magnifierActive) {
                        state.magnifierMouseX = e.clientX;
                        state.magnifierMouseY = e.clientY;
                        updateMagnifierContent(e.clientX, e.clientY);
                        return;
                    }
                    if (state.isPressing) {
                        if (pos && (pos.x - state.pressStartX) ** 2 + (pos.y - state.pressStartY) ** 2 > CONFIG
                            .MOVE_THRESHOLD ** 2) {
                            cancelPressTimer();
                            if (state.dragTimer) { clearTimeout(state.dragTimer);
                                state.dragTimer = null; }
                            state.pendingDragPoint = null;
                        }
                    }
                });

                DOM.canvas.addEventListener('mouseup', e => {
                    if (e.button !== 0) return;
                    const wasMagnifierActive = state.magnifierActive;
                    const wasDragging = state.isDragging;
                    if (wasDragging) { endDragPoint();
                        cancelPressTimer(); if (state.dragTimer) { clearTimeout(state.dragTimer);
                            state.dragTimer = null; }
                        state.pendingDragPoint = null;
                        state.isPressing = false; return; }
                    if (wasMagnifierActive) {
                        exitMagnifier();
                        handleCanvasClick({ clientX: state.magnifierMouseX, clientY: state.magnifierMouseY });
                        cancelPressTimer();
                        if (state.dragTimer) { clearTimeout(state.dragTimer);
                            state.dragTimer = null; }
                        state.pendingDragPoint = null;
                        state.isPressing = false;
                        return;
                    }
                    if (state.isPressing) { cancelPressTimer(); if (state.dragTimer) { clearTimeout(state.dragTimer);
                            state.dragTimer = null; } const pos2 = screenToCanvas(e.clientX, e.clientY); if (
                            pos2) { const draw2 = state._imgDraw; if (!draw2 || (pos2.x >= draw2.offsetX && pos2
                                .x <= draw2.offsetX + draw2.drawW && pos2.y >= draw2.offsetY && pos2.y <= draw2
                                .offsetY + draw2.drawH)) handleCanvasClick(e); }
                        state.pendingDragPoint = null;
                        state.isPressing = false; }
                });

                DOM.canvas.addEventListener('mouseleave', () => {
                    state.mouseOnCanvas = false;
                    clearOverlay();
                    if (state.magnifierActive) exitMagnifier();
                    if (state.isDragging) { cleanupDrag();
                        render(); if (state.mode === CONFIG.MODE.DONE) showHint('拖动已取消', 'warning', CONFIG
                            .HINT_DURATION.NORMAL); }
                    cancelPressTimer();
                    if (state.dragTimer) { clearTimeout(state.dragTimer);
                        state.dragTimer = null; }
                    state.pendingDragPoint = null;
                    state.isPressing = false;
                });

                DOM.canvas.addEventListener('mouseenter', () => {
                    state.mouseOnCanvas = true;
                    refreshOverlayCrosshair();
                });

                DOM.canvas.addEventListener('contextmenu', e => {
                    e.preventDefault();
                    if (!state.imgLoaded && !state.usingCapture) return;
                    const pos = screenToCanvas(e.clientX, e.clientY);
                    if (!pos) return;
                    const draw = state._imgDraw;
                    if (draw && (pos.x < draw.offsetX || pos.x > draw.offsetX + draw.drawW || pos.y < draw.offsetY ||
                            pos.y > draw.offsetY + draw.drawH)) return;
                    const hitPoint = findPointAt(pos.x, pos.y);
                    if (hitPoint) {
                        if (deletePoint(hitPoint)) showHint(`已删除 ${hitPoint.label || '点'}`, 'warning', CONFIG
                            .HINT_DURATION.SHORT);
                    } else showHint('没有点到可删除', 'warning', CONFIG.HINT_DURATION.SHORT);
                });

                document.addEventListener('keydown', e => {
                    if (e.key === 'Escape') {
                        if (state.magnifierActive) { exitMagnifier();
                            cancelPressTimer();
                            showHint('已取消放大镜', 'warning', CONFIG.HINT_DURATION.SHORT); }
                        if (state.isDragging) { cleanupDrag();
                            render();
                            showHint('拖动已取消', 'warning', CONFIG.HINT_DURATION.NORMAL); }
                        cancelPressTimer();
                        if (state.dragTimer) { clearTimeout(state.dragTimer);
                            state.dragTimer = null; }
                        state.pendingDragPoint = null;
                        state.isPressing = false;
                        refreshOverlayCrosshair();
                    }
                });
            };

            const setupDragDrop = () => {
                DOM.canvasWrapper.addEventListener('dragover', e => { e.preventDefault();
                    DOM.canvasWrapper.classList.add('drag-over'); });
                DOM.canvasWrapper.addEventListener('dragleave', e => { e.preventDefault();
                    DOM.canvasWrapper.classList.remove('drag-over'); });
                DOM.canvasWrapper.addEventListener('drop', e => {
                    e.preventDefault();
                    DOM.canvasWrapper.classList.remove('drag-over');
                    const files = e.dataTransfer.files;
                    if (files && files.length > 0) {
                        const file = files[0];
                        if (file.type.startsWith('image/')) loadImageFile(file);
                        else alert('请拖入图片文件');
                    }
                });
            };

            const setupPaste = () => {
                document.addEventListener('paste', e => {
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target
                        .isContentEditable) return;
                    for (const item of e.clipboardData.items) {
                        if (item.type.startsWith('image/')) { const file = item.getAsFile(); if (file) { e
                                .preventDefault();
                                loadImageFile(file); } break; }
                    }
                });
            };

            const setupWheelSupport = () => {
                document.addEventListener('wheel', function(e) {
                    const target = e.target;
                    if (target.tagName === 'INPUT' && target.type === 'number' && !target.disabled) {
                        const inToolbar = target.closest('#toolbar');
                        const inComponents = target.closest('#componentsList') || target.closest('.comp-row');
                        if (!inToolbar && !inComponents) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const delta = e.deltaY > 0 ? -1 : 1;
                        let step = parseFloat(target.step);
                        if (isNaN(step) || step <= 0) step = 0.1;
                        if (target.id === 'unitInput') {
                            const val = parseFloat(target.value) || 0;
                            if (val < 1) step = 0.1;
                            else if (val < 10) step = 0.5;
                            else step = 1;
                        }
                        const min = target.min !== '' ? parseFloat(target.min) : -Infinity;
                        const max = target.max !== '' ? parseFloat(target.max) : Infinity;
                        let val = parseFloat(target.value);
                        if (isNaN(val)) val = 0;
                        let newVal = val + delta * step;
                        newVal = Math.max(min, Math.min(max, newVal));
                        const stepStr = step.toString();
                        let decimals = (stepStr.split('.')[1] || '').length;
                        if (decimals === 0) decimals = 0;
                        newVal = parseFloat(newVal.toFixed(Math.max(decimals, 0)));
                        if (isNaN(newVal)) return;
                        target.value = newVal;
                        target.dispatchEvent(new Event('input', { bubbles: true }));
                        target.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }, { passive: false });
            };

            // ==================== 初始化 ====================
            const init = () => {
                DOM.magnifierCanvas.width = CONFIG.MAG_SIZE;
                DOM.magnifierCanvas.height = CONFIG.MAG_SIZE;
                DOM.magnifierCanvas.style.width = CONFIG.MAG_SIZE + 'px';
                DOM.magnifierCanvas.style.height = CONFIG.MAG_SIZE + 'px';

                syncOverlayCanvasSize();
                clearOverlay();

                resetAll();
                setupDragDrop();
                setupPaste();
                setupMouseEvents();
                setupWheelSupport();

                const hasCapture = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
                if (!hasCapture) { DOM.captureBtn.title = '您的浏览器不支持屏幕捕获，请使用图片上传';
                    DOM.captureBtn.style.opacity = '0.6'; }

                DOM.formulaDisplay.addEventListener('click', function(e) {
                    if (e.target.closest('.empty')) return;
                    if (!state.currentFormulaText) return;
                    copyToClipboard(state.currentFormulaText).then(success => {
                        showHint(success ? '公式已复制到剪贴板！' : '复制失败，请手动复制',
                            success ? 'success' : 'warning', CONFIG.HINT_DURATION.NORMAL);
                    });
                });

                DOM.combinedFormulaDisplay.addEventListener('click', function(e) {
                    if (e.target.closest('.empty')) return;
                    if (!state.currentCombinedText) return;
                    copyToClipboard(state.currentCombinedText).then(success => {
                        showHint(success ? '组合公式已复制到剪贴板！' : '复制失败，请手动复制',
                            success ? 'success' : 'warning', CONFIG.HINT_DURATION.NORMAL);
                    });
                });

                DOM.copyCombinedBtn.addEventListener('click', () =>
                    copyToClipboard(state.currentCombinedText).then(s => {
                        showHint(s ? '组合公式已复制到剪贴板！' : '复制失败，请手动复制',
                            s ? 'success' : 'warning', CONFIG.HINT_DURATION.NORMAL);
                    }));

                DOM.copyExtraBtn.addEventListener('click', () =>
                    copyToClipboard(state.currentExtraText).then(s => {
                        showHint(s ? "f'(0) 已复制到剪贴板！" : "复制 f'(0) 失败，请手动复制",
                            s ? 'success' : 'warning', CONFIG.HINT_DURATION.NORMAL);
                    }));

                DOM.resetPointsBtn.addEventListener('click', resetPointsOnly);
                DOM.captureBtn.addEventListener('click', startScreenCapture);
                DOM.refreshCaptureBtn.addEventListener('click', refreshCaptureFrame);
                DOM.formulaLabel.addEventListener('click', toggleDerivativeLevel);

                DOM.decimalInput.addEventListener('change', onOptionsChange);
                DOM.decimalInput.addEventListener('input', () => {
                    let v = parseInt(DOM.decimalInput.value, 10);
                    if (!isNaN(v)) {
                        if (v < 0) DOM.decimalInput.value = 0;
                        if (v > CONFIG.MAX_DECIMAL_DIGITS) DOM.decimalInput.value = CONFIG.MAX_DECIMAL_DIGITS;
                    }
                });

                DOM.snapInput.addEventListener('change', () => {
                    getSnapPrecision();
                    if (state.mode === CONFIG.MODE.WAYPOINT) updateUI();
                    if (state.mode === CONFIG.MODE.DONE && state.funcData) onOptionsChange();
                });

                DOM.formTypeSelect.addEventListener('change', onOptionsChange);
                DOM.methodSelect.addEventListener('change', onOptionsChange);

                DOM.unitInput.addEventListener('change', () => {
                    const v = parseFloat(DOM.unitInput.value);
                    if (!isNaN(v) && v > 0) {
                        state.unitValue = v;
                        if (state.unitPx1 && state.unitPx2) calcUnitPixelDist();
                    }
                });

                window.addEventListener('resize', () => {
                    if ((state.imgLoaded || state.usingCapture) && state.lockedCssW && state.lockedCssH) {
                        const dpr = window.devicePixelRatio || 1;
                        DOM.canvas.width = state.lockedCanvasRenderW;
                        DOM.canvas.height = state.lockedCanvasRenderH;
                        DOM.canvas.style.width = state.lockedCssW + 'px';
                        DOM.canvas.style.height = state.lockedCssH + 'px';
                        ctx.setTransform(1, 0, 0, 1, 0, 0);
                        ctx.scale(dpr, dpr);
                        syncOverlayCanvasSize();
                        render();
                        refreshOverlayCrosshair();
                        return;
                    }
                    resizeCanvas();
                });

                DOM.addSigmoidBtn.addEventListener('click', () => addComponent('sigmoid'));
                DOM.addPulseBtn.addEventListener('click', () => addComponent('pulse'));
                DOM.addSinBtn.addEventListener('click', () => addComponent('sin'));
                DOM.addGaussBtn.addEventListener('click', () => addComponent('gauss'));
                DOM.clearComponentsBtn.addEventListener('click', clearAllComponents);

                state.interpolationMethod = 'polynomial';
                DOM.methodSelect.value = 'polynomial';
                DOM.formTypeSelect.disabled = true;
                state.derivativeLevel = 0;
                updateUI();
                renderComponents();
                updateCombinedFormula();
                if (!state.imgLoaded && !state.usingCapture) DOM.dropOverlay.classList.remove('hidden');
                DOM.magnifier.style.display = 'none';
                refreshOverlayCrosshair();
            };

            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
            else init();
            window.resetApp = resetAll;
        })();
