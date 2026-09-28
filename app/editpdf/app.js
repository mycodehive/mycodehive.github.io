import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const { PDFDocument, degrees } = window.PDFLib;
const $ = id => document.getElementById(id);

const els = {
  openInput:$("openPdfInput"), emptyInput:$("emptyPdfInput"), appendInput:$("appendPdfInput"),
  save:$("savePdfBtn"), undo:$("undoBtn"), redo:$("redoBtn"),
  thumbnails:$("thumbnailList"), pageCount:$("pageCountLabel"), addBlank:$("addBlankPageBtn"),
  rotateLeft:$("rotateLeftBtn"), rotateRight:$("rotateRightBtn"), duplicatePage:$("duplicatePageBtn"), deletePage:$("deletePageBtn"),
  stage:$("stage"), empty:$("emptyState"), viewport:$("pageViewport"), pageWrap:$("pageWrap"), canvas:$("pdfCanvas"),
  textHits:$("textHitLayer"), overlays:$("overlayLayer"), drawPreview:$("drawPreview"),
  status:$("statusText"), pageStatus:$("pageStatus"), toolGroup:$("toolGroup"),
  imageInput:$("imageInput"), signatureBtn:$("signatureBtn"),
  zoomOut:$("zoomOutBtn"), zoomIn:$("zoomInBtn"), zoomLabel:$("zoomLabel"), fitWidth:$("fitWidthBtn"),
  selectionLabel:$("selectionLabel"), deleteOverlay:$("deleteOverlayBtn"),
  noSelection:$("noSelectionPanel"), inspector:$("overlayInspector"),
  textSection:$("textInspectorSection"), textValue:$("textValue"), fontSize:$("fontSizeInput"), textAlign:$("textAlignInput"),
  color:$("colorInput"), fill:$("fillInput"), opacity:$("opacityInput"), opacityValue:$("opacityValue"),
  strokeWidth:$("strokeWidthInput"), strokeWidthValue:$("strokeWidthValue"), strokeWidthRow:$("strokeWidthRow"),
  posX:$("posXInput"), posY:$("posYInput"), width:$("widthInput"), height:$("heightInput"),
  front:$("bringFrontBtn"), back:$("sendBackBtn"), replaceHint:$("replaceHintSection"),
  signatureModal:$("signatureModal"), signatureCanvas:$("signatureCanvas"),
  closeSignature:$("closeSignatureBtn"), clearSignature:$("clearSignatureBtn"), cancelSignature:$("cancelSignatureBtn"), addSignature:$("addSignatureBtn"),
  toastRoot:$("toastRoot")
};

const state = {
  sources:new Map(),
  pages:[],
  currentPageId:null,
  selectedOverlayId:null,
  tool:"select",
  zoom:1,
  history:[],
  historyIndex:-1,
  maxHistory:30,
  drag:null,
  drawing:null,
  pendingImageData:null,
  renderToken:0
};

const clone = value => structuredClone(value);
const uid = prefix => prefix + "_" + Math.random().toString(36).slice(2,9) + Date.now().toString(36);
const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
const currentPage = () => state.pages.find(p => p.id === state.currentPageId) || null;
const selectedOverlay = () => currentPage()?.overlays.find(o => o.id === state.selectedOverlayId) || null;
const normalizeRotation = value => ((value % 360) + 360) % 360;

function toast(message,type=""){
  const node=document.createElement("div");
  node.className="toast "+type;
  node.textContent=message;
  els.toastRoot.appendChild(node);
  setTimeout(()=>node.remove(),2600);
}
function setStatus(text){ els.status.textContent=text; }

function historySnapshot(){
  return {
    pages:clone(state.pages),
    currentPageId:state.currentPageId,
    selectedOverlayId:state.selectedOverlayId
  };
}
function pushHistory(){
  const snap=historySnapshot();
  const serialized=JSON.stringify(snap);
  if(state.historyIndex>=0 && JSON.stringify(state.history[state.historyIndex])===serialized) return;
  state.history=state.history.slice(0,state.historyIndex+1);
  state.history.push(snap);
  if(state.history.length>state.maxHistory) state.history.shift();
  state.historyIndex=state.history.length-1;
  updateHistoryButtons();
}
function restoreHistory(index){
  if(index<0||index>=state.history.length) return;
  state.historyIndex=index;
  const snap=clone(state.history[index]);
  state.pages=snap.pages;
  state.currentPageId=snap.currentPageId;
  state.selectedOverlayId=snap.selectedOverlayId;
  updateHistoryButtons();
  refreshAll();
}
function updateHistoryButtons(){
  els.undo.disabled=state.historyIndex<=0;
  els.redo.disabled=state.historyIndex<0||state.historyIndex>=state.history.length-1;
}
function commit(label){
  pushHistory();
  setStatus(label);
  refreshInspector();
}

async function bytesFromFile(file){ return new Uint8Array(await file.arrayBuffer()); }

