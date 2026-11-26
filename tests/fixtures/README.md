These fixtures contain measured geometry from the local rendered assets. They let
the layout regression tests run in a fresh checkout without `dist/`, source art,
rendered images, or the standalone build folders.

`fishing-layout.json` retains every pose of all 17 fishing cats, including timing,
body bounds, feet/grip/head anchors, native paw transforms, and hand rotation. It
also contains the five rods' attachment geometry and four fish's measured body
and mouth metadata. Unused source information, atlas/image paths, duplicate
normalized anchors, and unused arm joints are excluded.

`defense-layout.json` retains all 17 cats and 15 enemies, including every clip's
frame rectangles, fixed frame size/anchor, and authored per-frame muzzle points.
Relative atlas names serve only as identifiers for the test's fake decoded images;
the tests never load them. The actual measured visible bounds remain in the game's
`actor-bounds.js`, which is committed alongside its measurement tool.

Refresh after updating local asset metadata:

```sh
node tools/capture_game_test_fixtures.mjs
```

Verify that committed fixtures still match the prepared local assets:

```sh
node tools/capture_game_test_fixtures.mjs --check
```

Capture/check requires the existing `dist/` manifests and
`game/cat-defense/assets/manifest.json`; ordinary tests require only these fixtures.
Neither command renders or changes game assets. Capture preserves numeric values
without rounding, and generated JSON has no timestamp or machine-specific paths.
