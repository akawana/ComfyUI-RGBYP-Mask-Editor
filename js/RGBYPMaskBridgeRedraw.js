import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

let jsonFileName = null;
let originalFileName = null;
let maskFileName = null;
let compositeFileName = null;

function releaseImage(img) {
    if (!img) return;
    try {
        img.onload = null;
        img.onerror = null;
        img.src = "";
        img = null;
    } catch (_) {
    }
}

function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(img);
        };
        img.onerror = (e) => {
            URL.revokeObjectURL(objectUrl);
            reject(e);
        };
        img.src = objectUrl;
    });
}

function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
        img.src = url;
    });
}

function resizeToCanvas(img, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
}

function bakeComposite(originalCanvas, maskCanvas, opacity) {
    const canvas = document.createElement("canvas");
    canvas.width = originalCanvas.width;
    canvas.height = originalCanvas.height;
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(originalCanvas, 0, 0);

    ctx.globalAlpha = opacity;
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.globalAlpha = 1.0;

    return canvas;
}

async function uploadImageToTemp(filename, blob) {
    const formData = new FormData();
    formData.append("image", blob, filename);
    formData.append("type", "temp");
    formData.append("subfolder", "");
    formData.append("overwrite", "true");

    await api.fetchApi("/upload/image", {
        method: "POST",
        body: formData,
    });
}

async function uploadJsonToTemp(filename, obj) {
    const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
    await uploadImageToTemp(filename, blob);
}

function updateUpdater(node) {
    if (!node || !node.widgets) return;
    const w = node.widgets.find((w) => w.name === "updater");
    if (!w) return;

    const oldVal = typeof w.value === "number" ? w.value : parseFloat(w.value) || 0;
    const v = (Math.random() * 0.02) - 0.01;

    w.value = oldVal + v;
    if (node.properties) node.properties["updater"] = oldVal + v;

    if (w.callback) {
        try { w.callback(oldVal + v); } catch (e) { }
    }

    if (node.graph?.setDirtyCanvas) node.graph.setDirtyCanvas(true, true);
}

function getNodePreviewSrc(node) {
    const img0 = (Array.isArray(node?.imgs) && node.imgs[0]) ? node.imgs[0] : node?.img;
    if (!img0) return null;
    return img0.src || img0?.img?.src || null;
}

function tryResolveFilenameFromSrc(src) {
    if (!src) return null;

    try {
        const url = new URL(src, window.location.origin);
        const qFilename = url.searchParams.get("filename");
        if (qFilename) return decodeURIComponent(qFilename);

        const parts = url.pathname.split("/");
        return parts[parts.length - 1] || null;
    } catch (e) {
        const m = String(src).match(/filename=([^&]+)/);
        if (m) return decodeURIComponent(m[1]);
    }
    return null;
}

function normalizeBaseName(nameNoExt, uniqueId) {
    let s = String(nameNoExt || "");

    const id = String(uniqueId ?? "");
    if (id) {
        s = s.replace(new RegExp(`_${id}_(original|mask|composite)$`), "");
    }

    s = s.replace(/_(original|mask|composite)$/, "");

    return s;
}

function stripExt(name) {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(0, dot) : name;
}

function getUniqueId(node) {
    return node?.properties?.unique_id ?? node?.properties?._unique_id ?? node?.id;
}

async function resetMaskBridge(node) {
    try {
        if (typeof jsonFileName === "string" && jsonFileName.length > 0) {
            await uploadJsonToTemp(jsonFileName, {});
        }
    } catch (err) {
        console.error("[RGBYPMaskBridge] Failed to clean JSON:", err);
    }

    let previewUrl = null;

    try {
        if (typeof originalFileName === "string" && originalFileName.length > 0) {
            const tempUrl = api.apiURL(
                `/view?filename=${encodeURIComponent(originalFileName)}&type=temp&subfolder=`
            );

            const testImg = new Image();
            previewUrl = await new Promise((resolve) => {
                testImg.onload = () => resolve(tempUrl);
                testImg.onerror = () => resolve(null);
                testImg.src = tempUrl;
            });
        }

        if (!previewUrl) {
            const src = getNodePreviewSrc(node);
            previewUrl = src || null;
        }

        if (previewUrl) {
            const holder = (Array.isArray(node.imgs) && node.imgs[0]) ? node.imgs[0] : node.img;
            const imgEl = holder?.img || holder;
            if (imgEl) {
                imgEl.src = previewUrl;
                imgEl.dataset["src"] = previewUrl;
            }
        }
    } catch (err) {
        console.error("[RGBYPMaskBridge] Failed to reset preview:", err);
    }

    if (node.graph?.setDirtyCanvas) node.graph.setDirtyCanvas(true, true);
}

