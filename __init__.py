# __init__.py
# RGBYP Mask Editor + RGBYPMaskBridge node + LoadImageWithFileData

WEB_DIRECTORY = "./js"

from .nodes.RGBYPMaskBridge import NODE_CLASS_MAPPINGS as RGBYP_BR_MAPPINGS
from .nodes.RGBYPMaskBridge import NODE_DISPLAY_NAME_MAPPINGS as RGBYP_BR_DISPLAY

from .nodes.RGBYPLoadImage import NODE_CLASS_MAPPINGS as LI_MAPPINGS
from .nodes.RGBYPLoadImage import NODE_DISPLAY_NAME_MAPPINGS as LI_DISPLAY

from .nodes.RGBYPMaskToRegularMasks import NODE_CLASS_MAPPINGS as TOM_MAPPINGS
from .nodes.RGBYPMaskToRegularMasks import NODE_DISPLAY_NAME_MAPPINGS as TOM_DISPLAY

NODE_CLASS_MAPPINGS = {
    **RGBYP_BR_MAPPINGS,
    **LI_MAPPINGS,
    **TOM_MAPPINGS,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    **RGBYP_BR_DISPLAY,
    **LI_DISPLAY,
    **TOM_DISPLAY,
}

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]
