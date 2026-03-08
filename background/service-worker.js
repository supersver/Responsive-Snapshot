/* ── Responsive Snapshot — Background Service Worker ── */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "captureMultiple") {
    handleCaptureMultiple(msg)
      .then(sendResponse)
      .catch((err) => {
        console.error("[RS] Capture error:", err);
        sendResponse({ error: err.message });
      });
    return true; // async response
  }
});

/* ═══════════════════════════════════════════════════════
   MAIN ORCHESTRATOR
   ═══════════════════════════════════════════════════════ */
async function handleCaptureMultiple({
  tabId,
  url,
  widths,
  fullPage,
  annotate,
}) {
  const total = widths.length;
  console.log("[RS] Starting capture for", total, "widths:", widths);

  for (let i = 0; i < total; i++) {
    const width = widths[i];
    notifyProgress(i, total, `Preparing ${width}px…`);

    let dataUrl;
    try {
      if (fullPage) {
        dataUrl = await captureFullPage(url, width);
      } else {
        dataUrl = await captureViewport(url, width);
      }
      console.log(
        "[RS] Captured",
        width,
        "- data length:",
        dataUrl?.length || 0,
      );
    } catch (err) {
      console.error("[RS] Capture failed for", width, ":", err);
      // Fallback to viewport capture if full-page fails
      try {
        dataUrl = await captureViewport(url, width);
      } catch (fallbackErr) {
        console.error("[RS] Fallback also failed:", fallbackErr);
        notifyProgress(i + 1, total, `Failed at ${width}px`);
        continue;
      }
    }

    notifyProgress(i + 1, total, `Done ${width}px`);

    if (annotate && dataUrl) {
      // Store image in session storage and open annotation tab
      const key = `rs_img_${Date.now()}_${width}`;
      try {
        await chrome.storage.session.set({ [key]: { dataUrl, width, url } });
        console.log("[RS] Stored in session:", key);
      } catch (storageErr) {
        console.error("[RS] Storage failed:", storageErr);
        // Fallback: download instead
        downloadImage(dataUrl, url, width);
        continue;
      }

      await chrome.tabs.create({
        url: chrome.runtime.getURL(
          `annotation/annotation.html?key=${encodeURIComponent(key)}&width=${width}`,
        ),
        active: true,
      });
      // Stagger multiple tabs slightly
      if (i < total - 1) await sleep(400);
    } else if (dataUrl) {
      downloadImage(dataUrl, url, width);
    }
  }

  notifyProgress(total, total, "All done!");
  return { success: true, count: total };
}

/* ═══════════════════════════════════════════════════════
   VIEWPORT CAPTURE — open offscreen window, capture, close
   ═══════════════════════════════════════════════════════ */
async function captureViewport(url, width) {
  console.log("[RS] captureViewport starting for width:", width);
  
  const win = await chrome.windows.create({
    url,
    width: width + 16, // +16 for scrollbar headroom
    height: 900,
    state: "normal",
    focused: true, // Must focus to capture
  });
  console.log("[RS] Window created:", win.id);

  try {
    const tab = win.tabs[0];
    console.log("[RS] Tab ID:", tab.id);
    
    // Wait for the tab to fully load
    await waitForTabLoad(tab.id);
    console.log("[RS] Tab loaded");
    await sleep(1000); // Extra time for render

    // Focus the window again before capture
    await chrome.windows.update(win.id, { focused: true });
    await sleep(300);
    
    console.log("[RS] Attempting captureVisibleTab...");
    const dataUrl = await chrome.tabs.captureVisibleTab(win.id, {
      format: "png",
    });
    console.log("[RS] Capture successful, dataUrl length:", dataUrl?.length);
    return dataUrl;
  } catch (err) {
    console.error("[RS] captureViewport error:", err);
    throw err;
  } finally {
    console.log("[RS] Removing window:", win.id);
    await chrome.windows.remove(win.id).catch(() => {});
  }
}

/* ═══════════════════════════════════════════════════════
   FULL-PAGE CAPTURE — scroll & stitch in offscreen window
   ═══════════════════════════════════════════════════════ */
