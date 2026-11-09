const { app, BrowserWindow, screen, ipcMain, Menu, session } = require('electron');
const path = require('path');
const phrases = require('./phrases.json');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

/* ---------- sizes ---------- */
const W = 400; // buddy window (extra transparent room so a tumbling body never clips)
const H = 510;
const FLOOR_PAD = 40; // transparent strip under his feet, hangs below the work area
const BW = 240; // bin window
const BH = 230;
const MARGIN_X = 100; // transparent side margin around the buddy

/* ---------- movement / physics ---------- */
const HOP_SPEED = 120; // px/s while airborne
const HOP_PERIOD = 0.62; // seconds per hop
const HOP_HEIGHT = 46;
const GRAVITY = 2200; // px/s^2 while thrown or dropped
const BOUNCE = 0.62; // energy kept on a wall/floor hit
const THROW_MIN = 650; // release speed (px/s) that counts as a throw
const THROW_MAX = 3600;
const HURT_MIN = 480; // impact speed (px/s) that makes him say ouch

let win = null; // buddy
let binWin = null;
let pos = { x: 100, y: 100 };
let bin = { x: 0, y: 0 };
let target = null;
let mode = 'idle'; // idle | walk | talk | drag | fly | bin
let modeUntil = 0;
let talkDeadline = 0;
let lastSpoke = 0;
let dragOff = { x: 0, y: 0 };
let lastTick = Date.now();
let lastSent = '';
let vel = { x: 0, y: 0 };
let lastHurt = 0;
let hurtCount = 0;
let heldTimer = null;
let nextChatter = Date.now() + 2500; // he speaks on his own, no clicking needed
let hopPhase = 0;
let hopY = 0;
let lastBounds = '';
let lidOpen = false;
let ignoreBinUntil = 0;
let muffleTimer = null;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const alive = (w) => w && !w.isDestroyed();

const floorY = (wa) => wa.y + wa.height - H + FLOOR_PAD;

function workArea() {
  return screen.getDisplayNearestPoint({ x: pos.x + W / 2, y: pos.y + H / 2 }).workArea;
}

function pickTarget() {
  const wa = workArea();
  const x = rand(wa.x - MARGIN_X, wa.x + wa.width - W + MARGIN_X);
  const bottom = floorY(wa);
  const y = Math.random() < 0.65 ? bottom : rand(wa.y - 60, bottom);
  return { x, y };
}

function send(channel, payload) {
  if (alive(win)) win.webContents.send(channel, payload);
}
function sendBin(channel, payload) {
  if (alive(binWin)) binWin.webContents.send(channel, payload);
}

function sendState() {
  const dir = target ? Math.sign(target.x - pos.x) : 0;
  const s = { walking: mode === 'walk', dragging: mode === 'drag', flying: mode === 'fly', dir };
  const key = JSON.stringify(s);
  if (key !== lastSent) {
    lastSent = key;
    send('state', s);
  }
}

function setMode(next, until = 0) {
  mode = next;
  modeUntil = until;
  if (next !== 'walk') hopY = 0;
  sendState();
}

function say(list) {
  const p = pick(list);
  lastSpoke = Date.now();
  nextChatter = lastSpoke + rand(7000, 14000);
  talkDeadline = lastSpoke + p.t.length * 90 + 7000;
  setMode('talk');
  send('say', p);
}

function decide() {
  const now = Date.now();
  if (now >= nextChatter) {
    say(phrases.idle);
  } else {
    target = pickTarget();
    setMode('walk');
  }
}

/* ---------- the bin ---------- */
function placeBin() {
  const wa = screen.getPrimaryDisplay().workArea;
  bin = { x: wa.x + wa.width - BW - 8, y: wa.y + wa.height - BH };
  if (alive(binWin)) binWin.setBounds({ x: bin.x, y: bin.y, width: BW, height: BH });
}

