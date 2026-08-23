# Novel Generation

A SillyTavern UI extension for roleplay-oriented image generation and a standalone full-screen image studio.

## Phase 1 included

- Extension settings drawer in the SillyTavern Extensions panel.
- All settings categories are collapsible and closed by default.
- Custom / reverse-proxy OpenAI-compatible connection fields.
- Direct NovelAI API provider mode using the official image.novelai.net native image routes.
- Base URL, API key, model, response format, timeout, model discovery, and connection test.
- Default image parameter controls.
- Roleplay integration toggles.
- Prepared categories for Vibe Transfer, Precise Reference, Inpaint, Image-to-Image, Multi-Character prompting, Gallery and Export.
- Wand menu button: **Novel Image Gen** with Portrait, Selfie, User, Last Message, Manga Panel, and Free / Scene modes.
- Wand menu button: **Novel Gen** for the standalone full-screen generation workspace.
- Responsive desktop/mobile layout including iOS safe-area handling.

## Install

In SillyTavern open **Extensions → Install Extension** and paste:

`https://github.com/DesZiDesu/novel-generation`

## Current scope

The runtime and stylesheet are consolidated into one file each. The current UI and connection layer include persistent API-key storage, proxy model discovery, a Direct NovelAI provider mode, official native image routing, Vibe Transfer encoding, separate Character Prompts, Precise Reference, image editing, gallery/export, mobile Studio navigation, and the Prompt Assistant. Provider-specific route differences are handled through explicit adapter attempts and surfaced in Request Debug when unsupported.

## Full Photo Analysis

The **Reference Image Analysis** workspace is available inside Novel Gen → AI Prompt Helper.

- Select an image from the device, drag and drop it, replace it, or remove it.
- Ask for a transformation or emphasis, such as changing the background or preserving a specific outfit.
- Choose **Pure tags prompt** for one comma-separated tag line, or **Native-language prompt** for one polished prompt paragraph.
- Choose the output language and a vision-capable model. The analyzer reuses the existing OpenAI-compatible proxy Base URL and key; it does not create a second credential.
- Copy the result or download it as a text file. Large images are resized only for analysis to keep requests practical.
- Direct NovelAI image generation is not a vision endpoint, so an OpenAI-compatible vision model must be configured for photo analysis.

Each click on **Analyze image** makes one vision chat-completion request.

## Artist Mix and numerical emphasis

- Selected Danbooru artists are stored as a structured Artist Mix instead of being repeatedly appended to the editable prompt.
- The mix is composed exactly once when generation starts and is sent consistently through Direct NovelAI and compatible proxy payloads.
- Artist tags are placed after any leading `fur dataset` or `background dataset` tag and before the main prompt.
- **Effective Prompt Preview** shows the exact composed prompt before generation.
- Artist emphasis updates live on iOS: `1.0` is neutral, values below `1.0` weaken, values above `1.0` strengthen, and negative values target removal or inversion where the selected model supports them.
- **Clean old artist tags** removes artist tags embedded by older extension releases, while **Lock comparison seed** makes A/B style balancing more repeatable.

Equal emphasis values do not guarantee an equal-looking style blend. Artist tags can have different learned strength, so keep the comparison seed fixed and lower the dominant artist or raise the weaker one gradually.

## Original image saving and gallery memory

- **Save Original** fetches the provider image as a Blob and saves those original bytes without drawing through a canvas, resizing, or recompressing the image.
- The save confirmation reports the decoded pixel dimensions, format, and file size. On iPhone/iPad the native share sheet is used when file sharing is available.
- The session gallery defaults to 16 full-resolution images and can be configured from 1–40 under **Gallery & Export**. Older images are released automatically when the limit is exceeded.
- Gallery images can be removed individually or cleared with **Clear All**. Clearing releases the gallery's large data references but does not delete files already saved or images inserted into chat.

## Proxy response compatibility

- Chat-completion image proxies may return the generated image directly in `choices[].message.content` as a `data:image/...;base64,...` URL. Novel Generation recognizes this response and stops fallback attempts as soon as the image is found.
- Chat image requests send the selected pixel size through both the Novel Generation envelope and the standard top-level `image_config`, including an exact aspect ratio. This prevents compatible chat proxies from silently using their default horizontal canvas when Portrait is selected.
- Every returned image is decoded and checked against the requested dimensions. If a provider still ignores or swaps width and height, the real returned size is shown in the gallery and Request Debug records a `dimension-check` entry instead of reporting the requested size as though it succeeded.
- **Chat proxy size order** can be set to Auto, Standard, or Reversed under Image Parameters. Auto learns an exact width/height reversal after one mismatch and swaps only future chat transport dimensions; it never launches an unapproved second paid generation.
- **Returned-size safeguard** permanently handles proxies that ignore every size field. The default Exact size — center crop mode converts only mismatched responses to the selected pixel dimensions in the browser. Exact size — fit + blurred background preserves the whole provider image. Both make a PNG locally, record the correction in Request Debug, and make zero additional generation requests; Keep provider original disables processing.
- In Auto route mode, a missing `/v1/images/generations` endpoint is remembered for the current page session. The extension tries `/v1/chat/completions` immediately instead of repeating the same request with every image payload schema.

## AI Prompt Helper formats

- Text ideas can be generated as **Pure Tags**, **Natural Language**, or **Hybrid — Tags + Description**. The selected mode and description language are remembered.
- Pure Tags always uses concise English NovelAI/Danbooru-style tags. Natural Language writes one coherent paragraph in the selected language. Hybrid combines an English tag line with a descriptive paragraph for complex composition and interaction.
- The helper detects a selected NAI Diffusion V5 model and asks the connected SillyTavern AI to take advantage of V5 spatial relationships, character interaction, detailed environments, materials, effects, and text placement.
- Quality and local suggestion tags apply only to the tag portion of Tags/Hybrid output. Replace and Append preserve paragraphs instead of flattening Natural Language or Hybrid prompts into comma-separated tags.
