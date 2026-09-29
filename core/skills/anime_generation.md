# Character Illustration Engine (Illustrious SDXL)

## Engine Overview
You have access to a local Illustrious SDXL engine with dynamic character LoRA chaining. This engine produces high-quality anime artwork, illustrations, and official character depictions.

## Tool Signature
```
TOOL_CALL: generate_anime_image({"character": "character_key", "outfit": "outfit_key", "expression": "smile", "prompt": "scene description"})
```

## Parameters
1. **character** (string, required):
   - The registered character key (e.g. `orihime_inoue`, `makima`, `remi`, `chisato_nishikigi`).
   - If the user wants a general anime girl, anime boy, or general scene without a specific character, set `"character": "none"`.
2. **outfit** (string, optional):
   - The character's specific outfit key (e.g. `school_uniform`, `casual`, `swimsuit`, `battle`).
   - If not specified by the user or unknown, omit or set to `null`.
3. **hairstyle** (string, optional):
   - Specific hairstyle key (e.g. `ponytail`, `twintails`, `short_hair`).
   - If not specified, omit or set to `null`.
4. **expression** (string, optional, default `"smile"`):
   - Facial expression: `smile`, `big_grin`, `wink`, `smug`, `blush`, `embarrassed`, `pout`, `serious`, `sad`, `angry`.
5. **prompt** (string, required):
   - A vivid visual description of what the character is doing, the setting, background elements, mood, and lighting.
   - Example: `"sitting on a wooden bench in a sunlit park, reading a book with autumn leaves falling softly around her"`.
   - **CRITICAL**: Describe what is actually happening in the scene based on the user's request. NEVER copy placeholder phrases like "rich scene and lighting description".
6. **concept** / **pose** (string, optional):
   - ONLY pass a concept or pose if the user specifically asked for one. Otherwise leave them out or set to `"none"`.
7. **use_lcm** (boolean, optional, default `false`):
   - Full quality (28 diffusion steps) is the default.
   - Set `"use_lcm": true` ONLY if the user explicitly requests fast, turbo, quick, or speed mode (8 steps).
8. **resolution** (string, optional, default `"portrait"`):
   - `"portrait"` (832x1216), `"landscape"` (1216x832), or `"square"` (1024x1024).

## Critical Execution Rules
1. **Single Turn Output**: Output ONLY the `TOOL_CALL: generate_anime_image(...)` line. Do NOT write an assistant description of the image in the same message before the image has been rendered.
2. **Image Editing Note**: If the user wants to alter, re-color, add elements to, or modify an existing anime image they already generated or uploaded, use the `edit_image` tool from the **image_studio** skill.
