// CoachBoard Pro + Film + Pinch Zoom + Sidebar Toggle

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const statusEl = document.getElementById("status");
const appMain = document.getElementById("appMain");
const sidebar = document.getElementById("sidebar");
const toggleSidebarBtn = document.getElementById("toggleSidebar");

// Toolbar
const undoBtn = document.getElementById("undo");
const redoBtn = document.getElementById("redo");
const toolSelectBtn = document.getElementById("toolSelect");
const toolRouteBtn  = document.getElementById("toolRoute");
const toolBlockBtn  = document.getElementById("toolBlock");
const toolTextBtn   = document.getElementById("toolText");
const exportPngBtn  = document.getElementById("exportPng");
const exportPdfBtn  = document.getElementById("exportPdf");
const toggleFilmViewBtn = document.getElementById("toggleFilmView");

// Tabs/panels
const tabBtns = Array.from(document.querySelectorAll(".tab"));
const panels  = Array.from(document.querySelectorAll(".tabPanel"));

// Library UI
const newBoardBtn = document.getElementById("newBoard");
const boardPicker = document.getElementById("boardPicker");
const boardNameEl = document.getElementById("boardName");
const saveBoardNameBtn = document.getElementById("saveBoardName");
const duplicateBoardBtn = document.getElementById("duplicateBoard");
const deleteBoardBtn = document.getElementById("deleteBoard");

// Templates UI
const templateModeEl = document.getElementById("templateMode");
const templateListEl = document.getElementById("templateList");

// Layers/stencils UI
const activeLayerEl = document.getElementById("activeLayer");
const showBaseEl = document.getElementById("showBase");
const showTagsEl = document.getElementById("showTags");
const showAdjEl  = document.getElementById("showAdj");
const dropModeBtn = document.getElementById("dropMode");
const stencilTabBtns = Array.from(document.querySelectorAll(".tabBtn"));
const stencilGrid = document.getElementById("stencilGrid");

// Practice UI
const practiceDateEl = document.getElementById("practiceDate");
const addPeriodBtn = document.getElementById("addPeriod");
const periodListEl = document.getElementById("periodList");
const clearPracticeBtn = document.getElementById("clearPractice");
const savePracticeBtn = document.getElementById("savePractice");

// Film UI
const addClipsBtn = document.getElementById("addClips");
const clearClipsBtn = document.getElementById("clearClips");
const clipListEl = document.getElementById("clipList");
const clipPicker = document.getElementById("clipPicker");
const filmPane = document.getElementById("filmPane");
const filmPlayer = document.getElementById("filmPlayer");
const filmMiniList = document.getElementById("filmMiniList");

// Storage keys
const STORAGE = {
  app: "coachboard_pro_v3",
  ui:  "coachboard_ui_v1"
};

// --------- App State ----------
let tool = "select"; // select | route | block | text

// View transform (zoom/pan)
let view = { scale: 1.0, tx: 0, ty: 0 };

// Desktop pan mode
let isPanningMode = false;
let isPanning = false;
let panStart = { x:0, y:0, tx:0, ty:0 };

// Drawing/selection
let dragging = false;
let dragOffset = {x:0,y:0};
let drawingStroke = null;

// Touch gestures (pinch/pan)
const pointers = new Map(); // pointerId -> {x,y}
let pinch = {
  active: false,
  startDist: 0,
  startScale: 1,
  startTx: 0,
  startTy: 0,
  mid: {x:0,y:0},
  panOnly: false
};

// Stencils/layers
let dropMode = true;
let activeLayer = "base";
let showLayer = { base:true, tags:true, adj:true };

const STENCILS = {
  O: ["QB","RB","FB","X","Z","Y","H","LT","LG","C","RG","RT"],
  D: ["E","T","N","S","W","M","R","CB","FS","SS","NB"],
  ST:["P","K","LS","H","GUN","PP","KOR","KR","R5","L5"]
};
let activeStencilTab = "O";
let activeStencilLabel = "QB";

// Film
let filmOn = false;
let currentClipUrl = null;
let currentClipId = null;

// App data
let appData = {
  currentBoardId: null,
  boards: [],
  practice: { date:"", periods:[] }
};

function newEmptyBoard(name="New Board"){
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    players: [],
    strokes: [],
    selectedId: null,
    undo: [],
    redo: [],
    clipIds: []
  };
}
function currentBoard(){
  return appData.boards.find(b => b.id === appData.currentBoardId) || null;
}

// --------- IndexedDB (film clips) ----------
const CLIP_DB = { name: "coachboard_clips_v1", store: "clips" };

function openClipDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(CLIP_DB.name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CLIP_DB.store)){
        db.createObjectStore(CLIP_DB.store, { keyPath: "id" });
      }
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}
async function idbPutClip(clip){
  const db = await openClipDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(CLIP_DB.store, "readwrite");
    tx.objectStore(CLIP_DB.store).put(clip);
    tx.oncomplete = ()=> resolve(true);
    tx.onerror = ()=> reject(tx.error);
  });
}
async function idbGetClip(id){
  const db = await openClipDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(CLIP_DB.store, "readonly");
    const req = tx.objectStore(CLIP_DB.store).get(id);
    req.onsuccess = ()=> resolve(req.result || null);
    req.onerror = ()=> reject(req.error);
  });
}
async function idbDeleteClip(id){
  const db = await openClipDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(CLIP_DB.store, "readwrite");
    tx.objectStore(CLIP_DB.store).delete(id);
    tx.oncomplete = ()=> resolve(true);
    tx.onerror = ()=> reject(tx.error);
  });
}
async function idbListClipsByIds(ids){
  const out = [];
  for (const id of ids){
    const clip = await idbGetClip(id);
    if (clip) out.push(clip);
  }
  return out;
}

