# biliCostumize

biliCostumize is a Chrome extension for customizing Bilibili. It is based on two open-source extensions:

- [reorx/minimal-bilibili](https://github.com/reorx/minimal-bilibili)
- [watawata39/BiliFocus](https://github.com/watawata39/BiliFocus)

This project keeps the minimal homepage experience from `minimal-bilibili`, adds selected focus controls from `BiliFocus`, and merges both projects' popup controls into one extension popup.

## Changes From Original minimal-bilibili

Compared with the original `minimal-bilibili`, this project makes the homepage more information-dense and adds more direct page-cleanup controls.

Homepage layout changes:

- Reworked the homepage into a three-column layout: dynamics, watch-later, and recommendations.
- The dynamics column shows followed-user video dynamics grouped by date.
- The watch-later column loads the user's Bilibili watch-later list and keeps it in an independently scrollable right-side area.
- The recommendation column reuses Bilibili's original homepage recommendation data, but renders it as compact cards instead of keeping the original Bilibili feed layout.
- The original Bilibili right-side recommendation container is hidden so the page is controlled by the custom layout.
- The homepage script now waits for the homepage feed container and falls back to `DedeUserID` from cookies, making the layout more reliable when Bilibili changes header DOM nodes.

Recommendation changes:

- Recommendation cards are displayed in batches of 10.
- Added "switch" behavior to rotate through recommendation batches.
- Added hide/show state for the custom recommendation column without collapsing the rest of the layout.
- Added actions on recommendation cards: open video, open uploader page, add to watch-later, and remove unwanted cards.
- Applied blocked-word filtering to both dynamics and recommendations.
- Increased spacing below the recommendation column title for a cleaner visual separation.

Dynamic list changes:

- Dynamic titles now open through a background script.
- If the current tab is in Chrome Split View, clicking a dynamic title navigates the paired split-view tab.
- If the current tab is not in Split View, the video opens in a new tab.
- Visited dynamic videos remain highlighted.
- The dynamic title and search-area alignment were adjusted so the page reads as one consistent column.
- The "load more" behavior was adjusted to avoid the dynamic list shifting left after loading more items.

Visual and interaction polish:

- Improved the dynamic sequence-number hover preview.
- The preview is a floating card aligned with the dynamic item.
- Preview cards use a clearer border, rounded corners, shadow, 16:9 image cropping, and more readable description typography.
- Long preview descriptions can scroll and links inside descriptions are rendered as clickable links.
- The "Dynamics" title styling was made slightly more prominent without increasing its line height.
- Several homepage spacing and alignment details were tuned for a cleaner layout.

Video-page changes retained from the original project:

- The video screenshot shortcut remains available.
- `S` copies the current frame to the clipboard.
- `Shift + S` downloads the current frame as an image.

Integration changes from BiliFocus:

- Merged selected BiliFocus controls into the same popup as the original minimal-bilibili options.
- Added controls for hiding video recommendations, comments, ads, top navigation items, search suggestions, and selected personal-page sections.
- Added slash-to-focus-search behavior.
- Converted popup labels to English.
- Removed BiliFocus's "hide homepage recommendations" option and related homepage-hiding code so the homepage always stays in this project's custom three-column layout.

Project identity changes:

- Renamed the extension to `biliCostumize`.
- Reset the extension version to `1.0.0`.
- Replaced the extension icon with the current custom icon asset.

## Homepage

The homepage uses a custom layout:

- The original Bilibili right-side recommendation container is hidden.
- Followed-user dynamics are shown in a main dynamics column and grouped by date.
- Watch-later items are loaded from Bilibili's watch-later API.
- Recommendations are re-rendered into a compact right-side column using the original homepage recommendation source.
- Recommendation cards support opening videos, visiting the uploader page, adding to watch-later, and removing unwanted cards.
- Blocked words from the popup settings are applied to dynamics and recommendations.

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
