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

### Updating without clearing browser data

The current manifest loads `index.js?v=0.8.6` and `style.css?v=0.8.6`. Versioned asset URLs let Safari and other browsers request the new runtime and stylesheet while keeping existing cached files, cookies, API settings and prompt drafts. After updating the extension on `main`, reload the SillyTavern page normally to activate the new code. Clearing Safari cache or website data is unnecessary. Future releases must update the asset URL versions together with the manifest and runtime versions.

The cache regression test is `CHROMIUM_PATH=/usr/bin/chromium node tests/cached-update.cjs`, or `BROWSER=webkit node tests/cached-update.cjs`, against an isolated SillyTavern installation. It warms the browser's real HTTP cache with a 0.8.0 fixture, publishes the current manifest, then verifies the current Studio loads while old cached assets and saved state remain available. The fixture serves manifests without caching so the test isolates stale JavaScript/CSS; a host that also serves a stale manifest must update/revalidate that metadata.

## Current scope

### Provider diagnostics in 0.8.6

- Connection success confirms model discovery; image generation is tested separately. A key can load models and work on one channel while another channel rejects its upstream token or returns gateway errors.
- Request Debug distinguishes HTML gateway pages, provider JSON errors, authentication failures, and a native channel rejecting `parameters` even though the request includes them. HTML errors retain their title and Cloudflare Ray ID when supplied, rather than showing truncated page markup. Provider codes and request IDs remain available; the active API key is redacted.
- `Invalid token` does not establish whether the user's key or a channel's upstream credential was rejected. An authentication error returned as HTTP 400 by SillyTavern stops payload-schema fallback; opt-in Constant generation still retries it as requested.
- When SillyTavern's Custom API bridge is in use, native image/encoder capabilities say **Unavailable through this connection; provider support untested**. No native probe is sent or reported as a provider 404. Inpaint and Precise Reference support still require a working native route and real feature validation. Native route candidates no longer contain duplicate `/v1/v1/` segments.
- Successful non-JSON responses pass through the bridge to the image parser. Payload formats, selected models, and immediate sequential Constant retries remain unchanged.

### OpenAI chat canvas fix in 0.8.3

OpenAI-compatible NAI chat requests now include `size`, `width`, `height` and `aspect_ratio` at the top level, using the same resolved canvas as the nested compatibility fields. RVL's `[DM][OAI]` NAI 5 channel ignored dimensions sent only inside `image_config`/`image_generation`, returning a landscape image for Portrait. A live top-level request returned the requested 832 × 1216 portrait. Seed and other provider-control limitations are separate and remain reported.

### Manual retry and Constant generation in 0.8.5

- There is no extension cooldown after an error, including HTTP 429. Generate becomes available as soon as the current job finishes, allowing an immediate manual retry. Provider rate limits still apply to each request.
- **Constant generation** is opt-in: it attempts one image and sends the next attempt immediately after any error (including 429, authentication/quota errors, network errors and timeouts), stopping at the first successful image. There is no intentional pause between attempts; the next attempt is scheduled on a zero-delay browser timer so Stop remains responsive. Request speed depends on how quickly the provider responds and browser scheduling. It uses the selected model and seed mode, without switching models or URLs. Manual Generate cancels the loop and makes one normal attempt.
- **Stop constant generation**, closing Studio, leaving the page, or changing the connection/model ends further attempts. A request already sent is allowed to finish and may still produce an image. Only one image job is in flight at a time. Constant mode uses one image per attempt even when the manual batch count is higher.
- The SillyTavern bridge forwards the original upstream HTTP status and error body while keeping the provider image request non-streaming. This preserves the distinction between rate limits, exhausted quota, and unavailable upstream channels/tokens. Legacy ST-wrapped HTTP 200 errors remain recognized.
- Constant generation is off by default and is never restored from saved settings. Retrying after a timeout/network error can incur another image charge if the earlier request completed upstream; the opt-in loop retries these errors as requested. It cannot replenish exhausted quota or restore a provider's token pool.

### Studio 0.8