// --------- Persistence ----------
function loadApp(){
  const raw = localStorage.getItem(STORAGE.app);
  if (!raw) {
    appData.boards.push(newEmptyBoard("Board 1"));
    appData.currentBoardId = appData.boards[0].id;
    saveApp();
    return;
  }
  try{
    appData = JSON.parse(raw);
    if (!appData.boards || appData.boards.length === 0){
      appData.boards = [newEmptyBoard("Board 1")];
      appData.currentBoardId = appData.boards[0].id;
    }
    if (!appData.currentBoardId) appData.currentBoardId = appData.boards[0].id;

    for (const b of appData.boards){
      b.undo ||= [];
      b.redo ||= [];
      b.players ||= [];
      b.strokes ||= [];
      b.selectedId ||= null;
      b.clipIds ||= [];
    }
    appData.practice ||= { date:"", periods:[] };
  } catch {
    appData = { currentBoardId:null, boards:[newEmptyBoard("Board 1")], practice:{date:"", periods:[]} };
    appData.currentBoardId = appData.boards[0].id;
  }
}
function saveApp(){
  localStorage.setItem(STORAGE.app, JSON.stringify(appData));
}
function markBoardUpdated(){
  const b = currentBoard();
  if (!b) return;
  b.updatedAt = Date.now();
  saveApp();
}

// UI persistence (sidebar)
function loadUI(){
  const raw = localStorage.getItem(STORAGE.ui);
  if (!raw) return { sidebarHidden:false };
  try{ return JSON.parse(raw) || { sidebarHidden:false }; }
  catch{ return { sidebarHidden:false }; }
}
function saveUI(ui){
  localStorage.setItem(STORAGE.ui, JSON.stringify(ui));
}

// --------- Undo/Redo ----------
function snapshotBoard(){
  const b = currentBoard();
  if (!b) return;
  const snap = JSON.stringify({ players: b.players, strokes: b.strokes });
  b.undo.push(snap);
  if (b.undo.length > 60) b.undo.shift();
  b.redo = [];
}
function undo(){
  const b = currentBoard();
  if (!b || b.undo.length === 0) return;
  const nowSnap = JSON.stringify({ players: b.players, strokes: b.strokes });
  b.redo.push(nowSnap);

  const prev = b.undo.pop();
  const obj = JSON.parse(prev);
  b.players = obj.players || [];
  b.strokes = obj.strokes || [];
  b.selectedId = null;
  markBoardUpdated();
  render();
}
function redo(){
  const b = currentBoard();
  if (!b || b.redo.length === 0) return;
  const nowSnap = JSON.stringify({ players: b.players, strokes: b.strokes });
  b.undo.push(nowSnap);

  const nxt = b.redo.pop();
  const obj = JSON.parse(nxt);
  b.players = obj.players || [];
  b.strokes = obj.strokes || [];
  b.selectedId = null;
  markBoardUpdated();
  render();
}

// --------- Coordinate transforms ----------
function toWorld(pt){
  return { x: (pt.x - view.tx) / view.scale, y: (pt.y - view.ty) / view.scale };
}
function canvasPointFromEvent(e){
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  return { x:(e.clientX - rect.left)*scaleX, y:(e.clientY - rect.top)*scaleY };
}
function clampScale(s){
  return Math.min(3.2, Math.max(0.55, s));
}

