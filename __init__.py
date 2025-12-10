# __init__.py
# RGBYP Mask Editor + RGBYPMaskBridge node + LoadImageWithFileData

WEB_DIRECTORY = "./js"

from .nodes.RGBYPMaskBridge import NODE_CLASS_MAPPINGS as RGBYP_BR_MAPPINGS
from .nodes.RGBYPMaskBridge import NODE_DISPLAY_NAME_MAPPINGS as RGBYP_BR_DISPLAY

from .nodes.RGBYPLoadImage import NODE_CLASS_MAPPINGS as LI_MAPPINGS
from .nodes.RGBYPLoadImage import NODE_DISPLAY_NAME_MAPPINGS as LI_DISPLAY

from .nodes.RGBYPMaskToRegularMasks import NODE_CLASS_MAPPINGS as TOM_MAPPINGS
from .nodes.RGBYPMaskToRegularMasks import NODE_DISPLAY_NAME_MAPPINGS as TOM_DISPLAY

from .nodes.RGBYPMaskStrength import NODE_CLASS_MAPPINGS as MS_MAPPINGS
from .nodes.RGBYPMaskStrength import NODE_DISPLAY_NAME_MAPPINGS as MS_DISPLAY

from .nodes.RGBYPMaskStrengthOut import NODE_CLASS_MAPPINGS as MSOUT_MAPPINGS
from .nodes.RGBYPMaskStrengthOut import NODE_DISPLAY_NAME_MAPPINGS as MSOUT_DISPLAY

from .nodes.RGBYPMaskCompositeWithStrength import NODE_CLASS_MAPPINGS as COMP_MAPPINGS
from .nodes.RGBYPMaskCompositeWithStrength import NODE_DISPLAY_NAME_MAPPINGS as COMP_DISPLAY

from .nodes.RGBYPSaveMask import NODE_CLASS_MAPPINGS as SM_MAPPINGS
from .nodes.RGBYPSaveMask import NODE_DISPLAY_NAME_MAPPINGS as SM_DISPLAY

NODE_CLASS_MAPPINGS = {
    **RGBYP_BR_MAPPINGS,
    **LI_MAPPINGS,
    **TOM_MAPPINGS,
    **MS_MAPPINGS,
    **MSOUT_MAPPINGS,
    **COMP_MAPPINGS,
    **SM_MAPPINGS,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    **RGBYP_BR_DISPLAY,
    **LI_DISPLAY,
    **TOM_DISPLAY,
    **MS_DISPLAY,
    **MSOUT_DISPLAY,
    **COMP_DISPLAY,
    **SM_DISPLAY,
}

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]