// generous target around the can so dunking him from above counts
function binRect() {
  return { x: bin.x + 50, y: bin.y + 70, w: 140, h: 160 };
}
function bodyPoint() {
  return { x: pos.x + W / 2, y: pos.y + 335 };
}
function overBin() {
  const r = binRect();
  const p = bodyPoint();
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}
function nearBin() {
  const r = binRect();
  const p = bodyPoint();
  return Math.hypot(p.x - (r.x + r.w / 2), p.y - (r.y + r.h / 2)) < 230;
}
function updateLid() {
  const open = (mode === 'drag' || mode === 'fly') && nearBin();
  if (open !== lidOpen) {
    lidOpen = open;
    sendBin('lid', open);
  }
}

function scheduleMuffle() {
  clearTimeout(muffleTimer);
  muffleTimer = setTimeout(() => {
    if (mode !== 'bin') return;
    sendBin('muffled', pick(phrases.bin).t);
    scheduleMuffle();
  }, rand(7000, 15000));
}

function swallow() {
  stopHeldTalk();
  target = null;
  vel = { x: 0, y: 0 };
  lidOpen = false;
  setMode('bin');
  if (alive(win)) win.hide();
  sendBin('swallow');
  scheduleMuffle();
}

// he is flung out of the bin and lands somewhere nearby
function emerge() {
  if (mode !== 'bin') return;
  clearTimeout(muffleTimer);
  pos = { x: bin.x + BW / 2 - W / 2, y: bin.y + 40 };
  vel = { x: rand(-900, -500), y: rand(-1500, -1100) };
  hurtCount = 0;
  ignoreBinUntil = Date.now() + 1500;
  nextChatter = Date.now() + 4000;
  if (alive(win)) {
    win.setBounds({ x: Math.round(pos.x), y: Math.round(pos.y), width: W, height: H });
    win.setIgnoreMouseEvents(true, { forward: true });
    win.showInactive();
  }
  sendBin('emerge');
  setMode('fly');
}

/* ---------- pick up / throw ---------- */
function stopHeldTalk() {
  if (heldTimer) {
    clearInterval(heldTimer);
    heldTimer = null;
  }
}

function startDrag(offset) {
  dragOff = offset;
  target = null;
  vel = { x: 0, y: 0 };
  hurtCount = 0;
  setMode('drag');
  stopHeldTalk();
  setTimeout(() => mode === 'drag' && send('say', { ...pick(phrases.held), held: true }), 700);
  heldTimer = setInterval(() => {
    if (mode !== 'drag') return stopHeldTalk();
    send('say', { ...pick(phrases.held), held: true });
  }, 3200);
}

function endDrag() {
  if (mode !== 'drag') return;
  stopHeldTalk();
  if (Date.now() > ignoreBinUntil && overBin()) return swallow();
  const speed = Math.hypot(vel.x, vel.y);
  if (speed > THROW_MIN) {
    const k = Math.min(1, THROW_MAX / speed);
    vel = { x: vel.x * k, y: vel.y * k };
  } else {
    vel = { x: 0, y: 0 };
  }
  setMode('fly'); // thrown, or let go in mid-air: either way he falls and bounces
}

function hurt(speed) {
  const now = Date.now();
  if (speed < HURT_MIN || now - lastHurt < 650) return;
  lastHurt = now;
  hurtCount++;
  send('say', { ...pick(phrases.hit), hurt: true });
}

