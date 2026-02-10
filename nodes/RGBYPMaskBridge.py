import json
import time
import torch
import os

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
    def __init__(self):
        # cache: abs_path -> {"sig": (mtime_ns, size_bytes, ref_w, ref_h), "tensor": cpu_tensor_rgb}
        self._rgbyp_mask_cache = {}

    def _rgbyp_load_mask_cached(
        self, mask_filename: str, ref_tensor: torch.Tensor | None
    ):
        """
        Returns CPU tensor (H,W,3) from cache, reloads from disk only if file changed.
        ref_tensor is used only when scaling is requested (to match output_image size).
        """
        path = clipspace_path(mask_filename)

        try:
            st = os.stat(path)
        except FileNotFoundError:
            self._rgbyp_mask_cache.pop(path, None)
            return None

        ref_w = (
            int(ref_tensor.shape[2])
            if isinstance(ref_tensor, torch.Tensor) and ref_tensor.ndim >= 3
            else None
        )
        ref_h = (
            int(ref_tensor.shape[1])
            if isinstance(ref_tensor, torch.Tensor) and ref_tensor.ndim >= 3
            else None
        )
        sig = (st.st_mtime_ns, st.st_size, ref_w, ref_h)

        c = self._rgbyp_mask_cache.get(path)
        if c and c.get("sig") == sig:
            return c.get("tensor")

        t = _load_image_from_path(path, ref_tensor=ref_tensor)
        if not isinstance(t, torch.Tensor):
            self._rgbyp_mask_cache.pop(path, None)
            return None

        # t = t[..., :3].cpu()
        t = t.cpu()
        self._rgbyp_mask_cache[path] = {"sig": sig, "tensor": t}
        return t

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
                "downscale_preview_mask_to": (
                    "INT",
                    {
                        "default": 512,
                        "min": 0,
                        "max": 3200,
                        "step": 1,
                    },
                ),
                "scale_mask_output": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "label_on": "Scale to Original Size",
                        "label_off": "Keep as-is",
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

    def execute(
        self,
        image,
        clear_on_size_change=True,
        downscale_preview_mask_to=512,
        scale_mask_output=False,
        rgbyp_json="",
        unique_id=None,
    ):
        if unique_id is None:
            unique_id = "0"

        _, inputHeight, inputWidth, _ = image.shape

        last_fp = self._get_last_input_fp()
        isInputImageChanged, new_fp = is_input_image_changed_variantA(last_fp, image)
        self._set_last_input_fp(new_fp)

        # first run after server start: don't trigger the "input changed" branch
        if last_fp is None:
            isInputImageChanged = False

        # isInputImageChanged, new_fp = is_input_image_changed_variantA(
        #     self._get_last_input_fp(), image
        # )
        # self._set_last_input_fp(new_fp)

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
        if (
            isinstance(composite_filename_from_json, str)
            and composite_filename_from_json
            and clipspace_exists(composite_filename_from_json)
        ):
            preview_filename = composite_filename_from_json
        elif (
            isinstance(original_filename_from_json, str)
            and original_filename_from_json
            and clipspace_exists(original_filename_from_json)
        ):
            preview_filename = original_filename_from_json
        else:
            last_prev = self._get_last_preview()
            if last_prev and clipspace_exists(last_prev):
                preview_filename = last_prev

        preview_available = bool(preview_filename)
        if (not preview_available) and (not json_available):
            nodeId = str(unique_id)
            preview_name = f"RGBYPBridge-rgbyp-original-{nodeId}.png"

            if int(downscale_preview_mask_to or 0) > 0:
                save_preview_image_tensor_to_clipspace(
                    output_image, preview_name, int(downscale_preview_mask_to)
                )
            else:
                save_image_tensor_to_clipspace(output_image, preview_name)

            preview_filename = preview_name
            preview_available = True
            self._set_last_preview(preview_name)        

        preview_mask_available = False
        if (
            isinstance(mask_filename_from_json, str)
            and mask_filename_from_json
            and clipspace_exists(mask_filename_from_json)
        ):
            preview_mask_available = True

        if (not isInputImageChanged) and preview_mask_available:
            mask_cpu = self._rgbyp_load_mask_cached(
                mask_filename_from_json,
                ref_tensor=(output_image if scale_mask_output else None),
            )
            if isinstance(mask_cpu, torch.Tensor):
                rgbypOutputMask = mask_cpu.to(
                    device=output_image.device, dtype=output_image.dtype
                )
        # if (not isInputImageChanged) and preview_mask_available:
        #     mask_tensor = _load_image_from_path(
        #         clipspace_path(mask_filename_from_json),
        #         ref_tensor=(output_image if scale_mask_output else None),
        #     )
        #     if isinstance(mask_tensor, torch.Tensor):
        #         rgbypOutputMask = mask_tensor[..., :3].to(
        #             device=output_image.device, dtype=output_image.dtype
        #         )
        # mask_tensor = _load_image_from_path(
        #     clipspace_path(mask_filename_from_json), ref_tensor=output_image
        # )
        # if isinstance(mask_tensor, torch.Tensor):
        #     rgbypOutputMask = mask_tensor[..., :3].to(
        #         device=output_image.device, dtype=output_image.dtype
        #     )

        ts = str(int(time.time() * 1000))
        nodeId = str(unique_id)

        if isInputImageChanged:
            rgbypOutputMask = _make_black_64(device=image.device, dtype=image.dtype)

            # Keep disk IO cheap until the user has a mask/json.
            if not json_available:
                new_rgbyp_json = ""
                preview_name = f"RGBYPBridge-rgbyp-original-{nodeId}.png"
                if downscale_preview_mask_to > 0:
                    save_preview_image_tensor_to_clipspace(
                        output_image,
                        preview_name,
                        max_side=downscale_preview_mask_to,
                    )
                else:
                    save_image_tensor_to_clipspace(output_image, preview_name)

                preview_filename = preview_name
                self._set_last_preview(preview_filename)
            else:
                if preview_available:
                    sz = clipspace_image_size(preview_filename)
                    sizeMatch = False
                    if sz:
                        previousWidth, previousHeight = int(sz[0]), int(sz[1])
                        sizeMatch = (previousWidth == int(inputWidth)) and (
                            previousHeight == int(inputHeight)
                        )

                    original_name = f"RGBYPBridge-rgbyp-original-{nodeId}.png"
                    save_image_tensor_to_clipspace(output_image, original_name)

                    if clear_on_size_change and (not sizeMatch):
                        preview_filename = original_name
                        self._set_last_preview(preview_filename)
                        new_rgbyp_json = ""
                    else:
                        if preview_mask_available:
                            # mask_tensor = _load_image_from_path(
                            #     clipspace_path(mask_filename_from_json),
                            #     ref_tensor=output_image,
                            # )
                            # mask_tensor = _load_image_from_path(
                            #     clipspace_path(mask_filename_from_json),
                            #     ref_tensor=(
                            #         output_image if scale_mask_output else None
                            #     ),
                            # )
                            mask_tensor = _load_image_from_path(
                                clipspace_path(mask_filename_from_json),
                                # input changed + keep mask => always match new input size
                                ref_tensor=output_image,
                            )                            
                            composite_tensor = bake_composite_with_mask(
                                output_image, mask_tensor, opacity=0.7
                            )

                            composite_name = f"RGBYPBridge-rgbyp-composite-{nodeId}.png"
                            mask_name = f"RGBYPBridge-rgbyp-mask-{nodeId}.png"

                            if downscale_preview_mask_to > 0:
                                save_preview_image_tensor_to_clipspace(composite_tensor, composite_name, int(downscale_preview_mask_to))
                                save_preview_image_tensor_to_clipspace(mask_tensor,      mask_name,      int(downscale_preview_mask_to))
                            else:
                                save_image_tensor_to_clipspace(composite_tensor, composite_name)
                                save_image_tensor_to_clipspace(mask_tensor, mask_name)
                            # save_image_tensor_to_clipspace(
                            #     composite_tensor, composite_name
                            # )
                            # save_image_tensor_to_clipspace(mask_tensor, mask_name)

                            # update in-memory cache for the newly written mask
                            # try:
                            #     p = clipspace_path(mask_name)
                            #     st = os.stat(p)
                            #     sig = (st.st_mtime_ns, st.st_size, None, None)  # ref=None because we want "as-is" output
                            #     self._rgbyp_mask_cache[p] = {"sig": sig, "tensor": mask_tensor[..., :3].cpu()}
                            # except Exception:
                            #     pass


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

                            # Output mask must match what we saved to disk (downscaled when downscale_preview_mask_to > 0)
                            out_mask_cpu = self._rgbyp_load_mask_cached(mask_name, ref_tensor=None)
                            if isinstance(out_mask_cpu, torch.Tensor):
                                rgbypOutputMask = out_mask_cpu.to(device=output_image.device, dtype=output_image.dtype)
                            # if isinstance(mask_tensor, torch.Tensor):
                            #     rgbypOutputMask = mask_tensor[..., :3].to(
                            #         device=output_image.device, dtype=output_image.dtype
                            #     )
                        else:
                            preview_filename = original_name
                            self._set_last_preview(preview_filename)
                            new_rgbyp_json = ""
                else:
                    if not json_available:
                        preview_name = f"RGBYPBridge-rgbyp-preview-{nodeId}.png"
                        if downscale_preview_mask_to > 0:
                            save_preview_image_tensor_to_clipspace(
                                output_image,
                                preview_name,
                                max_side=downscale_preview_mask_to,
                            )
                        else:
                            save_image_tensor_to_clipspace(output_image, preview_name)
                        # save_preview_image_tensor_to_clipspace(
                        #     output_image, preview_name, max_side=512
                        # )
                        preview_filename = preview_name
                        self._set_last_preview(preview_filename)
                        new_rgbyp_json = ""
                    else:
                        original_name = f"RGBYPBridge-rgbyp-original-{nodeId}.png"
                        save_image_tensor_to_clipspace(output_image, original_name)
                        preview_filename = original_name
                        self._set_last_preview(preview_filename)
                        new_rgbyp_json = ""

        # --- ENSURE PREVIEW FILE AND SIZE MATCH SETTINGS ---
        # Rule:
        # - If mask exists -> preview must be composite
        # - If no mask -> preview must be original
        # And preview file should be downscaled to max_side when downscale_preview_mask_to > 0

        effective_json_available = bool(
            isinstance(new_rgbyp_json, str) and new_rgbyp_json.strip()
        )
        want_preview = preview_filename

        # Decide which file SHOULD be preview
        if effective_json_available and preview_mask_available:
            # Prefer composite when mask exists
            if (
                isinstance(composite_filename_from_json, str)
                and composite_filename_from_json
                and clipspace_exists(composite_filename_from_json)
            ):
                want_preview = composite_filename_from_json
        elif effective_json_available:
            # No mask -> prefer original
            if (
                isinstance(original_filename_from_json, str)
                and original_filename_from_json
                and clipspace_exists(original_filename_from_json)
            ):
                want_preview = original_filename_from_json

        # Switch preview filename if needed
        if want_preview and want_preview != preview_filename:
            preview_filename = want_preview
            self._set_last_preview(preview_filename)

        # Rebuild preview file if its size doesn't match the current downscale setting
        if (
            isinstance(preview_filename, str)
            and preview_filename
            and clipspace_exists(preview_filename)
        ):
            sz = clipspace_image_size(preview_filename)
            if sz:
                prev_w, prev_h = int(sz[0]), int(sz[1])

                max_side = (
                    int(downscale_preview_mask_to) if downscale_preview_mask_to else 0
                )

                need_rebuild = False
                if max_side > 0:
                    # if prev_w > max_side or prev_h > max_side:
                    if max(prev_w, prev_h) != max_side:
                        need_rebuild = True
                else:
                    if prev_w != int(inputWidth) or prev_h != int(inputHeight):
                        need_rebuild = True

                if need_rebuild:
                    is_composite = (
                        preview_mask_available
                        and isinstance(composite_filename_from_json, str)
                        and composite_filename_from_json
                        and preview_filename == composite_filename_from_json
                    )

                    if is_composite:
                        mask_tensor = _load_image_from_path(
                            clipspace_path(mask_filename_from_json),
                            ref_tensor=output_image,
                        )
                        composite_tensor = bake_composite_with_mask(
                            output_image, mask_tensor, opacity=0.7
                        )

                        if max_side > 0:
                            save_preview_image_tensor_to_clipspace(
                                composite_tensor,
                                preview_filename,
                                max_side=max_side,
                            )
                        else:
                            save_image_tensor_to_clipspace(
                                composite_tensor,
                                preview_filename,
                            )

                        # rebuild MASK to match current downscale setting too
                        if isinstance(mask_filename_from_json, str) and mask_filename_from_json:
                            if max_side > 0:
                                save_preview_image_tensor_to_clipspace(mask_tensor, mask_filename_from_json, max_side=max_side)
                            else:
                                save_image_tensor_to_clipspace(mask_tensor, mask_filename_from_json)

                            # drop cached entry so output reflects new file immediately
                            try:
                                self._rgbyp_mask_cache.pop(clipspace_path(mask_filename_from_json), None)
                            except Exception:
                                pass

                        # also rebuild ORIGINAL to the same size
                        if (
                            isinstance(original_filename_from_json, str)
                            and original_filename_from_json
                        ):
                            if max_side > 0:
                                save_preview_image_tensor_to_clipspace(
                                    output_image,
                                    original_filename_from_json,
                                    max_side=max_side,
                                )
                            else:
                                save_image_tensor_to_clipspace(
                                    output_image, original_filename_from_json
                                )

                    else:
                        if max_side > 0:
                            save_preview_image_tensor_to_clipspace(
                                output_image,
                                preview_filename,
                                max_side=max_side,
                            )
                        else:
                            save_image_tensor_to_clipspace(
                                output_image,
                                preview_filename,
                            )

                    self._set_last_preview(preview_filename)

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
