import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";

import { GP } from "./RGBYPMaskEditor.js";
import { getNodeState } from "./RGBYPMaskEditor.js";
import { setNodeState } from "./RGBYPMaskEditor.js";

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

export function initBaseImageAndCanvas() {
    const node = GP.baseNode;
    const state = getNodeState(node.id);

    if (!node || !state || !state.originalCanvas || !state.maskCanvas || !state.canvasContainer) {
        console.warn("[RGBYP] initBaseImageAndCanvas: no node or canvases");
        return;
    }

    // src from node (fallback if json is not suitable)
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
        const metaFilename = `rgbyp_${node.id}.json`;
        let meta = null;

        // --- 1. Try to read meta json from temp ---
        try {
            const metaUrl = `/view?filename=${encodeURIComponent(metaFilename)}&type=temp&_t=${Date.now()}`;
            const resp = await api.fetchApi(metaUrl, { method: "GET" });
            if (resp.ok) {
                const text = await resp.text();
                try {
                    meta = JSON.parse(text);
                    // console.log("[RGBYP] initBaseImageAndCanvas: loaded meta", meta);
                } catch (e) {
                    console.warn("[RGBYP] initBaseImageAndCanvas: cannot parse meta json", e);
                    meta = null;
                }
            } else {
                // console.log("[RGBYP] initBaseImageAndCanvas: meta not found, fallback to node image", resp.status);
            }
        } catch (e) {
            console.warn("[RGBYP] initBaseImageAndCanvas: error loading meta", e);
        }

        // --- 2. If meta exists — check that it belongs to the current image ---
        if (meta && typeof meta.original === "string") {
            const currentFilename = getNodeImageFilename(node) || "";
            const originalFilename = meta.original || "";

            // cut postfixes
            const normalizedCurrent = currentFilename
                ? currentFilename.replace(/_rgbyp_composite.*?(?=\.)/, "")
                : "";
            const normalizedOriginal = originalFilename
                ? originalFilename.replace(/_rgbyp_original.*?(?=\.)/, "")
                : "";

            if (!normalizedCurrent || !normalizedOriginal || normalizedCurrent !== normalizedOriginal) {

/*                 console.log(
                    "[RGBYP] initBaseImageAndCanvas: meta.original does not match current node image -> ignore meta",
                    { normalizedCurrent, normalizedOriginal }
                );
 */                
                meta = null;
            }
        } else {
            // meta is missing or has no original — treat json as unusable
            meta = null;
        }

        let baseImg = null;
        let maskImg = null;

        // --- 3. If meta is valid and belongs to this image — take original/mask from temp ---
        if (meta && meta.original) {
            try {
                const originalUrl = `/view?filename=${encodeURIComponent(meta.original)}&type=temp&_t=${Date.now()}`;
                baseImg = await loadImageFromUrl(originalUrl);
            } catch (e) {
                console.warn("[RGBYP] Failed to load original from meta, will fallback to node src", e);
                baseImg = null;
            }

            // mask may be an empty string → in that case we start with a clean mask
            const maskFile = (typeof meta.mask === "string" ? meta.mask.trim() : "");
            if (maskFile) {
                try {
                    const maskUrl = `/view?filename=${encodeURIComponent(maskFile)}&type=temp&_t=${Date.now()}`;
                    maskImg = await loadImageFromUrl(maskUrl);
                } catch (e) {
                    console.warn("[RGBYP] Failed to load mask from meta, will start with empty mask", e);
                    maskImg = null;
                }
            } else {
                // console.log("[RGBYP] initBaseImageAndCanvas: meta.mask empty -> start with clean mask");
                maskImg = null;
            }
        }

        // --- 4. If baseImg is still not loaded — load from node as before ---
        if (!baseImg) {
            try {
                baseImg = await loadImageFromUrl(fallbackSrc);
            } catch (e) {
                console.error("[RGBYP] Failed to load image from node src", fallbackSrc, e);
                return;
            }
        }

        // --- 5. Store in state ---
        state.baseImg = baseImg;
        if (maskImg) {
            state.maskImg = maskImg;
        }

        const imgW = baseImg.naturalWidth || baseImg.width;
        const imgH = baseImg.naturalHeight || baseImg.height;

        // console.log("[RGBYP] Loaded base image size:", imgW, imgH);

        const containerDiv = state.canvasContainer;
        const prevDisplayW = containerDiv.clientWidth || containerDiv.width || imgW;
        const prevDisplayH = containerDiv.clientHeight || containerDiv.height || imgH;
        // console.log("[RGBYP] Previous container size:", prevDisplayW, prevDisplayH);

        // base size for zoom
        state.zoomPrevWidth = prevDisplayW;
        state.zoomPrevHeight = prevDisplayH;
        state.zoom = 1;

        // internal canvas resolution = image size
        containerDiv.style.width = imgW + "px";
        containerDiv.style.height = imgH + "px";

        state.originalCanvas.width = imgW;
        state.originalCanvas.height = imgH;
        state.maskCanvas.width = imgW;
        state.maskCanvas.height = imgH;

        // --- 6. Draw original ---
        const octx = state.originalCanvas.getContext("2d");
        octx.clearRect(0, 0, imgW, imgH);
        octx.drawImage(baseImg, 0, 0);

        // --- 7. Draw mask if it exists; otherwise leave mask clean ---
        const mctx = state.maskCanvas.getContext("2d");
        mctx.clearRect(0, 0, imgW, imgH);
        if (maskImg) {
            mctx.drawImage(maskImg, 0, 0);
        }

        // --- 8. Fit by "contain" into centralPanel (same as before) ---
        const outerContainer = state.centralPanel || containerDiv.parentElement;
        const boxW = outerContainer?.clientWidth || prevDisplayW;
        const boxH = outerContainer?.clientHeight || prevDisplayH;

        // console.log("[RGBYP] Container size:", boxW, boxH);
        if (boxW && boxH) {
            const scale = Math.min(boxW / imgW, boxH / imgH);
            // console.log("[RGBYP] Calculated scale:", scale);

            const cssW = imgW * scale;
            const cssH = imgH * scale;

            containerDiv.style.width = cssW + "px";
            containerDiv.style.height = cssH + "px";
        }

        // console.log("[RGBYP] baseImg + mask (if any) loaded, canvases resized and zoomed out");
    })().catch((e) => {
        console.error("[RGBYP] initBaseImageAndCanvas async error:", e);
    });
}

