import { registerKeyHandlers, unregisterKeyHandlers } from "./RGBYPMaskEditor_keys.js";
import { initBaseImageAndCanvas } from "./RGBYPMaskEditor_io.js";
import { GP } from "./RGBYPMaskEditor.js";
import { getNodeState } from "./RGBYPMaskEditor.js";
import { setNodeState } from "./RGBYPMaskEditor.js";
import { HELP } from "./RGBYPMaskEditor.js";

const extensionBaseUrl = "/extensions/ComfyUI-RGBYP-Mask-Editor/";
export const colorListRGB = [
    { name: "R", color: [255, 0, 0] },
    { name: "G", color: [0, 255, 0] },
    { name: "B", color: [0, 0, 255] },
    { name: "Y", color: [255, 255, 0] },
    { name: "P", color: [255, 0, 255] },
];
const colorListWEB = [
    { name: "R", color: "#ff4d4d" }, // Red
    { name: "G", color: "#4dff4d" }, // Green
    { name: "B", color: "#4d4dff" }, // Blue
    { name: "Y", color: "#ffff4d" }, // Yellow
    { name: "P", color: "#ff4dff" }, // Pink/Magenta
];

export function updateSelectedColorUI(selectedIndex) {
    const state = getNodeState(GP.baseNode.id);

    state.colorButtons.forEach((btn, idx) => {
        if (idx === selectedIndex) {
            btn.style.border = "2px solid #ffffff";
            btn.style.opacity = "1";
        } else {
            btn.style.border = "none";
            btn.style.opacity = "0.6";
        }
    });

    state.drawCursor.style.outlineColor = colorListWEB[selectedIndex].color;
}

export function updateToolButtonsHighlight(activeTool) {
    const state = getNodeState(GP.baseNode.id);
    if (!state) return;

    const map = {
        Brush: state.brushBtn,
        Erase: state.eraseBtn,
        Scroll: state.scrollBtn,
    };

    Object.entries(map).forEach(([key, btn]) => {
        if (!btn) return;
        if (key === activeTool) {
            btn.style.backgroundColor = "#666";
        } else {
            btn.style.backgroundColor = "#333";
        }
    });
}
/**
 * UI for RGBYP Mask Editor (layout only, no image I/O).
 * - Keeps big dialog with left tools, central canvas, right controls.
 * - Does NOT load or save any images and does not draw.
 */
