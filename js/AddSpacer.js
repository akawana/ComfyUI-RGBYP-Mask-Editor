
// AddSpacer.js

import { app } from "../../../scripts/app.js";


const TARGET_NODES = [
    "RGBYPSaveMask",
    "RGBYPMaskStrength",
    "RGBYPMaskCompositeWithStrength",
    // "RGBYPMaskToList",
];

function addSpacerWidget(nodeName, beforeWidgetName, seze = 20) {
    app.registerExtension({
        name: "AddSpacer",
        nodeCreated(node) {
            if (!TARGET_NODES.has(node.type)) return;

            const origOnConfigure = node.onConfigure;

            node.onConfigure = function () {
                if (origOnConfigure) {
                    origOnConfigure.apply(this, arguments);
                }

                addSpacerWidget(this, targetWidgetName);
            };

            if (!origOnConfigure) {
                queueMicrotask(() => {
                    if (!node.__spacer_added) {
                        addSpacerWidget(node, targetWidgetName);
                    }
                });
            }
        }
    });
}

// examples
addSpacerWidget("RGBYPSaveMask", "add_postfix", 20);
addSpacerWidget("RGBYPMaskStrength", "combined_strength", 20);
addSpacerWidget("RGBYPMaskCompositeWithStrength", "invert", 20);