async function addPdfFile(file,{replace=false}={}){
  try{
    setStatus("PDF 읽는 중...");
    const bytes=await bytesFromFile(file);
    const pdfjsDoc=await pdfjsLib.getDocument({data:bytes.slice()}).promise;
    const sourceId=uid("src");
    state.sources.set(sourceId,{id:sourceId,name:file.name,bytes,pdfjsDoc});
    const newPages=[];
    for(let i=1;i<=pdfjsDoc.numPages;i++){
      const page=await pdfjsDoc.getPage(i);
      const viewport=page.getViewport({scale:1,rotation:page.rotate});
      newPages.push({
        id:uid("page"),sourceId,sourceIndex:i-1,blank:false,
        rotationDelta:0,baseRotation:page.rotate||0,
        width:viewport.width,height:viewport.height,overlays:[]
      });
    }
    if(replace){
      state.pages=newPages;
      state.history=[];
      state.historyIndex=-1;
      state.currentPageId=newPages[0]?.id||null;
      state.selectedOverlayId=null;
    }else{
      state.pages.push(...newPages);
      if(!state.currentPageId) state.currentPageId=newPages[0]?.id||null;
    }
    pushHistory();
    await refreshAll();
    toast(replace?"PDF를 열었습니다.":"PDF 페이지를 뒤에 추가했습니다.","ok");
  }catch(error){
    console.error(error);
    toast("PDF를 열 수 없습니다. 암호가 걸렸거나 손상된 파일일 수 있습니다.","error");
    setStatus("PDF 열기 실패");
  }
}

async function loadFiles(files,{replaceFirst=false}={}){
  const list=[...files];
  for(let i=0;i<list.length;i++) await addPdfFile(list[i],{replace:replaceFirst&&i===0});
}

async function getPdfJsPage(pageState){
  if(pageState.blank) return null;
  const source=state.sources.get(pageState.sourceId);
  return source?.pdfjsDoc ? source.pdfjsDoc.getPage(pageState.sourceIndex+1) : null;
}
function visualRotation(pageState){
  return normalizeRotation((pageState.baseRotation||0)+(pageState.rotationDelta||0));
}
function pageVisualSize(pageState){
  if(pageState.blank){
    const r=visualRotation(pageState);
    return r%180===0?{width:pageState.width,height:pageState.height}:{width:pageState.height,height:pageState.width};
  }
  const r=visualRotation(pageState);
  const baseW=pageState.originalWidth||pageState.width;
  const baseH=pageState.originalHeight||pageState.height;
  return r%180===0?{width:baseW,height:baseH}:{width:baseH,height:baseW};
}

async function ensurePageBaseSize(pageState){
  if(pageState.blank) return;
  if(pageState.originalWidth&&pageState.originalHeight) return;
  const page=await getPdfJsPage(pageState);
  const vp=page.getViewport({scale:1,rotation:0});
  pageState.originalWidth=vp.width;
  pageState.originalHeight=vp.height;
}

async function renderCurrentPage(){
  const pageState=currentPage();
  const token=++state.renderToken;
  if(!pageState){
    els.empty.classList.remove("hidden");
    els.viewport.classList.add("hidden");
    els.pageStatus.textContent="—";
    return;
  }
  els.empty.classList.add("hidden");
  els.viewport.classList.remove("hidden");
  await ensurePageBaseSize(pageState);
  if(token!==state.renderToken) return;

  const rotation=visualRotation(pageState);
  let visualWidth,visualHeight,viewport;
  const dpr=Math.min(window.devicePixelRatio||1,2);

  if(pageState.blank){
    const size=pageVisualSize(pageState);
    visualWidth=size.width;visualHeight=size.height;
    viewport={width:visualWidth,height:visualHeight};
    const cssW=visualWidth*state.zoom, cssH=visualHeight*state.zoom;
    els.canvas.width=Math.round(cssW*dpr);els.canvas.height=Math.round(cssH*dpr);
    els.canvas.style.width=cssW+"px";els.canvas.style.height=cssH+"px";
    const ctx=els.canvas.getContext("2d");
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle="#fff";ctx.fillRect(0,0,cssW,cssH);
  }else{
    const page=await getPdfJsPage(pageState);
    viewport=page.getViewport({scale:state.zoom,rotation});
    visualWidth=viewport.width/state.zoom;visualHeight=viewport.height/state.zoom;
    els.canvas.width=Math.round(viewport.width*dpr);els.canvas.height=Math.round(viewport.height*dpr);
    els.canvas.style.width=viewport.width+"px";els.canvas.style.height=viewport.height+"px";
    const ctx=els.canvas.getContext("2d");
    await page.render({canvasContext:ctx,viewport,transform:dpr!==1?[dpr,0,0,dpr,0,0]:null}).promise;
  }

  const cssW=visualWidth*state.zoom,cssH=visualHeight*state.zoom;
  els.pageWrap.style.width=cssW+"px";
  els.pageWrap.style.height=cssH+"px";
  els.textHits.style.width=els.overlays.style.width=els.drawPreview.style.width=cssW+"px";
  els.textHits.style.height=els.overlays.style.height=els.drawPreview.style.height=cssH+"px";
  els.pageWrap.classList.toggle("edit-text-mode",state.tool==="editText");

  if(pageState.blank) els.textHits.innerHTML="";
  else await renderTextHitLayer(pageState,rotation,visualWidth,visualHeight);
  renderOverlayLayer(pageState,visualWidth,visualHeight);
  els.pageStatus.textContent=(state.pages.findIndex(p=>p.id===pageState.id)+1)+" / "+state.pages.length+" · "+Math.round(visualWidth)+"×"+Math.round(visualHeight)+" pt";
}

