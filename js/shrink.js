(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const fileListEl = document.getElementById("file-list");
  const emptyNote = document.getElementById("empty-note");
  const qualityPanel = document.getElementById("quality-panel");
  const qualitySlider = document.getElementById("quality-slider");
  const qualityValue = document.getElementById("quality-value");
  const shrinkBtn = document.getElementById("shrink-btn");
  const clearBtn = document.getElementById("clear-btn");
  const statusEl = document.getElementById("status");

  /** @type {{ id: number, file: File, thumbUrl: string }[]} */
  let files = [];
  let nextId = 1;
  let busy = false;

  function isJpeg(file) {
    return file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name);
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status-line" + (kind ? ` ${kind}` : "");
  }

  function addFiles(fileListArg) {
    const incoming = Array.from(fileListArg).filter(isJpeg);
    if (incoming.length === 0) return;
    for (const file of incoming) {
      files.push({ id: nextId++, file, thumbUrl: URL.createObjectURL(file) });
    }
    setStatus("");
    render();
  }

  function removeFile(id) {
    const entry = files.find((f) => f.id === id);
    if (entry) URL.revokeObjectURL(entry.thumbUrl);
    files = files.filter((f) => f.id !== id);
    render();
  }

  function clearFiles() {
    files.forEach((entry) => URL.revokeObjectURL(entry.thumbUrl));
    files = [];
  }

  function iconSvg(path) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  }

  const REMOVE_ICON = iconSvg('<path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14" />');

  function render() {
    fileListEl.innerHTML = "";
    emptyNote.hidden = files.length > 0;
    qualityPanel.hidden = files.length === 0;

    files.forEach((entry) => {
      const li = document.createElement("li");
      li.className = "file-strip";
      li.innerHTML = `
        <img class="thumb" alt="" />
        <span class="name"></span>
        <span class="meta">${formatSize(entry.file.size)}</span>
        <span class="actions">
          <button class="icon-btn danger" data-action="remove" data-id="${entry.id}" aria-label="Remove">${REMOVE_ICON}</button>
        </span>
      `;
      li.querySelector(".thumb").src = entry.thumbUrl;
      const nameSpan = li.querySelector(".name");
      nameSpan.textContent = entry.file.name;
      nameSpan.title = entry.file.name;
      fileListEl.appendChild(li);
    });

    const ready = files.length >= 1;
    shrinkBtn.disabled = !ready || busy;
    clearBtn.disabled = files.length === 0 || busy;
  }

  fileListEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".icon-btn");
    if (!btn) return;
    if (btn.dataset.action === "remove") removeFile(Number(btn.dataset.id));
  });

  clearBtn.addEventListener("click", () => {
    if (busy) return;
    clearFiles();
    setStatus("");
    render();
  });

  fileInput.addEventListener("change", (e) => {
    addFiles(e.target.files);
    fileInput.value = "";
  });

  dropzone.addEventListener("click", () => {
    fileInput.click();
  });

  ["dragenter", "dragover"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag-over");
    });
  });

  dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files) {
      addFiles(e.dataTransfer.files);
    }
  });

  qualitySlider.addEventListener("input", () => {
    qualityValue.textContent = `${qualitySlider.value}%`;
  });

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not decode image"));
      img.src = url;
    });
  }

  // Re-encode through <img> + <canvas>: the browser applies EXIF orientation
  // when decoding <img> (the source file itself is never rotated), and
  // canvas.toBlob's quality argument is how JPEG re-compression is done.
  async function shrinkJpeg(file, quality) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function shrunkName(originalName) {
    const dot = originalName.lastIndexOf(".");
    const base = dot === -1 ? originalName : originalName.slice(0, dot);
    return `${base}-shrunk.jpg`;
  }

  // Two different files can share the same original name (different
  // folders, different phones). Zip entries are keyed by name, so a
  // collision would silently overwrite one file with another — dedupe here.
  function uniqueName(name, usedNames) {
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
    const dot = name.lastIndexOf(".");
    const base = dot === -1 ? name : name.slice(0, dot);
    const ext = dot === -1 ? "" : name.slice(dot);
    let n = 2;
    let candidate = `${base} (${n})${ext}`;
    while (usedNames.has(candidate)) {
      n++;
      candidate = `${base} (${n})${ext}`;
    }
    usedNames.add(candidate);
    return candidate;
  }

  shrinkBtn.addEventListener("click", async () => {
    if (files.length < 1 || busy) return;
    busy = true;
    shrinkBtn.disabled = true;
    clearBtn.disabled = true;
    setStatus("Shrinking…");

    try {
      const quality = Number(qualitySlider.value) / 100;
      let originalTotal = 0;
      let shrunkTotal = 0;
      const results = [];
      const usedNames = new Set();

      for (const entry of files) {
        const blob = await shrinkJpeg(entry.file, quality);
        originalTotal += entry.file.size;
        shrunkTotal += blob.size;
        results.push({ name: uniqueName(shrunkName(entry.file.name), usedNames), blob });
      }

      if (results.length === 1) {
        downloadBlob(results[0].blob, results[0].name);
      } else {
        const zip = new JSZip();
        results.forEach((r) => zip.file(r.name, r.blob));
        const zipBlob = await zip.generateAsync({ type: "blob" });
        downloadBlob(zipBlob, "shrunk-photos.zip");
      }

      const changePct =
        originalTotal > 0 ? Math.round((1 - shrunkTotal / originalTotal) * 100) : 0;
      const changeLabel = changePct >= 0 ? `${changePct}% smaller` : `${-changePct}% larger`;
      setStatus(`Done — ${formatSize(originalTotal)} → ${formatSize(shrunkTotal)} (${changeLabel}).`, "success");
    } catch (err) {
      console.error(err);
      setStatus("Could not shrink these photos.", "error");
    } finally {
      busy = false;
      render();
    }
  });

  render();
})();
