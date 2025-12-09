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
            }
        }

    RETURN_TYPES = ("LIST",)
    RETURN_NAMES = ("settings",)
    FUNCTION = "build"
    CATEGORY = "mask"

    def build(self, red_strength, green_strength, blue_strength, yellow_strength, pink_strength):
        return ([red_strength, green_strength, blue_strength, yellow_strength, pink_strength],)


NODE_CLASS_MAPPINGS = {
    "RGBYPMaskStrength": RGBYPMaskStrength
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RGBYPMaskStrength": "RGBYP Mask Strength"
}
