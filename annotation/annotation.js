/* Annotation Editor */

const params = new URLSearchParams(window.location.search);
const storageKey = params.get("key");
const capturedWidth = params.get("width");

const mainCanvas = document.getElementById("mainCanvas");
const overlayCanvas = document.getElementById("overlayCanvas");
const mainCtx = mainCanvas.getContext("2d");
const overlayCtx = overlayCanvas.getContext("2d");
const widthInfo = document.getElementById("widthInfo");

let currentTool = "pen";
let strokeColor = "#ff3366";
let lineWidth = 4;
let annotations = [];
let isDrawing = false;
let startX = 0,
  startY = 0;
let currentPath = [];

/* Load Image from chrome.storage.session */
const baseImage = new Image();
baseImage.onload = () => {
  mainCanvas.width = overlayCanvas.width = baseImage.width;
  mainCanvas.height = overlayCanvas.height = baseImage.height;
  redraw();
  if (capturedWidth) widthInfo.textContent = capturedWidth + "px viewport";
  // Hide loading message
  const loadingMsg = document.getElementById("loadingMessage");
  if (loadingMsg) loadingMsg.remove();
};

baseImage.onerror = () => {
  showError("Failed to load screenshot image");
};

async function loadImage() {
  console.log("[RS Annotation] Loading image, key:", storageKey);

  if (storageKey) {
    try {
      const result = await chrome.storage.session.get(storageKey);
      console.log(
        "[RS Annotation] Storage result:",
        result ? "found" : "not found",
      );
      const entry = result[storageKey];
      if (entry && entry.dataUrl) {
        console.log(
          "[RS Annotation] Setting image src, data length:",
          entry.dataUrl.length,
        );
        baseImage.src = entry.dataUrl;
        return;
      } else {
        showError(
          "Screenshot not found in storage. The capture may have failed.",
        );
      }
    } catch (e) {
      console.error("[RS Annotation] Storage error:", e);
      showError("Failed to access storage: " + e.message);
    }
  } else {
    const imgSrc = params.get("img");
    if (imgSrc) {
      baseImage.src = imgSrc;
    } else {
      showError("No image source provided");
    }
  }
}

function showError(msg) {
  const container =
    document.querySelector(".canvas-container") || document.body;
  const existing = document.getElementById("loadingMessage");
  if (existing) existing.remove();

  const errDiv = document.createElement("div");
  errDiv.id = "loadingMessage";
  errDiv.style.cssText =
    "position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#ff6b6b;font-size:16px;text-align:center;padding:20px;background:#1a1a2e;border-radius:8px;border:1px solid #ff6b6b;max-width:400px;";
  errDiv.innerHTML = `<strong>Error</strong><br><br>${msg}<br><br><small>Check browser console (F12) for details</small>`;
  container.appendChild(errDiv);
}

loadImage();

/* Tool Selection */
document.querySelectorAll("[data-tool]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelector(".tool-btn.active")?.classList.remove("active");
    btn.classList.add("active");
    currentTool = btn.dataset.tool;
    overlayCanvas.style.cursor = currentTool === "text" ? "text" : "crosshair";
  });
});

document.getElementById("colorPicker").addEventListener("input", (e) => {
  strokeColor = e.target.value;
});
document.getElementById("lineWidth").addEventListener("change", (e) => {
  lineWidth = parseInt(e.target.value, 10);
});

/* Undo / Clear */
document.getElementById("undoBtn").addEventListener("click", () => {
  annotations.pop();
  redraw();
});
document.getElementById("clearBtn").addEventListener("click", () => {
  annotations = [];
  redraw();
});

/* Save */
document.getElementById("saveBtn").addEventListener("click", () => {
  const merged = document.createElement("canvas");
  merged.width = mainCanvas.width;
  merged.height = mainCanvas.height;
  const mCtx = merged.getContext("2d");
  mCtx.drawImage(mainCanvas, 0, 0);
  merged.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "annotated_" + (capturedWidth || "snapshot") + ".png";
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
});

