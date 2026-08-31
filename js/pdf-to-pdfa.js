(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const fileListEl = document.getElementById("file-list");
  const emptyNote = document.getElementById("empty-note");
  const exportPanel = document.getElementById("export-panel");
  const exportBtn = document.getElementById("export-btn");
  const clearBtn = document.getElementById("clear-btn");
  const statusEl = document.getElementById("status");

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
      const pdfDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      loaded = { file, pageCount: pdfDoc.getPageCount() };
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

  // Best-effort embedded-font check, not a full PDF/A font audit: walks each
  // page's /Font resources and looks for a FontDescriptor with an embedded
  // font program (FontFile / FontFile2 / FontFile3). A font we can't
  // resolve (unexpected structure) is treated as "embedded" so this only
  // ever under-reports problems, never invents false ones.
  function findNonEmbeddedFonts(pdfDoc) {
    const { PDFName, PDFDict, PDFRef, PDFArray } = PDFLib;
    const context = pdfDoc.context;
    const nonEmbedded = new Set();

    const resolve = (obj) => (obj instanceof PDFRef ? context.lookup(obj) : obj);

    function hasFontFile(descriptor) {
      return (
        descriptor.has(PDFName.of("FontFile")) ||
        descriptor.has(PDFName.of("FontFile2")) ||
        descriptor.has(PDFName.of("FontFile3"))
      );
    }

    // A simple font (Type1 / TrueType / MMType1) embeds its program via a
    // FontDescriptor directly on the font dict — no FontDescriptor at all
    // (e.g. any of the "Standard 14" fonts like Helvetica, referenced by
    // name only) reliably means "not embedded", not "unknown". Only Type0
    // (composite) fonts keep their descriptor one level down, on the single
    // entry in DescendantFonts.
    function fontIsEmbedded(fontDict) {
      const subtype = fontDict.get(PDFName.of("Subtype"));
      if (subtype && subtype.toString() === "/Type0") {
        const descendants = resolve(fontDict.get(PDFName.of("DescendantFonts")));
        if (!(descendants instanceof PDFArray) || descendants.size() === 0) return true; // unexpected shape — can't tell
        const descendant = resolve(descendants.get(0));
        if (!(descendant instanceof PDFDict)) return true;
        const descriptor = resolve(descendant.get(PDFName.of("FontDescriptor")));
        return descriptor instanceof PDFDict && hasFontFile(descriptor);
      }
      const descriptor = resolve(fontDict.get(PDFName.of("FontDescriptor")));
      return descriptor instanceof PDFDict && hasFontFile(descriptor);
    }

    for (const page of pdfDoc.getPages()) {
      try {
        const resources = page.node.Resources();
        if (!(resources instanceof PDFDict)) continue;
        const fonts = resolve(resources.get(PDFName.of("Font")));
        if (!(fonts instanceof PDFDict)) continue;
        for (const [nameObj, fontRef] of fonts.entries()) {
          const fontDict = resolve(fontRef);
          if (!(fontDict instanceof PDFDict)) continue;
          const baseFontObj = fontDict.get(PDFName.of("BaseFont"));
          const label = baseFontObj ? baseFontObj.toString().replace(/^\//, "") : nameObj.toString();
          if (!fontIsEmbedded(fontDict)) nonEmbedded.add(label);
        }
      } catch (err) {
        console.warn("Font check skipped for a page:", err);
      }
    }

    return Array.from(nonEmbedded);
  }

  function buildXmpMetadata({ title }) {
    const escapedTitle = (title || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
    return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdfaid:part>1</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapedTitle}</rdf:li></rdf:Alt></dc:title>
      <pdf:Producer>PDF Desk (best-effort PDF/A-style export)</pdf:Producer>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  }

  function attachXmpMetadata(pdfDoc, xml) {
    const { PDFName } = PDFLib;
    const stream = pdfDoc.context.stream(xml, {
      Type: "Metadata",
      Subtype: "XML",
      Length: xml.length,
    });
    const ref = pdfDoc.context.register(stream);
    pdfDoc.catalog.set(PDFName.of("Metadata"), ref);
  }

  exportBtn.addEventListener("click", async () => {
    if (!loaded || busy) return;
    const workingFile = loaded.file;
    busy = true;
    exportBtn.disabled = true;
    clearBtn.disabled = true;
    setStatus("Exporting…");

    try {
      const bytes = await workingFile.arrayBuffer();
      // Loading + re-saving through pdf-lib always yields an unencrypted
      // file — pdf-lib has no writer support for PDF encryption at all —
      // so no separate "strip encryption" step is needed beyond this load.
      const pdfDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });

      const title = pdfDoc.getTitle() || baseName(workingFile.name);
      // Producer/ModDate aren't set via pdfDoc.setProducer/setModificationDate
      // here: pdf-lib's save() unconditionally overwrites both info-dict
      // fields with its own library string and the current time, no matter
      // what they're set to beforehand — so the XMP block's own pdf:Producer
      // field (independent of pdf-lib's info dict) is the one that sticks.
      attachXmpMetadata(pdfDoc, buildXmpMetadata({ title }));

      const nonEmbedded = findNonEmbeddedFonts(pdfDoc);
      const outBytes = await pdfDoc.save();
      downloadBlob(new Blob([outBytes], { type: "application/pdf" }), `${baseName(workingFile.name)}-pdfa-style.pdf`);

      if (loaded && loaded.file === workingFile) {
        if (nonEmbedded.length === 0) {
          setStatus("Done — exported. All fonts appear embedded, but this is not a validated PDF/A file.", "success");
        } else {
          const list = nonEmbedded.slice(0, 3).join(", ") + (nonEmbedded.length > 3 ? `, +${nonEmbedded.length - 3} more` : "");
          setStatus(`Done — exported, but ${nonEmbedded.length} font(s) aren't embedded (${list}). Not PDF/A compliant.`, "error");
        }
      }
    } catch (err) {
      console.error(err);
      if (loaded && loaded.file === workingFile) {
        setStatus("Could not export this PDF.", "error");
      }
    } finally {
      busy = false;
      renderLoaded();
    }
  });

  renderLoaded();
})();
