// CoachBoard Pro (Offline-first PWA)
// Features: Library boards, Undo/Redo, Zoom/Pan, Layers, Templates, Stencils, Practice plan, PNG + PDF export.

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const statusEl = document.getElementById("status");

// Top toolbar
const undoBtn = document.getElementById("undo");
const redoBtn = document.getElementById("redo");
const toolSelectBtn = document.getElementById("toolSelect");
const toolRouteBtn  = document.getElementById("toolRoute");
const toolBlockBtn  = document.getElementById("toolBlock");
const toolTextBtn   = document.getElementById("toolText");
const exportPngBtn  = document.getElementById("exportPng");
const exportPdfBtn  = document.getElementById("exportPdf");

// Tabs
const tabBtns = Array.from(document.querySelectorAll(".tab"));
const panels  = Array.from(document.querySelectorAll(".tabPanel"));

// Library
const newBoardBtn = document.getElementById("newBoard");
const boardPicker = document.getElementById("boardPicker");
const boardNameEl = document.getElementById("boardName");
const saveBoardNameBtn = document.getElementById("saveBoardName");
const duplicateBoardBtn = document.getElementById("duplicateBoard");
const deleteBoardBtn = document.getElementById("deleteBoard");

// Templates
const templateModeEl = document.getElementById("templateMode");
const templateListEl = document.getElementById("templateList");

// Stencils & layers
const activeLayerEl = document.getElementById("activeLayer");
const showBaseEl = document.getElementById("showBase");
const showTagsEl = document.getElementById("showTags");
const showAdjEl  = document.getElementById("showAdj");
const dropModeBtn = document.getElementById("dropMode");

const stencilTabBtns = Array.from(document.querySelectorAll(".tabBtn"));
const stencilGrid = document.getElementById("stencilGrid");

// Practice
const practiceDateEl = document.getElementById("practiceDate");
const addPeriodBtn = document.getElementById("addPeriod");
const periodListEl = document.getElementById("periodList");
const clearPracticeBtn = document.getElementById("clearPractice");
const savePracticeBtn = document.getElementById("savePractice");

// Storage keys
const STORAGE = {
  app: "coachboard_pro_v1",
};

// --------- App State ----------
let tool = "select"; // select | route | block | text

// View transform (zoom/pan)
let view = { scale: 1.0, tx: 0, ty: 0 };

// Keyboard pan mode
let isPanningMode = false;
let isPanning = false;
let panStart = { x:0, y:0, tx:0, ty:0 };

// Drawing and selection
let dragging = false;
let dragOffset = {x:0,y:0};
let drawingStroke = null;

// Stencil state
const STENCILS = {
  O: ["QB","RB","FB","X","Z","Y","H","LT","LG","C","RG","RT"],
  D: ["E","T","N","S","W","M","R","CB","FS","SS","NB"],
  ST:["P","K","LS","H","GUN","PP","KOR","KR","R5","L5"]
};
let activeStencilTab = "O";
let activeStencilLabel = "QB";
let dropMode = true;

// Layer state
let activeLayer = "base";
let showLayer = { base:true, tags:true, adj:true };

// App data: multiple boards + practice plan
let appData = {
  currentBoardId: null,
  boards: [],
  practice: { date:"", periods:[] } // {time,title,note}
};

function newEmptyBoard(name="New Board"){
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    players: [], // {id,x,y,r,label,side,layer}
    strokes: [], // {id,kind,layer,points:[{x,y}], text?:string}
    selectedId: null,
    undo: [],
    redo: []
  };
}

function currentBoard(){
  return appData.boards.find(b => b.id === appData.currentBoardId) || null;
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
    // safety defaults
    if (!appData.boards || appData.boards.length === 0){
      appData.boards = [newEmptyBoard("Board 1")];
      appData.currentBoardId = appData.boards[0].id;
    }
    if (!appData.currentBoardId) appData.currentBoardId = appData.boards[0].id;

    // ensure undo/redo arrays exist
    for (const b of appData.boards){
      b.undo ||= [];
      b.redo ||= [];
      b.players ||= [];
      b.strokes ||= [];
      b.selectedId ||= null;
    }
    appData.practice ||= { date:"", periods:[] };
  } catch {
    // reset on bad data
    appData = { currentBoardId:null, boards:[newEmptyBoard("Board 1")], practice:{date:"", periods:[]} };
    appData.currentBoardId = appData.boards[0].id;
  }
}

function saveApp(){
  // strip transient selection? keep it fine
  localStorage.setItem(STORAGE.app, JSON.stringify(appData));
}

function markBoardUpdated(){
  const b = currentBoard();
  if (!b) return;
  b.updatedAt = Date.now();
  saveApp();
}

// --------- Undo/Redo ----------
function snapshotBoard(){
  const b = currentBoard();
  if (!b) return;
  // keep snapshots small: store players/strokes only
  const snap = JSON.stringify({ players: b.players, strokes: b.strokes });
  b.undo.push(snap);
  if (b.undo.length > 50) b.undo.shift();
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
  return {
    x: (pt.x - view.tx) / view.scale,
    y: (pt.y - view.ty) / view.scale
  };
}
function toScreen(pt){
  return {
    x: pt.x * view.scale + view.tx,
    y: pt.y * view.scale + view.ty
  };
}