function stepFly(dt, now) {
  const wa = workArea();
  const minX = wa.x - MARGIN_X;
  const maxX = wa.x + wa.width - W + MARGIN_X;
  const minY = wa.y - 150; // head touches the top edge
  const maxY = floorY(wa); // feet on the floor

  vel.y += GRAVITY * dt;
  pos.x += vel.x * dt;
  pos.y += vel.y * dt;

  if (now > ignoreBinUntil && overBin()) return swallow();

  if (pos.x < minX) { pos.x = minX; hurt(Math.abs(vel.x)); vel.x = Math.abs(vel.x) * BOUNCE; }
  if (pos.x > maxX) { pos.x = maxX; hurt(Math.abs(vel.x)); vel.x = -Math.abs(vel.x) * BOUNCE; }
  if (pos.y < minY) { pos.y = minY; hurt(Math.abs(vel.y)); vel.y = Math.abs(vel.y) * BOUNCE; }
  if (pos.y >= maxY) {
    pos.y = maxY;
    hurt(Math.abs(vel.y));
    vel.y = vel.y > 300 ? -vel.y * BOUNCE : 0;
    vel.x *= Math.pow(0.01, dt); // floor friction
    if (vel.y === 0 && Math.abs(vel.x) < 25) landed(now);
  }
}

function landed(now) {
  vel = { x: 0, y: 0 };
  target = null;
  const wasHurt = hurtCount > 0;
  hurtCount = 0;
  if (wasHurt) say(phrases.land);
  else if (Math.random() < 0.6) say(phrases.drop);
  else setMode('idle', now + 1200);
}

/* ---------- main loop ---------- */
function tick() {
  const now = Date.now();
  const dt = Math.min(0.05, (now - lastTick) / 1000);
  lastTick = now;

  if (mode === 'bin') return;

  if (mode === 'drag') {
    const c = screen.getCursorScreenPoint();
    const nx = c.x - dragOff.x;
    const ny = c.y - dragOff.y;
    if (dt > 0) {
      vel.x = vel.x * 0.6 + ((nx - pos.x) / dt) * 0.4;
      vel.y = vel.y * 0.6 + ((ny - pos.y) / dt) * 0.4;
    }
    pos.x = nx;
    pos.y = ny;
  } else if (mode === 'fly') {
    stepFly(dt, now);
    if (mode === 'bin') return;
  } else if (mode === 'walk' && target) {
    // hop: parabolic arc, moving forward only while airborne
    hopPhase = (hopPhase + dt / HOP_PERIOD) % 1;
    const air = Math.min(1, hopPhase / 0.8);
    hopY = -4 * HOP_HEIGHT * air * (1 - air);
    const speed = hopPhase < 0.8 ? HOP_SPEED : 0;
    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    const dist = Math.hypot(dx, dy);
    const step = speed * dt;
    if (dist <= Math.max(step, 2)) {
      pos.x = target.x;
      pos.y = target.y;
      target = null;
      setMode('idle', now + rand(1200, 3500));
    } else if (step > 0) {
      pos.x += (dx / dist) * step;
      pos.y += (dy / dist) * step;
    }
    sendState();
    if (target && now >= nextChatter) {
      target = null;
      say(phrases.idle); // stops mid-hop to talk
    }
  } else if (mode === 'talk') {
    if (now > talkDeadline) setMode('idle', now + 1500);
  } else if (mode === 'idle' && now >= modeUntil) {
    decide();
  }

  updateLid();

  if (alive(win)) {
    const b = { x: Math.round(pos.x), y: Math.round(pos.y + hopY), width: W, height: H };
    const key = `${b.x},${b.y}`;
    if (key !== lastBounds) {
      lastBounds = key;
      win.setBounds(b);
    }
  }
}

/* ---------- menus ---------- */
const loginPath = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
const loginItem = () => ({
  label: 'Start with Windows',
  type: 'checkbox',
  checked: app.getLoginItemSettings({ path: loginPath() }).openAtLogin,
  click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, path: loginPath() }),
});

function buddyMenu() {
  return Menu.buildFromTemplate([
    { label: 'Say something', click: () => (mode === 'idle' || mode === 'walk' || mode === 'talk') && say(phrases.idle) },
    { label: 'Throw him in the bin', click: () => (mode !== 'bin') && swallow() },
    loginItem(),
  ]);
}

