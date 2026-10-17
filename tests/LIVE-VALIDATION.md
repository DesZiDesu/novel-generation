# Live Full-model validation — 2026-10-15

Tested the installed extension in SillyTavern 1.19.0 with Chromium against `https://shop.rvlconnect.com/v1`. The supplied key exposed 1,191 models, of which 27 were NAI image models. All ten NAI 5/4.5 Full variants were attempted; no Curated model was called.

A single portrait prompt was used with Auto seed, one image per request, 832 × 1216, 28 steps, guidance 5 and Euler Ancestral. The negative prompt did **not** contain spiral-eye exclusions. Diagnostic reruns generated 35 images in total; 15 representative images were inspected for the final comparison.

```text
1girl, adult woman, solo, portrait, looking at viewer, brown eyes, brown hair, simple white shirt, neutral expression, plain light gray background, anime illustration, detailed face

Negative: lowres, blurry, worst quality, bad quality, text, watermark, bad anatomy
```

| Model ID | Final generation/control result |
| --- | --- |
| `[DM]-[AG]-[OAI]-nai-diffusion-5-full-[0.2]` | Seed ignored: PNG reports 0; both V5 images have identical pixels. |
| `[DM]-[AG]-[OAI]-nai-diffusion-4-5-full-[0.1]` | Seed ignored: PNG reports 0; these V4.5 pixels differ. |
| `[X]-[AG]-nai-diffusion-5-full-[0.21]` | Verified: seed, steps, negative prompt and portrait dimensions match. |
| `[DM]-[AG]-nai-diffusion-5-full-[0.46]` | Unavailable: upstream do_request_failed after native input was accepted. |
| `[MI]-[AG]-nai-diffusion-5-full-[0.2]` | Earlier images shown; final retest returned upstream Invalid token. |
| `[DM]-[AG]-nai-diffusion-4-5-full-[0.1]` | Unavailable: upstream do_request_failed after native input was accepted. |
| `[MI]-[AG]-nai-diffusion-4-5-full-[0.1]` | One earlier image shown; final retest returned upstream Invalid token. |
| `[X]-[AG]-[Bak]-nai-diffusion-4-5-full-[0.21]` | Images API generates different images, but ignores seed and negative prompt. |
| `[X]-[AG]-[Img1]-nai-diffusion-4-5-full-[0.21]` | Verified: seed, steps, negative prompt and portrait dimensions match. |
| `[X]-[AG]-nai-diffusion-4-5-full-[0.21]` | Compact chat generates different images, but ignores seed and portrait dimensions. |

The two `[X]` NAI 5 and `[X] [Img1]` V4.5 samples used different seeds and produced different RGB pixel hashes. Their PNG metadata matched the requested seed, steps, negative prompt and dimensions. Other routes that generated different images still failed seed verification. Comparing complete PNG files alone would have missed the OpenAI V5 duplicate: its PNG timestamps differed while decoded RGB pixels were identical.

No spiral eyes were observed in the 15 inspected samples. This does not establish behavior for other prompts or every future image. The PNG Source fields reported the requested NAI generation version; that is provider metadata rather than independent proof of the remote model weights.

The first browser connection failed because the provider’s OPTIONS response omitted CORS headers. Connecting through SillyTavern’s enabled CORS proxy worked. The extension now chooses that transport during the model GET, preserves provider tags in model labels, uses channel-specific request formats, and displays PNG seed mismatches instead of presenting a requested seed as a confirmed image seed.

The OpenAI routes continued to ignore advanced controls in the tested top-level/nested request shapes. These limitations were left visible; no model fallback was used to disguise a failed test. The native DM channels passed initial request validation after adding the required chat fields, but image generation still returned an upstream request failure. MI token errors were upstream-specific: the supplied key continued to authenticate successfully against the model list.

Provider availability and field handling may change after this test. Raw credentials and generated image binaries are not committed.

## 0.8.1 hosted-server follow-up

Retested with SillyTavern 1.19.0 and **`enableCorsProxy: false`**. The normal Chat Completions backend loaded 27 NAI models from the same RVL shop endpoint without changing server configuration, chat connection settings or global API secrets. One additional benign portrait was generated through each previously verified Full channel:

