# Shoulder pathway: protocols, scope and data (Phase 1)

> **Clinical status:** every item below is a **DRAFT**. Dheepika's approval is **on hold** by instruction, and nothing here has been approved or validated. The camera estimates 2D arm elevation only. It does **not** diagnose, infer the structure causing pain, or estimate strength.

The source of truth is the code:
- `src/engine/protocols/shoulder.ts` — protocols;
- `src/clinical/intake.ts` — `SHOULDER_HISTORY_QUESTIONNAIRE`;
- `src/clinical/safety.ts` — `SHOULDER_SAFETY_QUESTIONNAIRE`;
- `src/clinical/pathways.ts` — pathway registry.

## Clinical ownership

| Artefact | Id@version | Owner | Status |
|---|---|---|---|
| History questionnaire | `shoulder-history@1.0.0` | Clinical lead | Draft |
| Safety (red-flag) questionnaire | `shoulder-safety@1.0.0` | Clinical lead | Draft |
| Test protocols | `shoulder_flexion_active@1.0.0`, `shoulder_abduction_active@1.0.0` (algorithm `dl-shoulder-1.0.0`) | Clinical lead (protocol), engineering (algorithm) | Draft |
| Consideration rules | **none** | — | By design: no automated inference for this region |
| Observation thresholds | **none** | — | No norms or thresholds exist to justify them |
| Report template | `dl-shoulder-report-1.0.0` | Clinical lead | Draft |

## Journey

**Patient**
1. On the home screen, choose *Start shoulder assessment*, or choose Shoulder at the end of onboarding.
2. Symptom map, including the list alternative. Shoulder location chips: front, top, outer upper arm, back / shoulder blade, whole.
3. Adaptive history.
4. Shoulder safety screen.
5. Test plan.
6. Guided captures.
7. Results.
8. Submit.

**Clinician** — the same six workspace tabs as the knee pathway:
- History & safety;
- editable Test plan (shoulder protocols only);
- Captures & replay with "Why?";
- Left / right;
- Evidence & reasoning, with no considerations, the scope limits, and an impression;
- Report, with draft/approve, which goes stale when new data arrives.

**Reassessment:** *Start matched reassessment* copies the baseline plan. The reassessment asks again about pain, night, aggravating factors, instability, arm symptoms and the four function items.

## History (draft)

- **Shared with knee** (same ids and wording): onset, duration, pain now / worst / least, pattern, time of day, morning stiffness, easing, previous injury, conditions, prior care, occupation, activity, goal.
- **Shoulder-specific:**
  - mechanism, shown only after a sudden onset (fall on hand or shoulder, lifting, overhead/throwing, came out of joint);
  - surgery type;
  - dominant arm;
  - night pain lying on the side;
  - aggravating reaches (overhead, behind back, lifting, lying on the side, dressing, pushing/pulling, throwing, desk);
  - felt instability;
  - arm symptoms (below the elbow, pins and needles, numbness);
  - neck movement provoking symptoms;
  - function 0–4: high shelf, behind back, carrying, dressing.

## Safety screen (draft)

| Item | Action |
|---|---|
| Pain with chest or jaw pain, breathlessness, sweating or faintness | Emergency |
| Hot, red, swollen shoulder with fever | Emergency |
| Deformed / out of place after injury | Emergency |
| Unable to lift the arm at all after a recent fall or injury | Urgent |
| Whole arm or hand swollen, discoloured or heavy | Urgent |
| Rapidly worsening arm weakness or numbness | Urgent |
| Neck pain with new clumsiness of both hands or balance problems | Urgent |
| Post-surgical wound red, leaking or opening | Urgent |
| Severe constant night pain no position eases | Clinician review |
| Cancer history or unexplained weight loss | Clinician review |

The most severe triggered action wins. Anything but *clear* pauses camera tests and exercise and alerts the clinician.