function binMenu() {
  return Menu.buildFromTemplate([
    { label: 'Let him out', enabled: mode === 'bin', click: () => emerge() },
    loginItem(),
    { type: 'separator' },
    { label: 'Quit Desk Buddy', click: () => app.quit() },
  ]);
}

/* ---------- windows ---------- */
function makeWindow(width, height, file, preloadFile) {
  const w = new BrowserWindow({
    width,
    height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, preloadFile),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
    },
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setIgnoreMouseEvents(true, { forward: true });
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.loadFile(path.join(__dirname, 'renderer', file));
  return w;
}

function createWindows() {
  const wa = screen.getPrimaryDisplay().workArea;

  binWin = makeWindow(BW, BH, 'bin.html', 'binPreload.js');
  placeBin();
  binWin.webContents.once('did-finish-load', () => binWin.showInactive());

  pos = { x: wa.x + rand(0, Math.max(0, wa.width - W - BW)), y: floorY(wa) };
  win = makeWindow(W, H, 'index.html', 'preload.js');
  win.setBounds({ x: Math.round(pos.x), y: Math.round(pos.y), width: W, height: H });
  win.webContents.once('did-finish-load', () => {
    win.showInactive();
    lastTick = Date.now();
    setMode('idle', Date.now() + 1200);
    setInterval(tick, 16);
  });
}

const fromBuddy = (e) => alive(win) && e.sender === win.webContents;
const fromBin = (e) => alive(binWin) && e.sender === binWin.webContents;

/* buddy window events */
ipcMain.on('hit', (e, hit) => {
  if (!fromBuddy(e) || mode === 'drag') return;
  win.setIgnoreMouseEvents(!hit, { forward: true });
});

ipcMain.on('drag-start', (e) => {
  if (!fromBuddy(e) || mode === 'bin') return;
  const c = screen.getCursorScreenPoint();
  startDrag({ x: c.x - pos.x, y: c.y - pos.y });
});

ipcMain.on('drag-end', (e) => {
  if (fromBuddy(e)) endDrag();
});

ipcMain.on('click', (e) => {
  if (!fromBuddy(e) || mode === 'drag' || mode === 'bin') return;
  say(phrases.click);
});

ipcMain.on('say-done', (e) => {
  if (!fromBuddy(e) || mode !== 'talk') return;
  setMode('idle', Date.now() + rand(1500, 3500));
});

ipcMain.on('menu', (e) => {
  if (fromBuddy(e)) buddyMenu().popup({ window: win });
});

/* bin window events */
ipcMain.on('bin-hit', (e, hit) => {
  if (fromBin(e)) binWin.setIgnoreMouseEvents(!hit, { forward: true });
});

// pulling him out of the bin by hand: he appears under the cursor, held by the head
ipcMain.on('bin-pull', (e) => {
  if (!fromBin(e) || mode !== 'bin') return;
  clearTimeout(muffleTimer);
  const c = screen.getCursorScreenPoint();
  const off = { x: W / 2, y: 260 };
  pos = { x: c.x - off.x, y: c.y - off.y };
  lastBounds = '';
  if (alive(win)) {
    win.setBounds({ x: Math.round(pos.x), y: Math.round(pos.y), width: W, height: H });
    win.setIgnoreMouseEvents(true, { forward: true });
    win.showInactive();
  }
  ignoreBinUntil = Date.now() + 1500;
  sendBin('emerge');
  startDrag(off);
});

ipcMain.on('bin-release', (e) => {
  if (!fromBin(e) || mode !== 'drag') return;
  endDrag();
});

ipcMain.on('bin-click', (e) => {
  if (fromBin(e)) emerge();
});

ipcMain.on('bin-menu', (e) => {
  if (fromBin(e)) binMenu().popup({ window: binWin });
});

app.whenReady().then(() => {
  if (!gotLock) return;
  // the app needs no camera, mic, notifications, etc.: refuse everything
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  createWindows();
  screen.on('display-metrics-changed', placeBin);
});

app.on('window-all-closed', () => app.quit());