async function renderTextHitLayer(pageState,rotation,visualWidth,visualHeight){
  els.textHits.innerHTML="";
  if(state.tool!=="editText") return;
  const page=await getPdfJsPage(pageState);
  const viewport=page.getViewport({scale:1,rotation});
  const content=await page.getTextContent();
  content.items.forEach((item,index)=>{
    if(!item.str?.trim()) return;
    const tx=pdfjsLib.Util.transform(viewport.transform,item.transform);
    const fontH=Math.max(7,Math.hypot(tx[2],tx[3]));
    const x=tx[4], y=tx[5]-fontH;
    const w=Math.max(6,(item.width||fontH)*viewport.scale);
    const h=Math.max(fontH,(item.height||0)*viewport.scale);
    const hit=document.createElement("div");
    hit.className="text-hit";
    hit.style.left=(x/visualWidth*100)+"%";
    hit.style.top=(y/visualHeight*100)+"%";
    hit.style.width=(w/visualWidth*100)+"%";
    hit.style.height=(h/visualHeight*100)+"%";
    hit.title=item.str;
    hit.addEventListener("pointerdown",event=>{
      event.stopPropagation();
      createReplacementOverlay({
        text:item.str,x:x/visualWidth,y:y/visualHeight,w:w/visualWidth,h:h/visualHeight,
        fontSize:Math.max(8,fontH*.82)
      });
    });
    els.textHits.appendChild(hit);
  });
}

function overlayBoundsPx(overlay,w,h){
  return {x:overlay.x*w,y:overlay.y*h,w:overlay.w*w,h:overlay.h*h};
}
function applyOverlayStyle(node,o){
  node.style.left=(o.x*100)+"%";
  node.style.top=(o.y*100)+"%";
  node.style.width=(o.w*100)+"%";
  node.style.height=(o.h*100)+"%";
  node.style.opacity=o.opacity??1;
}
function renderOverlayLayer(pageState,visualWidth,visualHeight){
  els.overlays.innerHTML="";
  pageState.overlays.forEach((o,index)=>{
    if(o.type==="draw"){
      const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
      svg.classList.add("freehand-overlay");
      svg.dataset.id=o.id;
      svg.style.inset="0";svg.style.width="100%";svg.style.height="100%";
      const poly=document.createElementNS("http://www.w3.org/2000/svg","polyline");
      poly.setAttribute("fill","none");
      poly.setAttribute("stroke",o.color||"#111827");
      poly.setAttribute("stroke-width",String((o.strokeWidth||3)*state.zoom));
      poly.setAttribute("stroke-linecap","round");poly.setAttribute("stroke-linejoin","round");
      poly.setAttribute("points",o.points.map(p=>(p.x*visualWidth*state.zoom)+","+(p.y*visualHeight*state.zoom)).join(" "));
      poly.setAttribute("opacity",String(o.opacity??1));
      svg.appendChild(poly);
      if(o.id===state.selectedOverlayId) svg.classList.add("selected");
      svg.addEventListener("pointerdown",event=>{
        if(state.tool!=="select") return;
        event.stopPropagation();selectOverlay(o.id);
      });
      els.overlays.appendChild(svg);return;
    }

    const node=document.createElement("div");
    node.className="overlay-item";
    node.dataset.id=o.id;
    applyOverlayStyle(node,o);
    if(o.id===state.selectedOverlayId) node.classList.add("selected");

    if(o.type==="text"||o.type==="replaceText"){
      node.classList.add("text-overlay");
      node.textContent=o.text||"";
      node.style.fontSize=((o.fontSize||18)*state.zoom)+"px";
      node.style.color=o.color||"#111827";
      node.style.textAlign=o.align||"left";
      node.style.justifyContent=o.align==="center"?"center":o.align==="right"?"flex-end":"flex-start";
      if(o.type==="replaceText") node.style.background=o.fill||"#ffffff";
    }else if(o.type==="rect"){
      node.classList.add("rect-overlay");
      node.style.borderColor=o.color||"#e11d48";
      node.style.borderWidth=((o.strokeWidth||3)*state.zoom)+"px";
      node.style.background=o.fill==="transparent"?"transparent":(o.fill||"transparent");
    }else if(o.type==="highlight"){
      node.classList.add("highlight-overlay");
      node.style.background=o.fill||"#fde047";
      node.style.borderColor="transparent";
    }else if(o.type==="image"){
      node.classList.add("image-overlay");
      const img=document.createElement("img");img.src=o.data;img.alt="";
      node.appendChild(img);
    }

    node.addEventListener("pointerdown",event=>startOverlayDrag(event,o,node));
    if(o.id===state.selectedOverlayId&&state.tool==="select"){
      const handle=document.createElement("span");handle.className="resize-handle";
      handle.addEventListener("pointerdown",event=>startOverlayResize(event,o,node));
      node.appendChild(handle);
    }
    els.overlays.appendChild(node);
  });
}

function setTool(tool){
  state.tool=tool;
  document.querySelectorAll("[data-tool]").forEach(btn=>btn.classList.toggle("active",btn.dataset.tool===tool));
  els.pageWrap.classList.toggle("edit-text-mode",tool==="editText");
  setStatus({
    select:"개체를 선택하거나 이동하세요.",
    text:"페이지를 클릭하면 텍스트가 추가됩니다.",
    editText:"수정할 기존 글자를 클릭하세요.",
    draw:"마우스나 터치로 자유롭게 그리세요.",
    highlight:"드래그하여 형광펜 영역을 만드세요.",
    rect:"드래그하여 사각형을 만드세요."
  }[tool]||"");
  renderCurrentPage();
}
document.querySelectorAll("[data-tool]").forEach(btn=>btn.addEventListener("click",()=>setTool(btn.dataset.tool)));

