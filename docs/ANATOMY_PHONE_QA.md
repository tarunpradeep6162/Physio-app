# 3D anatomy atlas — target-phone QA worksheet (Phase 24)

The app now measures the atlas on the device it runs on: **Anatomy → Device check (3D performance) → Download device record (JSON)**. The record holds timings, geometry size, memory (where the browser reports it) and WebGL context-loss count. It contains no patient data.

These are measurements, not targets. Pass/fail criteria are the product owner's decision. Record them here **before** the runs, and do not change them after seeing results.

## Acceptance criteria (product owner to fill before testing)

| Measure (from the device record) | Criterion | Set by / date |
|---|---|---|
| Model ready (`load.modelMs`) on the clinic's network | | |
| Frame interval while turning (`interaction.frameInterval.p95`) | | |
| Tap → highlight (`interaction.tapToHighlight.p95`) | | |
| WebGL context lost during a 5-minute session (`contextLost`) | | |
| Device feels hot / throttles after 5 minutes (tester observation) | | |

## Procedure per phone

1. Fresh browser tab, normal battery state, the clinic's usual Wi-Fi and, separately, mobile data.
2. Open Anatomy → 3D body. Note whether the 2D default appeared first (expected on phones) and the size shown on the 3D button.
3. Turn the model through all four views, tap ten regions across the body, and use **Back**, **Left side** and **Right side**.
4. For tap regions, compare the label shown against where you tapped (front/back, left/right).
5. Keep turning the model and tapping for 5 minutes. Note heat, slowdown, and any switch to the 2D map.
6. Check the 2D fallback: the selections remain, and the region list works with TalkBack/VoiceOver.
7. Download the device record and attach it below.

## Runs

| Date | Tester | Phone / OS / browser | Network | Record file | Tap labels correct (n/10) | Fallback worked | Observations | Meets criteria? |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

## Engineering notes (not phone evidence)

- 7 Oct 2026, sandbox with a CPU-only renderer (SwiftShader, no GPU). The model is 668 meshes, about 1.59 M triangles and about 31 MB of geometry buffers. It was ready in about 1.7 s, plus about 0.25 s of region tagging. Frame times were about 2 s because there was no GPU. These figures only show the model's size; they say nothing about phones.
- If phones fail the frame-time or memory criteria, the next step is a decimated (lower-polygon) model with the same mesh names. Region mapping is per vertex and does not depend on polygon count. Re-run `src/features/bodymap/anatomyRegions.test.ts` against the new files.
- WebGL context loss now falls back to the 2D map with an explanation and keeps the selections. It was tested by forcing a loss with `WEBGL_lose_context`.
