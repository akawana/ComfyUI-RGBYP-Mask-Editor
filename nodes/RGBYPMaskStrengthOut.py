import json

class RGBYPMaskStrengthOut:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "strength_settings": ("STRING", {"default": "", "multiline": False, "forceInput": True}),
            }
        }

    RETURN_TYPES = ("FLOAT", "FLOAT", "FLOAT", "FLOAT", "FLOAT", "FLOAT")
    RETURN_NAMES = (
        "red_strength",
        "green_strength",
        "blue_strength",
        "yellow_strength",
        "pink_strength",
        "combined_strength",
    )
    FUNCTION = "extract"
    CATEGORY = "mask"

    def _to_float(self, v, default=0.0):
        try:
            if v is None:
                return default
            return float(v)
        except Exception:
            return default

    def _parse_json(self, s):
        if s is None:
            return None
        if isinstance(s, dict):
            return s
        if isinstance(s, str):
            st = s.strip()
            if st == "":
                return None
            try:
                return json.loads(st)
            except Exception:
                return None
        return None

    def extract(self, strength_settings):
        data = self._parse_json(strength_settings)

        if not isinstance(data, dict):
            return (None, None, None, None, None, None)

        if str(data.get("ak_id", "")).strip() != "mask_strength_settings":
            return (None, None, None, None, None, None)

        return (
            self._to_float(data.get("red_strength", 0.0)),
            self._to_float(data.get("green_strength", 0.0)),
            self._to_float(data.get("blue_strength", 0.0)),
            self._to_float(data.get("yellow_strength", 0.0)),
            self._to_float(data.get("pink_strength", 0.0)),
            self._to_float(data.get("combined_strength", 0.0)),
        )


NODE_CLASS_MAPPINGS = {
    "RGBYPMaskStrengthOut": RGBYPMaskStrengthOut
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RGBYPMaskStrengthOut": "RGBYP Mask Strength Out"
}