| Model | PNG seed | Steps | Dimensions | Result |
| --- | --- | --- | --- | --- |
| `[X]-[AG]-nai-diffusion-5-full-[0.21]` | 555080 | 28 | 832 × 1216 | Seed and negative prompt matched. |
| `[X]-[AG]-[Img1]-nai-diffusion-4-5-full-[0.21]` | 308824 | 28 | 832 × 1216 | Seed and negative prompt matched. |

Both requests used Auto seed. Neither new sample showed spiral eyes. These two images validate the new transport; the earlier multi-image comparison remains the evidence for seed variation. No Curated model was called.

The 34 request regression checks pass. Chromium and Playwright WebKit pass the Studio interaction/layout suite at desktop, tablet, 320px/390px mobile and touch landscape sizes, including opening at scroll position zero, opaque bordered native textareas, Auto/Fixed keyboard interaction and preserving open sections/scroll on Create–Preview switches. WebKit uses emulated mobile viewports, not a physical iPhone.

A separate local upstream fixture deliberately omits CORS headers. Both browser engines pass against the actual SillyTavern status/generate backend with the generic CORS proxy disabled: discovery, migration of a saved proxy preference, exact forwarded provider JSON, per-request image authentication, no leaked CSRF header and unchanged chat settings. An upstream HTTP 500 produces one failed generation attempt with no retry. Native capability probes do not send chat generation requests. This bridge handles models and chat requests only; native image, Inpaint and reference routes remain unavailable through it.

## 2026-10-16 — NAI 5 rate-limit follow-up, 0.8.2

The same RVL shop key continued to load 27 NAI image models. The X NAI 5 Full channel now returned an upstream HTTP 429. A direct request using the exact extension payload confirmed the message: no upstream tokens are available; they may be disabled, expired or cooling down. There was no `Retry-After` header. The first failing Studio attempt sent exactly one generation request; SillyTavern replaced the upstream error with HTTP 200 and `Too Many Requests`, which 0.8.1 had normalized to 502.

NAI 5 **Full** channels were selected explicitly in Studio, without Curated calls or automatic model substitution:

| Channel | Result |
| --- | --- |
| `[X]-[AG]-nai-diffusion-5-full-[0.21]` | HTTP 429, no available upstream token. Repeated diagnostic attempts were spaced beyond the default 60-second wait. |
| `[DM]-[AG]-nai-diffusion-5-full-[0.46]` | Provider returned Internal Server Error. |
| `[MI]-[AG]-nai-diffusion-5-full-[0.2]` | Provider returned Unauthorized. |
| `[DM]-[AG]-[OAI]-nai-diffusion-5-full-[0.2]` | Generated one image. PNG reports seed 0, 23 steps and 1216 × 832, ignoring the requested seed, 28 steps and 832 × 1216. The existing provider warning remained visible. |

The successful OpenAI-channel sample had no observed spiral eyes, but does not resolve X channel availability or seed fidelity. The extension now recognizes ST-wrapped rate limits as 429, applies a visible cooldown, prevents overlapping image jobs, and allows a manual retry after the wait without silently resubmitting.