function getNodeImageFilename(node) {
    // Try to extract the file name from src
    let src = null;

    if (node.imgs && Array.isArray(node.imgs) && node.imgs.length > 0 && node.imgs[0]?.src) {
        src = node.imgs[0].src;
    } else if (node.image instanceof Image && node.image.src) {
        src = node.image.src;
    }

    if (!src) return null;

    try {
        // src is usually like /view?filename=xxx.png&type=...
        const url = new URL(src, window.location.origin);
        const fromParam = url.searchParams.get("filename");

        if (fromParam) return fromParam.replace(/_rgbyp_composite.*?(?=\.)/, "").replace(/_rgbyp_original.*?(?=\.)/, "");

        const pathParts = url.pathname.split("/");
        return pathParts[pathParts.length - 1] || null;
    } catch (e) {
        console.warn("[RGBYP] getNodeImageFilename: failed to parse src", src, e);
        // as a last resort — rough parsing
        const idx = src.indexOf("filename=");
        if (idx >= 0) {
            const rest = src.slice(idx + "filename=".length);
            const amp = rest.indexOf("&");
            return amp >= 0 ? rest.slice(0, amp) : rest;
        }
        return null;
    }
}

async function uploadComfyFile(file, type = "temp", subfolder) {
    const form = new FormData();
    form.append("image", file);
    form.append("type", type);      // IMPORTANT: type in FORM, not in URL
    if (subfolder)
        form.append("subfolder", subfolder);
    form.append("overwrite", "true"); // to overwrite files with the same name

    try {
        const resp = await api.fetchApi("/upload/image", {
            method: "POST",
            body: form,
        });

        const text = await resp.text();
        let info = null;
        try {
            info = JSON.parse(text);
        } catch {
            info = text;
        }

        if (!resp.ok) {
            console.warn("[RGBYP] uploadComfyFile FAILED", file.name, resp.status, info);
            return null;
        }

        // console.log("[RGBYP] uploadComfyFile OK:", file.name, "->", info);
        // info is usually { name, subfolder, type: 'temp' }
        return info;
    } catch (err) {
        console.error("[RGBYP] uploadComfyFile error:", err);
        return null;
    }
}