// --------- Field drawing (clean, CHLK-like vibe) ----------
function drawField(){
  ctx.save();
  ctx.setTransform(view.scale, 0, 0, view.scale, view.tx, view.ty);

  // Turf base
  ctx.fillStyle = "#0a3a22";
  ctx.fillRect(0,0,canvas.width, canvas.height);

  const margin = 86;
  const top = margin, left = margin, right = canvas.width - margin, bottom = canvas.height - margin;
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;

  // Subtle stripes
  const stripeCount = 12;
  const stripeH = (bottom - top) / stripeCount;
  for (let i=0;i<stripeCount;i++){
    ctx.globalAlpha = (i % 2 === 0) ? 0.10 : 0.06;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(left, top + i*stripeH, right-left, stripeH);
  }
  ctx.globalAlpha = 1;

  // End zones (subtle)
  const ez = 90;
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = "#000";
  ctx.fillRect(left, top, right-left, ez);
  ctx.fillRect(left, bottom - ez, right-left, ez);
  ctx.globalAlpha = 1;

  // Watermark (not in the way)
  ctx.save();
  ctx.translate(midX, midY);
  ctx.rotate(-Math.PI/12);
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '900 140px "Champion Serif","Champion-Serif", Georgia, "Times New Roman", serif';
  ctx.fillText("CoachBoard", 0, 0);
  ctx.restore();

  // Lines
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 4;
  ctx.strokeRect(left, top, right-left, bottom-top);

  // Yard lines (horizontal)
  ctx.strokeStyle = "rgba(255,255,255,0.38)";
  ctx.lineWidth = 2;

  const yardStep = 110;
  for (let y = top; y <= bottom; y += yardStep){
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }

  // Goal lines stronger
  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(left, top+ez); ctx.lineTo(right, top+ez); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(left, bottom-ez); ctx.lineTo(right, bottom-ez); ctx.stroke();

  // Midfield line
  ctx.strokeStyle = "rgba(255,255,255,0.70)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(left, midY);
  ctx.lineTo(right, midY);
  ctx.stroke();

  // Hash marks (vertical field -> hashes are two x columns)
  const hashInset = 210;
  const hashX1 = left + hashInset;
  const hashX2 = right - hashInset;

  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 2;
  for (let y = top + 16; y <= bottom - 16; y += 44){
    // left hash
    ctx.beginPath();
    ctx.moveTo(hashX1, y);
    ctx.lineTo(hashX1 + 14, y);
    ctx.stroke();

    // right hash
    ctx.beginPath();
    ctx.moveTo(hashX2, y);
    ctx.lineTo(hashX2 - 14, y);
    ctx.stroke();
  }

  // Yard numbers (subtle, both sides)
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "#fff";
  ctx.font = "900 26px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const numbers = [10,20,30,40,50,40,30,20,10];
  const numStartY = top + ez + 60;
  const numGap = (bottom - top - 2*ez - 120) / (numbers.length - 1);

  for (let i=0;i<numbers.length;i++){
    const y = numStartY + i*numGap;
    const n = String(numbers[i]);

    // left side
    ctx.save();
    ctx.translate(left + 40, y);
    ctx.rotate(-Math.PI/2);
    ctx.fillText(n, 0, 0);
    ctx.restore();

    // right side
    ctx.save();
    ctx.translate(right - 40, y);
    ctx.rotate(Math.PI/2);
    ctx.fillText(n, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // LOS guide (dotted across)
  ctx.setLineDash([10,10]);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(midX - 340, midY);
  ctx.lineTo(midX + 340, midY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();
}

// --------- Layer visibility ----------
function isLayerVisible(layer){
  return (layer === "base" && showLayer.base) ||
         (layer === "tags" && showLayer.tags) ||
         (layer === "adj"  && showLayer.adj);
}

// --------- Draw players/strokes ----------
function drawPlayers(){
  const b = currentBoard();
  if (!b) return;

  ctx.save();
  ctx.setTransform(view.scale, 0, 0, view.scale, view.tx, view.ty);

  for (const p of b.players){
    if (!isLayerVisible(p.layer)) continue;

    const fill = p.side === "O" ? "rgba(255,255,255,0.92)" :
                 p.side === "D" ? "rgba(230,230,230,0.86)" :
                                  "rgba(210,210,210,0.80)";

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.lineWidth = (p.id === b.selectedId) ? 5 : 3;
    ctx.strokeStyle = (p.id === b.selectedId) ? "rgba(59,130,246,0.95)" : "rgba(0,0,0,0.75)";
    ctx.stroke();

    ctx.fillStyle = "rgba(0,0,0,0.92)";
    ctx.font = "900 22px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(p.label, p.x, p.y);
  }

  ctx.restore();
}

function drawStrokes(){
  const b = currentBoard();
  if (!b) return;

  ctx.save();
  ctx.setTransform(view.scale, 0, 0, view.scale, view.tx, view.ty);

  for (const s of b.strokes){
    if (!isLayerVisible(s.layer)) continue;

    if (s.kind === "text"){
      ctx.fillStyle = "rgba(0,0,0,0.92)";
      ctx.font = "900 24px system-ui";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(s.text || "NOTE", s.x, s.y);
      continue;
    }

    if (!s.points || s.points.length < 2) continue;

    ctx.lineWidth = s.kind === "route" ? 5 : 7;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i=1;i<s.points.length;i++) ctx.lineTo(s.points[i].x, s.points[i].y);
    ctx.stroke();

    if (s.kind === "route"){
      const a = s.points[s.points.length-2];
      const bpt = s.points[s.points.length-1];
      drawArrowHead(a,bpt);
    }
  }

  ctx.restore();
}

function drawArrowHead(a,b){
  const angle = Math.atan2(b.y-a.y, b.x-a.x);
  const headLen = 18;
  ctx.fillStyle = "rgba(0,0,0,0.9)";
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - headLen*Math.cos(angle - Math.PI/7), b.y - headLen*Math.sin(angle - Math.PI/7));
  ctx.lineTo(b.x - headLen*Math.cos(angle + Math.PI/7), b.y - headLen*Math.sin(angle + Math.PI/7));
  ctx.closePath();
  ctx.fill();
}

// --------- Render ----------
function render(){
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,canvas.width, canvas.height);
  drawField();
  drawStrokes();
  drawPlayers();
}

// --------- Hit testing ----------
function hitPlayer(worldPt){
  const b = currentBoard();
  if (!b) return null;
  for (let i=b.players.length-1;i>=0;i--){
    const p = b.players[i];
    if (!isLayerVisible(p.layer)) continue;
    const dx = worldPt.x - p.x, dy = worldPt.y - p.y;
    if (Math.sqrt(dx*dx+dy*dy) <= p.r + 8) return p;
  }
  return null;
}

// --------- Add helpers ----------
function addPlayerAt(x,y,label,side){
  const b = currentBoard();
  if (!b) return;
  b.players.push({
    id: crypto.randomUUID(),
    x,y,r:28,
    label: (label||"X").toUpperCase().slice(0,4),
    side: side || "O",
    layer: activeLayer
  });
  markBoardUpdated();
}
function addTextAt(x,y,text){
  const b = currentBoard();
  if (!b) return;
  b.strokes.push({
    id: crypto.randomUUID(),
    kind:"text",
    layer: activeLayer,
    x,y,
    text: (text || "NOTE").slice(0,40)
  });
  markBoardUpdated();
}

// --------- Pointer/Touch Gestures (pinch to zoom + pan) ----------
function dist(a,b){
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx*dx + dy*dy);
}
function midpoint(a,b){
  return { x:(a.x+b.x)/2, y:(a.y+b.y)/2 };
}

