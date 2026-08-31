(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const fileListEl = document.getElementById("file-list");
  const emptyNote = document.getElementById("empty-note");
  const exportPanel = document.getElementById("export-panel");
  const pageSizeSelect = document.getElementById("page-size");
  const exportBtn = document.getElementById("export-btn");
  const clearBtn = document.getElementById("clear-btn");
  const statusEl = document.getElementById("status");

  const PAGE_SIZES = {
    a4: { width: 595.28, height: 841.89 },
    letter: { width: 612, height: 792 },
  };

  const RENDER_SCALE = 2;

  /** @type {{ file: File, sheetCount: number } | null} */
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
      exportPanel.hidden = true;
      clearBtn.disabled = true;
      return;
    }
    emptyNote.hidden = true;
    exportPanel.hidden = false;
    clearBtn.disabled = busy;
    exportBtn.disabled = busy;

    const li = document.createElement("li");
    li.className = "file-strip";
    li.innerHTML = `
      <span class="name"></span>
      <span class="meta">${loaded.sheetCount} sheet${loaded.sheetCount === 1 ? "" : "s"} &middot; ${formatSize(loaded.file.size)}</span>
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
      const workbook = XLSX.read(bytes, { type: "array" });
      loaded = { file, sheetCount: workbook.SheetNames.length };
      renderLoaded();
    } catch (err) {
      console.error(err);
      loaded = null;
      renderLoaded();
      setStatus("Could not read this file. Check it's a valid .xlsx / .xls spreadsheet.", "error");
    }
  }

  function isSpreadsheetFile(file) {
    return /\.xlsx?$/i.test(file.name);
  }

  function addFiles(fileListArg) {
    if (busy) return;
    const incoming = Array.from(fileListArg).filter(isSpreadsheetFile);
    if (incoming.length === 0) return;
    const notice =
      incoming.length > 1 ? `Using ${incoming[0].name} — this tool takes one file at a time.` : "";
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

  function escapeHtml(s) {
    return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
  }

  function sheetPageHtml(sheetName, tableHtml) {
    // #content is display:inline-block so it shrink-wraps to the table's
    // actual width — a plain <body> is a block box that always fills its
    // containing block (the off-screen iframe's full width), so measuring
    // body.scrollWidth would report the iframe's width, not the content's.
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      body { margin: 0; background: #fff; font-family: -apple-system, "Segoe UI", Arial, sans-serif; }
      #content { display: inline-block; padding: 16px; }
      h2 { font-size: 15px; margin: 0 0 10px; color: #111; }
      table { border-collapse: collapse; }
      td, th { border: 1px solid #999; padding: 3px 7px; font-size: 10.5px; white-space: nowrap; color: #111; }
    </style></head><body><div id="content"><h2>${escapeHtml(sheetName)}</h2>${tableHtml}</div></body></html>`;
  }

  function waitForImages(doc) {
    const imgs = Array.from(doc.images || []);
    return Promise.all(
      imgs.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
        });
      })
    );
  }

  // Renders one sheet's HTML table inside a sandboxed, off-screen iframe and
  // rasterizes it to a canvas. sandbox="allow-same-origin" (no
  // "allow-scripts") means the document is readable by html2canvas but no
  // script in it ever runs — defense in depth even though our own generated
  // markup only carries escaped cell text, in case a cell's own content
  // (copied from elsewhere into the spreadsheet) tries to look like markup.
  async function renderSheetToCanvas(html) {
    const iframe = document.createElement("iframe");
    iframe.sandbox = "allow-same-origin";
    iframe.style.position = "fixed";
    iframe.style.top = "-10000px";
    iframe.style.left = "-10000px";
    // Generous off-screen width so no column wraps or clips; the real
    // content width is measured below and used for the actual capture.
    iframe.style.width = "4000px";
    iframe.style.height = "0px";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    try {
      const doc = iframe.contentDocument;
      doc.open();
      doc.write(html);
      doc.close();
      await waitForImages(doc);

      const contentEl = doc.getElementById("content");
      const contentWidth = Math.max(contentEl.scrollWidth, 1);
      const contentHeight = Math.max(contentEl.scrollHeight, 1);
      iframe.style.width = `${contentWidth}px`;
      iframe.style.height = `${contentHeight}px`;

      return await html2canvas(contentEl, {
        width: contentWidth,
        windowWidth: contentWidth,
        height: contentHeight,
        windowHeight: contentHeight,
        scale: RENDER_SCALE,
        backgroundColor: "#ffffff",
        useCORS: true,
      });
    } finally {
      iframe.remove();
    }
  }

  // Slices one sheet's canvas into page-height chunks and appends them to
  // an already-open jsPDF document. `pageState.isFirstPage` tracks whether
  // jsPDF's automatically-created first page is still unused across the
  // whole multi-sheet document (jsPDF creates page 1 on construction; every
  // slice after that needs an explicit addPage()).
  function appendCanvasAsPages(pdf, canvas, pageSize, pageState) {
    const pdfWidth = pageSize.width;
    const pdfHeight = pageSize.height;
    const ratio = pdfWidth / canvas.width;
    const sliceHeightPx = Math.max(1, Math.floor(pdfHeight / ratio));
    let renderedPx = 0;

    while (renderedPx < canvas.height) {
      const thisSliceHeight = Math.min(sliceHeightPx, canvas.height - renderedPx);
      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = thisSliceHeight;
      const ctx = sliceCanvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      ctx.drawImage(canvas, 0, renderedPx, canvas.width, thisSliceHeight, 0, 0, canvas.width, thisSliceHeight);

      if (!pageState.isFirstPage) pdf.addPage([pdfWidth, pdfHeight]);
      pageState.isFirstPage = false;

      const imgData = sliceCanvas.toDataURL("image/jpeg", 0.92);
      pdf.addImage(imgData, "JPEG", 0, 0, pdfWidth, thisSliceHeight * ratio);

      renderedPx += thisSliceHeight;
    }
  }

  exportBtn.addEventListener("click", async () => {
    if (!loaded || busy) return;
    const workingFile = loaded.file;
    busy = true;
    exportBtn.disabled = true;
    clearBtn.disabled = true;
    setStatus("Reading spreadsheet…");

    try {
      const bytes = await workingFile.arrayBuffer();
      const workbook = XLSX.read(bytes, { type: "array" });
      const pageSize = PAGE_SIZES[pageSizeSelect.value] || PAGE_SIZES.a4;
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: [pageSize.width, pageSize.height] });
      const pageState = { isFirstPage: true };

      for (const sheetName of workbook.SheetNames) {
        setStatus(`Rendering sheet "${sheetName}"…`);
        const worksheet = workbook.Sheets[sheetName];
        const tableHtml = XLSX.utils.sheet_to_html(worksheet, { id: "sheet-table" });
        const html = sheetPageHtml(sheetName, tableHtml);
        const canvas = await renderSheetToCanvas(html);
        appendCanvasAsPages(pdf, canvas, pageSize, pageState);
      }

      downloadBlob(pdf.output("blob"), `${baseName(workingFile.name)}.pdf`);

      if (loaded && loaded.file === workingFile) {
        setStatus(`Done — converted ${workbook.SheetNames.length} sheet${workbook.SheetNames.length === 1 ? "" : "s"}.`, "success");
      }
    } catch (err) {
      console.error(err);
      if (loaded && loaded.file === workingFile) {
        setStatus("Could not convert this spreadsheet.", "error");
      }
    } finally {
      busy = false;
      renderLoaded();
    }
  });

  renderLoaded();
})();
