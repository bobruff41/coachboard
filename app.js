// CoachBoard MVP: field + players + routes/blocks + offline save/load + PNG export
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const toolSelectBtn = document.getElementById("toolSelect");
const toolRouteBtn  = document.getElementById("toolRoute");
const toolBlockBtn  = document.getElementById("toolBlock");
const addPlayerBtn  = document.getElementById("addPlayer");
const clearAllBtn   = document.getElementById("clearAll");
const saveBtn       = document.getElementById("save");
const loadBtn       = document.getElementById("load");
const exportPngBtn  = document.getElementById("exportPng");

const playerLabelEl = document.getElementById("playerLabel");
const playerSideEl  = document.getElementById("playerSide");
const offlineStatus = document.getElementById("offlineStatus");

let tool = "select"; // select | route | block

// Simple model (objects like Visio)
const state = {
  players: [],   // {id,x,y,r,label,side}
  strokes: [],   // {kind:'route'|'block', points:[{x,y},...]}
  selectedPlayerId: null
};

const STORAGE_KEY = "coachboard_v1";

// ---------- Field drawing ----------
function drawField() {
  // background
  ctx.fillStyle = "#0b3a22";
  ctx.fillRect(0,0,canvas.width, canvas.height);

  // grid / landmarks (hash + numbers-ish)
  const margin = 80;
  const top = margin, left = margin, right = canvas.width - margin, bottom = canvas.height - margin;

  // outer lines
  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.lineWidth = 4;
  ctx.strokeRect(left, top, right-left, bottom-top);

  // midfield line
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo((left+right)/2, top);
  ctx.lineTo((left+right)/2, bottom);
  ctx.stroke();

  // hashes (two horizontal rows)
  const hashInset = 190;
  const hashY1 = top + hashInset;
  const hashY2 = bottom - hashInset;

  ctx.lineWidth = 2;
  for (let x = left; x <= right; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, hashY1);
    ctx.lineTo(x, hashY1 + 14);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x, hashY2);
    ctx.lineTo(x, hashY2 - 14);
    ctx.stroke();
  }

  // yard lines
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  for (let x = left; x <= right; x += 120) {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }

  // LOS guide (dotted)
  ctx.setLineDash([10, 10]);
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.moveTo((left+right)/2 - 240, (top+bottom)/2);
  ctx.lineTo((left+right)/2 + 240, (top+bottom)/2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawPlayers() {
  for (const p of state.players) {
    // color by side (still no “theme colors” needed—just subtle differences)
    const fill = p.side === "O" ? "rgba(255,255,255,0.92)" :
                 p.side === "D" ? "rgba(230,230,230,0.85)" :
                 "rgba(210,210,210,0.80)";

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
    ctx.fillStyle = fill;
    ctx.fill();

    // outline
    ctx.lineWidth = (p.id === state.selectedPlayerId) ? 5 : 3;
    ctx.strokeStyle = (p.id === state.selectedPlayerId) ? "rgba(59,130,246,0.95)" : "rgba(0,0,0,0.75)";
    ctx.stroke();

    // label
    ctx.fillStyle = "rgba(0,0,0,0.92)";
    ctx.font = "bold 22px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(p.label, p.x, p.y);
  }
}

function drawStrokes() {
  for (const s of state.strokes) {
    if (s.points.length < 2) continue;

    ctx.lineWidth = s.kind === "route" ? 5 : 7;
    ctx.strokeStyle = s.kind === "route" ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0.85)";
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i=1;i<s.points.length;i++) ctx.lineTo(s.points[i].x, s.points[i].y);
    ctx.stroke();

    // arrow head for routes
    if (s.kind === "route") {
      const a = s.points[s.points.length-2];
      const b = s.points[s.points.length-1];
      drawArrowHead(a,b);
    }
  }
}

function drawArrowHead(a,b){
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const headLen = 18;
  ctx.fillStyle = "rgba(0,0,0,0.9)";
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - headLen * Math.cos(angle - Math.PI/7), b.y - headLen * Math.sin(angle - Math.PI/7));
  ctx.lineTo(b.x - headLen * Math.cos(angle + Math.PI/7), b.y - headLen * Math.sin(angle + Math.PI/7));
  ctx.closePath();
  ctx.fill();
}