// Start tracking pointers on the canvas
canvas.addEventListener("pointerdown", (e)=>{
  canvas.setPointerCapture(e.pointerId);
  const pt = canvasPointFromEvent(e);
  pointers.set(e.pointerId, pt);

  // If 2 pointers -> start pinch
  if (pointers.size === 2){
    const [p1, p2] = Array.from(pointers.values());
    pinch.active = true;
    pinch.panOnly = false;
    pinch.startDist = dist(p1,p2);
    pinch.startScale = view.scale;
    pinch.startTx = view.tx;
    pinch.startTy = view.ty;
    pinch.mid = midpoint(p1,p2);
    return;
  }

  // If 1 pointer and NOT pinch: treat as normal actions
  const screenPt = pt;
  const w = toWorld(screenPt);

  // If film is on: allow one-finger pan easily (quality of life)
  // (Also works normally)
  if (!pinch.active && (e.pointerType === "touch")){
    // We’ll allow one-finger panning when NOT actively drawing routes/blocks/text
    if (tool === "select"){
      pinch.panOnly = true;
      isPanning = true;
      panStart = { x: screenPt.x, y: screenPt.y, tx: view.tx, ty: view.ty };
      // Still allow selecting/moving players by tapping — if you move, it becomes pan.
    }
  }

  // Desktop spacebar pan mode
  if (isPanningMode){
    isPanning = true;
    panStart = { x: screenPt.x, y: screenPt.y, tx: view.tx, ty: view.ty };
    return;
  }

  const b = currentBoard();
  if (!b) return;

  if (tool === "select"){
    const p = hitPlayer(w);
    if (p){
      b.selectedId = p.id;
      dragging = true;
      dragOffset = { x: w.x - p.x, y: w.y - p.y };
      render();
      return;
    }

    if (dropMode){
      snapshotBoard();
      addPlayerAt(w.x, w.y, activeStencilLabel, activeStencilTab);
      b.selectedId = null;
      render();
      return;
    }

    b.selectedId = null;
    render();
    return;
  }

  if (tool === "text"){
    const txt = prompt("Text label (short):", "NOTE");
    if (txt !== null){
      snapshotBoard();
      addTextAt(w.x, w.y, txt);
      render();
    }
    return;
  }

  snapshotBoard();
  drawingStroke = { id: crypto.randomUUID(), kind: tool, layer: activeLayer, points:[{x:w.x,y:w.y}] };
  b.strokes.push(drawingStroke);
  render();
});

canvas.addEventListener("pointermove", (e)=>{
  if (!pointers.has(e.pointerId)) return;
  const pt = canvasPointFromEvent(e);
  pointers.set(e.pointerId, pt);

  // Pinch zoom when 2 fingers are down
  if (pinch.active && pointers.size === 2){
    const [p1,p2] = Array.from(pointers.values());
    const d = Math.max(10, dist(p1,p2));
    const scale = clampScale(pinch.startScale * (d / pinch.startDist));

    // Zoom around the pinch midpoint (screen coords)
    const mid = midpoint(p1,p2);
    const before = toWorld(mid);

    view.scale = scale;

    const after = toWorld(mid);
    view.tx += (after.x - before.x) * view.scale;
    view.ty += (after.y - before.y) * view.scale;

    render();
    return;
  }

  // One finger pan (touch) if enabled OR desktop spacebar pan
  if (isPanning){
    const screenPt = pt;
    view.tx = panStart.tx + (screenPt.x - panStart.x);
    view.ty = panStart.ty + (screenPt.y - panStart.y);
    render();
    return;
  }

  const b = currentBoard();
  if (!b) return;

  const w = toWorld(pt);

  if (tool === "select" && dragging && b.selectedId){
    const p = b.players.find(x=>x.id===b.selectedId);
    if (!p) return;
    p.x = w.x - dragOffset.x;
    p.y = w.y - dragOffset.y;
    markBoardUpdated();
    render();
  }

  if ((tool==="route" || tool==="block") && drawingStroke){
    const last = drawingStroke.points[drawingStroke.points.length-1];
    const dx = w.x-last.x, dy = w.y-last.y;
    if ((dx*dx+dy*dy) > 6*6) drawingStroke.points.push({x:w.x,y:w.y});
    markBoardUpdated();
    render();
  }
});

canvas.addEventListener("pointerup", (e)=>{
  pointers.delete(e.pointerId);

  if (pointers.size < 2){
    pinch.active = false;
  }
  if (pointers.size === 0){
    isPanning = false;
    pinch.panOnly = false;
  }

  dragging = false;
  drawingStroke = null;
});

canvas.addEventListener("pointercancel", (e)=>{
  pointers.delete(e.pointerId);
  pinch.active = false;
  isPanning = false;
  dragging = false;
  drawingStroke = null;
});

// Desktop wheel zoom
canvas.addEventListener("wheel", (e)=>{
  e.preventDefault();
  const delta = Math.sign(e.deltaY);
  const zoomFactor = delta > 0 ? 0.92 : 1.08;

  const mouse = canvasPointFromEvent(e);
  const before = toWorld(mouse);

  view.scale = clampScale(view.scale * zoomFactor);

  const after = toWorld(mouse);
  view.tx += (after.x - before.x) * view.scale;
  view.ty += (after.y - before.y) * view.scale;

  render();
},{ passive:false });

// Spacebar pan mode (desktop)
window.addEventListener("keydown", (e)=>{
  if (e.code === "Space"){
    isPanningMode = true;
    canvas.style.cursor = "grab";
  }
});
window.addEventListener("keyup", (e)=>{
  if (e.code === "Space"){
    isPanningMode = false;
    canvas.style.cursor = "default";
  }
});

