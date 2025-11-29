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

    def execute(self, image, clear_on_size_change=True, updater=100.0, unique_id=None):
        device = image.device
        b, h, w, c = image.shape


        if unique_id is None:
            unique_id = "0"

        # TEMP paths
        temp_dir = folder_paths.get_temp_directory()

        original_name = f"RGBYP_{unique_id}_original.png"
        composite_name = f"RGBYP_{unique_id}_composite.png"
        mask_name = f"RGBYP_{unique_id}_mask.png"
        meta_name = f"RGBYP_{unique_id}_meta.json"

        original_path = os.path.join(temp_dir, original_name)
        composite_path = os.path.join(temp_dir, composite_name)
        mask_path = os.path.join(temp_dir, mask_name)
        meta_path = os.path.join(temp_dir, meta_name)

        os.makedirs(temp_dir, exist_ok=True)

        # Load previous meta (optional, no longer used for paths)
        if os.path.isfile(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    json.load(f)
            except Exception as e:
                print(f"[RGBYPMaskBridge] ERROR reading meta.json: {e}")

        # Mask loading
        mask_tensor = torch.zeros_like(image)
        mask_pil = None

        if os.path.isfile(mask_path):
            try:
                m = Image.open(mask_path).convert("RGBA")
                original_mask_size = m.size

                if original_mask_size != (w, h):
                    if clear_on_size_change:
                        try:
                            os.remove(mask_path)
                        except OSError:
                            pass
                        mask_pil = None
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
                print(f"[RGBYPMaskBridge] ERROR loading mask: {e}")
                mask_pil = None
        else:
            mask_pil = None

        has_color_mask = False
        if mask_pil is not None:
            try:
                if mask_tensor.sum().item() != 0.0:
                    has_color_mask = True
            except Exception:
                has_color_mask = False

        if not has_color_mask:
            mask_tensor = torch.zeros((1, 64, 64, 3), device=device, dtype=torch.float32)

        # Generate base image PIL
        arr_img = (image[0].detach().cpu().numpy().clip(0, 1) * 255).astype(np.uint8)
        base_pil = Image.fromarray(arr_img, "RGB")

        # Save original image copy to temp
        try:
            base_pil.save(original_path)
        except Exception as e:
            print(f"[RGBYPMaskBridge] ERROR saving original image: {e}")

        # Generate composite image only if mask has color
        composite_exists = False
        if has_color_mask and mask_pil is not None:
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

            try:
                final_pil.save(composite_path)
                composite_exists = True
            except Exception as e:
                print(f"[RGBYPMaskBridge] ERROR saving composite: {e}")
        else:
            try:
                if os.path.isfile(composite_path):
                    os.remove(composite_path)
            except OSError:
                pass

        # Save meta.json with paths inside temp
        meta = {
            "original": original_path,
            "mask": mask_path if has_color_mask and os.path.isfile(mask_path) else "",
            "composite": composite_path if composite_exists else "",
            "width": int(w),
            "height": int(h),
        }
        try:
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False)
        except Exception as e:
            print(f"[RGBYPMaskBridge] ERROR saving meta.json: {e}")

        # UI preview: show composite if it exists, otherwise original
        ui_filename = composite_name if composite_exists else original_name
        ui = {
            "images": [{
                "filename": ui_filename,
                "subfolder": "",
                "type": "temp",
            }]
        }

        return {"result": (image, mask_tensor), "ui": ui}


NODE_CLASS_MAPPINGS = {"RGBYPMaskBridge": RGBYPMaskBridge}
NODE_DISPLAY_NAME_MAPPINGS = {"RGBYPMaskBridge": "RGBYP Mask Bridge"}
