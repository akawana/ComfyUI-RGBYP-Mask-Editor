
import torch
import numpy as np
from PIL import Image, ImageFilter

class MaskGrowBlur:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mask": ("MASK",),
                "grow_strength": ("INT", {"default": 0, "min": 0, "step": 1}),
                "blur_strength": ("INT", {"default": 0, "min": 0, "step": 1}),
            }
        }

    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("mask",)
    FUNCTION = "apply"
    CATEGORY = "AK/mask"

    def apply(self, mask, grow_strength=0, blur_strength=0):
        if mask is None:
            return (None,)

        if not isinstance(mask, torch.Tensor):
            try:
                mask = torch.tensor(mask, dtype=torch.float32)
            except Exception:
                return (None,)

        device = mask.device
        dtype = mask.dtype

        t = mask.detach().to("cpu").float()

        if t.dim() == 2:
            batch = [t]
            batched = False
        elif t.dim() == 3:
            batch = [t[i] for i in range(t.shape[0])]
            batched = True
        elif t.dim() == 4:
            batch = [t[i, 0] for i in range(t.shape[0])]
            batched = True
        else:
            batch = [t.reshape(t.shape[-2], t.shape[-1])]
            batched = False

        gs = int(grow_strength) if grow_strength is not None else 0
        bs = int(blur_strength) if blur_strength is not None else 0
        gs = max(gs, 0)
        bs = max(bs, 0)

        out_list = []
        for m in batch:
            arr = m.numpy()
            arr = np.clip(arr, 0.0, 1.0)
            img = (arr * 255.0 + 0.5).astype(np.uint8)
            pil = Image.fromarray(img, mode="L")

            if gs > 0:
                k = gs * 2 + 1
                pil = pil.filter(ImageFilter.MaxFilter(size=k))

            if bs > 0:
                pil = pil.filter(ImageFilter.GaussianBlur(radius=bs))

            out = torch.from_numpy(np.array(pil, dtype=np.float32) / 255.0)
            out = torch.clamp(out, 0.0, 1.0)
            out_list.append(out)

        if batched:
            out_t = torch.stack(out_list, dim=0)
        else:
            out_t = out_list[0]

        out_t = out_t.to(device=device, dtype=dtype)
        return (out_t,)


NODE_CLASS_MAPPINGS = {
    "MaskGrowBlur": MaskGrowBlur
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MaskGrowBlur": "Mask Grow Blur"
}
