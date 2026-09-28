(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const els = {
    fileInput:$("htmlFileInput"),
    newBtn:$("newBtn"),
    undo:$("undoBtn"),
    redo:$("redoBtn"),
    download:$("downloadBtn"),
    frame:$("previewFrame"),
    frameShell:$("frameShell"),
    stage:$("stage"),
    fileName:$("fileName"),
    selectedSummary:$("selectedSummary"),
    breadcrumb:$("breadcrumb"),
    status:$("statusText"),
    changeState:$("changeState"),
    elementPath:$("elementPath"),
    tagBadge:$("tagBadge"),
    editText:$("editTextBtn"),
    duplicate:$("duplicateBtn"),
    moveUp:$("moveUpBtn"),
    moveDown:$("moveDownBtn"),
    deleteBtn:$("deleteBtn"),
    textSection:$("textSection"),
    textContent:$("textContent"),
    attrId:$("attrId"),
    attrClass:$("attrClass"),
    hrefRow:$("hrefRow"),
    attrHref:$("attrHref"),
    srcRow:$("srcRow"),
    attrSrc:$("attrSrc"),
    altRow:$("altRow"),
    attrAlt:$("attrAlt"),
    imageUploadRow:$("imageUploadRow"),
    imageFile:$("imageFileInput"),
    width:$("styleWidth"),
    height:$("styleHeight"),
    margin:$("styleMargin"),
    padding:$("stylePadding"),
    fontSize:$("styleFontSize"),
    fontWeight:$("styleFontWeight"),
    color:$("styleColor"),
    background:$("styleBackground"),
    textAlign:$("styleTextAlign"),
    border:$("styleBorder"),
    radius:$("styleRadius"),
    rawStyle:$("rawStyle"),
    applyRawStyle:$("applyRawStyleBtn"),
    toastRoot:$("toastRoot")
  };

  const TEXT_TAGS = new Set(["H1","H2","H3","H4","H5","H6","P","SPAN","A","BUTTON","LI","LABEL","STRONG","EM","SMALL","BLOCKQUOTE","TD","TH"]);
  const BLOCKED_SELECT = new Set(["HTML","HEAD","SCRIPT","STYLE","META","LINK","TITLE"]);
  const MAX_HISTORY = 60;

  let selected = null;
  let fileName = "새 문서.html";
  let insertMode = "inside";
  let history = [];
  let historyIndex = -1;
  let restoring = false;
  let dirty = false;
  let editSession = null;

  const starterHtml = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>새 문서</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2937;background:#f8fafc}
    main{max-width:900px;margin:0 auto;padding:72px 24px}
    .hero{padding:48px;border-radius:24px;background:#fff;border:1px solid #e5e7eb;box-shadow:0 16px 48px rgba(15,23,42,.08)}
    h1{font-size:42px;margin:0 0 16px}
    p{font-size:18px;line-height:1.7;color:#64748b}
    .btn{display:inline-block;margin-top:16px;padding:12px 18px;border-radius:10px;background:#3157d5;color:white;text-decoration:none}
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <h1>화면에서 바로 수정하세요</h1>
      <p>요소를 클릭해 선택하고, 더블클릭하면 텍스트를 직접 편집할 수 있습니다.</p>
      <a class="btn" href="#">버튼 예시</a>
    </section>
  </main>
</body>
</html>`;

  function toast(message, type="") {
    const node = document.createElement("div");
    node.className = "toast " + type;
    node.textContent = message;
    els.toastRoot.appendChild(node);
    setTimeout(() => node.remove(), 2800);
  }

  function setStatus(message) {
    els.status.textContent = message;
  }

  function markDirty(value=true) {
    dirty = value;
    els.changeState.textContent = dirty ? "수정됨" : "저장됨";
  }

  function frameDoc() {
    return els.frame.contentDocument;
  }

  function cleanClone(doc=frameDoc()) {
    if (!doc?.documentElement) return "";
    const clone = doc.documentElement.cloneNode(true);
    clone.querySelectorAll("[data-htmledit-selected]").forEach(el => el.removeAttribute("data-htmledit-selected"));
    clone.querySelectorAll("[data-htmledit-runtime]").forEach(el => el.remove());
    clone.querySelectorAll("[contenteditable]").forEach(el => el.removeAttribute("contenteditable"));
    return "<!doctype html>\n" + clone.outerHTML;
  }

  function snapshot(push=true) {
    if (restoring) return;
    const html = cleanClone();
    if (!html) return;
    if (push) {
      history = history.slice(0, historyIndex + 1);
      if (history[history.length - 1] !== html) {
        history.push(html);
        if (history.length > MAX_HISTORY) history.shift();
        historyIndex = history.length - 1;
      }
    }
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    els.undo.disabled = historyIndex <= 0;
    els.redo.disabled = historyIndex < 0 || historyIndex >= history.length - 1;
  }

  function loadHtml(html, name=fileName, {resetHistory=true}={}) {
    selected = null;
    fileName = name || "document.html";
    els.fileName.textContent = fileName;
    restoring = true;

    const onLoad = () => {
      els.frame.removeEventListener("load", onLoad);
      installEditorHooks();
      restoring = false;
      if (resetHistory) {
        history = [];
        historyIndex = -1;
        snapshot(true);
      }
      selectElement(frameDoc().body);
      markDirty(false);
      setStatus("요소를 클릭해 선택하세요. 텍스트 요소는 더블클릭으로 바로 편집할 수 있습니다.");
    };
    els.frame.addEventListener("load", onLoad);
    els.frame.srcdoc = html;
  }

  function installEditorHooks() {
    const doc = frameDoc();
    if (!doc) return;

    const style = doc.createElement("style");
    style.setAttribute("data-htmledit-runtime", "true");
    style.textContent = `
      [data-htmledit-selected="true"]{
        outline:2px solid #3157d5!important;
        outline-offset:2px!important;
      }
      [contenteditable="true"]{
        cursor:text!important;
      }
    `;
    (doc.head || doc.documentElement).appendChild(style);

    doc.addEventListener("click", event => {
      const target = normalizeTarget(event.target);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      selectElement(target);
    }, true);

    doc.addEventListener("dblclick", event => {
      const target = normalizeTarget(event.target);
      if (!target || !TEXT_TAGS.has(target.tagName)) return;
      event.preventDefault();
      event.stopPropagation();
      beginInlineEdit(target);
    }, true);

    doc.addEventListener("submit", event => event.preventDefault(), true);
    doc.addEventListener("dragstart", event => event.preventDefault(), true);
  }

  function normalizeTarget(target) {
    if (!(target instanceof frameDoc().defaultView.Element)) return null;
    if (target.hasAttribute("data-htmledit-runtime")) return null;
    if (BLOCKED_SELECT.has(target.tagName)) return target.closest("body") || frameDoc().body;
    return target;
  }

  function elementPath(el) {
    if (!el) return "";
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node.tagName !== "HTML") {
      let name = node.tagName.toLowerCase();
      if (node.id) name += "#" + node.id;
      else if (node.classList.length) name += "." + [...node.classList].slice(0,2).join(".");
      parts.unshift(name);
      if (node.tagName === "BODY") break;
      node = node.parentElement;
    }
    return parts.join(" › ");
  }

  function selectElement(el) {
    if (!el) return;
    if (editSession && editSession !== el) finishInlineEdit(editSession);

    const doc = frameDoc();
    doc?.querySelectorAll("[data-htmledit-selected]").forEach(node => node.removeAttribute("data-htmledit-selected"));
    selected = el;
    selected.setAttribute("data-htmledit-selected", "true");

    const path = elementPath(selected);
    els.selectedSummary.textContent = selected.tagName;
    els.breadcrumb.textContent = path;
    els.elementPath.textContent = path;
    els.tagBadge.textContent = selected.tagName;
    populateInspector();
  }

  function populateInspector() {
    if (!selected) return;
    const textEditable = TEXT_TAGS.has(selected.tagName);
    els.textSection.classList.toggle("hidden", !textEditable);
    els.textContent.disabled = !textEditable;
    els.textContent.value = textEditable ? selected.textContent : "";

    els.attrId.value = selected.id || "";
    els.attrClass.value = selected.className || "";

    const isLink = selected.tagName === "A";
    const isImage = selected.tagName === "IMG";
    els.hrefRow.classList.toggle("hidden", !isLink);
    els.srcRow.classList.toggle("hidden", !isImage);
    els.altRow.classList.toggle("hidden", !isImage);
    els.imageUploadRow.classList.toggle("hidden", !isImage);

    els.attrHref.value = isLink ? (selected.getAttribute("href") || "") : "";
    els.attrSrc.value = isImage ? (selected.getAttribute("src") || "") : "";
    els.attrAlt.value = isImage ? (selected.getAttribute("alt") || "") : "";

    const style = selected.style;
    els.width.value = style.width || "";
    els.height.value = style.height || "";
    els.margin.value = style.margin || "";
    els.padding.value = style.padding || "";
    els.fontSize.value = style.fontSize || "";
    els.fontWeight.value = style.fontWeight || "";
    els.color.value = style.color || "";
    els.background.value = style.background || style.backgroundColor || "";
    els.textAlign.value = style.textAlign || "";
    els.border.value = style.border || "";
    els.radius.value = style.borderRadius || "";
    els.rawStyle.value = selected.getAttribute("style") || "";

    const protectedNode = ["BODY","HTML"].includes(selected.tagName);
    els.deleteBtn.disabled = protectedNode;
    els.moveUp.disabled = protectedNode;
    els.moveDown.disabled = protectedNode;
    els.duplicate.disabled = protectedNode;
  }

  function commit(label="변경") {
    markDirty(true);
    snapshot(true);
    setStatus(label + " · HTML 저장 버튼으로 파일을 내려받을 수 있습니다.");
    populateInspector();
  }

  function beginInlineEdit(el=selected) {
    if (!el || !TEXT_TAGS.has(el.tagName)) {
      toast("텍스트 요소를 선택해주세요.", "error");
      return;
    }
    if (editSession && editSession !== el) finishInlineEdit(editSession);
    editSession = el;
    el.setAttribute("contenteditable", "true");
    el.focus();

    const doc = frameDoc();
    const selection = doc.getSelection();
    const range = doc.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);

    const finish = () => finishInlineEdit(el);
    el.addEventListener("blur", finish, {once:true});
    el.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        el.blur();
      }
    });
    toast("화면에서 텍스트를 직접 입력할 수 있습니다.", "ok");
  }

  function finishInlineEdit(el) {
    if (!el || el !== editSession) return;
    el.removeAttribute("contenteditable");
    editSession = null;
    commit("텍스트 수정");
  }

  function createElement(type) {
    const doc = frameDoc();
    if (!doc) return null;
    let el;

    if (type === "card") {
      el = doc.createElement("section");
      el.innerHTML = "<h2>새 카드</h2><p>이 내용을 클릭해서 수정하세요.</p>";
      el.style.cssText = "padding:24px;margin:16px 0;border:1px solid #e5e7eb;border-radius:16px;background:#ffffff;";
      return el;
    }

    el = doc.createElement(type);
    const presets = {
      section:["새 Section","padding:24px;min-height:80px;"],
      div:["새 Container","padding:16px;"],
      h1:["새 제목",""],
      p:["새 문단을 입력하세요.",""],
      span:["새 텍스트",""],
      a:["새 링크","display:inline-block;color:#3157d5;"],
      button:["새 버튼","padding:10px 16px;border:0;border-radius:8px;background:#3157d5;color:#fff;"],
      img:["","display:block;max-width:100%;min-height:120px;background:#eef1f5;"],
      ul:["",""],
      hr:["","border:0;border-top:1px solid #d9dee7;margin:20px 0;"]
    };
    const [text, css] = presets[type] || ["새 요소",""];
    if (type === "ul") el.innerHTML = "<li>목록 항목 1</li><li>목록 항목 2</li>";
    else if (type === "img") {
      el.setAttribute("alt","이미지를 선택하거나 URL을 입력하세요");
      el.setAttribute("src","data:image/svg+xml;charset=UTF-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="100%" height="100%" fill="#eef1f5"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="24" fill="#8490a3">Image</text></svg>'));
    } else el.textContent = text;
    if (type === "a") el.setAttribute("href","#");
    if (css) el.style.cssText = css;
    return el;
  }

  function addElement(type) {
    if (!selected) selectElement(frameDoc().body);
    const el = createElement(type);
    if (!el) return;

    if (insertMode === "after" && selected !== frameDoc().body && selected.parentElement) {
      selected.insertAdjacentElement("afterend", el);
    } else {
      selected.appendChild(el);
    }

    selectElement(el);
    commit(type + " 요소 추가");
    el.scrollIntoView({behavior:"smooth",block:"center"});
  }

  function deleteSelected() {
    if (!selected || ["BODY","HTML"].includes(selected.tagName)) return;
    const fallback = selected.parentElement;
    selected.remove();
    selectElement(fallback || frameDoc().body);
    commit("요소 삭제");
  }

  function duplicateSelected() {
    if (!selected || ["BODY","HTML"].includes(selected.tagName)) return;
    const clone = selected.cloneNode(true);
    clone.removeAttribute("data-htmledit-selected");
    selected.insertAdjacentElement("afterend", clone);
    selectElement(clone);
    commit("요소 복제");
  }

  function moveSelected(direction) {
    if (!selected || ["BODY","HTML"].includes(selected.tagName)) return;
    if (direction < 0 && selected.previousElementSibling) {
      selected.parentElement.insertBefore(selected, selected.previousElementSibling);
      commit("요소 위로 이동");
    } else if (direction > 0 && selected.nextElementSibling) {
      selected.parentElement.insertBefore(selected.nextElementSibling, selected);
      commit("요소 아래로 이동");
    }
  }

  function setAttributeValue(name, value) {
    if (!selected) return;
    if (value.trim()) selected.setAttribute(name, value.trim());
    else selected.removeAttribute(name);
    commit(name + " 속성 변경");
  }

  function setStyleValue(prop, value) {
    if (!selected) return;
    selected.style[prop] = value.trim();
    commit(prop + " 스타일 변경");
  }

  function restoreHistory(index) {
    if (index < 0 || index >= history.length) return;
    historyIndex = index;
    const html = history[historyIndex];
    loadHtml(html, fileName, {resetHistory:false});
    setTimeout(() => {
      restoring = false;
      markDirty(historyIndex > 0);
      updateHistoryButtons();
    }, 0);
  }

  function downloadHtml() {
    const html = cleanClone();
    if (!html) return;
    const blob = new Blob([html], {type:"text/html;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "edited.html";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    markDirty(false);
    toast("수정된 HTML을 저장했습니다.", "ok");
  }

  els.fileInput.addEventListener("change", async () => {
    const file = els.fileInput.files?.[0];
    if (!file) return;
    try {
      const html = await file.text();
      loadHtml(html, file.name);
      toast("HTML 파일을 불러왔습니다.", "ok");
    } catch (error) {
      console.error(error);
      toast("HTML 파일을 읽을 수 없습니다.", "error");
    }
    els.fileInput.value = "";
  });

  els.newBtn.addEventListener("click", () => {
    if (dirty && !confirm("현재 수정 내용을 버리고 새 문서를 만들까요?")) return;
    loadHtml(starterHtml, "새 문서.html");
  });

  els.download.addEventListener("click", downloadHtml);
  els.undo.addEventListener("click", () => restoreHistory(historyIndex - 1));
  els.redo.addEventListener("click", () => restoreHistory(historyIndex + 1));
  els.editText.addEventListener("click", () => beginInlineEdit());
  els.deleteBtn.addEventListener("click", deleteSelected);
  els.duplicate.addEventListener("click", duplicateSelected);
  els.moveUp.addEventListener("click", () => moveSelected(-1));
  els.moveDown.addEventListener("click", () => moveSelected(1));

  document.querySelectorAll(".device").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".device").forEach(item => item.classList.toggle("active", item === button));
      els.frameShell.style.width = button.dataset.width;
    });
  });

  document.querySelectorAll(".insert-option").forEach(button => {
    button.addEventListener("click", () => {
      insertMode = button.dataset.insert;
      document.querySelectorAll(".insert-option").forEach(item => item.classList.toggle("active", item === button));
    });
  });

  document.querySelectorAll("[data-add]").forEach(button => {
    button.addEventListener("click", () => addElement(button.dataset.add));
  });

  els.textContent.addEventListener("change", () => {
    if (!selected || !TEXT_TAGS.has(selected.tagName)) return;
    selected.textContent = els.textContent.value;
    commit("텍스트 변경");
  });
  els.attrId.addEventListener("change", () => setAttributeValue("id", els.attrId.value));
  els.attrClass.addEventListener("change", () => setAttributeValue("class", els.attrClass.value));
  els.attrHref.addEventListener("change", () => setAttributeValue("href", els.attrHref.value));
  els.attrSrc.addEventListener("change", () => setAttributeValue("src", els.attrSrc.value));
  els.attrAlt.addEventListener("change", () => setAttributeValue("alt", els.attrAlt.value));

  [
    [els.width,"width"],[els.height,"height"],[els.margin,"margin"],[els.padding,"padding"],
    [els.fontSize,"fontSize"],[els.fontWeight,"fontWeight"],[els.color,"color"],
    [els.background,"background"],[els.textAlign,"textAlign"],[els.border,"border"],[els.radius,"borderRadius"]
  ].forEach(([input, prop]) => input.addEventListener("change", () => setStyleValue(prop, input.value)));

  els.applyRawStyle.addEventListener("click", () => {
    if (!selected) return;
    selected.setAttribute("style", els.rawStyle.value.trim());
    commit("Inline Style 변경");
  });

  els.imageFile.addEventListener("change", () => {
    const file = els.imageFile.files?.[0];
    if (!file || !selected || selected.tagName !== "IMG") return;
    const reader = new FileReader();
    reader.onload = () => {
      selected.setAttribute("src", reader.result);
      els.attrSrc.value = String(reader.result).slice(0,80) + "…";
      commit("이미지 변경");
    };
    reader.readAsDataURL(file);
    els.imageFile.value = "";
  });

  window.addEventListener("keydown", event => {
    const tag = document.activeElement?.tagName;
    const editingOuter = ["INPUT","TEXTAREA","SELECT"].includes(tag);
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) restoreHistory(historyIndex + 1);
      else restoreHistory(historyIndex - 1);
      return;
    }
    if (mod && event.key.toLowerCase() === "s") {
      event.preventDefault();
      downloadHtml();
      return;
    }
    if (!editingOuter && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      deleteSelected();
    }
  });

  window.addEventListener("beforeunload", event => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  loadHtml(starterHtml, "새 문서.html");
})();
