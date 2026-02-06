
// AddSpacer.js

import { app } from "../../../scripts/app.js";


// const TARGET_NODES = [
//     "RGBYPSaveMask",
//     "RGBYPMaskStrength",
//     "RGBYPMaskCompositeWithStrength",
//     // "RGBYPMaskToList",
// ];

function isSerializableWidget(w) {
    if (!w) return false;
    if (w.options && w.options.serialize === false) return false;
    if (w.serialize === false) return false;
    return true;
}

// Adds vertical gap BEFORE a widget WITHOUT inserting a new widget (so widgets_values indexing stays intact).
function addSpacerBeforeWidget(nodeName, beforeWidgetName, size = 20) {
    app.registerExtension({
        name: `AK.AddSpacerNoWidget.${nodeName}.${beforeWidgetName}`,
        nodeCreated(node) {
            if (node.comfyClass !== nodeName) return;

            const apply = () => {
                const widgets = node.widgets || [];
                const idx = widgets.findIndex(w => w?.name === beforeWidgetName);
                if (idx <= 0) return; // can't add "before" first widget safely this way

                // Find the closest previous widget we can safely expand
                let prevIdx = idx - 1;
                while (prevIdx >= 0 && !isSerializableWidget(widgets[prevIdx])) prevIdx--;
                if (prevIdx < 0) return;

                const prev = widgets[prevIdx];
                const key = `__ak_spacer_before__${beforeWidgetName}`;

                if (prev[key]) return;
                prev[key] = true;

                const origCompute = prev.computeSize;
                prev.computeSize = function (...args) {
                    const base = origCompute ? origCompute.apply(this, args) : [0, 20];
                    const w = Array.isArray(base) ? (base[0] ?? 0) : 0;
                    const h = Array.isArray(base) ? (base[1] ?? 20) : 20;
                    return [w, h + size];
                };

                // Ensure node is tall enough (LiteGraph will often auto-expand, but not always)
                // We don't know exact delta, so add a small buffer once.
                if (!node.__ak_spacer_size_bump) {
                    node.__ak_spacer_size_bump = 1;
                    node.size[1] = Math.max(node.size[1], node.size[1] + size);
                }
            };

            // Run once now (for manual creation) and again after configure (for workflow load)
            apply();
            const origOnConfigure = node.onConfigure;
            node.onConfigure = function () {
                if (origOnConfigure) origOnConfigure.apply(this, arguments);
                apply();
            };
        },
    });
}

// examples
addSpacerBeforeWidget("RGBYPSaveMask", "add_postfix", 20);
addSpacerBeforeWidget("RGBYPMaskStrength", "combined_strength", 20);
addSpacerBeforeWidget("RGBYPMaskCompositeWithStrength", "invert", 20);
