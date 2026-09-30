# Advanced computer-vision options

This file covers what the app uses today, what more advanced AI could add, and what no camera AI can do.

## In the app now
| Capability | Model / method | Notes |
|---|---|---|
| 33 body landmarks, on device | MediaPipe **BlazePose GHUM** — **Lite**, **Full**, and **Heavy** (added 30 Sep 2026; Settings → Motion engine) | Heavy is the most accurate but slowest. Its ~31 MB model loads from Google's model CDN on first use, so it suits laptops or desktops. Runs in a web worker. |
| Occlusion evidence | BlazePose segmentation mask, landmark visibility, and a "hands in front of the body" check | Drives the quality gate: hidden landmarks mean the value is withheld. |
| Posture grid / HUD | 2D image-plane angles and % of ankle-to-nose height | The display offers zoom, zoom to the patient-reported area, live region panels, monochrome view and a face cover. |
| Evidence | NCBI PubMed E-utilities | Records are shown verbatim and never generated. |

## More advanced options (each needs validation before clinical use)
| Option | What it adds | Cost and constraints |
|---|---|---|
| **BlazePose world landmarks** (already produced by MediaPipe) | Model-estimated 3D joint positions around the hips; less sensitive to camera angle | The scale assumes an average body, so the values are **not measurements**. Use only for angles, after validation. |
| **RTMPose / RTMW** (OpenMMLab, Apache-2.0) via ONNX Runtime Web | 133 whole-body keypoints, including detailed feet and hands; often more precise feet and knees | The model is 20–100 MB. The browser GPU path is still maturing, so phone speed must be benchmarked first. |
| **Two calibrated cameras** (OpenCap-style; Stanford, Apache-2.0) | True 3D joint angles and **real units** after a checkerboard calibration; OpenSim musculoskeletal model | Needs two phones, a calibration step and server processing. This is the best route to validated 3D kinematics. |
| **Depth sensors**: iPhone LiDAR / ARKit body tracking, Orbbec, Azure Kinect | Metric 3D skeleton, so real distances become possible | Needs a native iOS app or dedicated hardware, not a web page. |
| **Reference-object calibration** (e.g. an A4 sheet at body depth) | Approximate centimetres in the frontal plane at that depth only | The error must be stated with each value. It is only valid when the object is in the same plane as the body part. |
| **Wearable IMUs** (phone strap or sensors) | Joint range of motion independent of camera view and lighting | Needs extra hardware and pairing. |
| **Body-mesh fitting** (SMPL-family, e.g. HMR 2.0 / 4DHumans) | A 3D body-surface model for visualisation | **SMPL's licence is non-commercial**; clinical use needs a commercial licence. It shows the body surface, not the skeleton. |

## Not possible with any camera AI
- **Seeing bones or joints inside the body:** vertebral levels (e.g. "C3–C4"), ribs, facets or cartilage. That needs X-ray, CT, MRI or ultrasound, ordered and read by qualified clinicians.
- **Naming the injured tissue or diagnosing from video.**
- **Centimetres from one uncalibrated webcam.** Distance and body size cannot be separated from a single 2D image.

Every option above still goes through the same rules: the quality gate, algorithmic observations with provenance, and clinician review.
