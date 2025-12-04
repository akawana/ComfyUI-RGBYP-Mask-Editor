import { app } from "/scripts/app.js";

app.registerExtension({
    name: "RGBYPMaskBridgeRedraw",
    init(appInstance) {
        // console.log("[RGBYPMaskBridgeRedraw] INIT extension loaded");

        const origQueuePrompt = appInstance.queuePrompt?.bind(appInstance);
        if (!origQueuePrompt) {
            console.warn("[RGBYPMaskBridgeRedraw] ERROR: app.queuePrompt not found");
            return;
        }

        appInstance.queuePrompt = async function (...args) {
            // console.log("[RGBYPMaskBridgeRedraw] queuePrompt → START");

            const result = await origQueuePrompt(...args);

            // console.log("[RGBYPMaskBridgeRedraw] queuePrompt → FINISHED, now checking RGBYPMaskBridge nodes…");

            try {
                await redrawRGBYPMaskBridgeNodes(appInstance);
            } catch (e) {
                console.error("[RGBYPMaskBridgeRedraw] EXCEPTION during redraw:", e);
            }

            // console.log("[RGBYPMaskBridgeRedraw] queuePrompt → END");
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
