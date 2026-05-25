# biliCostumize

biliCostumize is a Chrome extension for customizing Bilibili. It is based on two open-source extensions:

- [reorx/minimal-bilibili](https://github.com/reorx/minimal-bilibili)
- [watawata39/BiliFocus](https://github.com/watawata39/BiliFocus)

This project keeps the minimal homepage experience from `minimal-bilibili`, adds selected focus controls from `BiliFocus`, and merges both projects' popup controls into one extension popup.

## Changes From Original minimal-bilibili

Compared with the original `minimal-bilibili`, this project makes the homepage more information-dense and adds more direct page-cleanup controls.

- Reworked the homepage into a three-column layout: activities, watch-later, and recommendations.
- The activities column shows followed-user video activities grouped by date.
- The watch-later column loads the user's Bilibili watch-later list and keeps it in an independently scrollable right-side area.
- The recommendation column reuses Bilibili's original homepage recommendation data, but renders it as compact cards instead of keeping the original Bilibili feed layout.
- The original minimal-Bilibili right-side recommendation container is hidden so the page is controlled by the custom layout.
- The homepage script now waits for the homepage feed container and falls back to `DedeUserID` from cookies, making the layout more reliable when Bilibili changes header DOM nodes.

- Recommendation cards are displayed in batches of 10.
- Added "switch" behavior to rotate through recommendation batches.
- Added hide/show state for the custom recommendation column without collapsing the rest of the layout.
- Added actions on recommendation cards: open video, open uploader page, add to watch-later, and remove unwanted cards.
- Applied blocked-word filtering to both activities and recommendations.
- Increased spacing below the recommendation column title for a cleaner visual separation.

- activity titles now open through a background script.
- If the current tab is in Chrome Split View, clicking a activity title navigates the paired split-view tab.
- If the current tab is not in Split View, the video opens in a new tab.
- Visited activity videos remain highlighted.

Visual and interaction polish:

- Improved the activity sequence-number hover preview.
- Preview cards use a clearer border, rounded corners, shadow, 16:9 image cropping, and more readable description typography.
- Long preview descriptions can scroll and links inside descriptions are rendered as clickable links.
- The "activities" title styling was made slightly more prominent without increasing its line height.
- Several homepage spacing and alignment details were tuned for a cleaner layout.

Video-page changes retained from the original project:

- The video screenshot shortcut remains available.
- `S` copies the current frame to the clipboard.
- `Shift + S` downloads the current frame as an image.

## Integration changes from BiliFocus:

- Merged selected BiliFocus controls into the same popup as the original minimal-bilibili options.
- Added controls for hiding video recommendations, comments, ads, top navigation items, search suggestions, and selected personal-page sections.
- Added slash-to-focus-search behavior.
- Converted popup labels to English.
- Removed BiliFocus's "hide homepage recommendations" option and related homepage-hiding code so the homepage always stays in this project's custom three-column layout.

- Blocked words from the popup settings are applied to activities and recommendations.

## Popup Controls

The popup combines:

- `minimal-bilibili` settings: search autofocus, auto-loading video columns, and blocked words.
- `BiliFocus` settings: slash-to-focus search, hiding recommendations/comments/ads/navigation items, and personal-page cleanup options.

The homepage recommendation hiding option from BiliFocus is intentionally removed so that the homepage always remains under the `minimal-bilibili` layout.

## Video Page

The original video-page screenshot shortcuts are retained:

- `S`: copy the current video frame to the clipboard.
- `Shift + S`: download the current video frame as an image.

## Build

Windows PowerShell build command:

```powershell
$env:NODE_ENV='production'; npx webpack
```

The Chrome unpacked extension output is:

```text
build/chrome
```

Load it in Chrome:

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Choose "Load unpacked".
4. Select `build/chrome`.

The original `npm run build-ext` path is not used here because the upstream clean script contains a bulk delete command.

## License

This project is distributed under the MIT License. It contains code derived
from `minimal-bilibili` and `BiliFocus`, both MIT-licensed projects. See
`THIRD_PARTY_NOTICES.md` for upstream source and copyright notices.
