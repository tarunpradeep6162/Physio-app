# Dheepika Lab — identity v2

**Product name:** Dheepika Lab

**Descriptor:** Clinical movement intelligence

**Line:** See movement. Guide recovery.

**Public URL:** the existing `physiovision-ai-eta.vercel.app` remains in place.

**Status:** app identity implemented for this pilot. Trademark clearance and domain purchase remain open before commercial launch.

## Why this name

Dheepika's name gives the product a human point of view; Lab conveys careful observation and clinician review. The app does not claim to diagnose tissue injury from a video. Alternative `Dheepika Motion` is descriptive but narrower; `PhysioVision AI` is broader but less distinctive. A Vercel registrar lookup on 27 September 2026 reported `dheepikalab.com` available and `dheepikalab.in` unavailable. Availability can change. The Indian Trade Marks Registry public search requires OTP/CAPTCHA, so this is not a trademark clearance. Review exact and similar marks in the relevant classes with counsel before buying a domain or publishing to app stores.

## Mark

The 64-unit D outline frames a rising three-point path. The points suggest hip, knee and ankle landmarks; the rise suggests regained movement. It is not a diagnostic symbol. Original SVG source is in `public/brand/mark.svg`; `public/icon.svg` is the active favicon and PWA icon. Horizontal and stacked wordmarks live beside it; `mark-mono.svg` is the print-safe option. Do not use the SVG wordmarks for PDF text, because external fonts can be substituted by PDF viewers. The PDF draws the symbol as vectors and uses built-in readable text. Check the symbol at 16/24/48/128 px and reserve at least 8 px clear space at icon size. Do not rotate or add a glow to clinical data displays.

## Versioned tokens

| Token | Value | Role |
| --- | --- | --- |
| `--graphite` | `#0B2427` | Camera workspace, header, clinical ink surface |
| `--teal` | `#087F79` | Actions and valid tracking |
| `--teal-strong` | `#075D59` | Links and small accent text |
| `--surface` | `#F6F8F5` | Patient and clinician background |
| `--panel` | `#FFFFFF` | Cards and printed report |
| `--ink` | `#142B2D` | Primary text |
| `--ink-3` | `#52686A` | Secondary text |
| `--amber-ink` | `#8A510E` | Review required |
| `--red-ink` | `#A62F39` | Escalation and invalid |

Outfit is used for headings and the name; Work Sans for interface copy and tabular measurements. Noto Sans Tamil is self-hosted for Tamil glyphs. All three are installed from `@fontsource` packages and served from the same origin. Their package licenses are OFL. Body text and camera validity take precedence over decorative motion. The welcome illustration remains explicitly synthetic. Focus rings, high-contrast mode and reduced-motion preferences remain active.

## Experience modes

The design uses the existing React components and clinical data, with mode-specific presentation:

- **Patient:** a dated greeting, one prominent clinician-approved session card, then progress and assessment context. Buttons remain at least 48 px high where primary.
- **Camera lab:** dark workspace, scrim-backed controls, large single cue, persistent labeled landmark validity and clearly paused measurements. Decoration never overlays an inferred clinical result.
- **Clinician:** light documentation surface, restrained green rail, tabular numbers, source-colored evidence with text labels, and compact rows for audit review.

At desktop widths the welcome illustration and clinical explanation sit side by side; below 900 px they stack. At 600 px the patient action fills the width and camera controls can wrap. Focus, high-contrast and reduced-motion preferences apply in all modes. The motion intensity is restrained (3/10); subtle hover feedback cannot imply tracking validity.

## Applied surfaces

The name appears in browser title and description, PWA manifest, English/Tamil intro copy, navigation, onboarding, PDF metadata and header, and fresh demo clinic records. The offline app shell changes cache version so older branding is replaced on update. Internal storage keys, diagnostic export schema kinds, engine version IDs, and existing patient records retain their historical identifiers to keep migrations and audit provenance intact. Existing browser-local clinic names are user data and are not rewritten.

## Review before commercial launch

- Trademark clearance, domain registration, clinician approval of identity and patient-facing wording.
- Photograph and device checks at 375, 768 and desktop widths, including camera overlays under difficult light.
- PDF print inspection in colour and black and white; Tamil report font embedding if Tamil report copy is added.
- Real consenting volunteer tracking validation and clinical review described in `docs/RELEASE_GATE_REPORT.md`.
