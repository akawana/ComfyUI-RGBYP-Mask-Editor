class RGBYPDenoiseSettings:
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
                "red_denoise": ("FLOAT", float_cfg),
                "green_denoise": ("FLOAT", float_cfg),
                "blue_denoise": ("FLOAT", float_cfg),
                "yellow_denoise": ("FLOAT", float_cfg),
                "pink_denoise": ("FLOAT", float_cfg),
            }
        }

    RETURN_TYPES = ("LIST",)
    RETURN_NAMES = ("settings",)
    FUNCTION = "build"
    CATEGORY = "utils/settings"

    def build(self, red_denoise, green_denoise, blue_denoise, yellow_denoise, pink_denoise):
        return ([red_denoise, green_denoise, blue_denoise, yellow_denoise, pink_denoise],)


NODE_CLASS_MAPPINGS = {
    "RGBYPDenoiseSettings": RGBYPDenoiseSettings
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RGBYPDenoiseSettings": "RGBYP Denoise Settings"
}
