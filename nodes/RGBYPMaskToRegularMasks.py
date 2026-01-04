import torch
import json
import numpy as np
from PIL import Image, ImageFilter


class RGBYPMaskToRegularMasks:
    """
    RGBYP Mask To Regular Masks

    Input:
        rgbyp_mask (IMAGE) — color mask from the RGBYP editor,
            expected format (B, H, W, C), float32 in [0..1]

    Colors:
        R = (255,   0,   0)
        G = (  0, 255,   0)
        B = (  0,   0, 255)
        Y = (255, 255,   0)
        P = (255,   0, 255)

    Outputs (all are MASK, float32 [0..1], shape (B, H, W)):
        red_mask
        green_mask
        blue_mask
        yellow_mask
        pink_mask

    Each colored pixel becomes white (1.0) in its mask,
    all other pixels become black (0.0).

    Additional behavior:
        If any mask contains no white pixels (fully black),
        it is replaced with a black mask of size 64x64,
        preserving the batch size (B, 64, 64).
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "rgbyp_mask": ("IMAGE",),
                "own_strength_in_combined": ("BOOLEAN", {"default": False}),
                "grow_strength": ("INT", {"default": 0, "min": 0, "step": 1}),
                "blur_strength": ("INT", {"default": 0, "min": 0, "step": 1}),
            },
            "optional": {
                "strength_settings": ("STRING", {"forceInput": True}),
            },
        }

    DESCRIPTION = "Splits an RGBYP mask into separate masks for each color channel."
    CATEGORY = "AK/RGBYP"
    RETURN_TYPES = ("MASK", "MASK", "MASK", "MASK", "MASK", "MASK")
    RETURN_NAMES = (
        "red_mask",
        "green_mask",
        "blue_mask",
        "yellow_mask",
        "pink_mask",
        "combined_mask",
    )
    FUNCTION = "convert"

    # @classmethod
    # def IS_CHANGED(cls, rgbyp_mask, **kwargs):
    #     return float("nan")

    def _parse_strength_settings(self, v):
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

    def _get_strength(self, settings, use_settings, key):
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

    def _apply_grow_blur(self, mask, grow_strength, blur_strength):
        if mask is None:
            return None

        gs = int(grow_strength) if grow_strength is not None else 0
        bs = int(blur_strength) if blur_strength is not None else 0
        gs = max(gs, 0)
        bs = max(bs, 0)

        if gs == 0 and bs == 0:
            return mask

        device = mask.device
        dtype = mask.dtype

        t = mask.detach().to("cpu").float()

        if t.dim() == 2:
            batch = [t]
            batched = False
        elif t.dim() == 3:
            batch = [t[i] for i in range(t.shape[0])]
            batched = True
        else:
            batch = [t.reshape(t.shape[-2], t.shape[-1])]
            batched = False

        out_list = []
        for m in batch:
            arr = m.numpy()
            arr = np.clip(arr, 0.0, 1.0)
            img = (arr * 255.0 + 0.5).astype(np.uint8)
            pil = Image.fromarray(img, mode="L")

            if gs > 0:
                k = gs * 2 + 1
                pil = pil.filter(ImageFilter.MaxFilter(size=k))

            if bs > 0:
                pil = pil.filter(ImageFilter.GaussianBlur(radius=bs))

            out = torch.from_numpy(np.array(pil, dtype=np.float32) / 255.0)
            out = torch.clamp(out, 0.0, 1.0)
            out_list.append(out)

        if batched:
            out_t = torch.stack(out_list, dim=0)
        else:
            out_t = out_list[0]

        out_t = out_t.to(device=device, dtype=dtype)
        return out_t

    def convert(
        self,
        rgbyp_mask,
        own_strength_in_combined=False,
        grow_strength=0,
        blur_strength=0,
        strength_settings=None,
    ):
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

        settings = self._parse_strength_settings(strength_settings)
        use_settings = isinstance(settings, dict) and settings.get("ak_id") == "mask_strength_settings"

        red_strength = self._get_strength(settings, use_settings, "red_strength")
        green_strength = self._get_strength(settings, use_settings, "green_strength")
        blue_strength = self._get_strength(settings, use_settings, "blue_strength")
        yellow_strength = self._get_strength(settings, use_settings, "yellow_strength")
        pink_strength = self._get_strength(settings, use_settings, "pink_strength")
        combined_strength = self._get_strength(settings, use_settings, "combined_strength")

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

        red_mask_raw = red_mask
        green_mask_raw = green_mask
        blue_mask_raw = blue_mask
        yellow_mask_raw = yellow_mask
        pink_mask_raw = pink_mask

        red_mask = red_mask * red_strength
        green_mask = green_mask * green_strength
        blue_mask = blue_mask * blue_strength
        yellow_mask = yellow_mask * yellow_strength
        pink_mask = pink_mask * pink_strength

        if own_strength_in_combined:
            combined_mask = red_mask + green_mask + blue_mask + yellow_mask + pink_mask
        else:
            combined_mask = (
                red_mask_raw
                + green_mask_raw
                + blue_mask_raw
                + yellow_mask_raw
                + pink_mask_raw
            ) * combined_strength

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
        combined_mask = ensure_non_empty_or_64x64(combined_mask)

        red_mask = self._apply_grow_blur(red_mask, grow_strength, blur_strength)
        green_mask = self._apply_grow_blur(green_mask, grow_strength, blur_strength)
        blue_mask = self._apply_grow_blur(blue_mask, grow_strength, blur_strength)
        yellow_mask = self._apply_grow_blur(yellow_mask, grow_strength, blur_strength)
        pink_mask = self._apply_grow_blur(pink_mask, grow_strength, blur_strength)
        combined_mask = self._apply_grow_blur(combined_mask, grow_strength, blur_strength)

        return (
            red_mask,
            green_mask,
            blue_mask,
            yellow_mask,
            pink_mask,
            combined_mask,
        )


NODE_CLASS_MAPPINGS = {
    "RGBYPMaskToRegularMasks": RGBYPMaskToRegularMasks,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RGBYPMaskToRegularMasks": "RGBYP Mask To Regular Masks",
}
