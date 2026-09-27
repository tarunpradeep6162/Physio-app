# Anatomical 3D model provenance

The interactive symptom map uses the `anatomy.glb` and `skeleton.glb` mesh data from [Johan Bellander's Body Explorer](https://github.com/JohanBellander/BodyExplorer), pinned to commit `7d04bf3c4de2bd9cb234dd51d7e6857c099afafd`. It is an anatomical reference atlas, not imagery or a reconstruction of an individual patient.

The source project credits **BodyParts3D, © The Database Center for Life Science** and **Z-Anatomy by Gauthier Kervyn**. The source distribution identifies the included model assets as CC BY-SA material. Attribution and the share-alike terms apply to those model assets; app source code remains separately licensed. Preserve this notice and the on-screen credit if the assets are redistributed or hosted elsewhere. Check the source packages' exact license files before any commercial release.

The current demo loads the pinned 24 MB anatomy and 9.4 MB skeleton assets from GitHub's static host on demand. This introduces a network and performance dependency. Before real-patient deployment, prepare a compressed, self-hosted derivative with the same attribution, inspect it on target phones, and test touch selection on actual hardware.

Muscle names are mapped to existing broad symptom-region IDs. That mapping is an interface convenience, not a clinical statement that the selected muscle causes the symptom. Unknown small structures fall back to position; the accessible 2D region list remains the precise alternative.
