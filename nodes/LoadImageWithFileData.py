import os
import json
import numpy as np
import torch
from PIL import Image

import nodes
import folder_paths


class LoadImageWithFileData:
    """
    Extended version of the built‑in Load Image node.

    Outputs:
    - image (IMAGE)
    - rgbyp_mask (IMAGE)  — color RGBYP mask (if exists), otherwise a small black image
    - mask (MASK)
    - dir_path (STRING)
    - file_path (STRING)
    - file_name (STRING)
    - file_name_ext (STRING)

    Extra behaviour:

    - Saves a copy of the current image to ComfyUI/temp as
      RGBYP_<unique_id>_original.png
    - If an RGBYP color mask exists for this unique_id, saves a composite preview
      RGBYP_<unique_id>_composite.png
    - Writes a JSON meta file RGBYP_<unique_id>_meta.json with:
        {
            "graph_image": <key that identifies which graph image this mask belongs to>,
            "original": "<path>",
            "mask": "<path or empty>",
            "composite": "<path or empty>",
            "width": <int>,
            "height": <int>,
        }

    The same attributes are attached to the output IMAGE tensor:
        image.dir_path
        image.file_path
        image.file_name
        image.file_name_ext
        image.graph_image  (string key used to detect stale masks)
    """

    @classmethod
    def INPUT_TYPES(cls):
        # Start from the standard LoadImage INPUT_TYPES so behaviour stays consistent.
        base = nodes.LoadImage.INPUT_TYPES()

        # Visible FLOAT widget used as a recompute trigger (updated from JS)
        required = dict(base.get("required", {}))
        required["updater"] = (
            "FLOAT",
            {
                "default": 100.0,
                "min": 0.0,
                "max": 1000000.0,
                "step": 0.1,
            },
        )
        base["required"] = required

        # Hidden unique id, shared with the RGBYP editor/bridge.
        hidden = dict(base.get("hidden", {}))
        hidden["unique_id"] = "UNIQUE_ID"
        base["hidden"] = hidden

        return base

    DESCRIPTION = "Loads an image, stores helper file info for the RGBYP editor, and outputs the file path and file name."
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
    # Helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _get_temp_paths(unique_id: str):
        """
        Build all temp paths used by this node for a given unique_id.
        """
        temp_dir = folder_paths.get_temp_directory()
        os.makedirs(temp_dir, exist_ok=True)

        original_name = f"RGBYP_{unique_id}_original.png"
        composite_name = f"RGBYP_{unique_id}_composite.png"
        mask_name = f"RGBYP_{unique_id}_mask.png"
        meta_name = f"RGBYP_{unique_id}_meta.json"

        return {
            "temp_dir": temp_dir,
            "original": os.path.join(temp_dir, original_name),
            "composite": os.path.join(temp_dir, composite_name),
            "mask": os.path.join(temp_dir, mask_name),
            "meta": os.path.join(temp_dir, meta_name),
        }

    # ------------------------------------------------------------------
    # Load color mask RGBYP_<unique_id>_mask.png from temp directory
    # ------------------------------------------------------------------
    def _load_rgbyp_mask(self, base_image, unique_id):
        """
        Load RGBYP mask from temp.

        Returns:
            (mask_tensor, has_color_mask)
            - mask_tensor: IMAGE tensor
            - has_color_mask: bool, True if mask file exists and has non-zero pixels
        """
        device = base_image.device
        b, h, w, c = base_image.shape

        # Original empty full-size mask
        empty = torch.zeros_like(base_image, device=device)

        # Fallback 64×64 black IMAGE (small placeholder)
        fallback_64 = torch.zeros((1, 64, 64, 3), device=device, dtype=base_image.dtype)

        if not unique_id:
            # No editor / no id – behave as "no mask yet".
            return fallback_64, False

        paths = self._get_temp_paths(unique_id)
        mask_path = paths["mask"]
        meta_path = paths["meta"]

        # If we have meta with a different graph_image key, treat the mask as stale
        try:
            current_graph_image = getattr(base_image, "graph_image", None)
            if current_graph_image is not None and os.path.isfile(meta_path):
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                stored_graph_image = meta.get("graph_image")
                if stored_graph_image and str(stored_graph_image) != str(current_graph_image):
                    # Mask was drawn for another image – ignore it (and optionally delete old file).
                    try:
                        if os.path.isfile(mask_path):
                            os.remove(mask_path)
                    except OSError:
                        pass
                    return fallback_64, False
        except Exception as e:
            print(f"[LoadImageWithFileData] warning reading meta.json: {e}")

        # If file does not exist, there is no color mask yet.
        if not os.path.isfile(mask_path):
            return fallback_64, False

        try:
            m = Image.open(mask_path).convert("RGBA")
            if m.size != (w, h):
                m = m.resize((w, h), Image.LANCZOS)

            m_rgb = m.convert("RGB")
            arr = np.array(m_rgb).astype(np.float32) / 255.0
            mask_tensor = torch.from_numpy(arr)[None, ...].to(device)

            has_color_mask = False
            try:
                if mask_tensor.sum().item() != 0.0:
                    has_color_mask = True
            except Exception:
                has_color_mask = False

            return mask_tensor, has_color_mask

        except Exception as e:
            print(f"[LoadImageWithFileData] error loading rgbyp_mask: {e}")
            return empty, False

    # ------------------------------------------------------------------
    # Save composite RGBYP_<unique_id>_composite.png
    # ------------------------------------------------------------------
    def _save_composite_with_opacity(self, image_tensor, updater, unique_id, has_color_mask):
        """
        Save composite image RGBYP_<unique_id>_composite.png in temp directory,
        blending the RGBYP mask with the base image using updater as opacity (0–100).

        Returns:
            (composite_path, composite_exists)
        """
        if not unique_id:
            return "", False

        paths = self._get_temp_paths(unique_id)
        composite_path = paths["composite"]
        mask_path = paths["mask"]

        # If there is no color mask, remove old composite (if any) and exit.
        if (not has_color_mask) or (not os.path.isfile(mask_path)):
            try:
                if os.path.isfile(composite_path):
                    os.remove(composite_path)
            except OSError:
                pass
            return "", False

        # Convert base image tensor to PIL
        try:
            arr_img = (image_tensor[0].detach().cpu().numpy().clip(0, 1) * 255).astype(
                np.uint8
            )
            base_pil = Image.fromarray(arr_img, "RGB")
        except Exception as e:
            print(f"[LoadImageWithFileData] error converting base image to PIL: {e}")
            return "", False

        try:
            mask_pil = Image.open(mask_path).convert("RGBA")
            if mask_pil.size != base_pil.size:
                mask_pil = mask_pil.resize(base_pil.size, Image.LANCZOS)

            rgba_base = base_pil.convert("RGBA")

            # updater is expected in 0–100 range
            try:
                opacity_value = float(updater)
            except Exception:
                opacity_value = 100.0

            alpha_factor = max(0.0, min(opacity_value / 100.0, 1.0))
            if alpha_factor <= 0.0:
                # Fully transparent – treat as "no composite"
                try:
                    if os.path.isfile(composite_path):
                        os.remove(composite_path)
                except OSError:
                    pass
                return "", False

            r, g, b, a = mask_pil.split()
            a = a.point(lambda v: int(v * alpha_factor))
            mask_pil = Image.merge("RGBA", (r, g, b, a))

            rgba_base.alpha_composite(mask_pil)
            rgba_base.convert("RGB").save(composite_path)

            return composite_path, True

        except Exception as e:
            print(f"[LoadImageWithFileData] error saving composite: {e}")
            try:
                if os.path.isfile(composite_path):
                    os.remove(composite_path)
            except OSError:
                pass
            return "", False

    # ------------------------------------------------------------------
    # Main execution
    # ------------------------------------------------------------------
    def load_image(self, image, updater=0.0, unique_id=None):
        # Use original LoadImage behaviour
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
            # Key that identifies which graph image this is (used to detect stale masks)
            setattr(output_image, "graph_image", str(image))
        except Exception:
            pass

        # Load RGBYP mask (or fallback) for this unique id
        rgbyp_mask, has_color_mask = self._load_rgbyp_mask(output_image, unique_id)

        # Prepare temp paths and ensure original image copy
        paths = self._get_temp_paths(unique_id) if unique_id else None
        original_path = ""
        composite_path = ""
        composite_exists = False

        if paths is not None:
            original_path = paths["original"]
            composite_path = paths["composite"]
            mask_path = paths["mask"]
            meta_path = paths["meta"]

            # Save original image copy to temp
            try:
                arr_img = (
                    output_image[0].detach().cpu().numpy().clip(0, 1) * 255
                ).astype(np.uint8)
                base_pil = Image.fromarray(arr_img, "RGB")
                base_pil.save(original_path)
            except Exception as e:
                print(f"[LoadImageWithFileData] ERROR saving original image: {e}")

            # Save composite preview with opacity from updater (only if mask has color)
            composite_path, composite_exists = self._save_composite_with_opacity(
                output_image, updater, unique_id, has_color_mask
            )

            # Save / update meta.json
            try:
                _, h, w, _ = output_image.shape
            except Exception:
                h = 0
                w = 0

            meta = {
                "graph_image": str(image),
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
                print(f"[LoadImageWithFileData] ERROR saving meta.json: {e}")

        return (
            output_image,
            rgbyp_mask,
            output_mask,
            dir_path,
            file_path,
            file_name,
            file_name_ext,
        )

    # ------------------------------------------------------------------
    # Change detection / validation
    # ------------------------------------------------------------------
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