// --------- Tools/UI ----------
function setTool(next){
  tool = next;
  toolSelectBtn.classList.toggle("active", tool==="select");
  toolRouteBtn.classList.toggle("active", tool==="route");
  toolBlockBtn.classList.toggle("active", tool==="block");
  toolTextBtn.classList.toggle("active", tool==="text");
}
toolSelectBtn.onclick = ()=> setTool("select");
toolRouteBtn.onclick  = ()=> setTool("route");
toolBlockBtn.onclick  = ()=> setTool("block");
toolTextBtn.onclick   = ()=> setTool("text");

undoBtn.onclick = ()=> undo();
redoBtn.onclick = ()=> redo();

activeLayerEl.onchange = ()=> { activeLayer = activeLayerEl.value; toast(`Active layer: ${activeLayer}`); };
showBaseEl.onchange = ()=> { showLayer.base = showBaseEl.checked; render(); };
showTagsEl.onchange = ()=> { showLayer.tags = showTagsEl.checked; render(); };
showAdjEl.onchange  = ()=> { showLayer.adj  = showAdjEl.checked; render(); };

dropModeBtn.onclick = ()=>{
  dropMode = !dropMode;
  dropModeBtn.classList.toggle("active", dropMode);
  dropModeBtn.textContent = dropMode ? "Drop on Tap" : "Drop Off";
};

// Sidebar toggle
toggleSidebarBtn.onclick = ()=>{
  const ui = loadUI();
  ui.sidebarHidden = !ui.sidebarHidden;
  saveUI(ui);

  appMain.classList.toggle("sidebarHidden", ui.sidebarHidden);
  toggleSidebarBtn.textContent = ui.sidebarHidden ? "Show Panel" : "Hide Panel";
};

// Film toggle
toggleFilmViewBtn.onclick = ()=>{
  filmOn = !filmOn;
  filmPane.classList.toggle("hidden", !filmOn);
  toggleFilmViewBtn.classList.toggle("active", filmOn);
  toggleFilmViewBtn.textContent = filmOn ? "Film View On" : "Film View";
};

// Tabs
function setTab(tab){
  tabBtns.forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  panels.forEach(p => p.classList.toggle("hidden", p.dataset.panel !== tab));
}
tabBtns.forEach(b => b.addEventListener("click", ()=> setTab(b.dataset.tab)));

// Status
function toast(msg){
  statusEl.textContent = msg;
  setTimeout(updateStatus, 1400);
}
function updateStatus(){
  statusEl.textContent = navigator.onLine ? "Online (cached for offline)" : "Offline (running from cache)";
}

// --------- Library ----------
function refreshBoardPicker(){
  boardPicker.innerHTML = "";
  for (const b of appData.boards){
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = b.name;
    boardPicker.appendChild(opt);
  }
  boardPicker.value = appData.currentBoardId;
  boardNameEl.value = currentBoard()?.name || "";
}

boardPicker.onchange = async ()=>{
  appData.currentBoardId = boardPicker.value;
  saveApp();
  boardNameEl.value = currentBoard()?.name || "";
  await renderClipLists();
  render();
};

newBoardBtn.onclick = async ()=>{
  const b = newEmptyBoard(`Board ${appData.boards.length+1}`);
  appData.boards.unshift(b);
  appData.currentBoardId = b.id;
  saveApp();
  refreshBoardPicker();
  snapshotBoard();
  await renderClipLists();
  render();
  toast("New board created.");
};

saveBoardNameBtn.onclick = ()=>{
  const b = currentBoard();
  if (!b) return;
  b.name = (boardNameEl.value || "Untitled").slice(0,40);
  saveApp();
  refreshBoardPicker();
  toast("Renamed.");
};

duplicateBoardBtn.onclick = async ()=>{
  const b = currentBoard();
  if (!b) return;
  const copy = newEmptyBoard(`${b.name} (Copy)`);
  copy.players = JSON.parse(JSON.stringify(b.players));
  copy.strokes = JSON.parse(JSON.stringify(b.strokes));
  copy.clipIds = [...(b.clipIds || [])];
  appData.boards.unshift(copy);
  appData.currentBoardId = copy.id;
  saveApp();
  refreshBoardPicker();
  await renderClipLists();
  render();
  toast("Duplicated.");
};

deleteBoardBtn.onclick = async ()=>{
  if (appData.boards.length <= 1) return toast("Keep at least 1 board.");
  const b = currentBoard();
  if (!b) return;
  const ok = confirm(`Delete "${b.name}"?`);
  if (!ok) return;
  appData.boards = appData.boards.filter(x => x.id !== b.id);
  appData.currentBoardId = appData.boards[0].id;
  saveApp();
  refreshBoardPicker();
  await renderClipLists();
  render();
  toast("Deleted.");
};

// --------- Templates ----------
const TEMPLATES = [
  { id:"O_2x2", name:"Offense 2x2", badge:"O", build:()=> buildOffense2x2() },
  { id:"O_3x1", name:"Offense Trips 3x1", badge:"O", build:()=> buildOffense3x1() },
  { id:"O_bunch", name:"Offense Bunch", badge:"O", build:()=> buildOffenseBunch() },
  { id:"O_empty", name:"Offense Empty", badge:"O", build:()=> buildOffenseEmpty() },
  { id:"ST_punt", name:"Punt (basic)", badge:"ST", build:()=> buildPunt() },
  { id:"ST_kickoff", name:"Kickoff (basic)", badge:"ST", build:()=> buildKickoff() }
];

function initTemplateList(){
  templateListEl.innerHTML = "";
  for (const t of TEMPLATES){
    const btn = document.createElement("button");
    btn.className = "templateBtn";
    btn.innerHTML = `<span>${t.name}</span><span class="badge">${t.badge}</span>`;
    btn.onclick = ()=> applyTemplate(t);
    templateListEl.appendChild(btn);
  }
}

