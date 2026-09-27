# Hip, ankle and foot, spine and neck, balance and gait (Phases 12–15)

Algorithm `dl-regions-1.0.0`; every protocol is at v1.0.0. The history and safety questionnaires are also v1.0.0. **Everything here is a draft for Dheepika's clinical review, and that approval is on hold.** Every value comes from 2D pose landmarks via the same pipeline, quality gates, zero-phase smoothing and plausibility guard as the knee and shoulder tests. No population norms, severity grades, fall-risk scores or threshold observations are produced. None of these pathways has draft consideration rules, so the clinician records the impression.

| Pathway | Test (protocol id) | View | What is measured | What is explicitly NOT measured |
|---|---|---|---|---|
| Hip | `hip_flexion_standing` | Side, per side | 180° − ∠(shoulder, hip, knee), peak; trunk angle at peak as a compensation check | Pelvic tilt separated out; rotation, extension, passive range, strength |
| Hip | `hip_abduction_standing` | Front, per side | Hip→ankle angle from vertical, peak; trunk side-lean toward the standing leg | Pelvic hitch separated out; rotation, abductor strength |
| Ankle and foot | `ankle_knee_to_wall` | Side, per side | Shin angle from vertical in a lunge, heel down; repetitions where the heel rose more than 5° are excluded; heel rise reported as a quality check | Toe-to-wall distance, subtalar and midfoot motion, stability, calf strength |
| Ankle and foot | `heel_raise_double` | Side | Count of repetitions (foot rotation of at least 12° from the start), median peak change | Strength, endurance, fatigue; far foot; centimetres |
| Back and neck | `trunk_forward_bend` | Side | Hip→shoulder inclination, peak; knee angle as a compensation check | Lumbar range, curvature, segmental motion, posture, structure |
| Back and neck | `trunk_side_bend` | Front, per side | Mid-hip→mid-shoulder angle toward the side, peak | Segmental range, rotation |
| Back and neck | `neck_flexion_extension` | Side | Change in the shoulder→ear angle from the start position, forward and backward | Cervical range (CROM), rotation, side-bend, posture |
| Balance and gait | `single_leg_stance` | Front, per standing leg | Time the lifted foot stays up (capped at 30 s); pelvis side-to-side range (% of hip width) | Fall risk, vestibular function, proprioception, support use unless the foot comes down |
| Balance and gait | `march_in_place` | Front | Steps, cadence, median left/right foot lift, alternation. Withheld unless there are at least 10 steps with steps on both feet | Walking gait, speed, stride, turning, fall risk |

## Gates from the brief and how they are enforced
- **Hip — "every metric has setup and validation evidence; internal rotation and strength are not invented":**
  - every protocol has setup steps, a framing rule, an illustrated guide and limitations;
  - a test fails if any region metric id or label mentions rotation, strength, force, fall risk, normal, severity or lumbar range;
  - validation evidence so far is **synthetic only** (below). Real-device evidence is pending.
- **Ankle and foot — "shoe/foot occlusion, wrong view and partial framing invalidate dependent metrics":** heel and toes are required landmarks. Tests confirm all three:
  - low heel/toe visibility makes the capture invalid;
  - a mirrored (wrong-side) view gives no value;
  - toes out of frame make the capture invalid.

  Heel-up lunge repetitions are excluded, with a reason.
- **Spine and neck — "claims match what RGB pose landmarks can resolve":**
  - labels and limitations say *trunk inclination* (not lumbar range) and *head-on-trunk change from the start* (not cervical range);
  - posture is never interpreted: a test shows a different starting head position does not change the neck result;
  - a hidden ear withholds the value;
  - neurological examination fields stay with the clinician (Examination findings on the AI draft tab).
- **Balance and gait — "unsafe or incomplete tests stop; timing and symmetry checked against reference captures":**
  - lost tracking or a hidden ankle mid-stance invalidates the trial;
  - too few steps, or steps on only one foot, withhold cadence and left/right values;
  - the safety screen sends repeated falls and needing help to stand to the clinician before any camera test (verified in the browser);
  - stance time matches simulated reference captures within one frame (2.5, 7 and 15 s; 30 s cap), and cadence within 2 steps/min (70, 100 and 120).

  **Real reference captures (stopwatch, instrumented walkway) on real phones are still required before release.**

## Evidence status
Only synthetic ground truth so far (`src/engine/protocols/regions.test.ts`, run through the real pipeline and recorder):
- hip flexion 95° and abduction 30°;
- lunge 40°;
- heel raise 7 repetitions and 25°;
- trunk 60° forward and 20° sideways;
- neck +35/−25° within 3°;
- the timing references above.

No human, real-phone or reference-instrument data exists yet. See `docs/tracking/PHONE_RUN.md` and Phase 20.

## Safety questionnaires (drafts)
- `hip-safety@1.0.0`: fracture after a fall, replacement dislocation, infection, cauda equina, DVT and more.
- `ankle-safety@1.0.0`: acute ischaemia, deformity, Ottawa-inspired weight bearing, Achilles rupture, diabetic foot and more.
- `spine-safety@1.0.0`: cauda equina, vascular/brainstem signs, trauma, infection, myelopathy, cancer history, fragility fracture.
- `balance-safety@1.0.0`: stroke signs, cardiac symptoms, syncope, acute vertigo, head injury; needing help to stand and repeated falls send the patient to clinician review.
