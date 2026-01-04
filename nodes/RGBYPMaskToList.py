import torch
import json


class RGBYPMaskToList:
    """
    RGBYP Mask To List

    Input:
        rgbyp_mask (IMAGE) — color mask from the RGBYP editor,
            expected format (B, H, W, C), float32 in [0..1]

    Colors:
        R = (255,   0,   0)
        G = (  0, 255,   0)
        B = (  0,   0, 255)
        Y = (255, 255,   0)
        P = (255,   0, 255)

    Output:
        masks (LIST of MASK):
            [red_mask, green_mask, blue_mask, yellow_mask, pink_mask]

    Each colored pixel becomes white (1.0) in its mask,
    all other pixels become black (0.0). If a mask is fully black,
    it is replaced with a (B, 64, 64) black mask (same behavior as RGBYPMaskToRegularMasks).
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "rgbyp_mask": ("IMAGE",),
            },
            "optional": {
                "strength_settings": ("STRING", {"forceInput": True}),
            },
        }

    DESCRIPTION = "Splits an RGBYP mask into a list of separate masks for each color channel."
    CATEGORY = "AK/RGBYP"
    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("masks",)
    FUNCTION = "convert"
    OUTPUT_IS_LIST = (True,)

    def convert(self, rgbyp_mask, strength_settings=None):
        """
        rgbyp_mask: torch.Tensor, shape (B, H, W, C), values [0..1]
        """

        if not isinstance(rgbyp_mask, torch.Tensor):
            raise TypeError("rgbyp_mask must be a torch.Tensor")

        if rgbyp_mask.ndim != 4 or rgbyp_mask.shape[-1] < 3:
            raise ValueError(
                f"rgbyp_mask must have shape (B, H, W, C>=3), got {tuple(rgbyp_mask.shape)}"
            )

        device = rgbyp_mask.device
        B, H, W, C = rgbyp_mask.shape

        def _parse_strength_settings(v):
            if v is None:
                return None
            if isinstance(v, str):
                s = v.strip()
                if not s:
                    return None
                try:
                    return json.loads(s)
                except Exception:
                    return None
            if isinstance(v, dict):
                return v
            return None

        settings = _parse_strength_settings(strength_settings)
        use_settings = isinstance(settings, dict) and settings.get("ak_id") == "mask_strength_settings"

        def _get_strength(key):
            if not use_settings:
                return 1.0
            try:
                val = float(settings.get(key, 1.0))
            except Exception:
                val = 1.0
            if val < 0.0:
                val = 0.0
            if val > 1.0:
                val = 1.0
            return val

        red_strength = _get_strength("red_strength")
        green_strength = _get_strength("green_strength")
        blue_strength = _get_strength("blue_strength")
        yellow_strength = _get_strength("yellow_strength")
        pink_strength = _get_strength("pink_strength")

        # Extract R, G, B channels
        r = rgbyp_mask[..., 0]
        g = rgbyp_mask[..., 1]
        b = rgbyp_mask[..., 2]

        # Soft threshold to avoid floating-point mismatches
        thr_hi = 0.5
        thr_lo = 0.5

        # R: R=1, G=0, B=0
        red_bool = (r > thr_hi) & (g < thr_lo) & (b < thr_lo)

        # G: R=0, G=1, B=0
        green_bool = (g > thr_hi) & (r < thr_lo) & (b < thr_lo)

        # B: R=0, G=0, B=1
        blue_bool = (b > thr_hi) & (r < thr_lo) & (g < thr_lo)

        # Y: R=1, G=1, B=0
        yellow_bool = (r > thr_hi) & (g > thr_hi) & (b < thr_lo)

        # P: R=1, G=0, B=1
        pink_bool = (r > thr_hi) & (g < thr_lo) & (b > thr_hi)

        # Convert to float masks (B, H, W)
        red_mask = red_bool.float()
        green_mask = green_bool.float()
        blue_mask = blue_bool.float()
        yellow_mask = yellow_bool.float()
        pink_mask = pink_bool.float()

        # Apply strengths (same logic as RGBYPMaskToRegularMasks)
        red_mask = red_mask * red_strength
        green_mask = green_mask * green_strength
        blue_mask = blue_mask * blue_strength
        yellow_mask = yellow_mask * yellow_strength
        pink_mask = pink_mask * pink_strength

        # If mask has no non-zero pixels, replace with (B, 64, 64) black mask
        def ensure_non_empty_or_64x64(mask):
            if mask.sum() == 0:
                return torch.zeros((B, 64, 64), device=device, dtype=mask.dtype)
            return mask

        red_mask = ensure_non_empty_or_64x64(red_mask)
        green_mask = ensure_non_empty_or_64x64(green_mask)
        blue_mask = ensure_non_empty_or_64x64(blue_mask)
        yellow_mask = ensure_non_empty_or_64x64(yellow_mask)
        pink_mask = ensure_non_empty_or_64x64(pink_mask)

        masks = [
            red_mask,
            green_mask,
            blue_mask,
            yellow_mask,
            pink_mask,
        ]

        return (masks,)


NODE_CLASS_MAPPINGS = {
    "RGBYPMaskToList": RGBYPMaskToList,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RGBYPMaskToList": "RGBYP Mask To List",
}
