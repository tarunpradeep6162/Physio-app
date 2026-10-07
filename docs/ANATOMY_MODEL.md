# Anatomical 3D model provenance and build

The symptom map is an **illustrated reference atlas**, never a rendering of the patient or a diagnosis. It uses the pinned `anatomy.glb` and `skeleton.glb` from [Johan Bellander's Body Explorer](https://github.com/JohanBellander/BodyExplorer/tree/7d04bf3c4de2bd9cb234dd51d7e6857c099afafd). The mesh names and original per-mesh source map are retained at `public/anatomy/source-mesh-mapping.json`.

## Attribution and licences

- **BodyParts3D — The Database Center for Life Science**, under [CC BY-SA 2.1 Japan](https://creativecommons.org/licenses/by-sa/2.1/jp/). [Dataset licence listing](https://wiki.lifesciencedb.jp/mw/%E5%88%A9%E7%94%A8%E3%83%A9%E3%82%A4%E3%82%BB%E3%83%B3%E3%82%B9.html).
- **Z-Anatomy — The libre 3D atlas of anatomy**, by Gauthier Kervyn and contributors, under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). [Source attribution and licence](https://github.com/Z-Anatomy/Models-of-human-anatomy/blob/master/License.txt).
- Body Explorer's application code has a separate MIT notice; that does **not** relicense the anatomy data. Its [README](https://github.com/JohanBellander/BodyExplorer/blob/7d04bf3c4de2bd9cb234dd51d7e6857c099afafd/README.md) identifies 401 BodyParts3D and 66 Z-Anatomy anatomy meshes. The skeleton contains 201 bone meshes.
- The packed GLBs here are adaptations of those model assets. The model data remain subject to their respective source share-alike licences. This does not alter the licence of Dheepika Lab's separately authored application code. Preserve this notice and the original mapping whenever distributing the model. Review precise per-mesh provenance and licence compatibility before commercial release.

## Reproducible transformation

The source files are pinned at the Body Explorer commit above. Source SHA-256:

| File | SHA-256 | Bytes |
| --- | --- | ---: |
| anatomy.glb | `6e84529b60b64cc8f8d5cef665fda932e359e828b66d0c2dd44ec1bd9d0bd01f` | 25,133,568 |
| skeleton.glb | `894ed0e98a266b727a7e290f0d4123bb087c4afe84a48d55af71d1a351ca99a5` | 9,831,304 |

Run `python scripts/optimize_anatomy.py <source.glb> <output.glb>`. The script packs each normal from a 32-bit float vector into a normalized signed-byte vector with a four-byte vertex stride, declared with `KHR_mesh_quantization`. **Positions, triangle indices, names, and mesh counts are unchanged.** The maximum normal-component quantization error measured across the assets is 0.00394; this is visual shading data, never a measurement input.

| Built asset | SHA-256 | Bytes | Reduction |
| --- | --- | ---: | ---: |
| anatomy.glb | `1f6f7a77c3633305acb201649c5538dfad80b29deb2bfad9519fc4b93d318060` | 19,075,128 | 24.1% |
| skeleton.glb | `6288a245e68c9e193ccf9692b22542de78d3f45b3fb4a4ae0d0d78ec11081d36` | 7,614,976 | 22.5% |

The anatomy derivative is checked in as two exact binary parts under `model-source/` to fit the repository API transfer limit. `scripts/prepare-anatomy-assets.mjs` joins them and verifies the SHA-256 of both assets before build; the assembled anatomy file is generated and ignored by Git. The Vite build serves both GLBs from `/anatomy/` on the app's own origin. The browser no longer contacts GitHub to display the map. The skeleton is optional context and loads after the main anatomy.

## Phone-weight copies (Phase 41)

`node scripts/simplify-anatomy.mjs` writes `anatomy-lite.glb` and `skeleton-lite.glb`. It uses meshoptimizer 1.3.0 (MIT, dev dependency only). Each mesh is simplified on its own toward 25% of its triangles, with an absolute surface-deviation limit of 1.5 mm and open borders locked. Mesh and node names, materials, scene structure, normals of kept vertices and the source frame are unchanged. The output is deterministic, so two runs give the same bytes.

| Built asset | SHA-256 | Bytes | gzip | Triangles |
| --- | --- | ---: | ---: | ---: |
| anatomy-lite.glb | `c386312a3a9a104d048ecebb2adb0fefa5e29414b25118e2da61134b48b26d73` | 6,257,724 | 4,566,780 | 355,598 (from 1,092,417) |
| skeleton-lite.glb | `6676706ab9b0918cf84e9b5d9923433727427c7f5cecb7d759af82769f65e6be` | 1,934,612 | 1,425,857 | 126,750 (from 501,798) |

The light files are committed. `prepare-anatomy-assets.mjs` checks their hashes. `anatomyRegions.test.ts` runs the full region mapping on both models and checks that every mesh is kept by name, that the light model has under half the triangles, and that no light mesh extends beyond its original bounds. Area-weighted main regions match on both models.

The app loads the light model by default on narrow screens and with data saver or a slow connection; anyone can switch to **Full detail**, and the choice is remembered. The device check records which model ran. Whether phones handle either model acceptably is still decided by real-phone runs (`docs/ANATOMY_PHONE_QA.md`).

## Remaining checks

The GLB structure, hash, mesh counts, unchanged geometry/index bytes and normal quantization were checked locally. Vercel must build and serve both files with a binary content type. A real WebGL device must verify appearance, rotation, region selection, loading time, memory and thermal behaviour. A browser with WebGL disabled correctly uses the 2D map. Do not describe this packaging check as real-phone validation.
