(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const fileListEl = document.getElementById("file-list");
  const emptyNote = document.getElementById("empty-note");
  const splitPanel = document.getElementById("split-panel");
  const rangeInput = document.getElementById("range-input");
  const rangeHint = document.getElementById("range-hint");
  const extractBtn = document.getElementById("extract-btn");
  const splitAllBtn = document.getElementById("split-all-btn");
  const clearBtn = document.getElementById("clear-btn");
  const statusEl = document.getElementById("status");

  /** @type {{ file: File, pageCount: number } | null} */
  let loaded = null;

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status-line" + (kind ? ` ${kind}` : "");
  }

  function setRangeHint(text, kind) {
    rangeHint.textContent = text;
    rangeHint.className = "field-hint" + (kind ? ` ${kind}` : "");
  }

  function iconSvg(path) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  }

  const REMOVE_ICON = iconSvg('<path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14" />');

  function renderLoaded() {
    fileListEl.innerHTML = "";
    if (!loaded) {
      emptyNote.hidden = false;
      splitPanel.hidden = true;
      clearBtn.disabled = true;
      return;
    }
    emptyNote.hidden = true;
    splitPanel.hidden = false;
    clearBtn.disabled = false;

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

  async function loadFile(file) {
    setStatus("");
    setRangeHint("");
    try {
      const bytes = await file.arrayBuffer();
      const pdfDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      loaded = { file, pageCount: pdfDoc.getPageCount() };
      rangeInput.value = "";
      renderLoaded();
    } catch (err) {
      console.error(err);
      loaded = null;
      renderLoaded();
      setStatus("Could not read this PDF. Check it isn't corrupted or password-protected.", "error");
    }
  }

  function addFiles(fileListArg) {
    const incoming = Array.from(fileListArg).filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (incoming.length === 0) return;
    loadFile(incoming[0]);
  }

  fileListEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".icon-btn");
    if (!btn) return;
    if (btn.dataset.action === "remove") {
      loaded = null;
      renderLoaded();
      setStatus("");
    }
  });

  clearBtn.addEventListener("click", () => {
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

  function parsePageRanges(input, maxPage) {
    const parts = input.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) throw new Error("Enter at least one page number.");

    const seen = new Set();
    const indices = [];
    const addPage = (p) => {
      if (p < 1 || p > maxPage) throw new Error(`Page ${p} is out of range (1–${maxPage}).`);
      const idx = p - 1;
      if (!seen.has(idx)) {
        seen.add(idx);
        indices.push(idx);
      }
    };

    for (const part of parts) {
      const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (rangeMatch) {
        let a = Number(rangeMatch[1]);
        let b = Number(rangeMatch[2]);
        if (a > b) [a, b] = [b, a];
        for (let p = a; p <= b; p++) addPage(p);
      } else if (/^\d+$/.test(part)) {
        addPage(Number(part));
      } else {
        throw new Error(`"${part}" is not a valid page or range.`);
      }
    }
    return indices;
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

  extractBtn.addEventListener("click", async () => {
    if (!loaded) return;
    let indices;
    try {
      indices = parsePageRanges(rangeInput.value, loaded.pageCount);
      setRangeHint("");
    } catch (err) {
      setRangeHint(err.message, "error");
      return;
    }

    extractBtn.disabled = true;
    setStatus("Extracting…");
    try {
      const bytes = await loaded.file.arrayBuffer();
      const sourcePdf = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      const outPdf = await PDFLib.PDFDocument.create();
      const copiedPages = await outPdf.copyPages(sourcePdf, indices);
      copiedPages.forEach((page) => outPdf.addPage(page));
      const outBytes = await outPdf.save();
      downloadBlob(new Blob([outBytes], { type: "application/pdf" }), "extracted.pdf");
      setStatus(`Done — extracted ${indices.length} page${indices.length === 1 ? "" : "s"}.`, "success");
    } catch (err) {
      console.error(err);
      setStatus("Could not extract those pages.", "error");
    } finally {
      extractBtn.disabled = false;
    }
  });

  splitAllBtn.addEventListener("click", async () => {
    if (!loaded) return;
    splitAllBtn.disabled = true;
    setStatus("Splitting…");
    try {
      const bytes = await loaded.file.arrayBuffer();
      const sourcePdf = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      const pageCount = sourcePdf.getPageCount();
      const zip = new JSZip();
      const padWidth = String(pageCount).length;

      for (let i = 0; i < pageCount; i++) {
        const outPdf = await PDFLib.PDFDocument.create();
        const [page] = await outPdf.copyPages(sourcePdf, [i]);
        outPdf.addPage(page);
        const outBytes = await outPdf.save();
        const pageLabel = String(i + 1).padStart(padWidth, "0");
        zip.file(`page-${pageLabel}.pdf`, outBytes);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      downloadBlob(zipBlob, "split-pages.zip");
      setStatus(`Done — split into ${pageCount} files.`, "success");
    } catch (err) {
      console.error(err);
      setStatus("Could not split this PDF.", "error");
    } finally {
      splitAllBtn.disabled = false;
    }
  });

  renderLoaded();
})();
