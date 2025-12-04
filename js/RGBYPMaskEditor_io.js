// Changes in RGBYPMaskEditor_io.js
// Add this import if not already present (it's already there)
import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";

import { GP } from "./RGBYPMaskEditor.js";
import { getNodeState } from "./RGBYPMaskEditor.js";
import { setNodeState } from "./RGBYPMaskEditor.js";

// Existing dataURLtoFile remains unchanged
/* async function computeSHA1FromImage(img) {
    return new Promise((resolve) => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);

        canvas.toBlob(async (blob) => {
            const arrayBuffer = await blob.arrayBuffer();
            const hashBuffer = await crypto.subtle.digest("SHA-1", arrayBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
            resolve(hashHex);
        }, "image/png");
    });
}
 */
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

    // src из ноды (fallback, если json не подойдёт)
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

        // --- 1. Пробуем прочитать meta json из temp ---
        try {
            const metaUrl = `/view?filename=${encodeURIComponent(metaFilename)}&type=temp&_t=${Date.now()}`;
            const resp = await api.fetchApi(metaUrl, { method: "GET" });
            if (resp.ok) {
                const text = await resp.text();
                try {
                    meta = JSON.parse(text);
                    console.log("[RGBYP] initBaseImageAndCanvas: loaded meta", meta);
                } catch (e) {
                    console.warn("[RGBYP] initBaseImageAndCanvas: cannot parse meta json", e);
                    meta = null;
                }
            } else {
                console.log("[RGBYP] initBaseImageAndCanvas: meta not found, fallback to node image", resp.status);
            }
        } catch (e) {
            console.warn("[RGBYP] initBaseImageAndCanvas: error loading meta", e);
        }

        // --- 2. Если meta есть — проверяем, что она относится к текущей картинке ---
        if (meta && typeof meta.original === "string") {
            const currentFilename = getNodeImageFilename(node) || "";
            const originalFilename = meta.original || "";

            // вырезаем постфиксы
            const normalizedCurrent = currentFilename
                ? currentFilename.replace(/_rgbyp_composite.*?(?=\.)/, "")
                : "";
            const normalizedOriginal = originalFilename
                ? originalFilename.replace(/_rgbyp_original.*?(?=\.)/, "")
                : "";

            if (!normalizedCurrent || !normalizedOriginal || normalizedCurrent !== normalizedOriginal) {
                console.log(
                    "[RGBYP] initBaseImageAndCanvas: meta.original does not match current node image -> ignore meta",
                    { normalizedCurrent, normalizedOriginal }
                );
                meta = null;
            }
        } else {
            // meta нет или нет original — считаем, что работать по json нельзя
            meta = null;
        }

        let baseImg = null;
        let maskImg = null;

        // --- 3. Если meta валидна и принадлежит этой картинке — берём original/mask из temp ---
        if (meta && meta.original) {
            try {
                const originalUrl = `/view?filename=${encodeURIComponent(meta.original)}&type=temp&_t=${Date.now()}`;
                baseImg = await loadImageFromUrl(originalUrl);
            } catch (e) {
                console.warn("[RGBYP] Failed to load original from meta, will fallback to node src", e);
                baseImg = null;
            }

            // mask может быть пустой строкой → в этом случае делаем чистую маску
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
                console.log("[RGBYP] initBaseImageAndCanvas: meta.mask empty -> start with clean mask");
                maskImg = null;
            }
        }

        // --- 4. Если baseImg так и не получили — грузим из ноды, как раньше ---
        if (!baseImg) {
            try {
                baseImg = await loadImageFromUrl(fallbackSrc);
            } catch (e) {
                console.error("[RGBYP] Failed to load image from node src", fallbackSrc, e);
                return;
            }
        }

        // --- 5. Запоминаем в state ---
        state.baseImg = baseImg;
        if (maskImg) {
            state.maskImg = maskImg;
        }

        const imgW = baseImg.naturalWidth || baseImg.width;
        const imgH = baseImg.naturalHeight || baseImg.height;

        console.log("[RGBYP] Loaded base image size:", imgW, imgH);

        const containerDiv = state.canvasContainer;
        const prevDisplayW = containerDiv.clientWidth || containerDiv.width || imgW;
        const prevDisplayH = containerDiv.clientHeight || containerDiv.height || imgH;
        console.log("[RGBYP] Previous container size:", prevDisplayW, prevDisplayH);

        // базовый размер для зума
        state.zoomPrevWidth = prevDisplayW;
        state.zoomPrevHeight = prevDisplayH;
        state.zoom = 1;

        // внутреннее разрешение канвасов = размеру картинки
        containerDiv.style.width = imgW + "px";
        containerDiv.style.height = imgH + "px";

        state.originalCanvas.width = imgW;
        state.originalCanvas.height = imgH;
        state.maskCanvas.width = imgW;
        state.maskCanvas.height = imgH;

        // --- 6. Рисуем оригинал ---
        const octx = state.originalCanvas.getContext("2d");
        octx.clearRect(0, 0, imgW, imgH);
        octx.drawImage(baseImg, 0, 0);

        // --- 7. Рисуем маску, если она есть; иначе маска остаётся чистой ---
        const mctx = state.maskCanvas.getContext("2d");
        mctx.clearRect(0, 0, imgW, imgH);
        if (maskImg) {
            mctx.drawImage(maskImg, 0, 0);
        }

        // --- 8. Fit по "contain" в centralPanel (как и раньше) ---
        const outerContainer = state.centralPanel || containerDiv.parentElement;
        const boxW = outerContainer?.clientWidth || prevDisplayW;
        const boxH = outerContainer?.clientHeight || prevDisplayH;

        console.log("[RGBYP] Container size:", boxW, boxH);
        if (boxW && boxH) {
            const scale = Math.min(boxW / imgW, boxH / imgH);
            console.log("[RGBYP] Calculated scale:", scale);

            const cssW = imgW * scale;
            const cssH = imgH * scale;

            containerDiv.style.width = cssW + "px";
            containerDiv.style.height = cssH + "px";
        }

        console.log("[RGBYP] baseImg + mask (if any) loaded, canvases resized and zoomed out");
    })().catch((e) => {
        console.error("[RGBYP] initBaseImageAndCanvas async error:", e);
    });
}