function pagePointerPosition(event){
  const rect=els.pageWrap.getBoundingClientRect();
  return {
    x:clamp((event.clientX-rect.left)/rect.width,0,1),
    y:clamp((event.clientY-rect.top)/rect.height,0,1)
  };
}
function defaultOverlay(type,pos){
  const base={id:uid("ov"),type,x:clamp(pos.x,0,.9),y:clamp(pos.y,0,.9),w:.22,h:.06,opacity:1,color:"#111827",fill:"#ffffff",strokeWidth:3};
  if(type==="text") return {...base,text:"텍스트를 입력하세요",fontSize:18,align:"left",w:.28,h:.07};
  if(type==="rect") return {...base,w:.24,h:.14,color:"#e11d48",fill:"transparent"};
  if(type==="highlight") return {...base,w:.28,h:.05,fill:"#fde047",opacity:.42};
  return base;
}
function addOverlay(overlay,label="개체 추가"){
  const page=currentPage();if(!page)return;
  page.overlays.push(overlay);
  state.selectedOverlayId=overlay.id;
  commit(label);renderCurrentPage();
}
function createReplacementOverlay(data){
  addOverlay({
    id:uid("ov"),type:"replaceText",text:data.text,x:data.x,y:data.y,w:Math.max(data.w,.04),h:Math.max(data.h,.025),
    fontSize:data.fontSize||14,align:"left",color:"#111827",fill:"#ffffff",opacity:1,strokeWidth:0
  },"기존 텍스트 수정 개체 추가");
  setTool("select");
  setTimeout(()=>{els.textValue.focus();els.textValue.select();},0);
}

els.pageWrap.addEventListener("pointerdown",event=>{
  if(!currentPage())return;
  if(event.target.closest(".overlay-item,.freehand-overlay,.text-hit")) return;
  const pos=pagePointerPosition(event);
  if(state.tool==="text"){addOverlay(defaultOverlay("text",pos),"텍스트 추가");setTool("select");return;}
  if(state.tool==="rect"||state.tool==="highlight"){
    const start=pos;
    state.drawing={mode:state.tool,start,current:null};
    els.drawPreview.innerHTML="";
    const rect=document.createElementNS("http://www.w3.org/2000/svg","rect");
    rect.setAttribute("data-preview","true");
    rect.setAttribute("fill",state.tool==="highlight"?"rgba(253,224,71,.42)":"transparent");
    rect.setAttribute("stroke",state.tool==="highlight"?"transparent":"#e11d48");
    rect.setAttribute("stroke-width","2");
    els.drawPreview.appendChild(rect);
    event.preventDefault();return;
  }
  if(state.tool==="draw"){
    state.drawing={mode:"draw",points:[pos]};
    updateDrawPreview();event.preventDefault();return;
  }
  if(state.tool==="select"){
    state.selectedOverlayId=null;refreshInspector();renderOverlayLayer(currentPage(),...Object.values(pageVisualSize(currentPage())));
  }
});
window.addEventListener("pointermove",event=>{
  if(!state.drawing)return;
  const rect=els.pageWrap.getBoundingClientRect();
  const pos={x:clamp((event.clientX-rect.left)/rect.width,0,1),y:clamp((event.clientY-rect.top)/rect.height,0,1)};
  if(state.drawing.mode==="draw"){
    state.drawing.points.push(pos);updateDrawPreview();
  }else{
    state.drawing.current=pos;updateShapePreview();
  }
});
window.addEventListener("pointerup",()=>{
  if(!state.drawing)return;
  const d=state.drawing;state.drawing=null;
  els.drawPreview.innerHTML="";
  if(d.mode==="draw"){
    if(d.points.length>1)addOverlay({id:uid("ov"),type:"draw",points:d.points,color:"#111827",opacity:1,strokeWidth:3},"그리기 추가");
  }else if(d.current){
    const x=Math.min(d.start.x,d.current.x),y=Math.min(d.start.y,d.current.y);
    const w=Math.abs(d.current.x-d.start.x),h=Math.abs(d.current.y-d.start.y);
    if(w>.005&&h>.005){
      const o=defaultOverlay(d.mode,{x,y});o.x=x;o.y=y;o.w=w;o.h=h;addOverlay(o,d.mode==="highlight"?"형광펜 추가":"도형 추가");
    }
  }
});
function updateDrawPreview(){
  const page=currentPage();if(!page||!state.drawing)return;
  const size=pageVisualSize(page);const pts=state.drawing.points;
  els.drawPreview.innerHTML="";
  const poly=document.createElementNS("http://www.w3.org/2000/svg","polyline");
  poly.setAttribute("fill","none");poly.setAttribute("stroke","#111827");poly.setAttribute("stroke-width","3");
  poly.setAttribute("stroke-linecap","round");poly.setAttribute("stroke-linejoin","round");
  poly.setAttribute("points",pts.map(p=>(p.x*size.width*state.zoom)+","+(p.y*size.height*state.zoom)).join(" "));
  els.drawPreview.appendChild(poly);
}
function updateShapePreview(){
  const page=currentPage(),d=state.drawing;if(!page||!d?.current)return;
  const size=pageVisualSize(page),rect=els.drawPreview.querySelector("rect");if(!rect)return;
  const x=Math.min(d.start.x,d.current.x)*size.width*state.zoom,y=Math.min(d.start.y,d.current.y)*size.height*state.zoom;
  const w=Math.abs(d.current.x-d.start.x)*size.width*state.zoom,h=Math.abs(d.current.y-d.start.y)*size.height*state.zoom;
  rect.setAttribute("x",x);rect.setAttribute("y",y);rect.setAttribute("width",w);rect.setAttribute("height",h);
}