function applyTemplate(t){
  const b = currentBoard();
  if (!b) return;

  snapshotBoard();
  const tpl = t.build();
  const mode = templateModeEl.value;

  if (mode === "replace"){
    b.players = tpl.players;
    b.strokes = tpl.strokes;
    b.selectedId = null;
  } else {
    b.players.push(...tpl.players);
    b.strokes.push(...tpl.strokes);
  }

  markBoardUpdated();
  render();
  toast(`Applied: ${t.name}`);
}

function baseFieldAnchors(){
  const margin=86;
  const top=margin, left=margin, right=canvas.width-margin, bottom=canvas.height-margin;
  const midX=(left+right)/2;
  const midY=(top+bottom)/2;
  const hashInset=210;
  const hashX1 = left + hashInset;
  const hashX2 = right - hashInset;
  return {top,left,right,bottom,midX,midY,hashX1,hashX2};
}
function mkP(x,y,label,side,layer="base"){
  return { id:crypto.randomUUID(), x,y, r:28, label, side, layer };
}
function buildOffense2x2(){
  const a = baseFieldAnchors();
  const losY = a.midY + 10;
  const players = [
    mkP(a.midX, losY+60, "QB", "O"),
    mkP(a.midX-60, losY+95, "RB", "O"),
    mkP(a.midX-40, losY, "C", "O"),
    mkP(a.midX-95, losY, "LG", "O"),
    mkP(a.midX-150, losY, "LT", "O"),
    mkP(a.midX+95, losY, "RG", "O"),
    mkP(a.midX+150, losY, "RT", "O"),
    mkP(a.hashX1-25, losY-140, "X", "O"),
    mkP(a.hashX1+55, losY-70, "Y", "O"),
    mkP(a.hashX2+25, losY-140, "Z", "O"),
    mkP(a.hashX2-55, losY-70, "H", "O"),
  ];
  return { players, strokes:[] };
}
function buildOffense3x1(){
  const a = baseFieldAnchors();
  const losY = a.midY + 10;
  const players = [
    mkP(a.midX, losY+60, "QB", "O"),
    mkP(a.midX-60, losY+95, "RB", "O"),
    mkP(a.midX-40, losY, "C", "O"),
    mkP(a.midX-95, losY, "LG", "O"),
    mkP(a.midX-150, losY, "LT", "O"),
    mkP(a.midX+95, losY, "RG", "O"),
    mkP(a.midX+150, losY, "RT", "O"),
    mkP(a.hashX2+25, losY-160, "X", "O"),
    mkP(a.hashX2-30, losY-105, "Y", "O"),
    mkP(a.hashX2-85, losY-50, "H", "O"),
    mkP(a.hashX1-25, losY-160, "Z", "O"),
  ];
  return { players, strokes:[] };
}
function buildOffenseBunch(){
  const a = baseFieldAnchors();
  const losY = a.midY + 10;
  const players = [
    mkP(a.midX, losY+60, "QB", "O"),
    mkP(a.midX-60, losY+95, "RB", "O"),
    mkP(a.midX-40, losY, "C", "O"),
    mkP(a.midX-95, losY, "LG", "O"),
    mkP(a.midX-150, losY, "LT", "O"),
    mkP(a.midX+95, losY, "RG", "O"),
    mkP(a.midX+150, losY, "RT", "O"),
    mkP(a.hashX2-20, losY-135, "X", "O"),
    mkP(a.hashX2-70, losY-95, "Y", "O"),
    mkP(a.hashX2-40, losY-55, "H", "O"),
    mkP(a.hashX1-25, losY-160, "Z", "O"),
  ];
  return { players, strokes:[] };
}
function buildOffenseEmpty(){
  const a = baseFieldAnchors();
  const losY = a.midY + 10;
  const players = [
    mkP(a.midX, losY+60, "QB", "O"),
    mkP(a.midX-40, losY, "C", "O"),
    mkP(a.midX-95, losY, "LG", "O"),
    mkP(a.midX-150, losY, "LT", "O"),
    mkP(a.midX+95, losY, "RG", "O"),
    mkP(a.midX+150, losY, "RT", "O"),
    mkP(a.hashX1-25, losY-160, "X", "O"),
    mkP(a.hashX1+55, losY-95, "Y", "O"),
    mkP(a.hashX2+25, losY-160, "Z", "O"),
    mkP(a.hashX2-55, losY-95, "H", "O"),
    mkP(a.midX, losY-210, "RB", "O"),
  ];
  return { players, strokes:[] };
}
function buildPunt(){
  const a = baseFieldAnchors();
  const losY = a.midY + 10;
  const players = [
    mkP(a.midX, losY+90, "P", "ST"),
    mkP(a.midX, losY+45, "PP", "ST"),
    mkP(a.midX-40, losY, "LS", "ST"),
    mkP(a.midX-95, losY, "G", "ST"),
    mkP(a.midX-150, losY, "T", "ST"),
    mkP(a.midX+95, losY, "G", "ST"),
    mkP(a.midX+150, losY, "T", "ST"),
    mkP(a.hashX1, losY-120, "GUN", "ST"),
    mkP(a.hashX2, losY-120, "GUN", "ST"),
  ];
  return { players, strokes:[] };
}
function buildKickoff(){
  const a = baseFieldAnchors();
  const y = a.midY + 10;
  const players = [
    mkP(a.midX, y+90, "K", "ST"),
    mkP(a.left+220, y, "L5", "ST"),
    mkP(a.left+360, y, "L4", "ST"),
    mkP(a.left+500, y, "L3", "ST"),
    mkP(a.midX-120, y, "L2", "ST"),
    mkP(a.midX+120, y, "R2", "ST"),
    mkP(a.right-500, y, "R3", "ST"),
    mkP(a.right-360, y, "R4", "ST"),
    mkP(a.right-220, y, "R5", "ST"),
  ];
  return { players, strokes:[] };
}

