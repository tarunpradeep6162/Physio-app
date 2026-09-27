# Dheepika Lab experience system · v3

## Design intent

The product should feel like a precise movement instrument with a human bedside manner. A patient needs one unambiguous next action and room to record how the day feels. A clinician needs compact, traceable evidence. The camera needs validity and a single instruction to outrank decoration. These are three expressions of the same system, not three unrelated skins.

The signature is the open arc with three points already present in the D mark. On the patient session surface it appears as a quiet spatial trace, not an animation that might be mistaken for a measured movement. The live camera never borrows this decorative trace.

## Tokens and typography

| Role | Token | Value | Use |
|---|---|---|---|
| Deep surface | `--dl-forest` | `#0B2427` | Camera and primary session card |
| Action | `--teal` | `#087F79` | Primary actions and valid tracking |
| Canvas | `--dl-canvas` | `#F4F7F3` | Patient and clinician workspace |
| Main text | `--dl-ink` | `#102B2D` | Headings and body emphasis |
| Rule | `--dl-rule` | `#D7E2DD` | Section and table boundaries |
| Calm mint | `--dl-mint` | `#D6F1E5` | Patient session action |
| Review / safety | `--amber`, `--red` | `#A76513`, `#B43D43` | Labeled caution and invalid states |

**Instrument Sans** is the self-hosted heading and navigation face. It has a less rounded, more exact character than the former Outfit heading. **Work Sans** remains the body face for long instructions and clinical rows. **Outfit** is reserved for large numeric measurements with tabular digits. **Noto Sans Tamil** remains the Tamil fallback. Each font is served from the app, with no third-party font request.

The density changes by mode: patient cards at 20 px radius and generous line spacing; clinician rows at 14 px radius and clear rules; camera type enlarged and fixed in position. Motion is limited to short interaction feedback. Reduced-motion settings remove it.

## Contrast checks

Calculated WCAG contrast ratios for the new pairs: main text on canvas **13.84:1**, desktop navigation on canvas **6.88:1**, daily rhythm text on mint surface **8.40:1**, white on teal **4.86:1**, camera pale text on deep green **14.25:1**, and session detail text on its dark surface **10.02:1**. These are colour checks, not a substitute for screen-reader or phone testing.

## Screen decisions

- **Patient home:** the prescribed session is the focal surface. A daily check-in and the appointment/activity ledger form a two-column composition on desktop and an ordered stack on mobile. No pain value is celebrated or treated as a performance score.
- **Patient navigation:** a compact top navigation on desktop; the existing thumb-reachable bottom navigation remains on phones. The same links and accessible names are retained.
- **Clinician:** tighter table headers, tabular numerals, evidence rules, and restrained interaction colour. Source and review status remain explicit.
- **Camera:** a darker stage, stable numeric glyphs, and high-contrast cue borders. Invalidity and warnings retain their labels; decorative motion never competes with the video.
- **Report:** the existing print surface continues to use the shared typography and black-and-white-friendly rules.

## Implementation and review

`src/styles/experience.css` layers over the earlier application styles. It does not alter clinical decisions, captured data, landmark processing, route names, or storage. `DailyCompanion` has presentation classes only. Any future page should use the colour and type roles above rather than adding a new accent colour.

Check at 375, 390, 768, 1024 and 1440 px, large text, Tamil, high contrast, reduced motion, keyboard navigation, and portrait/landscape camera. Real-device TalkBack and VoiceOver checks remain necessary.