function selectOverlay(id){state.selectedOverlayId=id;refreshInspector();renderCurrentPage();}
function startOverlayDrag(event,o,node){
  if(state.tool!=="select")return;
  event.stopPropagation();selectOverlay(o.id);
  const page=currentPage(),size=pageVisualSize(page),rect=els.pageWrap.getBoundingClientRect();
  const start={clientX:event.clientX,clientY:event.clientY,x:o.x,y:o.y};
  const move=e=>{
    o.x=clamp(start.x+(e.clientX-start.clientX)/rect.width,0,1-o.w);
    o.y=clamp(start.y+(e.clientY-start.clientY)/rect.height,0,1-o.h);
    applyOverlayStyle(node,o);refreshInspector(false);
  };
  const up=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up);commit("개체 이동");};
  window.addEventListener("pointermove",move);window.addEventListener("pointerup",up,{once:true});
}
function startOverlayResize(event,o,node){
  event.stopPropagation();
  const rect=els.pageWrap.getBoundingClientRect();
  const start={clientX:event.clientX,clientY:event.clientY,w:o.w,h:o.h};
  const move=e=>{
    o.w=clamp(start.w+(e.clientX-start.clientX)/rect.width,.015,1-o.x);
    o.h=clamp(start.h+(e.clientY-start.clientY)/rect.height,.015,1-o.y);
    applyOverlayStyle(node,o);refreshInspector(false);
  };
  const up=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up);commit("개체 크기 변경");renderCurrentPage();};
  window.addEventListener("pointermove",move);window.addEventListener("pointerup",up,{once:true});
}

function refreshInspector(full=true){
  const o=selectedOverlay();
  els.noSelection.classList.toggle("hidden",!!o);
  els.inspector.classList.toggle("hidden",!o);
  els.deleteOverlay.classList.toggle("hidden",!o);
  els.selectionLabel.textContent=o?({
    text:"텍스트",replaceText:"기존 글자 수정",rect:"사각형",highlight:"형광펜",image:"이미지",draw:"그리기"
  }[o.type]||o.type):"선택된 개체 없음";
  if(!o)return;
  const isText=o.type==="text"||o.type==="replaceText";
  els.textSection.classList.toggle("hidden",!isText);
  els.replaceHint.classList.toggle("hidden",o.type!=="replaceText");
  els.strokeWidthRow.classList.toggle("hidden",!["rect","draw"].includes(o.type));
  if(full){
    els.textValue.value=o.text||"";
    els.fontSize.value=Math.round(o.fontSize||18);
    els.textAlign.value=o.align||"left";
    els.color.value=colorToHex(o.color||"#111827");
    els.fill.value=colorToHex((o.fill&&o.fill!=="transparent")?o.fill:"#ffffff");
    els.opacity.value=o.opacity??1;
    els.strokeWidth.value=o.strokeWidth||3;
  }
  els.opacityValue.textContent=Math.round((o.opacity??1)*100)+"%";
  els.strokeWidthValue.textContent=(o.strokeWidth||3)+"px";
  const page=currentPage(),size=page? pageVisualSize(page):{width:1,height:1};
  els.posX.value=Math.round(o.x*size.width);
  els.posY.value=Math.round(o.y*size.height);
  els.width.value=Math.round((o.w||0)*size.width);
  els.height.value=Math.round((o.h||0)*size.height);
}
function colorToHex(value){
  if(/^#[0-9a-f]{6}$/i.test(value))return value;
  return "#111827";
}
function updateSelected(patch,label){
  const o=selectedOverlay();if(!o)return;
  Object.assign(o,patch);commit(label);renderCurrentPage();
}
els.textValue.addEventListener("change",()=>updateSelected({text:els.textValue.value},"텍스트 변경"));
els.fontSize.addEventListener("change",()=>updateSelected({fontSize:Math.max(6,Number(els.fontSize.value)||18)},"글자 크기 변경"));
els.textAlign.addEventListener("change",()=>updateSelected({align:els.textAlign.value},"텍스트 정렬 변경"));
els.color.addEventListener("change",()=>updateSelected({color:els.color.value},"색상 변경"));
els.fill.addEventListener("change",()=>updateSelected({fill:els.fill.value},"배경색 변경"));
els.opacity.addEventListener("input",()=>{const o=selectedOverlay();if(!o)return;o.opacity=Number(els.opacity.value);refreshInspector(false);renderCurrentPage();});
els.opacity.addEventListener("change",()=>commit("투명도 변경"));
els.strokeWidth.addEventListener("input",()=>{const o=selectedOverlay();if(!o)return;o.strokeWidth=Number(els.strokeWidth.value);refreshInspector(false);renderCurrentPage();});
els.strokeWidth.addEventListener("change",()=>commit("선 두께 변경"));

function updateBoxFromInspector(){
  const o=selectedOverlay(),page=currentPage();if(!o||!page||o.type==="draw")return;
  const size=pageVisualSize(page);
  o.x=clamp((Number(els.posX.value)||0)/size.width,0,1);
  o.y=clamp((Number(els.posY.value)||0)/size.height,0,1);
  o.w=clamp((Number(els.width.value)||1)/size.width,.005,1-o.x);
  o.h=clamp((Number(els.height.value)||1)/size.height,.005,1-o.y);
  commit("개체 위치/크기 변경");renderCurrentPage();
}
[els.posX,els.posY,els.width,els.height].forEach(input=>input.addEventListener("change",updateBoxFromInspector));
els.front.addEventListener("click",()=>{
  const page=currentPage(),o=selectedOverlay();if(!page||!o)return;
  page.overlays=page.overlays.filter(x=>x.id!==o.id);page.overlays.push(o);commit("맨 앞으로");renderCurrentPage();
});
els.back.addEventListener("click",()=>{
  const page=currentPage(),o=selectedOverlay();if(!page||!o)return;
  page.overlays=page.overlays.filter(x=>x.id!==o.id);page.overlays.unshift(o);commit("맨 뒤로");renderCurrentPage();
});
function deleteSelectedOverlay(){
  const page=currentPage();if(!page||!state.selectedOverlayId)return;
  page.overlays=page.overlays.filter(o=>o.id!==state.selectedOverlayId);state.selectedOverlayId=null;commit("개체 삭제");renderCurrentPage();
}
els.deleteOverlay.addEventListener("click",deleteSelectedOverlay);

els.imageInput.addEventListener("change",()=>{
  const file=els.imageInput.files?.[0];if(!file||!currentPage())return;
  const reader=new FileReader();
  reader.onload=()=>{
    addOverlay({id:uid("ov"),type:"image",data:String(reader.result),x:.25,y:.25,w:.35,h:.24,opacity:1,color:"#111827",fill:"#ffffff",strokeWidth:0},"이미지 추가");
    setTool("select");
  };
  reader.readAsDataURL(file);els.imageInput.value="";
});

function setupSignatureCanvas(){
  const c=els.signatureCanvas,ctx=c.getContext("2d");let drawing=false,last=null;
  const clear=()=>{ctx.clearRect(0,0,c.width,c.height);};
  clear();
  const pos=e=>{const r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*c.width/r.width,y:(e.clientY-r.top)*c.height/r.height};};
  c.addEventListener("pointerdown",e=>{drawing=true;last=pos(e);c.setPointerCapture?.(e.pointerId);});
  c.addEventListener("pointermove",e=>{
    if(!drawing)return;const p=pos(e);ctx.strokeStyle="#111827";ctx.lineWidth=4;ctx.lineCap="round";ctx.lineJoin="round";
    ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke();last=p;
  });
  c.addEventListener("pointerup",()=>{drawing=false;last=null;});
  c.addEventListener("pointercancel",()=>{drawing=false;last=null;});
  els.clearSignature.addEventListener("click",clear);
  return clear;
}
const clearSignature=setupSignatureCanvas();
function closeSignature(){els.signatureModal.classList.add("hidden");}
els.signatureBtn.addEventListener("click",()=>{if(!currentPage()){toast("먼저 PDF를 열어주세요.","error");return;}clearSignature();els.signatureModal.classList.remove("hidden");});
els.closeSignature.addEventListener("click",closeSignature);els.cancelSignature.addEventListener("click",closeSignature);
els.addSignature.addEventListener("click",()=>{
  const data=trimSignatureCanvas(els.signatureCanvas);
  if(!data){toast("서명을 먼저 그려주세요.","error");return;}
  addOverlay({id:uid("ov"),type:"image",data,x:.28,y:.34,w:.32,h:.13,opacity:1,color:"#111827",fill:"#ffffff",strokeWidth:0,signature:true},"서명 추가");
  closeSignature();setTool("select");
});
function trimSignatureCanvas(canvas){
  const ctx=canvas.getContext("2d"),img=ctx.getImageData(0,0,canvas.width,canvas.height),d=img.data;
  let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
    const i=(y*canvas.width+x)*4;const dark=d[i+3]>10&&(d[i]<245||d[i+1]<245||d[i+2]<245);
    if(dark){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  }
  if(maxX<0)return null;
  const pad=12;minX=Math.max(0,minX-pad);minY=Math.max(0,minY-pad);maxX=Math.min(canvas.width-1,maxX+pad);maxY=Math.min(canvas.height-1,maxY+pad);
  const out=document.createElement("canvas");out.width=maxX-minX+1;out.height=maxY-minY+1;
  out.getContext("2d").drawImage(canvas,minX,minY,out.width,out.height,0,0,out.width,out.height);
  return out.toDataURL("image/png");
}

