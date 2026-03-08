/* ── Content script — injected for full-page helpers ─ */

// Expose page metrics (used by service worker via scripting.executeScript)
// Most work is done inline in the background script via func injection,
// but this file can hold reusable helpers.

(function () {
  // Hide any fixed/sticky elements during stitching to avoid duplicates
  const FIXED_STYLE_ID = "__responsive_snapshot_fix__";
  if (!document.getElementById(FIXED_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = FIXED_STYLE_ID;
    style.textContent = `
      .__rs_capture_mode__ * {
        position: static !important;
      }
      .__rs_capture_mode__ [style*="position: fixed"],
      .__rs_capture_mode__ [style*="position:fixed"],
      .__rs_capture_mode__ [style*="position: sticky"],
      .__rs_capture_mode__ [style*="position:sticky"] {
        position: static !important;
      }
    `;
    document.head.appendChild(style);
  }

  // Expose toggle functions on window for background to call
  window.__rsEnableCaptureMode = () => {
    document.documentElement.classList.add("__rs_capture_mode__");
  };
  window.__rsDisableCaptureMode = () => {
    document.documentElement.classList.remove("__rs_capture_mode__");
  };
})();
