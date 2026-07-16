(() => {
  "use strict";

  const field = document.querySelector("#field");
  const game = document.querySelector("#game");
  const floaters = document.querySelector("#floaters");
  const scoreNode = document.querySelector("#score");
  const bestNode = document.querySelector("#best");
  const statusNode = document.querySelector("#status");
  const pauseButton = document.querySelector("#pause");
  const piecesModeButton = document.querySelector("#pieces-mode");

  const CONFIG = {
    goodPieces: 9,
    initialBadPieces: 1,
    badScoreInterval: 100,
    speed: 76,
    baseRadius: 27,
    directionMin: 1,
    directionMax: 3.5,
    respawnMin: 0.8,
    respawnMax: 2.2
  };

  const directions = Array.from({ length: 16 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 8;
    return [Math.cos(angle), Math.sin(angle)];
  });
  const pieces = [];
  const pointers = new Map();
  let score = 0;
  let bestScore = 0;
  let lastGoodNumber = null;
  let samePieceStreak = 0;
  let running = false;
  let paused = false;
  let lastTime = 0;
  let bounds = { width: 1, height: 1 };
  let gameScale = 1;

  const random = (min, max) => min + Math.random() * (max - min);

  function loadBestScore() {
    try {
      const stored = Number.parseInt(localStorage.getItem("drift-touch-best"), 10);
      return Number.isFinite(stored) && stored > 0 ? stored : 0;
    } catch { return 0; }
  }

  function saveBestScore() {
    try { localStorage.setItem("drift-touch-best", String(bestScore)); } catch {}
  }

  function savedPiecesMode() {
    try {
      const saved = localStorage.getItem("drift-touch-pieces");
      // "numbers" was the original plain-piece mode. Keep that preference
      // useful after upgrading to the three-theme selector.
      return saved === "numbers" ? "clean" : saved;
    }
    catch { return null; }
  }

  function applyPiecesMode(mode, remember = false) {
    const modes = ["photos", "clean", "album"];
    const current = modes.includes(mode) ? mode : "photos";
    const next = modes[(modes.indexOf(current) + 1) % modes.length];
    const labels = { photos: "photo", clean: "plain green", album: "album artwork" };
    const icons = {
      photos: '<span class="snsd-mode-icon" aria-hidden="true"></span>',
      clean: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/></svg>',
      album: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 4a8 8 0 0 1 8 8"/></svg>'
    };

    document.documentElement.dataset.pieces = current;
    piecesModeButton.innerHTML = icons[current];
    piecesModeButton.title = `${labels[current][0].toUpperCase()}${labels[current].slice(1)} pieces`;
    piecesModeButton.setAttribute("aria-label", `Switch to ${labels[next]} pieces`);
    if (remember) {
      try { localStorage.setItem("drift-touch-pieces", current); } catch {}
    }
  }

  function togglePiecesMode() {
    const modes = ["photos", "clean", "album"];
    const currentIndex = modes.indexOf(document.documentElement.dataset.pieces);
    applyPiecesMode(modes[(currentIndex + 1) % modes.length], true);
  }

  function measure() {
    const oldBounds = bounds;
    const nextBounds = { width: field.clientWidth, height: field.clientHeight };
    gameScale = Math.min(1.45, Math.max(.82, Math.min(nextBounds.width, nextBounds.height) / 390));
    if (oldBounds.width > 1 && oldBounds.height > 1) {
      pieces.forEach(piece => {
        piece.x = piece.x / oldBounds.width * nextBounds.width;
        piece.y = piece.y / oldBounds.height * nextBounds.height;
        draw(piece);
      });
    }
    bounds = nextBounds;
  }

  const radius = () => CONFIG.baseRadius * gameScale;
  const speed = () => CONFIG.speed * gameScale;

  function updateTravelAngle(piece) {
    piece.el.style.setProperty("--travel-angle", `${Math.atan2(piece.dy, piece.dx) * 180 / Math.PI}deg`);
  }

  function setDirection(piece) {
    let directionIndex;
    do directionIndex = Math.floor(Math.random() * directions.length);
    while (directionIndex === piece.directionIndex);
    const next = directions[directionIndex];
    piece.directionIndex = directionIndex;
    piece.dx = next[0];
    piece.dy = next[1];
    updateTravelAngle(piece);
    piece.turnIn = random(CONFIG.directionMin, CONFIG.directionMax);
  }

  function place(piece, avoidPointers = true) {
    const pieceRadius = radius();
    let x, y, safe, attempts = 0;
    do {
      x = random(pieceRadius, Math.max(pieceRadius, bounds.width - pieceRadius));
      y = random(pieceRadius, Math.max(pieceRadius, bounds.height - pieceRadius));
      const clearOfPointers = !avoidPointers || [...pointers.values()].every(
        p => Math.hypot(p.x - x, p.y - y) > 90 * gameScale
      );
      const clearOfPieces = pieces.every(
        other => other === piece || !other.active || Math.hypot(other.x - x, other.y - y) > pieceRadius * 2.25
      );
      safe = clearOfPointers && clearOfPieces;
      attempts++;
    } while (!safe && attempts < 40);
    piece.x = x; piece.y = y;
    piece.active = true; piece.armedIn = .22;
    piece.el.classList.remove("hit");
    piece.el.hidden = false;
    setDirection(piece);
    draw(piece);
  }

  function createPiece(type, number = null, variant = 1) {
    const el = document.createElement("div");
    el.className = `piece ${type}${type === "bad" ? ` bad-${variant}` : ""}`;
    if (number !== null) {
      el.dataset.label = number;
      el.setAttribute("aria-label", `Good piece ${number}`);
      const index = number - 1;
      const columns = ["0%", "50%", "100%"];
      const rows = ["5.6%", "50%", "94.4%"];
      el.style.setProperty("--photo-x", columns[index % 3]);
      el.style.setProperty("--photo-y", rows[Math.floor(index / 3)]);
    }
    floaters.append(el);
    const piece = {
      type, number, variant, el, x: 0, y: 0, dx: 0, dy: 0,
      directionIndex: -1, turnIn: 0, armedIn: 0,
      active: true, retired: false, respawnAt: 0
    };
    pieces.push(piece);
    place(piece, false);
  }

  function draw(piece) {
    piece.el.style.transform = `translate3d(${piece.x}px, ${piece.y}px, 0)`;
  }

  function showPop(piece, amount) {
    const pop = document.createElement("span");
    pop.className = `score-pop ${piece.type}`;
    pop.textContent = amount === null ? "ZERO" : `+${amount}`;
    pop.style.left = `${piece.x - 10}px`; pop.style.top = `${piece.y - 10}px`;
    field.append(pop);
    setTimeout(() => pop.remove(), 700);
  }

  function showCatchEffect(piece) {
    if (piece.type === "bad") {
      const ring = document.createElement("span");
      ring.className = "impact-ring";
      ring.style.left = `${piece.x}px`; ring.style.top = `${piece.y}px`;
      field.append(ring);
      setTimeout(() => ring.remove(), 480);
      return;
    }

    const burst = document.createElement("span");
    burst.className = "catch-burst";
    burst.style.left = `${piece.x}px`; burst.style.top = `${piece.y}px`;
    const heart = document.createElement("span");
    heart.className = "heart"; heart.textContent = "\u2665";
    burst.append(heart);
    for (let i = 0; i < 6; i++) {
      const spark = document.createElement("i");
      spark.className = "spark";
      burst.append(spark);
    }
    field.append(burst);
    setTimeout(() => burst.remove(), 560);
  }

  function resetBadProgress() {
    const extraBadPieces = pieces.filter(piece => piece.type === "bad" && piece.variant > 1);
    for (const extra of extraBadPieces) {
      extra.retired = true;
      extra.active = false;
      extra.el.classList.add("hit");
      setTimeout(() => {
        extra.el.remove();
        const index = pieces.indexOf(extra);
        if (index !== -1) pieces.splice(index, 1);
      }, 250);
    }
  }

  function addBadPiecesForScore() {
    const desiredCount = 1 + Math.floor(score / CONFIG.badScoreInterval);
    let currentCount = pieces.filter(piece => piece.type === "bad" && !piece.retired).length;
    while (currentCount < desiredCount) {
      createPiece("bad", null, currentCount + 1);
      currentCount++;
    }
  }

  function hit(piece) {
    if (!piece.active || piece.armedIn > 0) return;
    const isGood = piece.type === "good";
    let amount = null;
    if (isGood) {
      samePieceStreak = piece.number === lastGoodNumber ? Math.min(samePieceStreak + 1, 5) : 1;
      lastGoodNumber = piece.number;
      amount = samePieceStreak;
      score += amount;
    } else {
      score = 0;
      lastGoodNumber = null;
      samePieceStreak = 0;
    }
    if (score > bestScore) {
      bestScore = score;
      bestNode.textContent = bestScore;
      saveBestScore();
    }
    if (isGood) addBadPiecesForScore();
    scoreNode.textContent = score;
    showPop(piece, amount);
    showCatchEffect(piece);
    if (!isGood) {
      game.classList.remove("danger-flash");
      void game.offsetWidth;
      game.classList.add("danger-flash");
    }
    piece.active = false;
    piece.el.classList.add("hit");
    piece.respawnAt = performance.now() + random(CONFIG.respawnMin, CONFIG.respawnMax) * 1000;
    if (!isGood) resetBadProgress();
    setTimeout(() => { if (!piece.active) piece.el.hidden = true; }, 250);
    if (navigator.vibrate) navigator.vibrate(piece.type === "good" ? 12 : [30, 25, 30]);
  }

  function checkPointer(pointer) {
    for (const piece of pieces) {
      if (piece.active && piece.armedIn <= 0 && Math.hypot(pointer.x - piece.x, pointer.y - piece.y) <= radius() + 4 * gameScale) hit(piece);
    }
  }

  function resolvePieceCollisions() {
    const activePieces = pieces.filter(piece => piece.active);
    const minimumDistance = radius() * 2;

    for (let i = 0; i < activePieces.length; i++) {
      for (let j = i + 1; j < activePieces.length; j++) {
        const first = activePieces[i];
        const second = activePieces[j];
        let deltaX = second.x - first.x;
        let deltaY = second.y - first.y;
        let distance = Math.hypot(deltaX, deltaY);
        if (distance >= minimumDistance) continue;

        if (distance < .01) {
          deltaX = 1;
          deltaY = 0;
          distance = 1;
        }
        const normalX = deltaX / distance;
        const normalY = deltaY / distance;
        const overlap = minimumDistance - distance;
        first.x -= normalX * overlap * .5;
        first.y -= normalY * overlap * .5;
        second.x += normalX * overlap * .5;
        second.y += normalY * overlap * .5;

        const relativeSpeed = (first.dx - second.dx) * normalX + (first.dy - second.dy) * normalY;
        if (relativeSpeed > 0) {
          first.dx -= relativeSpeed * normalX;
          first.dy -= relativeSpeed * normalY;
          second.dx += relativeSpeed * normalX;
          second.dy += relativeSpeed * normalY;

          const firstLength = Math.hypot(first.dx, first.dy) || 1;
          const secondLength = Math.hypot(second.dx, second.dy) || 1;
          first.dx /= firstLength;
          first.dy /= firstLength;
          second.dx /= secondLength;
          second.dy /= secondLength;
          updateTravelAngle(first);
          updateTravelAngle(second);
        }
        draw(first);
        draw(second);
      }
    }
  }

  function localPoint(event) {
    const rect = field.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function showPointerTrail(point, pointerType) {
    const trail = document.createElement("i");
    trail.className = `pointer-trail${pointerType === "touch" ? " touch" : ""}`;
    trail.style.left = `${point.x}px`;
    trail.style.top = `${point.y}px`;
    field.append(trail);
    setTimeout(() => trail.remove(), 540);
  }

  function track(event) {
    if (!running || paused) return;
    event.preventDefault();
    const point = localPoint(event);
    const previous = pointers.get(event.pointerId);
    const lastTrailAt = previous?.lastTrailAt || 0;
    const movedEnough = !previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 5 * gameScale;
    if (movedEnough && event.timeStamp - lastTrailAt >= 28) {
      showPointerTrail(point, event.pointerType);
      point.lastTrailAt = event.timeStamp;
    } else {
      point.lastTrailAt = lastTrailAt;
    }
    pointers.set(event.pointerId, point);
    checkPointer(point);
    if (event.type === "pointerdown") field.setPointerCapture?.(event.pointerId);
  }

  function release(event) { pointers.delete(event.pointerId); }

  function update(time) {
    const dt = Math.min((time - lastTime) / 1000 || 0, .05);
    lastTime = time;
    if (running && !paused) {
      const pieceRadius = radius();
      const scaledSpeed = speed();
      for (const piece of pieces) {
        if (piece.retired) continue;
        if (!piece.active) {
          if (time >= piece.respawnAt) place(piece);
          continue;
        }
        piece.armedIn -= dt; piece.turnIn -= dt;
        if (piece.turnIn <= 0) setDirection(piece);
        piece.x += piece.dx * scaledSpeed * dt;
        piece.y += piece.dy * scaledSpeed * dt;
        if (piece.x < -pieceRadius) piece.x = bounds.width + pieceRadius;
        if (piece.x > bounds.width + pieceRadius) piece.x = -pieceRadius;
        if (piece.y < -pieceRadius) piece.y = bounds.height + pieceRadius;
        if (piece.y > bounds.height + pieceRadius) piece.y = -pieceRadius;
        draw(piece);
      }
      resolvePieceCollisions();
      for (const pointer of pointers.values()) checkPointer(pointer);
    }
    requestAnimationFrame(update);
  }

  function start() {
    score = 0; scoreNode.textContent = "0";
    lastGoodNumber = null;
    samePieceStreak = 0;
    if (!pieces.length) {
      for (let i = 0; i < CONFIG.goodPieces; i++) createPiece("good", i + 1);
      for (let i = 0; i < CONFIG.initialBadPieces; i++) createPiece("bad", null, 1);
    } else pieces.forEach(piece => place(piece, false));
    running = true; paused = false;
    statusNode.textContent = "Live";
    pauseButton.textContent = "\u2161";
    pauseButton.setAttribute("aria-label", "Pause game");
  }

  function togglePause() {
    if (!running) return;
    paused = !paused; pointers.clear();
    statusNode.textContent = paused ? "Paused" : "Live";
    pauseButton.textContent = paused ? "\u25b6" : "\u2161";
    pauseButton.setAttribute("aria-label", paused ? "Resume game" : "Pause game");
  }

  field.addEventListener("pointerdown", track, { passive: false });
  field.addEventListener("pointermove", track, { passive: false });
  field.addEventListener("pointerup", release);
  field.addEventListener("pointercancel", release);
  field.addEventListener("pointerleave", event => { if (event.pointerType === "mouse") release(event); });
  pauseButton.addEventListener("click", togglePause);
  piecesModeButton.addEventListener("click", togglePiecesMode);
  window.addEventListener("resize", measure);
  document.addEventListener("visibilitychange", () => { if (document.hidden && running && !paused) togglePause(); });
  window.addEventListener("message", event => {
    if (event.origin !== location.origin) return;
    if (event.data?.type === "media-player-game-visibility") {
      if (!event.data.visible && running && !paused) togglePause();
      return;
    }
    if (event.data?.type === "media-player-game-artwork") {
      const artworkUrl = typeof event.data.artworkUrl === "string" ? event.data.artworkUrl : "";
      document.documentElement.style.setProperty(
        "--album-art-image",
        artworkUrl ? `url(${JSON.stringify(artworkUrl)})` : "none"
      );
      document.documentElement.classList.toggle("has-album-art", Boolean(artworkUrl));
    }
  });

  bestScore = loadBestScore();
  bestNode.textContent = bestScore;
  applyPiecesMode(savedPiecesMode() || "photos");
  measure();
  start();
  requestAnimationFrame(update);
  window.parent.postMessage({ type: "media-player-game-ready" }, location.origin);
})();