- Connect your Base URL and API key directly inside Studio. Model discovery displays only NAI image models available to that key, preserving each provider's exact model ID. An account without NAI image models receives a clear connection error.
- Studio uses a black, gray, and white palette, square corners, flat controls, and visible keyboard focus. The interface keeps image previews in their original colors.
- On desktop, creation controls sit beside a large Preview. On mobile, switch between **Create**, **Preview**, and **History**, with the generation action available at the bottom.
- Seed controls sit directly beside **Generate**. For NAI 5, the keyboard-accessible **Auto / Fixed** toggle either chooses a fresh seed per image or keeps a concrete seed for comparisons. **New seed** rolls a different positive six-digit seed and switches to Fixed. Switching from Auto to Fixed keeps the last generated seed, or restores the previous fixed seed if nothing has been generated yet. Screen readers receive the mode and current seed through a live status. Preview reads the actual seed from PNG generation metadata when available and offers **Reuse seed**. Otherwise it labels the requested seed as unverified. A mismatch produces a visible provider warning and a Request details entry. NAI 5 is the default model for a new installation.
- Choose an optional Anime, Manhwa, Painterly, Realistic, or Fantasy preset. Presets compose into the effective prompt once; the editable prompt and Artist Mix remain available.
- Select Undesired Content presets, change the canvas, batch images, and use **Ctrl/⌘ + Enter** to generate. Prompt drafts, the selected style, seed, and generation controls survive closing Studio.

Run the request/model/seed regression checks with `node --test tests/advanced-generation.test.cjs`. The UI has also been exercised in SillyTavern on desktop and mobile with mocked model and image responses. Live Full-model results, including provider limitations, are recorded in [tests/LIVE-VALIDATION.md](tests/LIVE-VALIDATION.md).

If a provider blocks browser CORS, Connect checks SillyTavern’s server transport using the read-only model list. Version 0.8.1 falls back to SillyTavern’s normal Custom API backend when the generic CORS proxy is disabled, so hosted users can connect and generate through `/chat/completions` without editing `config.yaml` or restarting the server. Existing saved proxy selections migrate on reconnect. The image key is supplied per request without replacing chat settings or global secrets. Native image, Inpaint and reference endpoints are unavailable through this Custom API bridge; they require direct provider CORS access or an enabled server proxy. A failed paid generation POST is never retried through a different transport.

Studio 0.8.1 opens at the model/connection card, uses native bordered textareas on desktop and iOS, and preserves open sections and scroll position when switching between Create and Preview.

For the browser checks, install Playwright and run `CHROMIUM_PATH=/usr/bin/chromium node tests/studio-ui.cjs` against an isolated SillyTavern installation with this extension enabled. `ST_URL` defaults to `http://127.0.0.1:8000`; `ARTIFACT_DIR` optionally selects the screenshot/report directory. Omit `CHROMIUM_PATH` to use Playwright's bundled Chromium. This suite changes the test profile's prompt and connection settings, intercepts all provider requests, and checks NAI filtering, keyboard seed controls, persistence, Preview/History, and square touch targets across desktop, tablet, small mobile, and landscape layouts.

The runtime and stylesheet are consolidated into one file each. The current UI and connection layer include persistent API-key storage, proxy model discovery, a Direct NovelAI provider mode, official native image routing, Vibe Transfer encoding, separate Character Prompts, Precise Reference, image editing, gallery/export, mobile Studio navigation, and the Prompt Assistant. Provider-specific route differences are handled through explicit adapter attempts and surfaced in Request Debug when unsupported.

`BROWSER=webkit node tests/studio-ui.cjs` exercises the same layout and interaction checks in Playwright WebKit. To verify the hosted connection path, run `CHROMIUM_PATH=/usr/bin/chromium node tests/hosted-connection.cjs` (or `BROWSER=webkit`) against an isolated ST server with `enableCorsProxy: false`. This starts a local provider fixture without CORS headers and tests real ST forwarding, saved-transport migration, unchanged chat settings, exact upstream JSON/authentication and no repeated generation after an upstream failure. Configure the test server's outbound proxy to bypass localhost if needed.

## Repository layout

- `index.js` — the complete extension runtime, including Reference Image Analysis.
- `style.css` — all extension styling.
- `manifest.json` — the SillyTavern extension manifest.
- `README.md` — installation and feature documentation.

Versioned bootstrap, runtime, and stylesheet copies are intentionally not kept in the working tree. Git history provides rollback without making the installed extension load through duplicate files.

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

