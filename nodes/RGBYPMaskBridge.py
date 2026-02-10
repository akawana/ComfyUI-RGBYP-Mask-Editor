import json
from typing import Any, Dict, Optional

import torch
from PIL import Image
import numpy as np

from .RGBYPUtils import (
    _make_black_64,
    _load_image_from_path,
    save_image_tensor_to_clipspace,
    bake_composite_with_mask,
    clipspace_path,
    is_image_changed,
)


def _downscale_tensor_max_side(image: torch.Tensor, max_side: int) -> torch.Tensor:
    if not isinstance(image, torch.Tensor) or image.dim() != 4 or image.shape[0] != 1:
        return image
    if not isinstance(max_side, int) or max_side <= 0:
        return image

    _, h, w, c = image.shape
    h = int(h)
    w = int(w)
    if max(h, w) <= max_side:
        return image

    scale = float(max_side) / float(max(h, w))
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))

    dev = image.device
    dt = image.dtype

    t = image.detach()
    if t.device.type != "cpu":
        t = t.to("cpu")
    t = t.float().clamp(0.0, 1.0)[0]

    arr = (t.numpy() * 255.0).round().astype(np.uint8)
    mode = "RGBA" if int(c) == 4 else "RGB"
    img = Image.fromarray(arr, mode=mode)

    try:
        resample = Image.Resampling.LANCZOS
    except Exception:
        resample = Image.LANCZOS

    img = img.resize((nw, nh), resample=resample)
    arr2 = np.array(img).astype(np.float32) / 255.0
    out = torch.from_numpy(arr2)[None, ...].to(device=dev, dtype=dt)
    return out.clamp(0.0, 1.0)


def _is_mask_64x64(mask: Any) -> bool:
    if not isinstance(mask, torch.Tensor) or mask.dim() != 4 or mask.shape[0] != 1:
        return False
    try:
        return int(mask.shape[1]) == 64 and int(mask.shape[2]) == 64
    except Exception:
        return False


class RGBYPMaskBridge:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "downscale_preview_to": (
                    "INT",
                    {
                        "default": 512,
                        "min": 0,
                        "max": 3200,
                        "step": 1,
                    },
                ),
                "rgbyp_json": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                    },
                ),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    DESCRIPTION = "Pass-through image + cached RGBYP mask; updates preview on input changes."
    CATEGORY = "AK/RGBYP"
    RETURN_TYPES = ("IMAGE", "IMAGE")
    RETURN_NAMES = ("image", "rgbyp_mask")
    OUTPUT_NODE = True
    FUNCTION = "execute"

    _state: Dict[str, Dict[str, Any]] = {}

    def _get_state(self, unique_id: Optional[str], image: torch.Tensor) -> Dict[str, Any]:
        uid = str(unique_id) if unique_id is not None else "none"
        st = self._state.get(uid)
        if st is None:
            st = {
                "mask_cache": _make_black_64(device=str(image.device), dtype=image.dtype),
                "previousTimestamp": 0,
                "prev_input_sig": None,
            }
            self._state[uid] = st
        else:
            m = st.get("mask_cache")
            if isinstance(m, torch.Tensor):
                try:
                    st["mask_cache"] = m.to(device=image.device, dtype=image.dtype)
                except Exception:
                    pass
        return st

    def execute(
        self,
        image,
        downscale_preview_to=512,
        rgbyp_json="",
        unique_id=None,
    ):
        output_image = image

        st = self._get_state(unique_id, image)

        input_changed, new_sig = is_image_changed(st.get("prev_input_sig"), image)
        st["prev_input_sig"] = new_sig

        rgbyp_json_available = bool(rgbyp_json and str(rgbyp_json).strip())

        previousTimestamp = int(st.get("previousTimestamp", 0) or 0)

        parsed = None
        if rgbyp_json_available:
            try:
                parsed = json.loads(rgbyp_json)
            except Exception:
                parsed = None

        mask_temp = None
        if rgbyp_json_available and isinstance(parsed, dict):
            ts = parsed.get("rgbyp_timestamp", 0)
            try:
                ts_int = int(ts)
            except Exception:
                ts_int = 0

            if ts_int != previousTimestamp:
                mask_name = parsed.get("mask", "")
                if isinstance(mask_name, str) and mask_name.strip():
                    mp = clipspace_path(mask_name.strip())
                    mask_temp = _load_image_from_path(mp, ref_tensor=image)
                    if isinstance(mask_temp, torch.Tensor):
                        st["mask_cache"] = mask_temp.to(device=image.device, dtype=image.dtype)

            st["previousTimestamp"] = ts_int

        if not rgbyp_json_available:
            if not _is_mask_64x64(st.get("mask_cache")):
                st["mask_cache"] = _make_black_64(device=str(image.device), dtype=image.dtype)
            st["previousTimestamp"] = 0

        preview_image = image
        if isinstance(downscale_preview_to, int) and downscale_preview_to > 0:
            preview_image = _downscale_tensor_max_side(image, int(downscale_preview_to))

        original_filename = f"RGBYPBridge-rgbyp-original-{unique_id}.png"
        saved_original = save_image_tensor_to_clipspace(preview_image, original_filename, max_side=0)
        original_filename = saved_original or ""

        preview_filename = ""
        if input_changed and rgbyp_json_available and isinstance(parsed, dict):
            mask_name = parsed.get("mask", "")
            mask_tensor = None
            if isinstance(mask_name, str) and mask_name.strip():
                mp = clipspace_path(mask_name.strip())
                mask_tensor = _load_image_from_path(mp, ref_tensor=image)

            if isinstance(mask_tensor, torch.Tensor):
                st["mask_cache"] = mask_tensor.to(device=image.device, dtype=image.dtype)

            comp = bake_composite_with_mask(preview_image, st["mask_cache"])
            if isinstance(comp, torch.Tensor):
                composite_filename = f"RGBYPBridge-rgbyp-composite-{unique_id}.png"
                saved_comp = save_image_tensor_to_clipspace(comp, composite_filename, max_side=0)
                preview_filename = saved_comp or ""
            if not preview_filename:
                preview_filename = original_filename

        elif input_changed and (not rgbyp_json_available):
            preview_filename = original_filename

        preview_image = None
        mask_temp = None

        ui = {
            "images": [
                {
                    "filename": preview_filename if preview_filename else "",
                    "subfolder": "clipspace",
                    "type": "input",
                }
            ],
            "rgbyp_json": [rgbyp_json if rgbyp_json is not None else ""],
        }

        return {"result": (output_image, st["mask_cache"]), "ui": ui}


NODE_CLASS_MAPPINGS = {"RGBYPMaskBridge": RGBYPMaskBridge}
NODE_DISPLAY_NAME_MAPPINGS = {"RGBYPMaskBridge": "RGBYP Mask Bridge"}
