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

## Game content (NOT covered by this project's GPL license)

*Backdoors & Breaches* is a tabletop training game by **Black Hills Information
Security** in collaboration with **Antisyphon Training** and **Active
Countermeasures**. The following content is the property of its respective
owners and is used here only by way of attribution/community use:

- Card artwork / card fronts (the `*.webp` files under `shared/decks/**` and
  `shared/decks/cardbase/**`)
- Card names, descriptions, and DETECTION text (the `carddb.json` files,
  `docs/card-details.json`, `docs/card-detection.json`)
- Brand logos (`shared/img/bb-logo*.png`, `blackhills-logo*.png`)
- Sponsor-branded decks, which incorporate third-party marks:
  **DataDog**, **Huntress**, **Red Canary**, **DenSecure**, **Trimarc**,
  **Electrical Co-Op / NRECA**, and **ICS-OT**.

Official project and printable materials:
<https://www.blackhillsinfosec.com/tools/backdoorsandbreaches/classic>

**Before republishing or distributing this project publicly, obtain written
permission from Black Hills Information Security for the card content, and
from the relevant sponsors for sponsor-branded decks.** Attribution does not
grant redistribution rights.

---

## Disclaimer

This is an unofficial project. It is not affiliated with, endorsed
by, or sponsored by Black Hills Information Security or Antisyphon Training.
