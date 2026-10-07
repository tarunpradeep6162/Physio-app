# Model credits and licence

This downloadable anatomical reference model is adapted from [Body Explorer, pinned commit 7d04bf3](https://github.com/JohanBellander/BodyExplorer/tree/7d04bf3c4de2bd9cb234dd51d7e6857c099afafd).

**BodyParts3D — The Database Center for Life Science**, CC BY-SA 2.1 Japan: https://creativecommons.org/licenses/by-sa/2.1/jp/

**Z-Anatomy — The libre 3D atlas of anatomy**, by Gauthier Kervyn and contributors, CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/

The per-mesh source map is at `/anatomy/source-mesh-mapping.json`. The full model (`anatomy.glb`, `skeleton.glb`) was changed only by packing visual normal vectors; positions, triangles and names are preserved. The light copies (`anatomy-lite.glb`, `skeleton-lite.glb`) were further simplified for phones: each mesh has fewer triangles (surface deviation at most 1.5 mm), and names and materials are unchanged. They are adaptations under the same share-alike licences. Its source attribution, share-alike terms, original source links, transformation script and checksums are documented at `docs/ANATOMY_MODEL.md` in Dheepika Lab's source repository. The model is illustrative and cannot identify a patient's painful tissue.
