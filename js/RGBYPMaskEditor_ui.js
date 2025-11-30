import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { dataURLtoFile } from "./RGBYPMaskEditor_io.js";

let lastBrushSize = 50;
let lastBrushColor = [255, 0, 0];
let lastMaskOpacity = 75;

let extensionBaseUrl = "";
(function findExtensionBase() {
    const scripts = document.getElementsByTagName("script");
    for (const s of scripts) {
        if (!s.src) continue;
        if (s.src.includes("RGBYPMaskEditor.js")) {
            const url = new URL(s.src, window.location.origin);
            extensionBaseUrl = url.href.replace(/RGBYPMaskEditor\.js.*$/i, "");
            break;
        }
    }
})();

function makeIconButton(iconName, altText) {
    const btn = document.createElement("button");
    btn.style.padding = "0px";
    btn.style.cursor = "pointer";
    btn.style.borderRadius = "4px";
    btn.style.border = "1px solid #555";
    btn.style.background = "#333";
    btn.style.color = "#fff";
    btn.style.fontSize = "12px";
    btn.style.display = "flex";
    btn.style.alignItems = "center";
    btn.style.justifyContent = "center";
    btn.style.width = "60px";
    btn.style.height = "60px";
    btn.title = altText;

    const img = document.createElement("img");
    img.src = extensionBaseUrl + iconName;
    img.alt = altText;
    img.style.maxWidth = "100%";
    img.style.maxHeight = "100%";
    img.style.objectFit = "contain";

    btn.appendChild(img);
    return btn;
}

