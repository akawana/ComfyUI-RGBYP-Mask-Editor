class RGBYPMaskStrengthOut:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "settings": ("LIST", {}),
            }
        }

    RETURN_TYPES = ("FLOAT", "FLOAT", "FLOAT", "FLOAT", "FLOAT")
    RETURN_NAMES = (
        "red_strength",
        "green_strength",
        "blue_strength",
        "yellow_strength",
        "pink_strength",
    )
    FUNCTION = "extract"
    CATEGORY = "mask"

    def extract(self, settings):
        vals = list(settings) + [0.0, 0.0, 0.0, 0.0, 0.0]
        return (
            float(vals[0]),
            float(vals[1]),
            float(vals[2]),
            float(vals[3]),
            float(vals[4]),
        )


NODE_CLASS_MAPPINGS = {
    "RGBYPMaskStrengthOut": RGBYPMaskStrengthOut
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RGBYPMaskStrengthOut": "RGBYP Mask Strength Out"
}
