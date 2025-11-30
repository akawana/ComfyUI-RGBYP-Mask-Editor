import { app } from "../../scripts/app.js";
import { openMaskEditor } from "./RGBYPMaskEditor_ui.js";

app.registerExtension({
    name: "RGBYP Mask Editor",

    async setup(appInstance) {
        function resolveImageSource(node) {
            const widgets = node.widgets || [];

            for (const w of widgets) {
                if (typeof w.value === "string" && /\.(png|jpg|jpeg|webp|bmp|gif)$/i.test(w.value)) {
                    const filename = w.value;
                    const subfolder = w.dir || "";
                    const imageType = w.image_type || "input";
                    return {
                        filename,
                        subfolder,
                        type: imageType,
                        widget: w,
                    };
                }

                if (w.value && typeof w.value === "object" && w.value.filename) {
                    const filename = w.value.filename;
                    const subfolder = w.value.subfolder || w.value.sub_dir || "";
                    const imageType = w.value.type || w.value.image_type || "input";
                    return {
                        filename,
                        subfolder,
                        type: imageType,
                        widget: w,
                    };
                }
            }

            if (Array.isArray(node.imgs) && node.imgs.length > 0) {
                for (const imgInfo of node.imgs) {
                    if (imgInfo && typeof imgInfo === "object" && imgInfo.filename) {
                        const filename = imgInfo.filename;
                        const subfolder = imgInfo.subfolder || imgInfo.sub_dir || "";
                        const imageType = imgInfo.type || imgInfo.image_type || "input";
                        return {
                            filename,
                            subfolder,
                            type: imageType,
                            widget: null,
                        };
                    }

                    if (imgInfo && typeof imgInfo.src === "string" && imgInfo.src.includes("filename=")) {
                        try {
                            const url = new URL(imgInfo.src, window.location.origin);
                            const filename = url.searchParams.get("filename");
                            if (!filename) continue;
                            const type = url.searchParams.get("type") || "input";
                            const subfolder = url.searchParams.get("subfolder") || "";
                            return {
                                filename,
                                subfolder,
                                type,
                                widget: null,
                            };
                        } catch (e) { }
                    }
                }
            }

            if (node.image instanceof Image && typeof node.image.src === "string" && node.image.src.includes("filename=")) {
                try {
                    const url = new URL(node.image.src, window.location.origin);
                    const filename = url.searchParams.get("filename");
                    if (filename) {
                        const type = url.searchParams.get("type") || "input";
                        const subfolder = url.searchParams.get("subfolder") || "";
                        return {
                            filename,
                            subfolder,
                            type,
                            widget: null,
                        };
                    }
                } catch (e) { }
            }

            const nodeIdStr = String(node.id);
            const selectors = [
                `div[data-id="${nodeIdStr}"]`,
                `div[node_id="${nodeIdStr}"]`,
                `.litegraphnode[data-id="${nodeIdStr}"]`,
            ];

            let container = null;
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el) {
                    container = el;
                    break;
                }
            }

            let imgs;
            if (container) {
                imgs = container.querySelectorAll("img");
            } else {
                imgs = document.querySelectorAll("img");
            }

            for (const imgEl of imgs) {
                if (!imgEl.src) continue;
                if (!imgEl.src.includes("filename=")) continue;

                try {
                    const url = new URL(imgEl.src, window.location.origin);
                    const filename = url.searchParams.get("filename");
                    if (!filename) continue;
                    const type = url.searchParams.get("type") || "input";
                    const subfolder = url.searchParams.get("subfolder") || "";
                    return {
                        filename,
                        subfolder,
                        type,
                        widget: null,
                    };
                } catch (e) { }
            }

            return null;
        }

        function addMenuEntry() {
            const LGraphCanvas = window.LGraphCanvas;
            if (!LGraphCanvas) return;

            const proto = LGraphCanvas.prototype;
            const origGetNodeMenuOptions = proto.getNodeMenuOptions;

            proto.getNodeMenuOptions = function (node) {
                let options = [];
                try {
                    options = origGetNodeMenuOptions
                        ? origGetNodeMenuOptions.call(this, node) || []
                        : [];
                } catch (e) {
                    options = options || [];
                }
                options.unshift(null);
                options.unshift({
                    content: `
                    <span style="display:flex;align-items:center;gap:6px;">
                        <img src="/extensions/ComfyUI-RGBYP-Mask-Editor/i_menu.png"
                            style="width:16px;height:16px;image-rendering:pixelated;">
                        <span>RGBYP Mask Editor</span>
                    </span>
                    `,
                    // content: "RGBYP Mask Editor",
                    callback: () => {
                        const info = resolveImageSource(node);
                        if (!info) {
                            alert(
                                "RGBYP Mask Editor: Could not find an image file in this node.\n" +
                                "For Load Image, please select an image first."
                            );
                            return;
                        }

                        openMaskEditor(node, info.widget, info);
                    },
                });

                return options;
            };
        }

        addMenuEntry();

        function applyRGBYPCompositePreviews() {
            if (!app.graph || !app.graph._nodes) {
                return;
            }

            for (const node of app.graph._nodes) {
                const props = node.properties || {};
                const compositeName = props["rgbyp_composite"];
                if (!compositeName) continue;

                const viewUrl = `/view?filename=${encodeURIComponent(
                    compositeName
                )}&type=temp&_t=${Date.now()}`;

                const testImg = new Image();

                testImg.onload = () => {
                    let img = node.imgs && node.imgs[0];
                    if (!(img instanceof Image)) {
                        img = new Image();
                        node.imgs = [img];
                    }

                    img.src = viewUrl;

                    node.setDirtyCanvas?.(true, true);
                    app.graph.setDirtyCanvas(true, true);
                };

                testImg.onerror = () => { };

                testImg.src = viewUrl;

                node.setDirtyCanvas?.(true, true);
            }

            app.graph.setDirtyCanvas(true, true);
        }

        /*
        
                const origLoadGraphData = app.loadGraphData;
                app.loadGraphData = async function (data) {
                    const result = await origLoadGraphData.call(this, data);
        
                    const applySafe = () => {
                        try {
                            applyRGBYPCompositePreviews();
                        } catch (e) {}
                    };
        
                    setTimeout(applySafe, 200);
        
                    return result;
                };
        */
    },

});