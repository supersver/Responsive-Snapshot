/* ── Responsive Snapshot — Background Service Worker ── */
/* Uses Chrome DevTools Protocol for reliable responsive capture */

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
async function handleCaptureMultiple({ tabId, url, widths, fullPage, annotate }) {
  const total = widths.length;
  console.log("[RS] Starting capture for", total, "widths:", widths, "tabId:", tabId);

  // Attach debugger to the tab
  const debugTarget = { tabId };
  
  try {
    await chrome.debugger.attach(debugTarget, "1.3");
    console.log("[RS] Debugger attached");
  } catch (err) {
    console.error("[RS] Failed to attach debugger:", err);
    throw new Error("Failed to attach debugger. Try reloading the page.");
  }

  try {
    // Enable necessary domains
    await sendDebugCommand(debugTarget, "Page.enable");
    await sendDebugCommand(debugTarget, "Emulation.setDeviceMetricsOverride", {
      width: 0,
      height: 0,
      deviceScaleFactor: 0,
      mobile: false,
    });

    for (let i = 0; i < total; i++) {
      const width = widths[i];
      notifyProgress(i, total, `Capturing ${width}px…`);

      let dataUrl;
      try {
        if (fullPage) {
          dataUrl = await captureFullPageCDP(debugTarget, width);
        } else {
          dataUrl = await captureViewportCDP(debugTarget, width);
        }
        console.log("[RS] Captured", width, "- data length:", dataUrl?.length || 0);
      } catch (err) {
        console.error("[RS] Capture failed for", width, ":", err);
        notifyProgress(i + 1, total, `Failed at ${width}px`);
        continue;
      }

      notifyProgress(i + 1, total, `Done ${width}px`);

      if (annotate && dataUrl) {
        const key = `rs_img_${Date.now()}_${width}`;
        try {
          await chrome.storage.session.set({ [key]: { dataUrl, width, url } });
          console.log("[RS] Stored in session:", key);
        } catch (storageErr) {
          console.error("[RS] Storage failed:", storageErr);
          downloadImage(dataUrl, url, width);
          continue;
        }

        await chrome.tabs.create({
          url: chrome.runtime.getURL(
            `annotation/annotation.html?key=${encodeURIComponent(key)}&width=${width}`
          ),
          active: true,
        });
        if (i < total - 1) await sleep(400);
      } else if (dataUrl) {
        downloadImage(dataUrl, url, width);
      }
    }

    // Reset emulation
    await sendDebugCommand(debugTarget, "Emulation.clearDeviceMetricsOverride");
    
  } finally {
    // Always detach debugger
    try {
      await chrome.debugger.detach(debugTarget);
      console.log("[RS] Debugger detached");
    } catch (e) {
      console.log("[RS] Debugger already detached");
    }
  }

  notifyProgress(total, total, "All done!");
  return { success: true, count: total };
}

/* ═══════════════════════════════════════════════════════
   VIEWPORT CAPTURE using CDP
   ═══════════════════════════════════════════════════════ */
async function captureViewportCDP(debugTarget, width) {
  console.log("[RS] captureViewportCDP for width:", width);

  // Set viewport size
  await sendDebugCommand(debugTarget, "Emulation.setDeviceMetricsOverride", {
    width: width,
    height: 800,
    deviceScaleFactor: 1,
    mobile: width < 768,
  });

  await sleep(500); // Let page reflow

  // Capture screenshot
  const result = await sendDebugCommand(debugTarget, "Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });

  return "data:image/png;base64," + result.data;
}

/* ═══════════════════════════════════════════════════════
   FULL-PAGE CAPTURE using CDP
   ═══════════════════════════════════════════════════════ */
async function captureFullPageCDP(debugTarget, width) {
  console.log("[RS] captureFullPageCDP for width:", width);

  // Set viewport width
  await sendDebugCommand(debugTarget, "Emulation.setDeviceMetricsOverride", {
    width: width,
    height: 800,
    deviceScaleFactor: 1,
    mobile: width < 768,
  });

  await sleep(500); // Let page reflow

  // Get page metrics for full page dimensions
  const layoutMetrics = await sendDebugCommand(debugTarget, "Page.getLayoutMetrics");
  const contentSize = layoutMetrics.contentSize || layoutMetrics.cssContentSize;
  
  const pageWidth = Math.ceil(contentSize.width);
  const pageHeight = Math.ceil(contentSize.height);
  
  console.log("[RS] Full page dimensions:", pageWidth, "x", pageHeight);

  // Set viewport to full page size (with limits)
  const maxHeight = 16384; // Chrome limit
  const captureHeight = Math.min(pageHeight, maxHeight);

  await sendDebugCommand(debugTarget, "Emulation.setDeviceMetricsOverride", {
    width: width,
    height: captureHeight,
    deviceScaleFactor: 1,
    mobile: width < 768,
  });

  await sleep(300);

  // Capture full page screenshot
  const result = await sendDebugCommand(debugTarget, "Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: {
      x: 0,
      y: 0,
      width: width,
      height: captureHeight,
      scale: 1,
    },
  });

  return "data:image/png;base64," + result.data;
}

/* ═══════════════════════════════════════════════════════
   CDP Helper
   ═══════════════════════════════════════════════════════ */
function sendDebugCommand(target, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */
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
