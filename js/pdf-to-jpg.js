(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const fileListEl = document.getElementById("file-list");
  const emptyNote = document.getElementById("empty-note");
  const qualityPanel = document.getElementById("quality-panel");
  const qualitySlider = document.getElementById("quality-slider");
  const qualityValue = document.getElementById("quality-value");
  const convertBtn = document.getElementById("convert-btn");
  const clearBtn = document.getElementById("clear-btn");
  const statusEl = document.getElementById("status");

  const RENDER_SCALE = 2; // ~144 DPI equivalent, sharp enough without huge files

  /** @type {{ file: File, pageCount: number } | null} */
  let loaded = null;
  let busy = false;

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status-line" + (kind ? ` ${kind}` : "");
  }

  function iconSvg(path) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  }

  const REMOVE_ICON = iconSvg('<path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14" />');

  function renderLoaded() {
    fileListEl.innerHTML = "";
    if (!loaded) {
      emptyNote.hidden = false;
      qualityPanel.hidden = true;
      clearBtn.disabled = true;
      return;
    }
    emptyNote.hidden = true;
    qualityPanel.hidden = false;
    clearBtn.disabled = busy;
    convertBtn.disabled = busy;

    const li = document.createElement("li");
    li.className = "file-strip";
    li.innerHTML = `
      <span class="name"></span>
      <span class="meta">${loaded.pageCount} page${loaded.pageCount === 1 ? "" : "s"} &middot; ${formatSize(loaded.file.size)}</span>
      <span class="actions">
        <button class="icon-btn danger" data-action="remove" aria-label="Remove">${REMOVE_ICON}</button>
      </span>
    `;
    const nameSpan = li.querySelector(".name");
    nameSpan.textContent = loaded.file.name;
    nameSpan.title = loaded.file.name;
    fileListEl.appendChild(li);
  }

  async function loadFile(file, notice) {
    setStatus(notice || "");
    try {
      const bytes = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      loaded = { file, pageCount: pdf.numPages };
      renderLoaded();
    } catch (err) {
      console.error(err);
      loaded = null;
      renderLoaded();
      setStatus("Could not read this PDF. Check it isn't corrupted or password-protected.", "error");
    }
  }

  function addFiles(fileListArg) {
    if (busy) return;
    const incoming = Array.from(fileListArg).filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (incoming.length === 0) return;
    const notice =
      incoming.length > 1 ? `Using ${incoming[0].name} — this tool takes one PDF at a time.` : "";
    loadFile(incoming[0], notice);
  }

  fileListEl.addEventListener("click", (e) => {
    if (busy) return;
    const btn = e.target.closest(".icon-btn");
    if (!btn) return;
    if (btn.dataset.action === "remove") {
      loaded = null;
      renderLoaded();
      setStatus("");
    }
  });

  clearBtn.addEventListener("click", () => {
    if (busy) return;
    loaded = null;
    renderLoaded();
    setStatus("");
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

  function baseName(originalName) {
    const dot = originalName.lastIndexOf(".");
    return dot === -1 ? originalName : originalName.slice(0, dot);
  }

  async function renderPageToBlob(pdf, pageNumber, quality) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    // JPG has no alpha channel — paint white first so a transparent PDF background doesn't turn black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  }

  convertBtn.addEventListener("click", async () => {
    if (!loaded || busy) return;
    const workingFile = loaded.file;
    const quality = Number(qualitySlider.value) / 100;
    busy = true;
    convertBtn.disabled = true;
    clearBtn.disabled = true;
    setStatus("Rendering…");

    try {
      const bytes = await workingFile.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const pageCount = pdf.numPages;
      const name = baseName(workingFile.name);
      const padWidth = String(pageCount).length;

      if (pageCount === 1) {
        const blob = await renderPageToBlob(pdf, 1, quality);
        downloadBlob(blob, `${name}.jpg`);
      } else {
        const zip = new JSZip();
        for (let i = 1; i <= pageCount; i++) {
          setStatus(`Rendering page ${i} of ${pageCount}…`);
          const blob = await renderPageToBlob(pdf, i, quality);
          const pageLabel = String(i).padStart(padWidth, "0");
          zip.file(`${name}-page-${pageLabel}.jpg`, blob);
        }
        const zipBlob = await zip.generateAsync({ type: "blob" });
        downloadBlob(zipBlob, `${name}-pages.zip`);
      }

      if (loaded && loaded.file === workingFile) {
        setStatus(`Done — rendered ${pageCount} page${pageCount === 1 ? "" : "s"}.`, "success");
      }
    } catch (err) {
      console.error(err);
      if (loaded && loaded.file === workingFile) {
        setStatus("Could not convert this PDF.", "error");
      }
    } finally {
      busy = false;
      renderLoaded();
    }
  });

  renderLoaded();
})();
