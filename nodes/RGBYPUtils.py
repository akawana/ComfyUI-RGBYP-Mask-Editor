import os
import numpy as np
import torch
from PIL import Image


def _load_image_from_path(path, ref_tensor=None):
    if not path or not os.path.isfile(path):
        return None

    try:
        img = Image.open(path).convert("RGBA")

        if ref_tensor is not None:
            try:
                _, h, w, _ = ref_tensor.shape
                if img.size != (w, h):
                    img = img.resize((w, h), resample=Image.BILINEAR)
            except Exception:
                pass

        arr = np.array(img).astype(np.float32) / 255.0
        tensor = torch.from_numpy(arr)[None, ...]

        if ref_tensor is not None:
            tensor = tensor.to(device=ref_tensor.device, dtype=ref_tensor.dtype)

        return tensor
    except Exception:
        return None


def _make_black_mask_64(device="cpu"):
    return torch.zeros((1, 64, 64), device=device, dtype=torch.float32)


def _make_black_64(device="cpu", dtype=torch.float32):
    return torch.zeros((1, 64, 64, 3), device=device, dtype=dtype)


# ---------------------------
# Additional helpers for RGBYPMaskBridge (kept additive to avoid breaking other nodes)
# ---------------------------

import folder_paths


def _rgbyp_clipspace_dir():
    return os.path.join(folder_paths.get_input_directory(), "clipspace")


def _ensure_clipspace_dir():
    d = _rgbyp_clipspace_dir()
    os.makedirs(d, exist_ok=True)
    return d


def _tensor_to_uint8_rgba(tensor):
    # tensor: (1,H,W,C) float 0..1, C=3 or 4
    if tensor is None:
        return None
    if isinstance(tensor, torch.Tensor):
        t = tensor
    else:
        return None
    if t.dim() != 4 or t.shape[0] != 1:
        return None
    t = t.detach()
    if t.device.type != "cpu":
        t = t.to("cpu")
    t = t.float().clamp(0.0, 1.0)[0]
    h, w, c = int(t.shape[0]), int(t.shape[1]), int(t.shape[2])
    if c == 3:
        alpha = torch.ones((h, w, 1), dtype=t.dtype)
        t = torch.cat([t, alpha], dim=2)
    elif c != 4:
        # best-effort: pad/truncate to 4
        if c > 4:
            t = t[:, :, :4]
        else:
            pad = torch.zeros((h, w, 4 - c), dtype=t.dtype)
            t = torch.cat([t, pad], dim=2)
    arr = (t.numpy() * 255.0).round().astype(np.uint8)
    return arr


def save_image_tensor_to_clipspace(tensor, filename, max_side: int = 0):
    """Save IMAGE tensor to input/clipspace as PNG. Optionally downscale to fit max_side (keeps aspect)."""
    if not filename or not isinstance(filename, str):
        return None

    d = _ensure_clipspace_dir()
    path = os.path.join(d, filename)

    try:
        arr = _tensor_to_uint8_rgba(tensor)
        if arr is None:
            return None

        img = Image.fromarray(arr, mode="RGBA")

        # Optional downscale
        if isinstance(max_side, int) and max_side > 0:
            w, h = img.size
            mx = max(w, h)
            if mx > max_side:
                scale = max_side / float(mx)
                nw = max(1, int(round(w * scale)))
                nh = max(1, int(round(h * scale)))

                # Pillow compatibility: Resampling may not exist in very old versions
                try:
                    resample = Image.Resampling.LANCZOS
                except Exception:
                    resample = Image.LANCZOS

                img = img.resize((nw, nh), resample=resample)

        img.save(path, format="PNG")
        return filename
    except Exception:
        return None


def save_preview_image_tensor_to_clipspace(tensor, filename, max_side=512):
    """Save a downscaled preview PNG into input/clipspace to keep IO cheap."""
    if not filename or not isinstance(filename, str):
        return None
    d = _ensure_clipspace_dir()
    path = os.path.join(d, filename)
    try:
        arr = _tensor_to_uint8_rgba(tensor)
        if arr is None:
            return None
        img = Image.fromarray(arr, mode="RGBA")
        try:
            w, h = img.size
            # ms = int(max_side) if max_side else 512
            ms = int(max_side) if max_side is not None else None
            if ms is not None and ms > 0 and (w > ms or h > ms):
                if w >= h:
                    nw = ms
                    nh = max(1, int(round(h * (ms / float(w)))))
                else:
                    nh = ms
                    nw = max(1, int(round(w * (ms / float(h)))))
                img = img.resize((nw, nh), resample=Image.LANCZOS)
        except Exception:
            pass
        img.save(path, format="PNG")
        return filename
    except Exception:
        return None


