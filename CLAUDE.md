# PhysioVision project instructions

Work in this existing repository and verify the live Vercel build after pushing. Use `docs/KNEE_PROTOCOL.md`, `docs/SAFETY.md`, and `docs/VALIDATION.md` as the current implementation and validation context. The four user-provided screenshots depict the desired body map, pain intake, live camera overlay, and findings UI; they are references, not patient data or evidence of diagnostic accuracy.

## Autonomous setup

- Discover project dependencies and available tools first. Run `npm ci` from the committed lockfile when dependencies are absent; use `npm run typecheck`, `npm test`, and `npm run build` after relevant edits.
- If a missing package is genuinely required, add it through the official npm registry, commit the lockfile, and verify the license and build. Prefer current built-in functionality before adding a dependency.
- If an MCP server or skill is genuinely required for a task, discover and use the available trusted integration or install it from its official source according to the environment's documented mechanism. Never add an arbitrary MCP endpoint or execute an unreviewed install script. Account authorization and permission grants must be handled through the environment's normal consent flow; do not claim they can be silently installed or approved.
- Do not stop at a plan when repository access and the necessary tools are available. Implement, test, inspect and report what remains unverified.

## Clinical and camera boundaries

- The camera may estimate 2D landmarks, angles, symmetry and motion quality when required landmarks and capture conditions pass the quality gate. It cannot identify the tissue or condition causing pain from imagery alone.
- Present threshold crossings as **algorithmic observations**, with the measurement, view, confidence, calculation, version and limitations. Link them to the clinician's “Why?” view. Keep patient reports, camera estimates, algorithmic observations and clinician findings separate.
- Do not invent values, disease probabilities, population norms, severity categories or diagnoses. When capture fails, withhold the number, explain why and request recapture. All proposed clinical reasoning and safety rules require clinician review.
- Retain raw video only with separate purpose-specific consent. Keep the demo unmistakably labelled as simulated. The current browser-local storage and authentication are unsuitable for real patient deployment.

## Screenshot-specific acceptance

1. The anatomical map supports region, symptom type, knee sub-location and a drawn radiation path. The current 2D map is explicitly interim; do not label it 3D until an actual accessible 3D model works.
2. Pain intensity, worst 24 hours, character, duration and aggravating activity retain the original patient answers.
3. The live scan aligns the body, checks required landmark visibility and camera setup, shows only calculated measurements, and halts on occlusion. A partially hidden body such as the phone-obstructed screenshot must not produce a full-body finding.
4. The clinician view shows measured findings with source/quality, descriptive observations and review controls. The report uses the latest valid capture for each view and reverts to preliminary when capture or review data changes.
5. Validate on real consenting volunteers and target phones before claiming accuracy or using the tool for care.
