import os
import numpy as np
import torch
from PIL import Image
import folder_paths


class RGBYPSaveMask:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "rgbyp_mask": ("IMAGE",),
                "file_path": ("STRING", {"multiline": False, "default": ""}),
                "file_name": ("STRING", {"multiline": False, "default": ""}),
                "add_postfix": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "label_on": "Add _rgbyp_mask",
                        "label_off": "Exact name",
                    },
                ),
                "override": (
                    "BOOLEAN",
                    {
                        "default": True,
                        "label_on": "Override last mask",
                        "label_off": "Increment 01..99",
                    },
                ),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("rgbyp_mask",)
    FUNCTION = "save"
    CATEGORY = "AK/RGBYP"
    DESCRIPTION = "Saves rgbyp_mask PNG to a folder with optional postfix and versioning."
    OUTPUT_NODE = True

    def _save_tensor_as_png(self, image_tensor, path):
        try:
            img0 = image_tensor[0].detach().cpu().clamp(0.0, 1.0)

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
        except Exception as e:
            print(f"[RGBYPSaveMask] ERROR saving PNG '{path}': {e}")

    def save(self, rgbyp_mask, file_path, file_name, add_postfix=True, override=True, unique_id=None):
        if not isinstance(file_path, str) or not isinstance(file_name, str):
            return (rgbyp_mask,)

        file_path = file_path.strip()
        file_name = file_name.strip()

        if not file_path:
            default_input = folder_paths.get_input_directory()
            file_path = os.path.join(default_input, "rgbyp_masks")

        if not file_name:
            file_name = "mask"

        if not file_path.endswith("/") and not file_path.endswith("\\"):
            file_path = file_path + os.sep

        folder = os.path.expanduser(file_path)
        folder = os.path.normpath(folder)

        try:
            os.makedirs(folder, exist_ok=True)
        except Exception as e:
            print(f"[RGBYPSaveMask] ERROR creating directory '{folder}': {e}")
            return (rgbyp_mask,)

        base_name = file_name

        if add_postfix:
            base_with_suffix = f"{base_name}_rgbyp_mask"

            if override:
                if unique_id is not None:
                    final_name = f"{base_with_suffix}_{unique_id}"
                else:
                    final_name = base_with_suffix
            else:
                if unique_id is not None:
                    base_with_suffix_node = f"{base_with_suffix}_{unique_id}"
                else:
                    base_with_suffix_node = base_with_suffix

                max_index = 0
                try:
                    for existing in os.listdir(folder):
                        if not existing.lower().endswith(".png"):
                            continue

                        name_no_ext, _ = os.path.splitext(existing)
                        prefix = base_with_suffix_node + "_"

                        if not name_no_ext.startswith(prefix):
                            continue

                        tail = name_no_ext[len(prefix):]
                        if len(tail) == 2 and tail.isdigit():
                            idx = int(tail)
                            if 1 <= idx <= 99 and idx > max_index:
                                max_index = idx
                except Exception as e:
                    print(f"[RGBYPSaveMask] ERROR scanning folder '{folder}' for mask indexes: {e}")
                    max_index = 0

                next_index = max_index + 1
                if next_index > 99:
                    next_index = 99

                final_name = f"{base_with_suffix_node}_{next_index:02d}"
        else:
            final_name = base_name

        full_path = os.path.join(folder, final_name + ".png")

        try:
            arr = rgbyp_mask[0].detach().cpu().numpy()
            if arr.max() <= 1e-6:
                return (rgbyp_mask,)
        except Exception as e:
            print(f"[RGBYPSaveMask] ERROR checking mask for black: {e}")

        self._save_tensor_as_png(rgbyp_mask, full_path)

        if not os.path.isfile(full_path):
            print(f"[RGBYPSaveMask] ERROR: file not found after save attempt: {full_path}")

        return (rgbyp_mask,)


NODE_CLASS_MAPPINGS = {
    "RGBYPSaveMask": RGBYPSaveMask,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RGBYPSaveMask": "RGBYP Save Mask",
}
