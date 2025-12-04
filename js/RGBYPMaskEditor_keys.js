import { GP, getNodeState } from "./RGBYPMaskEditor.js"
import { colorListRGB, updateToolButtonsHighlight, updateSelectedColorUI } from "./RGBYPMaskEditor_ui.js";
import { saveMask, updatePreview } from "./RGBYPMaskEditor_io.js";


const closeEditor = () => {
    const state = getNodeState(GP.baseNode.id);

    const dialog = state.dialogElement;
    const overlay = state.overlayDialog;

    
    unregisterKeyHandlers(dialog);

    
    if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
    }
};

async function onKeyDownStub(e) {

    const state = getNodeState(GP.baseNode.id);
    if (state) {
        let idx = null;
        switch (e.code) {
            case "Digit1": idx = 0; break; // R
            case "Digit2": idx = 1; break; // G
            case "Digit3": idx = 2; break; // B
            case "Digit4": idx = 3; break; // Y
            case "Digit5": idx = 4; break; // P
        }
        if (idx !== null && !e.altKey && !e.metaKey) {
            state.drawColor = idx;
            updateSelectedColorUI(idx);
            // console.log("[RGBYP] Color hotkey -> index", idx);
            e.preventDefault();
            return;
        }
    }


    // Space  : temporary pan
    
    if (e.code === "Space") {
        if (state && !state.spaceScrollActive) {
            state.spaceScrollActive = true;
            state.prevTool = state.currentTool || "Brush";
            state.currentTool = "Scroll";
            updateToolButtonsHighlight("Scroll");
        }
        e.preventDefault();
        return;
    }

    // --- SHIFT+Z  (zoom out) ---
    if (e.code === "KeyZ" && e.shiftKey) {
        if (!state) return;

        const panel = state.centralPanel || state.canvasContainer;
        if (!panel) return;
        const rect = panel.getBoundingClientRect();

        
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        
        applyZoomAt(state, cx, cy, +100);

        e.preventDefault();
        return;
    }

    // --- SHIFT+X  (zoom in) ---
    if (e.code === "KeyX" && e.shiftKey) {
        if (!state) return;

        const panel = state.centralPanel || state.canvasContainer;
        if (!panel) return;
        const rect = panel.getBoundingClientRect();

        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        
        applyZoomAt(state, cx, cy, -100);

        e.preventDefault();
        return;
    }

    
    if (e.code === "KeyV" && e.shiftKey) {
        if (!state) return;

        const total = 4; // 0..3
        const prevIndex = (state.currentAutoMaskIndex ?? -1);
        const nextIndex = (prevIndex + 1 + total) % total;

        state.currentAutoMaskIndex = nextIndex;
        applyAutoMask(state, nextIndex);

        e.preventDefault();
        return;
    }

    
    if (e.key === "Escape") {
        // console.log("[RGBYP] ESC pressed: closing dialog without saving");
        closeEditor();
        e.preventDefault();
        return;
    }

    
    if (e.key === "Enter") {
        try {
            
            await saveMask();
            updatePreview();
        } catch (err) {
            console.error("[RGBYP] saveMask error on Enter:", err);
        }
        closeEditor();
        e.preventDefault();
        return;
    }
    // Shift+C : reset zoom to initial
    if (e.code === "KeyC" && e.shiftKey) {
        resetZoom();
        e.preventDefault();
        return;
    }
    // Shift+N : clear mask
    if (e.code === "KeyN" && e.shiftKey) {
        if (state) clearMask(state);
        e.preventDefault();
        return;
    }

    // Shift+A / Shift+D : brush size - / +
    if (e.code === "KeyA" && e.shiftKey) {
        adjustBrushSizeByStep(-1);
        e.preventDefault();
        return;
    }

    
    if (e.code === "KeyD" && e.shiftKey) {
        adjustBrushSizeByStep(1);
        e.preventDefault();
        return;
    }
    // Shift+W / Shift+S : opacity + / -
    if (e.code === "KeyW" && e.shiftKey) {
        adjustMaskOpacityByStep(+1);
        e.preventDefault();
        return;
    }
    if (e.code === "KeyS" && e.shiftKey) {
        adjustMaskOpacityByStep(-1);
        e.preventDefault();
        return;
    }
}