export function openMaskEditor(node, imageWidget, imageInfo) {
    const originalFilename = imageWidget?.value || imageInfo?.filename || "rgbyp.png";

    function getGraphImageKey() {
        const v = imageWidget?.value || imageInfo?.filename || "";
        return v == null ? "" : String(v);
    }

    function stripExt(name) {
        const s = (name == null) ? "" : String(name);
        const m = s.match(/^(.*)\.(png|jpg|jpeg|webp|bmp|gif)$/i);
        return m ? m[1] : s;
        /*
                        const m = name.match(/^(.*)\.(png|jpg|jpeg|webp|bmp|gif)$/i);
                        return m ? m[1] : name;
        */
    }

    let baseFilename;
    let compositeFilename;
    let maskFilename;
    let baseNameNoExt;

    const mRgb = originalFilename.match(/^(.*)__rgbyp\.png$/i);
    if (mRgb) {
        baseFilename = mRgb[1];
        baseNameNoExt = stripExt(baseFilename);
        compositeFilename = originalFilename;
    } else {
        baseFilename = originalFilename;
        baseNameNoExt = stripExt(baseFilename);
        compositeFilename = baseFilename + "__rgbyp.png";
    }
    maskFilename = baseNameNoExt + "__rgbyp_mask.png";

    const imgType = imageWidget?.image_type || imageInfo?.type || "input";
    const imgSubfolder = imageWidget?.dir || imageInfo?.subfolder || "";

    // Картинка из самой ноды (любая нода, своя или чужая)
    function getNodeInputImage() {
        const filename = imageWidget?.value || imageInfo?.filename || "";
        const type = imageWidget?.image_type || "input";   // ← так
        const subfolder = imageWidget?.dir || "";

        const params = new URLSearchParams({ filename, type, subfolder });
        params.append("_t", Date.now()); // анти-кэш

        return `/view?${params.toString()}`;
    }

    // Ключ для запоминания, какая картинка была при сохранении маски
    function getNodeImageKey() {
        const filename = imageWidget?.value || imageInfo?.filename || "";
        const type = imageWidget?.image_type || imageInfo?.type || "";
        const subfolder = imageWidget?.dir || imageInfo?.subfolder || "";
        return `${type}|${subfolder}|${filename}`;
    }

    const currentImageKey = getNodeImageKey();
    const lastImageKey = node.properties?.rgbyp_last_image_key || null;

    const uniqueId = node.properties?.["unique_id"] || node.id || Date.now().toString();
    const tempMaskFilename = `RGBYP_${uniqueId}_mask.png`;
    const metaFilename = `RGBYP_${uniqueId}_meta.json`;

    const maskSrc = `/view?filename=${encodeURIComponent(
        tempMaskFilename
    )}&type=temp&_rgbyp=${Date.now()}`;
    let dynamicMaskSrc = maskSrc;

    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.width = "100vw";
    overlay.style.height = "100vh";
    overlay.style.background = "rgba(0,0,0,0.7)";
    overlay.style.zIndex = "9999";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.fontFamily = "sans-serif";

    const windowDiv = document.createElement("div");
    windowDiv.style.position = "relative";
    windowDiv.style.display = "flex";
    windowDiv.style.background = "#222";
    windowDiv.style.borderRadius = "8px";
    windowDiv.style.boxShadow = "0 0 20px rgba(0,0,0,0.8)";
    windowDiv.style.padding = "10px";
    windowDiv.style.gap = "10px";
    windowDiv.style.width = "90vw";
    windowDiv.style.height = "90vh";
    windowDiv.style.maxWidth = "90vw";
    windowDiv.style.maxHeight = "90vh";
    windowDiv.style.boxSizing = "border-box";
    windowDiv.style.overflow = "hidden";

    let keyHandler = null;
    let keyUpHandler = null;
    const resizeHandler = () => resizeCursorCanvasToMask();

    const closeEditor = () => {
        if (keyHandler) window.removeEventListener("keydown", keyHandler);
        if (keyUpHandler) window.removeEventListener("keyup", keyUpHandler);
        window.removeEventListener("resize", resizeHandler);
        if (overlay.parentNode) {
            document.body.removeChild(overlay);
        }
    };

    const closeBtn = document.createElement("div");
    closeBtn.textContent = "✕";
    closeBtn.style.position = "absolute";
    closeBtn.style.top = "4px";
    closeBtn.style.right = "8px";
    closeBtn.style.cursor = "pointer";
    closeBtn.style.color = "#fff";
    closeBtn.style.fontSize = "18px";
    closeBtn.style.zIndex = "2";
    closeBtn.addEventListener("click", () => {
        closeEditor();
    });

    const toolsPanel = document.createElement("div");
    toolsPanel.style.display = "flex";
    toolsPanel.style.flexDirection = "column";
    toolsPanel.style.gap = "8px";
    toolsPanel.style.padding = "5px 5px";
    toolsPanel.style.background = "#333";
    toolsPanel.style.borderRadius = "6px";
    toolsPanel.style.alignItems = "center";
    toolsPanel.style.minWidth = "70px";
    toolsPanel.style.width = "70px";
    toolsPanel.style.maxWidth = "70px";
    toolsPanel.style.flex = "0 0 70px";

    const toolsTitle = document.createElement("div");
    toolsTitle.textContent = "Tools";
    toolsTitle.style.color = "#ddd";
    toolsTitle.style.fontSize = "12px";
    toolsTitle.style.textAlign = "center";
    toolsTitle.style.marginBottom = "4px";

    const toolsSpacer = document.createElement("div");
    toolsSpacer.style.height = "100%";

    const brushBtn = makeIconButton("/extensions/ComfyUI-RGBYP-Mask-Editor/i_brush.png", "Brush");
    const eraserBtn = makeIconButton("/extensions/ComfyUI-RGBYP-Mask-Editor/i_erase.png", "Eraser");
    const scrollBtn = makeIconButton("/extensions/ComfyUI-RGBYP-Mask-Editor/i_scroll.png", "Scroll");
    const clearBtn = makeIconButton("/extensions/ComfyUI-RGBYP-Mask-Editor/i_clear.png", "Clear");

    let currentTool = "brush";
    let currentColor = Array.isArray(lastBrushColor) ? [...lastBrushColor] : [255, 0, 0];

    function updateToolButtons() {
        brushBtn.style.background = currentTool === "brush" ? "#777" : "#333";
        eraserBtn.style.background = currentTool === "eraser" ? "#777" : "#333";
        scrollBtn.style.background = currentTool === "scroll" ? "#777" : "#333";

        if ((currentTool === "scroll" || panMode) && !isPanningDrag && isPointerOverCanvas) {
            maskCanvas.style.cursor = "grab";
        } else if (!isPanningDrag) {
            maskCanvas.style.cursor = "none";
        }
    }

    brushBtn.addEventListener("click", () => {
        currentTool = "brush";
        panMode = false;
        updateToolButtons();
    });

    eraserBtn.addEventListener("click", () => {
        currentTool = "eraser";
        panMode = false;
        updateToolButtons();
    });

    scrollBtn.addEventListener("click", () => {
        currentTool = "scroll";
        panMode = true;
        updateToolButtons();
    });

    toolsPanel.appendChild(toolsTitle);
    toolsPanel.appendChild(brushBtn);
    toolsPanel.appendChild(eraserBtn);
    toolsPanel.appendChild(scrollBtn);
    toolsPanel.appendChild(toolsSpacer);
    toolsPanel.appendChild(clearBtn);

    const canvasContainer = document.createElement("div");
    canvasContainer.style.flex = "1 1 auto";
    canvasContainer.style.display = "block";
    canvasContainer.style.alignItems = "center";
    canvasContainer.style.textAlign = "center";
    canvasContainer.style.justifyContent = "center";
    canvasContainer.style.background = "#111";
    canvasContainer.style.borderRadius = "6px";
    canvasContainer.style.overflow = "scroll"; // scrollbars always visible, no UI jump
    canvasContainer.style.position = "relative";
    canvasContainer.style.height = "100%";
    canvasContainer.style.maxWidth = "100%";
    canvasContainer.style.maxHeight = "100%";
 
    const maskCanvas = document.createElement("canvas");
    const maskCtx = maskCanvas.getContext("2d");
    maskCanvas.style.cursor = "none";
    maskCanvas.style.display = "block";
    maskCanvas.style.position = "absolute";
    maskCanvas.style.left = "50%";
    maskCanvas.style.top = "50%";
    maskCanvas.style.transform = "translate(-50%, -50%)";

    const cursorCanvas = document.createElement("canvas");
    const cursorCtx = cursorCanvas.getContext("2d");
    cursorCanvas.style.display = "block";
    cursorCanvas.style.position = "absolute";
    cursorCanvas.style.left = "50%";
    cursorCanvas.style.top = "50%";
    cursorCanvas.style.transform = "translate(-50%, -50%)";
    // cursorCanvas.style.verticalAlign = "middle";
    cursorCanvas.style.pointerEvents = "none";

    canvasContainer.appendChild(maskCanvas);
    canvasContainer.appendChild(cursorCanvas);

    let currentZoom = 1;
    // позволяем уменьшать до 10% исходного размера
    const MIN_ZOOM = 0.1;
    const MAX_ZOOM = 3;

    let isPointerOverCanvas = false;
    let panMode = false;
    let spacePanActive = false;
    let isPanningDrag = false;
    let panStartX = 0;
    let panStartY = 0;
    let panScrollLeft = 0;
    let panScrollTop = 0;

    updateToolButtons();

    canvasContainer.addEventListener("mouseenter", () => {
        isPointerOverCanvas = true;
        if (panMode && !isPanningDrag) {
            maskCanvas.style.cursor = "grab";
        }
    });

    canvasContainer.addEventListener("mouseleave", () => {
        isPointerOverCanvas = false;
        if (!isPanningDrag && currentTool !== "scroll") {
            panMode = false;
            maskCanvas.style.cursor = "none";
        }
    });

    canvasContainer.addEventListener(
        "wheel",
        (e) => {
            e.preventDefault();
            const rect = canvasContainer.getBoundingClientRect();
            let clientX = e.clientX;
            let clientY = e.clientY;

            const targetIsCanvas = e.target === maskCanvas || e.target === cursorCanvas;
            if (!targetIsCanvas) {
                clientX = rect.left + rect.width / 2;
                clientY = rect.top + rect.height / 2;
                // console.log("Wheel event not on canvas, using center point");
            }

            handleZoom(e.deltaY, clientX, clientY);
        },
        { passive: false }
    );

    const rightPanel = document.createElement("div");
    rightPanel.style.display = "flex";
    rightPanel.style.flexDirection = "column";
    rightPanel.style.gap = "8px";
    rightPanel.style.padding = "5px 8px";
    rightPanel.style.background = "#333";
    rightPanel.style.borderRadius = "6px";
    rightPanel.style.width = "185px";
    // rightPanel.style.minWidth = "220px";
    // rightPanel.style.maxWidth = "220px";
    // rightPanel.style.flex = "0 0 220px";

    const rightTitle = document.createElement("div");
    rightTitle.textContent = "RGBYP Mask";
    rightTitle.style.color = "#ddd";
    rightTitle.style.fontSize = "12px";
    rightTitle.style.textAlign = "center";
    rightTitle.style.marginBottom = "4px";

    const colorsLabel = document.createElement("div");
    colorsLabel.textContent = "Colors";
    colorsLabel.style.color = "#ccc";
    colorsLabel.style.fontSize = "12px";

    const colorsRow = document.createElement("div");
    colorsRow.style.display = "flex";
    colorsRow.style.flexWrap = "wrap";
    colorsRow.style.gap = "4px";

    const colorList = [
        { name: "R", color: [255, 0, 0] },
        { name: "G", color: [0, 255, 0] },
        { name: "B", color: [0, 0, 255] },
        { name: "Y", color: [255, 255, 0] },
        { name: "P", color: [255, 0, 255] },
    ];

    function rgbToCss(c) {
        return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }

    function colorsEqual(a, b) {
        return (
            Array.isArray(a) &&
            Array.isArray(b) &&
            a[0] === b[0] &&
            a[1] === b[1] &&
            a[2] === b[2]
        );
    }

    const colorSwatches = [];

    colorList.forEach((c) => {
        const sw = document.createElement("div");
        sw.style.width = "30px";
        sw.style.height = "30px";
        sw.style.borderRadius = "4px";
        sw.style.background = rgbToCss(c.color);
        sw.style.cursor = "pointer";
        sw.style.border = colorsEqual(c.color, currentColor)
            ? "2px solid #000"
            : "2px solid transparent";
        sw.title = c.name;

        sw.addEventListener("click", () => {
            currentColor = c.color;
            lastBrushColor = c.color;
            colorSwatches.forEach((s) => (s.style.border = "2px solid transparent"));
            sw.style.border = "2px solid #000";
        });

        colorSwatches.push(sw);
        colorsRow.appendChild(sw);
    });

    const sizeLabel = document.createElement("div");
    sizeLabel.textContent = "Brush size";
    sizeLabel.style.color = "#ccc";
    sizeLabel.style.fontSize = "12px";

    const sizeRow = document.createElement("div");
    sizeRow.style.display = "flex";
    sizeRow.style.alignItems = "center";
    sizeRow.style.gap = "6px";

    const sizeInput = document.createElement("input");
    sizeInput.type = "range";
    sizeInput.min = "1";
    sizeInput.max = "300";
    sizeInput.value = String(lastBrushSize || 50);

    const sizeValue = document.createElement("div");
    sizeValue.textContent = sizeInput.value;
    sizeValue.style.color = "#ddd";
    sizeValue.style.fontSize = "12px";
    sizeValue.style.minWidth = "24px";

    sizeInput.addEventListener("input", () => {
        sizeValue.textContent = sizeInput.value;
        lastBrushSize = parseFloat(sizeInput.value) || 50;
    });

    const opacityLabel = document.createElement("div");
    opacityLabel.textContent = "Opacity";
    opacityLabel.style.color = "#ccc";
    opacityLabel.style.fontSize = "12px";

    const opacityRow = document.createElement("div");
    opacityRow.style.display = "flex";
    opacityRow.style.alignItems = "center";
    opacityRow.style.gap = "6px";

    const opacityInput = document.createElement("input");
    opacityInput.type = "range";
    opacityInput.min = "1";
    opacityInput.max = "100";
    opacityInput.value = String(lastMaskOpacity || 100);

    const opacityValue = document.createElement("div");
    opacityValue.textContent = opacityInput.value;
    opacityValue.style.color = "#ddd";
    opacityValue.style.fontSize = "12px";
    opacityValue.style.minWidth = "24px";

    opacityInput.addEventListener("input", () => {
        opacityValue.textContent = opacityInput.value;
        lastMaskOpacity = parseFloat(opacityInput.value) || 100;
        redraw();
    });

    sizeRow.appendChild(sizeInput);
    sizeRow.appendChild(sizeValue);

    opacityRow.appendChild(opacityInput);
    opacityRow.appendChild(opacityValue);

    const autoButtonsRow = document.createElement("div");
    autoButtonsRow.style.display = "flex";
    autoButtonsRow.style.flexDirection = "row";
    autoButtonsRow.style.gap = "4px";
    autoButtonsRow.style.marginTop = "4px";
    autoButtonsRow.style.justifyContent = "space-between";

    const autoHalfBtn = makeIconButton(
        "/extensions/ComfyUI-RGBYP-Mask-Editor/i_d_11.png",
        "autoMaskSplitHalf"
    );
    const auto1to2Btn = makeIconButton(
        "/extensions/ComfyUI-RGBYP-Mask-Editor/i_d_12.png",
        "autoMaskSplit1to2"
    );
    const auto2to1Btn = makeIconButton(
        "/extensions/ComfyUI-RGBYP-Mask-Editor/i_d_21.png",
        "autoMaskSplit2to1"
    );
    const autoThirdsBtn = makeIconButton(
        "/extensions/ComfyUI-RGBYP-Mask-Editor/i_d_111.png",
        "autoMaskSplitThirds"
    );

    autoHalfBtn.style.width = "32px";
    autoHalfBtn.style.height = "32px";
    auto1to2Btn.style.width = "32px";
    auto1to2Btn.style.height = "32px";
    auto2to1Btn.style.width = "32px";
    auto2to1Btn.style.height = "32px";
    autoThirdsBtn.style.width = "32px";
    autoThirdsBtn.style.height = "32px";

    autoButtonsRow.appendChild(autoHalfBtn);
    autoButtonsRow.appendChild(auto1to2Btn);
    autoButtonsRow.appendChild(auto2to1Btn);
    autoButtonsRow.appendChild(autoThirdsBtn);

    const rightPanelSpacer = document.createElement("div");
    rightPanelSpacer.style.height = "100%";

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "SAVE";
    saveBtn.style.marginTop = "8px";
    saveBtn.style.padding = "6px";
    saveBtn.style.cursor = "pointer";
    saveBtn.style.borderRadius = "4px";
    saveBtn.style.border = "1px solid #88ff88";
    saveBtn.style.background = "#2a4";
    saveBtn.style.color = "#fff";
    saveBtn.style.fontWeight = "bold";
    saveBtn.style.fontSize = "13px";

    const rightPanelSpacerSmall1 = document.createElement("div");
    rightPanelSpacerSmall1.style.height = "20px";
    const rightPanelSpacerSmall2 = document.createElement("div");
    rightPanelSpacerSmall2.style.height = "20px";

    rightPanel.appendChild(rightTitle);
    rightPanel.appendChild(colorsLabel);
    rightPanel.appendChild(colorsRow);
    rightPanel.appendChild(rightPanelSpacerSmall1);
    rightPanel.appendChild(sizeLabel);
    rightPanel.appendChild(sizeRow);
    rightPanel.appendChild(opacityLabel);
    rightPanel.appendChild(opacityRow);
    rightPanel.appendChild(rightPanelSpacerSmall2);
    rightPanel.appendChild(autoButtonsRow);
    rightPanel.appendChild(rightPanelSpacer);
    rightPanel.appendChild(saveBtn);

    windowDiv.appendChild(closeBtn);
    windowDiv.appendChild(toolsPanel);
    windowDiv.appendChild(canvasContainer);
    windowDiv.appendChild(rightPanel);

    overlay.appendChild(windowDiv);
    document.body.appendChild(overlay);

    const baseImg = new Image();
    baseImg.crossOrigin = "anonymous";

    const maskImg = new Image();
    maskImg.crossOrigin = "anonymous";

    let maskBuffer = document.createElement("canvas");
    let maskBufferCtx = maskBuffer.getContext("2d");

    function clearMaskBuffer(redrawAfter = true) {
        if (maskBufferCtx && maskBuffer) {
            maskBufferCtx.clearRect(0, 0, maskBuffer.width, maskBuffer.height);
            if (redrawAfter) redraw();
        }
    }

    function autoMaskSplitHalf() {
        if (!maskBuffer || !maskBufferCtx) return;
        const w = maskBuffer.width;
        const h = maskBuffer.height;
        if (!w || !h) return;

        clearMaskBuffer(false);

        const half = w / 2;
        maskBufferCtx.fillStyle = rgbToCss([255, 0, 0]);
        maskBufferCtx.fillRect(0, 0, half, h);
        maskBufferCtx.fillStyle = rgbToCss([0, 255, 0]);
        maskBufferCtx.fillRect(half, 0, w - half, h);

        redraw();
    }

    function autoMaskSplit1to2() {
        if (!maskBuffer || !maskBufferCtx) return;
        const w = maskBuffer.width;
        const h = maskBuffer.height;
        if (!w || !h) return;

        clearMaskBuffer(false);

        const third = w / 3;

        maskBufferCtx.fillStyle = rgbToCss([255, 0, 0]);
        maskBufferCtx.fillRect(0, 0, third, h);
        maskBufferCtx.fillStyle = rgbToCss([0, 255, 0]);
        maskBufferCtx.fillRect(third, 0, w - third, h);

        redraw();
    }

    function autoMaskSplit2to1() {
        if (!maskBuffer || !maskBufferCtx) return;
        const w = maskBuffer.width;
        const h = maskBuffer.height;
        if (!w || !h) return;

        clearMaskBuffer(false);

        const third = w / 3;
        const twoThirds = 2 * third;

        maskBufferCtx.fillStyle = rgbToCss([255, 0, 0]);
        maskBufferCtx.fillRect(0, 0, twoThirds, h);
        maskBufferCtx.fillStyle = rgbToCss([0, 255, 0]);
        maskBufferCtx.fillRect(twoThirds, 0, w - twoThirds, h);

        redraw();
    }

    function autoMaskSplitThirds() {
        if (!maskBuffer || !maskBufferCtx) return;
        const w = maskBuffer.width;
        const h = maskBuffer.height;
        if (!w || !h) return;

        clearMaskBuffer(false);

        const third = w / 3;
        const twoThirds = 2 * third;

        maskBufferCtx.fillStyle = rgbToCss([255, 0, 0]);
        maskBufferCtx.fillRect(0, 0, third, h);
        maskBufferCtx.fillStyle = rgbToCss([0, 255, 0]);
        maskBufferCtx.fillRect(third, 0, third, h);
        maskBufferCtx.fillStyle = rgbToCss([0, 0, 255]);
        maskBufferCtx.fillRect(twoThirds, 0, w - twoThirds, h);

        redraw();
    }

    autoHalfBtn.addEventListener("click", () => {
        autoMaskSplitHalf();
    });
    auto1to2Btn.addEventListener("click", () => {
        autoMaskSplit1to2();
    });
    auto2to1Btn.addEventListener("click", () => {
        autoMaskSplit2to1();
    });
    autoThirdsBtn.addEventListener("click", () => {
        autoMaskSplitThirds();
    });

    function resizeCursorCanvasToMask() {
        if (!maskCanvas || !cursorCanvas) return;

        // Берём реальный размер маски на экране
        const rect = maskCanvas.getBoundingClientRect();

        // Внутреннее разрешение курсор-канваса = видимому размеру
        cursorCanvas.width = rect.width;
        cursorCanvas.height = rect.height;
        cursorCanvas.style.width = rect.width + "px";
        cursorCanvas.style.height = rect.height + "px";

        // Позиция и transform такие же, как у maskCanvas
        cursorCanvas.style.left = maskCanvas.style.left;
        cursorCanvas.style.top = maskCanvas.style.top;
        cursorCanvas.style.transform = maskCanvas.style.transform;
    }

function handleZoom(deltaY, clientX, clientY) {
    if (!baseImg.width || !baseImg.height) return;

    const factor = deltaY < 0 ? 1.1 : 0.9;
    let newZoom = currentZoom * factor;

    if (newZoom < MIN_ZOOM) newZoom = MIN_ZOOM;
    if (newZoom > MAX_ZOOM) newZoom = MAX_ZOOM;
    if (newZoom === currentZoom) return;

    const canvasRect = maskCanvas.getBoundingClientRect();
    const oldW = canvasRect.width;
    const oldH = canvasRect.height;

    if (!oldW || !oldH) return;

    // относительная позиция точки зума внутри канваса (0..1)
    const relX = (clientX - canvasRect.left) / oldW;
    const relY = (clientY - canvasRect.top) / oldH;

    const oldZoom = currentZoom;
    currentZoom = newZoom;

    const displayW = baseImg.width * currentZoom;
    const displayH = baseImg.height * currentZoom;

    // меняем размер канваса (зум)
    maskCanvas.style.width = displayW + "px";
    maskCanvas.style.height = displayH + "px";

    // разница размеров до/после зума
    const deltaW = displayW - oldW;
    const deltaH = displayH - oldH;

    // текущий скролл
    const oldScrollLeft = canvasContainer.scrollLeft;
    const oldScrollTop  = canvasContainer.scrollTop;

    // компенсируем изменение размеров так,
    // чтобы точка с relX/relY осталась под той же экранной позицией
    let newScrollLeft = oldScrollLeft + deltaW * (relX - 0.5);
    let newScrollTop  = oldScrollTop  + deltaH * (relY - 0.5);

    const maxScrollX = canvasContainer.scrollWidth - canvasContainer.clientWidth;
    const maxScrollY = canvasContainer.scrollHeight - canvasContainer.clientHeight;

    if (!Number.isFinite(newScrollLeft)) newScrollLeft = 0;
    if (!Number.isFinite(newScrollTop))  newScrollTop  = 0;

    canvasContainer.scrollLeft = Math.max(0, Math.min(maxScrollX, newScrollLeft));
    canvasContainer.scrollTop  = Math.max(0, Math.min(maxScrollY, newScrollTop));

    resizeCursorCanvasToMask();
}

    function redraw() {
        if (!maskCtx || !maskCanvas) return;

        maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);

        if (baseImg && baseImg.width && baseImg.height) {
            maskCtx.drawImage(baseImg, 0, 0, maskCanvas.width, maskCanvas.height);
        }

        if (maskBuffer) {
            maskCtx.save();
            const alpha = (lastMaskOpacity || 100) / 100.0;
            maskCtx.globalAlpha = alpha;
            maskCtx.drawImage(maskBuffer, 0, 0, maskCanvas.width, maskCanvas.height);
            maskCtx.restore();
        }
    }

    baseImg.onload = () => {
        const w = baseImg.width;
        const h = baseImg.height;

        maskCanvas.width = w;
        maskCanvas.height = h;
        maskBuffer.width = w;
        maskBuffer.height = h;
        maskBufferCtx.clearRect(0, 0, w, h);

        // автофит картинки в видимую область контейнера
        const containerRect = canvasContainer.getBoundingClientRect();
        let fitZoom = 1;

        if (containerRect.width > 0 && containerRect.height > 0) {
            const scaleX = containerRect.width / w;
            const scaleY = containerRect.height / h;
            fitZoom = Math.min(scaleX, scaleY);
        }

        currentZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fitZoom));

        const displayW = w * currentZoom;
        const displayH = h * currentZoom;

        maskCanvas.style.width = displayW + "px";
        maskCanvas.style.height = displayH + "px";
        maskCanvas.style.maxWidth = "none";
        maskCanvas.style.maxHeight = "none";

        const cw = containerRect.width;
        const ch = containerRect.height;
        canvasContainer.scrollLeft = Math.max(0, (displayW - cw) / 2);
        canvasContainer.scrollTop = Math.max(0, (displayH - ch) / 2);

        resizeCursorCanvasToMask();
        setTimeout(() => {
            redraw();
        }, 0);

        if (dynamicMaskSrc) { maskImg.src = dynamicMaskSrc; } else { clearMaskBuffer(true); }
    };
    baseImg.onerror = () => { };

    maskImg.onload = () => {
        try {
            maskBufferCtx.clearRect(0, 0, maskBuffer.width, maskBuffer.height);
            maskBufferCtx.drawImage(maskImg, 0, 0, maskBuffer.width, maskBuffer.height);
            redraw();
        } catch (e) { }
    };

    maskImg.onerror = () => { };

