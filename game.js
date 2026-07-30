(() => {
  'use strict';

  const levels = [
    { cols: 3, rows: 4 },
    { cols: 4, rows: 5 },
    { cols: 5, rows: 6 },
  ];

  const shell = document.getElementById('game-shell');
  const mount = document.getElementById('pixi-container');
  const timeEl = document.getElementById('time');
  const movesEl = document.getElementById('moves');
  const previewBtn = document.getElementById('preview-btn');
  const shuffleBtn = document.getElementById('shuffle-btn');
  const levelBtn = document.getElementById('level-btn');
  const winPanel = document.getElementById('win-panel');
  const winText = document.getElementById('win-text');
  const playAgainBtn = document.getElementById('play-again');

  // 照片相關 UI
  const startPanel = document.getElementById('start-panel');
  const pickPhotoBtn = document.getElementById('pick-photo-btn');
  const changePhotoBtn = document.getElementById('change-photo-btn');
  const winChangeBtn = document.getElementById('win-change-photo');
  const photoInput = document.getElementById('photo-input');

  const app = new PIXI.Application({
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    resizeTo: shell,
  });
  mount.appendChild(app.view);

  let levelIndex = 0;
  let sourceTexture = null;
  let board = null;
  let pieceLayer = null;
  let previewSprite = null;
  let pieces = [];
  let boardRect = null;
  let trayRect = null;
  let moves = 0;
  let elapsed = 0;
  let timerId = null;
  let started = false;
  let completed = false;
  let previewing = false;
  let processing = false;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function formatTime(totalSeconds) {
    const min = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const sec = (totalSeconds % 60).toString().padStart(2, '0');
    return `${min}:${sec}`;
  }

  function updateHUD() {
    timeEl.textContent = formatTime(elapsed);
    movesEl.textContent = String(moves);
  }

  function resetTimer() {
    clearInterval(timerId);
    timerId = null;
    elapsed = 0;
    started = false;
    updateHUD();
  }

  function startTimer() {
    if (started || completed) return;
    started = true;
    timerId = setInterval(() => {
      elapsed += 1;
      updateHUD();
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerId);
    timerId = null;
  }

  function roundedRect(graphics, x, y, w, h, r, fill, alpha = 1, stroke = null) {
    graphics.lineStyle(stroke ? stroke.width : 0, stroke ? stroke.color : 0, stroke ? stroke.alpha : 0);
    graphics.beginFill(fill, alpha);
    graphics.drawRoundedRect(x, y, w, h, r);
    graphics.endFill();
  }

  function calculateLayout() {
    const w = app.renderer.width / app.renderer.resolution;
    const h = app.renderer.height / app.renderer.resolution;
    const isWide = w / h > 0.9;
    const pad = Math.max(10, Math.min(w, h) * 0.025);

    if (isWide) {
      const boardW = Math.min(w * 0.63, (h - pad * 2) * (sourceTexture.width / sourceTexture.height));
      const boardH = boardW * (sourceTexture.height / sourceTexture.width);
      boardRect = { x: pad, y: (h - boardH) / 2, w: boardW, h: boardH };
      trayRect = { x: boardRect.x + boardRect.w + pad, y: pad, w: w - boardRect.w - pad * 3, h: h - pad * 2 };
    } else {
      const maxBoardH = h * 0.57;
      const boardW = Math.min(w - pad * 2, maxBoardH * (sourceTexture.width / sourceTexture.height));
      const boardH = boardW * (sourceTexture.height / sourceTexture.width);
      boardRect = { x: (w - boardW) / 2, y: pad, w: boardW, h: boardH };
      trayRect = { x: pad, y: boardRect.y + boardRect.h + pad, w: w - pad * 2, h: h - boardRect.h - pad * 3 };
    }
  }

  function clearStage() {
    app.stage.removeChildren();
    pieces.forEach(p => p.destroy({ children: true }));
    pieces = [];
  }

  function drawBoardBackground() {
    board = new PIXI.Container();
    app.stage.addChild(board);

    const bg = new PIXI.Graphics();
    roundedRect(bg, boardRect.x - 5, boardRect.y - 5, boardRect.w + 10, boardRect.h + 10, 18, 0xffffff, 0.68, { width: 2, color: 0xffffff, alpha: 0.9 });
    board.addChild(bg);

    const ghost = new PIXI.Sprite(sourceTexture);
    ghost.x = boardRect.x;
    ghost.y = boardRect.y;
    ghost.width = boardRect.w;
    ghost.height = boardRect.h;
    ghost.alpha = 0.14;
    board.addChild(ghost);

    const tray = new PIXI.Graphics();
    roundedRect(tray, trayRect.x, trayRect.y, trayRect.w, trayRect.h, 18, 0xffffff, 0.28, { width: 1, color: 0xffffff, alpha: 0.6 });
    board.addChild(tray);

    previewSprite = new PIXI.Sprite(sourceTexture);
    previewSprite.x = boardRect.x;
    previewSprite.y = boardRect.y;
    previewSprite.width = boardRect.w;
    previewSprite.height = boardRect.h;
    previewSprite.alpha = 0;
    previewSprite.visible = false;
    board.addChild(previewSprite);

    pieceLayer = new PIXI.Container();
    app.stage.addChild(pieceLayer);
  }

  function makePieceTexture(col, row, cols, rows) {
    const sourceW = sourceTexture.baseTexture.width;
    const sourceH = sourceTexture.baseTexture.height;
    const frameW = sourceW / cols;
    const frameH = sourceH / rows;

    return new PIXI.Texture(
      sourceTexture.baseTexture,
      new PIXI.Rectangle(col * frameW, row * frameH, frameW, frameH)
    );
  }

  function randomTrayPosition(pieceW, pieceH) {
    const minX = trayRect.x + pieceW * 0.5 + 6;
    const maxX = trayRect.x + trayRect.w - pieceW * 0.5 - 6;
    const minY = trayRect.y + pieceH * 0.5 + 6;
    const maxY = trayRect.y + trayRect.h - pieceH * 0.5 - 6;
    return {
      x: minX <= maxX ? minX + Math.random() * (maxX - minX) : trayRect.x + trayRect.w / 2,
      y: minY <= maxY ? minY + Math.random() * (maxY - minY) : trayRect.y + trayRect.h / 2,
    };
  }

  function createPiece(col, row, cols, rows) {
    const pieceW = boardRect.w / cols;
    const pieceH = boardRect.h / rows;
    const container = new PIXI.Container();
    const sprite = new PIXI.Sprite(makePieceTexture(col, row, cols, rows));
    sprite.anchor.set(0.5);
    sprite.width = pieceW - 1.4;
    sprite.height = pieceH - 1.4;
    container.addChild(sprite);

    const border = new PIXI.Graphics();
    border.lineStyle(Math.max(1, pieceW * 0.012), 0xffffff, 0.75);
    border.drawRoundedRect(-pieceW / 2, -pieceH / 2, pieceW, pieceH, Math.min(8, pieceW * 0.08));
    container.addChild(border);

    const start = randomTrayPosition(pieceW, pieceH);
    container.position.set(start.x, start.y);
    container.rotation = (Math.random() - 0.5) * 0.16;
    container.eventMode = 'static';
    container.cursor = 'grab';
    container.hitArea = new PIXI.Rectangle(-pieceW / 2, -pieceH / 2, pieceW, pieceH);

    container.pieceData = {
      col,
      row,
      cols,
      rows,
      pieceW,
      pieceH,
      targetX: boardRect.x + col * pieceW + pieceW / 2,
      targetY: boardRect.y + row * pieceH + pieceH / 2,
      locked: false,
      dragOffsetX: 0,
      dragOffsetY: 0,
    };

    container.on('pointerdown', onPointerDown);
    container.on('pointermove', onPointerMove);
    container.on('pointerup', onPointerUp);
    container.on('pointerupoutside', onPointerUp);
    pieceLayer.addChild(container);
    pieces.push(container);
  }

  function onPointerDown(event) {
    const piece = event.currentTarget;
    if (piece.pieceData.locked || completed || previewing) return;
    startTimer();
    piece.dragging = true;
    piece.cursor = 'grabbing';
    pieceLayer.setChildIndex(piece, pieceLayer.children.length - 1);
    const local = event.getLocalPosition(pieceLayer);
    piece.pieceData.dragOffsetX = piece.x - local.x;
    piece.pieceData.dragOffsetY = piece.y - local.y;
    piece.scale.set(1.05);
    piece.alpha = 0.96;
  }

  function onPointerMove(event) {
    const piece = event.currentTarget;
    if (!piece.dragging || piece.pieceData.locked || completed) return;
    const local = event.getLocalPosition(pieceLayer);
    const halfW = piece.pieceData.pieceW / 2;
    const halfH = piece.pieceData.pieceH / 2;
    const stageW = app.renderer.width / app.renderer.resolution;
    const stageH = app.renderer.height / app.renderer.resolution;
    piece.x = clamp(local.x + piece.pieceData.dragOffsetX, halfW, stageW - halfW);
    piece.y = clamp(local.y + piece.pieceData.dragOffsetY, halfH, stageH - halfH);
  }

  function onPointerUp(event) {
    const piece = event.currentTarget;
    if (!piece.dragging) return;
    piece.dragging = false;
    piece.cursor = 'grab';
    piece.scale.set(1);
    piece.alpha = 1;
    moves += 1;
    updateHUD();

    const d = piece.pieceData;
    const distance = Math.hypot(piece.x - d.targetX, piece.y - d.targetY);
    const snapDistance = Math.max(24, Math.min(d.pieceW, d.pieceH) * 0.42);

    if (distance <= snapDistance) {
      snapPiece(piece);
    }
  }

  function snapPiece(piece) {
    const d = piece.pieceData;
    d.locked = true;
    piece.eventMode = 'none';
    piece.cursor = 'default';

    const startX = piece.x;
    const startY = piece.y;
    const startRotation = piece.rotation;
    let t = 0;
    const duration = 150;

    const animate = delta => {
      t += app.ticker.deltaMS;
      const p = Math.min(1, t / duration);
      const ease = 1 - Math.pow(1 - p, 3);
      piece.x = startX + (d.targetX - startX) * ease;
      piece.y = startY + (d.targetY - startY) * ease;
      piece.rotation = startRotation * (1 - ease);
      if (p >= 1) {
        app.ticker.remove(animate);
        piece.position.set(d.targetX, d.targetY);
        piece.rotation = 0;
        piece.scale.set(1);
        checkWin();
      }
    };
    app.ticker.add(animate);
  }

  function checkWin() {
    if (!pieces.length || !pieces.every(p => p.pieceData.locked)) return;
    completed = true;
    stopTimer();
    winText.textContent = `完成時間 ${formatTime(elapsed)}，共移動 ${moves} 次。`;
    setTimeout(() => winPanel.classList.add('show'), 350);
  }

  function buildGame() {
    if (!sourceTexture) return;
    clearStage();
    calculateLayout();
    drawBoardBackground();

    const { cols, rows } = levels[levelIndex];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        createPiece(col, row, cols, rows);
      }
    }

    // 讓後建立的拼圖片不會完全蓋住前面，並重新洗牌顯示層級。
    pieces.sort(() => Math.random() - 0.5).forEach(piece => pieceLayer.addChild(piece));
    moves = 0;
    completed = false;
    previewing = false;
    winPanel.classList.remove('show');
    resetTimer();
    levelBtn.textContent = `難度：${cols} × ${rows}`;
  }

  function setPreview(show) {
    if (!previewSprite || completed) return;
    previewing = show;
    previewSprite.visible = show;
    previewSprite.alpha = show ? 0.96 : 0;
    pieceLayer.alpha = show ? 0.08 : 1;
  }

  function bindHoldPreview() {
    const show = event => { event.preventDefault(); setPreview(true); };
    const hide = event => { event.preventDefault(); setPreview(false); };
    previewBtn.addEventListener('pointerdown', show);
    previewBtn.addEventListener('pointerup', hide);
    previewBtn.addEventListener('pointercancel', hide);
    previewBtn.addEventListener('pointerleave', hide);
  }

  /* ---------- 照片：儲存 / 讀取（IndexedDB） ---------- */

  const DB_NAME = 'puzzle-photo-db';
  const STORE = 'photo';
  const KEY = 'current';

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('no indexedDB')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function savePhoto(blob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadPhoto() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  /* ---------- 照片：解碼 / 縮圖 / 轉成材質 ---------- */

  // 用 <img> 解碼（createImageBitmap 不支援時的後備）
  function loadViaImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
      img.src = url;
    });
  }

  // 讀取照片、依 EXIF 轉正、縮到合理大小，輸出壓縮後的 JPEG blob
  async function processImage(file) {
    const maxDim = 1600;
    let drawable;
    try {
      drawable = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      drawable = await loadViaImage(file);
    }

    const srcW = drawable.width;
    const srcH = drawable.height;
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(drawable, 0, 0, w, h);
    if (drawable.close) drawable.close();

    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
    if (blob) return blob;

    // toBlob 後備：dataURL -> blob
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const res = await fetch(dataUrl);
    return res.blob();
  }

  // blob -> PIXI 材質
  function blobToTexture(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const texture = PIXI.Texture.from(img);
        const finish = () => { URL.revokeObjectURL(url); resolve(texture); };
        if (texture.baseTexture.valid) finish();
        else texture.baseTexture.once('loaded', finish);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('texture load failed')); };
      img.src = url;
    });
  }

  /* ---------- 照片：流程控制 ---------- */

  function showStart() { startPanel.classList.add('show'); }
  function hideStart() { startPanel.classList.remove('show'); }

  function setBusy(busy) {
    processing = busy;
    photoInput.disabled = busy;                 // 處理中禁止再開相簿
    pickPhotoBtn.textContent = busy ? '處理中…' : '選擇照片';
    pickPhotoBtn.classList.toggle('is-busy', busy);
    changePhotoBtn.classList.toggle('is-busy', busy);
  }

  async function setPhotoFromFile(file) {
    if (!file || processing) return;
    setBusy(true);
    try {
      const blob = await processImage(file);
      if (!blob) throw new Error('empty blob');

      // 存起來，下次打開沿用同一張（失敗也不影響本次遊玩）
      try { await savePhoto(blob); }
      catch (e) { console.warn('照片無法保存，本次仍可正常遊玩。', e); }

      const texture = await blobToTexture(blob);
      const old = sourceTexture;
      sourceTexture = texture;

      hideStart();
      buildGame();

      if (old) { try { old.destroy(true); } catch (e) { /* ignore */ } }
    } catch (e) {
      console.error(e);
      alert('這張照片讀取失敗，換一張再試試看。');
    } finally {
      setBusy(false);
    }
  }

  /* ---------- 事件綁定 ---------- */

  shuffleBtn.addEventListener('click', () => {
    if (!sourceTexture) return;      // 還沒選照片時，開始面板會提示
    buildGame();
  });
  playAgainBtn.addEventListener('click', buildGame);
  levelBtn.addEventListener('click', () => {
    if (!sourceTexture) return;
    levelIndex = (levelIndex + 1) % levels.length;
    buildGame();
  });
  bindHoldPreview();

  // 換照片的按鈕都是 <label for="photo-input">，由瀏覽器原生開啟相簿，
  // 這裡只需處理選好之後的檔案。
  photoInput.addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';   // 允許重複選同一個檔案
    setPhotoFromFile(file);
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(buildGame, 180);
  });

  /* ---------- 啟動 ---------- */

  (async function init() {
    let saved = null;
    try { saved = await loadPhoto(); } catch (e) { saved = null; }

    if (saved) {
      try {
        sourceTexture = await blobToTexture(saved);
        hideStart();
        buildGame();
        return;
      } catch (e) {
        console.warn('已保存的照片讀取失敗，請重新選擇。', e);
      }
    }
    showStart();
  })();
})();
