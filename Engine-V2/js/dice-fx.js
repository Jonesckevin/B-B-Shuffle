/**
 * B&B Shuffle Engine-V2 — Dice FX (animated d20)
 * ============================================================
 * A big 3D d20 that tumbles inside a modal whenever the player
 * rolls dice. It is built from pure CSS 3D (a regular
 * icosahedron, the "classic d20"); the geometry here is ported
 * from the standalone Dice.html reference file.
 *
 * The theatrics are optional. Toggle them with the "Dice FX"
 * header control or the "Turn off animated dice" link inside the
 * modal. The preference is stored in localStorage under
 * `bb-dice-fx` (defaults to ON). When OFF, the player falls back
 * to the plain, instant header roll.
 *
 * Public API (window.DiceFX):
 *   isEnabled()               -> boolean
 *   setEnabled(on)            -> persist preference + refresh the header button
 *   isOpen()                  -> is the die modal currently visible?
 *   build()                   -> lazily create the 20 die faces
 *   async performRoll(nat, ctx) -> show modal, animate the d20 to face `nat`,
 *                                  resolves { settled: true|false } on landing
 *                                  (false if the player closed the modal early)
 *   reveal(meta)              -> show the landed outcome + "Done", auto-close
 *   close()                   -> hide the modal (also resolves any in-flight roll)
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'bb-dice-fx';

  var MODAL_ID = 'dice-modal';
  var DIE_ID = 'dice-fx-die';
  var SCENE_ID = 'dice-fx-scene';
  var FLOURISH_ID = 'dice-fx-flourish';
  var TITLE_ID = 'dice-modal-title';
  var CAPTION_ID = 'dice-fx-caption';
  var DONE_ID = 'dice-fx-done-btn';
  var OFF_ID = 'dice-fx-off-btn';
  var CLOSE_ID = 'dice-modal-close';
  var FXBTN_ID = 'dice-fx-btn';
  var FXSTATE_ID = 'dice-fx-btn-state';

  var reducedMotion = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function el(id) { return document.getElementById(id); }
  function show(node) { if (node) node.classList.remove('hidden'); }
  function hide(node) { if (node) node.classList.add('hidden'); }
  // Delegates to the canonical Utils.escapeHtml (utils.js loads before this file).
  function esc(value) { return Utils.escapeHtml(value); }

  /* ------------------------------------------------------------------
   * Geometry — a regular icosahedron (classic d20). Ported verbatim
   * from the Dice.html reference; do not "simplify" this math.
   * Coordinate space matches CSS: +x right, +y DOWN, +z toward viewer.
   * ------------------------------------------------------------------ */
  var SIZE = 150;                 // circumradius of the die (px)
  var t = (1 + Math.sqrt(5)) / 2; // golden ratio

  // The 12 vertices of an icosahedron, normalized onto a sphere.
  var raw = [
    [-1,  t, 0], [ 1,  t, 0], [-1, -t, 0], [ 1, -t, 0],
    [ 0, -1,  t], [ 0,  1,  t], [ 0, -1, -t], [ 0,  1, -t],
    [ t, 0, -1], [ t, 0,  1], [-t, 0, -1], [-t, 0,  1]
  ];

  var verts = raw.map(function (v) {
    var l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    // flip Y so "up" (math) becomes "-y" (CSS screen up)
    return [(v[0] / l) * SIZE, (-v[1] / l) * SIZE, (v[2] / l) * SIZE];
  });

  function dist2(a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz;
  }

  // smallest vertex-to-vertex distance == the shared edge length
  var minD2 = Infinity;
  var i, j;
  for (i = 0; i < 12; i++) {
    for (j = i + 1; j < 12; j++) {
      var dd = dist2(verts[i], verts[j]);
      if (dd < minD2) minD2 = dd;
    }
  }
  function adjacent(p, q) { return dist2(verts[p], verts[q]) < minD2 * 1.05; }

  // Every triangle whose 3 vertices are all mutually adjacent is a face (20 total)
  var faceIdx = [];
  for (i = 0; i < 12; i++) {
    for (j = i + 1; j < 12; j++) {
      for (var k = j + 1; k < 12; k++) {
        if (adjacent(i, j) && adjacent(j, k) && adjacent(i, k)) faceIdx.push([i, j, k]);
      }
    }
  }

  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }
  function normalize(v) {
    var l = Math.sqrt(dot(v, v)) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  // Rotations matching the CSS spec (rotateX / rotateY / rotateZ)
  function rotX(v, a) { var c = Math.cos(a), s = Math.sin(a); return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]]; }
  function rotY(v, a) { var c = Math.cos(a), s = Math.sin(a); return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]]; }
  function rotZ(v, a) { var c = Math.cos(a), s = Math.sin(a); return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]]; }

  // Per-face geometry
  var faces = faceIdx.map(function (f) {
    var A = verts[f[0]], B = verts[f[1]], C = verts[f[2]];

    // outward normal
    var n = cross(
      [B[0] - A[0], B[1] - A[1], B[2] - A[2]],
      [C[0] - A[0], C[1] - A[1], C[2] - A[2]]
    );
    var mid = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
    if (dot(n, mid) < 0) n = [-n[0], -n[1], -n[2]];
    n = normalize(n);

    var apothem = dot(A, n);   // distance from origin to the face plane
    var center = [n[0] * apothem, n[1] * apothem, n[2] * apothem];

    // orthonormal in-plane basis; local +x points toward vertex A
    var xh = normalize([A[0] - center[0], A[1] - center[1], A[2] - center[2]]);
    var yh = cross(n, xh);     // local +y ("down" inside the element)

    var corners = [A, B, C].map(function (V) {
      var p = [V[0] - center[0], V[1] - center[1], V[2] - center[2]];
      return [dot(p, xh), dot(p, yh)];   // element-local coords, origin at center
    });

    return { idx: f, n: n, apothem: apothem, center: center, xh: xh, yh: yh, corners: corners, num: 0 };
  });

  // face triangle circumradius (px) and the box that contains it
  var s = Math.sqrt(faces[0].corners[0][0] * faces[0].corners[0][0] +
                    faces[0].corners[0][1] * faces[0].corners[0][1]);
  var W = Math.ceil(2 * s) + 6;

  // Standard d20 numbering: opposite faces add up to 21
  var taken = [];
  var nextNum = 1;
  for (i = 0; i < faces.length; i++) {
    if (taken[i]) continue;
    var opp = -1;
    for (j = i + 1; j < faces.length; j++) {
      if (!taken[j] && dot(faces[i].n, faces[j].n) < -0.999) { opp = j; break; }
    }
    if (opp >= 0) {
      faces[i].num = nextNum;
      faces[opp].num = 21 - nextNum;
      taken[i] = taken[opp] = true;
    } else {
      faces[i].num = nextNum;
      taken[i] = true;
    }
    nextNum++;
  }

  // Container rotation (rotateZ(c) rotateY(b) rotateX(a)) that brings a face
  // to face the camera, with its printed number upright and unmirrored.
  function alignAngles(face) {
    var n = face.n;
    var b = -Math.asin(Math.max(-1, Math.min(1, n[0])));
    var a = Math.atan2(n[1], n[2]);
    // element "up" (glyph top) expressed in die-local coordinates
    var up = [-face.yh[0], -face.yh[1], -face.yh[2]];
    var u2 = rotY(rotX(up, a), b);       // lies in the camera plane (xy)
    var c = Math.atan2(-u2[0], -u2[1]);  // spin about camera axis -> upright text
    var toDeg = 180 / Math.PI;
    return { a: a * toDeg, b: b * toDeg, c: c * toDeg };
  }
  var aligns = faces.map(alignAngles);

  function idxOfNum(v) {
    for (var i = 0; i < faces.length; i++) if (faces[i].num === v) return i;
    return 0;
  }

  // hsl (h in 0..360, s/l in 0..100) -> [r,g,b] in 0..255
  function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = h / 60;
    var x = c * (1 - Math.abs(hp % 2 - 1));
    var r, g, b;
    if (hp < 1)      { r = c; g = x; b = 0; }
    else if (hp < 2) { r = x; g = c; b = 0; }
    else if (hp < 3) { r = 0; g = c; b = x; }
    else if (hp < 4) { r = 0; g = x; b = c; }
    else if (hp < 5) { r = x; g = 0; b = c; }
    else             { r = c; g = 0; b = x; }
    var m = l - c / 2;
    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255)
    ];
  }

  function polygon(face, scale) {
    return face.corners.map(function (pt) {
      var px = W / 2 + pt[0] * scale;
      var py = W / 2 + pt[1] * scale;
      return px.toFixed(2) + 'px ' + py.toFixed(2) + 'px';
    }).join(', ');
  }

  // ---- die DOM state ----
  var built = false;
  var dieEl = null;
  var last = { a: -42, b: -24, c: 0 };   // initial resting pose (nice tilted view)
  var currentScale = 1;
  var rolling = false;
  var landingTimer = null;
  var settleResolver = null;             // resolves the in-flight performRoll promise
  var autoCloseTimer = null;

  // Studio lighting, baked per face once at build time so faces brighten and
  // darken correctly as the die turns (key light from the upper-left-front;
  // +z is toward the viewer, -y is up).
  var LIGHT = normalize([-0.45, -0.62, 0.64]);
  var HALF_V = normalize([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);
  var AMBIENT = 0.44;
  var DIFFUSE = 0.62;
  var SPEC = 0.40;
  var SHINY = 22;

  function apply(aDeg, bDeg, cDeg) {
    if (!dieEl) return;
    dieEl.style.transform = 'scale(' + currentScale + ') rotateZ(' + cDeg + 'deg) rotateY(' + bDeg + 'deg) rotateX(' + aDeg + 'deg)';
  }

  // Fit the fixed 430px die into whatever space the modal actually has.
  function computeScale() {
    var scene = el(SCENE_ID);
    var w = scene && scene.clientWidth ? scene.clientWidth : 430;
    return Math.max(0.5, Math.min(1, w / 430));
  }

  function refreshScale() {
    if (!dieEl || rolling) return;   // don't fight an in-flight tumble
    currentScale = computeScale();
    apply(last.a, last.b, last.c);
  }

  function buildDie() {
    dieEl = el(DIE_ID);
    if (!dieEl || built) return;
    built = true;

    faces.forEach(function (face) {
      var faceEl = document.createElement('div');
      faceEl.className = 'd20-face';
      faceEl.style.width = W + 'px';
      faceEl.style.height = W + 'px';
      faceEl.style.marginLeft = (-W / 2) + 'px';
      faceEl.style.marginTop = (-W / 2) + 'px';

      var xh = face.xh, yh = face.yh, n = face.n, C = face.center;
      // die-local placement: columns are [xh  yh  n  center]. A hair of outward
      // offset along the normal stops neighbouring faces z-fighting while spinning.
      faceEl.style.transform = 'matrix3d(' + [
        xh[0], xh[1], xh[2], 0,
        yh[0], yh[1], yh[2], 0,
        n[0], n[1], n[2], 0,
        C[0] + n[0] * 0.4, C[1] + n[1] * 0.4, C[2] + n[2] * 0.4, 1
      ].join(',') + ')';

      // number-based colour ramp: 1 = red ... 20 = green
      var hue = ((face.num - 1) / 19) * 120;
      var base = hslToRgb(hue, 82, 50);

      // baked lighting: diffuse + a touch of specular so the ball reads as solid
      var ndl = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      var ndh = Math.max(0, n[0] * HALF_V[0] + n[1] * HALF_V[1] + n[2] * HALF_V[2]);
      var lightAmt = AMBIENT + DIFFUSE * ndl;
      var specAmt = SPEC * Math.pow(ndh, SHINY);
      var lit = base.map(function (ch) {
        return Math.min(255, Math.round(ch * lightAmt + 255 * specAmt));
      });

      // frame (a thin, slightly darker bevel) behind the fill triangle — kept
      // narrow and close in tone so the seams stay crisp rather than jagged
      faceEl.style.clipPath = 'polygon(' + polygon(face, 1.02) + ')';
      faceEl.style.background = 'rgb(' + lit.map(function (ch) {
        return Math.round(ch * 0.55);
      }).join(',') + ')';

      // fill + number
      var inner = document.createElement('div');
      inner.className = 'd20-num';
      inner.style.clipPath = 'polygon(' + polygon(face, 1) + ')';
      inner.style.background = 'rgb(' + lit.join(',') + ')';
      // contrast judged from the diffuse-lit base (ignoring the specular hit)
      var luma = (0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2]) * lightAmt / 255;
      inner.style.color = luma > 0.55 ? '#14181f' : '#ffffff';
      inner.style.fontSize = Math.round(s * 0.42) + 'px';
      inner.textContent = face.num;

      faceEl.appendChild(inner);
      dieEl.appendChild(faceEl);
    });

    currentScale = computeScale();
    apply(last.a, last.b, last.c);
  }

  // ---- rolling ----
  function nextAngle(cur, base, extra) {
    var k = Math.floor((cur - base) / 360) + 1;
    return base + 360 * (k + extra);
  }

  function rollTo(n) {
    var al = aligns[idxOfNum(n)];
    var na = nextAngle(last.a, al.a, 1);
    var nb = nextAngle(last.b, al.b, 1);
    var nc = nextAngle(last.c, al.c, 0);
    last = { a: na, b: nb, c: nc };
    apply(na, nb, nc);
  }

  function randomDuration() {
    return 1500 + Math.floor(Math.random() * 2200); // ~1.5s - 3.7s of tumbling
  }

  function startToss(natural, dur) {
    dieEl.style.transitionDuration = dur + 'ms';
    rollTo(natural);
    landingTimer = setTimeout(function () {
      landingTimer = null;
      var scene = el(SCENE_ID);
      if (scene) scene.classList.remove('tossing');   // shadow settles, blur clears
      rolling = false;   // the toss has physically settled
      var resolve = settleResolver;
      settleResolver = null;
      if (resolve) resolve(true);
    }, dur + 140);
  }

  async function performRoll(natural, ctx) {
    ctx = ctx || {};
    var modal = el(MODAL_ID);
    if (!modal) return { settled: false };
    if (!built) buildDie();
    if (!dieEl) return { settled: false };

    // fresh resting pose each toss
    last = { a: -42, b: -24, c: 0 };
    rolling = true;
    clearTimeout(autoCloseTimer);
    var doneOpen = el(DONE_ID);
    if (doneOpen) { doneOpen.disabled = true; hide(doneOpen); }

    var title = el(TITLE_ID);
    if (title) {
      title.textContent = ctx.bonus > 0 ? 'Rolling with +' + ctx.bonus + ' enhanced…' : 'Rolling the d20…';
    }
    var caption = el(CAPTION_ID);
    if (caption) {
      caption.className = 'dicefx-caption rolling';
      caption.innerHTML = 'Rolling…';
    }

    show(modal);

    var scene = el(SCENE_ID);
    var flourish = el(FLOURISH_ID);
    if (scene) scene.classList.remove('tossing', 'fail-shake');
    if (flourish) flourish.className = 'dicefx-flourish';

    currentScale = computeScale();
    dieEl.style.transitionDuration = '0ms';
    apply(last.a, last.b, last.c);
    void dieEl.offsetWidth;   // commit the resting pose

    // brief beat so the die is visible before it tumbles
    await new Promise(function (r) { setTimeout(r, 240); });
    if (!rolling) return { settled: false };   // closed during the beat

    var dur = reducedMotion ? 300 : randomDuration();
    // "In the air": scale + motion blur while the ground shadow shrinks away.
    if (scene && !reducedMotion) scene.classList.add('tossing');
    var settled = await new Promise(function (resolve) {
      settleResolver = resolve;
      startToss(natural, dur);
    });
    return { settled: !!settled };
  }

  // ---- outcome reveal ----
  function reveal(meta) {
    meta = meta || {};
    var caption = el(CAPTION_ID);
    if (!caption || rolling || !isOpen()) return;

    var kind = meta.kind || 'ok';
    var tone = kind === 'fail' ? 'tone-fail'
      : (kind === 'inject' ? 'tone-inject' : 'tone-ok');

    var modLine = meta.bonus > 0
      ? '<span class="dicefx-mod">Total ' + meta.total + ' = ' + meta.base + ' +' + meta.bonus + ' enhanced</span>'
      : '';

    caption.className = 'dicefx-caption dicefx-outcome ' + tone;
    caption.innerHTML =
      '<span class="dicefx-big">' + esc(meta.headline) + '</span>' +
      modLine +
      '<span class="dicefx-msg">' + esc(meta.message || '') + '</span>';

    var title = el(TITLE_ID);
    if (title) {
      title.textContent = kind === 'fail' ? 'Failure'
        : (kind === 'crit' ? 'Critical success!'
          : (kind === 'inject' ? 'Inject drawn' : (meta.isSuccess ? 'Success' : 'Failure')));
    }

    var done = el(DONE_ID);
    if (done) {
      done.disabled = false;
      show(done);
      done.focus({ preventScroll: true });
    }

    // Landing flourish: an expanding ring, or a shake on a critical failure.
    var flourish = el(FLOURISH_ID);
    if (flourish) {
      flourish.className = 'dicefx-flourish';
      void flourish.offsetWidth;
      flourish.classList.add(kind === 'fail' ? 'play-fail' : (kind === 'inject' ? 'play-inject' : 'play-ok'));
    }
    var scene = el(SCENE_ID);
    if (scene && kind === 'fail' && !reducedMotion) {
      scene.classList.remove('fail-shake');
      void scene.offsetWidth;
      scene.classList.add('fail-shake');
      setTimeout(function () { scene.classList.remove('fail-shake'); }, 700);
    }

    clearTimeout(autoCloseTimer);
    var hold = kind === 'crit' ? 4400 : (kind === 'inject' ? 3900 : (kind === 'fail' ? 3800 : 3400));
    autoCloseTimer = setTimeout(close, hold);
  }

  // ---- modal ----
  function isOpen() {
    var modal = el(MODAL_ID);
    return !!modal && !modal.classList.contains('hidden');
  }

  function close() {
    var modal = el(MODAL_ID);
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
    hide(modal);

    var scene = el(SCENE_ID);
    if (scene) scene.classList.remove('tossing', 'fail-shake');

    // If a toss is still in flight, resolve it as "not settled" so the game
    // still applies the outcome (a turn is never left hanging).
    if (landingTimer) { clearTimeout(landingTimer); landingTimer = null; }
    var resolve = settleResolver;
    settleResolver = null;
    if (resolve) resolve(false);
    rolling = false;
  }

  // ---- preference (localStorage, default ON) ----
  function readPref() {
    try { return localStorage.getItem(STORAGE_KEY) !== '0'; }
    catch (e) { return true; }
  }

  function setEnabled(on) {
    try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); }
    catch (e) { /* storage unavailable — keep in-memory state only */ }
    refreshToggleUI();
    if (typeof Utils !== 'undefined' && Utils.showToast) {
      Utils.showToast(on ? 'Animated d20 roll on' : 'Animated d20 roll off', 'info');
    }
  }

  function refreshToggleUI() {
    var on = readPref();
    var btn = el(FXBTN_ID);
    if (btn) {
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.title = on
        ? 'Dice FX on — rolls toss a big animated d20. Click to turn off.'
        : 'Dice FX off — instant rolls. Click to turn on.';
    }
    var state = el(FXSTATE_ID);
    if (state) state.textContent = on ? 'on' : 'off';
  }

  // ---- bindings ----
  function bind() {
    var btn = el(FXBTN_ID);
    if (btn) btn.addEventListener('click', function () { setEnabled(!readPref()); });

    var done = el(DONE_ID);
    if (done) done.addEventListener('click', close);

    var closeBtn = el(CLOSE_ID);
    if (closeBtn) closeBtn.addEventListener('click', close);

    var off = el(OFF_ID);
    if (off) off.addEventListener('click', function () {
      setEnabled(false);      // this also refreshes the header toggle
      close();
    });

    var modal = el(MODAL_ID);
    if (modal) modal.addEventListener('click', function (e) {
      if (e.target === modal) close();   // click on the dark backdrop
    });

    window.addEventListener('resize', refreshScale);
    refreshToggleUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  // public API
  window.DiceFX = {
    isEnabled: readPref,
    setEnabled: setEnabled,
    isOpen: isOpen,
    build: buildDie,
    performRoll: performRoll,
    reveal: reveal,
    close: close
  };
})();