function ensureMaskBridgeButtons(node) {
    if (!node || node.__rgbyp_maskbridge_buttons_added) return;
    node.__rgbyp_maskbridge_buttons_added = true;

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".png,.jpg,.jpeg";
    fileInput.style.display = "none";
    document.body.appendChild(fileInput);

    node.addWidget("null", "", null, null, () => { });


    const btnLoad = node.addWidget("button", "Load Mask", null, () => {
        fileInput.value = "";
        fileInput.click();
        updateUpdater(node);
    });

    const btnReset = node.addWidget("button", "Reset Mask", null, () => {
        resetMaskBridge(node);
        updateUpdater(node);
    });

    setTimeout(() => {
        if (btnLoad?.element) btnLoad.element.classList.add("rgbyp-btn-load");
        if (btnReset?.element) btnReset.element.classList.add("rgbyp-btn-reset");
    }, 0);

    fileInput.addEventListener("change", async (ev) => {
        const file = ev.target.files?.[0];
        if (!file) return;

        const uniqueId = getUniqueId(node);
        if (uniqueId === undefined || uniqueId === null) {
            console.warn("[RGBYPMaskBridge] No unique_id found, aborting mask processing.");
            return;
        }
        const jsonName = `RGBYP_${uniqueId}.json`;
        const jsonUrl = api.apiURL(
            `/view?filename=${encodeURIComponent(jsonName)}&type=temp&subfolder=`
        );
        const meta = await fetch(jsonUrl).then(r => r.json());
        originalFileName = meta.original;
        const src = api.apiURL(
            `/view?filename=${encodeURIComponent(originalFileName)}&type=temp&subfolder=`
        );

        const filename = tryResolveFilenameFromSrc(src);
        if (!filename) {
            console.warn("[RGBYPMaskBridge] Cannot resolve filename from current preview, aborting.");
            return;
        }

        const nameNoExt = stripExt(filename);
        const clean = normalizeBaseName(nameNoExt, uniqueId);
        const baseName = `${clean}_${uniqueId}`;


        jsonFileName = `${baseName}.json`;
        originalFileName = `${baseName}_original.png`;
        maskFileName = `${baseName}_mask.png`;
        compositeFileName = `${baseName}_composite.png`;

        try {
            const origImg = await loadImageFromUrl(src);
            const originalWidth = origImg.width;
            const originalHeight = origImg.height;

            const originalCanvas = resizeToCanvas(origImg, originalWidth, originalHeight);
            await new Promise((resolve, reject) => {
                originalCanvas.toBlob(async (blob) => {
                    if (!blob) return reject(new Error("Failed to create original blob"));
                    await uploadImageToTemp(originalFileName, blob);
                    resolve();
                }, "image/png");
            });

            const maskImg = await loadImageFromFile(file);
            const maskCanvas = resizeToCanvas(maskImg, originalWidth, originalHeight);

            await new Promise((resolve, reject) => {
                maskCanvas.toBlob(async (blob) => {
                    if (!blob) return reject(new Error("Failed to create mask blob"));
                    await uploadImageToTemp(maskFileName, blob);
                    resolve();
                }, "image/png");
            });

            let opacity = 1.0;
            const updaterWidget = node.widgets?.find((w) => w.name === "updater");
            if (updaterWidget && typeof updaterWidget.value === "number") {
                opacity = updaterWidget.value;
            }

            const compositeCanvas = bakeComposite(originalCanvas, maskCanvas, opacity);

            await new Promise((resolve, reject) => {
                compositeCanvas.toBlob(async (blob) => {
                    if (!blob) return reject(new Error("Failed to create composite blob"));
                    await uploadImageToTemp(compositeFileName, blob);
                    resolve();
                }, "image/png");
            });

            const meta = {
                original: originalFileName,
                mask: maskFileName,
                composite: compositeFileName,
                width: originalWidth,
                height: originalHeight,
            };
            await uploadJsonToTemp(jsonFileName, meta);

            if (Array.isArray(node.imgs) && node.imgs.length > 0 && node.imgs[0]) {
                const holder = node.imgs[0];
                const imgEl = holder.img || holder;
                const viewUrl = api.apiURL(
                    `/view?filename=${encodeURIComponent(compositeFileName)}&type=temp&subfolder=`
                );
                imgEl.src = viewUrl;
                imgEl.dataset["src"] = viewUrl;
            } else if (node.img) {
                const imgEl = node.img.img || node.img;
                const viewUrl = api.apiURL(
                    `/view?filename=${encodeURIComponent(compositeFileName)}&type=temp&subfolder=`
                );
                imgEl.src = viewUrl;
                imgEl.dataset["src"] = viewUrl;
            }

            if (node.graph?.setDirtyCanvas) node.graph.setDirtyCanvas(true, true);

            console.log("[RGBYPMaskBridge] Mask processed and files saved:", {
                jsonFileName,
                originalFileName,
                maskFileName,
                compositeFileName,
            });
        } catch (err) {
            console.error("[RGBYPMaskBridge] Error while processing mask:", err);
        }
    });
}