- Advanced API probing reports **API route detected; feature unverified** until a real request succeeds. HTML pages, generic web responses, and HTTP 405 are not evidence of a usable POST API. Request Debug records each probe's URL, status, content type, and a short response excerpt.
- **Precise Reference requires V4.5**, including when using a proxy. A NAI V5 model cannot gain this feature by changing its Base URL. References are fitted with padding to `1024×1536`, `1472×1472`, or `1536×1024` before native Director Reference fields are sent. See [NovelAI's Precise Reference documentation](https://docs.novelai.net/en/image/precisereference/).
- **Inpaint requires native mask support from the provider.** V5 Full has an inpainting model, but a proxy that generates images through chat completions may not expose it. An OpenAI image wrapper must forward `action: infill`, `image`, `mask`, and the native parameters. An image response alone cannot prove that a proxy applied those fields.
- The editing source and mask are converted to PNG at the selected canvas dimensions together. Mask strokes survive reopening the editor, a new source clears its old mask, and an empty mask is rejected. Inpaint Strength is sent through `inpaintImg2ImgStrength`; random seeds become valid unsigned integers while the UI keeps its random setting.

- Chat-completion image proxies may return the generated image directly in `choices[].message.content` as a `data:image/...;base64,...` URL. Novel Generation recognizes this response and stops fallback attempts as soon as the image is found.
- In Auto route mode, a missing `/v1/images/generations` endpoint is remembered for the current page session. The extension tries `/v1/chat/completions` immediately instead of repeating the same request with every image payload schema.
- Ordinary generation now sends the complete model-specific NovelAI JSON envelope first. V4/V4.5 use `params_version: 3`; V5 uses `params_version: 4` with the V5 preset identifiers. Width, height, prompt structures, negative prompt, sampler, schedule, seed, and character data live together inside `parameters` while the compatible OpenAI fields remain at the wrapper level.
- Fixed canvas presets are authoritative at request time: **Vertical / Portrait** always sends `832×1216`, Square sends `1024×1024`, and **Horizontal / Landscape** sends `1216×832`. This also repairs stale settings where the highlighted preset and saved dimensions disagree. The Studio shows the exact canvas and orientation that will be transmitted, and Request Debug records a `resolved-canvas-size` preflight entry before the provider call.
- RVL's normal NAI Diffusion V5 and V4.5 models use the same adapter as RVL's public image generator: `/v1/chat/completions`, `Accept: application/json`, and only `model`, one user `message`, `max_tokens: 16`, colon-delimited `size`, `width`, `height`, and a positive seed. The three supported canvases are `832:1216`, `1024:1024`, and `1216:832`; an unsupported custom RVL canvas resolves to the portrait default. Negative content is appended to the user message as `Negative prompt: ...`. Multi-image requests run sequentially with one image per call and a fresh six-digit seed for each image in random mode. A selected V5 model remains V5: upstream errors are shown to the user and never retried with V4.5. A model explicitly prefixed with `[备用]` uses `/v1/images/generations` and retains the existing `832x1216` format. Other providers keep the existing configurable route fallback behavior.
- Plain text-to-image NAI requests on `new.xfxai.top` and `new.xfxaigc.com` use XFX's public client's `/v1/chat/completions` format. The composed prompt and `Parameter{size:...,negative_prompt:...,steps:...,scale:...,sampler:...,seed:...,base64:true}` are sent together in the user message. An explicit scheduler is included; **Provider default** leaves it to XFX. Batches run as sequential image requests, with actual seeds visible in Request Debug. A V5 failure is surfaced without retrying a different model.
- Wand modes such as Portrait and Selfie describe the subject/composition; canvas orientation is controlled separately under **Image Parameters**. Select **Vertical / Portrait** there when a tall image is required.
- No orientation state is learned or shared between models. The extension does not swap dimensions, crop, resize, rotate, or automatically repeat a paid generation. The provider response is kept byte-for-byte for Save Original.

## Comparing NAI 5 output with RVL

The same key and model name do not ensure the same generation request. [RVL's image page](https://rvlconnect.com/image.html) defaults to its `/17` gateway and adds its selected style, quality tags, composition tags, and negative preset to the entered prompt. It can also switch a failed V5 request to V4.5; check the resulting image's model in its history.

Compare the final request prompt, negative prompt, positive fixed seed, canvas dimensions, actual model, and API host. Use RVL's request preview and Novel Generation's Request Debug, and disable extra Artist Mix/prefix/suffix additions when reproducing a request. For unwanted spiral pupils, the **Human Focus** negative preset includes `@_@` and `mismatched pupils`; `spiral eyes` can also be added to Undesired Content. This is a prompt adjustment, not a guarantee that two providers produce matching images. See [NovelAI's Undesired Content documentation](https://docs.novelai.net/en/image/undesiredcontent/).

## AI Prompt Helper formats

- Text ideas can be generated as **Pure Tags**, **Natural Language**, or **Hybrid — Tags + Description**. The selected mode and description language are remembered.
- Pure Tags always uses concise English NovelAI/Danbooru-style tags. Natural Language writes one coherent paragraph in the selected language. Hybrid combines an English tag line with a descriptive paragraph for complex composition and interaction.
- The helper detects a selected NAI Diffusion V5 model and asks the connected SillyTavern AI to take advantage of V5 spatial relationships, character interaction, detailed environments, materials, effects, and text placement.
- Quality and local suggestion tags apply only to the tag portion of Tags/Hybrid output. Replace and Append preserve paragraphs instead of flattening Natural Language or Hybrid prompts into comma-separated tags.
