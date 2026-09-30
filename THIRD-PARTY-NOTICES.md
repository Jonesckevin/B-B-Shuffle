# Third-Party Notices

This document lists third-party software and content used by B&B Shuffle and
the licenses that apply to them. It is provided to satisfy attribution
requirements; it does **not** relicense any component.

> ⚠️ **This project's GPL-3.0 license applies to the *code* only.** It does not
> extend to the Backdoors & Breaches card artwork, card text, or game content,
> which are separate works owned by Black Hills Information Security and their
> sponsors. See the "Game content" section below.

---

## Software libraries

| Component | Used in | Version | License | Copyright |
|---|---|---|---|---|
| [jQuery](https://jquery.com/) | `Engine-V1/index.html`, `help.html` (CDN) | 3.5.1 / 3.6.0 | MIT | OpenJS Foundation & jQuery contributors |
| [Lightbox2](https://lokeshdhakar.com/projects/lightbox2/) | `Engine-V1/lightbox.js` (vendored) | 2.x | MIT | © Lokesh Dhakar |
| [Mermaid](https://mermaid.js.org/) | `Engine-V2/modules/mermaid/flowchart.html` (CDN) | 11.x | MIT | © Knut Sveidqvist and contributors |
| [Architects Daughter](https://fonts.google.com/specimen/Architects+Daughter) | `Engine-V1/help.html`, `Engine-V1/index.html` (Google Fonts CDN) | — | SIL Open Font License 1.1 | © Kimberly Geswein |
| [Ubuntu](https://fonts.google.com/specimen/Ubuntu) | `Engine-V1/*.html` (Google Fonts CDN) | — | Ubuntu Font Licence 1.0 | © Canonical Ltd. |

Libraries loaded from a CDN are **not redistributed** by this project; the
attribution above is provided as a courtesy. The vendored Lightbox2 file
(`Engine-V1/lightbox.js`) retains its original copyright header.

Full license texts for each library are available at the links above.

---

## Upstream / derived projects

This repository is a derivative work. The following projects are its
provenance, and their code is distributed here under the same GPL-3.0 license.

| Project | Relation to this repository | License |
|---|---|---|
| [p3hndrx/B-B-Shuffle](https://github.com/p3hndrx/B-B-Shuffle) | Original project this repository forks. | GPL-3.0 |
| [blackhillsinfosec/play.backdoorsandbreaches.com](https://github.com/blackhillsinfosec/play.backdoorsandbreaches.com) | Fork of the project above; a further upstream source. | GPL-3.0 |
| [0xJaeg3r/backdoorsandbreaches-socinvader](https://github.com/0xJaeg3r/backdoorsandbreaches-socinvader) | Engine-V1 derivative whose solo AI play mode is the origin of Engine-V2's **Solo AI (PvE)** mode (`Engine-V2/js/solo-master.js`, `player.html?mode=solo`). | GPL-3.0 |

Original Engine-V1 code is preserved under `Engine-V1/` and retains its own
copyright and license notices. Engine-V2 is a rewrite of that codebase.

---

## Game content and permission (separate from GPL)

*Backdoors & Breaches* is a tabletop training game by **Black Hills Information
Security** in collaboration with **Antisyphon Training** and **Active
Countermeasures**. This application includes and serves the content listed
below; attribution alone does not grant rights to use or redistribute it.

Black Hills Information Security has publicly granted written permission for
community-created uses of Backdoors & Breaches content. This permission is
separate from the GPL-3.0 license and is limited to the scope and terms of the
written grant. Public website and container distribution must remain within
those terms; this notice does not expand them.

- Card artwork / card fronts (the `*.webp` files under `shared/decks/**` and
  `shared/decks/cardbase/**`)
- Card names, descriptions, and DETECTION text (the `carddb.json` files,
  `docs/card-details.json`, `docs/card-detection.json`)
- Brand logos (`shared/img/bb-logo*.png`, `blackhills-logo*.png`)
- Sponsor-branded decks, which incorporate third-party marks:
  **DataDog**, **Huntress**, **Red Canary**, **DenSecure**, **Trimarc**,
  **Electrical Co-Op / NRECA**, and **ICS-OT**.

Black Hills Information Security's permission does not by itself establish
permission for sponsor marks or other third-party content unless those rights
are expressly included in the grant. Confirm the applicable rights before
distributing sponsor-branded materials.

Official project and printable materials:
<https://www.blackhillsinfosec.com/tools/backdoorsandbreaches/classic>

The written permission from Black Hills Information Security governs the
permitted community use of the covered content. Attribution does not expand
that permission or grant rights to content owned by other rights holders.

---

## Disclaimer

This is an unofficial project. It is not affiliated with, endorsed
by, or sponsored by Black Hills Information Security or Antisyphon Training.
