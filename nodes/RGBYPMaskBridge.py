import os
import json
import torch
import numpy as np
from PIL import Image
import folder_paths

print = lambda *a, **k: None


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
                "updater": (
                    "FLOAT",
                    {
                        "default": 0.7500,
                        "min": 0.0001,
                        "max": 1.0000,
                        "step": 0.0001,
                    },
                ),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    DESCRIPTION = "Takes an input image, lets you draw an RGBYP mask on it, and outputs both the image and the mask."
    CATEGORY = "image/mask"
    RETURN_TYPES = ("IMAGE", "IMAGE")
    RETURN_NAMES = ("image", "rgbyp_mask")
    OUTPUT_NODE = False
    FUNCTION = "execute"

    # ---------- helpers ----------

    def _get_original_filename_from_tensor(self, image):
        """
        Try to extract the original file path from the IMAGE tensor.
        """
        try:
            meta = getattr(image, "metadata", None)
            if isinstance(meta, dict):
                for key in ("original_path", "filename", "path"):
                    val = meta.get(key)
                    if isinstance(val, str) and val:
                        return os.path.abspath(val)
        except Exception as e:
            print(f"[RGBYPMaskBridge] Error reading filename from tensor: {e}")
        return None

    def _save_tensor_as_png(self, image_tensor, path):
        """
        Save IMAGE (B,H,W,C in [0,1]) as PNG at the given path.
        Use only the first batch item.
        Support both RGB and RGBA (if C>=4, preserve alpha).
        """
        try:
            img0 = image_tensor[0].detach().cpu().clamp(0.0, 1.0)

            # ensure at least 3 channels
            if img0.shape[-1] < 3:
                pad = 3 - img0.shape[-1]
                img0 = torch.cat([img0, img0[..., :1].repeat(1, 1, pad)], dim=-1)

            if img0.shape[-1] >= 4:
                rgba = img0[..., :4].numpy()
                rgba_u8 = (rgba * 255.0).round().astype(np.uint8)
                Image.fromarray(rgba_u8, mode="RGBA").save(path, format="PNG")
            else:
                rgb = img0[..., :3].numpy()
                rgb_u8 = (rgb * 255.0).round().astype(np.uint8)
                Image.fromarray(rgb_u8, mode="RGB").save(path, format="PNG")

            print(f"[RGBYPMaskBridge] saved PNG: '{path}'")
        except Exception as e:
            print(f"[RGBYPMaskBridge] ERROR saving PNG '{path}': {e}")

    def _load_mask_tensor(self, mask_path, target_hw, device):
        """
        Load mask image from PNG and resize it to target_hw (H,W).
        Return a torch.Tensor of shape (1,H,W,4) in [0,1] with transparent background:
        - pixels where mask is black (RGB≈0) get alpha=0;
        - non-black (colored) mask pixels get alpha=1.
        """
        try:
            m = Image.open(mask_path).convert("RGBA")
            w_t, h_t = target_hw[1], target_hw[0]
            if m.size != (w_t, h_t):
                m = m.resize((w_t, h_t), resample=Image.NEAREST)

            arr = np.array(m).astype(np.float32) / 255.0
            if arr.ndim == 2:
                # grayscale → replicate into RGB, alpha will be recomputed
                arr = np.stack([arr, arr, arr, np.ones_like(arr)], axis=-1)

            # ensure at least 3 channels
            if arr.shape[-1] < 3:
                pad = 3 - arr.shape[-1]
                pad_arr = np.repeat(arr[..., :1], pad, axis=-1)
                arr = np.concatenate([arr, pad_arr], axis=-1)

            rgb = arr[..., :3]
            # alpha: 0 where RGB is almost black, otherwise 1
            mag = np.max(rgb, axis=-1)
            alpha = (mag > 1e-3).astype(np.float32)
            rgba = np.concatenate([rgb, alpha[..., None]], axis=-1)

            t = torch.from_numpy(rgba).to(device=device, dtype=torch.float32).unsqueeze(0)
            print(
                f"[RGBYPMaskBridge] loaded mask tensor from '{mask_path}', shape={tuple(t.shape)}"
            )
            return t
        except Exception as e:
            print(f"[RGBYPMaskBridge] ERROR loading mask '{mask_path}': {e}")
            return None

    def _bake_composite(self, base_tensor, mask_path_or_none, updater, out_path, device):
        """
        Create a baked composite image:
        - base_tensor: IMAGE (B,H,W,C) in [0,1]
        - mask_path_or_none: path to PNG mask or None
        - updater: FLOAT (0..100000) → opacity factor (0..1)
        - out_path: full PNG path
        Return True/False.
        """
        try:
            img0 = base_tensor[0].detach().cpu().clamp(0.0, 1.0)
            base_arr = img0[..., :3].numpy()  # (H,W,3)
            h, w, _ = base_arr.shape

            if mask_path_or_none and os.path.isfile(mask_path_or_none):
                mask_img = Image.open(mask_path_or_none).convert("RGB")
                if mask_img.size != (w, h):
                    mask_img = mask_img.resize((w, h), resample=Image.NEAREST)
                mask_arr = np.array(mask_img).astype(np.float32) / 255.0
                if mask_arr.ndim == 2:
                    mask_arr = np.stack([mask_arr, mask_arr, mask_arr], axis=-1)
                if mask_arr.shape[-1] != 3:
                    mask_arr = mask_arr[..., :3]
                print(
                    f"[RGBYPMaskBridge] baking with REAL mask '{mask_path_or_none}', size={mask_img.size}"
                )
            else:
                # empty transparent '1-pixel mask' → effectively zero mask
                mask_arr = np.zeros((1, 1, 3), dtype=np.float32)
                print("[RGBYPMaskBridge] baking with EMPTY mask (no mask file)")

            # resize the mask to match base size
            if mask_arr.shape[0] != h or mask_arr.shape[1] != w:
                mask_img = Image.fromarray(
                    (np.clip(mask_arr, 0.0, 1.0) * 255.0).astype(np.uint8), mode="RGB"
                )
                mask_img = mask_img.resize((w, h), resample=Image.NEAREST)
                mask_arr = np.array(mask_img).astype(np.float32) / 255.0

            # alpha_factor = float(max(0.0, min(1.0, updater / 100.0)))
            alpha_factor = float(max(0.0, min(1.0, updater)))

            alpha = np.max(mask_arr, axis=2, keepdims=True) * alpha_factor  # (H,W,1)

            comp = base_arr * (1.0 - alpha) + mask_arr * alpha
            comp = np.clip(comp, 0.0, 1.0)
            comp_u8 = (comp * 255.0).round().astype(np.uint8)
            comp_img = Image.fromarray(comp_u8, mode="RGB")
            comp_img.save(out_path, format="PNG")
            print(f"[RGBYPMaskBridge] baked composite to '{out_path}'")
            return True
        except Exception as e:
            print(f"[RGBYPMaskBridge] ERROR baking composite: {e}")
            return False

    # ---------- main ----------

    def execute(self, image, clear_on_size_change=True, updater=100.0, unique_id=None):
        device = image.device
        b, h, w, c = image.shape

        if unique_id is None:
            unique_id = "0"
        print(f"[RGBYPMaskBridge] execute(): start, unique_id={unique_id}, clear_on_size_change={clear_on_size_change}, updater={updater}, image_shape={tuple(image.shape)}, device={device}")

        temp_dir = folder_paths.get_temp_directory()
        input_dir = folder_paths.get_input_directory()
        rgbyp_input_dir = os.path.join(input_dir, "rgbyp")
        os.makedirs(temp_dir, exist_ok=True)
        os.makedirs(rgbyp_input_dir, exist_ok=True)

        # 1. Input image name
        input_abs_path = self._get_original_filename_from_tensor(image)
        if input_abs_path:
            base_filename = os.path.basename(input_abs_path)
        else:
            base_filename = f"RGBYP_{unique_id}.png"

        base_no_ext, _ = os.path.splitext(base_filename)
        suffix = "_composite"
        if base_no_ext.endswith(suffix):
            imageOriginalName = base_no_ext[: -len(suffix)]
        else:
            imageOriginalName = base_no_ext

        if not imageOriginalName:
            imageOriginalName = f"RGBYP_{unique_id}"

        print(f"[RGBYPMaskBridge] input file='{base_filename}', imageOriginalName='{imageOriginalName}'")

        # 1.1 jsonFileName
        jsonFileName = f"RGBYP_{unique_id}.json"
        json_path = os.path.join(temp_dir, jsonFileName)

        # 1.2 jsonTemp in memory
        jsonTemp = {
            "original": f"{imageOriginalName}_original.png",
            "mask": "",
            "composite": "",
            "width": int(w),
            "height": int(h),
        }

        # 1.3 outputImage = input image
        outputImage = image

        # 1.4 outputMask = None
        outputMask = None

        # 2. Check if json exists
        json_exists = os.path.isfile(json_path)
        print(f"[RGBYPMaskBridge] json_exists={json_exists}, json_path='{json_path}'")

        # For preview
        preview_filename = None
        preview_type = None
        preview_subfolder = ""

        if not json_exists:
            # --- JSON DOES NOT EXIST ---
            print("[RGBYPMaskBridge] JSON does not exist → create new")

            # save jsonTemp
            try:
                with open(json_path, "w", encoding="utf-8") as f:
                    json.dump(jsonTemp, f, ensure_ascii=False, indent=2)
                print(f"[RGBYPMaskBridge] wrote new json '{json_path}'")
            except Exception as e:
                print(f"[RGBYPMaskBridge] ERROR writing new json: {e}")

            # save input image as original in temp
            original_temp_path = os.path.join(temp_dir, jsonTemp["original"])
            self._save_tensor_as_png(outputImage, original_temp_path)

            # preview → same original image from temp
            preview_filename = jsonTemp["original"]
            preview_type = "temp"
            preview_subfolder = ""

        else:
            # --- JSON EXISTS ---
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    existing = json.load(f)
            except Exception as e:
                print(f"[RGBYPMaskBridge] ERROR reading existing json: {e}")
                existing = {}

            # read previous width/height and mask fields
            old_w = int(existing.get("width", 0) or 0)
            old_h = int(existing.get("height", 0) or 0)
            mask_name = (existing.get("mask") or "").strip()
            isJsonMask = bool(mask_name)
            print(
                f"[RGBYPMaskBridge] existing width={old_w}, height={old_h}, mask='{mask_name}', isJsonMask={isJsonMask}"
            )

            sizes_match = (old_w == int(w)) and (old_h == int(h))
            print(f"[RGBYPMaskBridge] sizes_match={sizes_match}, clear_on_size_change={clear_on_size_change}")

            # composite name
            composite_name = f"{imageOriginalName}_composite.png"
            composite_temp_path = os.path.join(temp_dir, composite_name)
            composite_input_path = os.path.join(rgbyp_input_dir, composite_name)

            # start with jsonTemp as a base (updated width/height/original)
            jsonData = dict(jsonTemp)
            # but copy sha/mask/composite from existing if needed
            jsonData["mask"] = mask_name  # keep existing mask if it was set
            jsonData["composite"] = existing.get("composite", "")

            if sizes_match:
                # ---------- sizes match ----------
                if isJsonMask:
                    # mask exists → bake composite using it
                    mask_path = os.path.join(temp_dir, mask_name)
                    print(
                        f"[RGBYPMaskBridge] sizes match & mask exists → bake composite with mask '{mask_path}'"
                    )
                    baked = self._bake_composite(
                        outputImage, mask_path, updater, composite_temp_path, device
                    )
                    if baked:
                        # Copy composite into input/rgbyp as well
                        try:
                            Image.open(composite_temp_path).save(
                                composite_input_path, format="PNG"
                            )
                            print(
                                f"[RGBYPMaskBridge] copied composite to input/rgbyp: '{composite_input_path}'"
                            )
                        except Exception as e:
                            print(
                                f"[RGBYPMaskBridge] ERROR copying composite to input/rgbyp: {e}"
                            )

                        jsonData["composite"] = composite_name

                        # outputMask = the mask itself
                        outputMask = self._load_mask_tensor(
                            mask_path, (int(h), int(w)), device
                        )
                        # preview from input/rgbyp
                        preview_filename = composite_name
                        preview_type = "input"
                        preview_subfolder = "rgbyp"
                    else:
                        print("[RGBYPMaskBridge] bake failed, fallback preview to original")
                        # save original and use it as preview
                        original_temp_path = os.path.join(temp_dir, jsonTemp["original"])
                        self._save_tensor_as_png(outputImage, original_temp_path)
                        preview_filename = jsonTemp["original"]
                        preview_type = "temp"
                        preview_subfolder = ""
                else:
                    # no mask → bake composite with empty mask
                    print(
                        "[RGBYPMaskBridge] sizes match & mask is empty → bake composite with empty mask"
                    )
                    baked = self._bake_composite(
                        outputImage, None, updater, composite_temp_path, device
                    )
                    if baked:
                        try:
                            Image.open(composite_temp_path).save(
                                composite_input_path, format="PNG"
                            )
                            print(
                                f"[RGBYPMaskBridge] copied composite to input/rgbyp: '{composite_input_path}'"
                            )
                        except Exception as e:
                            print(
                                f"[RGBYPMaskBridge] ERROR copying composite to input/rgbyp: {e}"
                            )

                        jsonData["mask"] = ""  # according to spec the mask field stays empty
                        jsonData["composite"] = composite_name
                        preview_filename = composite_name
                        preview_type = "input"
                        preview_subfolder = "rgbyp"
                    else:
                        print("[RGBYPMaskBridge] bake failed, fallback preview to original")
                        original_temp_path = os.path.join(temp_dir, jsonTemp["original"])
                        self._save_tensor_as_png(outputImage, original_temp_path)
                        preview_filename = jsonTemp["original"]
                        preview_type = "temp"
                        preview_subfolder = ""
            else:
                # ---------- sizes DO NOT match ----------
                if clear_on_size_change:
                    print(
                        "[RGBYPMaskBridge] size mismatch & clear_on_size_change=True → reset jsonTemp & preview=input image"
                    )
                    # jsonTemp already contains up-to-date width/height/original
                    jsonData = dict(jsonTemp)
                    # save jsonTemp
                    try:
                        with open(json_path, "w", encoding="utf-8") as f:
                            json.dump(jsonData, f, ensure_ascii=False, indent=2)
                        print(f"[RGBYPMaskBridge] wrote reset json '{json_path}'")
                    except Exception as e:
                        print(
                            f"[RGBYPMaskBridge] ERROR writing reset json (size mismatch, clear=True): {e}"
                        )
                    # save original in temp
                    original_temp_path = os.path.join(temp_dir, jsonTemp["original"])
                    self._save_tensor_as_png(outputImage, original_temp_path)
                    preview_filename = jsonTemp["original"]
                    preview_type = "temp"
                    preview_subfolder = ""
                else:
                    # clear_on_size_change == False
                    print(
                        "[RGBYPMaskBridge] size mismatch & clear_on_size_change=False → keep mask, bake with it if exists"
                    )
                    mask_path = os.path.join(temp_dir, mask_name) if mask_name else None

                    # Save input image as original in temp with a new name
                    original_temp_path = os.path.join(temp_dir, jsonTemp["original"])
                    self._save_tensor_as_png(outputImage, original_temp_path)

                    baked = self._bake_composite(
                        outputImage, mask_path, updater, composite_temp_path, device
                    )
                    if baked:
                        try:
                            Image.open(composite_temp_path).save(
                                composite_input_path, format="PNG"
                            )
                            print(
                                f"[RGBYPMaskBridge] copied composite to input/rgbyp: '{composite_input_path}'"
                            )
                        except Exception as e:
                            print(
                                f"[RGBYPMaskBridge] ERROR copying composite to input/rgbyp: {e}"
                            )

                        # save composite name and updated dimensions
                        jsonData["composite"] = composite_name
                        jsonData["width"] = int(w)
                        jsonData["height"] = int(h)

                        # outputMask = the mask itself, if present
                        if mask_path and os.path.isfile(mask_path):
                            outputMask = self._load_mask_tensor(
                                mask_path, (int(h), int(w)), device
                            )
                            if outputMask is not None:
                                # save mask in temp as imageOriginalName + _mask
                                mask_output_name = f"{imageOriginalName}_mask.png"
                                mask_output_path = os.path.join(temp_dir, mask_output_name)
                                self._save_tensor_as_png(outputMask, mask_output_path)
                                jsonData["mask"] = mask_output_name
                            else:
                                print(
                                    "[RGBYPMaskBridge] WARNING: could not load mask tensor, skip saving resized mask file"
                                )
                        else:
                            # no mask file on disk → leave mask field empty
                            jsonData["mask"] = ""

                        # preview → baked image from input/rgbyp
                        preview_filename = composite_name
                        preview_type = "input"
                        preview_subfolder = "rgbyp"
                    else:
                        print(
                            "[RGBYPMaskBridge] bake failed (size mismatch, clear=False), fallback preview to original"
                        )
                        # as a safety, save original image (if it was not saved)
                        original_temp_path = os.path.join(temp_dir, jsonTemp["original"])
                        self._save_tensor_as_png(outputImage, original_temp_path)
                        preview_filename = jsonTemp["original"]
                        preview_type = "temp"
                        preview_subfolder = ""

            # in all cases after the branches → save jsonData
            try:
                with open(json_path, "w", encoding="utf-8") as f:
                    json.dump(jsonData, f, ensure_ascii=False, indent=2)
                print(f"[RGBYPMaskBridge] wrote final json '{json_path}'")
            except Exception as e:
                print(f"[RGBYPMaskBridge] ERROR writing final json: {e}")

        # 3. Node outputs
        # 3.1 rgbyp_mask: if outputMask=None → black 64x64 mask
        if outputMask is None:
            print(
                "[RGBYPMaskBridge] outputMask is None → using default black 64x64 mask"
            )
            mask_arr = np.zeros((64, 64, 3), dtype=np.float32)
            outputMask = (
                torch.from_numpy(mask_arr)
                .to(device=device, dtype=torch.float32)
                .unsqueeze(0)
            )

        # Preview
        # Preview
        # Safety: if preview points to a non-existing file, fall back to the current input image
        ui = None
        if preview_filename is not None and preview_type is not None:
            try:
                if preview_type == "input":
                    base_dir = folder_paths.get_input_directory()
                else:  # "temp" or anything else → treat as temp
                    base_dir = folder_paths.get_temp_directory()

                if preview_subfolder:
                    preview_full_path = os.path.join(base_dir, preview_subfolder, preview_filename)
                else:
                    preview_full_path = os.path.join(base_dir, preview_filename)

                if not os.path.isfile(preview_full_path):
                    print(
                        f"[RGBYPMaskBridge] WARNING: preview file not found "
                        f"('{preview_full_path}') → fallback to current input image"
                    )
                    # Save current image as a fresh original preview in temp
                    fallback_name = f"{imageOriginalName}_original.png"
                    fallback_path = os.path.join(folder_paths.get_temp_directory(), fallback_name)
                    self._save_tensor_as_png(outputImage, fallback_path)

                    preview_filename = fallback_name
                    preview_type = "temp"
                    preview_subfolder = ""
                else:
                    print(
                        f"[RGBYPMaskBridge] preview file exists: '{preview_full_path}'"
                    )
            except Exception as e:
                print(
                    f"[RGBYPMaskBridge] ERROR while verifying preview file, "
                    f"fallback to current input image: {e}"
                )
                fallback_name = f"{imageOriginalName}_original.png"
                fallback_path = os.path.join(folder_paths.get_temp_directory(), fallback_name)
                self._save_tensor_as_png(outputImage, fallback_path)

                preview_filename = fallback_name
                preview_type = "temp"
                preview_subfolder = ""

            ui = {
                "images": [
                    {
                        "filename": preview_filename,
                        "subfolder": preview_subfolder,
                        "type": preview_type,
                    }
                ]
            }
            print(
                f"[RGBYPMaskBridge] preview: type={preview_type}, "
                f"subfolder='{preview_subfolder}', filename='{preview_filename}'"
            )
        else:
            print("[RGBYPMaskBridge] no preview image resolved")

        if ui is not None:
            print("[RGBYPMaskBridge] execute(): returning result with UI preview")
            return {"result": (outputImage, outputMask), "ui": ui}
        else:
            print("[RGBYPMaskBridge] execute(): returning result without UI preview")
            return {"result": (outputImage, outputMask)}


NODE_CLASS_MAPPINGS = {"RGBYPMaskBridge": RGBYPMaskBridge}
NODE_DISPLAY_NAME_MAPPINGS = {"RGBYPMaskBridge": "RGBYP Mask Bridge"}
