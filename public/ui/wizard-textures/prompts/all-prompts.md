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

---

# wizard-buttons

Size: 1024x1024

Prompt:
dark fantasy wizard game UI, hand-painted but clean production game asset, transparent background, isolated asset sheet, no text, no letters, no numbers, no logo, no watermark, orthographic front view, sharp readable silhouette at small sizes, consistent amber, ember red, cyan mana, steel, and smoky black palette, ready for web game UI textures, create a UI atlas of blank wizard menu buttons, include normal, hover, pressed, disabled, and selected states, include small square icon button frames and wider rectangular command button frames, all buttons must be empty with no glyphs and no words, corners should be mildly rounded, under 8 px when scaled down, clear 9-slice safe center areas for text rendered by HTML

Negative prompt:
photorealistic, mockup screen, perspective skew, drop shadow outside alpha bounds, blurred edges, baked words, letters, numbers, logo, watermark, random icons

Slicing notes:
- button_normal: 9-slice
- button_hover: 9-slice
- button_pressed: 9-slice
- button_disabled: 9-slice
- icon_button: 9-slice or fixed square

---

# spell-icons

Size: 1024x1024

Prompt:
dark fantasy wizard game UI, hand-painted but clean production game asset, transparent background, isolated asset sheet, no text, no letters, no numbers, no logo, no watermark, orthographic front view, sharp readable silhouette at small sizes, consistent amber, ember red, cyan mana, steel, and smoky black palette, ready for web game UI textures, create 12 square spell icons in a clean 4 by 3 grid, include firebolt, fireball, ice bolt, frost nova, lightning bolt, chain lightning, shield, heal, teleport, summon, mana surge, and portal, each icon must have a transparent background and a consistent dark metal square frame, icons must read clearly at 48 by 48 pixels, no text and no numerals

Negative prompt:
photorealistic, mockup screen, perspective skew, drop shadow outside alpha bounds, blurred edges, baked words, letters, numbers, logo, watermark, random icons

Slicing notes:
- grid: 4 columns by 3 rows
- slice each icon as a square frame plus icon art
- keep alpha around each cell

---

# panel-borders

Size: 1024x1024

Prompt:
dark fantasy wizard game UI, hand-painted but clean production game asset, transparent background, isolated asset sheet, no text, no letters, no numbers, no logo, no watermark, orthographic front view, sharp readable silhouette at small sizes, consistent amber, ember red, cyan mana, steel, and smoky black palette, ready for web game UI textures, create ornate but restrained panel borders for a wizard RPG interface, include one large panel frame, one compact tooltip frame, one inventory slot frame, one alert frame, and four divider ornaments, frames must have transparent centers for live HTML content, include 9-slice-safe corners and edges, make the art quiet enough for repeated gameplay menus

Negative prompt:
photorealistic, mockup screen, perspective skew, drop shadow outside alpha bounds, blurred edges, baked words, letters, numbers, logo, watermark, random icons

Slicing notes:
- large_panel: 9-slice, transparent center
- tooltip: 9-slice, transparent center
- inventory_slot: fixed square or 9-slice
- alert_frame: 9-slice
- dividers: fixed horizontal ornaments