function render() {
  drawField();
  drawStrokes();
  drawPlayers();
}

// ---------- Tools ----------
function setTool(next) {
  tool = next;
  toolSelectBtn.classList.toggle("active", tool==="select");
  toolRouteBtn.classList.toggle("active", tool==="route");
  toolBlockBtn.classList.toggle("active", tool==="block");
  state.selectedPlayerId = null;
  render();
}

toolSelectBtn.onclick = () => setTool("select");
toolRouteBtn.onclick  = () => setTool("route");
toolBlockBtn.onclick  = () => setTool("block");

addPlayerBtn.onclick = () => {
  const label = (playerLabelEl.value || "X").toUpperCase().slice(0,4);
  const side = playerSideEl.value;
  state.players.push({
    id: crypto.randomUUID(),
    x: canvas.width/2,
    y: canvas.height/2,
    r: 28,
    label,
    side
  });
  render();
};

clearAllBtn.onclick = () => {
  state.players = [];
  state.strokes = [];
  state.selectedPlayerId = null;
  render();
};

// ---------- Hit testing + pointer handling ----------
function canvasPointFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top)  * scaleY
  };
}

function hitPlayer(pt) {
  for (let i = state.players.length - 1; i >= 0; i--) {
    const p = state.players[i];
    const dx = pt.x - p.x, dy = pt.y - p.y;
    if (Math.sqrt(dx*dx + dy*dy) <= p.r + 8) return p;
  }
  return null;
}

let dragging = false;
let dragOffset = {x:0,y:0};
let drawingStroke = null;

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  const pt = canvasPointFromEvent(e);

  if (tool === "select") {
    const p = hitPlayer(pt);
    if (p) {
      state.selectedPlayerId = p.id;
      dragging = true;
      dragOffset.x = pt.x - p.x;
      dragOffset.y = pt.y - p.y;
    } else {
      state.selectedPlayerId = null;
    }
    render();
  } else {
    drawingStroke = { kind: tool, points: [pt] };
    state.strokes.push(drawingStroke);
    render();
  }
});

canvas.addEventListener("pointermove", (e) => {
  const pt = canvasPointFromEvent(e);

  if (tool === "select" && dragging && state.selectedPlayerId) {
    const p = state.players.find(x => x.id === state.selectedPlayerId);
    if (!p) return;
    p.x = pt.x - dragOffset.x;
    p.y = pt.y - dragOffset.y;
    render();
  }

  if ((tool === "route" || tool === "block") && drawingStroke) {
    const last = drawingStroke.points[drawingStroke.points.length-1];
    const dx = pt.x - last.x, dy = pt.y - last.y;
    if ((dx*dx + dy*dy) > 6*6) drawingStroke.points.push(pt);
    render();
  }
});

canvas.addEventListener("pointerup", () => {
  dragging = false;
  drawingStroke = null;
});

// ---------- Save / Load / Export ----------
saveBtn.onclick = () => {
  const payload = JSON.stringify({ players: state.players, strokes: state.strokes });
  localStorage.setItem(STORAGE_KEY, payload);
  toast("Saved offline on this iPad/browser.");
};

loadBtn.onclick = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return toast("No saved file found yet.");
  try{
    const obj = JSON.parse(raw);
    state.players = obj.players || [];
    state.strokes = obj.strokes || [];
    state.selectedPlayerId = null;
    render();
    toast("Loaded.");
  } catch {
    toast("Load failed (bad data).");
  }
};

exportPngBtn.onclick = () => {
  const a = document.createElement("a");
  a.download = "coachboard.png";
  a.href = canvas.toDataURL("image/png");
  a.click();
};

function toast(msg){
  offlineStatus.textContent = msg;
  setTimeout(updateOfflineStatus, 1500);
}

// ---------- PWA: service worker ----------
async function registerSW(){
  if (!("serviceWorker" in navigator)) return;
  try{
    await navigator.serviceWorker.register("./sw.js");
  }catch{}
}

function updateOfflineStatus(){
  offlineStatus.textContent = navigator.onLine ? "Online (cached for offline use)" : "Offline (running from cache)";
}

window.addEventListener("online", updateOfflineStatus);
window.addEventListener("offline", updateOfflineStatus);

registerSW();
updateOfflineStatus();
render();
