import { api } from "/scripts/api.js";

export function splitPath(p) {
    const s = String(p || "").replace(/\\/g, "/");
    const idx = s.lastIndexOf("/");
    if (idx === -1) return { subfolder: "", filename: s };
    return { subfolder: s.slice(0, idx), filename: s.slice(idx + 1) };
}


export async function uploadFile(blob, name = "result.png", folder = "input", subfolder = "") {
    const fd = new FormData();

    fd.append("image", blob, name);
    fd.append("type", folder);
    fd.append("subfolder", subfolder);
    fd.append("overwrite", "true");

    const resp = await api.fetchApi("/upload/image", {
        method: "POST",
        body: fd,
    });

    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`[AKGeneralUtils] uploadFile() failed: ${resp.status} ${text}`);
    }

}

export async function loadFile(filename, folder = "input", subfolder = "") {
    const params = new URLSearchParams({ filename, subfolder, type: folder });
    const resp = await fetch(`/view?${params}`);
    if (resp.ok) {
        // const text = await resp.text();
        return resp;
    } else {
        throw new Error(`[AKGeneralUtils] loadFile() failed to load ${filename} from ${folder}/${subfolder}: ${resp.status}`);
    }
}

export async function loadFileFromPath(path, folder = "input") {
    const { subfolder, filename } = splitPath(path);
    return loadFile(filename, folder, subfolder);
}

export function loadImage(filename, folder = "input", subfolder = "") {
    return new Promise((resolve, reject) => {
        const params = new URLSearchParams({
            filename,
            subfolder,
            type: folder,
            _ts: Date.now(), // cache-bust
        });        
        const url = `/view?${params.toString()}`;
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

export async function loadImageFromPath(path, folder = "input") {
    const { subfolder, filename } = splitPath(path);
    return loadImage(filename, folder, subfolder);
}

export function updateWidgetValue(node, widgetName, newValue, callCallback = true) {
    const widget = node.widgets.find(w => w.name === widgetName);

    if (!widget) {
        console.warn(`[AKGeneralUtils] updateWidgetValue() widget "${widgetName}" not found in node ${node.id} (${node.comfyClass || node.type})`);
        return false;
    }

    const oldValue = widget.value;
    widget.value = newValue;

    if (widget.type === "combo" && widget.options && widget.options.values && widget.name !== "image") {
        if (!widget.options.values.includes(newValue)) {
            console.warn(
                `[AKGeneralUtils] updateWidgetValue() value "${newValue}" is not in COMBO options for "${widgetName}"`,
                widget.options.values
            );
        }
    }

    if (callCallback && typeof widget.callback === "function") {
        try {
            widget.callback.call(widget, newValue, oldValue, widget);
        } catch (err) {
            console.error(`[AKGeneralUtils] updateWidgetValue() Error in widget "${widgetName}" callback:`, err);
        }
    }

    // node.setDirtyCanvas(true, false);

    return true;
}

export function getWidget(node, widgetName) {
    return node.widgets.find(w => w.name === widgetName);
}

export function getWidgetValue(node, widgetName) {
    const widget = node.widgets.find(w => w.name === widgetName);
    if (!widget) {
        console.warn(`[AKGeneralUtils] getWidgetValue() widget "${widgetName}" not found in node ${node.id} (${node.comfyClass || node.type})`);
        return null;
    }
    return widget.value;
}

export function getWidgetJSON(node, widgetName) {
    const value = getWidgetValue(node, widgetName);
    if (!value) { return null; }
    try {
        const obj = JSON.parse(value);
        if (!obj || typeof obj !== "object") return null;
        if (!obj.original || !obj.composite) return null;
        return obj;
    } catch (_) {
        return null;
    }
}

export function getImageWidgetFileAndFolder(node, widgetName) {
    const fullPath = getWidgetValue(node, widgetName);
    if (!fullPath) {
        return null;
    }

    const parts = fullPath.split('/');
    const filenameWithExt = parts.pop() || "";
    const subfolder = parts.join('/') || "";
    const nameParts = filenameWithExt.split('.');
    const ext = nameParts.pop() || "";
    const name = nameParts.join('.');
    return {
        fullPath: fullPath,
        subfolder: subfolder,
        filename: filenameWithExt,
        name: name,
        ext: ext
    };
}


export function hideWidget(node, name) {
    const w = getWidget(node, name);
    if (!w) return;

    w.computeSize = () => [0, 0];
    w.size = [0, 0];

    const prevDraw = w.draw;
    w.draw = function () {
        if (w._ak_hidden) return;
        return prevDraw?.apply(this, arguments);
    };

    try { if (w.element) w.element.style.display = "none"; } catch (e) { }
}
