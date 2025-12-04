import { app } from "../../scripts/app.js";
import { openMaskEditor } from "./RGBYPMaskEditor_ui.js";

// export const GP = {
//     baseNode: null,
//     baseImg: null,
//     maskImg: null,
// };
export const GP = {
    nodes: new Map(),
    baseNode: null,
};

export function setNodeState(nodeId, partial) {
    const state = getNodeState(nodeId);
    Object.assign(state, partial);   // updates only the specified fields
    GP.nodes.set(nodeId, state);
};

export function getNodeState(nodeId) {
    if (!GP.nodes.has(nodeId)) {
        GP.nodes.set(nodeId, {
            overlayDialog: null,
            dialogElement: null,
            helpPanel: null,
            helpIcon: null,
            helpCloseBtn: null,
            baseImg: null,
            maskImg: null,
            originalCanvas: null,
            maskCanvas: null,
            centralPanel: null,
            canvasContainer: null,
            zoom: 1,
            zoomPrevWidth: null,
            zoomPrevHeight: null,
            drawCursor: null,
            isDrawing: false,
            drawLastX: 0,
            drawLastY: 0,
            drawBrushSize: 40,
            drawColor: 0,
            colorButtons: [],
            lastCursorClientX: 0,
            lastCursorClientY: 0,
            maskOpacity: 0.75,
            currentTool: 'Brush',
            prevTool: 'Brush',
            brushBtn: null,
            eraserBtn: null,
            scrollBtn: null,
            clearBtn: null,
            drawMode: 'draw',
            tempOriginal: null,
            tempMask: null,
            tempComposite: null,

        });
    }
    return GP.nodes.get(nodeId);
};

export const HELP = `
<h2>Hotkeys</h2>
<table style="border-spacing: 5px; border-collapse:separate;">
    <tr><td><b>1, 2, 3, 4, 5</b></td><td>Change brush color</td></tr>
    <tr><td><b>SHIFT + 1</b></td><td>Also changes brush color</td></tr>
    <tr><td><b>SHIFT + A / SHIFT + D</b></td><td>Brush size</td></tr>
    <tr><td><b>SHIFT + W / SHIFT + S</b></td><td>Mask opacity</td></tr>
    <tr><td><b>SHIFT + Z / SHIFT + X</b></td><td>Zoom (or use the mouse wheel)</td></tr>
    <tr><td><b>SHIFT + C</b></td><td>Fit image to window</td></tr>
    <tr><td><b>SHIFT + V</b></td><td>Generate automatic masks. Each press creates the next one</td></tr>
    <tr><td><b>SPACE / SHIFT + SPACE</b></td><td>Image scroll mode</td></tr>
    <tr><td><b>ESC</b></td><td>Close the window without saving</td></tr>
    <tr><td><b>ENTER</b></td><td>Save and close the window</td></tr>
</table>
`;

/**
 * Minimal RGBYP Mask Editor extension.
 * - Registers only a context-menu entry.
 * - Does NOT load or process any images.
 */
app.registerExtension({
    name: "RGBYPMaskEditor",

    async setup(appInstance) {
        const LGraphCanvas = window.LGraphCanvas;
        if (!LGraphCanvas) return;

        const proto = LGraphCanvas.prototype;
        const origGetNodeMenuOptions = proto.getNodeMenuOptions;

        proto.getNodeMenuOptions = function (node) {
            GP.baseNode = node

            // setNodeState(node.id, { baseNode: node });

            let options = [];
            try {
                options = origGetNodeMenuOptions
                    ? origGetNodeMenuOptions.call(this, node) || []
                    : [];
            } catch (e) {
                options = options || [];
            }

            // Visual separator
            options.unshift(null);

            // Simple menu item that only opens the stub dialog
            options.unshift({
                content: `
                    <span style="display:flex;align-items:center;gap:6px;">
                        <img src="/extensions/ComfyUI-RGBYP-Mask-Editor/i_menu.png"
                            style="width:16px;height:16px;image-rendering:pixelated;">
                        <span>RGBYP Mask Editor</span>
                    </span>
                    `,
                callback: () => {
                    openMaskEditor(node);
                },
            });

            return options;
        };
    },
});
