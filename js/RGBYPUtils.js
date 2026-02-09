import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import {
    splitPath,
    uploadFile,
    loadFile, loadFileFromPath, loadImage, loadImageFromPath,
    updateWidgetValue, getWidget, getWidgetValue, getWidgetJSON, getImageWidgetFileAndFolder,
    hideWidget
} from "./AKGeneralUtils.js";

(function () {
    const RGBYP_DEBUG = true;
    function rgbypLog(...a) { if (RGBYP_DEBUG) console.log("[RGBYPUtils]", ...a); }
    function rgbypWarn(...a) { if (RGBYP_DEBUG) console.warn("[RGBYPUtils]", ...a); }
    function rgbypErr(...a) { console.error("[RGBYPUtils]", ...a); }


    function stemOfFilename(fn) {
        const s = String(fn || "");
        const i = s.lastIndexOf(".");
        return i > 0 ? s.slice(0, i) : s;
    }

    function originalFileNameFromRgbypFilename(fn) {
        const s = String(fn || "");
        const i = s.indexOf("-rgbyp-");
        if (i === -1) return stemOfFilename(s);
        return s.slice(0, i);
    }

    function blobToImage(blob) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
            img.src = url;
        });
    }

    async function resizeImageBlob(blob, targetW, targetH) {
        const img = await blobToImage(blob);
        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        // ctx.clearRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);

        return await new Promise((resolve) => {
            canvas.toBlob((b) => resolve(b), "image/png");
        });
    }

    async function bakeCompositePngBlob(originalBlob, maskBlob, opacity = 0.7) {
        const [imgOrig, imgMask] = await Promise.all([blobToImage(originalBlob), blobToImage(maskBlob)]);
        const w = imgOrig.naturalWidth || imgOrig.width;
        const h = imgOrig.naturalHeight || imgOrig.height;

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");

        ctx.globalAlpha = 1.0;
        ctx.drawImage(imgOrig, 0, 0, w, h);

        ctx.globalAlpha = opacity;
        ctx.drawImage(imgMask, 0, 0, w, h);

        ctx.globalAlpha = 1.0;

        return await new Promise((resolve) => {
            canvas.toBlob((b) => resolve(b), "image/png");
        });
    }

    async function pickMaskFile() {
        return await new Promise((resolve) => {
            const inp = document.createElement("input");
            inp.type = "file";
            inp.accept = "image/*";
            inp.style.display = "none";
            inp.onchange = () => {
                const f = inp.files && inp.files[0] ? inp.files[0] : null;
                resolve(f);
            };
            document.body.appendChild(inp);
            inp.click();
            setTimeout(() => {
                try { document.body.removeChild(inp); } catch (e) { }
            }, 0);
        });
    }

    async function handleLoadMask(node) {
        const nodeType = (node.type || node.comfyClass || (node.constructor && node.constructor.name) || "") + "";
        const isBridgeNode = nodeType === "RGBYPMaskBridge";

        const nodeId = String(node?.id ?? "");
        if (!nodeId) return;

        const data = getWidgetJSON(node, "rgbyp_json");
        const jsonAvailable = !!(data && typeof data === "object" && typeof data.original === "string" && data.original);

        let originalBlob = null;
        let originalW = 0;
        let originalH = 0;
        let originalFileName = "";
        let originalOutName = "";

        if (jsonAvailable) {
            originalOutName = String(data.original);
            originalFileName = originalFileNameFromRgbypFilename(originalOutName);
            originalBlob = await (await loadFile(originalOutName, "input", "clipspace")).blob();
        } else {
            originalFileName = `RGBYPBridge`;
            // const imgPath = "";

            if (!isBridgeNode) {
                const wImg = getWidget(node, "image");
                const imgPath = wImg?.value || "";
                if (!imgPath) return;

                const { filename } = splitPath(imgPath);
                originalFileName = stemOfFilename(filename);

                originalOutName = `${originalFileName}-rgbyp-original-${nodeId}.png`;
                originalBlob = await (await loadFileFromPath(imgPath, "input")).blob();
                await uploadFile(originalBlob, originalOutName, "input", "clipspace");
            } else {
                originalOutName = `${originalFileName}-rgbyp-original-${nodeId}.png`;
                originalBlob = await (await loadFile(originalOutName, "input", "clipspace")).blob();
            }

        }
        console.log("handleLoadMask() originalOutName", originalOutName);

        const imgOrig = await blobToImage(originalBlob);
        originalW = imgOrig.naturalWidth || imgOrig.width;
        originalH = imgOrig.naturalHeight || imgOrig.height;

        const file = await pickMaskFile();
        if (!file) { return; }

        const maskResizedBlob = await resizeImageBlob(file, originalW, originalH);

        const maskOutName = `${originalFileName}-rgbyp-mask-${nodeId}.png`;
        await uploadFile(maskResizedBlob, maskOutName, "input", "clipspace");

        const compositeOutName = `${originalFileName}-rgbyp-composite-${nodeId}.png`;
        const compositeBlob = await bakeCompositePngBlob(originalBlob, maskResizedBlob, 0.7);
        await uploadFile(compositeBlob, compositeOutName, "input", "clipspace");
        const compositeOutPath = `clipspace\\${originalFileName}-rgbyp-composite-${nodeId}.png`;

        const ts = Date.now();

        const jsonObj = {
            rgbyp_timestamp: ts,
            original: originalOutName,
            mask: maskOutName,
            composite: compositeOutName,
        };

        node.__rgbyp_skip_clear_json_once = true;
        updateWidgetValue(node, "rgbyp_json", JSON.stringify(jsonObj), true);


        if (!isBridgeNode) {
            updateWidgetValue(node, "image", compositeOutPath, true);
        } else {
            try {
                const img = await loadImage(compositeOutName, "input", "clipspace");
                node.img = img;
                node.imgs = Array.isArray(node.imgs) ? (node.imgs[0] = img, node.imgs) : [img];
                // node.graph?.setDirtyCanvas(true, true);

            } catch (e) {
                console.warn("[RGBYPUtils] handleLoadMask: failed to update node preview", e);
            }
        }

    }

    async function handleResetMask(node) {

        const nodeType = (node.type || node.comfyClass || (node.constructor && node.constructor.name) || "") + "";
        const isBridgeNode = nodeType === "RGBYPMaskBridge";

        const data = getWidgetJSON(node, "rgbyp_json");
        const jsonAvailable = !!(data && typeof data === "object" && typeof data.original === "string" && data.original);
        if (!jsonAvailable) return;

        const nodeId = String(node?.id ?? "");
        if (!nodeId) return;

        const originalOutName = String(data.original);
        const originalFileName = originalFileNameFromRgbypFilename(originalOutName);

        const originalBlob = await (await loadFile(originalOutName, "input", "clipspace")).blob();

        const compositeOutName = `${originalFileName}-rgbyp-composite-${nodeId}.png`;
        await uploadFile(originalBlob, compositeOutName, "input", "clipspace");

        const compositeOutPath = `clipspace\\${originalFileName}-rgbyp-composite-${nodeId}.png`;

        const ts = Date.now();

        const jsonObj = {
            rgbyp_timestamp: ts,
            original: originalOutName,
            composite: compositeOutName,
        };

        node.__rgbyp_skip_clear_json_once = true;
        updateWidgetValue(node, "rgbyp_json", JSON.stringify(jsonObj), true);

        if (!isBridgeNode) {
            updateWidgetValue(node, "image", compositeOutPath, true);
        } else {
            try {
                const img = await loadImage(compositeOutName, "input", "clipspace");
                node.img = img;
                node.imgs = Array.isArray(node.imgs) ? (node.imgs[0] = img, node.imgs) : [img];
                // node.graph?.setDirtyCanvas(true, true);
            } catch (e) {
                console.warn("[RGBYPUtils] handleResetMask: failed to update node preview", e);
            }
        }

    }

    function installButtons(node) {
        if (node.__rgbyp_buttons_installed) return;
        node.__rgbyp_buttons_installed = true;

        const row = {
            type: "rgbyp_button_row",
            name: "rgbyp_button_row",
            serialize: false,

            _padX: 15,   // left/right padding inside the node
            _gap: 4,    // gap between buttons
            _h: 22,     // row height

            _lastY: 0,
            _lastW: 0,
            _lastH: 0,

            computeSize(width) {
                return [width, this._h];
            },

            draw(ctx, node, width, y) {
                const h = this._h;
                const pad = this._padX;
                const gap = this._gap;

                this._lastY = y;
                this._lastW = width;
                this._lastH = h;

                const innerW = Math.max(10, width - pad * 2);
                const bw = Math.max(10, Math.floor((innerW - gap) / 2));

                const x1 = pad;
                const x2 = pad + bw + gap;

                // Load Mask button
                ctx.fillStyle = "#425741";
                ctx.fillRect(x1, y, bw, h);
                ctx.strokeStyle = "#6d7f6c";
                // ctx.lineWidth = 1;
                ctx.strokeRect(x1 + 0.5, y + 0.5, bw - 1, h - 1);

                ctx.fillStyle = "#ffffff";
                ctx.textAlign = "center";
                // console.log("textBaseline", ctx.textBaseline);
                ctx.textBaseline = "middle";
                // ctx.font = "14px sans-serif";
                ctx.fillText("Load Mask", x1 + bw / 2, y + h / 2);

                // Reset Mask button
                ctx.fillStyle = "#584444";
                ctx.fillRect(x2, y, bw, h);
                ctx.strokeStyle = "#7f6767";
                // ctx.lineWidth = 1;
                ctx.strokeRect(x2 + 0.5, y + 0.5, bw - 1, h - 1);

                ctx.fillStyle = "#ffffff";
                ctx.fillText("Reset Mask", x2 + bw / 2, y + h / 2);

                ctx.textBaseline = "alphabetic";

            },

            mouse(e, pos, node) {
                if (e.type !== "pointerdown" && e.type !== "mousedown") return false;

                const x = pos[0];
                const y = pos[1];

                const top = this._lastY;
                const h = this._h;
                if (y < top || y > top + h) return false;

                const pad = this._padX, gap = this._gap, w = node.size?.[0] ?? 0;
                const innerW = Math.max(10, w - pad * 2);
                const bw = Math.max(10, Math.floor((innerW - gap) / 2));
                const x1 = pad, x2 = pad + bw + gap;

                if (x >= x1 && x <= x1 + bw) { handleLoadMask(node).catch(err => rgbypErr("handleLoadMask error", err)); return true; }
                if (x >= x2 && x <= x2 + bw) { handleResetMask(node).catch(err => rgbypErr("handleResetMask error", err)); return true; }
                return false;
            }
        };

        node.widgets = node.widgets || [];
        // node.widgets.push(row);
        // const idxJson = node.widgets.findIndex(w => w && w.name === "rgbyp_json");
        // const insertAt = idxJson >= 0 ? idxJson : node.widgets.length;

        node.widgets.splice(3, 0, row);

        // if (!node.__rgbyp_row_mouse_hooked) {
        //     node.__rgbyp_row_mouse_hooked = true;

        //     const old = node.onMouseDown;
        //     node.onMouseDown = function (e, pos, canvas) {
        //         const w = (this.widgets || []).find(w => w && w.type === "rgbyp_button_row");
        //         if (w && typeof w.mouse === "function") {
        //             const r = w.mouse(e, pos, this);
        //             if (r) return true;
        //         }
        //         if (old) return old.call(this, e, pos, canvas);
        //         return false;
        //     };
        // }


        node.setSize?.(node.computeSize?.() ?? node.size);
        node.graph?.setDirtyCanvas(true, true);
    }

    const BUTTON_H = 26;
    const BUTTON_PAD_X = 10;
    const BUTTON_GAP = 6;
    const BUTTON_MARGIN = 6;
    const BUTTON_ICON_SIZE = 16;
    const EXT_BASE_URL = "/extensions/ComfyUI-RGBYP-Mask-Editor/";

    function createIcon(src) {
        const img = new Image();
        img.src = EXT_BASE_URL + src;
        return img;
    }

    const NODE_ICONS = {
        open: createIcon("i_open_mask.png"),
        reset: createIcon("i_reset_mask.png"),
    };

    function _rgbypCalcButtonRects(node) {
        const w = node.size?.[0] ?? 0;
        const h = node.size?.[1] ?? 0;

        // const y = h - BUTTON_H - BUTTON_MARGIN;
        const y = BUTTON_MARGIN;              // самый верх внутри ноды

        const bw = 34;                // фикс ширина кнопки
        const total = bw * 2 + BUTTON_GAP;

        const x1 = Math.max(0, Math.floor((w - total) / 2));
        const x2 = x1 + bw + BUTTON_GAP;

        return {
            open: { x: x1, y, w: bw, h: BUTTON_H },
            reset: { x: x2, y, w: bw, h: BUTTON_H },
        };
    }

    function drawIconButton(ctx, rect, img, enabled) {
        const alpha = enabled ? 1.0 : 0.45;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#2a2a2a";
        ctx.strokeStyle = "#555";
        ctx.lineWidth = 1;

        const rr = 6;
        const x0 = rect.x, y0 = rect.y, x1 = rect.x + rect.w, y1 = rect.y + rect.h;
        ctx.beginPath();
        ctx.moveTo(x0 + rr, y0);
        ctx.lineTo(x1 - rr, y0);
        ctx.quadraticCurveTo(x1, y0, x1, y0 + rr);
        ctx.lineTo(x1, y1 - rr);
        ctx.quadraticCurveTo(x1, y1, x1 - rr, y1);
        ctx.lineTo(x0 + rr, y1);
        ctx.quadraticCurveTo(x0, y1, x0, y1 - rr);
        ctx.lineTo(x0, y0 + rr);
        ctx.quadraticCurveTo(x0, y0, x0 + rr, y0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (img && img.complete && img.naturalWidth && img.naturalHeight) {
            const size = Math.min(BUTTON_ICON_SIZE, rect.w - 6, rect.h - 6);
            const ix = rect.x + (rect.w - size) * 0.5;
            const iy = rect.y + (rect.h - size) * 0.5;
            ctx.drawImage(img, ix, iy, size, size);
        }

        ctx.restore();
    }



    function installRawIconButtons(node) {
        if (node.__rgbyp_raw_icons) return;
        node.__rgbyp_raw_icons = true;

        // --- DRAW ---
        const oldDraw = node.onDrawForeground;
        node.onDrawForeground = function (ctx) {
            if (oldDraw) oldDraw.call(this, ctx);

            const rects = _rgbypCalcButtonRects(this);
            this.__rgbyp_icon_rects = rects;

            drawIconButton(ctx, rects.open, NODE_ICONS.open, true);
            drawIconButton(ctx, rects.reset, NODE_ICONS.reset, true);
        };

        // --- HIT TEST ---
        const oldMD = node.onMouseDown;
        node.onMouseDown = function (e, pos, canvas) {

            console.log("RGBYPUtils: node.onMouseDown", e, pos);

            if (e.type !== "pointerdown" && e.type !== "mousedown") {
                return oldMD ? oldMD.call(this, e, pos, canvas) : false;
            }

            const r = this.__rgbyp_icon_rects;
            if (!r) {
                return oldMD ? oldMD.call(this, e, pos, canvas) : false;
            }

            const x = pos[0];
            const y = pos[1];

            const hit = (rc) =>
                x >= rc.x && x <= rc.x + rc.w &&
                y >= rc.y && y <= rc.y + rc.h;

            if (hit(r.open)) {
                console.log("RGBYPUtils: Load Mask button clicked");
                handleLoadMask(this).catch(console.error);
                this.graph?.setDirtyCanvas(true, true);
                return true;
            }

            if (hit(r.reset)) {
                console.log("RGBYPUtils: Reset Mask button clicked");
                handleResetMask(this).catch(console.error);
                this.graph?.setDirtyCanvas(true, true);
                return true;
            }

            return oldMD ? oldMD.call(this, e, pos, canvas) : false;
        };

        // гарантируем место под кнопки
        const minH = BUTTON_H + BUTTON_MARGIN * 2 + 8;
        if ((node.size?.[1] ?? 0) < minH) node.size[1] = minH;

        node.graph?.setDirtyCanvas(true, true);
    }


    function installImageChangeHook(node) {
        if (node.__rgbyp_image_hook_installed) { return; }

        const wImg = getWidget(node, "image") || getWidget(node, "loadImage");
        const wJson = getWidget(node, "rgbyp_json");
        if (!wImg || !wJson) { return; }

        node.__rgbyp_image_hook_installed = true;

        const prevCb = wImg.callback;

        wImg.callback = function () {
            const newValue = wImg?.value;

            // ✅ Skip clearing rgbyp_json for programmatic updates (editor sets this flag)
            if (node.__rgbyp_skip_clear_json_once) {
                node.__rgbyp_skip_clear_json_once = false;
                if (prevCb) {
                    try { return prevCb.apply(this, arguments); } catch (e) { rgbypErr("image widget prev callback error", e); }
                }
                return;
            }

            // ✅ Default behavior: user changed image (file picker / normal interaction) => clear json
            try { wJson.value = ""; } catch (e) { }
            try { if (wJson.callback) wJson.callback(wJson.value); } catch (e) { }
            // try { node.setDirtyCanvas(true, true); } catch (e) { }
            // try { app.graph.setDirtyCanvas(true, true); } catch (e) { }

            if (prevCb) {
                try { return prevCb.apply(this, arguments); } catch (e) { rgbypErr("image widget prev callback error", e); }
            }
        };
    }

    async function restoreRGBYPBridgePreview(node) {
        try {
            const data = getWidgetJSON(node, "rgbyp_json");
            if (!data || typeof data !== "object") return;

            const name = data.composite || data.original;
            if (!name) return;
            // console.log("restoreRGBYPBridgePreview()");

            // const img = await loadImage(name, "input", "clipspace");
            let img;
            try {
                img = await loadImage(name, "input", "clipspace");
                // console.log("restoreRGBYPBridgePreview loaded image:", name);
            } catch (e) {
                // console.error("Failed to load image:", name, e);
                updateWidgetValue(node, "rgbyp_json", "", true);

                return;
            }
            node.img = img;
            node.imgs = Array.isArray(node.imgs) ? (node.imgs[0] = img, node.imgs) : [img];

            // node.graph?.setDirtyCanvas(true, true);
        } catch (e) {
            console.warn("[RGBYP] restoreRGBYPBridgePreview failed", e);
        }
    }

    // function setDownscaleFactor(node) {
    //     try {
    //         if ((node?.type || node?.comfyClass) !== "RGBYPMaskBridge") return;

    //         const w = getWidget(node, "downscale_preview_mask_to");
    //         if (!w) return;

    //         const settings = app?.ui?.settings || null;
    //         const getSetting =
    //             typeof settings?.getSettingValue === "function"
    //                 ? settings.getSettingValue.bind(settings)
    //                 : null;

    //         let enable = false;
    //         let maxSide = 0;

    //         if (getSetting) {
    //             try {
    //                 enable = !!getSetting("AK.RGBYP.downscale_preview_bridge");
    //                 maxSide = Number(getSetting("AK.RGBYP.downscale_max_side")) || 0;
    //             } catch (_) { }
    //         }

    //         if (!getSetting) {
    //             try {
    //                 enable = window.localStorage.getItem("AK.RGBYP.downscale_preview_bridge") === "true";
    //                 maxSide = Number(window.localStorage.getItem("AK.RGBYP.downscale_max_side")) || 0;
    //             } catch (_) { }
    //         }

    //         updateWidgetValue(node, "downscale_preview_mask_to", enable ? maxSide : 0, true);
    //         node.graph?.setDirtyCanvas(true, true);
    //     } catch (e) {
    //         console.warn("[RGBYPUtils] setDownscaleFactor failed", e);
    //     }
    // }

    let __rgbyp_ds_enable = null;   // boolean
    let __rgbyp_ds_maxSide = null;  // number
    let __rgbyp_scale_mask_output = null; // boolean

    function initDownscaleCacheFromSettings() {
        try {
            __rgbyp_ds_enable = !!app.extensionManager.setting.get("AK.RGBYP.downscale_preview_bridge");
            __rgbyp_ds_maxSide = Number(app.extensionManager.setting.get("AK.RGBYP.downscale_max_side")) || 800;
            __rgbyp_scale_mask_output = !!app.extensionManager.setting.get("AK.RGBYP.scale_mask_output");
        } catch (_) {
            // fallback дефолты
            __rgbyp_ds_enable = false;
            __rgbyp_ds_maxSide = 800;
            __rgbyp_scale_mask_output = false;

        }
    }

    function setDownscaleFactor(node) {
        try {
            const wDownscale = getWidget(node, "downscale_preview_mask_to");
            if (wDownscale) {
                const enable = !!__rgbyp_ds_enable;
                const maxSide = Number(__rgbyp_ds_maxSide) || 0;
                updateWidgetValue(node, "downscale_preview_mask_to", enable ? maxSide : 0, true);
            }

            const wScaleMask = getWidget(node, "scale_mask_output");
            if (wScaleMask) {
                updateWidgetValue(node, "scale_mask_output", !!__rgbyp_scale_mask_output, true);
            }

            // node.graph?.setDirtyCanvas(true, true);
        } catch (e) {
            console.warn("[RGBYPUtils] setDownscaleFactor failed", e);
        }
    }
    function registerSettings() {
        const S = app.ui.settings;
        function applyDownscaleToAllBridgeNodes() {
            // console.log("[RGBYPUtils] applyDownscaleToAllBridgeNodes");
            const nodes = app?.graph?._nodes || [];
            for (const n of nodes) {
                if ((n?.type || n?.comfyClass) === "RGBYPMaskBridge") {
                    setDownscaleFactor(n);
                }
            }
        }
        S.addSetting({
            id: "AK.RGBYP.downscale_max_side",
            name: "Downscale to maximum side:",
            type: "number",
            defaultValue: 800,
            attrs: {
                min: 0,
                max: 3200,
                step: 32,
            },
            category: ["AK", "RGBYP", "Downscale to maximum side"],
            onChange: (newVal, oldVal) => {
                __rgbyp_ds_maxSide = Number(newVal) || 0;
                applyDownscaleToAllBridgeNodes();
            },
        });
        S.addSetting({
            id: "AK.RGBYP.scale_mask_output",
            name: "Scale output RGBYP mask to input image size:",
            type: "boolean",
            defaultValue: false,
            category: ["AK", "RGBYP", "Scale output RGBYP mask to input image size"],
            onChange: (newVal, oldVal) => {
                __rgbyp_scale_mask_output = !!newVal;
                applyDownscaleToAllBridgeNodes();
            },
        });
        S.addSetting({
            id: "AK.RGBYP.downscale_preview_bridge",
            name: "Downscale preview in Mask Bridge node:",
            type: "boolean",
            defaultValue: false,
            category: ["AK", "RGBYP", "Downscale preview in Mask Bridge node"],
            onChange: (newVal, oldVal) => {
                __rgbyp_ds_enable = !!newVal;
                applyDownscaleToAllBridgeNodes();
            },
        });


    }



    app.registerExtension({
        name: "RGBYPUtils.LoadImageButtons",

        setup() {
            registerSettings();
            initDownscaleCacheFromSettings();
            applyDownscaleToAllBridgeNodes();
        },

        beforeRegisterNodeDef(nodeType, nodeData) {
            const nm = nodeData?.name;
            if (nm !== "RGBYPMaskBridge" && nm !== "RGBYPLoadImage") return;

            const oldOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (oldOnNodeCreated) oldOnNodeCreated.apply(this, arguments);
                // hideWidget(this, "rgbyp_json");
                installRawIconButtons(this);
                installImageChangeHook(this);
                if ((this.type || this.comfyClass) === "RGBYPMaskBridge") {
                    setDownscaleFactor(this);
                }

            };

            const oldOnConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function () {
                if (oldOnConfigure) oldOnConfigure.apply(this, arguments);
                // hideWidget(this, "rgbyp_json");
                installRawIconButtons(this);
                installImageChangeHook(this);
                if ((this.type || this.comfyClass) === "RGBYPMaskBridge") {
                    setDownscaleFactor(this);
                    restoreRGBYPBridgePreview(this);
                }
            };
            const oldOnExecuted = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function (message) {
                if (oldOnExecuted) oldOnExecuted.apply(this, arguments);

                if ((this.type || this.comfyClass) !== "RGBYPMaskBridge") return;

                const v = message?.rgbyp_json;

                // if (typeof v === "string") {
                this.__rgbyp_skip_clear_json_once = true;
                console.log("[RGBYP] RGBYPMaskBridge onExecuted", v);
                updateWidgetValue(this, "rgbyp_json", v, true);
                // node.graph?.setDirtyCanvas(true, true);
                // }
            };
        },
    });
})();
