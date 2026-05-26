import { app } from "../../scripts/app.js";

import { uploadFile, loadImage, updateWidgetValue, getWidgetValue, getWidgetJSON, getImageWidgetFileAndFolder } from "./AKGeneralUtils.js";

import { GP } from "./RGBYPMaskEditor.js";
import { getNodeState } from "./RGBYPMaskEditor.js";

function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (e) => {
            console.error("[RGBYP] loadImageFromUrl failed:", url, e);
            reject(e);
        };
        img.src = url;
    });
}

function waitForImage(img) {
    return new Promise((resolve, reject) => {
        if (!img) return reject(new Error("[RGBYP] waitForImage: no image"));
        if (img.complete && img.naturalWidth > 0) return resolve(img);
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
    });
}

function withCacheBust(url) {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}_t=${Date.now()}`;
}

async function loadClipspaceImage(nameOnly) {
    const img = await loadImage(nameOnly, "input", "clipspace");
    try {
        img.src = withCacheBust(img.src);
    } catch (_) { }
    return await waitForImage(img);
}

function safeBaseNameFromPath(filename) {
    const lastSlash = filename.lastIndexOf("/");
    const onlyName = lastSlash >= 0 ? filename.slice(lastSlash + 1) : filename;
    const dot = onlyName.lastIndexOf(".");
    return dot >= 0 ? onlyName.slice(0, dot) : onlyName;
}

function parseRgbypFilename(filename) {
    const lastSlash = filename.lastIndexOf("/");
    const nameOnly = lastSlash >= 0 ? filename.slice(lastSlash + 1) : filename;

    const m = nameOnly.match(/^(.*?)-rgbyp(?:-(mask|composite|original))?-(\d+)(?:-(\d+))?\.(png|webp|jpg|jpeg)$/i);
    if (!m) return null;

    const kind = (m[2] || "original").toLowerCase();
    return {
        originalBase: m[1],
        kind,
        nodeId: m[3],
        timestamp: m[4] || null,
        ext: m[5],
    };
}

function buildNamesFromOriginal(originalName, nodeId) {
    const info = parseRgbypFilename(originalName);
    if (!info) return null;

    const base = info.originalBase;
    const ext = `.${info.ext || "png"}`;
    const nid = nodeId || info.nodeId;

    return {
        originalBase: base,
        originalName: `${base}-rgbyp-original-${nid}${ext}`,
        maskName: `${base}-rgbyp-mask-${nid}${ext}`,
        compositeName: `${base}-rgbyp-composite-${nid}${ext}`,
    };
}

function canvasToBlob(canvas, mime = "image/png", quality) {
    return new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), mime, quality);
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


export function initBaseImageAndCanvas() {
    const node = GP.baseNode;
    const state = node ? getNodeState(node.id) : null;

    if (!node || !state || !state.originalCanvas || !state.maskCanvas || !state.canvasContainer) {
        console.warn("[RGBYP] initBaseImageAndCanvas: no node or canvases");
        return;
    }

    let fallbackSrc = null;
    if (node.imgs && Array.isArray(node.imgs) && node.imgs.length > 0 && node.imgs[0]?.src) {
        fallbackSrc = node.imgs[0].src;
    } else if (node.image instanceof Image && node.image.src) {
        fallbackSrc = node.image.src;
    }

    if (!fallbackSrc) {
        console.warn("[RGBYP] initBaseImageAndCanvas: no image src on node");
        return;
    }

    (async () => {
        const rgbypJson = getWidgetJSON(node, "rgbyp_json");

        // Read dhash separately — getWidgetJSON may return null when json has only {dhash}
        try {
            const raw = getWidgetValue(node, "rgbyp_json");
            if (raw) {
                const rawParsed = JSON.parse(raw);
                if (typeof rawParsed?.dhash !== "undefined") {
                    state.rgbypDhash = rawParsed.dhash;
                }
            }
        } catch (_) {}

        let baseImg = null;
        let maskImg = null;

        if (rgbypJson) {
            try {
                baseImg = await loadClipspaceImage(rgbypJson.original);
            } catch (_) {
                baseImg = null;
            }

            if (rgbypJson.mask) {
                try {
                    maskImg = await loadClipspaceImage(rgbypJson.mask);
                } catch (_) {
                    maskImg = null;
                }
            }

            const names = buildNamesFromOriginal(rgbypJson.original, String(node.id));
            if (names) {
                state.rgbypNames = names;
            }
            state.rgbypHadJsonOnOpen = true;
        } else {
            state.rgbypHadJsonOnOpen = false;
        }

        if (!baseImg)
            baseImg = await loadBaseImg(node);

        if (!baseImg) {
            console.error("[RGBYP] initBaseImageAndCanvas: could not load base image, aborting");
            return;
        }

        state.baseImg = baseImg;
        state.maskImg = maskImg || null;

        const imgW = baseImg.naturalWidth || baseImg.width;
        const imgH = baseImg.naturalHeight || baseImg.height;

        const containerDiv = state.canvasContainer;
        const prevDisplayW = containerDiv.clientWidth || containerDiv.width || imgW;
        const prevDisplayH = containerDiv.clientHeight || containerDiv.height || imgH;

        // state.zoomPrevWidth = prevDisplayW;
        // state.zoomPrevHeight = prevDisplayH;
        // state.zoom = 1;

        containerDiv.style.width = imgW + "px";
        containerDiv.style.height = imgH + "px";

        state.originalCanvas.width = imgW;
        state.originalCanvas.height = imgH;
        state.maskCanvas.width = imgW;
        state.maskCanvas.height = imgH;

        const octx = state.originalCanvas.getContext("2d");
        octx.clearRect(0, 0, imgW, imgH);
        octx.drawImage(baseImg, 0, 0);

        const mctx = state.maskCanvas.getContext("2d");
        mctx.clearRect(0, 0, imgW, imgH);
        if (maskImg) {
            mctx.imageSmoothingEnabled = true;
            mctx.imageSmoothingQuality = "high";
            mctx.drawImage(maskImg, 0, 0, imgW, imgH);
        }

        fitImageToPanel(state);

        // const outerContainer = state.centralPanel || containerDiv.parentElement;
        // const boxW = outerContainer?.clientWidth || prevDisplayW;
        // const boxH = outerContainer?.clientHeight || prevDisplayH;

        // if (boxW && boxH) {
        //     const scale = Math.min(boxW / imgW, boxH / imgH);
        //     const cssW = imgW * scale;
        //     const cssH = imgH * scale;

        //     containerDiv.style.width = cssW + "px";
        //     containerDiv.style.height = cssH + "px";

        //     state.zoomBaseWidth = cssW;
        //     state.zoomBaseHeight = cssH;
        //     state.zoom = 1;
        // }
        // else {
        //     state.zoomBaseWidth = imgW;
        //     state.zoomBaseHeight = imgH;
        //     state.zoom = 1;
        // }
    })().catch((e) => {
        console.error("[RGBYP] initBaseImageAndCanvas async error:", e);
    });
}

export async function saveMask() {
    const node = GP.baseNode;

    const nodeType = (node.type || node.comfyClass || (node.constructor && node.constructor.name) || "") + "";
    const isBridgeNode = nodeType === "RGBYPMaskBridge";

    if (!node) {
        console.warn("[RGBYP] saveMask: no GP.baseNode");
        return;
    }

    const state = getNodeState(node.id);
    if (!state) {
        console.warn("[RGBYP] saveMask: no state for node", node.id);
        return;
    }

    const originalCanvas = state.originalCanvas;
    const maskCanvas = state.maskCanvas;
    const baseImg = state.baseImg;

    if (!originalCanvas || !maskCanvas || !baseImg) {
        console.warn("[RGBYP] saveMask: missing canvases or baseImg");
        return;
    }

    const timestamp = Date.now();
    const ext = ".png";

    let names = state.rgbypNames || null;

    if (!names) {
        const tempName = `RGBYPBridge-rgbyp-original-${node.id}${ext}`;
        console.log("[RGBYP] tempName:", tempName);
        const graphImagePath = getImageWidgetFileAndFolder(node, "image");
        const rgbypJson = getWidgetJSON(node, "rgbyp_json");
        const graphImageFilename = graphImagePath ? graphImagePath.fullPath : tempName;
        const rgbypInfo = graphImageFilename && graphImageFilename.includes("-rgbyp-")
            ? parseRgbypFilename(graphImageFilename)
            : null;

        const originalBase = rgbypInfo
            ? rgbypInfo.originalBase
            : safeBaseNameFromPath(graphImageFilename || "image");

        const nodeId = String(node.id);

        names = {
            originalBase,
            originalName: `${originalBase}-rgbyp-original-${nodeId}${ext}`,
            maskName: `${originalBase}-rgbyp-mask-${nodeId}${ext}`,
            compositeName: `${originalBase}-rgbyp-composite-${nodeId}${ext}`,
        };

        state.rgbypNames = names;
    }

    const originalName = names.originalName;
    const maskName = names.maskName;
    const compositeName = names.compositeName;

    const hadJsonOnOpen = !!state.rgbypHadJsonOnOpen;

    if (!hadJsonOnOpen) {
        const tmpCanvas = document.createElement("canvas");
        tmpCanvas.width = baseImg.naturalWidth || baseImg.width;
        tmpCanvas.height = baseImg.naturalHeight || baseImg.height;

        const tctx = tmpCanvas.getContext("2d");
        tctx.drawImage(baseImg, 0, 0);

        const blob = await canvasToBlob(tmpCanvas, "image/png");
        if (blob) {
            await uploadFile(blob, originalName, "input", "clipspace");
        }
    }

    {
        const blob = await canvasToBlob(maskCanvas, "image/png");
        if (blob) {
            await uploadFile(blob, maskName, "input", "clipspace");
        }
    }

    {
        const compCanvas = document.createElement("canvas");
        const w = originalCanvas.width;
        const h = originalCanvas.height;
        compCanvas.width = w;
        compCanvas.height = h;

        const cctx = compCanvas.getContext("2d");
        cctx.clearRect(0, 0, w, h);

        cctx.imageSmoothingEnabled = false;
        cctx.drawImage(baseImg, 0, 0, w, h);

        const alpha = typeof state.maskOpacity === "number"
            ? Math.max(0, Math.min(1, state.maskOpacity))
            : 1;

        cctx.globalAlpha = alpha;
        cctx.drawImage(maskCanvas, 0, 0, w, h);
        cctx.globalAlpha = 1;

        const blob = await canvasToBlob(compCanvas, "image/png");
        if (blob) {
            await uploadFile(blob, compositeName, "input", "clipspace");
        }
    }

    const jsonObj = {
        rgbyp_timestamp: timestamp,
        original: originalName,
        mask: maskName,
        composite: compositeName,
    };

    // Write dhash back exactly as it was — never compute or change it
    if (typeof state.rgbypDhash !== "undefined") {
        jsonObj.dhash = state.rgbypDhash;
    }

    node.__rgbyp_skip_clear_json_once = true;
    updateWidgetValue(node, "rgbyp_json", JSON.stringify(jsonObj), true);

    if (!isBridgeNode) {
        const widgetValue = `clipspace/${compositeName}`;
        updateWidgetValue(node, "image", widgetValue, true);
    } else {
        try {
            const img = await loadImage(compositeName, "input", "clipspace");
            node.img = img;
            node.imgs = Array.isArray(node.imgs) ? (node.imgs[0] = img, node.imgs) : [img];
            // node.graph?.setDirtyCanvas(true, true);
        } catch (e) {
            console.warn("[RGBYP] saveMask: failed to update node preview", e);
        }
    }

}

export function fitImageToPanel(state) {
    const container = state.canvasContainer;
    const panel = state.centralPanel;
    const canvas = state.originalCanvas;

    if (!container || !panel || !canvas) return;

    const imgW = canvas.width;
    const imgH = canvas.height;
    if (!imgW || !imgH) return;

    const boxW = panel.clientWidth;
    const boxH = panel.clientHeight;
    if (!boxW || !boxH) return;

    const scale = Math.min(boxW / imgW, boxH / imgH);
    const cssW = imgW * scale;
    const cssH = imgH * scale;

    container.style.width = cssW + "px";
    container.style.height = cssH + "px";

    state.zoomBaseWidth = cssW;
    state.zoomBaseHeight = cssH;
    state.zoom = 1;

    panel.scrollLeft = Math.max(0, (container.scrollWidth - boxW) / 2);
    panel.scrollTop = Math.max(0, (container.scrollHeight - boxH) / 2);
}