function onKeyUpStub(e) {
    if (e.code === "Space") {
        const state = getNodeState(GP.baseNode.id);
        if (state && state.spaceScrollActive) {
            state.spaceScrollActive = false;
            state.currentTool = state.prevTool || "Brush";
            updateToolButtonsHighlight(state.currentTool || "Brush");
        }
        e.preventDefault();
    }
}

function applyZoomAt(state, centerClientX, centerClientY, deltaY, cursorEvent) {
    const container = state.canvasContainer;
    const panel = state.centralPanel;
    if (!container || !panel) return;

    const rect = container.getBoundingClientRect();
    const prevCssW = parseFloat(container.style.width) || rect.width;
    const prevCssH = parseFloat(container.style.height) || rect.height;
    if (!prevCssW || !prevCssH) return;

    
    const xOnCanvas = centerClientX - rect.left;
    const yOnCanvas = centerClientY - rect.top;
    const relX = xOnCanvas / prevCssW;
    const relY = yOnCanvas / prevCssH;

    
    if (!state.zoomPrevWidth || !state.zoomPrevHeight) {
        state.zoomPrevWidth = prevCssW;
        state.zoomPrevHeight = prevCssH;
    }

    
    const factor = deltaY < 0 ? 1.1 : 1 / 1.1;

    const oldZoom = state.zoom || 1;
    let newZoom = oldZoom * factor;

    const MIN_ZOOM = 0.2;
    const MAX_ZOOM = 6.0;
    if (newZoom < MIN_ZOOM) newZoom = MIN_ZOOM;
    if (newZoom > MAX_ZOOM) newZoom = MAX_ZOOM;
    state.zoom = newZoom;

    const cssW = state.zoomPrevWidth * newZoom;
    const cssH = state.zoomPrevHeight * newZoom;

    container.style.width = cssW + "px";
    container.style.height = cssH + "px";

    const deltaW = cssW - prevCssW;
    const deltaH = cssH - prevCssH;

    const dx = deltaW * relX;
    const dy = deltaH * relY;

    panel.scrollLeft += dx;
    panel.scrollTop += dy;

    
    
    if (cursorEvent) {
        updateBrushCursor(cursorEvent);
    }
}


function onWheelZoom(e) {
    const state = getNodeState(GP.baseNode.id);
    if (!state) return;

    
    e.preventDefault();

    applyZoomAt(state, e.clientX, e.clientY, e.deltaY, e);
}

function resetZoom() {
    const state = getNodeState(GP.baseNode.id);
    if (!state || !state.canvasContainer || !state.centralPanel) return;
    if (!state.zoomPrevWidth || !state.zoomPrevHeight) return;

    state.zoom = 1;
    state.canvasContainer.style.width = state.zoomPrevWidth + "px";
    state.canvasContainer.style.height = state.zoomPrevHeight + "px";

    state.centralPanel.scrollLeft = 0;
    state.centralPanel.scrollTop = 0;
}

function getCanvasCoords(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const xRel = (e.clientX - rect.left) / rect.width;
    const yRel = (e.clientY - rect.top) / rect.height;

    const x = xRel * canvas.width;
    const y = yRel * canvas.height;
    return { x, y };
}


