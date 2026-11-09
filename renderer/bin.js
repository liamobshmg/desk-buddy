(() => {
  'use strict';

  const binEl = document.getElementById('bin');
  const msg = document.getElementById('msg');
  const msgText = document.getElementById('msgText');
  const api = window.bin;

  let msgTimer = null;
  let lidTimer = null;

  const lid = (open) => binEl.classList.toggle('open', open);

  function pulse(cls, ms) {
    binEl.classList.remove(cls);
    void binEl.offsetWidth; // restart the animation
    binEl.classList.add(cls);
    setTimeout(() => binEl.classList.remove(cls), ms);
  }

  // he is coming near: lid lifts
  api.onLid(lid);

  // dunked: lid opens, snaps shut, can rattles
  api.onSwallow(() => {
    clearTimeout(lidTimer);
    lid(true);
    lidTimer = setTimeout(() => {
      lid(false);
      pulse('shaking', 900);
    }, 380);
  });

  // flung back out
  api.onEmerge(() => {
    clearTimeout(lidTimer);
    clearTimeout(msgTimer);
    msg.hidden = true;
    lid(true);
    lidTimer = setTimeout(() => lid(false), 900);
  });

  // faint voice from inside the can
  api.onMuffled((text) => {
    clearTimeout(msgTimer);
    msgText.textContent = text;
    msg.hidden = false;
    pulse('wiggle', 450);
    msgTimer = setTimeout(() => {
      msg.hidden = true;
    }, 2600 + text.length * 40);
  });

  /* ---------- pointer: click opens the lid, drag pulls him out by the head ---------- */
  let down = null;

  binEl.addEventListener('mouseenter', () => api.hit(true));
  binEl.addEventListener('mouseleave', () => {
    if (!down) api.hit(false);
  });

  binEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    down = { x: e.screenX, y: e.screenY, pulled: false };
    binEl.setPointerCapture(e.pointerId);
  });

  binEl.addEventListener('pointermove', (e) => {
    if (!down || down.pulled) return;
    if (Math.hypot(e.screenX - down.x, e.screenY - down.y) > 5) {
      down.pulled = true;
      api.pull();
    }
  });

  function finish() {
    if (!down) return;
    const wasPull = down.pulled;
    down = null;
    if (wasPull) api.release();
    else api.click();
    if (!binEl.matches(':hover')) api.hit(false);
  }
  binEl.addEventListener('pointerup', finish);
  binEl.addEventListener('pointercancel', finish);

  binEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    api.menu();
  });
})();