async function resolveBaseSrcFromMeta() {
    try {
        // Запрос meta JSON из temp
        const url = `/view?filename=${encodeURIComponent(
            metaFilename
        )}&type=temp&_t=${Date.now()}`;

        const resp = await api.fetchApi(url, { method: "GET" });

        // Если meta ещё не существует → используем картинку из ноды
        if (!resp.ok) {
            dynamicMaskSrc = "";
            return getNodeInputImage();
        }

        const text = await resp.text();
        let meta;

        try {
            meta = JSON.parse(text);
        } catch (e) {
            // битый JSON → fallback
            dynamicMaskSrc = "";
            return getNodeInputImage();
        }

        //
        // 1️⃣ Проверка соответствия маски текущей картинке
        //
        const metaGraphImage = meta?.graph_image || "";
        const currentGraphImage = getGraphImageKey();

        if (
            metaGraphImage &&
            currentGraphImage &&
            metaGraphImage !== currentGraphImage
        ) {
            // Маска относится к другой картинке → игнорируем её
            dynamicMaskSrc = "";
            return getNodeInputImage();
        }

        //
        // 2️⃣ Загружаем ORIGINAL
        //
        const originalPath = meta?.original || "";
        if (originalPath) {
            const parts = originalPath.split(/[\\/]/);
            const originalName = parts[parts.length - 1];

            const params = new URLSearchParams({
                filename: originalName,
                type: "temp",
                subfolder: "",
            });
            params.append("_rgbyp", Date.now());

            return `/view?${params.toString()}`;
        }

        //
        // 3️⃣ Нет original → fallback к картинке из ноды
        //
        return getNodeInputImage();

    } catch (e) {
        // На любой ошибке — fallback
        dynamicMaskSrc = "";
        return getNodeInputImage();
    }
}

    resolveBaseSrcFromMeta().then((src) => {
        baseImg.src = src;
    });


    clearBtn.addEventListener("click", () => {
        clearMaskBuffer(true);
    });

    let drawing = false;
    let lastX = 0;
    let lastY = 0;
    let tempTool = null;

    let cursorLastScreenX = null;
    let cursorLastScreenY = null;

    function getCanvasPos(evt) {
        const rect = maskCanvas.getBoundingClientRect();
        const x = ((evt.clientX - rect.left) / rect.width) * maskCanvas.width;
        const y = ((evt.clientY - rect.top) / rect.height) * maskCanvas.height;
        return { x, y };
    }

    function clearCursor() {
        cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
        cursorLastScreenX = null;
        cursorLastScreenY = null;
    }

    function drawCursor(arg) {
        if (!maskCanvas || !cursorCanvas) return;
        const rect = maskCanvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        let sx, sy;
        if (arg && typeof arg.clientX === "number") {
            sx = arg.clientX - rect.left;
            sy = arg.clientY - rect.top;
        } else if (arg && typeof arg.x === "number") {
            sx = arg.x;
            sy = arg.y;
        } else {
            return;
        }

        cursorLastScreenX = sx;
        cursorLastScreenY = sy;

        const brushSize = parseFloat(sizeInput.value) || 10;
        const scale = rect.width / maskCanvas.width;
        const radius = (brushSize / 2) * scale;

        cursorCtx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
        cursorCtx.beginPath();
        cursorCtx.arc(sx, sy, radius, 0, Math.PI * 2);
        cursorCtx.strokeStyle = "#ffffff";
        cursorCtx.lineWidth = 1;
        cursorCtx.setLineDash([4, 4]);
        cursorCtx.stroke();
    }

    function startDraw(evt) {
        if (evt.button !== 0 && evt.button !== 2) {
            return;
        }

        if (panMode && evt.button === 0) {
            isPanningDrag = true;
            panStartX = evt.clientX;
            panStartY = evt.clientY;
            panScrollLeft = canvasContainer.scrollLeft;
            panScrollTop = canvasContainer.scrollTop;
            maskCanvas.style.cursor = "grabbing";
            return;
        }

        if (evt.button === 2) {
            evt.preventDefault();
            tempTool = currentTool;
            currentTool = "eraser";
            updateToolButtons();
            const restoreOnce = () => {
                if (tempTool !== null) {
                    currentTool = tempTool;
                    tempTool = null;
                    updateToolButtons();
                }
                window.removeEventListener("mouseup", restoreOnce);
            };
            window.addEventListener("mouseup", restoreOnce);
        }

        drawing = true;
        const pos = getCanvasPos(evt);
        lastX = pos.x;
        lastY = pos.y;
        drawLine(pos.x, pos.y, true);
        drawCursor(evt);
    }

    function stopDraw() {
        if (isPanningDrag) {
            isPanningDrag = false;
            maskCanvas.style.cursor = panMode && isPointerOverCanvas ? "grab" : "none";
            return;
        }
        drawing = false;
    }

    function drawMove(evt) {
        drawCursor(evt);

        if (isPanningDrag) {
            const dx = evt.clientX - panStartX;
            const dy = evt.clientY - panStartY;
            canvasContainer.scrollLeft = panScrollLeft - dx;
            canvasContainer.scrollTop = panScrollTop - dy;
            resizeCursorCanvasToMask();
            return;
        }

        if (!drawing) return;
        const pos = getCanvasPos(evt);
        drawLine(pos.x, pos.y, false);
        lastX = pos.x;
        lastY = pos.y;
    }

    function drawLine(x, y, dotOnly) {
        const size = parseFloat(sizeInput.value) || 10;

        if (currentTool === "eraser") {
            maskBufferCtx.save();
            maskBufferCtx.globalCompositeOperation = "destination-out";
            maskBufferCtx.beginPath();
            if (dotOnly) {
                maskBufferCtx.arc(x, y, size / 2, 0, Math.PI * 2);
                maskBufferCtx.fill();
            } else {
                maskBufferCtx.lineCap = "round";
                maskBufferCtx.lineJoin = "round";
                maskBufferCtx.lineWidth = size;
                maskBufferCtx.moveTo(lastX, lastY);
                maskBufferCtx.lineTo(x, y);
                maskBufferCtx.stroke();
            }
            maskBufferCtx.restore();
        } else {
            maskBufferCtx.save();
            maskBufferCtx.globalCompositeOperation = "source-over";
            maskBufferCtx.strokeStyle = rgbToCss(currentColor);
            maskBufferCtx.fillStyle = rgbToCss(currentColor);
            if (dotOnly) {
                maskBufferCtx.beginPath();
                maskBufferCtx.arc(x, y, size / 2, 0, Math.PI * 2);
                maskBufferCtx.fill();
            } else {
                maskBufferCtx.beginPath();
                maskBufferCtx.lineCap = "round";
                maskBufferCtx.lineJoin = "round";
                maskBufferCtx.lineWidth = size;
                maskBufferCtx.moveTo(lastX, lastY);
                maskBufferCtx.lineTo(x, y);
                maskBufferCtx.stroke();
            }
            maskBufferCtx.restore();
        }

        redraw();
    }

    maskCanvas.addEventListener("mousedown", startDraw);
    maskCanvas.addEventListener("mousemove", drawMove);
    maskCanvas.addEventListener("mouseup", stopDraw);
    maskCanvas.addEventListener("mouseleave", () => {
        stopDraw();
        clearCursor();
    });

    maskCanvas.addEventListener("contextmenu", (e) => {
        e.preventDefault();
    });

    maskCanvas.addEventListener(
        "touchstart",
        (e) => {
            e.preventDefault();
            const t = e.touches[0];
            resizeCursorCanvasToMask();
            startDraw(t);
        },
        { passive: false }
    );

    maskCanvas.addEventListener(
        "touchmove",
        (e) => {
            e.preventDefault();
            const t = e.touches[0];
            drawMove(t);
        },
        { passive: false }
    );

    maskCanvas.addEventListener(
        "touchend",
        (e) => {
            e.preventDefault();
            stopDraw();
            clearCursor();
        },
        { passive: false }
    );

    keyHandler = (e) => {
        if (e.code === "Space") {
            if (isPointerOverCanvas) {
                spacePanActive = true;
                panMode = true;
                if (!isPanningDrag) {
                    maskCanvas.style.cursor = "grab";
                }
            }
            e.preventDefault();
            return;
        }
        if (e.code === "KeyZ" && e.shiftKey) {
            const rect = canvasContainer.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            handleZoom(100, cx, cy);
            e.preventDefault();
            return;
        }
        if (e.code === "KeyX" && e.shiftKey) {
            const rect = canvasContainer.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            handleZoom(-100, cx, cy);
            e.preventDefault();
            return;
        }

        if (e.key >= "1" && e.key <= "5") {
            const idx = parseInt(e.key, 10) - 1;
            if (colorList[idx]) {
                currentColor = colorList[idx].color;
                lastBrushColor = colorList[idx].color;
                colorSwatches.forEach((s, i) => {
                    s.style.border = i === idx ? "2px solid #000" : "2px solid transparent";
                });
                e.preventDefault();
            }
            return;
        }

        if (e.key === "Escape") {
            closeEditor();
            e.preventDefault();
            return;
        }

        if (e.key === "Enter") {
            saveBtn.click();
            e.preventDefault();
            return;
        }

        if (e.code === "KeyN" && e.shiftKey) {
            clearMaskBuffer(true);
            e.preventDefault();
            return;
        }

        if (e.code === "KeyA" && e.shiftKey) {
            let v = parseFloat(sizeInput.value) || 1;
            let step;
            if (v <= 20) step = 1;
            else if (v <= 100) step = 3;
            else step = 5;
            v = Math.max(1, v - step);
            sizeInput.value = String(v);
            sizeValue.textContent = sizeInput.value;
            lastBrushSize = v;

            if (cursorLastScreenX !== null && cursorLastScreenY !== null) {
                drawCursor({ x: cursorLastScreenX, y: cursorLastScreenY });
            }

            e.preventDefault();
            return;
        }

        if (e.code === "KeyD" && e.shiftKey) {
            let v = parseFloat(sizeInput.value) || 1;
            let step;
            if (v <= 20) step = 1;
            else if (v <= 100) step = 3;
            else step = 5;
            v = Math.max(1, v + step);
            sizeInput.value = String(v);
            sizeValue.textContent = sizeInput.value;
            lastBrushSize = v;

            if (cursorLastScreenX !== null && cursorLastScreenY !== null) {
                drawCursor({ x: cursorLastScreenX, y: cursorLastScreenY });
            }

            e.preventDefault();
            return;
        }

        if (e.code === "KeyW" && e.shiftKey) {
            let v = parseFloat(opacityInput.value) || 1;
            v = Math.min(100, v + 5);
            opacityInput.value = String(v);
            opacityValue.textContent = opacityInput.value;
            lastMaskOpacity = v;
            redraw();
            e.preventDefault();
            return;
        }

        if (e.code === "KeyS" && e.shiftKey) {
            let v = parseFloat(opacityInput.value) || 1;
            v = Math.max(1, v - 5);
            opacityInput.value = String(v);
            opacityValue.textContent = opacityInput.value;
            lastMaskOpacity = v;
            redraw();
            e.preventDefault();
            return;
        }
    };

    keyUpHandler = (e) => {
        if (e.code === "Space") {
            spacePanActive = false;
            panMode = false;

            if (!isPanningDrag) {
                maskCanvas.style.cursor = "none";
            }

            updateToolButtons();
        }
    };

    window.addEventListener("keydown", keyHandler);
    window.addEventListener("keyup", keyUpHandler);
    window.addEventListener("resize", resizeHandler);

    saveBtn.addEventListener("click", async () => {
        if (!baseImg.width || !baseImg.height) {
            alert("Base image has not been loaded yet.");
            return;
        }

        const uniqueId = node.properties?.["unique_id"] || node.id || Date.now().toString();
        const prefix = `RGBYP_${uniqueId}_`;
        const tempType = "temp";

        const compositeFilename = `${prefix}composite.png`;
        const maskFilename2 = `${prefix}mask.png`;

        const finalCanvas = document.createElement("canvas");
        finalCanvas.width = baseImg.width;
        finalCanvas.height = baseImg.height;
        const finalCtx = finalCanvas.getContext("2d");
        finalCtx.drawImage(baseImg, 0, 0);

        const compositeAlpha = (lastMaskOpacity || 100) / 100.0;
        finalCtx.save();
        finalCtx.globalAlpha = compositeAlpha;
        finalCtx.drawImage(maskBuffer, 0, 0);
        finalCtx.restore();
        // finalCtx.drawImage(maskBuffer, 0, 0);

        const compositeDataUrl = finalCanvas.toDataURL("image/png");
        const maskDataUrl = maskBuffer.toDataURL("image/png");

        let uploadedCompositeName = compositeFilename;

        try {
            const compFile = dataURLtoFile(compositeDataUrl, compositeFilename);
            const compForm = new FormData();
            compForm.append("image", compFile);
            compForm.append("type", tempType);
            compForm.append("overwrite", "true");

            const compResp = await api.fetchApi("/upload/image", {
                method: "POST",
                body: compForm,
            });

            if (compResp.ok) {
                const cj = await compResp.json();
                uploadedCompositeName = cj.name || compositeFilename;
            }
        } catch (e) { }

        try {
            const maskFile = dataURLtoFile(maskDataUrl, maskFilename2);
            const maskForm = new FormData();
            maskForm.append("image", maskFile);
            maskForm.append("type", tempType);
            maskForm.append("overwrite", "true");

            await api.fetchApi("/upload/image", {
                method: "POST",
                body: maskForm,
            });
        } catch (e) { }

        const viewUrl = `/view?filename=${encodeURIComponent(
            uploadedCompositeName
        )}&type=temp&_t=${Date.now()}`;

        if (!node.imgs) node.imgs = [];
        if (node.imgs.length === 0) {
            node.imgs.push({ src: viewUrl });
        } else {
            node.imgs[0].src = viewUrl;
        }

        if (node.image instanceof Image) {
            node.image.src = viewUrl;
        }
        const randomValue = lastMaskOpacity + (Math.random() * 0.002) - 0.001;

        if (node.widgets && Array.isArray(node.widgets)) {
            const w = node.widgets.find(w => w.name === "updater");
            if (w) {
                w.value = randomValue;

                if (!node.properties) node.properties = {};
                node.properties["updater"] = randomValue;

                if (typeof node.onPropertyChanged === "function") {
                    node.onPropertyChanged("updater", randomValue);
                }
            }
        }

        // запоминаем, с какой картинкой была сохранена маска
        if (!node.properties) node.properties = {};
        node.properties.rgbyp_last_image_key = getNodeImageKey();

        node.setDirtyCanvas?.(true, true);
        app.graph.setDirtyCanvas(true, true);
        node.graph?.change?.();

        closeEditor();
    });
}