app.registerExtension({
    name: "RGBYPMaskBridgeRedraw",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== "RGBYPMaskBridge") return;

        const oldOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (oldOnNodeCreated) oldOnNodeCreated.apply(this, arguments);
            ensureMaskBridgeButtons(this);
        };
    },

    init(appInstance) {
        const origQueuePrompt = appInstance.queuePrompt?.bind(appInstance);
        if (!origQueuePrompt) {
            console.warn("[RGBYPMaskBridgeRedraw] ERROR: app.queuePrompt not found");
            return;
        }

        appInstance.queuePrompt = async function (...args) {
            const result = await origQueuePrompt(...args);

            try {
                await redrawRGBYPMaskBridgeNodes(appInstance);
            } catch (e) {
                console.error("[RGBYPMaskBridgeRedraw] EXCEPTION during redraw:", e);
            }

            return result;
        };
    },
});


async function redrawRGBYPMaskBridgeNodes(appInstance) {
    // console.log("—————— [RGBYPMaskBridgeRedraw] redraw start ——————");

    const graph = appInstance?.graph;
    if (!graph) {
        console.warn("[RGBYPMaskBridgeRedraw] WARNING: graph not found");
        return;
    }

    if (!graph._nodes) {
        console.warn("[RGBYPMaskBridgeRedraw] WARNING: graph has no nodes");
        return;
    }

    const nodes = graph._nodes;
    // console.log(`[RGBYPMaskBridgeRedraw] total nodes in graph: ${nodes.length}`);

    const rgbypNodes = nodes.filter((node) => node?.type === "RGBYPMaskBridge");

    // console.log(`[RGBYPMaskBridgeRedraw] total RGBYPMaskBridge nodes found: ${rgbypNodes.length}`);

    if (rgbypNodes.length === 0) {
        // console.log("[RGBYPMaskBridgeRedraw] no RGBYPMaskBridge nodes → nothing to redraw");
        // console.log("—————— [RGBYPMaskBridgeRedraw] redraw end ——————");
        return;
    }

    let updatedCount = 0;

    for (const node of rgbypNodes) {
        try {
            // ensureMaskBridgeButtons(node);
            const updated = await tryUpdateCompositePreviewForNode(node);
            if (updated) {
                updatedCount++;
            }
        } catch (e) {
            console.error(`[RGBYPMaskBridgeRedraw] error updating node id=${node.id}:`, e);
        }
    }

    if (updatedCount > 0 && graph.setDirtyCanvas) {
/*         console.log(
            `[RGBYPMaskBridgeRedraw] forcing canvas redraw, previews updated for ${updatedCount} node(s)`
        );
 */        graph.setDirtyCanvas(true, true);
    } else {
        // console.log("[RGBYPMaskBridgeRedraw] no previews updated → canvas redraw skipped");
    }

    // console.log("—————— [RGBYPMaskBridgeRedraw] redraw end ——————");
}

