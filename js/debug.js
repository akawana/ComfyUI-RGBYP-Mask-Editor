const AKXZ_DEBUG = false;

const ORIGINAL_LOG = console.log;

const SILENT_FILES = [
    "RGBYPLoadImage.js",
    "RGBYPMaskBridgeRedraw.js",
    "RGBYPMaskEditor.js",
    "RGBYPMaskEditor_io.js",
    "RGBYPMaskEditor_keys.js",
    "RGBYPMaskEditor_ui.js"
];

console.log = function (...args) {
    if (!AKXZ_DEBUG) {
        const stack = new Error().stack || "";
        for (const file of SILENT_FILES) {
            if (stack.includes(file)) {
                return;
            }
        }
    }
    ORIGINAL_LOG.apply(console, args);
};
