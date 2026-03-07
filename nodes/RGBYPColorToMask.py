import torch


# Target colors in RGB [0..1]
_COLOR_TARGETS = {
    "red":    (1.0, 0.0, 0.0),
    "green":  (0.0, 1.0, 0.0),
    "blue":   (0.0, 0.0, 1.0),
    "yellow": (1.0, 1.0, 0.0),
    "pink":   (1.0, 0.0, 1.0),
}


class RGBYPColorToMask:
    """
    Extracts a mask for a chosen RGBYP color from an image (or batch).
    If the image has an alpha channel, alpha is used as soft mask values.
    color_strength scales the found mask (0 = all black, 1 = unchanged).
    If no matching pixels are found (or image is fully transparent),
    returns a mask filled with empty_mask_color — unaffected by color_strength.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "rgbyp_mask": ("IMAGE",),
                "color": (["red", "green", "blue", "yellow", "pink"], {"default": "red"}),
                "color_strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "black_strength": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "empty_mask_color": (["black", "white"], {"default": "black"}),
            },
        }

    CATEGORY = "AK/RGBYP"
    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("mask",)
    FUNCTION = "execute"
    OUTPUT_IS_LIST = (True,)
    INPUT_IS_LIST = True

    def execute(self, rgbyp_mask, color, color_strength, black_strength, empty_mask_color):
        # Unwrap widget scalars (INPUT_IS_LIST wraps everything)
        color = color[0] if isinstance(color, list) else color
        color_strength = color_strength[0] if isinstance(color_strength, list) else color_strength
        black_strength = black_strength[0] if isinstance(black_strength, list) else black_strength
        empty_mask_color = empty_mask_color[0] if isinstance(empty_mask_color, list) else empty_mask_color

        if not isinstance(rgbyp_mask, list):
            rgbyp_mask = [rgbyp_mask]

        target_r, target_g, target_b = _COLOR_TARGETS[color]
        target = torch.tensor([target_r, target_g, target_b])

        empty_fill = 1.0 if empty_mask_color == "white" else 0.0

        masks = []
        for img_tensor in rgbyp_mask:
            # img_tensor: (B, H, W, C) or (H, W, C)
            if img_tensor.dim() == 3:
                img_tensor = img_tensor.unsqueeze(0)

            B, H, W, C = img_tensor.shape
            device = img_tensor.device
            target_dev = target.to(device)

            # Check full transparency (alpha channel = 0 for all pixels)
            if C == 4:
                alpha = img_tensor[..., 3]  # (B, H, W)
                fully_transparent = (alpha.sum() == 0)
            else:
                fully_transparent = False

            if fully_transparent:
                fill = torch.full((B, H, W), empty_fill, device=device, dtype=torch.float32)
                masks.append(fill)
                continue

            # Detect color pixels: each channel must be close to target
            # Use per-channel threshold matching (same as RGBYPMaskToList: hi/lo = 0.5)
            r = img_tensor[..., 0]
            g = img_tensor[..., 1]
            b = img_tensor[..., 2]
            tr, tg, tb = target_dev[0], target_dev[1], target_dev[2]

            thr = 0.5
            match_r = (r > thr) if tr > 0.5 else (r < thr)
            match_g = (g > thr) if tg > 0.5 else (g < thr)
            match_b = (b > thr) if tb > 0.5 else (b < thr)
            color_match = match_r & match_g & match_b  # bool (B, H, W)

            if color_match.sum() == 0:
                fill = torch.full((B, H, W), empty_fill, device=device, dtype=torch.float32)
                masks.append(fill)
                continue

            if C == 4:
                # Use alpha as soft mask value — gives smooth edges
                alpha = img_tensor[..., 3]
                mask = torch.where(color_match, alpha, torch.zeros_like(alpha))
            else:
                mask = color_match.float()

            # Apply color_strength: scale found color pixels (0 = black, 1 = unchanged)
            mask = mask * color_strength

            # Apply black_strength: lift non-color areas to grey/white.
            # Use mask itself (soft alpha values) to blend — avoids hard color_match boundary.
            if black_strength > 0.0:
                mask = mask + (1.0 - mask) * black_strength

            masks.append(mask)

        return (masks,)


NODE_CLASS_MAPPINGS = {
    "RGBYPColorToMask": RGBYPColorToMask,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RGBYPColorToMask": "RGBYP Color To Mask",
}
