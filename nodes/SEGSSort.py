import logging

class SEGSSort:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "segs": ("SEGS",),
                "labels": ("STRING", {"multiline": True, "placeholder": "Unused. Kept for interface compatibility"}),
            },
        }

    RETURN_TYPES = ("SEGS",)
    RETURN_NAMES = ("sorted_segs",)
    FUNCTION = "doit"

    CATEGORY = "AK/_testing_"

    @staticmethod
    def sort_segs(segs):
        header, seg_list = segs
        try:
            sorted_list = sorted(seg_list, key=lambda x: (x.label if x.label is not None else ""))
        except Exception as e:
            logging.warning(f"[Impact Pack] SEGSSort: sorting failed: {e}")
            sorted_list = list(seg_list)

        return ((header, sorted_list),)

    def doit(self, segs, labels):
        return SEGSSort.sort_segs(segs)