async function renderThumbnails(){
  els.thumbnails.innerHTML="";
  for(let i=0;i<state.pages.length;i++){
    const p=state.pages[i];
    const item=document.createElement("div");item.className="thumb"+(p.id===state.currentPageId?" active":"");
    item.draggable=true;item.dataset.id=p.id;
    const canvas=document.createElement("canvas");
    item.appendChild(canvas);
    const meta=document.createElement("div");meta.className="thumb-meta";meta.innerHTML="<span>"+(i+1)+"</span><span class='thumb-handle'>•••</span>";
    item.appendChild(meta);
    item.addEventListener("click",()=>{state.currentPageId=p.id;state.selectedOverlayId=null;refreshAll(false);});
    item.addEventListener("dragstart",e=>{item.classList.add("dragging");e.dataTransfer.setData("text/plain",p.id);e.dataTransfer.effectAllowed="move";});
    item.addEventListener("dragend",()=>{document.querySelectorAll(".thumb").forEach(n=>n.classList.remove("dragging","drop-before","drop-after"));});
    item.addEventListener("dragover",e=>{e.preventDefault();const r=item.getBoundingClientRect();item.classList.toggle("drop-before",e.clientY<r.top+r.height/2);item.classList.toggle("drop-after",e.clientY>=r.top+r.height/2);});
    item.addEventListener("dragleave",()=>item.classList.remove("drop-before","drop-after"));
    item.addEventListener("drop",e=>{
      e.preventDefault();const fromId=e.dataTransfer.getData("text/plain");if(!fromId||fromId===p.id)return;
      const from=state.pages.findIndex(x=>x.id===fromId),toBase=state.pages.findIndex(x=>x.id===p.id);const before=item.classList.contains("drop-before");
      const [moved]=state.pages.splice(from,1);let to=state.pages.findIndex(x=>x.id===p.id)+(before?0:1);state.pages.splice(to,0,moved);
      commit("페이지 순서 변경");refreshAll();
    });
    els.thumbnails.appendChild(item);
    await renderThumbCanvas(p,canvas);
  }
}
async function renderThumbCanvas(p,canvas){
  const dpr=1;
  if(p.blank){
    const s=pageVisualSize(p),scale=145/s.width;canvas.width=Math.round(s.width*scale);canvas.height=Math.round(s.height*scale);
    const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);return;
  }
  const page=await getPdfJsPage(p);const rotation=visualRotation(p);
  const base=page.getViewport({scale:1,rotation}),scale=145/base.width,viewport=page.getViewport({scale,rotation});
  canvas.width=Math.round(viewport.width*dpr);canvas.height=Math.round(viewport.height*dpr);
  await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
}