// --------- Stencils ----------
function setStencilTab(tab){
  activeStencilTab = tab;
  stencilTabBtns.forEach(b => b.classList.toggle("active", b.dataset.stab === tab));
  buildStencilGrid();
}
function setActiveStencil(label){
  activeStencilLabel = label;
  Array.from(document.querySelectorAll(".stencilBtn")).forEach(btn=>{
    btn.classList.toggle("active", btn.dataset.label === label);
  });
  toast(`Stencil: ${label}`);
}
function buildStencilGrid(){
  stencilGrid.innerHTML = "";
  const labels = STENCILS[activeStencilTab] || [];
  for (const lbl of labels){
    const btn = document.createElement("button");
    btn.className = "stencilBtn";
    btn.textContent = lbl;
    btn.dataset.label = lbl;
    btn.onclick = ()=> setActiveStencil(lbl);
    stencilGrid.appendChild(btn);
  }
  setActiveStencil(labels[0] || "X");
}
stencilTabBtns.forEach(b => b.addEventListener("click", ()=> setStencilTab(b.dataset.stab)));

// --------- Practice ----------
function renderPractice(){
  practiceDateEl.value = appData.practice.date || "";
  periodListEl.innerHTML = "";
  appData.practice.periods ||= [];

  appData.practice.periods.forEach((p, idx)=>{
    const wrap = document.createElement("div");
    wrap.className = "period";
    wrap.innerHTML = `
      <div class="periodTop">
        <input class="periodSmall" data-k="time" value="${escapeHtml(p.time||"")}" placeholder="Time" />
        <input class="periodSmall" data-k="title" value="${escapeHtml(p.title||"")}" placeholder="Period title" />
        <button class="iconBtn" title="Delete">✕</button>
      </div>
      <textarea class="input periodNote" rows="2" data-k="note" placeholder="Coaching points / script / emphasis">${escapeHtml(p.note||"")}</textarea>
    `;

    const inputs = Array.from(wrap.querySelectorAll("[data-k]"));
    inputs.forEach(inp=>{
      inp.addEventListener("input", ()=>{
        const k = inp.getAttribute("data-k");
        appData.practice.periods[idx][k] = inp.value;
      });
    });

    wrap.querySelector(".iconBtn").onclick = ()=>{
      appData.practice.periods.splice(idx,1);
      renderPractice();
    };

    periodListEl.appendChild(wrap);
  });
}
addPeriodBtn.onclick = ()=> { appData.practice.periods.push({ time:"", title:"", note:"" }); renderPractice(); };
clearPracticeBtn.onclick = ()=> { if(confirm("Clear practice plan?")){ appData.practice={date:"",periods:[]}; renderPractice(); saveApp(); } };
savePracticeBtn.onclick = ()=> { appData.practice.date = practiceDateEl.value || ""; saveApp(); toast("Practice plan saved."); };

