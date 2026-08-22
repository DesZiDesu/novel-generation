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
