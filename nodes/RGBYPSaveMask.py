import os
import numpy as np
import torch
from PIL import Image


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
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("rgbyp_mask",)
    FUNCTION = "save"
    CATEGORY = "image/mask"
    DESCRIPTION = "Saves rgbyp_mask with the RGBYPMaskBridge PNG logic."
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

    def save(self, rgbyp_mask, file_path, file_name, add_postfix=True, unique_id=None):
        if not isinstance(file_path, str) or not isinstance(file_name, str):
            return (rgbyp_mask,)

        file_path = file_path.strip()
        file_name = file_name.strip()

        if not file_path or not file_name:
            return (rgbyp_mask,)

        if not file_path.endswith("/") and not file_path.endswith("\\"):
            file_path = file_path + os.sep

        if add_postfix:
            final_name = f"{file_name}_rgbyp_mask_{unique_id}"
        else:
            final_name = file_name

        folder = os.path.expanduser(file_path)
        folder = os.path.normpath(folder)

        try:
            os.makedirs(folder, exist_ok=True)
        except Exception as e:
            print(f"[RGBYPSaveMask] ERROR creating directory '{folder}': {e}")
            return (rgbyp_mask,)

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
