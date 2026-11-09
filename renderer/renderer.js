(() => {
  'use strict';

  const buddyEl = document.getElementById('buddy');
  const headWrap = document.getElementById('headWrap');
  const mouth = document.getElementById('mouth');
  const bubble = document.getElementById('bubble');
  const bubbleText = document.getElementById('bubbleText');

  const api = window.buddy;
  let sayToken = 0;
  let dragging = false;
  let flying = false;

  const MOODS = ['angry', 'sad', 'shocked', 'creepy'];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function setMood(m) {
    buddyEl.dataset.mood = MOODS.includes(m) ? m : 'neutral';
  }
  function restMood() {
    buddyEl.dataset.mood = dragging || flying ? 'shocked' : 'neutral';
  }

  /* ---------- mouth ---------- */
  function setMouth(open) {
    if (open <= 0.04) {
      mouth.style.display = 'none';
      return;
    }
    mouth.style.display = 'block';
    mouth.style.height = 8 + open * 42 + 'px';
  }

  const isShout = (t) => /!{2,}/.test(t) || (/[A-Z]{3}/.test(t) && t === t.toUpperCase());

  function startTalking() {
    headWrap.classList.add('talking');
    buddyEl.classList.add('speaking');
  }
  function stopTalking() {
    headWrap.classList.remove('talking');
    buddyEl.classList.remove('speaking');
  }

  /* ---------- speech bubble: types out, mouth flaps per letter ---------- */
  async function say({ t, m, hurt, held }) {
    const token = ++sayToken;
    setMood(m);
    bubbleText.textContent = '';
    bubbleText.classList.toggle('shout', isShout(t));
    bubble.hidden = false;
    startTalking();

    if (hurt) {
      buddyEl.classList.remove('hurt');
      void buddyEl.offsetWidth; // restart the squash animation
      buddyEl.classList.add('hurt');
    }

    for (let i = 0; i < t.length; i++) {
      if (token !== sayToken) return;
      bubbleText.textContent = t.slice(0, i + 1);
      setMouth(t[i] === ' ' ? 0.1 : 0.3 + Math.random() * 0.7);
      await wait(38);
    }
    if (token !== sayToken) return;
    setMouth(0);
    await wait(1500 + t.length * 45);
    if (token !== sayToken) return;

    stopTalking();
    bubble.hidden = true;
    restMood();
    if (dragging || flying) setMouth(held ? 0 : 0.6);
    api.sayDone();
  }

  function cancelSpeech() {
    sayToken++;
    bubble.hidden = true;
    stopTalking();
  }

  api.onSay(say);
  api.onState((s) => {
    const wasHeld = dragging;
    buddyEl.classList.toggle('walking', !!s.walking);
    buddyEl.dataset.dir = String(s.dir || 0);
    buddyEl.classList.toggle('dragging', !!s.dragging);
    buddyEl.classList.toggle('flying', !!s.flying);
    dragging = !!s.dragging;
    flying = !!s.flying;
    if (dragging) {
      cancelSpeech();
      setMood('shocked');
      setMouth(0.6);
    } else if (wasHeld && !flying) {
      restMood();
      setMouth(0);
    } else if (flying) {
      setMood('shocked');
      setMouth(0.8);
    } else if (!headWrap.classList.contains('talking')) {
      restMood();
      setMouth(0);
    }
  });

  /* ---------- pointer: click-through outside the buddy, drag, click, menu ---------- */
  let down = null;

  buddyEl.addEventListener('mouseenter', () => api.hit(true));
  buddyEl.addEventListener('mouseleave', () => {
    if (!down) api.hit(false);
  });

  buddyEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    down = { x: e.screenX, y: e.screenY, started: false };
    buddyEl.setPointerCapture(e.pointerId);
  });

  buddyEl.addEventListener('pointermove', (e) => {
    if (!down || down.started) return;
    if (Math.hypot(e.screenX - down.x, e.screenY - down.y) > 5) {
      down.started = true;
      api.dragStart();
    }
  });

  function finish() {
    if (!down) return;
    const wasDrag = down.started;
    down = null;
    if (wasDrag) api.dragEnd();
    else api.click();
    if (!buddyEl.matches(':hover')) api.hit(false);
  }
  buddyEl.addEventListener('pointerup', finish);
  buddyEl.addEventListener('pointercancel', finish);

  buddyEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    api.menu();
  });
})();
