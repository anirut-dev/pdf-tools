(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const fileListEl = document.getElementById("file-list");
  const emptyNote = document.getElementById("empty-note");
  const mergeBtn = document.getElementById("merge-btn");
  const clearBtn = document.getElementById("clear-btn");
  const statusEl = document.getElementById("status");

  /** @type {{ id: number, file: File }[]} */
  let files = [];
  let nextId = 1;

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
    const incoming = Array.from(fileListArg).filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (incoming.length === 0) return;
    for (const file of incoming) {
      files.push({ id: nextId++, file });
    }
    setStatus("");
    render();
  }

  function removeFile(id) {
    files = files.filter((f) => f.id !== id);
    render();
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
        <span class="name" title="${entry.file.name}">${entry.file.name}</span>
        <span class="meta">${formatSize(entry.file.size)}</span>
        <span class="actions">
          <button class="icon-btn" data-action="up" data-id="${entry.id}" ${index === 0 ? "disabled" : ""} aria-label="Move up">${ICONS.up}</button>
          <button class="icon-btn" data-action="down" data-id="${entry.id}" ${index === files.length - 1 ? "disabled" : ""} aria-label="Move down">${ICONS.down}</button>
          <button class="icon-btn danger" data-action="remove" data-id="${entry.id}" aria-label="Remove">${ICONS.remove}</button>
        </span>
      `;
      fileListEl.appendChild(li);
    });

    const ready = files.length >= 2;
    mergeBtn.disabled = !ready;
    clearBtn.disabled = files.length === 0;
    if (files.length === 1) {
      setStatus("Add at least one more file to merge.");
    }
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
    files = [];
    setStatus("");
    render();
  });

  fileInput.addEventListener("change", (e) => {
    addFiles(e.target.files);
    fileInput.value = "";
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

  mergeBtn.addEventListener("click", async () => {
    if (files.length < 2) return;
    mergeBtn.disabled = true;
    clearBtn.disabled = true;
    setStatus("Merging…");

    try {
      const { PDFDocument } = PDFLib;
      const mergedPdf = await PDFDocument.create();

      for (const entry of files) {
        const bytes = await entry.file.arrayBuffer();
        const sourcePdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pageIndices = sourcePdf.getPageIndices();
        const copiedPages = await mergedPdf.copyPages(sourcePdf, pageIndices);
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      }

      const mergedBytes = await mergedPdf.save();
      const blob = new Blob([mergedBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "merged.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setStatus(`Done — merged ${files.length} files.`, "success");
    } catch (err) {
      console.error(err);
      setStatus("Could not merge these files. Check they are valid PDFs.", "error");
    } finally {
      clearBtn.disabled = files.length === 0;
      mergeBtn.disabled = files.length < 2;
    }
  });

  render();
})();
