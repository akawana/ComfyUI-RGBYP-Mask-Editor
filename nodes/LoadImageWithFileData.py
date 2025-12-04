import os
import json
import numpy as np
import torch
from PIL import Image

import nodes
import folder_paths


class LoadImageWithFileData:
    """
    Extended version of the standard Load Image node, working together with the RGBYP editor.

    LOGIC:

    1. JS preview node may alter the file name by adding a suffix:
         "_<какой-то_id>__rgbyp"
       например:
         исходный файл:   iii_2.png
         превью-файл:     iii_2_108__rgbyp.png

       We need to restore the base name "iii_2" и игнорировать этот хвост.

    2. meta.json ВСЕГДА называется:
         <чистое_имя_БЕЗ_РАСШИРЕНИЯ>_<unique_id>_meta.json

       Пример:
         базовое имя:  iii_2
         unique_id:    108
         meta.json:    iii_2_108_meta.json   (лежат в temp)

    3. meta.json contains the following fields:
         {
             "original": "<путь или имя файла с оригиналом>",
             "mask": "<путь или имя файла с маской>",
             "composite": "<путь или имя файла с запечённой маской>",
             ...
         }

       Values may be:
         - absolute paths
         - or filenames in temp (относительными к temp)

    4. Node outputs:

       - image (IMAGE):
            taken from meta["original"] (картинка в temp).
            If meta.json is missing или original не найден/не грузится —
            используется стандартный результат LoadImage (исходная картинка).

       - rgbyp_mask (IMAGE):
            taken from meta["mask"] (картинка в temp).
            If meta.json is missing или mask не найден/пустой/не грузится —
            a black 64x64 image is returned 64×64.

       - mask (MASK):
            стандартная маска из LoadImage.

       - file_path (STRING):
            абсолютный путь к исходной картинке (как у стандартной LoadImage).

       - file_name (STRING):
            имя исходной картинки без расширения (сырое, до очистки).
    """

    @classmethod
    def INPUT_TYPES(cls):
        base = nodes.LoadImage.INPUT_TYPES()

        required = dict(base.get("required", {}))
        required["updater"] = (
            "FLOAT",
            {
                "default": 0.7500,
                "min": 0.0001,
                "max": 1.0000,
                "step": 0.0001,
            },
        )
        base["required"] = required

        hidden = dict(base.get("hidden", {}))
        hidden["unique_id"] = "UNIQUE_ID"
        base["hidden"] = hidden

        return base

    DESCRIPTION = "Loads an image, reads baked original/mask from temp via <base_name>_<unique_id>_meta.json, and outputs helper file info."
    CATEGORY = getattr(nodes.LoadImage, "CATEGORY", "image")

    RETURN_TYPES = ("IMAGE", "IMAGE", "MASK", "STRING", "STRING")
    RETURN_NAMES = (
        "image",
        "rgbyp_mask",
        "mask",
        "file_path",
        "file_name",
    )

    OUTPUT_NODE = True
    FUNCTION = "load_image"

    # ------------------------------------------------------------------
    # HELPER FUNCTIONS
    # ------------------------------------------------------------------
    @staticmethod
    def _normalize_base_name(raw_name: str) -> str:
        """
        Converts a name like 'iii_2_108__rgbyp' back into base name 'iii_2'.

        Rules:
        1) Если есть хвост '__rgbyp' — срезаем его.
        2) После этого, если имя оканчивается на '_<digits>' — тоже срезаем
           (это тот ID, который навешивает JS для превью).

        Examples:
          'iii_2_108__rgbyp' -> 'iii_2'
          'iii_2_999__rgbyp' -> 'iii_2'
          'iii_2'            -> 'iii_2'
        """
        if not raw_name:
            return raw_name

        base = raw_name

        # 1. Убираем хвост "__rgbyp"
        preview_suffix = "__rgbyp"
        if base.endswith(preview_suffix):
            base = base[: -len(preview_suffix)]

        # 2. Убираем концеовой "_<digits>", если есть
        idx = base.rfind("_")
        if idx != -1:
            tail = base[idx + 1 :]
            if tail.isdigit():
                base = base[:idx]

        return base

    def _read_meta_paths(self, base_name, unique_id):
        """
        Searches for meta.json in temp:

            <base_name>_<unique_id>_meta.json

        где base_name — уже очищенное базовое имя картинки (без .png и без хвостов от JS).

        Returns:
            (temp_dir, meta_path, original_path, mask_path, composite_path)
            - *_path могут быть None, если их нет или meta.json отсутствует.
        """
        temp_dir = folder_paths.get_temp_directory()
        os.makedirs(temp_dir, exist_ok=True)

        print(
            f"[LoadImageWithFileData] _read_meta_paths: "
            f"base_name='{base_name}', unique_id='{unique_id}', temp_dir='{temp_dir}'"
        )

        if not base_name or not unique_id:
            print("[LoadImageWithFileData] _read_meta_paths: base_name or unique_id is empty -> no meta.json")
            return temp_dir, None, None, None, None

        # translated comment
        meta_filename = f"{base_name}_{unique_id}_meta.json"
        meta_path = os.path.join(temp_dir, meta_filename)

        print(
            f"[LoadImageWithFileData] _read_meta_paths: looking for meta json file "
            f"'{meta_filename}' at '{meta_path}'"
        )

        if not os.path.isfile(meta_path):
            print(f"[LoadImageWithFileData] _read_meta_paths: meta json NOT FOUND at '{meta_path}'")
            return temp_dir, meta_path, None, None, None

        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except Exception as e:
            print(f"[LoadImageWithFileData] error reading meta json '{meta_path}': {e}")
            return temp_dir, meta_path, None, None, None

        def resolve(key):
            val = str(meta.get(key) or "").strip()
            if not val:
                return None
            return val if os.path.isabs(val) else os.path.join(temp_dir, val)

        original_path = resolve("original")
        mask_path = resolve("mask")
        composite_path = resolve("composite")

        print(
            "[LoadImageWithFileData] _read_meta_paths: "
            f"original='{original_path}', mask='{mask_path}', composite='{composite_path}'"
        )

        return temp_dir, meta_path, original_path, mask_path, composite_path

    def _load_image_from_path(self, path, ref_tensor=None, label=""):
        """
        Loads image from file как IMAGE-тензор (1,H,W,C) в диапазоне [0,1].

        Сейчас используем RGBA, чтобы сохранялась альфа (прозрачный фон маски).
        Если PNG без альфы, будет обычный RGB.

        Если передан ref_tensor, под него matches device/dtype,
        а размер по возможности тоже синхронизируется.

        label — строка для логов (например 'original' или 'mask').
        """
        if not path or not os.path.isfile(path):
            print(
                f"[LoadImageWithFileData] _load_image_from_path: {label} path is missing or not a file: '{path}'"
            )
            return None

        print(f"[LoadImageWithFileData] _load_image_from_path: loading {label} from '{path}'")

        try:
            img = Image.open(path).convert("RGBA")

            # translated comment
            if ref_tensor is not None:
                try:
                    _, h, w, _ = ref_tensor.shape
                    if img.size != (w, h):
                        print(
                            f"[LoadImageWithFileData] _load_image_from_path: "
                            f"resizing {label} from {img.size} to ({w}, {h})"
                        )
                        img = img.resize((w, h), resample=Image.LANCZOS)
                except Exception as e:
                    print(
                        "[LoadImageWithFileData] _load_image_from_path: "
                        f"could not auto-resize {label} to ref_tensor shape: {e}"
                    )

            arr = np.array(img).astype(np.float32) / 255.0
            tensor = torch.from_numpy(arr)[None, ...]  # (1,H,W,C)

            if ref_tensor is not None:
                tensor = tensor.to(device=ref_tensor.device, dtype=ref_tensor.dtype)

            return tensor

        except Exception as e:
            print(f"[LoadImageWithFileData] error loading {label} image from '{path}': {e}")
            return None

    def _make_black_64(self, ref_tensor):
        """
        Creates a black image 64×64 (IMAGE) на том же device/dtype,
        что и ref_tensor.
        """
        device = getattr(ref_tensor, "device", "cpu")
        dtype = getattr(ref_tensor, "dtype", torch.float32)
        print(
            f"[LoadImageWithFileData] _make_black_64: creating black 64x64 image "
            f"on device={device}, dtype={dtype}"
        )
        return torch.zeros((1, 64, 64, 3), device=device, dtype=dtype)

    # ------------------------------------------------------------------
    # translated comment
    # ------------------------------------------------------------------
    def load_image(self, image, updater=0.0, unique_id=None):
        print(
            f"[LoadImageWithFileData] load_image: image='{image}', "
            f"updater={updater}, unique_id='{unique_id}'"
        )

        # 1. Load the image стандартной LoadImage
        base_loader = nodes.LoadImage()
        base_image, base_mask = base_loader.load_image(image)

        # 1. Take the input image name и сохраняем имя картинки в переменной imageOriginalName
        abs_path = folder_paths.get_annotated_filepath(image)
        dir_path, file_name_ext = os.path.split(abs_path)
        imageOriginalName, _ = os.path.splitext(file_name_ext)

        print(
            "[LoadImageWithFileData] load_image: "
            f"abs_path='{abs_path}', dir_path='{dir_path}', "
            f"file_name_ext='{file_name_ext}', imageOriginalName='{imageOriginalName}'"
        )

        # 1.1 Create variable outputMask = None
        outputMask = None

        # 1.2 Build json file name как rgbyp_idНоды и записываем в переменную jsonFileName
        temp_dir = folder_paths.get_temp_directory()
        os.makedirs(temp_dir, exist_ok=True)

        if unique_id is not None:
            jsonFileName = f"rgbyp_{unique_id}.json"
            json_path = os.path.join(temp_dir, jsonFileName)
        else:
            jsonFileName = None
            json_path = None

        print(
            "[LoadImageWithFileData] load_image: "
            f"temp_dir='{temp_dir}', jsonFileName='{jsonFileName}', json_path='{json_path}'"
        )

        # 1.3 Сохраняем полный путь к выбранной картинке в переменной filePath
        filePath = dir_path

        # 1.4 Сохраняем имя файла картинки без расширения в переменной fileName
        fileName = imageOriginalName

        # 2. Check if exists в папке temp json с именем jsonFileName
        if json_path is not None and os.path.isfile(json_path):
            print(f"[LoadImageWithFileData] load_image: json exists at '{json_path}'")
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
            except Exception as e:
                print(
                    f"[LoadImageWithFileData] load_image: error reading json '{json_path}': {e}"
                )
                meta = {}

            mask_rel = str(meta.get("mask") or "").strip()
            print(
                "[LoadImageWithFileData] load_image: "
                f"json mask field='{mask_rel}'"
            )

            # IF FIELD mask НЕ ПУСТОЕ
            if mask_rel:
                # mask_rel может быть абсолютным путём или именем файла в temp
                mask_path = (
                    mask_rel if os.path.isabs(mask_rel) else os.path.join(temp_dir, mask_rel)
                )
                print(
                    "[LoadImageWithFileData] load_image: "
                    f"resolved mask_path='{mask_path}'"
                )

                if os.path.isfile(mask_path):
                    # translated comment
                    outputMask = self._load_image_from_path(
                        mask_path, ref_tensor=base_image, label="rgbyp_mask"
                    )
                    if outputMask is None:
                        print(
                            "[LoadImageWithFileData] load_image: failed to load mask image, "
                            "will fallback to black 64x64"
                        )
                else:
                    print(
                        "[LoadImageWithFileData] load_image: mask file does not exist, "
                        "will fallback to black 64x64"
                    )
            else:
                # IF FIELD ПУСТОЕ
                print(
                    "[LoadImageWithFileData] load_image: json mask field is empty, "
                    "will use black 64x64 mask"
                )
        else:
            # IF JSON DOES NOT EXIST
            if json_path is not None:
                print(
                    "[LoadImageWithFileData] load_image: json not found at "
                    f"'{json_path}', will use black 64x64 mask"
                )
            else:
                print(
                    "[LoadImageWithFileData] load_image: unique_id is None, "
                    "skipping json lookup and using black 64x64 mask"
                )

        # translated comment
        if outputMask is None:
            outputMask = self._make_black_64(base_image)

        print(
            "[LoadImageWithFileData] load_image: done, returning base_image, outputMask, "
            "base_mask, filePath, fileName"
        )
        return (
            base_image,
            outputMask,
            base_mask,
            filePath,
            fileName,
        )
    # ------------------------------------------------------------------
    # CHANGE DETECTION / VALIDATION
    # ------------------------------------------------------------------
    @classmethod
    def IS_CHANGED(cls, image, updater=0.0, **kwargs):
        base_changed = nodes.LoadImage.IS_CHANGED(image)
        try:
            if base_changed is not None and not np.isnan(float(base_changed)):
                return base_changed
        except Exception:
            pass
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