/* Drawing Events */
function getPos(e) {
  const rect = overlayCanvas.getBoundingClientRect();
  const scaleX = overlayCanvas.width / rect.width;
  const scaleY = overlayCanvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

overlayCanvas.addEventListener("mousedown", (e) => {
  const pos = getPos(e);
  startX = pos.x;
  startY = pos.y;
  isDrawing = true;
  if (currentTool === "pen") {
    currentPath = [{ x: pos.x, y: pos.y }];
  } else if (currentTool === "text") {
    isDrawing = false;
    const text = prompt("Enter annotation text:");
    if (text) {
      annotations.push({
        type: "text",
        x: pos.x,
        y: pos.y,
        text,
        color: strokeColor,
        size: lineWidth * 5 + 10,
      });
      redraw();
    }
  }
});

overlayCanvas.addEventListener("mousemove", (e) => {
  const pos = getPos(e);
  if (currentTool === "pen") {
    currentPath.push({ x: pos.x, y: pos.y });
    clearOverlay();
    drawPenPath(overlayCtx, currentPath, strokeColor, lineWidth);
  } else if (currentTool === "arrow") {
    clearOverlay();
    drawArrow(overlayCtx, startX, startY, pos.x, pos.y, strokeColor, lineWidth);
  } else if (currentTool === "rect") {
    clearOverlay();
    drawRect(overlayCtx, startX, startY, pos.x, pos.y, strokeColor, lineWidth);
  } else if (currentTool === "blur") {
    clearOverlay();
    drawBlurPreview(overlayCtx, startX, startY, pos.x, pos.y);
  }
});

overlayCanvas.addEventListener("mouseup", (e) => {
  isDrawing = false;
  const pos = getPos(e);
  if (currentTool === "pen") {
    annotations.push({
      type: "pen",
      path: [...currentPath],
      color: strokeColor,
      width: lineWidth,
    });
  } else if (currentTool === "arrow") {
    annotations.push({
      type: "arrow",
      x1: startX,
      y1: startY,
      x2: pos.x,
      y2: pos.y,
      color: strokeColor,
      width: lineWidth,
    });
  } else if (currentTool === "rect") {
    annotations.push({
      type: "rect",
      x1: startX,
      y1: startY,
      x2: pos.x,
      y2: pos.y,
      color: strokeColor,
      width: lineWidth,
    });
  } else if (currentTool === "blur") {
    annotations.push({
      type: "blur",
      x1: startX,
      y1: startY,
      x2: pos.x,
      y2: pos.y,
    });
  }
  clearOverlay();
  redraw();
});

overlayCanvas.addEventListener("mouseleave", () => {
  if (isDrawing) {
    isDrawing = false;
    clearOverlay();
  }
});

/* Drawing Functions */
function clearOverlay() {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

function redraw() {
  mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
  mainCtx.drawImage(baseImage, 0, 0);
  annotations.forEach((a) => {
    switch (a.type) {
      case "pen":
        drawPenPath(mainCtx, a.path, a.color, a.width);
        break;
      case "arrow":
        drawArrow(mainCtx, a.x1, a.y1, a.x2, a.y2, a.color, a.width);
        break;
      case "rect":
        drawRect(mainCtx, a.x1, a.y1, a.x2, a.y2, a.color, a.width);
        break;
      case "text":
        drawText(mainCtx, a);
        break;
      case "blur":
        drawBlur(mainCtx, a.x1, a.y1, a.x2, a.y2);
        break;
    }
  });
}

function drawPenPath(ctx, path, color, width) {
  if (path.length < 2) return;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
  ctx.stroke();
}

function drawArrow(ctx, x1, y1, x2, y2, color, width) {
  const headLen = width * 4 + 8;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

function drawRect(ctx, x1, y1, x2, y2, color, width) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.rect(
    Math.min(x1, x2),
    Math.min(y1, y2),
    Math.abs(x2 - x1),
    Math.abs(y2 - y1),
  );
  ctx.stroke();
}

function drawText(ctx, a) {
  ctx.font = "bold " + a.size + "px sans-serif";
  ctx.fillStyle = a.color;
  ctx.fillText(a.text, a.x, a.y);
}

function drawBlur(ctx, x1, y1, x2, y2) {
  const rx = Math.min(x1, x2),
    ry = Math.min(y1, y2);
  const rw = Math.abs(x2 - x1),
    rh = Math.abs(y2 - y1);
  if (rw < 2 || rh < 2) return;
  const imageData = ctx.getImageData(rx, ry, rw, rh);
  const bs = 10;
  for (let by = 0; by < rh; by += bs) {
    for (let bx = 0; bx < rw; bx += bs) {
      const idx = (by * rw + bx) * 4;
      const r = imageData.data[idx],
        g = imageData.data[idx + 1],
        b = imageData.data[idx + 2];
      for (let dy = 0; dy < bs && by + dy < rh; dy++) {
        for (let dx = 0; dx < bs && bx + dx < rw; dx++) {
          const i = ((by + dy) * rw + (bx + dx)) * 4;
          imageData.data[i] = r;
          imageData.data[i + 1] = g;
          imageData.data[i + 2] = b;
        }
      }
    }
  }
  ctx.putImageData(imageData, rx, ry);
}

function drawBlurPreview(ctx, x1, y1, x2, y2) {
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.strokeRect(
    Math.min(x1, x2),
    Math.min(y1, y2),
    Math.abs(x2 - x1),
    Math.abs(y2 - y1),
  );
  ctx.setLineDash([]);
}
