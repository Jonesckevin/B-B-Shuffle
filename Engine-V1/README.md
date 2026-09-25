# Engine-V1

Legacy original single-page engine, kept for comparison against the current
`Engine-V2/` pages. It is still linked from the portal and is served by the same
nginx container as the rest of the app.

- **URL:** http://localhost:8180/Engine-V1/
- **Layout:** flat folder, classic `<script>` tags — no bundler, no ES modules.
  Load order is fixed by the script tags at the bottom of `index.html`.
- **Decks:** the 18 bundled decks plus the user-created Custom Cards deck, all
  registered in `CONFIG.decks` (`config.js`). Each points at a
  `../shared/decks/**/carddb.json` catalog, except Custom Cards, which reads
  `../data/custom-decks/custom-cards.json`.
- **Artwork:** deck JSONs store `../../`-prefixed image paths, so `resolveAsset()`
  in `utils.js` strips one `../` hop before the images are requested.
- **Scripts:** `deck-script.js` (deck picker, card backs), `card-script.js` (card
  pools, DM solutions), `ui-script.js` (panel toggles), `ui-builder.js` (scenario
  builder), `dice-script.js` (dice, turns), `flip-script.js` (card flips),
  `game-state.js` (state), `lightbox.js` (vendored Lightbox2 plus jQuery from a
  CDN).
- **Help:** [`help.html`](./help.html) is the in-page card reference.

Build/run instructions, licence and attribution are in the repository root
[`README.md`](../README.md).

