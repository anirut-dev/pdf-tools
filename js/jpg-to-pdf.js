(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const fileListEl = document.getElementById("file-list");
  const emptyNote = document.getElementById("empty-note");
  const convertBtn = document.getElementById("convert-btn");
  const clearBtn = document.getElementById("clear-btn");
  const statusEl = document.getElementById("status");

  const A4_PORTRAIT = { width: 595.28, height: 841.89 };
  const PAGE_MARGIN = 36;

  /** @type {{ id: number, file: File, thumbUrl: string }[]} */
  let files = [];
  let nextId = 1;

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

  function moveFile(id, direction) {
    const index = files.findIndex((f) => f.id === id);
    const target = index + direction;
    if (target < 0 || target >= files.length) return;
    [files[index], files[target]] = [files[target], files[index]];
    render();
  }

  function iconSvg(path) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  }

  const ICONS = {
    up: iconSvg('<path d="M12 19V5M5 12l7-7 7 7" />'),
    down: iconSvg('<path d="M12 5v14M19 12l-7 7-7-7" />'),
    remove: iconSvg('<path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14" />'),
  };

  function render() {
    fileListEl.innerHTML = "";
    emptyNote.hidden = files.length > 0;

    files.forEach((entry, index) => {
      const li = document.createElement("li");
      li.className = "file-strip";
      li.innerHTML = `
        <span class="order">${index + 1}</span>
        <img class="thumb" alt="" />
        <span class="name"></span>
        <span class="meta">${formatSize(entry.file.size)}</span>
        <span class="actions">
          <button class="icon-btn" data-action="up" data-id="${entry.id}" ${index === 0 ? "disabled" : ""} aria-label="Move up">${ICONS.up}</button>
          <button class="icon-btn" data-action="down" data-id="${entry.id}" ${index === files.length - 1 ? "disabled" : ""} aria-label="Move down">${ICONS.down}</button>
          <button class="icon-btn danger" data-action="remove" data-id="${entry.id}" aria-label="Remove">${ICONS.remove}</button>
        </span>
      `;
      li.querySelector(".thumb").src = entry.thumbUrl;
      const nameSpan = li.querySelector(".name");
      nameSpan.textContent = entry.file.name;
      nameSpan.title = entry.file.name;
      fileListEl.appendChild(li);
    });

    const ready = files.length >= 1;
    convertBtn.disabled = !ready;
    clearBtn.disabled = files.length === 0;
  }

  fileListEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".icon-btn");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const action = btn.dataset.action;
    if (action === "up") moveFile(id, -1);
    else if (action === "down") moveFile(id, 1);
    else if (action === "remove") removeFile(id);
  });

  clearBtn.addEventListener("click", () => {
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

  function pageSizeFor(imgWidth, imgHeight) {
    return imgWidth > imgHeight
      ? { width: A4_PORTRAIT.height, height: A4_PORTRAIT.width }
      : { width: A4_PORTRAIT.width, height: A4_PORTRAIT.height };
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not decode image"));
      img.src = url;
    });
  }

  // Re-encode through <img> + <canvas>: the browser applies EXIF orientation
  // when decoding <img>, but pdf-lib's embedJpg does not — reading the raw
  // file bytes directly embeds portrait phone photos sideways. Re-encoding
  // also guarantees baseline (non-progressive) output, which is all
  // embedJpg supports.
  async function normalizeJpegBytes(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  convertBtn.addEventListener("click", async () => {
    if (files.length < 1) return;
    convertBtn.disabled = true;
    clearBtn.disabled = true;
    setStatus("Converting…");

    try {
      const { PDFDocument } = PDFLib;
      const pdfDoc = await PDFDocument.create();

      for (const entry of files) {
        const bytes = await normalizeJpegBytes(entry.file);
        const image = await pdfDoc.embedJpg(bytes);
        const size = pageSizeFor(image.width, image.height);
        const page = pdfDoc.addPage([size.width, size.height]);
        const contentWidth = page.getWidth() - PAGE_MARGIN * 2;
        const contentHeight = page.getHeight() - PAGE_MARGIN * 2;
        const scale = Math.min(contentWidth / image.width, contentHeight / image.height);
        const drawWidth = image.width * scale;
        const drawHeight = image.height * scale;
        page.drawImage(image, {
          x: (page.getWidth() - drawWidth) / 2,
          y: (page.getHeight() - drawHeight) / 2,
          width: drawWidth,
          height: drawHeight,
        });
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "photos.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setStatus(`Done — converted ${files.length} photo${files.length > 1 ? "s" : ""}.`, "success");
    } catch (err) {
      console.error(err);
      setStatus("Could not convert these photos. Check they are valid JPG files.", "error");
    } finally {
      clearBtn.disabled = files.length === 0;
      convertBtn.disabled = files.length < 1;
    }
  });

  render();
})();