function onMaskMouseDown(e) {
    const state = getNodeState(GP.baseNode.id);
    if (state.currentTool === "Scroll") {
        onPanMouseDown(e);
        return;
    }

    
    
    if (state.currentTool === "Erase") {
        state.drawMode = "Erase";
    } else {
        
        state.drawMode = (e.button === 2) ? "Erase" : "Paint";
    }

    const canvas = state.maskCanvas;
    if (!canvas) return;

    
    if (e.button !== 0 && e.button !== 2) return;

    e.preventDefault();

    const { x, y } = getCanvasCoords(e, canvas);

    state.isDrawing = true;
    state.drawLastX = x;
    state.drawLastY = y;

    const ctx = canvas.getContext("2d");

    
    if (state.drawMode === "Erase") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
        ctx.globalCompositeOperation = "source-over";
        const idx = state.drawColor ?? 0;
        const rgb = colorListRGB[idx]?.color || [255, 0, 0];
        const strokeColor = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 1)`;
        // console.log("[RGBYP] onMaskMouseDown strokeColor:", idx);
        ctx.strokeStyle = strokeColor;
    }

    ctx.lineWidth = state.brushSize || 40;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(x, y);

    onMaskDraw(e);
}


function onMaskDraw(e) {
    const state = getNodeState(GP.baseNode.id);
    const canvas = state.maskCanvas;
    if (!canvas || !state.isDrawing) return;

    if (!(e.buttons & 1) && !(e.buttons & 2)) {
        const ctx = canvas.getContext("2d");
        ctx.closePath();
        ctx.globalCompositeOperation = "source-over";
        state.isDrawing = false;
        state.drawMode = null;
        return;
    }
    e.preventDefault();

    const { x, y } = getCanvasCoords(e, canvas);

    const ctx = canvas.getContext("2d");

    const mode = state.drawMode || "Paint";

    

    if (mode === "Erase") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
        ctx.globalCompositeOperation = "source-over";
        const idx = state.drawColor ?? 0;
        const rgb = colorListRGB[idx]?.color || [255, 0, 0];
        const strokeColor = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 1)`;
        ctx.strokeStyle = strokeColor;
    }

    ctx.lineWidth = state.brushSize || 40;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.lineTo(x, y);
    ctx.stroke();

    state.drawLastX = x;
    state.drawLastY = y;
}


function onMaskMouseUp(e) {
    const state = getNodeState(GP.baseNode.id);
    const canvas = state.maskCanvas;
    if (!canvas) {
        state.isDrawing = false;
        return;
    }

    if (state.isDrawing) {
        const ctx = canvas.getContext("2d");
        ctx.closePath();
        
        ctx.globalCompositeOperation = "source-over";
    }
    state.isDrawing = false;
    state.drawMode = null;
}

function onMaskContextMenu(e) {
    
    e.preventDefault();
}


// ----------------- OPACITY -----------------

function clampMaskOpacity(a) {
    return Math.max(0, Math.min(a, 1));
}

function applyMaskOpacity(state) {
    const alpha = clampMaskOpacity(state.maskOpacity ?? 1);
    state.maskOpacity = alpha;
    if (state.maskCanvas) {
        state.maskCanvas.style.opacity = String(alpha);
    }
}

function adjustMaskOpacityByStep(direction) {
    const state = getNodeState(GP.baseNode.id);
    if (!state) return;

    let alpha = state.maskOpacity;
    if (alpha == null || isNaN(alpha)) alpha = 1;

    const step = 0.05; 
    alpha += direction * step;
    alpha = clampMaskOpacity(alpha);

    state.maskOpacity = alpha;
    applyMaskOpacity(state);

    if (state.opacitySlider) {
        const v = Math.round(alpha * 100);
        state.opacitySlider.value = String(v);
        
        state.opacitySlider.dispatchEvent(new Event("input", { bubbles: true }));
    }
}



function clampBrushSize(size) {
    return Math.max(1, Math.min(size, 400));
}

function adjustBrushSizeByStep(direction) {
    const state = getNodeState(GP.baseNode.id);

    let size = state.brushSize ?? 50;

    let step = 1;
    if (size < 20) step = 1;
    else if (size < 100) step = 3;
    else step = 5;

    size += direction * step;
    size = clampBrushSize(size);

    state.brushSize = size;

    
    if (state.brushSlider) {
        state.brushSlider.value = String(size);
        state.brushSlider.dispatchEvent(new Event("input", { bubbles: true }));
    }

    
    if (state.lastCursorClientX != null) {
        updateBrushCursor({
            clientX: state.lastCursorClientX,
            clientY: state.lastCursorClientY,
        });
    }
}