// --------- Export ----------
exportPngBtn.onclick = ()=>{
  const a = document.createElement("a");
  a.download = `${(currentBoard()?.name || "coachboard").replaceAll(" ","_")}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
};
exportPdfBtn.onclick = ()=>{
  const b = currentBoard();
  if (!b) return;
  const img = canvas.toDataURL("image/png");
  const practiceHtml = buildPracticeHtmlForPrint();
  const w = window.open("", "_blank");
  if (!w) return alert("Popup blocked. Allow popups for PDF export.");

  w.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(b.name)} - Export</title>
        <style>
          body{ font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; margin:24px; color:#111; }
          h1{ margin:0 0 6px 0; font-size:20px; }
          .meta{ color:#444; font-weight:700; margin-bottom:14px; }
          .sheet{ display:grid; grid-template-columns: 1fr; gap:16px; }
          .card{ border:1px solid #ddd; border-radius:14px; padding:14px; }
          img{ width:100%; height:auto; border-radius:12px; }
          table{ width:100%; border-collapse:collapse; }
          th,td{ border-bottom:1px solid #eee; padding:8px 6px; text-align:left; vertical-align:top; }
          th{ font-size:12px; color:#444; text-transform:uppercase; letter-spacing:0.4px; }
          .small{ font-size:12px; color:#555; font-weight:700; }
          @media print{ body{ margin:14mm; } .card{ break-inside: avoid; } }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div>
            <h1>${escapeHtml(b.name)}</h1>
            <div class="meta">Exported from CoachBoard • Offline-first</div>
          </div>
          <div class="card">
            <div class="small">Diagram</div>
            <img src="${img}" />
          </div>
          ${practiceHtml}
        </div>
        <script>setTimeout(()=> window.print(), 400);</script>
      </body>
    </html>
  `);
  w.document.close();
};
function buildPracticeHtmlForPrint(){
  const pr = appData.practice || { date:"", periods:[] };
  const periods = pr.periods || [];
  if (periods.length === 0) return "";

  const rows = periods.map(p=>`
    <tr>
      <td style="width:80px"><strong>${escapeHtml(p.time||"")}</strong></td>
      <td style="width:180px"><strong>${escapeHtml(p.title||"")}</strong></td>
      <td>${escapeHtml(p.note||"")}</td>
    </tr>
  `).join("");

  return `
    <div class="card">
      <div class="small">Practice Plan ${pr.date ? "• " + escapeHtml(pr.date) : ""}</div>
      <table>
        <thead><tr><th>Time</th><th>Period</th><th>Notes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// --------- Film ----------
addClipsBtn.onclick = ()=> clipPicker.click();

clipPicker.addEventListener("change", async ()=>{
  const files = Array.from(clipPicker.files || []);
  if (files.length === 0) return;

  const b = currentBoard();
  if (!b) return;

  toast(`Importing ${files.length} clip(s)…`);
  for (const f of files){
    const id = crypto.randomUUID();
    await idbPutClip({
      id,
      name: f.name || "Clip",
      type: f.type || "video/mp4",
      blob: f,
      createdAt: Date.now()
    });
    b.clipIds.push(id);
  }
  saveApp();
  clipPicker.value = "";
  await renderClipLists();
  toast("Clips imported.");
});

clearClipsBtn.onclick = async ()=>{
  const b = currentBoard();
  if (!b) return;
  if (!confirm("Remove all clips from this board? (Deletes offline clips too)")) return;

  for (const id of (b.clipIds || [])) await idbDeleteClip(id);
  b.clipIds = [];
  saveApp();
  stopCurrentClip();
  await renderClipLists();
  toast("Clips cleared.");
};

async function renderClipLists(){
  const b = currentBoard();
  if (!b) return;

  clipListEl.innerHTML = "";
  const clips = await idbListClipsByIds(b.clipIds || []);
  if (clips.length === 0){
    clipListEl.innerHTML = `<div class="hint">No clips yet. Tap Import.</div>`;
  } else {
    for (const c of clips){
      const row = document.createElement("div");
      row.className = "clipRow";
      row.innerHTML = `
        <div>
          <div class="clipName">${escapeHtml(c.name)}</div>
          <div class="clipMeta">${new Date(c.createdAt).toLocaleString()}</div>
        </div>
        <div class="clipBtns">
          <button class="btn small" data-act="play">Play</button>
          <button class="btn small danger" data-act="del">Del</button>
        </div>
      `;
      row.querySelector('[data-act="play"]').onclick = ()=> playClipById(c.id);
      row.querySelector('[data-act="del"]').onclick = async ()=>{
        if (!confirm("Delete this clip?")) return;
        await idbDeleteClip(c.id);
        b.clipIds = (b.clipIds || []).filter(x => x !== c.id);
        saveApp();
        if (currentClipId === c.id) stopCurrentClip();
        await renderClipLists();
      };
      clipListEl.appendChild(row);
    }
  }

  filmMiniList.innerHTML = "";
  if (clips.length === 0){
    filmMiniList.innerHTML = `<div class="hint">No clips yet.</div>`;
  } else {
    for (const c of clips){
      const btn = document.createElement("button");
      btn.className = "filmMiniBtn";
      btn.textContent = c.name;
      btn.classList.toggle("active", c.id === currentClipId);
      btn.onclick = ()=> playClipById(c.id);
      filmMiniList.appendChild(btn);
    }
  }
}

async function playClipById(id){
  const clip = await idbGetClip(id);
  if (!clip) return toast("Clip not found.");

  if (currentClipUrl) URL.revokeObjectURL(currentClipUrl);

  currentClipId = id;
  currentClipUrl = URL.createObjectURL(clip.blob);
  filmPlayer.src = currentClipUrl;

  if (!filmOn){
    filmOn = true;
    filmPane.classList.remove("hidden");
    toggleFilmViewBtn.classList.add("active");
    toggleFilmViewBtn.textContent = "Film View On";
  }

  await filmPlayer.play().catch(()=>{});
  await renderClipLists();
}

function stopCurrentClip(){
  if (currentClipUrl){
    URL.revokeObjectURL(currentClipUrl);
    currentClipUrl = null;
  }
  currentClipId = null;
  filmPlayer.pause();
  filmPlayer.removeAttribute("src");
  filmPlayer.load();
}

// --------- Helpers ----------
function escapeHtml(s){
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
}

// --------- Init ----------
function init(){
  loadApp();
  refreshBoardPicker();
  initTemplateList();

  // Apply saved UI state (sidebar)
  const ui = loadUI();
  appMain.classList.toggle("sidebarHidden", !!ui.sidebarHidden);
  toggleSidebarBtn.textContent = ui.sidebarHidden ? "Show Panel" : "Hide Panel";

  // layers init
  activeLayer = activeLayerEl.value;
  showLayer.base = showBaseEl.checked;
  showLayer.tags = showTagsEl.checked;
  showLayer.adj  = showAdjEl.checked;

  // stencils init
  setStencilTab("O");

  // practice init
  renderPractice();

  // status init
  updateStatus();
  window.addEventListener("online", updateStatus);
  window.addEventListener("offline", updateStatus);

  renderClipLists();

  snapshotBoard();
  render();
}

// --------- Remaining required wiring from earlier versions ----------
function setStencilTab(tab){
  activeStencilTab = tab;
  stencilTabBtns.forEach(b => b.classList.toggle("active", b.dataset.stab === tab));
  buildStencilGrid();
}
function buildStencilGrid(){
  stencilGrid.innerHTML = "";
  const labels = STENCILS[activeStencilTab] || [];
  for (const lbl of labels){
    const btn = document.createElement("button");
    btn.className = "stencilBtn";
    btn.textContent = lbl;
    btn.dataset.label = lbl;
    btn.onclick = ()=> setActiveStencil(lbl);
    stencilGrid.appendChild(btn);
  }
  setActiveStencil(labels[0] || "X");
}
function setActiveStencil(label){
  activeStencilLabel = label;
  Array.from(document.querySelectorAll(".stencilBtn")).forEach(btn=>{
    btn.classList.toggle("active", btn.dataset.label === label);
  });
  toast(`Stencil: ${label}`);
}

function snapshotBoardSeed(){
  snapshotBoard();
}
snapshotBoardSeed();

init();
