(() => {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const htmlInput = document.getElementById("html-input");
  const pageSizeSelect = document.getElementById("page-size");
  const convertBtn = document.getElementById("convert-btn");
  const clearBtn = document.getElementById("clear-btn");
  const statusEl = document.getElementById("status");

  const PAGE_SIZES = {
    a4: { width: 595.28, height: 841.89 },
    letter: { width: 612, height: 792 },
  };

  const RENDER_WIDTH_PX = 900; // fixed layout width for the hidden render frame
  const RENDER_SCALE = 2; // sharper output, same idea as the PDF -> JPG tool

  let busy = false;

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status-line" + (kind ? ` ${kind}` : "");
  }

  function refreshButtons() {
    const hasContent = htmlInput.value.trim().length > 0;
    convertBtn.disabled = !hasContent || busy;
    clearBtn.disabled = !hasContent || busy;
  }

  function isHtmlFile(file) {
    return file.type === "text/html" || /\.html?$/i.test(file.name);
  }

  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      htmlInput.value = String(reader.result || "");
      setStatus("");
      refreshButtons();
    };
    reader.onerror = () => {
      setStatus("Could not read that file.", "error");
    };
    reader.readAsText(file);
  }

  function addFiles(fileListArg) {
    if (busy) return;
    const incoming = Array.from(fileListArg).filter(isHtmlFile);
    if (incoming.length === 0) return;
    loadFile(incoming[0]);
  }

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

  htmlInput.addEventListener("input", () => {
    setStatus("");
    refreshButtons();
  });

  clearBtn.addEventListener("click", () => {
    if (busy) return;
    htmlInput.value = "";
    setStatus("");
    refreshButtons();
  });

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

  // Renders the user's HTML inside a sandboxed, off-screen iframe.
  // sandbox="allow-same-origin" (no "allow-scripts") means the iframe's
  // document is readable by html2canvas but *no script in it ever runs* —
  // <script> tags, inline event handlers (onerror, onload, ...), and
  // javascript: URLs are all inert under this sandbox flag set. This is a
  // rendering surface for untrusted HTML, not a page that executes it.
  async function renderInSandboxedFrame(html) {
    const iframe = document.createElement("iframe");
    iframe.sandbox = "allow-same-origin";
    iframe.style.position = "fixed";
    iframe.style.top = "-10000px";
    iframe.style.left = "-10000px";
    iframe.style.width = `${RENDER_WIDTH_PX}px`;
    iframe.style.height = "0px";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    try {
      // No src is set, so the iframe already has its default about:blank
      // document — contentDocument is available synchronously right after
      // insertion. (A prior version set iframe.src = "about:blank" and
      // waited for a "load" event to write into it — but browsers don't
      // fire "load" again when src is set to the URL it's already at, so
      // that write never ran and every conversion hung forever.)
      const doc = iframe.contentDocument;
      doc.open();
      doc.write(html);
      doc.close();
      // Wait for any images to finish decoding. (Not requestAnimationFrame —
      // Chrome pauses rAF entirely on a hidden/background tab, which would
      // stall the whole conversion if the user switches tabs while it runs.
      // Layout itself doesn't need a wait: reading scrollHeight below forces
      // a synchronous reflow regardless of paint timing.)
      await waitForImages(doc);
      const contentHeight = Math.max(
        doc.documentElement.scrollHeight,
        doc.body ? doc.body.scrollHeight : 0,
        1
      );
      iframe.style.height = `${contentHeight}px`;
      return { iframe, doc, contentHeight };
    } catch (err) {
      iframe.remove();
      throw err;
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

  async function buildPdfFromCanvas(canvas, pageSize) {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: [pageSize.width, pageSize.height] });
    const pdfWidth = pageSize.width;
    const pdfHeight = pageSize.height;
    const ratio = pdfWidth / canvas.width;
    const scaledHeight = canvas.height * ratio;

    if (scaledHeight <= pdfHeight) {
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      pdf.addImage(imgData, "JPEG", 0, 0, pdfWidth, scaledHeight);
      return pdf;
    }

    // Longer than one page: slice the source canvas into page-height chunks
    // (measured in source-canvas pixels) and add one PDF page per chunk.
    const sliceHeightPx = Math.floor(pdfHeight / ratio);
    let renderedPx = 0;
    let pageIndex = 0;

    while (renderedPx < canvas.height) {
      const thisSliceHeight = Math.min(sliceHeightPx, canvas.height - renderedPx);
      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = thisSliceHeight;
      const ctx = sliceCanvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      ctx.drawImage(canvas, 0, renderedPx, canvas.width, thisSliceHeight, 0, 0, canvas.width, thisSliceHeight);

      if (pageIndex > 0) pdf.addPage([pdfWidth, pdfHeight]);
      const imgData = sliceCanvas.toDataURL("image/jpeg", 0.92);
      pdf.addImage(imgData, "JPEG", 0, 0, pdfWidth, thisSliceHeight * ratio);

      renderedPx += thisSliceHeight;
      pageIndex++;
    }

    return pdf;
  }

  convertBtn.addEventListener("click", async () => {
    const html = htmlInput.value;
    if (!html.trim() || busy) return;
    busy = true;
    convertBtn.disabled = true;
    clearBtn.disabled = true;
    setStatus("Rendering…");

    let iframe;
    try {
      const rendered = await renderInSandboxedFrame(html);
      iframe = rendered.iframe;
      const canvas = await html2canvas(rendered.doc.body, {
        width: RENDER_WIDTH_PX,
        windowWidth: RENDER_WIDTH_PX,
        height: rendered.contentHeight,
        windowHeight: rendered.contentHeight,
        scale: RENDER_SCALE,
        backgroundColor: "#ffffff",
        useCORS: true,
      });

      setStatus("Building PDF…");
      const pageSize = PAGE_SIZES[pageSizeSelect.value] || PAGE_SIZES.a4;
      const pdf = await buildPdfFromCanvas(canvas, pageSize);
      downloadBlob(pdf.output("blob"), "converted.pdf");
      setStatus("Done — PDF downloaded.", "success");
    } catch (err) {
      console.error(err);
      setStatus("Could not render this HTML.", "error");
    } finally {
      if (iframe) iframe.remove();
      busy = false;
      refreshButtons();
    }
  });

  refreshButtons();
})();