function canvasPointFromEvent(e){
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  return { x:(e.clientX - rect.left)*scaleX, y:(e.clientY - rect.top)*scaleY };
}

// --------- Drawing: Field ----------
function drawField(){
  // world space field: full canvas, but we draw in world coords by applying transform
  ctx.save();
  ctx.setTransform(view.scale, 0, 0, view.scale, view.tx, view.ty);

  ctx.fillStyle = "#0b3a22";
  ctx.fillRect(0,0,canvas.width, canvas.height);

  const margin = 90;
  const top = margin, left = margin, right = canvas.width - margin, bottom = canvas.height - margin;

  // outer
  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.lineWidth = 4;
  ctx.strokeRect(left, top, right-left, bottom-top);

  // midfield
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo((left+right)/2, top);
  ctx.lineTo((left+right)/2, bottom);
  ctx.stroke();

  // hashes
  const hashInset = 210;
  const hashY1 = top + hashInset;
  const hashY2 = bottom - hashInset;

  ctx.lineWidth = 2;
  for (let x = left; x <= right; x += 60){
    ctx.beginPath(); ctx.moveTo(x, hashY1); ctx.lineTo(x, hashY1 + 14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, hashY2); ctx.lineTo(x, hashY2 - 14); ctx.stroke();
  }

  // yard lines
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  for (let x = left; x <= right; x += 120){
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
  }

  // LOS guide
  ctx.setLineDash([10,10]);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.moveTo((left+right)/2 - 260, (top+bottom)/2);
  ctx.lineTo((left+right)/2 + 260, (top+bottom)/2);
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

// --------- Drawing: Players/Strokes ----------
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
  // Clear in screen space
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

// --------- Canvas interactions ----------
canvas.addEventListener("pointerdown", (e)=>{
  canvas.setPointerCapture(e.pointerId);
  const screenPt = canvasPointFromEvent(e);
  const w = toWorld(screenPt);

  // Pan mode (Spacebar)
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

    // drop stencil if enabled
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

  // route/block drawing
  snapshotBoard();
  drawingStroke = { id: crypto.randomUUID(), kind: tool, layer: activeLayer, points:[{x:w.x,y:w.y}] };
  b.strokes.push(drawingStroke);
  render();
});

canvas.addEventListener("pointermove", (e)=>{
  const screenPt = canvasPointFromEvent(e);

  if (isPanning){
    view.tx = panStart.tx + (screenPt.x - panStart.x);
    view.ty = panStart.ty + (screenPt.y - panStart.y);
    render();
    return;
  }

  const b = currentBoard();
  if (!b) return;

  const w = toWorld(screenPt);

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

canvas.addEventListener("pointerup", ()=>{
  dragging = false;
  drawingStroke = null;
  isPanning = false;
});

// Zoom (wheel)
canvas.addEventListener("wheel", (e)=>{
  e.preventDefault();
  const delta = Math.sign(e.deltaY);
  const zoomFactor = delta > 0 ? 0.92 : 1.08;

  const mouse = canvasPointFromEvent(e);
  const before = toWorld(mouse);

  view.scale = Math.min(2.2, Math.max(0.55, view.scale * zoomFactor));

  const after = toWorld(mouse);
  // keep point under mouse stable
  view.tx += (after.x - before.x) * view.scale;
  view.ty += (after.y - before.y) * view.scale;

  render();
},{ passive:false });

// Spacebar pan mode
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

// --------- Tools & UI ----------
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

function toast(msg){
  statusEl.textContent = msg;
  setTimeout(updateStatus, 1200);
}
function updateStatus(){
  statusEl.textContent = navigator.onLine ? "Online (cached for offline)" : "Offline (running from cache)";
}

// --------- Tabs ----------
function setTab(tab){
  tabBtns.forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  panels.forEach(p => p.classList.toggle("hidden", p.dataset.panel !== tab));
}
tabBtns.forEach(b => b.addEventListener("click", ()=> setTab(b.dataset.tab)));

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

boardPicker.onchange = ()=>{
  appData.currentBoardId = boardPicker.value;
  saveApp();
  boardNameEl.value = currentBoard()?.name || "";
  render();
};

newBoardBtn.onclick = ()=>{
  const b = newEmptyBoard(`Board ${appData.boards.length+1}`);
  appData.boards.unshift(b);
  appData.currentBoardId = b.id;
  saveApp();
  refreshBoardPicker();
  snapshotBoard(); // start undo history
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

duplicateBoardBtn.onclick = ()=>{
  const b = currentBoard();
  if (!b) return;
  const copy = newEmptyBoard(`${b.name} (Copy)`);
  copy.players = JSON.parse(JSON.stringify(b.players));
  copy.strokes = JSON.parse(JSON.stringify(b.strokes));
  appData.boards.unshift(copy);
  appData.currentBoardId = copy.id;
  saveApp();
  refreshBoardPicker();
  render();
  toast("Duplicated.");
};

deleteBoardBtn.onclick = ()=>{
  if (appData.boards.length <= 1) return toast("Keep at least 1 board.");
  const b = currentBoard();
  if (!b) return;
  const ok = confirm(`Delete "${b.name}"?`);
  if (!ok) return;
  appData.boards = appData.boards.filter(x => x.id !== b.id);
  appData.currentBoardId = appData.boards[0].id;
  saveApp();
  refreshBoardPicker();
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

// Template builders (simple but clean)
function baseFieldAnchors(){
  const margin=90;
  const top=margin, left=margin, right=canvas.width-margin, bottom=canvas.height-margin;
  const midX=(left+right)/2;
  const midY=(top+bottom)/2;
  const hashInset=210;
  const hashY1=top+hashInset;
  const hashY2=bottom-hashInset;
  return {top,left,right,bottom,midX,midY,hashY1,hashY2};
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

    mkP(a.left+240, a.hashY1-10, "X", "O"),
    mkP(a.left+360, a.hashY1+45, "Y", "O"),
    mkP(a.right-240, a.hashY1-10, "Z", "O"),
    mkP(a.right-360, a.hashY1+45, "H", "O"),
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

    // Trips right
    mkP(a.right-260, a.hashY1-10, "X", "O"),
    mkP(a.right-360, a.hashY1+35, "Y", "O"),
    mkP(a.right-450, a.hashY1+80, "H", "O"),
    // Single left
    mkP(a.left+260, a.hashY1-10, "Z", "O"),
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
    // Bunch right
    mkP(a.right-300, a.hashY1+15, "X", "O"),
    mkP(a.right-340, a.hashY1+55, "Y", "O"),
    mkP(a.right-380, a.hashY1+95, "H", "O"),
    // single left
    mkP(a.left+260, a.hashY1-10, "Z", "O"),
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

    mkP(a.left+240, a.hashY1-10, "X", "O"),
    mkP(a.left+360, a.hashY1+45, "Y", "O"),
    mkP(a.right-240, a.hashY1-10, "Z", "O"),
    mkP(a.right-360, a.hashY1+45, "H", "O"),
    mkP(a.midX, a.hashY2-40, "RB", "O"), // motion slot / empty marker
  ];
  return { players, strokes:[] };
}
function buildPunt(){
  const a = baseFieldAnchors();
  const losY = a.midY + 10;

  const players = [
    mkP(a.midX, losY+80, "P", "ST"),
    mkP(a.midX, losY+35, "PP", "ST"),
    mkP(a.midX-40, losY, "LS", "ST"),
    mkP(a.midX-95, losY, "G", "ST"),
    mkP(a.midX-150, losY, "T", "ST"),
    mkP(a.midX+95, losY, "G", "ST"),
    mkP(a.midX+150, losY, "T", "ST"),
    mkP(a.left+260, a.hashY1+20, "GUN", "ST"),
    mkP(a.right-260, a.hashY1+20, "GUN", "ST"),
  ];
  return { players, strokes:[] };
}
function buildKickoff(){
  const a = baseFieldAnchors();
  const y = a.midY + 10;
  const players = [
    mkP(a.midX, y+80, "K", "ST"),
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

    // input handlers
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

addPeriodBtn.onclick = ()=>{
  appData.practice.periods.push({ time:"", title:"", note:"" });
  renderPractice();
};

clearPracticeBtn.onclick = ()=>{
  if (!confirm("Clear practice plan?")) return;
  appData.practice = { date:"", periods:[] };
  renderPractice();
  saveApp();
};

savePracticeBtn.onclick = ()=>{
  appData.practice.date = practiceDateEl.value || "";
  saveApp();
  toast("Practice plan saved.");
};

// --------- Export ----------
exportPngBtn.onclick = ()=>{
  // Export current canvas as PNG (screen representation)
  const a = document.createElement("a");
  a.download = `${(currentBoard()?.name || "coachboard").replaceAll(" ","_")}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
};

exportPdfBtn.onclick = ()=>{
  // Create a print-friendly HTML page with diagram image + practice plan
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
          @media print{
            body{ margin:14mm; }
            .card{ break-inside: avoid; }
          }
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
        <script>
          setTimeout(()=> window.print(), 400);
        </script>
      </body>
    </html>
  `);
  w.document.close();
};

function buildPracticeHtmlForPrint(){
  const pr = appData.practice || { date:"", periods:[] };
  const periods = pr.periods || [];
  if (periods.length === 0) return "";

  const rows = periods.map(p=>{
    return `
      <tr>
        <td style="width:80px"><strong>${escapeHtml(p.time||"")}</strong></td>
        <td style="width:180px"><strong>${escapeHtml(p.title||"")}</strong></td>
        <td>${escapeHtml(p.note||"")}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="card">
      <div class="small">Practice Plan ${pr.date ? "• " + escapeHtml(pr.date) : ""}</div>
      <table>
        <thead>
          <tr><th>Time</th><th>Period</th><th>Notes</th></tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

// --------- Helpers ----------