function getBrushSizePx(state) {
    const brushSize = clampBrushSize(state.brushSize ?? 50);

    const canvas = state.maskCanvas || state.originalCanvas;
    const rect = canvas.getBoundingClientRect();

    const scale = rect.width / canvas.width;
    return brushSize * scale;
}

function updateBrushCursor(e) {
    const state = getNodeState(GP.baseNode.id);
    const container = state.canvasContainer;
    if (!container) return;

    const cursorEl = state.drawCursor;
    if (!cursorEl) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    
    state.lastCursorClientX = e.clientX;
    state.lastCursorClientY = e.clientY;

    const sizePx = getBrushSizePx(state);

    // console.log(`[RGBYP] Brush cursor sizePx: ${sizePx}`);

    cursorEl.style.width = sizePx + "px";
    cursorEl.style.height = sizePx + "px";
    cursorEl.style.left = x + "px";
    cursorEl.style.top = y + "px";
    cursorEl.style.display = "block";
}

function onBrushCursorMove(e) {
    updateBrushCursor(e);
}

function onBrushCursorEnter(e) {
    const state = getNodeState(GP.baseNode.id);
    const cursorEl = state.drawCursor;
    if (cursorEl) {
        cursorEl.style.display = "block";
    }
    updateBrushCursor(e);
}

function onBrushCursorLeave(e) {
    const state = getNodeState(GP.baseNode.id);
    if (state.drawCursor) {
        state.drawCursor.style.display = "none";
    }
}

// Tools