function getNodeImageFilename(node) {
    // Пытаемся вытащить имя файла из src
    let src = null;

    if (node.imgs && Array.isArray(node.imgs) && node.imgs.length > 0 && node.imgs[0]?.src) {
        src = node.imgs[0].src;
    } else if (node.image instanceof Image && node.image.src) {
        src = node.image.src;
    }

    if (!src) return null;

    try {
        // src обычно вида /view?filename=xxx.png&type=...
        const url = new URL(src, window.location.origin);
        const fromParam = url.searchParams.get("filename");

        if (fromParam) return fromParam.replace(/_rgbyp_composite.*?(?=\.)/, "").replace(/_rgbyp_original.*?(?=\.)/, "");

        const pathParts = url.pathname.split("/");
        return pathParts[pathParts.length - 1] || null;
    } catch (e) {
        console.warn("[RGBYP] getNodeImageFilename: failed to parse src", src, e);
        // на крайний случай — грубый парсинг
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
    form.append("type", type);      // <-- ВАЖНО: type в FORM, не в URL
    if (subfolder)
        form.append("subfolder", subfolder);
    form.append("overwrite", "true"); // чтобы перезаписывать файлы с тем же именем

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

        console.log("[RGBYP] uploadComfyFile OK:", file.name, "->", info);
        // info обычно вида { name, subfolder, type: 'temp' }
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

    // ---------- 1. Определяем имя исходной картинки из ноды ----------
    const graphImageFilename = getNodeImageFilename(node);
    if (!graphImageFilename) {
        console.warn("[RGBYP] saveMask: cannot determine graph image filename");
        return;
    }

    const dot = graphImageFilename.lastIndexOf(".");
    const baseName = dot >= 0 ? graphImageFilename.slice(0, dot) : graphImageFilename;
    const ext = ".png";

    // Имена файлов по умолчанию (для нового случая)
    const desiredOriginalName = `${baseName}_rgbyp_original${ext}`;
    const desiredMaskName = `${baseName}_rgbyp_mask${ext}`;
    const desiredCompositeName = `${baseName}_rgbyp_composite${ext}`;

    // Имя JSON по id ноды
    const metaFilename = `rgbyp_${node.id}.json`;

    console.log("[****] saveMask: determined filenames:", { metaFilename, desiredOriginalName, desiredMaskName, desiredCompositeName });

    // ---------- 2. Пробуем прочитать существующий meta JSON ----------
    let meta = null;
    let reuseExistingNames = false;

    try {
        const url = `/view?filename=${encodeURIComponent(metaFilename)}&type=temp&_t=${Date.now()}`;
        // SHA не трогаем — загрузка meta нам не нужна для sha
    } catch (e) {
        console.warn("[RGBYP] saveMask: error loading meta", e);
    }

    // ---------- 3. Решаем: обновление или новый набор файлов ----------
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

            console.log("[RGBYP] saveMask: reuse existing meta, only overwrite mask & composite");
        }
    }

    // ---------- 4. Сохранение original (только если НОВЫЙ набор) ----------
    if (!reuseExistingNames) {
        const tmpCanvas = document.createElement("canvas");
        tmpCanvas.width = baseImg.naturalWidth || baseImg.width;
        tmpCanvas.height = baseImg.naturalHeight || baseImg.height;

        const tctx = tmpCanvas.getContext("2d");
        tctx.drawImage(baseImg, 0, 0);

        const originalDataUrl = tmpCanvas.toDataURL("image/png");
        const originalFile = dataURLtoFile(originalDataUrl, originalName);
        await uploadComfyFile(originalFile, "temp");

        // ❌ УДАЛЕНО: вычисление SHA
        // const sha = await computeSHA1FromImage(baseImg);

        console.log("[RGBYP] saveMask: original saved", originalName);
    }

    // ---------- 5. Сохранение mask ----------
    const maskDataUrl = maskCanvas.toDataURL("image/png");
    const maskFile = dataURLtoFile(maskDataUrl, maskName);
    await uploadComfyFile(maskFile, "temp");
    console.log("[RGBYP] saveMask: mask saved", maskName);

    // ---------- 6. Сохранение composite ----------
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
    console.log("[RGBYP] saveMask: composite saved", compositeName, "opacity =", state.maskOpacity);

    // ---------- 7. Сохранение / обновление meta JSON ----------
    if (!reuseExistingNames) {
        const imgW = baseImg.naturalWidth || baseImg.width || originalCanvas.width;
        const imgH = baseImg.naturalHeight || baseImg.height || originalCanvas.height;

        const metaObj = {
            // ❌ SHA УДАЛЁН
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
        console.log("[RGBYP] saveMask: meta json written", metaFilename, metaObj);

        setNodeState(node.id, {
            tempOriginal: originalName,
            tempMask: maskName,
            tempComposite: compositeName,
        });
        console.log("[NODE STATE] saveMask: temp paths:", getNodeState(node.id).tempComposite);

    } else {
        console.log("[RGBYP] saveMask: meta json left unchanged", metaFilename);
    }

    // ---------- 8. Пишем пути в state для updatePreview ----------
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
 * Делает запечённую картинку (оригинал + маска с учётом maskOpacity)
 * и готовит файл с правильным именем:
 *   <original>_rgbyp_composite.png
 * или, если уже есть постфикс, то оставляет как есть.
 *
 * Плюс здесь же можно (и логично) обновить превью в питон-ноде.
 *
 * Возвращает объект { file, filename } на случай, если захочешь
 * дальше использовать в saveMask или ещё где-то.
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

    console.log("[updatePreview] updatePreview: start");

    const compositeName = state.tempComposite;
    if (!compositeName) {
        console.warn("[RGBYP] updatePreview: no composite in state");
        return;
    }

    // Определяем, наша ли это нода
    const nodeType =
        (node.type || node.comfyClass || (node.constructor && node.constructor.name) || "") + "";
    const isOurNode =
        nodeType === "RGBYPMaskBridge" ||
        nodeType === "LoadImageWithFileData";

    // URL для превью (как было раньше)
    const viewUrl =
        "/view?filename=" +
        compositeName +
        "&type=temp" +
        "&_t=" +
        Date.now();

    const img = new Image();
    console.log("[updatePreview] updatePreview: loading composite from", viewUrl);

    img.onload = () => {
        // ✅ СТАРАЯ ЛОГИКА — обновляем превью ноды
        node.img = img;
        if (Array.isArray(node.imgs)) {
            node.imgs[0] = img;
        } else {
            node.imgs = [img];
        }

        if (app && app.graph) {
            app.graph.setDirtyCanvas(true, true);
        }

        console.log("[updatePreview] updatePreview: preview updated successfully", viewUrl);

        // ✅ ДОП. ЛОГИКА ТОЛЬКО ДЛЯ ЧУЖИХ НОД
        if (!isOurNode) {
            // Для простых нод типа Load Image:
            // кладём запечённую картинку в widget "image",
            // чтобы на выход шла уже composite-картинка из temp.
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
                    console.log(
                        "[updatePreview] updatePreview: updating image widget to",
                        annotatedPath
                    );
                    imageWidget.value = annotatedPath;

                    // Если у виджета есть callback — даём ему шанс отреагировать
                    try {
                        if (typeof imageWidget.callback === "function") {
                            // Сигнатуру у разных виджетов чуть-чуть гуляет, но
                            // большинство спокойно переварит такой вызов.
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
                    console.log(
                        "[updatePreview] updatePreview: no image widget found on foreign node",
                        nodeType
                    );
                }
            }
        }

        // ------------------------------------------------------------
        // 🔧 ДОП. ЛОГИКА: если у ноды есть FLOAT-виджет "updater",
        // то обновляем его значением opacity + случайное число
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

                // крутим рандом пока новое значение совпадает со старым
                // (на всякий случай ограничиваемся 10 попытками)
                while (newVal === oldVal && attempts < 100) {
                    rnd = (Math.random() * 0.02) - 0.01; // от -0.001 до +0.001
                    newVal = state.maskOpacity + rnd;
                    attempts++;
                }

                updaterWidget.value = newVal;

                console.log(
                    `[updatePreview] updater widget set to ${newVal.toFixed(6)} (old=${oldVal.toFixed(6)}, opacity=${state.maskOpacity}, rnd=${rnd.toFixed(6)}, attempts=${attempts})`
                );

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