export async function saveMask() {
    const node = GP.baseNode;
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

    // ---------- 1. Determine the name of the original image from the node ----------
    const graphImageFilename = getNodeImageFilename(node);
    if (!graphImageFilename) {
        console.warn("[RGBYP] saveMask: cannot determine graph image filename");
        return;
    }

    const dot = graphImageFilename.lastIndexOf(".");
    const baseName = dot >= 0 ? graphImageFilename.slice(0, dot) : graphImageFilename;
    const ext = ".png";

    // Default file names (for the new case)
    const desiredOriginalName = `${baseName}_rgbyp_original${ext}`;
    const desiredMaskName = `${baseName}_rgbyp_mask${ext}`;
    const desiredCompositeName = `${baseName}_rgbyp_composite${ext}`;

    // JSON name by node id
    const metaFilename = `rgbyp_${node.id}.json`;

    // console.log("[****] saveMask: determined filenames:", { metaFilename, desiredOriginalName, desiredMaskName, desiredCompositeName });

    // ---------- 2. Try to read existing meta JSON ----------
    let meta = null;
    let reuseExistingNames = false;

    try {
        const url = `/view?filename=${encodeURIComponent(metaFilename)}&type=temp&_t=${Date.now()}`;
        // SHA is not touched — loading meta is not needed for sha
    } catch (e) {
        console.warn("[RGBYP] saveMask: error loading meta", e);
    }

    // ---------- 3. Decide: update or new set of files ----------
    let originalName = desiredOriginalName;
    let maskName = desiredMaskName;
    let compositeName = desiredCompositeName;

    if (meta && meta.mask) {
        const expectedMaskForCurrent = desiredMaskName;

        if (meta.mask === expectedMaskForCurrent) {
            reuseExistingNames = true;
            originalName = meta.original || desiredOriginalName;
            maskName = meta.mask;
            compositeName = meta.composite || desiredCompositeName;

            // console.log("[RGBYP] saveMask: reuse existing meta, only overwrite mask & composite");
        }
    }

    // ---------- 4. Save original (only if this is a NEW set) ----------
    if (!reuseExistingNames) {
        const tmpCanvas = document.createElement("canvas");
        tmpCanvas.width = baseImg.naturalWidth || baseImg.width;
        tmpCanvas.height = baseImg.naturalHeight || baseImg.height;

        const tctx = tmpCanvas.getContext("2d");
        tctx.drawImage(baseImg, 0, 0);

        const originalDataUrl = tmpCanvas.toDataURL("image/png");
        const originalFile = dataURLtoFile(originalDataUrl, originalName);
        await uploadComfyFile(originalFile, "temp");

        // ❌ REMOVED: SHA calculation
        // const sha = await computeSHA1FromImage(baseImg);

        // console.log("[RGBYP] saveMask: original saved", originalName);
    }

    // ---------- 5. Save mask ----------
    const maskDataUrl = maskCanvas.toDataURL("image/png");
    const maskFile = dataURLtoFile(maskDataUrl, maskName);
    await uploadComfyFile(maskFile, "temp");
    // console.log("[RGBYP] saveMask: mask saved", maskName);

    // ---------- 6. Save composite ----------
    const compCanvas = document.createElement("canvas");
    const w = originalCanvas.width;
    const h = originalCanvas.height;
    compCanvas.width = w;
    compCanvas.height = h;

    const cctx = compCanvas.getContext("2d");
    cctx.clearRect(0, 0, w, h);

    cctx.drawImage(baseImg, 0, 0, w, h);

    const alpha = typeof state.maskOpacity === "number"
        ? Math.max(0, Math.min(1, state.maskOpacity))
        : 1;

    cctx.globalAlpha = alpha;
    cctx.drawImage(maskCanvas, 0, 0, w, h);
    cctx.globalAlpha = 1;

    const compositeDataUrl = compCanvas.toDataURL("image/png");
    const compositeFile = dataURLtoFile(compositeDataUrl, compositeName);
    await uploadComfyFile(compositeFile, "temp");
    await uploadComfyFile(compositeFile, "input", "rgbyp");
    // console.log("[RGBYP] saveMask: composite saved", compositeName, "opacity =", state.maskOpacity);

    // ---------- 7. Save / update meta JSON ----------
    if (!reuseExistingNames) {
        const imgW = baseImg.naturalWidth || baseImg.width || originalCanvas.width;
        const imgH = baseImg.naturalHeight || baseImg.height || originalCanvas.height;

        const metaObj = {
            // ❌ SHA REMOVED
            original: originalName,
            mask: maskName,
            composite: compositeName,
            width: imgW,
            height: imgH,
        };

        const metaBlob = new Blob([JSON.stringify(metaObj, null, 2)], {
            type: "application/json",
        });
        const metaFile = new File([metaBlob], metaFilename, {
            type: "application/json",
        });

        await uploadComfyFile(metaFile, "temp");
        // console.log("[RGBYP] saveMask: meta json written", metaFilename, metaObj);

        setNodeState(node.id, {
            tempOriginal: originalName,
            tempMask: maskName,
            tempComposite: compositeName,
        });
        // console.log("[NODE STATE] saveMask: temp paths:", getNodeState(node.id).tempComposite);

    } else {
        // console.log("[RGBYP] saveMask: meta json left unchanged", metaFilename);
    }

    // ---------- 8. Write paths into state for updatePreview ----------
}

export function dataURLtoFile(dataUrl, filename) {
    const arr = dataUrl.split(",");
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : "image/png";
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
}


/**
 * Makes a baked image (original + mask with respect to maskOpacity)
 * and prepares a file with the correct name:
 *   <original>_rgbyp_composite.png
 * or, if there is already a postfix, keeps it as is.
 *
 * Also, it is logical to update the preview in the python node here.
 *
 * Returns an object { file, filename } in case you want
 * to keep using it in saveMask or somewhere else.
 */