Public endpoint research found the [RVL shop guide](https://rvlconnect.com/blog/manual-guide-shop-api) explicitly pairs shop keys with `https://shop.rvlconnect.com/v1`. [XFX's public status configuration](https://new.xfxai.top/api/status) advertises `https://new.xfxai.top` and backup `https://new.xfxaigc.com`, with documentation at `https://doc.xfxaigc.com/`. The extension's documented OpenAI-compatible path adds `/v1`. These are separate provider accounts; the shop credential was not sent to XFX or any newly discovered host. No undocumented private upstream URL was established.

## 2026-10-16 — OpenAI NAI 5 canvas correction, 0.8.3

The earlier portrait failure on `[DM]-[AG]-[OAI]-nai-diffusion-5-full-[0.2]` was caused by missing top-level canvas fields in the extension's chat adapter. The 0.8.2 request carried 832 × 1216 inside `image_config` and `image_generation`; the response was 1216 × 832. Adding top-level `size`, `width`, `height` and `aspect_ratio` to the same request returned an actual 832 × 1216 PNG.

The correction was then tested in the installed extension through SillyTavern's normal Custom API backend with the generic CORS proxy disabled:

| Studio selection | Top-level size | Decoded PNG size | Result |
| --- | --- | --- | --- |
| Portrait | 832 × 1216 | 832 × 1216 | Matched |
| Square | 1024 × 1024 | 1024 × 1024 | Matched |

Both calls used the same DM/OpenAI NAI 5 Full model and a benign portrait prompt. PC and mobile Studio previews were captured. A separate direct request also placed seed, steps and other controls at the top level; its PNG still reported seed 0 and 23 steps. Seed/step fidelity remains a provider limitation in the tested request shapes, and the existing seed mismatch warning stays visible. The earlier broad claim that the OpenAI channel could not honor portrait dimensions is superseded by this correction.

The 41 request regressions include Portrait/Square/Landscape matrices for NAI 5 and 4.5 OpenAI chat wrappers, checking matching top-level and nested dimensions and repair of stale preset dimensions. The hosted backend test also asserts that the real SillyTavern server forwards the top-level portrait size and aspect ratio intact.

## 2026-10-17 — Immediate retry and Constant generation, 0.8.4

The user requested removal of the extension cooldown and an explicit retry-until-success mode. Manual Generate now becomes available immediately after a job finishes, including a 429 carrying a 60-second retry hint. Constant generation attempts one image at a time, retries all errors after two seconds, and stops on the first image, Stop, Studio closure, page exit, or a changed model/connection. Stop prevents future attempts while allowing an already-sent request to finish.

Validation:

- All 44 Node behavior tests pass, covering immediate manual retry, all-error constant retry, sequential attempts, transient 404 route recovery, stop while waiting/in-flight, and connection changes.
- The hosted integration test uses a real SillyTavern 1.19.0 server with generic CORS proxy disabled. Chromium and WebKit each exercised 17 local upstream generation requests across PC and mobile views. The test covers 429, authentication errors, exhausted quota, HTTP 500, HTTP 200 without images, eventual success, manual override, Stop, and closing Studio. It also checks that both buttons fit in the viewport and preserves the exact provider payload.
- The WebKit HTTP-cache test upgraded cached 0.8.0 assets to 0.8.4 while preserving cookies, local storage, saved settings, and legacy cached assets. No cache-clearing response was used.
- A bounded live Constant generation check used the existing RVL Shop connection and `[X]-[AG]-nai-diffusion-5-full-[0.21]`. Model discovery returned 27 NAI models. Three generation attempts produced no image; the final error retained HTTP 429 and the original upstream message that no usable token was available (disabled, expired, or cooling down). The test was stopped after three attempts; the production mode itself has no attempt cap. This confirms retry/error transport behavior, not restoration of the provider's token pool.

The ST bridge uses raw response forwarding, while custom include/exclude fields keep the actual provider image request non-streaming. Manual attempts remain single-attempt operations; automatic retries happen only when Constant generation is explicitly enabled.

## 2026-10-17 — Constant generation without the two-second wait, 0.8.5

The user chose immediate sequential retries. After a failed attempt completes, Constant generation now queues the next attempt with a zero-delay browser timer instead of waiting two seconds. It yields to the browser between attempts so Stop can run, and still waits for the current request to settle before sending another. Actual throughput depends on provider response time and browser scheduling. It stops at the first image or the existing Stop/close/connection-change conditions.

Validation:

- All 45 Node behavior tests pass. The retry tests advance the fake clock by zero milliseconds and check all error categories, one request at a time, stopping before a queued retry, stopping during an unresolved request, and no further attempts after success. A new deferred-response case confirms that a pending request cannot cause overlapping retries even after 60 seconds.
- Chromium and WebKit pass the hosted integration suite against real SillyTavern 1.19.0 and a local provider fixture, with the generic CORS proxy disabled. Each engine exercises 17 generation requests, including five consecutive errors followed by success with only a one-millisecond browser-clock advance per retry. The fixture records a peak of one concurrent generation. Stop, manual override, Studio closure, PC/mobile button layout, and exact provider payload preservation pass with no browser errors.
- The WebKit HTTP-cache test upgrades cached 0.8.0 assets to 0.8.5 while preserving cookies, local storage, saved settings and old cached assets. No cache clearing is required.

This release changes retry timing. No paid RVL Shop image requests were made for this follow-up, and these fixture results do not establish current upstream availability or bypass provider limits.
