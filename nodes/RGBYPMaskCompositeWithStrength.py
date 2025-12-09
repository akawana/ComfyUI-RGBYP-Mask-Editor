import torch
import torch.nn.functional as F
from typing import List, Optional, Tuple


class RGBYPMaskCompositeWithStrength:
    """
    Composite up to 5 RGBYP masks with per-channel strengths.

    Logic:
    - For each input mask:
      - Normalize to float [0, 1].
      - If it is the first valid mask, remember its shape as base shape.
      - Any subsequent mask is resized to the base shape if needed.
      - Check if the mask is empty (only black values). If empty, skip it.
      - Create a solid gray mask with the same size using the corresponding *_strength value.
      - If invert is True:
          * Invert the input mask.
          * Add the solid mask and inverted mask (clamped to [0, 1]).
        Else (invert is False):
          * Multiply the input mask by the solid mask (clamped to [0, 1]).
      - Store the result in temporal_masks.
    - After all masks are processed:
      - If invert is True, multiply all masks in temporal_masks together.
      - If invert is False, add all masks in temporal_masks together.
    - Return the resulting mask as output.
    """

    @classmethod
    def INPUT_TYPES(cls):
        float_cfg = {
            "min": 0.05,
            "max": 1.0,
            "step": 0.05,
            "default": 0.50,
        }

        return {
            "required": {
                "red_mask": ("MASK",),
                "green_mask": ("MASK",),
                "blue_mask": ("MASK",),
                "yellow_mask": ("MASK",),
                "pink_mask": ("MASK",),
                "red_strength": ("FLOAT", float_cfg),
                "green_strength": ("FLOAT", float_cfg),
                "blue_strength": ("FLOAT", float_cfg),
                "yellow_strength": ("FLOAT", float_cfg),
                "pink_strength": ("FLOAT", float_cfg),
                "invert": ("BOOLEAN", {"default": False}),
            }
        }

    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("mask",)
    FUNCTION = "composite"
    CATEGORY = "RGBYP/Mask"

    @staticmethod
    def _ensure_float_mask(mask: torch.Tensor) -> torch.Tensor:
        """
        Ensure mask is a float tensor in [0, 1].
        If max value is > 1.0, assume 0-255 and normalize.
        """
        if not torch.is_floating_point(mask):
            mask = mask.float()

        max_val = float(mask.max().item()) if mask.numel() > 0 else 0.0
        if max_val > 1.0 + 1e-4:
            mask = mask / 255.0
        return torch.clamp(mask, 0.0, 1.0)

    @staticmethod
    def _is_empty_mask(mask: torch.Tensor) -> bool:
        """
        Consider a mask empty if all values are effectively zero.
        """
        if mask.numel() == 0:
            return True
        return float(mask.max().item()) <= 1e-6

    @staticmethod
    def _resize_to_shape(mask: torch.Tensor, target_shape: torch.Size) -> torch.Tensor:
        """
        Resize mask to match target_shape using bilinear interpolation.
        Expects shapes like [1, H, W] or [H, W]. Returns a tensor with the same rank as input.
        """
        if mask.shape == target_shape:
            return mask

        original_dim = mask.dim()
        if original_dim == 2:
            mask = mask.unsqueeze(0)  # [1, H, W]

        if mask.dim() != 3:
            raise ValueError(
                f"RGBYPMaskCompositeWithStrength: unsupported mask shape {mask.shape} for resize."
            )

        b, h, w = mask.shape
        _, target_h, target_w = target_shape

        mask_4d = mask.unsqueeze(1)  # [B, 1, H, W]
        resized = F.interpolate(
            mask_4d,
            size=(target_h, target_w),
            mode="bilinear",
            align_corners=False,
        )
        resized = resized.squeeze(1)  # [B, H, W]

        if original_dim == 2:
            resized = resized.squeeze(0)

        return resized

    def composite(
        self,
        red_mask: torch.Tensor,
        green_mask: torch.Tensor,
        blue_mask: torch.Tensor,
        yellow_mask: torch.Tensor,
        pink_mask: torch.Tensor,
        red_strength: float,
        green_strength: float,
        blue_strength: float,
        yellow_strength: float,
        pink_strength: float,
        invert: bool,
    ) -> Tuple[torch.Tensor]:
        masks: List[torch.Tensor] = [
            red_mask,
            green_mask,
            blue_mask,
            yellow_mask,
            pink_mask,
        ]
        strengths: List[float] = [
            red_strength,
            green_strength,
            blue_strength,
            yellow_strength,
            pink_strength,
        ]

        temporal_masks: List[torch.Tensor] = []
        base_shape: Optional[torch.Size] = None

        for idx, (mask, strength) in enumerate(zip(masks, strengths)):
            # Normalize to float [0, 1]
            mask = self._ensure_float_mask(mask)

            # Initialize base shape from the first mask
            if base_shape is None:
                base_shape = mask.shape
            else:
                # Resize to base shape if needed
                if mask.shape != base_shape:
                    mask = self._resize_to_shape(mask, base_shape)

            if self._is_empty_mask(mask):
                continue

            s = max(0.0, min(1.0, float(strength)))
            solid = torch.full_like(mask, s)

            if invert:
                inverted = 1.0 - mask
                combined = torch.clamp(inverted + solid, 0.0, 1.0)
            else:
                combined = torch.clamp(mask * solid, 0.0, 1.0)

            temporal_masks.append(combined)

        if base_shape is None:
            raise ValueError(
                "RGBYPMaskCompositeWithStrength: no valid masks provided to determine base shape."
            )

        if not temporal_masks:
            output = torch.zeros(base_shape, dtype=torch.float32)
        else:
            output = temporal_masks[0].clone()
            if invert:
                for tmask in temporal_masks[1:]:
                    output = output * tmask
            else:
                for tmask in temporal_masks[1:]:
                    output = output + tmask
            output = torch.clamp(output, 0.0, 1.0)

        return (output,)


NODE_CLASS_MAPPINGS = {
    "RGBYPMaskCompositeWithStrength": RGBYPMaskCompositeWithStrength,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RGBYPMaskCompositeWithStrength": "RGBYP Mask Composite (With Strength)",
}
