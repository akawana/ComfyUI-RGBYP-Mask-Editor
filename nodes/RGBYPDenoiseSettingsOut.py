class RGBYPDenoiseSettingsOut:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "settings": ("LIST", {}),
            }
        }

    RETURN_TYPES = ("FLOAT", "FLOAT", "FLOAT", "FLOAT", "FLOAT")
    RETURN_NAMES = (
        "red_denoise",
        "green_denoise",
        "blue_denoise",
        "yellow_denoise",
        "pink_denoise",
    )
    FUNCTION = "extract"
    CATEGORY = "utils/settings"

    def extract(self, settings):
        # Ensure length of list
        vals = list(settings) + [0, 0, 0, 0, 0]
        return (
            float(vals[0]),
            float(vals[1]),
            float(vals[2]),
            float(vals[3]),
            float(vals[4]),
        )


NODE_CLASS_MAPPINGS = {
    "RGBYPDenoiseSettingsOut": RGBYPDenoiseSettingsOut
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RGBYPDenoiseSettingsOut": "RGBYP Denoise Settings Out"
}
