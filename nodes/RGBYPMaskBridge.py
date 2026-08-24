from email.mime import image
import hashlib
import json
from typing import Any, Dict, Optional

import torch
from PIL import Image
import numpy as np

from .RGBYPUtils import (
    _make_black_64,
    _make_black_mask_64,
    _rgbyp_mask_to_regular_mask,
    _load_image_from_path,
    save_image_tensor_to_clipspace,
    bake_composite_with_mask,
    clipspace_path,
    is_image_changed,
    get_dhash,
    dhash_distance,
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


def _save_batch_error_image(unique_id) -> str:
    """Generate a 512x128 PNG with an error message and save it to clipspace. Returns filename or ''."""
    try:
        from PIL import ImageDraw, ImageFont

        W, H = 512, 128
        img = Image.new("RGB", (W, H), color=(30, 30, 30))
        draw = ImageDraw.Draw(img)

        lines = ["Image batches or lists", "are not supported."]
        font = None
        try:
            font = ImageFont.truetype("DejaVuSans-Bold.ttf", 22)
        except Exception:
            try:
                font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
            except Exception:
                font = ImageFont.load_default()

        fill = (220, 80, 80)
        line_h = 30
        total_h = line_h * len(lines)
        y0 = (H - total_h) // 2

        for i, line in enumerate(lines):
            try:
                bbox = draw.textbbox((0, 0), line, font=font)
                tw = bbox[2] - bbox[0]
            except Exception:
                tw = len(line) * 12
            x = (W - tw) // 2
            draw.text((x, y0 + i * line_h), line, font=font, fill=fill)

        filename = f"RGBYPBridge-batch-error-{unique_id}.png"
        try:
            save_path = clipspace_path(filename)
        except Exception:
            import folder_paths
            import os
            save_path = os.path.join(folder_paths.get_input_directory(), "clipspace", filename)

        import os
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        img.save(save_path, "PNG")
        return filename
    except Exception:
        return ""


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
                "image_change_sensitivity": (
                    "INT",
                    {
                        "default": 20,
                        "min": 1,
                        "max": 63,
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
    RETURN_TYPES = ("IMAGE", "MASK", "IMAGE")
    RETURN_NAMES = ("image", "mask", "rgbyp_mask")
    OUTPUT_NODE = False
    INPUT_IS_LIST = True
    OUTPUT_IS_LIST = (False, False, False)
    FUNCTION = "execute"

    _state: Dict[str, Dict[str, Any]] = {}

    # def _get_state(self, unique_id: Optional[str], image: torch.Tensor) -> Dict[str, Any]:
    #     import time
    #     uid = str(unique_id) if unique_id is not None else "none"
    #     st = self._state.get(uid)
    #     if st is None:
    #         new_ts = str(int(time.time() * 1000))
    #         print(f"[BRIDGE DEBUG] NEW STATE CREATED for uid={uid} fixed_timestamp={new_ts} _state_id={id(self._state)} existing_keys={list(self._state.keys())}")
    #         st = {
    #             "mask_cache": _make_black_64(device=str(image.device), dtype=image.dtype),
    #             "previousTimestamp": 0,
    #             "prev_input_sig": None,
    #             "fixed_timestamp": str(int(time.time() * 1000)),
    #         }
    #         self._state[uid] = st
    #     else:
    #         m = st.get("mask_cache")
    #         if isinstance(m, torch.Tensor):
    #             try:
    #                 st["mask_cache"] = m.to(device=image.device, dtype=image.dtype)
    #             except Exception:
    #                 pass
    #         # ensure fixed_timestamp exists for states created before this change
    #         if "fixed_timestamp" not in st:
    #             st["fixed_timestamp"] = str(int(time.time() * 1000))
    #     return st


    def _get_state(self, unique_id: Optional[str], image: torch.Tensor, incoming_rgbyp_json: str = "") -> Dict[str, Any]:
        import time
        uid = str(unique_id) if unique_id is not None else "none"
        st = self._state.get(uid)
        if st is None:
            # Recover fixed_timestamp from the widget's own JSON if it's already there —
            # this happens after a server restart/reimport, when self._state is empty
            # but the workflow's rgbyp_json widget still holds the real timestamp.
            recovered_ts = None
            try:
                if incoming_rgbyp_json and str(incoming_rgbyp_json).strip():
                    incoming_parsed = json.loads(incoming_rgbyp_json)
                    if isinstance(incoming_parsed, dict) and incoming_parsed.get("fixed_timestamp"):
                        recovered_ts = str(incoming_parsed["fixed_timestamp"])
            except Exception:
                recovered_ts = None

            st = {
                "mask_cache": _make_black_64(device=str(image.device), dtype=image.dtype),
                "previousTimestamp": 0,
                "prev_input_sig": None,
                "fixed_timestamp": recovered_ts if recovered_ts else str(int(time.time() * 1000)),
            }
            self._state[uid] = st
        else:
            m = st.get("mask_cache")
            if isinstance(m, torch.Tensor):
                try:
                    st["mask_cache"] = m.to(device=image.device, dtype=image.dtype)
                except Exception:
                    pass
            # ensure fixed_timestamp exists for states created before this change
            if "fixed_timestamp" not in st:
                st["fixed_timestamp"] = str(int(time.time() * 1000))
        return st
    
    def execute(
        self,
        image,
        downscale_preview_to=512,
        image_change_sensitivity=20,
        rgbyp_json="",
        unique_id=None,
    ):

        # With INPUT_IS_LIST=True all inputs arrive as lists.
        # Unwrap scalars first.
        if isinstance(downscale_preview_to, list):
            downscale_preview_to = downscale_preview_to[0] if downscale_preview_to else 512
        if isinstance(image_change_sensitivity, list):
            image_change_sensitivity = image_change_sensitivity[0] if image_change_sensitivity else 20
        if isinstance(rgbyp_json, list):
            rgbyp_json = rgbyp_json[0] if rgbyp_json else ""
        if isinstance(unique_id, list):
            unique_id = unique_id[0] if unique_id else None

        # image is a list of tensors — each tensor is [N, H, W, C]
        # Two batch cases:
        #   1. List with multiple elements (multiple upstream nodes connected via list)
        #   2. Single tensor with batch dim > 1 (e.g. upstream batch of 8)
        if not isinstance(image, list):
            image = [image]

        is_batch = False

        _img_for_hash = image[0] if isinstance(image, list) else image
        _hash = hashlib.sha256(_img_for_hash.detach().cpu().numpy().tobytes()).hexdigest()[:16] if isinstance(_img_for_hash, torch.Tensor) else "N/A"
        # print(f"[BRIDGE DEBUG] unique_id={unique_id} sha={_hash} json={repr(rgbyp_json)[:50]} downscale={downscale_preview_to} sens={image_change_sensitivity}")        

        # print(f"[BRIDGE DEBUG] image data_ptr={image[0].data_ptr() if isinstance(image, list) else image.data_ptr()} shape={image[0].shape if isinstance(image, list) else image.shape} json_hash={hash(rgbyp_json)}")

        if len(image) != 1:
            is_batch = True
        elif isinstance(image[0], torch.Tensor) and image[0].dim() == 4 and image[0].shape[0] != 1:
            is_batch = True

        if is_batch:
            # Show error image in preview, pass the original image through untouched.
            # Reset prev_input_sig so the next single-image run always refreshes the preview.
            first = image[0]
            uid = str(unique_id) if unique_id is not None else "none"
            if uid in self._state:
                self._state[uid]["prev_input_sig"] = None
            black = _make_black_64(device=str(first.device), dtype=first.dtype)
            error_filename = _save_batch_error_image(unique_id)
            ui = {
                "images": [
                    {
                        "filename": error_filename if error_filename else "",
                        "subfolder": "clipspace",
                        "type": "input",
                    }
                ],
                "rgbyp_json": [rgbyp_json if rgbyp_json is not None else ""],
            }
            # image is the raw list that arrived via INPUT_IS_LIST — pass it straight through.
            # With OUTPUT_IS_LIST=False ComfyUI expects a single tensor; torch.cat the list
            # so the output is identical to what came in (one batched tensor).
            pass_through = torch.cat(image, dim=0) if len(image) > 1 else image[0]
            return {"result": (pass_through, _make_black_mask_64(device=str(first.device)), black), "ui": ui}

        # Single image — unwrap the list
        image = image[0]

        output_image = image

        # st = self._get_state(unique_id, image)
        st = self._get_state(unique_id, image, incoming_rgbyp_json=rgbyp_json)

        # If no active mask (no rgbyp_timestamp in json) — always force input_changed=True
        # to prevent stale prev_input_sig from blocking preview updates
        _pre_parsed = None
        try:
            _raw = rgbyp_json if rgbyp_json else ""
            if _raw.strip():
                _pre_parsed = json.loads(_raw)
        except Exception:
            pass
        if not (isinstance(_pre_parsed, dict) and "rgbyp_timestamp" in _pre_parsed):
            st["prev_input_sig"] = None        

        node_suffix = f"{unique_id}-{st['fixed_timestamp']}"

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

        # --- dHash: detect if input image changed significantly ---
        # Store as string to avoid JavaScript Number precision loss (> 2^53)
        current_dhash = get_dhash(image)
        current_dhash_str = str(current_dhash)

        sensitivity = int(image_change_sensitivity) if isinstance(image_change_sensitivity, int) else 20
        sensitivity = max(1, min(63, sensitivity))

        stored_dhash = st.get("last_dhash", None)

        if rgbyp_json_available and stored_dhash is not None:
            try:
                stored_dhash_int = int(stored_dhash)
            except Exception:
                stored_dhash_int = None

            if stored_dhash_int is not None:
                dist = dhash_distance(current_dhash, stored_dhash_int)
                if dist > sensitivity:
                    # Image changed significantly — reset mask and clear json
                    st["mask_cache"] = _make_black_64(device=str(image.device), dtype=image.dtype)
                    st["previousTimestamp"] = 0
                    rgbyp_json = ""
                    rgbyp_json_available = False
                    parsed = None

        st["last_dhash"] = current_dhash_str

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

        has_mask_ref = rgbyp_json_available and isinstance(parsed, dict) and bool(str(parsed.get("mask", "")).strip())
        if not has_mask_ref:
            if not _is_mask_64x64(st.get("mask_cache")):
                st["mask_cache"] = _make_black_64(device=str(image.device), dtype=image.dtype)
            st["previousTimestamp"] = 0

        prev_downscale = st.get("prev_downscale_preview_to", None)
        downscale_changed = (prev_downscale != downscale_preview_to)
        st["prev_downscale_preview_to"] = downscale_preview_to

        preview_image = image
        if isinstance(downscale_preview_to, int) and downscale_preview_to > 0:
            preview_image = _downscale_tensor_max_side(image, int(downscale_preview_to))

        original_filename = f"RGBYPBridge-rgbyp-original-{node_suffix}.png"
        saved_original = save_image_tensor_to_clipspace(preview_image, original_filename, max_side=0)
        original_filename = saved_original or ""

        preview_filename = ""
        if (input_changed or downscale_changed) and has_mask_ref:
            mask_name = parsed.get("mask", "")
            mask_tensor = None
            if isinstance(mask_name, str) and mask_name.strip():
                mp = clipspace_path(mask_name.strip())
                mask_tensor = _load_image_from_path(mp, ref_tensor=image)

            if isinstance(mask_tensor, torch.Tensor):
                st["mask_cache"] = mask_tensor.to(device=image.device, dtype=image.dtype)

            comp = bake_composite_with_mask(preview_image, st["mask_cache"])
            if isinstance(comp, torch.Tensor):
                composite_filename = f"RGBYPBridge-rgbyp-composite-{node_suffix}.png"
                saved_comp = save_image_tensor_to_clipspace(comp, composite_filename, max_side=0)
                preview_filename = saved_comp or ""
            if not preview_filename:
                preview_filename = original_filename

        elif (input_changed or downscale_changed) and (not has_mask_ref):
            preview_filename = original_filename
            
        # preview_filename = ""
        # if (input_changed or downscale_changed) and rgbyp_json_available and isinstance(parsed, dict):
        #     mask_name = parsed.get("mask", "")
        #     mask_tensor = None
        #     if isinstance(mask_name, str) and mask_name.strip():
        #         mp = clipspace_path(mask_name.strip())
        #         mask_tensor = _load_image_from_path(mp, ref_tensor=image)

        #     if isinstance(mask_tensor, torch.Tensor):
        #         st["mask_cache"] = mask_tensor.to(device=image.device, dtype=image.dtype)

        #     comp = bake_composite_with_mask(preview_image, st["mask_cache"])
        #     if isinstance(comp, torch.Tensor):
        #         composite_filename = f"RGBYPBridge-rgbyp-composite-{node_suffix}.png"
        #         saved_comp = save_image_tensor_to_clipspace(comp, composite_filename, max_side=0)
        #         preview_filename = saved_comp or ""
        #     if not preview_filename:
        #         preview_filename = original_filename

        # elif (input_changed or downscale_changed) and (not rgbyp_json_available):
        #     preview_filename = original_filename

        preview_image = None
        mask_temp = None

        # Inject dhash and fixed_timestamp — preserves all existing fields
        # try:
        #     if isinstance(parsed, dict):
        #         parsed["dhash"] = current_dhash_str
        #         parsed["fixed_timestamp"] = st["fixed_timestamp"]
        #         rgbyp_json = json.dumps(parsed)
        #     else:
        #         rgbyp_json = json.dumps({"dhash": current_dhash_str, "fixed_timestamp": st["fixed_timestamp"]})
        # except Exception:
        #     pass

        # Inject fixed_timestamp ONLY when json is empty/invalid — never touch an already-valid dict
        try:
            if not isinstance(parsed, dict):
                rgbyp_json = json.dumps({"fixed_timestamp": st["fixed_timestamp"]})
        except Exception:
            pass        

        # Convert rgbyp_mask (IMAGE-like RGBA tensor) to regular MASK (1,H,W float)
        # Priority: rgbyp mask from editor → black 64px fallback
        regular_mask = _rgbyp_mask_to_regular_mask(st["mask_cache"], device=str(image.device))
        if regular_mask is None:
            regular_mask = _make_black_mask_64(device=str(image.device))

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

        return {"result": (output_image, regular_mask, st["mask_cache"]), "ui": ui}


NODE_CLASS_MAPPINGS = {"RGBYPMaskBridge": RGBYPMaskBridge}
NODE_DISPLAY_NAME_MAPPINGS = {"RGBYPMaskBridge": "RGBYP Mask Bridge"}