export function openMaskEditor(node) {
    // overlay
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.width = "100vw";
    overlay.style.height = "100vh";
    overlay.style.background = "rgba(0, 0, 0, 0.75)";
    overlay.style.zIndex = "9999";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    setNodeState(GP.baseNode.id, { overlayDialog: overlay });

    // dialog
    const dialog = document.createElement("div");
    dialog.style.position = "relative";
    dialog.style.display = "flex";
    dialog.style.flexDirection = "column";
    dialog.style.boxSizing = "border-box";
    dialog.style.background = "#222";
    dialog.style.borderRadius = "8px";
    dialog.style.boxShadow = "0 0 25px rgba(0,0,0,0.8)";
    dialog.style.padding = "10px 12px 12px 12px";

    const margin = 40;
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 720;
    dialog.style.width = "calc(100vw - " + (margin * 2) + "px)";
    dialog.style.height = "calc(100vh - " + (margin * 2) + "px)";
    // header
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.marginBottom = "6px";

    const title = document.createElement("div");
    title.textContent = "RGBYP Mask Editor";
    title.style.color = "#f0f0f0";
    title.style.fontSize = "15px";
    title.style.lineHeight = "24px";
    title.style.fontWeight = "600";

    const headerRight = document.createElement("div");
    headerRight.style.display = "flex";
    headerRight.style.alignItems = "center";
    headerRight.style.gap = "8px";

    const helpIcon = document.createElement("div");
    helpIcon.textContent = "?";
    helpIcon.style.width = "48px";
    helpIcon.style.textAlign = "center";
    helpIcon.style.cursor = "pointer";
    helpIcon.style.fontSize = "24px";
    helpIcon.style.fontWeight = "bold";
    helpIcon.style.color = "#fff";
    helpIcon.style.borderRight = "1px solid #444";
    helpIcon.dataset.tool = "Help";
    setNodeState(GP.baseNode.id, { helpIcon: helpIcon });


    const closeIcon = document.createElement("div");
    closeIcon.textContent = "✕";
    closeIcon.style.width = "48px";
    closeIcon.style.textAlign = "center";
    closeIcon.style.cursor = "pointer";
    closeIcon.style.fontSize = "24px";
    closeIcon.style.fontWeight = "bold";
    closeIcon.style.color = "#fff";
    closeIcon.dataset.tool = "Close";


    headerRight.appendChild(helpIcon);
    headerRight.appendChild(closeIcon);

    header.appendChild(title);
    header.appendChild(headerRight);

    // body layout
    const body = document.createElement("div");
    body.style.flex = "1 1 auto";
    body.style.display = "flex";
    body.style.gap = "10px";
    body.style.minHeight = "0"; // allow flex children to shrink

    // left tools column
    const toolsPanel = document.createElement("div");
    toolsPanel.style.display = "flex";
    toolsPanel.style.flexDirection = "column";
    toolsPanel.style.alignItems = "stretch";
    toolsPanel.style.gap = "6px";
    toolsPanel.style.padding = "4px 4px 4px 0";
    toolsPanel.style.width = "72px";
    toolsPanel.style.flex = "0 0 72px";

    function makeIconButton(iconName, label, iconSize) {
        const btn = document.createElement("button");
        btn.style.padding = "4px 4px";
        btn.style.borderRadius = "4px";
        btn.style.border = "1px solid #555";
        btn.style.background = "#333";
        btn.style.color = "#eee";
        btn.style.cursor = "pointer";
        btn.style.boxSizing = "border-box";
        btn.dataset.tool = label;

        const img = document.createElement("img");
        img.src = extensionBaseUrl + iconName;
        img.alt = label;
        img.style.width = iconSize;
        img.style.height = iconSize;
        img.style.objectFit = "contain";

        btn.appendChild(img);

        return btn;
    }


    const brushBtn = makeIconButton("i_brush.png", "Brush", "64px");
    const eraserBtn = makeIconButton("i_erase.png", "Eraser", "64px");
    const scrollBtn = makeIconButton("i_scroll.png", "Scroll", "64px");
    const clearBtn = makeIconButton("i_clear.png", "Clear", "64px");

    toolsPanel.appendChild(brushBtn);
    toolsPanel.appendChild(eraserBtn);
    toolsPanel.appendChild(scrollBtn);
    toolsPanel.appendChild(Object.assign(document.createElement("div"), { style: "height:100%;" }));
    toolsPanel.appendChild(clearBtn);

    // center canvas area
    const centralPanel = document.createElement("div");
    centralPanel.style.display = "flex";

    centralPanel.style.alignItems = "center";
    centralPanel.style.textAlign = "center";
    // centralPanel.style.justifyContent = "center";
    centralPanel.style.background = "#111";
    centralPanel.style.borderRadius = "6px";
    centralPanel.style.overflow = "scroll"; // scrollbars always visible, no UI jump
    centralPanel.style.position = "relative";
    centralPanel.style.height = "100%";
    centralPanel.style.width = "100%";
    centralPanel.style.backgroundColor = "#9f9f9fff";
    setNodeState(GP.baseNode.id, { centralPanel: centralPanel });

    const canvasContainer = document.createElement("div");
    canvasContainer.style.display = "block";
    canvasContainer.style.position = "relative";
    canvasContainer.style.flex = "0 0 auto";
    canvasContainer.style.maxWidth = "none";
    canvasContainer.style.maxHeight = "none";
    canvasContainer.style.margin = "auto";
    setNodeState(GP.baseNode.id, { canvasContainer: canvasContainer });


    const originalCanvas = document.createElement("canvas");
    originalCanvas.style.cursor = "none";
    originalCanvas.style.display = "block";
    // originalCanvas.style.position = "relative";
    originalCanvas.style.position = "absolute";
    originalCanvas.style.width = "100%";
    originalCanvas.style.height = "100%";
    originalCanvas.style.top = "0";
    originalCanvas.style.left = "0";
    setNodeState(GP.baseNode.id, { originalCanvas: originalCanvas });

    const maskCanvas = document.createElement("canvas");
    maskCanvas.style.display = "block";
    maskCanvas.style.position = "absolute";
    maskCanvas.style.width = "100%";
    maskCanvas.style.height = "100%";
    maskCanvas.style.top = "0";
    maskCanvas.style.left = "0";
    maskCanvas.style.pointerEvents = "auto";
    setNodeState(GP.baseNode.id, { maskCanvas: maskCanvas });

    canvasContainer.appendChild(originalCanvas);
    canvasContainer.appendChild(maskCanvas);

    const drawCursor = document.createElement("div");
    drawCursor.style.position = "absolute";
    drawCursor.style.pointerEvents = "none";
    drawCursor.style.border = "1px solid #ffffff";
    drawCursor.style.outline = "2px solid #ff0000ff";

    drawCursor.style.borderRadius = "50%";
    drawCursor.style.boxSizing = "border-box";
    drawCursor.style.transform = "translate(-50%, -50%)";
    drawCursor.style.zIndex = "10";
    drawCursor.style.display = "none";
    setNodeState(GP.baseNode.id, { drawCursor: drawCursor });

    canvasContainer.appendChild(drawCursor);

    centralPanel.appendChild(canvasContainer);
    // right side panel
    const rightPanel = document.createElement("div");
    rightPanel.style.display = "flex";
    rightPanel.style.flexDirection = "column";
    rightPanel.style.gap = "8px";
    rightPanel.style.padding = "4px 0 4px 4px";
    rightPanel.style.width = "190px";
    rightPanel.style.flex = "0 0 190px";
    rightPanel.style.borderLeft = "1px solid #333";

    function makeSliderRow(labelText, min, max, value, suffix) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.flexDirection = "column";
        row.style.gap = "4px";

        const label = document.createElement("div");
        label.textContent = labelText;
        label.style.fontSize = "16px";
        label.style.color = "#ccc";

        const inner = document.createElement("div");
        inner.style.display = "flex";
        inner.style.alignItems = "center";
        inner.style.gap = "6px";

        const input = document.createElement("input");
        input.type = "range";
        input.min = String(min);
        input.max = String(max);
        input.value = String(value);
        input.style.flex = "1 1 auto";

        const span = document.createElement("div");
        span.textContent = value + (suffix || "");
        span.style.fontSize = "11px";
        span.style.color = "#ddd";
        span.style.minWidth = "40px";

        input.addEventListener("input", () => {
            span.textContent = input.value + (suffix || "");
            // stub, no logic
        });

        inner.appendChild(input);
        inner.appendChild(span);
        row.appendChild(label);
        row.appendChild(inner);
        return row;
    }

    rightPanel.appendChild(makeSliderRow("Brush size", 1, 200, 50, " px"));
    rightPanel.appendChild(makeSliderRow("Opacity", 0, 100, 75, " %"));


    // color buttons
    const colorsLabel = document.createElement("div");
    colorsLabel.textContent = "Colors";
    colorsLabel.style.fontSize = "16px";
    colorsLabel.style.color = "#ccc";

    const colorsRow = document.createElement("div");
    colorsRow.style.display = "flex";
    colorsRow.style.flexDirection = "row";
    colorsRow.style.flexWrap = "wrap";
    colorsRow.style.gap = "4px";
    colorsRow.style.justifyContent = "space-between";

    function makeColorButton(cssColor) {
        const btn = document.createElement("button");
        btn.style.width = "32px";
        btn.style.height = "32px";
        btn.style.borderRadius = "4px";
        btn.style.border = "1px solid #444";
        btn.style.background = cssColor;
        btn.style.color = "#000";
        btn.style.fontWeight = "600";
        btn.style.cursor = "pointer";
        btn.style.fontSize = "11px";
        btn.style.opacity = "0.6";
        btn.dataset.tool = "ColorButton" + cssColor;

        return btn;
    }

    colorListWEB.forEach((c) => {
        colorsRow.appendChild(makeColorButton(c.color));
    });

    setNodeState(GP.baseNode.id, { colorButtons: [...colorsRow.children] });
    updateSelectedColorUI(getNodeState(GP.baseNode.id).drawColor);

    const autoMaskButtonsRow = document.createElement("div");
    autoMaskButtonsRow.style.display = "flex";
    autoMaskButtonsRow.style.flexDirection = "row";
    autoMaskButtonsRow.style.gap = "4px";
    autoMaskButtonsRow.style.marginTop = "4px";
    autoMaskButtonsRow.style.justifyContent = "space-between";

    const autoHalfBtn = makeIconButton("i_d_11.png", "Half", "32px");
    const auto1to2Btn = makeIconButton("i_d_12.png", "1 to 2", "32px");
    const auto2to1Btn = makeIconButton("i_d_21.png", "2 to 1", "32px");
    const autoThirdsBtn = makeIconButton("i_d_111.png", "Thirds", "32px");

    autoMaskButtonsRow.appendChild(autoHalfBtn);
    autoMaskButtonsRow.appendChild(auto1to2Btn);
    autoMaskButtonsRow.appendChild(auto2to1Btn);
    autoMaskButtonsRow.appendChild(autoThirdsBtn);

    rightPanel.appendChild(Object.assign(document.createElement("div"), { style: "height:16px;" }));
    rightPanel.appendChild(colorsLabel);
    rightPanel.appendChild(colorsRow);
    rightPanel.appendChild(Object.assign(document.createElement("div"), { style: "height:16px;" }));
    rightPanel.appendChild(autoMaskButtonsRow);

    function makeTextButton(label, primary) {
        const btn = document.createElement("button");
        btn.textContent = label;
        btn.style.padding = "5px 14px";
        btn.style.borderRadius = "4px";
        btn.style.border = "1px solid " + (primary ? "#5a9" : "#555");
        btn.style.background = primary ? "#3b7" : "#333";
        btn.style.color = "#fff";
        btn.style.cursor = "pointer";
        btn.style.fontSize = "16px";
        btn.style.fontWeight = "bold";
        btn.dataset.tool = label;
        return btn;
    }

    const saveBtn = makeTextButton("Save", true);

    rightPanel.appendChild(Object.assign(document.createElement("div"), { style: "height:100%;" }));
    rightPanel.appendChild(saveBtn);

    const helpPanel = document.createElement("div");
    helpPanel.style.position = "absolute";
    helpPanel.style.left = "0";
    helpPanel.style.right = "0";
    helpPanel.style.bottom = "0";
    helpPanel.style.zIndex = "10";
    const headerHeight = header.getBoundingClientRect().height;
    helpPanel.style.top = headerHeight + "px";    

    // cover only the area under the header
    helpPanel.style.display = "none";            // hidden by default
    helpPanel.style.backgroundColor = "#333";
    helpPanel.style.boxSizing = "border-box";
    helpPanel.style.padding = "20px 40px";
    helpPanel.style.overflow = "auto";
    helpPanel.style.color = "#fff";
    helpPanel.style.flexDirection = "column";

    helpPanel.innerHTML = HELP;
    setNodeState(GP.baseNode.id, { helpPanel: helpPanel });


    // нижняя панель с кнопкой Close
    const helpFooter = document.createElement("div");
    helpFooter.style.display = "flex";
    helpFooter.style.justifyContent = "flex-end";
    helpFooter.style.marginTop = "16px";

    const helpCloseBtn = makeTextButton("Close", true); // такой же зелёный, как Save
    setNodeState(GP.baseNode.id, { helpCloseBtn: helpCloseBtn });

    helpFooter.appendChild(helpCloseBtn);
    helpPanel.appendChild(helpFooter);



    // assemble
    body.appendChild(toolsPanel);
    body.appendChild(centralPanel);
    body.appendChild(rightPanel);
    // body.appendChild(helpPanel);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(helpPanel);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    setNodeState(GP.baseNode.id, { baseImg: new Image() });
    setNodeState(GP.baseNode.id, { maskImg: new Image() });

    initBaseImageAndCanvas();

    // hotkeys
    registerKeyHandlers(dialog);

    function closeEditor() {
        unregisterKeyHandlers(dialog);
        if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
    }


    closeIcon.addEventListener("click", closeEditor);
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
            closeEditor();
        }
    });

}