async function tryUpdateCompositePreviewForNode(node) {
    if (!node) {
        console.warn("[RGBYPMaskBridgeRedraw] tryUpdateCompositePreviewForNode: node is null/undefined");
        return false;
    }

    // Take the current image from node.img or node.imgs[0]
    let currentImg = node.img;
    if (!currentImg && Array.isArray(node.imgs) && node.imgs.length > 0) {
        currentImg = node.imgs[0];
    }

    if (!currentImg || !currentImg.src) {
        // console.log(`[RGBYPMaskBridgeRedraw] node id=${node.id}: no current img/src → skip`);
        return false;
    }

    const src = currentImg.src;
    // console.log(`[RGBYPMaskBridgeRedraw] node id=${node.id}: current src='${src}'`);

    // Try to extract filename from query parameters (view?filename=...)
    let filename = null;
    try {
        const url = new URL(src, window.location.origin);
        const qFilename = url.searchParams.get("filename");
        if (qFilename) {
            filename = decodeURIComponent(qFilename);
        } else {
            // fallback option: take everything after the last "/"
            const parts = url.pathname.split("/");
            filename = parts[parts.length - 1] || null;
        }
    } catch (e) {
        console.warn(
            `[RGBYPMaskBridgeRedraw] node id=${node.id}: failed to parse URL, fallback to raw src parsing`
        );
        const m = src.match(/filename=([^&]+)/);
        if (m) {
            filename = decodeURIComponent(m[1]);
        }
    }

    if (!filename) {
        console.warn(`[RGBYPMaskBridgeRedraw] node id=${node.id}: cannot resolve filename from src`);
        return false;
    }

    // console.log(`[RGBYPMaskBridgeRedraw] node id=${node.id}: resolved filename='${filename}'`);

    // If the file is already composite, just use it as is
    let compositeFilename;
    if (filename.toLowerCase().endsWith("_rgbyp_composite.png")) {
        compositeFilename = filename;
    } else {
        // remove extension and add the postfix _rgbyp_composite.png
        const dot = filename.lastIndexOf(".");
        const baseName = dot >= 0 ? filename.slice(0, dot) : filename;
        compositeFilename = `${baseName}_rgbyp_composite.png`;
    }

    /*     console.log(
            `[RGBYPMaskBridgeRedraw] node id=${node.id}: composite filename candidate='${compositeFilename}'`
        );
     */
    // URL for checking and loading composite from input/rgbyp
    const compositeUrl = `/view?filename=${encodeURIComponent(
        compositeFilename
    )}&type=input&subfolder=rgbyp&_t=${Date.now()}`;

    /*     console.log(
            `[RGBYPMaskBridgeRedraw] node id=${node.id}: checking composite URL='${compositeUrl}'`
        );
     */
    // Try to request the image; if 404 — composite does not exist yet
    let resp;
    try {
        resp = await fetch(compositeUrl, { method: "GET" });
    } catch (e) {
        console.error(
            `[RGBYPMaskBridgeRedraw] node id=${node.id}: error fetching composite:`,
            e
        );
        return false;
    }

    if (!resp.ok) {
/*         console.log(
            `[RGBYPMaskBridgeRedraw] node id=${node.id}: composite not found (status ${resp.status}) → skip`
        );
 */        return false;
    }

    /*     console.log(
            `[RGBYPMaskBridgeRedraw] node id=${node.id}: composite EXISTS → updating node preview`
        );
     */

    let oldImg = node.img;
    if (!oldImg && Array.isArray(node.imgs) && node.imgs.length > 0) {
        oldImg = node.imgs[0];
    }
    if (oldImg) {
        releaseImage(oldImg);
    }
    // We will not use resp.body, we just create an Image with the same URL
    const img = new Image();
    img.src = compositeUrl;

    node.img = img;
    if (Array.isArray(node.imgs)) {
        node.imgs[0] = img;
    } else {
        node.imgs = [img];
    }

    /*     console.log(
            `[RGBYPMaskBridgeRedraw] node id=${node.id}: node.img/node.imgs updated to composite`
        );
     */
    return true;
}
