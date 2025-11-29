# ComfyUI-RGBYP-Mask-Editor
RGB + Yellow + Pink 5-color mask editor for ComfyUI

## Overview
**RGBYP Mask Editor** is a custom JavaScript node that adds a full-featured color mask editor with 5 channels (RGB + Yellow + Pink).

The node saves its working files inside `/ComfyUI/temp/`, which allows masks to persist even after refreshing the browser page.  
⚠️ All files inside `/temp/` are automatically cleared when you restart ComfyUI.

The editor works on any image node (Load Image, Preview, etc.), but the package also includes special nodes that directly output RGBYP masks as separate images:

- **LoadImageWithFileData**
- **RGBYPMaskBridge**
- **RGBYPMaskToRegularMasks**

---

## RGBYP Mask Editor
The editor opens from the **Right-Click menu** on nodes containing images.  
The menu entry appears near the top.

### Keyboard Shortcuts
- **1 / 2 / 3 / 4 / 5** — switch color  
- **SHIFT + A / D** — brush size  
- **SHIFT + W / S** — mask opacity  
- **SHIFT + Z / X** — zoom  
- **SHIFT + N** — clear mask  
- **SPACE (hold)** — pan the image  
- **ENTER** — save mask & close  
- **ESC** — cancel & close

### Mouse Controls
- **Left click** — brush  
- **Right click** — eraser  
- **Middle click** — pan  
- **Mouse wheel** — zoom

### Opacity Note
Changing opacity only affects the **preview**, including previews in nodes.  
It **does not** affect the final mask file.  
Default opacity is **75%**.

### Auto-Mask Tools (4 buttons)
Fill the mask horizontally:
- Split in half  
- Split 1:2  
- Split 2:1  
- Split into thirds  

---

## LoadImageWithFileData
A standard image-loading node that also outputs the RGBYP mask (or a 64×64 black placeholder if no mask was drawn).

Additional outputs:
- **dir_path** — directory path without filename  
- **file_path** — full path including filename  
- **file_name** — filename without extension  
- **file_name_ext** — filename with extension  

---

## RGBYPMaskBridge
Passes the input image through and allows drawing an RGBYP mask directly on it.  
Outputs both the image and the mask.

---

## RGBYPMaskToRegularMasks
Converts a single RGBYP mask image into **five separate grayscale masks**.  
A minimalistic utility for quick splitting.

---

## F.A.Q.

### Can I draw masks on regular Load Image and other nodes?
Yes, but keep in mind:

1. They output the **image with the mask baked in**, not the mask itself.  
2. Your mask edits will be lost if you refresh the browser.  
   (My nodes preserve masks because they store temp files.)

### How do I keep my mask after a full ComfyUI restart?
The RGBYP mask is just an image.  
Save the generated mask manually to your output folder and load it again in the next session.

---