def clipspace_exists(filename):
    if not filename or not isinstance(filename, str):
        return False
    return os.path.isfile(os.path.join(_rgbyp_clipspace_dir(), filename))


def clipspace_image_size(filename):
    if not clipspace_exists(filename):
        return None
    try:
        img = Image.open(os.path.join(_rgbyp_clipspace_dir(), filename))
        return img.size  # (w,h)
    except Exception:
        return None


def clipspace_path(filename: str):
    if not filename or not isinstance(filename, str):
        return None
    return os.path.join(_rgbyp_clipspace_dir(), filename)


def bake_composite_with_mask(image, mask_rgba, opacity=0.7):
    """Returns composite IMAGE tensor (1,H,W,3) given base image (1,H,W,3) and mask (1,H,W,4 or 3)."""
    if image is None or not isinstance(image, torch.Tensor):
        return None
    if mask_rgba is None or not isinstance(mask_rgba, torch.Tensor):
        return image
    if image.dim() != 4 or image.shape[0] != 1:
        return None
    base = image
    if mask_rgba.dim() != 4 or mask_rgba.shape[0] != 1:
        return base

    # Move mask to base device/dtype
    m = mask_rgba.to(device=base.device, dtype=base.dtype)

    # Ensure same size
    try:
        _, h, w, _ = base.shape
        if m.shape[1] != h or m.shape[2] != w:
            # Use PIL for resize (safer for mask files)
            tmp = m.detach()
            if tmp.device.type != "cpu":
                tmp = tmp.to("cpu")
            arr = tmp.float().clamp(0.0, 1.0)[0].numpy()
            img = Image.fromarray(
                (arr * 255.0).astype(np.uint8),
                mode="RGBA" if arr.shape[2] == 4 else "RGB",
            )
            img = img.resize((int(w), int(h)), resample=Image.BILINEAR)
            arr2 = np.array(img).astype(np.float32) / 255.0
            m = torch.from_numpy(arr2)[None, ...].to(
                device=base.device, dtype=base.dtype
            )
    except Exception:
        pass

    if m.shape[-1] == 4:
        mask_rgb = m[..., :3]
        alpha = m[..., 3:4]
    else:
        mask_rgb = m[..., :3]
        alpha = (mask_rgb.mean(dim=-1, keepdim=True) > 0.0).to(dtype=base.dtype)

    a = (alpha.clamp(0.0, 1.0) * float(opacity)).clamp(0.0, 1.0)
    comp = base * (1.0 - a) + mask_rgb * a
    return comp.clamp(0.0, 1.0)


def _image_fingerprint_variantA(image):
    """Fast fingerprint: (data_ptr, shape, dtype, device)."""
    if image is None or not isinstance(image, torch.Tensor):
        return None
    try:
        ptr = int(image.data_ptr())
    except Exception:
        ptr = None
    try:
        shape = tuple(int(x) for x in image.shape)
    except Exception:
        shape = None
    try:
        dtype = str(image.dtype)
    except Exception:
        dtype = None
    try:
        device = str(image.device)
    except Exception:
        device = None
    return (ptr, shape, dtype, device)


def is_input_image_changed_variantA(prev_fingerprint, image):
    """Returns (is_changed: bool, new_fingerprint)."""
    new_fp = _image_fingerprint_variantA(image)
    if prev_fingerprint is None:
        return True, new_fp
    return (new_fp != prev_fingerprint), new_fp


def _rgbyp_mask_to_regular_mask(rgbyp_mask, device=None):
    if isinstance(rgbyp_mask, torch.Tensor) and rgbyp_mask.dim() == 4:
        if rgbyp_mask.shape[-1] >= 4:
            mask = rgbyp_mask[..., 3]  # alpha -> (1,H,W)
        else:
            mask = (rgbyp_mask[..., :3].mean(dim=-1) > 0).float()

        if device is not None:
            mask = mask.to(device=device, dtype=torch.float32)
        else:
            mask = mask.to(dtype=torch.float32)

        return mask

    if device is not None:
        return _make_black_mask_64(device)
    return None