function clearMask(state) {
    const canvas = state.maskCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function onToolButtonClick(e) {
    const state = getNodeState(GP.baseNode.id);
    if (!state) return;

    const btn = e.currentTarget;
    const tool = btn.dataset.tool;

    if (tool === "Brush") {
        state.currentTool = "Brush";
        updateToolButtonsHighlight("Brush");
    } else if (tool === "Erase" || tool === "Eraser") {
        state.currentTool = "Erase";
        updateToolButtonsHighlight("Erase");
    } else if (tool === "Scroll") {
        state.currentTool = "Scroll";
        updateToolButtonsHighlight("Scroll");
    } else if (tool === "Clear") {
        clearMask(state);
    }
}

function onPanMouseDown(e) {
    const state = getNodeState(GP.baseNode.id);
    if (!state || !state.centralPanel) return;

    
    if (state.currentTool !== "Scroll") return;
    if (e.button !== 0) return;

    e.preventDefault();

    state.isPanning = true;
    state.panStartX = e.clientX;
    state.panStartY = e.clientY;
    state.panScrollLeft = state.centralPanel.scrollLeft;
    state.panScrollTop = state.centralPanel.scrollTop;
}

function onPanMouseMove(e) {
    const state = getNodeState(GP.baseNode.id);
    if (!state || !state.centralPanel || !state.isPanning) return;

    e.preventDefault();

    const dx = e.clientX - state.panStartX;
    const dy = e.clientY - state.panStartY;

    state.centralPanel.scrollLeft = state.panScrollLeft - dx;
    state.centralPanel.scrollTop = state.panScrollTop - dy;
}

function onPanMouseUp(e) {
    const state = getNodeState(GP.baseNode.id);
    if (!state) return;
    state.isPanning = false;
}

//Automask

function applyAutoMask(state, modeIndex) {
    const canvas = state.maskCanvas;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return;

    
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";

    
    const RED = "rgba(255,0,0,1)";
    const GREEN = "rgba(0,255,0,1)";
    const BLUE = "rgba(0,0,255,1)";

    if (modeIndex === 0) {
        
        const mid = w / 2;
        ctx.fillStyle = RED;
        ctx.fillRect(0, 0, mid, h);
        ctx.fillStyle = GREEN;
        ctx.fillRect(mid, 0, w - mid, h);
    } else if (modeIndex === 1) {
        
        const x1 = w / 3;
        ctx.fillStyle = RED;
        ctx.fillRect(0, 0, x1, h);
        ctx.fillStyle = GREEN;
        ctx.fillRect(x1, 0, w - x1, h);
    } else if (modeIndex === 2) {
        
        const x2 = (w * 2) / 3;
        ctx.fillStyle = RED;
        ctx.fillRect(0, 0, x2, h);
        ctx.fillStyle = GREEN;
        ctx.fillRect(x2, 0, w - x2, h);
    } else if (modeIndex === 3) {
        
        const step = w / 3;
        ctx.fillStyle = RED;
        ctx.fillRect(0, 0, step, h);
        ctx.fillStyle = GREEN;
        ctx.fillRect(step, 0, step, h);
        ctx.fillStyle = BLUE;
        ctx.fillRect(step * 2, 0, w - step * 2, h);
    }
}



/**
 * Регистрация обработчиков.
 * scopeElement — это dialog, который создаётся в _ui.
 */
export function registerKeyHandlers(scopeElement) {
    const state = getNodeState(GP.baseNode.id);
    if (!state || !scopeElement) return;

    
    window.addEventListener("keydown", onKeyDownStub);
    window.addEventListener("keyup", onKeyUpStub);

    
    const panel = state.centralPanel;
    if (panel) {
        panel.onwheel = (e) => onWheelZoom(e);     // zoom
        panel.onmousedown = onPanMouseDown;        // hand-pan
        panel.onmousemove = onPanMouseMove;
        panel.onmouseup = onPanMouseUp;
        panel.onmouseleave = onPanMouseUp;
    }

    
    const mask = state.maskCanvas;
    if (mask) {
        mask.onmousedown = onMaskMouseDown;
        mask.onmousemove = onMaskDraw;
        mask.onmouseup = onMaskMouseUp;
        // mask.onmouseleave = onMaskMouseUp;
        mask.onmouseleave = null;
        mask.oncontextmenu = onMaskContextMenu;
    }

    
    const cont = state.canvasContainer;
    if (cont) {
        cont.onmousemove = onBrushCursorMove;
        cont.onmouseenter = onBrushCursorEnter;
        cont.onmouseleave = onBrushCursorLeave;
        cont.style.cursor = "none";
    }

    
    const sliders = scopeElement.querySelectorAll('input[type="range"]');

    // Brush size
    if (sliders[0]) {
        const brushSlider = sliders[0];
        state.brushSlider = brushSlider;

        
        if (state.brushSize == null) {
            state.brushSize = clampBrushSize(parseInt(brushSlider.value) || 50);
        } else {
            brushSlider.value = String(clampBrushSize(state.brushSize));
            brushSlider.dispatchEvent(new Event("input", { bubbles: true }));
        }

        brushSlider.oninput = (ev) => {
            const s = getNodeState(GP.baseNode.id);
            if (!s) return;
            let v = parseInt(ev.target.value) || 1;
            v = clampBrushSize(v);
            s.brushSize = v;

            if (s.lastCursorClientX != null && s.lastCursorClientY != null) {
                updateBrushCursor({
                    clientX: s.lastCursorClientX,
                    clientY: s.lastCursorClientY,
                });
            }
        };
    }

    // Opacity
    if (sliders[1]) {
        const opacitySlider = sliders[1];
        state.opacitySlider = opacitySlider;

        if (state.maskOpacity != null && !isNaN(state.maskOpacity)) {
            const v = Math.round(clampMaskOpacity(state.maskOpacity) * 100);
            opacitySlider.value = String(v);
            applyMaskOpacity(state);
        } else {
            let initVal = parseInt(opacitySlider.value);
            if (isNaN(initVal) || initVal <= 0) initVal = 100;
            state.maskOpacity = clampMaskOpacity(initVal / 100);
            applyMaskOpacity(state);
        }

        opacitySlider.oninput = (ev) => {
            const s = getNodeState(GP.baseNode.id);
            if (!s) return;
            let v = parseInt(ev.target.value);
            if (isNaN(v)) v = 100;
            v = Math.max(0, Math.min(v, 100));
            s.maskOpacity = clampMaskOpacity(v / 100);
            applyMaskOpacity(s);
        };
    }

    
    if (state.helpIcon && state.helpPanel) {
        state.helpIcon.onclick = () => {
            state.helpPanel.style.display = "flex";
        };
    }

    if (state.helpCloseBtn && state.helpPanel) {
        state.helpCloseBtn.onclick = () => {
            state.helpPanel.style.display = "none";
        };
    }


    // --- TOOL BUTTONS (Brush / Eraser / Scroll / Clear) ---
    const brushBtn = scopeElement.querySelector('button[data-tool="Brush"]');
    const eraserBtn = scopeElement.querySelector('button[data-tool="Eraser"]');
    const scrollBtn = scopeElement.querySelector('button[data-tool="Scroll"]');
    const clearBtn = scopeElement.querySelector('button[data-tool="Clear"]');

    state.brushBtn = brushBtn || null;
    state.eraseBtn = eraserBtn || null;
    state.scrollBtn = scrollBtn || null;
    state.clearBtn = clearBtn || null;

    if (brushBtn) brushBtn.onclick = onToolButtonClick;
    if (eraserBtn) eraserBtn.onclick = onToolButtonClick;
    if (scrollBtn) scrollBtn.onclick = onToolButtonClick;
    if (clearBtn) clearBtn.onclick = onToolButtonClick;

    
    if (!state.currentTool) {
        state.currentTool = "Brush";
    }
    updateToolButtonsHighlight(state.currentTool);

    
    if (state.colorButtons && Array.isArray(state.colorButtons)) {
        state.colorButtons.forEach((btn, idx) => {
            btn.onclick = () => {
                const s = getNodeState(GP.baseNode.id);
                if (!s) return;

                s.drawColor = idx;
                updateSelectedColorUI(idx);

                // console.log("[RGBYP] Color selected by click:", idx);
            };
        });
    }

    // --- AUTO MASK BUTTONS (Half / 1:2 / 2:1 / Thirds) ---
    const autoHalfBtn = scopeElement.querySelector('button[data-tool="Half"]');
    const auto1to2Btn = scopeElement.querySelector('button[data-tool="1 to 2"]');
    const auto2to1Btn = scopeElement.querySelector('button[data-tool="2 to 1"]');
    const autoThirdsBtn = scopeElement.querySelector('button[data-tool="Thirds"]');

    if (autoHalfBtn) {
        autoHalfBtn.onclick = () => {
            const s = getNodeState(GP.baseNode.id);
            if (!s) return;
            s.currentAutoMaskIndex = 0;
            applyAutoMask(s, 0);
        };
    }

    if (auto1to2Btn) {
        auto1to2Btn.onclick = () => {
            const s = getNodeState(GP.baseNode.id);
            if (!s) return;
            s.currentAutoMaskIndex = 1;
            applyAutoMask(s, 1);
        };
    }

    if (auto2to1Btn) {
        auto2to1Btn.onclick = () => {
            const s = getNodeState(GP.baseNode.id);
            if (!s) return;
            s.currentAutoMaskIndex = 2;
            applyAutoMask(s, 2);
        };
    }

    if (autoThirdsBtn) {
        autoThirdsBtn.onclick = () => {
            const s = getNodeState(GP.baseNode.id);
            if (!s) return;
            s.currentAutoMaskIndex = 3;
            applyAutoMask(s, 3);
        };
    }

    const saveBtn = scopeElement.querySelector('button[data-tool="Save"]');
    if (saveBtn) {
        state.saveBtn = saveBtn;
        saveBtn.onclick = async(e) => {
            e.preventDefault();
            e.stopPropagation();

            try {
                await saveMask();
                updatePreview();
            } catch (err) {
                console.error("[RGBYP] saveMask error on button click:", err);
            }
            closeEditor();
        };
    }

}

/**
 * Снятие обработчиков при закрытии редактора.
 */
export function unregisterKeyHandlers(scopeElement) {
    window.removeEventListener("keydown", onKeyDownStub);
    window.removeEventListener("keyup", onKeyUpStub);

    
    
}