export async function updatePreview() {
    const node = GP.baseNode;
    if (!node) {
        console.warn("[RGBYP] updatePreview: no GP.baseNode");
        return;
    }

    const state = getNodeState(node.id);
    if (!state) {
        console.warn("[RGBYP] updatePreview: no state for node", node.id);
        return;
    }

    // console.log("[updatePreview] updatePreview: start");

    const compositeName = state.tempComposite;
    if (!compositeName) {
        console.warn("[RGBYP] updatePreview: no composite in state");
        return;
    }

    // Determine whether this node is ours
    const nodeType =
        (node.type || node.comfyClass || (node.constructor && node.constructor.name) || "") + "";
    const isOurNode =
        nodeType === "RGBYPMaskBridge" ||
        nodeType === "RGBYPLoadImage";

    // URL for preview (as before)
    const viewUrl =
        "/view?filename=" +
        compositeName +
        "&type=temp" +
        "&_t=" +
        Date.now();

    const img = new Image();
    // console.log("[updatePreview] updatePreview: loading composite from", viewUrl);

    img.onload = () => {
        // ✅ OLD LOGIC — update node preview
        node.img = img;
        if (Array.isArray(node.imgs)) {
            node.imgs[0] = img;
        } else {
            node.imgs = [img];
        }

        if (app && app.graph) {
            app.graph.setDirtyCanvas(true, true);
        }

        // console.log("[updatePreview] updatePreview: preview updated successfully", viewUrl);

        // ✅ EXTRA LOGIC ONLY FOR FOREIGN NODES
        if (!isOurNode) {
            // For simple nodes like Load Image:
            // put baked image into widget "image",
            // so that the output uses composite image from temp.
            const annotatedPath = `rgbyp/${compositeName}`;

            if (Array.isArray(node.widgets)) {
                const imageWidget = node.widgets.find(
                    (w) =>
                        w &&
                        (w.name === "image" ||
                            w.type === "image" ||
                            w.widgetType === "image")
                );

                if (imageWidget) {
/*                     console.log(
                        "[updatePreview] updatePreview: updating image widget to",
                        annotatedPath
                    );
 */                    
                    imageWidget.value = annotatedPath;

                    // If the widget has a callback — give it a chance to react
                    try {
                        if (typeof imageWidget.callback === "function") {
                            // Signature varies a bit between widgets, but
                            // most will accept this call.
                            imageWidget.callback(imageWidget.value, app, node, imageWidget);
                        }
                    } catch (e) {
                        console.warn(
                            "[updatePreview] image widget callback error",
                            e
                        );
                    }

                    if (app && app.graph) {
                        app.graph.setDirtyCanvas(true, true);
                    }
                } else {
/*                     console.log(
                        "[updatePreview] updatePreview: no image widget found on foreign node",
                        nodeType
                    );
 */                    
                }
            }
        }

        // ------------------------------------------------------------
        // 🔧 EXTRA LOGIC: if the node has a FLOAT widget "updater",
        // then update it with opacity + random number
        // ------------------------------------------------------------
        if (Array.isArray(node.widgets)) {
            const updaterWidget = node.widgets.find(
                (w) =>
                    w &&
                    (w.name === "updater" || w.label === "updater") &&
                    (w.type === "FLOAT" || w.widgetType === "FLOAT" || typeof w.value === "number")
            );

            if (updaterWidget) {
                const oldVal =
                    typeof updaterWidget.value === "number"
                        ? updaterWidget.value
                        : parseFloat(updaterWidget.value) || 0;

                let rnd = 0;
                let newVal = oldVal;
                let attempts = 0;

                // keep generating random values while the new value equals the old one
                // (just in case, limit to 100 attempts)
                while (newVal === oldVal && attempts < 100) {
                    rnd = (Math.random() * 0.02) - 0.01; // from -0.001 to +0.001
                    newVal = state.maskOpacity + rnd;
                    attempts++;
                }

                updaterWidget.value = newVal;

/*                 console.log(
                    `[updatePreview] updater widget set to ${newVal.toFixed(6)} (old=${oldVal.toFixed(6)}, opacity=${state.maskOpacity}, rnd=${rnd.toFixed(6)}, attempts=${attempts})`
                );
 */
                try {
                    if (typeof updaterWidget.callback === "function") {
                        updaterWidget.callback(updaterWidget.value, app, node, updaterWidget);
                    }
                } catch (e) {
                    console.warn("[updatePreview] updater widget callback error:", e);
                }

                if (app && app.graph) {
                    app.graph.setDirtyCanvas(true, true);
                }
            }
        }

    };

    img.onerror = (e) => {
        console.error("[updatePreview] updatePreview: failed to load composite", viewUrl, e);
    };

    img.src = viewUrl;
}
