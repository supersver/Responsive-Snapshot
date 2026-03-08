# Responsive Snapshot

> Capture screenshots of any webpage at multiple device widths with one click — right from your browser toolbar.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

---

## Features

- **Device Presets** — 8 built-in presets spanning mobile, tablet, and desktop breakpoints  
- **Smart Default Selection** — auto-detects your current viewport width and pre-selects the closest matching preset with a **YOU** badge  
- **Full-Page Stitching** — scrolls through the entire page and stitches all strips into one tall PNG using `OffscreenCanvas` — your browser window is never resized  
- **Annotation Editor** — opens automatically after capture with pen, arrow, rectangle, text, and blur/pixelate tools  
- **Save Annotated PNG** — download the marked-up screenshot directly from the editor  
- **Multi-Width Capture** — select as many presets as you want; each gets its own annotation tab  

---

## Screenshots

| Popup | Annotation Editor |
|-------|-------------------|
| ![popup](docs/popup-preview.png) | ![editor](docs/editor-preview.png) |

---

## Installation

### From source (Developer Mode)

1. Clone or download this repository  
   ```bash
   git clone https://github.com/supersver/Responsive-Snapshot.git
   ```
2. Open **Chrome** and navigate to `chrome://extensions/`  
3. Enable **Developer mode** (toggle in the top-right corner)  
4. Click **Load unpacked** and select the `responsive-snapshot/` folder  
5. The extension icon appears in your toolbar — pin it for quick access  

### Generate production icons *(optional)*

The repository ships with minimal placeholder PNGs. To generate crisp icons from the included SVG:

```bash
npm install sharp
node generate-icons.js
```

Or export `icons/icon.svg` manually at **16 × 16**, **48 × 48**, and **128 × 128** px.

---

## Usage

1. Navigate to any webpage in Chrome  
2. Click the **Responsive Snapshot** toolbar icon  
3. Select one or more device presets (your current viewport is pre-selected)  
4. Toggle **Full-page capture** on/off  
5. Click **Capture Snapshots**  
6. The **Annotation Editor** opens in a new tab for each width — draw arrows, rectangles, text labels, or blur sensitive areas  
7. Click **Save PNG** to download the annotated screenshot  

---

## Device Presets

| Category | Device | Width |
|----------|--------|-------|
| Mobile | iPhone SE | 375 px |
| Mobile | iPhone 14 Pro | 393 px |
| Mobile | Pixel 7 | 412 px |
| Tablet | iPad Mini | 768 px |
| Tablet | iPad Pro 11″ | 834 px |
| Tablet | iPad Pro 12.9″ | 1024 px |
| Desktop | Laptop | 1366 px |
| Desktop | Desktop HD | 1920 px |

---

## Project Structure

```
responsive-snapshot/
├── manifest.json              # Chrome MV3 manifest
├── popup/
│   ├── popup.html             # Extension popup
│   ├── popup.css              # Popup styles
│   └── popup.js               # Preset logic + capture trigger
├── background/
│   └── service-worker.js      # Screenshot capture & full-page stitching
├── content/
│   └── content.js             # Page helper (suppresses fixed elements)
├── annotation/
│   ├── annotation.html        # Annotation editor page
│   ├── annotation.css         # Editor styles
│   └── annotation.js          # Drawing tools
├── icons/
│   ├── icon.svg               # Source icon
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── generate-icons.js          # Helper to generate PNGs from SVG
```

---

## Permissions

| Permission | Reason |
|------------|--------|
| `activeTab` | Read the current tab's URL and viewport width |
| `scripting` | Inject helpers to measure page dimensions and suppress fixed elements |
| `downloads` | Save screenshots when annotation is skipped |
| `windows` | Open a separate off-screen window at the target width for capture |
| `tabs` | Create annotation editor tabs and track load status |
| `storage` | Pass screenshot data to the annotation editor via session storage |

---

## How Full-Page Capture Works

1. A **new browser window** opens at the target width (your window is untouched)  
2. The extension waits for the page to fully load  
3. Fixed and sticky elements are temporarily set to `static` to prevent duplicates in the final image  
4. The page is scrolled in increments of 90 % of the viewport height; a screenshot is taken at each position  
5. All strips are stitched together in an `OffscreenCanvas` inside the service worker  
6. The temporary window is closed and the stitched PNG is passed to the annotation editor  

---

## License

MIT — see [LICENSE](LICENSE)