async function refreshAll(renderThumbs=true){
  els.pageCount.textContent=state.pages.length?state.pages.length+" 페이지":"PDF를 열어주세요";
  els.addBlank.disabled=!state.pages.length;
  const disabled=!currentPage();
  [els.rotateLeft,els.rotateRight,els.duplicatePage,els.deletePage,els.save].forEach(b=>b.disabled=disabled);
  if(renderThumbs)await renderThumbnails();
  await renderCurrentPage();
  refreshInspector();
}
els.rotateLeft.addEventListener("click",()=>rotateCurrent(-90));
els.rotateRight.addEventListener("click",()=>rotateCurrent(90));
function rotateCurrent(delta){
  const p=currentPage();if(!p)return;p.rotationDelta=normalizeRotation((p.rotationDelta||0)+delta);commit(delta>0?"페이지 오른쪽 회전":"페이지 왼쪽 회전");refreshAll();
}
els.duplicatePage.addEventListener("click",()=>{
  const p=currentPage();if(!p)return;const copy=clone(p);copy.id=uid("page");copy.overlays=copy.overlays.map(o=>({...o,id:uid("ov")}));
  const idx=state.pages.findIndex(x=>x.id===p.id);state.pages.splice(idx+1,0,copy);state.currentPageId=copy.id;state.selectedOverlayId=null;commit("페이지 복제");refreshAll();
});
els.deletePage.addEventListener("click",()=>{
  const p=currentPage();if(!p)return;if(state.pages.length===1){toast("마지막 페이지는 삭제할 수 없습니다.","error");return;}
  const idx=state.pages.findIndex(x=>x.id===p.id);state.pages.splice(idx,1);state.currentPageId=state.pages[Math.min(idx,state.pages.length-1)].id;state.selectedOverlayId=null;commit("페이지 삭제");refreshAll();
});
els.addBlank.addEventListener("click",()=>{
  const p=currentPage();const size=p?pageVisualSize(p):{width:595,height:842};
  const blank={id:uid("page"),sourceId:null,sourceIndex:null,blank:true,rotationDelta:0,baseRotation:0,width:size.width,height:size.height,originalWidth:size.width,originalHeight:size.height,overlays:[]};
  const idx=p?state.pages.findIndex(x=>x.id===p.id)+1:state.pages.length;state.pages.splice(idx,0,blank);state.currentPageId=blank.id;state.selectedOverlayId=null;commit("빈 페이지 추가");refreshAll();
});

els.zoomIn.addEventListener("click",()=>setZoom(state.zoom+.1));
els.zoomOut.addEventListener("click",()=>setZoom(state.zoom-.1));
function setZoom(value){state.zoom=clamp(value,.35,2.5);els.zoomLabel.textContent=Math.round(state.zoom*100)+"%";renderCurrentPage();}
els.fitWidth.addEventListener("click",()=>{
  const p=currentPage();if(!p)return;const size=pageVisualSize(p);const available=Math.max(300,els.stage.clientWidth-70);setZoom(clamp(available/size.width,.35,2.5));
});

