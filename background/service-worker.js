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
async function handleCaptureMultiple({
  tabId,
  url,
  widths,
  fullPage,
  annotate,
}) {
  const total = widths.length;
  console.log(
    "[RS] Starting capture for",
    total,
    "widths:",
    widths,
    "tabId:",
    tabId,
  );

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
        console.log(
          "[RS] Captured",
          width,
          "- data length:",
          dataUrl?.length || 0,
        );
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
            `annotation/annotation.html?key=${encodeURIComponent(key)}&width=${width}`,
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
   FULL-PAGE CAPTURE using CDP - scroll and stitch
   ═══════════════════════════════════════════════════════ */
async function captureFullPageCDP(debugTarget, width) {
  console.log("[RS] captureFullPageCDP for width:", width);

  const viewportHeight = 900;

  // Set viewport size
  await sendDebugCommand(debugTarget, "Emulation.setDeviceMetricsOverride", {
    width: width,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: width < 768,
  });

  await sleep(800); // Let page reflow

  // Get initial page height
  let pageHeight = await getPageHeight(debugTarget);
  console.log("[RS] Initial page height:", pageHeight);

  // First pass: scroll through entire page slowly to trigger ALL lazy loading
  const scrollStep = Math.floor(viewportHeight * 0.5); // 50% overlap
  let scrollY = 0;

  while (scrollY < pageHeight) {
    await sendDebugCommand(debugTarget, "Runtime.evaluate", {
      expression: `window.scrollTo({ top: ${scrollY}, behavior: 'instant' })`,
    });
    await sleep(400); // Wait for lazy content to load

    // Re-check page height as it may grow with lazy content
    const newHeight = await getPageHeight(debugTarget);
    if (newHeight > pageHeight) {
      console.log("[RS] Page grew from", pageHeight, "to", newHeight);
      pageHeight = newHeight;
    }

    scrollY += scrollStep;
  }

  // Scroll to bottom and wait
  await sendDebugCommand(debugTarget, "Runtime.evaluate", {
    expression: `window.scrollTo({ top: ${pageHeight}, behavior: 'instant' })`,
  });
  await sleep(500);

  // Final height check
  pageHeight = await getPageHeight(debugTarget);
  console.log("[RS] Final page height:", pageHeight);

  // Hide fixed/sticky elements temporarily
  await sendDebugCommand(debugTarget, "Runtime.evaluate", {
    expression: `
      (function() {
        window.__rs_hidden = [];
        document.querySelectorAll('*').forEach(el => {
          const cs = getComputedStyle(el);
          if (cs.position === 'fixed' || cs.position === 'sticky') {
            window.__rs_hidden.push({ el, display: el.style.display });
            el.style.display = 'none';
          }
        });
      })()
    `,
  });

  // Capture strips and stitch
  const strips = [];
  const stripHeight = viewportHeight;
  const maxHeight = 16000;
  const captureHeight = Math.min(pageHeight, maxHeight);

  scrollY = 0;
  while (scrollY < captureHeight) {
    await sendDebugCommand(debugTarget, "Runtime.evaluate", {
      expression: `window.scrollTo({ top: ${scrollY}, behavior: 'instant' })`,
    });
    await sleep(200);

    const result = await sendDebugCommand(debugTarget, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });

    const remainingHeight = captureHeight - scrollY;
    const thisStripHeight = Math.min(stripHeight, remainingHeight);

    strips.push({
      data: result.data,
      y: scrollY,
      height: thisStripHeight,
    });

    console.log("[RS] Captured strip at y:", scrollY, "height:", thisStripHeight);

    scrollY += stripHeight;
  }

  // Restore fixed/sticky elements
  await sendDebugCommand(debugTarget, "Runtime.evaluate", {
    expression: `
      (function() {
        if (window.__rs_hidden) {
          window.__rs_hidden.forEach(({ el, display }) => {
            el.style.display = display || '';
          });
          delete window.__rs_hidden;
        }
      })()
    `,
  });

  // Scroll back to top
  await sendDebugCommand(debugTarget, "Runtime.evaluate", {
    expression: "window.scrollTo({ top: 0, behavior: 'instant' })",
  });

  // Stitch strips together
  if (strips.length === 1) {
    return "data:image/png;base64," + strips[0].data;
  }

  return await stitchStrips(strips, width, captureHeight, viewportHeight);
}

async function getPageHeight(debugTarget) {
  const result = await sendDebugCommand(debugTarget, "Runtime.evaluate", {
    expression:
      "Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)",
    returnByValue: true,
  });
  return result.result.value;
}

async function stitchStrips(strips, width, totalHeight, viewportHeight) {
  // Create a canvas to stitch
  const canvas = new OffscreenCanvas(width, totalHeight);
  const ctx = canvas.getContext("2d");

  for (const strip of strips) {
    const blob = base64ToBlob(strip.data, "image/png");
    const bmp = await createImageBitmap(blob);

    // Calculate how much of this strip to use
    const srcHeight = Math.min(bmp.height, strip.height);
    const destY = strip.y;

    ctx.drawImage(bmp, 0, 0, bmp.width, srcHeight, 0, destY, width, srcHeight);

    bmp.close();
  }

  const resultBlob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(resultBlob);
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
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

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}
