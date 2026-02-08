import json
import time
import torch

from .RGBYPUtils import (
    _make_black_64,
    _load_image_from_path,
    save_image_tensor_to_clipspace,
    clipspace_exists,
    clipspace_image_size,
    bake_composite_with_mask,
    is_input_image_changed_variantA,
    clipspace_path,
    save_preview_image_tensor_to_clipspace,
)



class RGBYPMaskBridge:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "clear_on_size_change": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "label_on": "Clear",
                        "label_off": "Keep",
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

    DESCRIPTION = "Takes an input image, lets you draw an RGBYP mask on it, and outputs both the image and the mask."
    CATEGORY = "AK/RGBYP"
    RETURN_TYPES = ("IMAGE", "IMAGE")
    RETURN_NAMES = ("image", "rgbyp_mask")
    OUTPUT_NODE = True
    FUNCTION = "execute"

    def _get_last_preview(self):
        name = getattr(self, "_rgbyp_preview_filename", None)
        if isinstance(name, str) and name:
            return name
        return None

    def _set_last_preview(self, name: str | None):
        if isinstance(name, str) and name:
            self._rgbyp_preview_filename = name
        else:
            self._rgbyp_preview_filename = None

    def _get_last_input_fp(self):
        return getattr(self, "_rgbyp_last_input_fp", None)

    def _set_last_input_fp(self, fp):
        self._rgbyp_last_input_fp = fp

    def execute(self, image, clear_on_size_change=True, rgbyp_json="", unique_id=None):
        if unique_id is None:
            unique_id = "0"

        _, inputHeight, inputWidth, _ = image.shape

        isInputImageChanged, new_fp = is_input_image_changed_variantA(self._get_last_input_fp(), image)
        self._set_last_input_fp(new_fp)

        output_image = image
        rgbypOutputMask = _make_black_64(device=image.device, dtype=image.dtype)

        json_available = False
        json_obj = None
        if isinstance(rgbyp_json, str) and rgbyp_json.strip():
            try:
                json_obj = json.loads(rgbyp_json)
                if isinstance(json_obj, dict):
                    json_available = True
            except Exception:
                json_available = False
                json_obj = None

        mask_filename_from_json = None
        composite_filename_from_json = None
        original_filename_from_json = None
        if json_available:
            mask_filename_from_json = json_obj.get("mask")
            composite_filename_from_json = json_obj.get("composite")
            original_filename_from_json = json_obj.get("original")

        new_rgbyp_json = rgbyp_json if isinstance(rgbyp_json, str) else ""

        preview_filename = None
        if isinstance(composite_filename_from_json, str) and composite_filename_from_json and clipspace_exists(composite_filename_from_json):
            preview_filename = composite_filename_from_json
        elif isinstance(original_filename_from_json, str) and original_filename_from_json and clipspace_exists(original_filename_from_json):
            preview_filename = original_filename_from_json
        else:
            last_prev = self._get_last_preview()
            if last_prev and clipspace_exists(last_prev):
                preview_filename = last_prev

        preview_available = bool(preview_filename)

        preview_mask_available = False
        if isinstance(mask_filename_from_json, str) and mask_filename_from_json and clipspace_exists(mask_filename_from_json):
            preview_mask_available = True

        if (not isInputImageChanged) and preview_mask_available:
            mask_tensor = _load_image_from_path(clipspace_path(mask_filename_from_json), ref_tensor=output_image)
            if isinstance(mask_tensor, torch.Tensor):
                rgbypOutputMask = mask_tensor[..., :3].to(device=output_image.device, dtype=output_image.dtype)

        ts = str(int(time.time() * 1000))
        nodeId = str(unique_id)

        if isInputImageChanged:
            rgbypOutputMask = _make_black_64(device=image.device, dtype=image.dtype)

            # Keep disk IO cheap until the user has a mask/json.
            if not json_available:
                new_rgbyp_json = ""
                preview_name = f"RGBYPBridge-rgbyp-original-{nodeId}.png"
                save_preview_image_tensor_to_clipspace(output_image, preview_name, max_side=512)
                preview_filename = preview_name
                self._set_last_preview(preview_filename)
            else:
                if preview_available:
                    sz = clipspace_image_size(preview_filename)
                    sizeMatch = False
                    if sz:
                        previousWidth, previousHeight = int(sz[0]), int(sz[1])
                        sizeMatch = (previousWidth == int(inputWidth)) and (previousHeight == int(inputHeight))

                    original_name = f"RGBYPBridge-rgbyp-original-{nodeId}.png"
                    save_image_tensor_to_clipspace(output_image, original_name)

                    if clear_on_size_change and (not sizeMatch):
                        preview_filename = original_name
                        self._set_last_preview(preview_filename)
                        new_rgbyp_json = ""
                    else:
                        if preview_mask_available:
                            mask_tensor = _load_image_from_path(clipspace_path(mask_filename_from_json), ref_tensor=output_image)
                            composite_tensor = bake_composite_with_mask(output_image, mask_tensor, opacity=0.7)

                            composite_name = f"RGBYPBridge-rgbyp-composite-{nodeId}.png"
                            mask_name = f"RGBYPBridge-rgbyp-mask-{nodeId}.png"

                            save_image_tensor_to_clipspace(composite_tensor, composite_name)
                            save_image_tensor_to_clipspace(mask_tensor, mask_name)

                            new_rgbyp_json = json.dumps(
                                {
                                    "timestamp": ts,
                                    "original": original_name,
                                    "mask": mask_name,
                                    "composite": composite_name,
                                },
                                ensure_ascii=False,
                            )

                            preview_filename = composite_name
                            self._set_last_preview(preview_filename)

                            if isinstance(mask_tensor, torch.Tensor):
                                rgbypOutputMask = mask_tensor[..., :3].to(device=output_image.device, dtype=output_image.dtype)
                        else:
                            preview_filename = original_name
                            self._set_last_preview(preview_filename)
                            new_rgbyp_json = ""
                else:
                    if not json_available:
                        preview_name = f"RGBYPBridge-rgbyp-preview-{nodeId}.png"
                        save_preview_image_tensor_to_clipspace(output_image, preview_name, max_side=512)
                        preview_filename = preview_name
                        self._set_last_preview(preview_filename)
                        new_rgbyp_json = ""
                    else:
                        original_name = f"RGBYPBridge-rgbyp-original-{nodeId}.png"
                        save_image_tensor_to_clipspace(output_image, original_name)
                        preview_filename = original_name
                        self._set_last_preview(preview_filename)
                        new_rgbyp_json = ""

        ui = {
            "images": [
                {
                    "filename": preview_filename if preview_filename else "",
                    "subfolder": "clipspace",
                    "type": "input",
                }
            ],
            "rgbyp_json": [f"{new_rgbyp_json}"],
        }

        return {"result": (output_image, rgbypOutputMask), "ui": ui}


NODE_CLASS_MAPPINGS = {"RGBYPMaskBridge": RGBYPMaskBridge}
NODE_DISPLAY_NAME_MAPPINGS = {"RGBYPMaskBridge": "RGBYP Mask Bridge"}
