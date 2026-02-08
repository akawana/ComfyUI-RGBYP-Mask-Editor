import os
import json

import nodes
import folder_paths
import torch

try:
    from .RGBYPUtils import (
        _load_image_from_path,
        _make_black_mask_64,
        _make_black_64,
        _rgbyp_mask_to_regular_mask,
    )
except Exception:
    from RGBYPUtils import (
        _load_image_from_path,
        _make_black_mask_64,
        _make_black_64,
        _rgbyp_mask_to_regular_mask,
    )


def _clipspace_abs(filename: str) -> str:
    if not filename:
        return ""
    filename = os.path.basename(filename.replace("\\", "/"))
    return os.path.join(folder_paths.get_input_directory(), "clipspace", filename)


def _safe_json_loads(s: str):
    if not isinstance(s, str):
        return None
    s = s.strip()
    if not s:
        return None
    try:
        return json.loads(s)
    except Exception:
        return None


class RGBYPLoadImage:
    @classmethod
    def INPUT_TYPES(cls):
        base = nodes.LoadImage.INPUT_TYPES()

        required = dict(base.get("required", {}))
        base["required"] = required


        required["rgbyp_json"] = ("STRING", {"default": "", "multiline": True})
        optional = dict(base.get("optional", {}))
        base["optional"] = optional

        hidden = dict(base.get("hidden", {}))
        hidden["unique_id"] = "UNIQUE_ID"
        base["hidden"] = hidden

        return base

    DESCRIPTION = "Loads an image and (optionally) loads RGBYP files from JSON."
    CATEGORY = "AK/RGBYP"

    RETURN_TYPES = ("IMAGE", "IMAGE", "MASK", "STRING", "STRING")
    RETURN_NAMES = (
        "image",
        "rgbyp_mask",
        "mask",
        "file_path",
        "file_name",
    )

    OUTPUT_NODE = False
    FUNCTION = "load_image"

    def load_image(self, image, rgbyp_json="", unique_id=None):
        base_loader = nodes.LoadImage()

        data = _safe_json_loads(rgbyp_json)
        json_available = isinstance(data, dict) and isinstance(data.get("original"), str) and data.get("original")

        if json_available:
            original_fn = str(data.get("original") or "")
            out_image, _ = base_loader.load_image(f"clipspace/{original_fn}")

            mask_fn = str(data.get("mask") or "")
            mask_abs = _clipspace_abs(mask_fn) if mask_fn else ""
            # print("[RGBYP LoadImage] mask_fn =", mask_fn)
            # print("[RGBYP LoadImage] mask_abs =", mask_abs)
            # print("[RGBYP LoadImage] exists =", os.path.isfile(mask_abs))
            rgbyp_mask = _load_image_from_path(mask_abs, ref_tensor=out_image)
            if rgbyp_mask is None:
                rgbyp_mask = _make_black_64(out_image.device, out_image.dtype)

            # mask_tensor = _make_black_mask_64(out_image.device)
            mask_tensor = _rgbyp_mask_to_regular_mask(rgbyp_mask)  # validate/correct the mask format
            # if isinstance(rgbyp_mask, torch.Tensor) and rgbyp_mask.dim() == 4:
            #     if rgbyp_mask.shape[-1] >= 4:
            #         mask_tensor = rgbyp_mask[..., 3]  # alpha -> (1,H,W)
            #     else:
            #         mask_tensor = (rgbyp_mask[..., :3].mean(dim=-1) > 0).float()
            #     mask_tensor = mask_tensor.to(device=out_image.device, dtype=torch.float32)
            # else:
            #     mask_tensor = _make_black_mask_64(out_image.device)            

            file_path = ""
            file_name = os.path.splitext(os.path.basename(original_fn.replace("\\", "/")))[0]
            return (out_image, rgbyp_mask, mask_tensor, file_path, file_name)

        out_image, _ = base_loader.load_image(image)
        rgbyp_mask = _make_black_64(out_image.device, out_image.dtype)
        mask_tensor = _make_black_mask_64(out_image.device)

        abs_path = folder_paths.get_annotated_filepath(image)
        file_path = os.path.dirname(abs_path) + "\\"
        file_name = os.path.splitext(os.path.basename(abs_path))[0]

        return (out_image, rgbyp_mask, mask_tensor, file_path, file_name)

    @classmethod
    def IS_CHANGED(cls, image, **kwargs):
        return nodes.LoadImage.IS_CHANGED(image)

    @classmethod
    def VALIDATE_INPUTS(cls, image, **kwargs):
        return nodes.LoadImage.VALIDATE_INPUTS(image)


NODE_CLASS_MAPPINGS = {
    "RGBYPLoadImage": RGBYPLoadImage,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RGBYPLoadImage": "RGBYP Load Image",
}
