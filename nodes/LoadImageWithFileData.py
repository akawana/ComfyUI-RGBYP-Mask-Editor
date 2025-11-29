import os
import numpy as np
import torch
from PIL import Image

import nodes
import folder_paths


class LoadImageWithFileData:
    """
    Extended version of the built-in Load Image node.

    Outputs:
    - image (IMAGE)
    - rgbyp_mask (IMAGE)  — color RGBYP mask (if exists), otherwise fallback
    - mask (MASK)
    - dir_path (STRING)
    - file_path (STRING)
    - file_name (STRING)
    - file_name_ext (STRING)

    The same attributes are attached to the output IMAGE tensor:
        image.dir_path
        image.file_path
        image.file_name
        image.file_name_ext
    """

    @classmethod
    def INPUT_TYPES(cls):
        base = nodes.LoadImage.INPUT_TYPES()

        # Visible FLOAT widget used as a recompute trigger (updated from JS)
        required = base.get("required", {})
        required["updater"] = ("FLOAT", {
            "default": 100.0,
            "min": 0.0,
            "max": 1000000.0,
            "step": 0.1,
        })
        base["required"] = required

        # Hidden unique id, shared with the RGBYP editor/bridge
        hidden = base.get("hidden", {})
        hidden["unique_id"] = "UNIQUE_ID"
        base["hidden"] = hidden

        return base

    DESCRIPTION = "Loads an image, allows drawing an RGBYP mask, and outputs the file path and file name."
    CATEGORY = getattr(nodes.LoadImage, "CATEGORY", "image")

    RETURN_TYPES = ("IMAGE", "IMAGE", "MASK", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = (
        "image",
        "rgbyp_mask",
        "mask",
        "dir_path",
        "file_path",
        "file_name",
        "file_name_ext",
    )

    OUTPUT_NODE = True
    FUNCTION = "load_image"

    # ------------------------------------------------------------------
    # Load color mask RGBYP_{unique_id}_mask.png from temp directory
    # ------------------------------------------------------------------
    def _load_rgbyp_mask(self, base_image, unique_id):
        """
        Load RGBYP mask from temp.

        Returns:
            - IMAGE tensor with same size as base_image if the mask file exists;
            - 64×64 black IMAGE if the file does not exist;
            - full-size empty IMAGE if loading fails.
        """
        device = base_image.device
        b, h, w, c = base_image.shape

        # Original empty full-size mask
        empty = torch.zeros_like(base_image, device=device)

        # Fallback 64×64 black IMAGE
        fallback_64 = torch.zeros((1, 64, 64, 3), device=device, dtype=base_image.dtype)

        if unique_id is None:
            return empty

        temp_dir = folder_paths.get_temp_directory()
        mask_name = f"RGBYP_{unique_id}_mask.png"
        mask_path = os.path.join(temp_dir, mask_name)

        # If file does not exist, return 64×64 black image
        if not os.path.isfile(mask_path):
            return fallback_64

        try:
            m = Image.open(mask_path).convert("RGBA")
            if m.size != (w, h):
                m = m.resize((w, h), Image.LANCZOS)

            m_rgb = m.convert("RGB")
            arr = np.array(m_rgb).astype(np.float32) / 255.0
            mask_tensor = torch.from_numpy(arr)[None, ...].to(device)
            return mask_tensor

        except Exception as e:
            print(f"[LoadImageWithFileData] error loading rgbyp_mask: {e}")
            return empty

    def _save_composite_with_opacity(self, image_tensor, updater, unique_id):
        """
        Save composite image RGBYP_{unique_id}_composite.png in temp directory,
        blending the RGBYP mask with the base image using updater as opacity (0-100).
        """
        if unique_id is None:
            return

        temp_dir = folder_paths.get_temp_directory()
        os.makedirs(temp_dir, exist_ok=True)

        composite_name = f"RGBYP_{unique_id}_composite.png"
        composite_path = os.path.join(temp_dir, composite_name)

        mask_name = f"RGBYP_{unique_id}_mask.png"
        mask_path = os.path.join(temp_dir, mask_name)

        # Convert base image tensor to PIL
        try:
            arr_img = (image_tensor[0].detach().cpu().numpy().clip(0, 1) * 255).astype(np.uint8)
            base_pil = Image.fromarray(arr_img, "RGB")
        except Exception as e:
            print(f"[LoadImageWithFileData] error converting base image to PIL: {e}")
            return

        if not os.path.isfile(mask_path):
            # No mask file, just save base image as composite
            try:
                base_pil.save(composite_path)
            except Exception as e:
                print(f"[LoadImageWithFileData] error saving composite without mask: {e}")
            return

        try:
            mask_pil = Image.open(mask_path).convert("RGBA")
            if mask_pil.size != base_pil.size:
                mask_pil = mask_pil.resize(base_pil.size, Image.LANCZOS)

            rgba_base = base_pil.convert("RGBA")

            if updater is None:
                opacity_value = 100.0
            else:
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

            final_pil.save(composite_path)
        except Exception as e:
            print(f"[LoadImageWithFileData] error saving composite: {e}")

    def load_image(self, image, updater=0.0, unique_id=None):
        # Use original LoadImage behavior
        base_loader = nodes.LoadImage()
        output_image, output_mask = base_loader.load_image(image)

        # Resolve absolute path of the loaded image
        abs_path = folder_paths.get_annotated_filepath(image)

        dir_path, file_name_ext = os.path.split(abs_path)
        file_name, _ = os.path.splitext(file_name_ext)
        file_path = abs_path

        # Attach metadata attributes to IMAGE tensor
        try:
            setattr(output_image, "dir_path", dir_path)
            setattr(output_image, "file_path", file_path)
            setattr(output_image, "file_name", file_name)
            setattr(output_image, "file_name_ext", file_name_ext)
        except Exception:
            pass

        # Load RGBYP mask (or 64×64 fallback if file is missing)
        rgbyp_mask = self._load_rgbyp_mask(output_image, unique_id)

        # Save composite preview with opacity from updater
        self._save_composite_with_opacity(output_image, updater, unique_id)

        return (
            output_image,
            rgbyp_mask,
            output_mask,
            dir_path,
            file_path,
            file_name,
            file_name_ext,
        )

    @classmethod
    def IS_CHANGED(cls, image, updater=0.0, **kwargs):
        """
        Node is treated as changed when:
        - the underlying image changes (LoadImage.IS_CHANGED),
        - or the updater value changes (from JS / UI).
        """
        base_changed = nodes.LoadImage.IS_CHANGED(image)

        try:
            # If base loader already indicates change, respect that
            if base_changed is not None and not np.isnan(float(base_changed)):
                return base_changed
        except Exception:
            pass

        # Otherwise, tie change to updater value
        return float(updater or 0.0)

    @classmethod
    def VALIDATE_INPUTS(cls, image, **kwargs):
        return nodes.LoadImage.VALIDATE_INPUTS(image)


NODE_CLASS_MAPPINGS = {
    "LoadImageWithFileData": LoadImageWithFileData,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoadImageWithFileData": "Load Image With File Data",
}
