
// AddSpacer.js

import { app } from "../../../scripts/app.js";


const TARGET_NODES = [
    "RGBYPSaveMask",
    "RGBYPMaskStrength",
    "RGBYPMaskCompositeWithStrength",
    // "RGBYPMaskToList",
];

function addSpacerWidget(nodeName, beforeWidgetName, seze=20) {
    app.registerExtension({
        name: `AK.AddSpacer.${nodeName}.${beforeWidgetName}`,
        nodeCreated(node) {
            // console.log(`Adding spacer to ${nodeName} before ${beforeWidgetName}`);
            if (node.comfyClass !== nodeName) return;
            const spacer = node.addWidget("custom", "", "", () => {});
            spacer.serialize = false;
            spacer.computeSize = () => [1, seze];

            const widgets = node.widgets || [];
            const targetIndex = widgets.findIndex(w => w.name === beforeWidgetName);

            widgets.splice(widgets.indexOf(spacer), 1);

            if (targetIndex !== -1) {
                widgets.splice(targetIndex, 0, spacer);
            } else {
                widgets.push(spacer);
            }
        },
    });
}

// examples
addSpacerWidget("RGBYPSaveMask", "add_postfix", 20);
addSpacerWidget("RGBYPMaskStrength", "combined_strength", 20);
addSpacerWidget("RGBYPMaskCompositeWithStrength", "invert", 20);
