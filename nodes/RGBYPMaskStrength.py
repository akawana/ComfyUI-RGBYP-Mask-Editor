import json

class RGBYPMaskStrength:
    @classmethod
    def INPUT_TYPES(cls):
        float_cfg = {
            "min": 0.05,
            "max": 1.00,
            "step": 0.05,
            "default": 0.50
        }
        return {
            "required": {
                "red_strength": ("FLOAT", float_cfg),
                "green_strength": ("FLOAT", float_cfg),
                "blue_strength": ("FLOAT", float_cfg),
                "yellow_strength": ("FLOAT", float_cfg),
                "pink_strength": ("FLOAT", float_cfg),
                "combined_strength": ("FLOAT", float_cfg),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("strength_settings",)
    FUNCTION = "build"
    CATEGORY = "AK/RGBYP"

    def build(self, red_strength, green_strength, blue_strength, yellow_strength, pink_strength, combined_strength):
        settings = {
            "ak_id": "mask_strength_settings",
            "red_strength": red_strength,
            "green_strength": green_strength,
            "blue_strength": blue_strength,
            "yellow_strength": yellow_strength,
            "pink_strength": pink_strength,
            "combined_strength": combined_strength,
        }
        return (json.dumps(settings, ensure_ascii=False),)


NODE_CLASS_MAPPINGS = {
    "RGBYPMaskStrength": RGBYPMaskStrength
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RGBYPMaskStrength": "RGBYP Mask Strength"
}
