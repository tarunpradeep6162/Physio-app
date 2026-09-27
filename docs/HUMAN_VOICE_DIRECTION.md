# Human voice direction · Dheepika Lab

The current voice coach uses the browser's speech synthesizer. Its quality depends on the person's device and it is **not a recording of a human clinician**. The caption is authoritative when audio is unavailable. Do not describe this as Dheepika's voice or as a clinician speaking.

## Performance

Use a real, consenting voice performer. Warm, grounded, unhurried; closer to a physiotherapist in the room than an announcer. Speak in short sentences with a natural breath. No synthetic doubling, motivational shouting, robotic countdown, or congratulation for pain or range of motion. Tracking-loss lines should sound steady and practical. Record English and Tamil independently with a fluent speaker; do not voice a machine translation. Dheepika's approval of clinical wording remains on hold.

Record dry mono 48 kHz WAV masters in a quiet room, with the same distance and level for every line. Edit silence and clicks without removing natural consonants. Export a compact Opus or AAC delivery asset plus the WAV master. Name files by stable cue key and locale; keep the recorded transcript beside the asset so text and audio cannot diverge. Respect autoplay and the patient's mute preference. Never send camera frames, patient answers, or identifiable text to an external voice service.

## First recording set

These lines match the existing short display cues and can be recorded without inserting patient names or measured values. Parentheses describe delivery, not spoken words.

| Cue key | Spoken line | Delivery |
|---|---|---|
| `pcue.get_ready` | Get into the start position. Hold still. | Calm setup |
| `pcue.begin` | Ready. Begin. | Clear and brief |
| `pcue.again` | Again, when you're ready. | Patient paced |
| `pcue.keep_going` | Keep going, only as far as is comfortable. | No pressure |
| `pcue.return` | Now return slowly. | Gentle instruction |
| `pcue.returning` | Nice and slow. | Quiet reinforcement |
| `pcue.slower` | A little slower next time. | Neutral |
| `pcue.range` | Move as far as is comfortable, then come back. | No range target promise |
| `pcue.not_counted_tracking` | Tracking stopped for a moment. Let's try that one again. | Explain, no blame |
| `cue.pause.no_person` | Step back into view. | Direct |
| `cue.pause.multiple_people` | Let's have just one person in view. | Direct |
| `cue.pause.out_of_frame` | Keep your whole limb in the picture. | Direct |
| `cue.pause.occluded` | I can't see the joint clearly. Please adjust your position. | Direct |
| `cue.pause.reacquiring` | Hold still while the camera finds you again. | Reassuring |
| `cue.return_slowly` | Return slowly. | Gentle |
| `cue.exercise_complete` | That's the exercise finished. | Matter of fact |

Dynamic countdowns, numbers, named joints and personalized instructions need separate variants or remain captions with device speech until a complete, locale-matched pack exists. A recorded line must never be played for a different caption. If an asset is absent or audio fails, keep the caption and the current device-voice fallback. Recording consent, performer credit, usage rights, pronunciation review, clinical copy review, and phone playback QA are release gates for this voice pack.