async function renderPageForExport(pageState,scale=2){
  await ensurePageBaseSize(pageState);
  const rotation=visualRotation(pageState);
  let visualWidth,visualHeight,canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");
  if(pageState.blank){
    const s=pageVisualSize(pageState);visualWidth=s.width;visualHeight=s.height;
    canvas.width=Math.round(visualWidth*scale);canvas.height=Math.round(visualHeight*scale);
    ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
  }else{
    const page=await getPdfJsPage(pageState);const viewport=page.getViewport({scale,rotation});
    visualWidth=viewport.width/scale;visualHeight=viewport.height/scale;
    canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);
    await page.render({canvasContext:ctx,viewport}).promise;
  }
  drawOverlaysToCanvas(ctx,pageState,visualWidth,visualHeight,scale);
  return {canvas,width:visualWidth,height:visualHeight};
}
function drawOverlaysToCanvas(ctx,pageState,w,h,scale){
  ctx.save();ctx.scale(scale,scale);
  for(const o of pageState.overlays){
    ctx.globalAlpha=o.opacity??1;
    if(o.type==="draw"){
      if(o.points.length<2)continue;ctx.strokeStyle=o.color||"#111827";ctx.lineWidth=o.strokeWidth||3;ctx.lineCap="round";ctx.lineJoin="round";
      ctx.beginPath();o.points.forEach((p,i)=>{const x=p.x*w,y=p.y*h;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();continue;
    }
    const x=o.x*w,y=o.y*h,ow=o.w*w,oh=o.h*h;
    if(o.type==="replaceText"){ctx.fillStyle=o.fill||"#fff";ctx.fillRect(x,y,ow,oh);}
    if(o.type==="highlight"){ctx.fillStyle=o.fill||"#fde047";ctx.fillRect(x,y,ow,oh);continue;}
    if(o.type==="rect"){
      if(o.fill&&o.fill!=="transparent"){ctx.fillStyle=o.fill;ctx.fillRect(x,y,ow,oh);}
      ctx.strokeStyle=o.color||"#e11d48";ctx.lineWidth=o.strokeWidth||3;ctx.strokeRect(x,y,ow,oh);continue;
    }
    if(o.type==="text"||o.type==="replaceText"){
      ctx.fillStyle=o.color||"#111827";ctx.font=(o.fontSize||18)+"px sans-serif";ctx.textBaseline="top";
      drawWrappedText(ctx,o.text||"",x+2,y+1,ow-4,oh-2,(o.fontSize||18)*1.2,o.align||"left");continue;
    }
    if(o.type==="image"&&o.data){
      const img=exportImageCache.get(o.data);if(img)ctx.drawImage(img,x,y,ow,oh);
    }
  }
  ctx.restore();ctx.globalAlpha=1;
}
function drawWrappedText(ctx,text,x,y,maxW,maxH,lineH,align){
  const paragraphs=String(text).split("\n");let cy=y;
  for(const para of paragraphs){
    const words=para.split(/(\s+)/);let line="";
    for(const word of words){
      const test=line+word;
      if(line&&ctx.measureText(test).width>maxW){
        drawLine(ctx,line.trimEnd(),x,cy,maxW,align);cy+=lineH;if(cy+lineH>y+maxH)return;line=word.trimStart();
      }else line=test;
    }
    drawLine(ctx,line,x,cy,maxW,align);cy+=lineH;if(cy>y+maxH)return;
  }
}
function drawLine(ctx,line,x,y,w,align){
  let dx=x;if(align==="center")dx=x+(w-ctx.measureText(line).width)/2;if(align==="right")dx=x+w-ctx.measureText(line).width;ctx.fillText(line,dx,y);
}
const exportImageCache=new Map();
async function preloadOverlayImages(){
  const urls=[...new Set(state.pages.flatMap(p=>p.overlays.filter(o=>o.type==="image"&&o.data).map(o=>o.data)))];
  await Promise.all(urls.map(url=>new Promise(resolve=>{
    if(exportImageCache.has(url))return resolve();
    const img=new Image();img.onload=()=>{exportImageCache.set(url,img);resolve();};img.onerror=()=>resolve();img.src=url;
  })));
}
async function savePdf(){
  if(!state.pages.length)return;
  try{
    els.save.disabled=true;setStatus("PDF 저장 준비 중...");
    await preloadOverlayImages();
    const out=await PDFDocument.create();
    const sourceDocs=new Map();
    for(const [id,src] of state.sources) sourceDocs.set(id,await PDFDocument.load(src.bytes.slice(),{ignoreEncryption:true}));
    for(let i=0;i<state.pages.length;i++){
      const p=state.pages[i];setStatus("PDF 만드는 중... "+(i+1)+"/"+state.pages.length);
      const hasVisualEdits=p.blank||p.overlays.length>0;
      if(!hasVisualEdits){
        const srcDoc=sourceDocs.get(p.sourceId);
        const [copied]=await out.copyPages(srcDoc,[p.sourceIndex]);
        copied.setRotation(degrees(visualRotation(p)));
        out.addPage(copied);
      }else{
        const rendered=await renderPageForExport(p,2);
        const data=rendered.canvas.toDataURL("image/jpeg",.94);
        const jpg=await out.embedJpg(data);
        const page=out.addPage([rendered.width,rendered.height]);
        page.drawImage(jpg,{x:0,y:0,width:rendered.width,height:rendered.height});
      }
    }
    const bytes=await out.save({useObjectStreams:true});
    const blob=new Blob([bytes],{type:"application/pdf"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");
    const first=[...state.sources.values()][0]?.name?.replace(/\.pdf$/i,"")||"edited";
    a.href=url;a.download=first+"_edited.pdf";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);
    toast("편집된 PDF를 저장했습니다.","ok");setStatus("PDF 저장 완료");
  }catch(error){
    console.error(error);toast("PDF 저장 중 오류가 발생했습니다.","error");setStatus("PDF 저장 실패");
  }finally{els.save.disabled=false;}
}

els.openInput.addEventListener("change",()=>{const f=els.openInput.files?.[0];if(f)addPdfFile(f,{replace:true});els.openInput.value="";});
els.emptyInput.addEventListener("change",()=>{const f=els.emptyInput.files?.[0];if(f)addPdfFile(f,{replace:true});els.emptyInput.value="";});
els.appendInput.addEventListener("change",()=>{if(els.appendInput.files?.length)loadFiles(els.appendInput.files);els.appendInput.value="";});
els.save.addEventListener("click",savePdf);
els.undo.addEventListener("click",()=>restoreHistory(state.historyIndex-1));els.redo.addEventListener("click",()=>restoreHistory(state.historyIndex+1));

window.addEventListener("keydown",event=>{
  const tag=document.activeElement?.tagName;const typing=["INPUT","TEXTAREA","SELECT"].includes(tag);const mod=event.ctrlKey||event.metaKey;
  if(mod&&event.key.toLowerCase()==="z"){event.preventDefault();event.shiftKey?restoreHistory(state.historyIndex+1):restoreHistory(state.historyIndex-1);return;}
  if(mod&&event.key.toLowerCase()==="s"){event.preventDefault();savePdf();return;}
  if(!typing&&event.key==="Delete"){event.preventDefault();deleteSelectedOverlay();return;}
  if(!typing&&!mod){
    if(event.key.toLowerCase()==="v")setTool("select");
    if(event.key.toLowerCase()==="t")setTool("text");
    if(event.key.toLowerCase()==="d")setTool("draw");
  }
});

window.addEventListener("resize",()=>{if(currentPage())renderCurrentPage();});
refreshAll();
updateHistoryButtons();
