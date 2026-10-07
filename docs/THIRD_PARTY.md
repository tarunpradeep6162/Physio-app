# Third-party components (Phase 44)

`scripts/licence-check.mjs` checks npm packages against `licence-policy.json` on every CI run, and CI publishes a CycloneDX SBOM (`npm sbom`) as a build artifact. This page covers what the lockfile cannot: assets that are not npm packages.

| Asset | Where | Source | Licence | Obligations |
|---|---|---|---|---|
| Muscle and skeleton models (`anatomy*.glb`, `skeleton*.glb`) | `public/anatomy/`, `model-source/` | Body Explorer (pinned commit), from BodyParts3D and Z-Anatomy | CC BY-SA 2.1 JP (BodyParts3D), CC BY-SA 4.0 (Z-Anatomy) | Attribution, share-alike, and indication of changes. See `public/anatomy/SOURCE_ATTRIBUTION.md` and `docs/ANATOMY_MODEL.md`. The light copies are also adaptations. |
| Pose landmarker models (`pose_landmarker_*.task`) | `public/pose/models/`, downloaded at install | Google MediaPipe model storage | Apache-2.0, according to MediaPipe's model card; confirm the card for the exact version before commercial release | Keep the notice; the model card's intended-use limits apply |
| MediaPipe WASM runtime | `public/pose/wasm/`, copied from `@mediapipe/tasks-vision` | npm | Apache-2.0 | Covered by the npm check |
| Noto Sans Tamil font | `@fontsource/noto-sans-tamil` | npm | OFL-1.1 | Covered by the npm check; the font may not be sold on its own |
| Brand marks | `public/brand/` | Dheepika Lab | Owner's own | — |

## Review rules

- A new npm licence fails CI until someone reviews it. Then either add the licence to `allowed` or add a package exception with a reason in `licence-policy.json`.
- A new non-npm asset gets a row here before it ships.
- Do not copy third-party text, code or images (for example from competitor sites) into the app.
- `npm audit --audit-level=high` runs in CI. A high or critical advisory fails the build until it is fixed or a reviewed exception is recorded here.