def get_dhash(image: torch.Tensor, hash_size: int = 8) -> int:
    """
    Compute dHash (difference hash) for an IMAGE tensor (1,H,W,C).

    Algorithm:
      1. Convert to grayscale
      2. Resize to (hash_size+1) x hash_size
      3. Compare each pixel to its right neighbour in each row
      4. Pack 64 bits into a single int

    Returns: int (64-bit hash), or 0 on failure.

    Hamming distance interpretation:
      < 10  — visually similar (re-render, minor change)
      > 20  — different image
    """
    if image is None or not isinstance(image, torch.Tensor):
        return 0
    if image.dim() != 4 or image.shape[0] != 1:
        return 0

    try:
        t = image.detach()
        if t.device.type != "cpu":
            t = t.to("cpu")
        t = t.float().clamp(0.0, 1.0)[0]  # (H, W, C)

        c = int(t.shape[2])
        if c >= 3:
            # Luminance weights: 0.299 R + 0.587 G + 0.114 B
            gray = t[:, :, 0] * 0.299 + t[:, :, 1] * 0.587 + t[:, :, 2] * 0.114
        else:
            gray = t[:, :, 0]  # single channel

        # (H,W) → PIL → resize to (hash_size+1, hash_size)
        arr = (gray.numpy() * 255.0).round().astype(np.uint8)
        img = Image.fromarray(arr, mode="L")
        try:
            resample = Image.Resampling.LANCZOS
        except AttributeError:
            resample = Image.LANCZOS
        img = img.resize((hash_size + 1, hash_size), resample=resample)

        pixels = np.array(img)  # (hash_size, hash_size+1)

        # Compare each pixel to the one to its right
        diff = pixels[:, :-1] > pixels[:, 1:]  # (hash_size, hash_size) bool

        # Pack into integer
        flat = diff.flatten()  # 64 bits
        result = 0
        for bit in flat:
            result = (result << 1) | (1 if bit else 0)

        return int(result)
    except Exception:
        return 0


def dhash_distance(a: int, b: int) -> int:
    """Hamming distance between two dHash values."""
    x = a ^ b
    dist = 0
    while x:
        dist += x & 1
        x >>= 1
    return dist


def is_image_changed(prev_sig, image: torch.Tensor, grid: int = 12):
    """
    Cheap content-aware change detector for IMAGE tensor (1,H,W,C).

    Returns:
      (is_changed: bool, new_sig)

    Notes:
      - Works even if upstream reuses the same buffer (data_ptr unchanged).
      - Uses a small sampled grid (grid x grid) from RGB channels and a few aggregates.
      - Does NOT hash the whole image.
    """
    if image is None or not isinstance(image, torch.Tensor):
        return True, None
    if image.dim() != 4 or image.shape[0] != 1:
        return True, None

    try:
        _, h, w, c = image.shape
        h = int(h); w = int(w); c = int(c)
    except Exception:
        return True, None

    cc = 3 if c >= 3 else c
    if cc <= 0:
        return True, None

    # Detach + CPU float32 for stable signature
    t = image.detach()
    if t.device.type != "cpu":
        t = t.to("cpu")
    t = t.float().clamp(0.0, 1.0)[0, :, :, :cc]  # (H,W,cc)

    g = int(grid) if grid else 12
    if g < 2:
        g = 2

    ys = torch.linspace(0, h - 1, steps=g).round().long().clamp(0, h - 1)
    xs = torch.linspace(0, w - 1, steps=g).round().long().clamp(0, w - 1)

    samp = t.index_select(0, ys).index_select(1, xs)  # (g,g,cc)
    q = (samp * 255.0).round().clamp(0.0, 255.0).to(torch.int16)

    # Aggregates
    s0 = int(q.sum().item())
    s1 = int(q[:, :, 0].sum().item()) if cc >= 1 else 0
    s2 = int(q[:, :, 1].sum().item()) if cc >= 2 else 0
    s3 = int(q[:, :, 2].sum().item()) if cc >= 3 else 0

    # Mixed checksum
    flat0 = q[:, :, 0].reshape(-1).to(torch.int32) if cc >= 1 else None
    if flat0 is not None:
        w1 = torch.arange(1, flat0.shape[0] + 1, dtype=torch.int32)
        mix0 = int((flat0 * w1).sum().item())
    else:
        mix0 = 0

    # Meta to avoid collisions across different tensors
    try:
        shape = tuple(int(x) for x in image.shape)
    except Exception:
        shape = None
    try:
        dtype = str(image.dtype)
    except Exception:
        dtype = None
    try:
        device = str(image.device)
    except Exception:
        device = None

    new_sig = (shape, dtype, device, g, s0, s1, s2, s3, mix0)

    if prev_sig is None:
        return True, new_sig
    return (new_sig != prev_sig), new_sig
