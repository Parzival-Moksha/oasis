# rp1-hud-bars

Size: 1024x1024

Prompt:
dark fantasy wizard game UI, hand-painted but clean production game asset, transparent background, isolated asset sheet, no text, no letters, no numbers, no logo, no watermark, orthographic front view, sharp readable silhouette at small sizes, consistent amber, ember red, cyan mana, steel, and smoky black palette, ready for web game UI textures, create a UI atlas for RPG health and mana bars, include one empty ornate HP frame, one red filled HP segment, one empty ornate mana frame, one blue filled mana segment, include simple end caps and center stretch regions that can be used as 9-slice textures, leave at least 24 pixels of transparent padding around every element, elements must be horizontally aligned, cleanly separated, and easy to slice

Negative prompt:
photorealistic, mockup screen, perspective skew, drop shadow outside alpha bounds, blurred edges, baked words, letters, numbers, logo, watermark, random icons

Slicing notes:
- hp_frame: 9-slice, preserve left/right caps, stretch center only
- hp_fill: horizontal repeat or stretch
- mana_frame: 9-slice, preserve left/right caps, stretch center only
- mana_fill: horizontal repeat or stretch
