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
    async function loadBaseImg(node) {
        let baseImg = null;
        if (node.imgs && Array.isArray(node.imgs) && node.imgs.length > 0) {
            const memImg = node.imgs[0];
            const w = memImg?.naturalWidth || memImg?.width || 0;
            const h = memImg?.naturalHeight || memImg?.height || 0;

            if (memImg instanceof Image && w > 0 && h > 0) {
                try {
                    const c = document.createElement("canvas");
                    c.width = w;
                    c.height = h;
                    const cx = c.getContext("2d");
                    cx.drawImage(memImg, 0, 0);

                    // Use existing helper from this file (it is already defined above):
                    // async function canvasToBlob(canvas, mime, quality) { ... }
                    const blob = await canvasToBlob(c, "image/png", 1.0);

                    const url = URL.createObjectURL(blob);
                    const img = new Image();
                    await new Promise((resolve, reject) => {
                        img.onload = () => resolve(true);
                        img.onerror = (e) => reject(e);
                        img.src = url;
                    });
                    URL.revokeObjectURL(url);

                    console.log("[RGBYP] initBaseImageAndCanvas: cloned node.imgs[0] into new Image", { w, h });
                    baseImg = img;
                } catch (e) {
                    console.warn("[RGBYP] initBaseImageAndCanvas: clone from node.imgs[0] failed, fallback to URL", e);
                }
            }
        }
        return baseImg;
    }

    // async function handleLoadMask(node) {
    //     const nodeType = (node.type || node.comfyClass || (node.constructor && node.constructor.name) || "") + "";
    //     const isBridgeNode = nodeType === "RGBYPMaskBridge";

    //     const nodeId = String(node?.id ?? "");
    //     if (!nodeId) return;

    //     const data = getWidgetJSON(node, "rgbyp_json");
    //     const jsonAvailable = !!(data && typeof data === "object" && typeof data.original === "string" && data.original);

    //     let originalBlob = null;
    //     let originalW = 0;
    //     let originalH = 0;
    //     let originalFileName = "";
    //     let originalOutName = "";

    //     if (jsonAvailable) {
    //         originalOutName = String(data.original);
    //         originalFileName = originalFileNameFromRgbypFilename(originalOutName);
    //         originalBlob = await (await loadBaseImg(node)).blob();
    //     } else {
    //         originalFileName = `RGBYPBridge`;
    //         // const imgPath = "";

    //         if (!isBridgeNode) {
    //             const wImg = getWidget(node, "image");
    //             const imgPath = wImg?.value || "";
    //             if (!imgPath) return;

    //             const { filename } = splitPath(imgPath);
    //             originalFileName = stemOfFilename(filename);

    //             originalOutName = `${originalFileName}-rgbyp-original-${nodeId}.png`;
    //             originalBlob = await (await loadBaseImg(node)).blob();
    //             await uploadFile(originalBlob, originalOutName, "input", "clipspace");
    //         } else {
    //             originalOutName = `${originalFileName}-rgbyp-original-${nodeId}.png`;
    //             originalBlob = await (await loadFile(originalOutName, "input", "clipspace")).blob();
    //         }

    //     }
    //     console.log("handleLoadMask() originalOutName", originalOutName);

    //     const imgOrig = await blobToImage(originalBlob);
    //     originalW = imgOrig.naturalWidth || imgOrig.width;
    //     originalH = imgOrig.naturalHeight || imgOrig.height;

    //     const file = await pickMaskFile();
    //     if (!file) { return; }

    //     const maskResizedBlob = await resizeImageBlob(file, originalW, originalH);

    //     const maskOutName = `${originalFileName}-rgbyp-mask-${nodeId}.png`;
    //     await uploadFile(maskResizedBlob, maskOutName, "input", "clipspace");

    //     const compositeOutName = `${originalFileName}-rgbyp-composite-${nodeId}.png`;
    //     const compositeBlob = await bakeCompositePngBlob(originalBlob, maskResizedBlob, 0.7);
    //     await uploadFile(compositeBlob, compositeOutName, "input", "clipspace");
    //     const compositeOutPath = `clipspace\\${originalFileName}-rgbyp-composite-${nodeId}.png`;

    //     const ts = Date.now();

    //     const jsonObj = {
    //         rgbyp_timestamp: ts,
    //         original: originalOutName,
    //         mask: maskOutName,
    //         composite: compositeOutName,
    //     };

    //     node.__rgbyp_skip_clear_json_once = true;
    //     updateWidgetValue(node, "rgbyp_json", JSON.stringify(jsonObj), true);


    //     if (!isBridgeNode) {
    //         updateWidgetValue(node, "image", compositeOutPath, true);
    //     } else {
    //         try {
    //             const img = await loadImage(compositeOutName, "input", "clipspace");
    //             node.img = img;
    //             node.imgs = Array.isArray(node.imgs) ? (node.imgs[0] = img, node.imgs) : [img];
    //             // node.graph?.setDirtyCanvas(true, true);

    //         } catch (e) {
    //             console.warn("[RGBYPUtils] handleLoadMask: failed to update node preview", e);
    //         }
    //     }

    // }

    function canvasToBlob(canvas, mime = "image/png", quality = 1.0) {
        return new Promise((resolve) => {
            try {
                if (!canvas || typeof canvas.toBlob !== "function") return resolve(null);
                canvas.toBlob((b) => resolve(b), mime, quality);
            } catch (e) {
                resolve(null);
            }
        });
    }

    async function handleLoadMask(node) {
        const nodeType = (node.type || node.comfyClass || (node.constructor && node.constructor.name) || "") + "";
        const isBridgeNode = nodeType === "RGBYPMaskBridge";

        const nodeId = String(node?.id ?? "");
        if (!nodeId) return;

        // 1) base image from node
        const baseImg = await loadBaseImg(node);
        if (!baseImg) {
            rgbypWarn("handleLoadMask: base image is missing (node has no preview/imgs[0])", { nodeId, nodeType });
            return;
        }

        // 2) resolve filenames (mask/composite) from json or defaults
        const data = getWidgetJSON(node, "rgbyp_json");
        const jsonAvailable = !!(data && typeof data === "object");

        let maskOutName = "";
        let compositeOutName = "";
        let originalFileName = "";
        let originalOutName = "";

        if (jsonAvailable && typeof data.original === "string" && data.original) {
            originalOutName = String(data.original);
        }
        if (jsonAvailable && typeof data.mask === "string" && data.mask) {
            maskOutName = String(data.mask);
        }
        if (jsonAvailable && typeof data.composite === "string" && data.composite) {
            compositeOutName = String(data.composite);
        }

        if (!maskOutName || !compositeOutName) {
            if (isBridgeNode) {
                originalFileName = "RGBYPBridge";
            } else {
                const wImg = getWidget(node, "image") || getWidget(node, "loadImage");
                const imgPath = String(wImg?.value || "");
                if (!imgPath) {
                    rgbypWarn("handleLoadMask: missing image widget value", { nodeId, nodeType });
                    return;
                }
                const { filename } = splitPath(imgPath);
                originalFileName = stemOfFilename(filename);
                if (!originalFileName) originalFileName = "RGBYP";
            }
            if (!originalOutName) originalOutName = `${originalFileName}-rgbyp-original-${nodeId}.png`;
            if (!maskOutName) maskOutName = `${originalFileName}-rgbyp-mask-${nodeId}.png`;
            if (!compositeOutName) compositeOutName = `${originalFileName}-rgbyp-composite-${nodeId}.png`;
        } else {
            originalFileName = originalFileNameFromRgbypFilename(originalOutName || maskOutName || compositeOutName);
        }


        // 3) pick mask file
        const file = await pickMaskFile();
        if (!file) return;

        // 4) read setting "Downscale to maximum side" => downscale_preview_to
        let downscale_preview_to = 0;
        try {
            downscale_preview_to = Number(app.extensionManager.setting.get("AK.RGBYP.downscale_max_side")) || 0;
        } catch (_) {
            downscale_preview_to = 0;
        }

        // 5) compute target size for base image (optional downscale)
        const baseW0 = baseImg.naturalWidth || baseImg.width || 0;
        const baseH0 = baseImg.naturalHeight || baseImg.height || 0;
        if (baseW0 <= 0 || baseH0 <= 0) {
            rgbypWarn("handleLoadMask: invalid base image size", { baseW0, baseH0, nodeId });
            return;
        }

        let targetW = baseW0;
        let targetH = baseH0;

        if (downscale_preview_to > 0) {
            const maxSide = Math.max(baseW0, baseH0);
            if (maxSide > downscale_preview_to) {
                const s = downscale_preview_to / maxSide;
                targetW = Math.max(1, Math.round(baseW0 * s));
                targetH = Math.max(1, Math.round(baseH0 * s));
            }
        }

        // 6) convert base image to blob, and downscale if needed
        const baseCanvas = document.createElement("canvas");
        baseCanvas.width = baseW0;
        baseCanvas.height = baseH0;
        const baseCtx = baseCanvas.getContext("2d");
        baseCtx.drawImage(baseImg, 0, 0, baseW0, baseH0);

        let baseBlob = await canvasToBlob(baseCanvas, "image/png", 1.0);
        if (!baseBlob) {
            rgbypWarn("handleLoadMask: failed to encode base image to blob", { nodeId });
            return;
        }

        if (targetW !== baseW0 || targetH !== baseH0) {
            baseBlob = await resizeImageBlob(baseBlob, targetW, targetH);
        }
        if (!jsonAvailable) {
            try {
                await uploadFile(baseBlob, originalOutName, "input", "clipspace");
            } catch (e) {
                rgbypWarn("handleLoadMask: failed to upload original", { originalOutName, nodeId }, e);
                return;
            }
        }
        // 7) resize chosen mask to base size (after downscale if used)
        const maskResizedBlob = await resizeImageBlob(file, targetW, targetH);

        // 8) save mask to input/clipspace with resolved name
        await uploadFile(maskResizedBlob, maskOutName, "input", "clipspace");

        // 9) bake composite (base + mask) and save composite
        const compositeBlob = await bakeCompositePngBlob(baseBlob, maskResizedBlob, 0.7);
        await uploadFile(compositeBlob, compositeOutName, "input", "clipspace");

        // 10) write json with new timestamp
        const ts = Date.now();
        const jsonObj = {
            rgbyp_timestamp: ts,
            original: originalOutName,
            mask: maskOutName,
            composite: compositeOutName,
        };

        node.__rgbyp_skip_clear_json_once = true;
        updateWidgetValue(node, "rgbyp_json", JSON.stringify(jsonObj), true);

        // 11) update preview (same as now)
        if (!isBridgeNode) {
            const compositeOutPath = `clipspace\\${compositeOutName}`;
            updateWidgetValue(node, "image", compositeOutPath, true);
        } else {
            try {
                const img = await loadImage(compositeOutName, "input", "clipspace");
                node.img = img;
                node.imgs = Array.isArray(node.imgs) ? (node.imgs[0] = img, node.imgs) : [img];
            } catch (e) {
                console.warn("[RGBYPUtils] handleLoadMask: failed to update node preview", e);
            }
        }
    }

    // async function handleResetMask(node) {

    //     const nodeType = (node.type || node.comfyClass || (node.constructor && node.constructor.name) || "") + "";
    //     const isBridgeNode = nodeType === "RGBYPMaskBridge";

    //     const data = getWidgetJSON(node, "rgbyp_json");
    //     const jsonAvailable = !!(data && typeof data === "object" && typeof data.original === "string" && data.original);
    //     if (!jsonAvailable) return;

    //     const nodeId = String(node?.id ?? "");
    //     if (!nodeId) return;

    //     const originalOutName = String(data.original);
    //     const originalFileName = originalFileNameFromRgbypFilename(originalOutName);

    //     const originalBlob = await (await loadFile(originalOutName, "input", "clipspace")).blob();

    //     const compositeOutName = `${originalFileName}-rgbyp-composite-${nodeId}.png`;
    //     await uploadFile(originalBlob, compositeOutName, "input", "clipspace");

    //     const compositeOutPath = `clipspace\\${originalFileName}-rgbyp-composite-${nodeId}.png`;

    //     const ts = Date.now();

    //     const jsonObj = {
    //         rgbyp_timestamp: ts,
    //         original: originalOutName,
    //         composite: compositeOutName,
    //     };

    //     node.__rgbyp_skip_clear_json_once = true;
    //     updateWidgetValue(node, "rgbyp_json", JSON.stringify(jsonObj), true);

    //     if (!isBridgeNode) {
    //         updateWidgetValue(node, "image", compositeOutPath, true);
    //     } else {
    //         try {
    //             const img = await loadImage(compositeOutName, "input", "clipspace");
    //             node.img = img;
    //             node.imgs = Array.isArray(node.imgs) ? (node.imgs[0] = img, node.imgs) : [img];
    //             // node.graph?.setDirtyCanvas(true, true);
    //         } catch (e) {
    //             console.warn("[RGBYPUtils] handleResetMask: failed to update node preview", e);
    //         }
    //     }

    // }
    function runPartialExecutionForNode(node) {
        try {
            // 1) select node in canvas
            if (app?.canvas?.selectNode) app.canvas.selectNode(node);
            if (app?.canvas) app.canvas.node_selected = node;

            // 2) try to click the Partial Execution button in the selection toolbox
            const btn =
                document.querySelector('button[title*="Partial"]') ||
                document.querySelector('button[aria-label*="Partial"]') ||
                document.querySelector('button[title*="Run"]') ||
                document.querySelector('button[aria-label*="Run"]');

            if (btn) {
                btn.click();
                return true;
            }

            console.warn("[RGBYPUtils] Partial Execution button not found in DOM");
        } catch (e) {
            console.warn("[RGBYPUtils] runPartialExecutionForNode failed", e);
        }
        return false;
    }


    async function handleResetMask(node) {
        const nodeType = (node.type || node.comfyClass || (node.constructor && node.constructor.name) || "") + "";
        const isBridgeNode = nodeType === "RGBYPMaskBridge";
        const isLoadImageNode = nodeType === "RGBYPLoadImage";

        if (isBridgeNode) {
            updateWidgetValue(node, "rgbyp_json", "", true);
            runPartialExecutionForNode(node);
            return;
        }

        if (isLoadImageNode) {
            // read json (do NOT use getWidgetJSON(), it is strict)
            const raw = getWidgetValue(node, "rgbyp_json");
            if (!raw) return;

            let obj = null;
            try { obj = JSON.parse(raw); } catch (_) { obj = null; }
            if (!obj || typeof obj !== "object") return;

            const originalName = String(obj.original || "");
            if (!originalName) return;

            // set preview to original (clipspace\filename.png)
            const originalPath = `clipspace\\${originalName}`;

            // update widget (this is the main preview mechanism for RGBYPLoadImage)
            updateWidgetValue(node, "image", originalPath, true);

            // optional: also set node.img/imgs for immediate redraw (harmless if unused)
            try {
                const img = await loadImage(originalName, "input", "clipspace");
                node.img = img;
                node.imgs = Array.isArray(node.imgs) ? (node.imgs[0] = img, node.imgs) : [img];
            } catch (e) {
                console.warn("[RGBYPUtils] handleResetMask: failed to preload original preview image", e);
            }

            // clear json at the end
            updateWidgetValue(node, "rgbyp_json", "", true);

            runPartialExecutionForNode(node);
            return;
        }
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
        const y = BUTTON_MARGIN;

        const bw = 34;
        const total = bw * 2 + BUTTON_GAP;

        const x1 = Math.max(0, Math.floor((w - total) / 2));
        const x2 = x1 + bw + BUTTON_GAP;

        return {
            open: { x: x1, y, w: bw, h: BUTTON_H },
            reset: { x: x2, y, w: bw, h: BUTTON_H },
        };
    }

    function drawIconButton(ctx, rect, img, enabled, bgColor = "#2a2a2a", stColor = "#555") {
        const alpha = enabled ? 1.0 : 0.45;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = bgColor;
        ctx.strokeStyle = stColor;
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

            drawIconButton(ctx, rects.open, NODE_ICONS.open, true, "#223420", "#456a40");
            drawIconButton(ctx, rects.reset, NODE_ICONS.reset, true, "#342020", "#6a4040");
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
            const wDownscale = getWidget(node, "downscale_preview_to");
            if (wDownscale) {
                const enable = !!__rgbyp_ds_enable;
                const maxSide = Number(__rgbyp_ds_maxSide) || 0;
                updateWidgetValue(node, "downscale_preview_to", enable ? maxSide : 0, true);
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
    function applyDownscaleToAllBridgeNodes() {
        // console.log("[RGBYPUtils] applyDownscaleToAllBridgeNodes");
        const nodes = app?.graph?._nodes || [];
        for (const n of nodes) {
            if ((n?.type || n?.comfyClass) === "RGBYPMaskBridge") {
                setDownscaleFactor(n);
            }
        }
    }
    function registerSettings() {
        const S = app.ui.settings;
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
