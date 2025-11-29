import os
import json
import torch
import numpy as np
from PIL import Image
import folder_paths


class RGBYPMaskBridge:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "clear_on_size_change": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "label_on": "Clear",
                        "label_off": "Keep",
                    },
                ),
                "updater": (
                    "FLOAT",
                    {
                        "default": 100.0,
                        "min": 0.0,
                        "max": 100000.0,
                        "step": 0.1,
                    },
                ),
            },
            "optional": {
                # Optional input socket (forceInput=True creates a real input port)
                "file_path": ("STRING", {
                    "default": "",
                    "forceInput": True,
                }),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    DESCRIPTION = "Takes an input image, lets you draw an RGBYP mask on it, and outputs both the image and the mask."
    CATEGORY = "image/mask"
    RETURN_TYPES = ("IMAGE", "IMAGE")
    RETURN_NAMES = ("image", "rgbyp_mask")
    OUTPUT_NODE = True
    FUNCTION = "execute"

    #    @classmethod
    #    def IS_CHANGED(cls, image, **kwargs):
    #        return float("nan")

    # Extract filename/path from IMAGE tensor metadata
    def _get_original_filename_from_tensor(self, image):
        try:
            for attr in ("image_path", "filename", "name"):
                if hasattr(image, attr):
                    val = getattr(image, attr)
                    if isinstance(val, str) and val:
                        return os.path.abspath(val)
        except Exception as e:
            print(f"[RGBYPMaskBridge] Error reading filename from tensor: {e}")
        return None

    def execute(self, image, clear_on_size_change=True, updater=100.0, file_path="", unique_id=None):
        device = image.device
        b, h, w, c = image.shape

        # -----------------------------------------------------------
        # Determine original_file_fullpath priority:
        # 1) provided file_path input
        # 2) image.file_path metadata
        # 3) image.image_path / filename / name
        # 4) stored meta.original
        # -----------------------------------------------------------
        original_file_fullpath = None

        if file_path and isinstance(file_path, str) and file_path.strip():
            original_file_fullpath = os.path.abspath(file_path.strip())

        if not original_file_fullpath and hasattr(image, "file_path"):
            try:
                val = getattr(image, "file_path")
                if isinstance(val, str) and val.strip():
                    original_file_fullpath = os.path.abspath(val.strip())
            except Exception as e:
                print(f"  Error reading image.file_path: {e}")

        if not original_file_fullpath:
            tfname = self._get_original_filename_from_tensor(image)
            if tfname:
                original_file_fullpath = os.path.abspath(tfname)

        if unique_id is None:
            unique_id = "0"

        # -----------------------------------------------------------
        # TEMP paths
        # -----------------------------------------------------------
        temp_dir = folder_paths.get_temp_directory()

        composite_name = f"RGBYP_{unique_id}_composite.png"
        mask_name = f"RGBYP_{unique_id}_mask.png"
        meta_name = f"RGBYP_{unique_id}_meta.json"

        composite_path = os.path.join(temp_dir, composite_name)
        mask_path = os.path.join(temp_dir, mask_name)
        meta_path = os.path.join(temp_dir, meta_name)

        os.makedirs(temp_dir, exist_ok=True)

        # -----------------------------------------------------------
        # Load previous meta (to keep original path)
        # -----------------------------------------------------------
        stored_original_from_meta = None
        if os.path.isfile(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta_old = json.load(f)
                stored_original_from_meta = meta_old.get("original")
            except Exception as e:
                print(f"  ERROR reading meta.json: {e}")

        if not original_file_fullpath and stored_original_from_meta:
            original_file_fullpath = stored_original_from_meta

        if not original_file_fullpath:
            original_file_fullpath = ""

        # -----------------------------------------------------------
        # Mask loading
        # -----------------------------------------------------------
        mask_tensor = torch.zeros_like(image)
        mask_pil = None

        if os.path.isfile(mask_path):
            try:
                m = Image.open(mask_path).convert("RGBA")
                original_mask_size = m.size

                if original_mask_size != (w, h):
                    if clear_on_size_change:
                        blank = Image.new("RGBA", (w, h), (0, 0, 0, 0))
                        blank.save(mask_path)
                    else:
                        m = m.resize((w, h), Image.LANCZOS)
                        m.save(mask_path)
                        mask_pil = m
                else:
                    mask_pil = m

                if mask_pil is not None:
                    m_rgb = mask_pil.convert("RGB")
                    arr = np.array(m_rgb).astype(np.float32) / 255.0
                    mask_tensor = torch.from_numpy(arr)[None, ...].to(device)

            except Exception as e:
                print(f"  ERROR loading mask: {e}")

        else:
            blank = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            try:
                blank.save(mask_path)
            except Exception as e:
                print(f"  ERROR saving empty mask: {e}")

        # -----------------------------------------------------------
        # If mask is completely black → replace with 64×64 black mask
        # -----------------------------------------------------------
        if mask_tensor.sum() == 0:
            mask_tensor = torch.zeros((1, 64, 64, 3), device=device, dtype=torch.float32)

        # -----------------------------------------------------------
        # Generate composite image (for UI preview only)
        # -----------------------------------------------------------
        arr_img = (image[0].detach().cpu().numpy().clip(0, 1) * 255).astype(np.uint8)
        base_pil = Image.fromarray(arr_img, "RGB")

        if mask_pil is not None and mask_tensor.sum() != 0:
            rgba_base = base_pil.convert("RGBA")

            if updater is None:
                updater = 100.0

            try:
                opacity_value = float(updater)
            except Exception:
                opacity_value = 100.0

            alpha_factor = opacity_value / 100.0
            if alpha_factor < 0.0:
                alpha_factor = 0.0
            if alpha_factor > 1.0:
                alpha_factor = 1.0

            r, g, b, a = mask_pil.split()
            a = a.point(lambda v: int(v * alpha_factor))
            mask_for_merge = Image.merge("RGBA", (r, g, b, a))

            merged = Image.alpha_composite(rgba_base, mask_for_merge)
            final_pil = merged.convert("RGB")
        else:
            final_pil = base_pil

        try:
            final_pil.save(composite_path)
        except Exception as e:
            print(f"  ERROR saving composite: {e}")

        # -----------------------------------------------------------
        # Save meta.json
        # -----------------------------------------------------------
        meta = {
            "original": original_file_fullpath,
            "width": int(w),
            "height": int(h),
        }
        try:
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False)
        except Exception as e:
            print(f"  ERROR saving meta.json: {e}")

        # -----------------------------------------------------------
        # UI tensor preview (not used in graph)
        # -----------------------------------------------------------
        out_np = np.array(final_pil).astype(np.float32) / 255.0
        final_tensor = torch.from_numpy(out_np)[None, ...].to(device)

        ui = {
            "images": [{
                "filename": composite_name,
                "subfolder": "",
                "type": "temp",
            }]
        }

        return {"result": (image, mask_tensor), "ui": ui}


NODE_CLASS_MAPPINGS = {"RGBYPMaskBridge": RGBYPMaskBridge}
NODE_DISPLAY_NAME_MAPPINGS = {"RGBYPMaskBridge": "RGBYP Mask Bridge"}
