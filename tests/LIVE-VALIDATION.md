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