async function captureFullPage(url, width) {
  console.log("[RS] captureFullPage starting for width:", width);
  
  const win = await chrome.windows.create({
    url,
    width: width + 16,
    height: 900,
    state: "normal",
    focused: true, // Must focus to capture
  });
  console.log("[RS] Full-page window created:", win.id);

  try {
    const tab = win.tabs[0];
    await waitForTabLoad(tab.id);
    console.log("[RS] Full-page tab loaded");
    await sleep(1000);

    // Focus the window before capture
    await chrome.windows.update(win.id, { focused: true });
    await sleep(300);

    // Get page metrics
    const [{ result: metrics }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        scrollHeight: Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight,
        ),
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        dpr: window.devicePixelRatio || 1,
      }),
    });

    const { scrollHeight, viewportHeight, viewportWidth, dpr } = metrics;

    if (scrollHeight <= viewportHeight) {
      // Page fits in one shot — no stitching needed
      const dataUrl = await chrome.tabs.captureVisibleTab(win.id, {
        format: "png",
      });
      return dataUrl;
    }

    // Scroll step: use 80% of viewport height to get overlap and avoid missing content
    const step = Math.floor(viewportHeight * 0.9);
    const partImages = [];
    let scrollY = 0;

    // Disable fixed/sticky elements to avoid duplicate headers in stitched image
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const style = document.createElement("style");
        style.id = "__rs_fix__";
        style.textContent = `
          *[style*="position: fixed"], *[style*="position:fixed"],
          *[style*="position: sticky"], *[style*="position:sticky"] {
            position: static !important;
          }
        `;
        // Also override computed styles
        const all = document.querySelectorAll("*");
        const stored = [];
        all.forEach((el) => {
          const cs = window.getComputedStyle(el);
          if (cs.position === "fixed" || cs.position === "sticky") {
            stored.push({ el, pos: el.style.position });
            el.style.setProperty("position", "static", "important");
          }
        });
        window.__rs_stored = stored;
        document.head.appendChild(style);
      },
    });
    await sleep(200);

    // Capture each viewport-height strip
    while (scrollY < scrollHeight) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (y) => window.scrollTo(0, y),
        args: [scrollY],
      });
      await sleep(280);

      // Get actual scroll position (may be clamped at bottom)
      const [{ result: actualY }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.scrollY,
      });

      const dataUrl = await chrome.tabs.captureVisibleTab(win.id, {
        format: "png",
      });
      const segmentHeight = Math.min(step, scrollHeight - actualY);
      partImages.push({ dataUrl, y: actualY, height: segmentHeight });

      if (actualY + viewportHeight >= scrollHeight) break;
      scrollY += step;
    }

    // Restore original positions
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (window.__rs_stored) {
          window.__rs_stored.forEach(({ el, pos }) => {
            el.style.position = pos || "";
          });
        }
        const st = document.getElementById("__rs_fix__");
        if (st) st.remove();
      },
    });

    // Stitch
    const stitched = await stitchImages(
      partImages,
      viewportWidth,
      scrollHeight,
      viewportHeight,
      dpr,
    );
    return stitched;
  } finally {
    await chrome.windows.remove(win.id).catch(() => {});
  }
}

/* ═══════════════════════════════════════════════════════
   STITCH using OffscreenCanvas
   ═══════════════════════════════════════════════════════ */
async function stitchImages(
  parts,
  pageWidth,
  totalHeight,
  viewportHeight,
  dpr,
) {
  // Clamp canvas size to avoid OOM on very tall pages
  const MAX_HEIGHT = 16000;
  const canvasW = Math.round(pageWidth * dpr);
  const canvasH = Math.min(Math.round(totalHeight * dpr), MAX_HEIGHT);

  const canvas = new OffscreenCanvas(canvasW, canvasH);
  const ctx = canvas.getContext("2d");

  for (const part of parts) {
    const blob = await (await fetch(part.dataUrl)).blob();
    const bmp = await createImageBitmap(blob);

    // How many CSS pixels this strip covers
    const stripCssH = part.height;
    // In canvas pixels
    const stripCanvasH = Math.round(stripCssH * dpr);
    const destY = Math.round(part.y * dpr);

    // Only draw the top stripCssH rows of the captured bitmap
    // (bmp.height may be taller if viewport has extra content below)
    const srcH = Math.min(bmp.height, Math.round(viewportHeight * dpr));
    const drawH = Math.min(stripCanvasH, canvasH - destY);
    if (drawH <= 0) {
      bmp.close();
      continue;
    }

    ctx.drawImage(bmp, 0, 0, bmp.width, srcH, 0, destY, canvasW, drawH);
    bmp.close();
  }

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(blob);
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */
function waitForTabLoad(tabId, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(); // proceed even if load stalled
    }, timeout);

    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    // Check if already loaded
    chrome.tabs.get(tabId, (tab) => {
      if (tab && tab.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

function downloadImage(dataUrl, pageUrl, width) {
  const hostname = safeHostname(pageUrl);
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  chrome.downloads.download({
    url: dataUrl,
    filename: `responsive-snapshot/${hostname}_${width}px_${ts}.png`,
    saveAs: false,
  });
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.replace(/[^a-zA-Z0-9.-]/g, "_");
  } catch {
    return "page";
  }
}

function notifyProgress(current, total, label) {
  const percent = Math.round((current / total) * 100);
  chrome.runtime
    .sendMessage({ action: "progress", current, total, percent, label })
    .catch(() => {}); // popup may be closed
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
