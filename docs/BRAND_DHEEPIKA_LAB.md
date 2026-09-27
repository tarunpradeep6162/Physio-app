# Dheepika Lab — provisional identity, version 0.1

**Status:** candidate for Dheepika's review, 27 September 2026. The public product remains PhysioVision AI. The current URL, metadata, favicon, navigation, onboarding, settings, report templates, and offline shell must retain their existing identity until the final name is chosen and cleared. Preview: `/brand/dheepika-lab`.

## Rationale

The open D arc suggests a course of movement rather than a closed diagnosis. Three points and a jointed gesture suggest observed hip, knee and ankle; the open left side invites progression from symptom to observation to clinical understanding to recovery. The mark is drawn as SVG paths and circles with no bitmap dependency. In the camera lab, validity is a persistent labeled state; motion or decoration never substitutes for a successful capture. The experience speaks in three voices: patient guidance, focused camera instructions, and traceable clinician evidence.

## Naming comparison and decision gate

| Candidate | Strength | Risk / decision |
| --- | --- | --- |
| Dheepika Lab | Personal, concise, broad enough for future movement protocols | Personal-name consent, trademark and domain clearance needed |
| Dheepika Motion Lab | More descriptive for movement assessment | Longer wordmark; clearance needed |
| PhysioVision AI | Existing deployment continuity | Generic-sounding and already used by other physiotherapy offerings; investigate conflicts |

The official Indian Trade Marks Registry provides a public search, but its current interface requires OTP and CAPTCHA. No official record-by-record clearance was possible in this environment. Search exact, phonetic and similar marks in the relevant software, clinical service and education classes with a trademark professional before adoption. Vercel registrar search on 27 September 2026 reported `dheepikalab.com` and `dheepikamotionlab.com` available for purchase and `dheepikalab.in` unavailable. Availability can change before checkout and says nothing about trademark rights. Recheck at purchase and check relevant social handles before selecting the public name. Do not change domains, app listings, legal terms or printed reports on this preliminary screen.

## Logo files and rules

`public/brand/dheepika-lab/` contains `symbol-dark.svg`, `symbol-light.svg`, `symbol-monochrome.svg`, horizontal dark/light/monochrome wordmarks, stacked dark/light wordmarks, `favicon.svg` and `app-icon.svg`. Use dark on mineral/white and light on deep green. Keep clear space at least half the symbol width on each side; do not rotate, stretch, add a medical cross or place on a busy camera frame. The simplified symbol is provided at 16, 24, 48 and 128 CSS pixels in the live preview. At 16 px the three points remain the primary cue; at 24 px and above the joint line is visible. Inspect final rasterization on target devices before replacing the active icon. For PDF, embed the vector or render the monochrome path; avoid dependent font text in PDF drawing commands.

## Design tokens, v0.1

| Role | Token | Value |
| --- | --- | --- |
| Clinical green / camera surface | `--dl-deep` | `#0B2427` |
| Action / valid tracking | `--dl-teal` | `#087F79` |
| Patient and clinician background | `--dl-mineral` | `#F6F8F5` |
| Content and print | white | `#FFFFFF` |
| Primary text | `--dl-text` | `#142B2D` |
| Secondary text | `--dl-muted` | `#52686A` |
| Caution / review | `--dl-amber` | `#A76513` |
| Escalation / invalid | `--dl-red` | `#B43D43` |
| Divider | `--dl-line` | `#D5E1DD` |
| Surface radius | `--dl-radius` | 20 px, 8 px for controls |
| Base spacing | `--dl-space` | 8 px; sections use 64–100 px |
| Focus | visible outline | 3 px `#F2BA64`, 4 px offset on dark and light |

Symptom coding: pain red `#B43D43`, stiffness amber `#A76513`, weakness blue `#4B64A8`, numbness violet `#6D55A1`, tingling teal `#087F79`. Always show the written label and use shape/position in charts. The preview uses a self-hosted DejaVu Sans candidate face and includes its license. Tamil content must retain Noto Sans Tamil; source, self-host and test the properly licensed Tamil font before a full theme rollout. Measurements use tabular numerals and explicit units. Printed reports use white background, dark type, rule dividers, plain-language source labels and a preliminary watermark or clinician approval state; monochrome copies retain all meaning.

### Contrast checks (WCAG 2.x relative luminance, normal text AA ≥ 4.5:1)

| Pair | Ratio | Result |
| --- | ---: | --- |
| Clinical green / white | 16.21:1 | Pass AAA |
| Teal / white | 4.86:1 | Pass AA |
| Dark text / white | 14.86:1 | Pass AAA |
| Secondary / white | 5.92:1 | Pass AA |
| Amber / white | 4.65:1 | Pass AA |
| Red / white | 5.69:1 | Pass AA |
| Dark text / mineral | 13.91:1 | Pass AAA |
| Secondary / mineral | 5.54:1 | Pass AA |

The pale mint tracking text in the dark camera mockup is for the preview; production overlay colors require real camera backgrounds, scrims and device checks. Colour alone never conveys validity, symptom type or safety state.

## Interface and interaction specifications

- **Patient:** progress and plain-language steps, labeled symptom map, one decision per screen, accessible tap targets, and no diagnosis inferred from a selected region. The preview's leg silhouette is illustrative; the existing functional symptom map remains the patient flow.
- **Camera lab:** full-frame composition, single prominent instruction, persistent valid/lost state, visible measurement pause when landmarks fail, no angle shown without quality. The preview contains a static illustrated overlay, labeled as such, and never requests the camera or writes capture data.
- **Clinician:** source chips, valid repetition counts, baseline/current setup context, expandable “Why?” evidence trail, preliminary status and audit history. The preview record `DP-01` is labeled demo; it is not fetched from patient storage.
- **Synchronized replay:** playback, landmarks and angle curve share a timestamp; invalid intervals are visually interrupted and verbally labeled. Never interpolate across hidden joints as if measured.
- **Motion:** short state transitions may reinforce capture lock, with a reduced-motion equivalent. Never animate a low-confidence measurement into a valid result.
- **Report:** cover shown in the preview; the active 14-section PDF stays under the current public identity until naming approval. Future PDF renderer should use monochrome-safe logo and the same section numbering, source categories and approval state.

## Integration checklist

- [x] Candidate SVG asset set and licensed preview fonts
- [x] Isolated responsive preview route with patient, camera and clinician modes, logo scales, tokens and illustrative report cover
- [x] Explicit lost-tracking demo with no angle during invalid state
- [x] Existing app identity, camera pipeline and patient data untouched
- [ ] Measure real-device pose tracking, occlusion recovery, frame throughput and setup matching before visual rollout
- [ ] Clinician and patient usability review on small phones, tablets, high contrast, reduced motion and Tamil text
- [ ] Trademark professional search and registrar-confirmed domain check; Dheepika's final name decision
- [ ] Self-host Noto Sans Tamil and verify full bilingual typography
- [ ] Apply versioned tokens to actual patient, camera and clinician components without changing measurements or evidence provenance
- [ ] Adapt all 14 PDF sections and print stylesheet; inspect black-and-white print
- [ ] Replace browser title, metadata, navigation, onboarding, settings, PDFs, active favicon and offline shell together after name confirmation
- [ ] Regression tests for camera, assessment, replay, report and mobile accessibility before deployment
