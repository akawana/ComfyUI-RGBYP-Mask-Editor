import { api } from "../../scripts/api.js";
import { app } from "../../../scripts/app.js";

// RGBYPLoadImage.js
// Adds a "Load Mask" button to RGBYPLoadImage node and handles mask upload, resize, composite, and temp/json saving.

let jsonFileName = null;
let originalFileName = null;
let maskFileName = null;
let compositeFileName = null;
let imageWidget = null;   

(function () {
    // Utility: load HTMLImageElement from a File
    function loadImageFromFile(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = (e) => reject(e);
            img.src = URL.createObjectURL(file);
        });
    }

    // Utility: load HTMLImageElement from URL
    function loadImageFromUrl(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = (e) => reject(e);
            img.src = url;
        });
    }

    // Utility: resize an image into a canvas
    function resizeToCanvas(img, width, height) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        return canvas;
    }

    // Utility: bake mask onto original using opacity
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

    // Upload image blob to temp using ComfyUI API
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
    // Upload text (JSON) to temp using ComfyUI API
    async function uploadJsonToTemp(filename, obj) {
        const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
        await uploadImageToTemp(filename, blob);
    }

    function updateUpdater(node) {
        if (!node || !node.widgets) return;

        // find float widget named "updater"
        const w = node.widgets.find(w => w.name === "updater");
        if (!w) return;

        const oldVal =
            typeof w.value === "number"
                ? w.value
                : parseFloat(w.value) || 0;

        // generate random value in (-0.01 .. +0.01)
        const v = (Math.random() * 0.02) - 0.01;

        // 1) update widget (UI)
        w.value = oldVal + v;

        // 2) update actual node property (used by Python)
        if (node.properties) {
            node.properties["updater"] = oldVal + v;
        }

        // 3) trigger widget callback if exists
        if (w.callback) {
            try { w.callback(oldVal + v); } catch (e) { }
        }

        // 4) redraw UI
        if (node.graph?.setDirtyCanvas) {
            node.graph.setDirtyCanvas(true, true);
        }
    }

    async function deleteFiles(node) {
        // 1) Clean JSON if we already created it
        try {
            if (typeof jsonFileName === "string" && jsonFileName.length > 0) {
                await uploadJsonToTemp(jsonFileName, {});
            }
        } catch (err) {
            console.error("[RGBYPLoadImage] Failed to clean JSON:", err);
        }

        // 2) Decide which image to show in preview: *_original if есть, иначе входную
        let previewUrl = null;

        try {
            // try temp *_original first (only if we have a name)
            if (typeof originalFileName === "string" && originalFileName.length > 0) {
                const tempUrl = api.apiURL(
                    `/view?filename=${encodeURIComponent(originalFileName)}&type=temp&subfolder=`
                );

                // test that this image actually exists and loads
                const testImg = new Image();
                previewUrl = await new Promise((resolve) => {
                    testImg.onload = () => resolve(tempUrl);
                    testImg.onerror = () => resolve(null);
                    testImg.src = tempUrl;
                });
            }

            // fallback: input image from the image widget
            if (!previewUrl && imageWidget && imageWidget.value) {
                previewUrl = api.apiURL(
                    `/view?filename=${encodeURIComponent(imageWidget.value)}&type=input&subfolder=`
                );
            }

            if (previewUrl && node.imgs && node.imgs.length > 0 && node.imgs[0]) {
                const imgHolder = node.imgs[0];
                const imgEl = imgHolder.img || imgHolder;
                imgEl.src = previewUrl;
                imgEl.dataset["src"] = previewUrl;
            }
        } catch (err) {
            console.error("[RGBYPLoadImage] Failed to reset preview:", err);
        }

        // 3) Redraw node
        if (node.graph && node.graph.setDirtyCanvas) {
            node.graph.setDirtyCanvas(true, true);
        }
    }


    function addLoadMaskButton(node) {
        if (!node || node.__rgbyp_loadmask_added) return;
        node.__rgbyp_loadmask_added = true;

        // Find widgets: image and updater
        imageWidget = node.widgets?.find((w) => w.name === "image");
        const updaterWidget = node.widgets?.find((w) => w.name === "updater");

        // Create hidden file input
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".png,.jpg,.jpeg";
        fileInput.style.display = "none";
        document.body.appendChild(fileInput);

        // Create button widgets
        node.addWidget("null", "", null, null, () => { });


        const btnWidget = node.addWidget("button", "Load Mask", null, () => {
            fileInput.value = "";
            fileInput.click();
            updateUpdater(node);
        });

        const resetWidget = node.addWidget("button", "Reset Mask", null, () => {
            deleteFiles(node);
            updateUpdater(node);
        });

        setTimeout(() => {
            if (btnWidget && btnWidget.element) {
                btnWidget.element.classList.add("rgbyp-btn-load");
            }
            if (resetWidget && resetWidget.element) {
                resetWidget.element.classList.add("rgbyp-btn-reset");
            }
        }, 0);


        // Force the buttons to be the first widgets visually
        /*         if (node.widgets && node.widgets.length > 1) {
                    const widgets = node.widgets;
                    const idxLoad = widgets.indexOf(btnWidget);
                    if (idxLoad > 0) {
                        widgets.splice(idxLoad, 1);
                        widgets.unshift(btnWidget);
                    }
                    const idxReset = widgets.indexOf(resetWidget);
                    if (idxReset > 0) {
                        widgets.splice(idxReset, 1);
                        widgets.splice(1, 0, resetWidget);
                    }
                }
         */
        fileInput.addEventListener("change", async (ev) => {
            const file = ev.target.files?.[0];
            if (!file) return;

            // Check that main image is loaded
            const imageName = imageWidget?.value;
            if (!imageName) {
                console.warn("[RGBYPLoadImage] No main image loaded, aborting mask processing.");
                return;
            }

            // Determine unique node id from properties
            const uniqueId = node.properties?.unique_id || node.properties?.["_unique_id"] || node.id;
            if (!uniqueId && uniqueId !== 0) {
                console.warn("[RGBYPLoadImage] No unique_id found, aborting mask processing.");
                return;
            }

            // Build filenames (strip extension from imageName)
            const dotIndex = imageName.lastIndexOf(".");
            const nameNoExt = dotIndex > 0 ? imageName.slice(0, dotIndex) : imageName;
            const baseName = `${nameNoExt}_${uniqueId}`;
            jsonFileName = `${baseName}.json`;
            originalFileName = `${baseName}_original.png`;
            maskFileName = `${baseName}_mask.png`;
            compositeFileName = `${baseName}_composite.png`;

            // updateUpdater(node);

            try {
                // Load original image from input folder
                const origUrl = api.apiURL(
                    `/view?filename=${encodeURIComponent(imageName)}&type=input&subfolder=`
                );
                const origImg = await loadImageFromUrl(origUrl);

                const originalWidth = origImg.width;
                const originalHeight = origImg.height;

                // Resize original to canvas and also upload a copy to temp as originalFileName
                const originalCanvas = resizeToCanvas(origImg, originalWidth, originalHeight);
                await new Promise((resolve, reject) => {
                    originalCanvas.toBlob(async (blob) => {
                        if (!blob) return reject(new Error("Failed to create original blob"));
                        await uploadImageToTemp(originalFileName, blob);
                        resolve();
                    }, "image/png");
                });

                // Load selected mask file as image and resize to match original
                const maskImg = await loadImageFromFile(file);
                const maskCanvas = resizeToCanvas(maskImg, originalWidth, originalHeight);

                // Upload resized mask to temp
                await new Promise((resolve, reject) => {
                    maskCanvas.toBlob(async (blob) => {
                        if (!blob) return reject(new Error("Failed to create mask blob"));
                        await uploadImageToTemp(maskFileName, blob);
                        resolve();
                    }, "image/png");
                });

                // Get opacity from updater widget (FLOAT)
                let opacity = 1.0;
                if (updaterWidget && typeof updaterWidget.value === "number") {
                    opacity = updaterWidget.value;
                }

                // Create baked composite
                const compositeCanvas = bakeComposite(originalCanvas, maskCanvas, opacity);

                // Upload composite to temp
                await new Promise((resolve, reject) => {
                    compositeCanvas.toBlob(async (blob) => {
                        if (!blob) return reject(new Error("Failed to create composite blob"));
                        await uploadImageToTemp(compositeFileName, blob);
                        resolve();
                    }, "image/png");
                });

                // Build and upload json meta
                const meta = {
                    original: originalFileName,
                    mask: maskFileName,
                    composite: compositeFileName,
                    width: originalWidth,
                    height: originalHeight,
                };
                await uploadJsonToTemp(jsonFileName, meta);

                // Update node preview to show composite from temp
                if (node.imgs && node.imgs.length > 0 && node.imgs[0]) {
                    const imgHolder = node.imgs[0];
                    const imgEl = imgHolder.img || imgHolder;
                    const viewUrl = api.apiURL(
                        `/view?filename=${encodeURIComponent(compositeFileName)}&type=temp&subfolder=`
                    );
                    imgEl.src = viewUrl;
                    imgEl.dataset["src"] = viewUrl;
                }

                if (node.graph && node.graph.setDirtyCanvas) {
                    node.graph.setDirtyCanvas(true, true);
                }

                console.log("[RGBYPLoadImage] Mask processed and files saved:", {
                    jsonFileName,
                    originalFileName,
                    maskFileName,
                    compositeFileName,
                });
            } catch (err) {
                console.error("[RGBYPLoadImage] Error while processing mask:", err);
            }
        });
    }

    // Register extension with ComfyUI
    app.registerExtension({
        name: "RGBYPLoadImage.LoadMaskExtension",
        beforeRegisterNodeDef(nodeType, nodeData, appRef) {
            if (nodeData?.name === "RGBYPLoadImage") {
                const oldOnNodeCreated = nodeType.prototype.onNodeCreated;
                nodeType.prototype.onNodeCreated = function () {
                    if (oldOnNodeCreated) {
                        oldOnNodeCreated.apply(this, arguments);
                    }
                    addLoadMaskButton(this);
                };
            }
        },
    });

    const style = document.createElement("style");
    style.textContent = `
    .rgbyp-btn-load {
        background: #3a9bff !important;
        color: white !important;
        border-radius: 6px !important;
        border: 1px solid #1c6bd6 !important;
    }

    .rgbyp-btn-reset {
        background: #ff4d4d !important;
        color: white !important;
        border-radius: 6px !important;
        border: 1px solid #d62828 !important;
    }

    .rgbyp-btn-load:hover {
        background: #1e82e9 !important;
    }

    .rgbyp-btn-reset:hover {
        background: #e43a3a !important;
    }
`;
    document.head.appendChild(style);

})();