A fix in this phase: `levelFromResponses` now re-evaluates stored responses against the questionnaire they were answered on. Before, a stored shoulder red flag would have been re-evaluated against the knee screen and read as *clear*. A regression test covers this.

## Camera tests

Both tests share these rules:
- one side at a time; standing;
- 3 repetitions, 60 s maximum;
- cycle: rest < 30°, engaged ≥ 60°, minimum 1.2 s;
- a gap of more than 250 ms inside a repetition means the repetition does not count;
- at least 8 valid frames per repetition;
- quality gate: coverage ≥ 75%, mean confidence ≥ 0.7, ≥ 2 valid repetitions;
- stored signal: zero-phase smoothed, with the plausibility guard (as knee 1.1.0).

The framing is also shared:
- the shoulder-to-hip extent should fill 16–36% of the frame height;
- the phone is in portrait;
- roll must stay within 4° for flexion and 3° for abduction;
- the guide asks for room above the head for the raised arm.

### Active shoulder flexion (side view)

| | |
|---|---|
| View | Same-side lateral (the tested arm nearest the camera). |
| Required landmarks | Hip, shoulder and elbow on the tested side. |
| Signal | ∠(hip, shoulder, elbow): the upper arm relative to the trunk line. |
| Metrics | `shoulder_flexion_peak`: the maximum over valid repetitions. `shoulder_flexion_trunk_lean`: the median hip→shoulder angle from vertical within ±250 ms of each peak (compensation check, descriptive). |
| Refuses | Wrong side toward the camera, front view, elbow hidden or out of frame, nobody or several people, orientation uncertain, re-acquisition, implausible jump. |

### Active shoulder abduction (front view)

| | |
|---|---|
| View | Anterior. |
| Required landmarks | Hip, shoulder and elbow on the tested side. |
| Signal | The shoulder→elbow angle from image vertical. |
| Metrics | `shoulder_abduction_peak`: the maximum over valid repetitions. `shoulder_abduction_trunk_lean`: the signed mid-hip→mid-shoulder angle at the peak. **Positive** means leaning away from the moving arm, which inflates the apparent abduction. |
| Refuses | Side view, elbow hidden or out of frame, and the rest of the list above. |

## What one RGB camera cannot measure (shown to clinicians and in the report)

- Internal/external rotation, hand-behind-back and horizontal movements.
- Scapular movement, as distinct from arm movement. Shoulder shrugging is not separated.
- Passive range, end-feel, painful arc, apprehension or instability, and strength.
- The tissue or condition causing pain. Neck-referred symptoms are captured by history, not by the camera.

Two further limits:
- **Abduction** uses image vertical, so a tilted phone or a trunk side-lean changes it. The side-lean is recorded separately, and a forward drift under-reads.
- **Flexion** above 180° is not representable, and an arm drifting sideways changes the value.

## Evidence

Measured on synthetic landmarks through the real pipeline, not real people:
- **Engine tests** (`src/engine/protocols/shoulder.test.ts`, 7 tests):
  - the peak is recovered on both sides;
  - trunk compensation is reported, with the correct sign;
  - an occluded elbow gives no metric;
  - the wrong side or the wrong view gives no metric;
  - nobody in view or a cropped arm gives no metric.
- **Pathway tests** (`src/clinical/shoulder.test.ts`, 8 tests):
  - registry consistency;
  - draft labelling;
  - adaptive questions;
  - safety routing, and the stored-level regression;
  - demo DP-04 through evidence and report: invalid capture excluded, no algorithmic observations, no considerations, shoulder template, approval going stale after a new capture;
  - the PDF renders.
- **Browser journeys** (Playwright on the production build, simulated camera, 390 px phone and desktop): patient sign-up → Shoulder → map (list control) → history → safety → two captures, both passed → results → submit. Clinician DP-04, all six tabs. No page errors. Screenshots were taken but are not committed.

**Not done:**
- **Real-device captures** (Phase 2).
- **Agreement** with goniometry or inclinometry (Phase 20).
- **Clinical review** of every draft above (on hold).
