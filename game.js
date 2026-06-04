// --- СЕТЕВАЯ ЛОГИКА И МЕНЮ ---
const socket = io('http://localhost:3000'); // ПРИ РАЗВЕРТЫВАНИИ ЗАМЕНИТЬ НА URL СЕРВЕРА

let gameMode = null; // 'pvp', 'pvc', 'network'
let myNetworkColor = 1; // 1 = Белые, 2 = Черные
let currentRoom = null;

function hideAllMenus() {
    document.getElementById('menu-base').classList.add('hidden');
    document.getElementById('mode-selection').classList.add('hidden');
    document.getElementById('network-menu').classList.add('hidden');
}

function showModeSelection() { hideAllMenus(); document.getElementById('mode-selection').classList.remove('hidden'); }
function showNetworkMenu() { hideAllMenus(); document.getElementById('network-menu').classList.remove('hidden'); document.getElementById('network-status').innerText = ""; }
function goBack(id) { hideAllMenus(); document.getElementById(id).classList.remove('hidden'); }

function initLocalGame(mode) {
    gameMode = mode;
    myNetworkColor = 1; // В локальной игре мы всегда начинаем за Белых (камера внизу)
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('game-ui').classList.remove('hidden');
    start3DEngine();
}

function createNetworkRoom() {
    document.getElementById('network-status').innerText = "Создание комнаты...";
    socket.emit('createRoom');
}

function joinNetworkRoom() {
    const code = document.getElementById('room-code-input').value.toUpperCase();
    if(code.length > 0) socket.emit('joinRoom', code);
}

socket.on('roomCreated', (code) => {
    currentRoom = code;
    myNetworkColor = 1; // Создатель играет Белыми
    document.getElementById('network-status').innerText = `Код вашей комнаты: ${code}\nОжидание соперника...`;
});

socket.on('joinedRoom', (code) => {
    currentRoom = code;
    myNetworkColor = 2; // Вошедший играет Черными
    gameMode = 'network';
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('game-ui').classList.remove('hidden');
    document.getElementById('room-display').classList.remove('hidden');
    document.getElementById('room-display').innerText = `Комната: ${code}`;
    start3DEngine();
});

socket.on('gameStarted', () => {
    gameMode = 'network';
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('game-ui').classList.remove('hidden');
    document.getElementById('room-display').classList.remove('hidden');
    document.getElementById('room-display').innerText = `Комната: ${currentRoom}`;
    start3DEngine();
});

socket.on('errorMsg', (msg) => { alert(msg); });

// --- ПРИЕМ ХОДОВ ПО СЕТИ ---
socket.on('opponentMove', (data) => {
    const piece = grid[data.startX][data.startZ].mesh;
    executeMove(piece, data.targetX, data.targetZ, true); // true = ход пришел из сети
});

socket.on('opponentPromote', (data) => {
    const piece = grid[data.x][data.z].mesh;
    pendingPromotion = { mesh: piece, x: data.x, z: data.z, color: piece.userData.color };
    applyPromotion(data.type);
});

// --- ДВИЖОК 3D И ЛОГИКА ---
let scene, camera, renderer, boardGroup;
let gameActive = false, totalMoves = 0, diamondMovesCount = 0, startTime;
let pendingPromotion = null;
const tiles = [], pieces = [];
let grid = Array(8).fill(null).map(() => Array(8).fill(null));
let currentPlayer = 1; 
let selectedPiece = null;
let highlightedTiles = [];
const pieceWeight = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 900 };

// Вынесенные материалы
const offset = -3.5;
let blackTileMat, whiteTileMat, pieceWhiteMat, pieceBlackMat, selectedMat, highlightMat;

function start3DEngine() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0c0e);
    scene.fog = new THREE.Fog(0x0c0c0e, 12, 35);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    // Изначальная позиция камеры зависит от цвета игрока в сети
    camera.position.set(0, 9, myNetworkColor === 1 ? -9 : 9);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 18, 2);
    scene.add(dirLight);
    scene.add(new THREE.AmbientLight(0x555566));

    const vShader = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
    const fShader = `uniform float time; uniform vec3 baseColor; varying vec2 vUv; void main() { float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x) * smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.88, vUv.y); vec3 glow = vec3(0.1, 0.12, 0.18) * (sin(time * 1.5) * 0.3 + 0.7) * (1.0 - edge); gl_FragColor = vec4(baseColor + glow, 1.0); }`;

    blackTileMat = new THREE.ShaderMaterial({ uniforms: { time: { value: 0 }, baseColor: { value: new THREE.Color(0x16161a) } }, vertexShader: vShader, fragmentShader: fShader });
    whiteTileMat = new THREE.MeshPhongMaterial({ color: 0xe2e2e9, shininess: 40 });
    pieceWhiteMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 70 });
    pieceBlackMat = new THREE.MeshPhongMaterial({ color: 0x222226, shininess: 70 });
    selectedMat = new THREE.MeshPhongMaterial({ color: 0x00ffcc, emissive: 0x003322 });
    highlightMat = new THREE.MeshPhongMaterial({ color: 0x00ff66, emissive: 0x004411 });

    boardGroup = new THREE.Group();
    scene.add(boardGroup);

    initBoard();
    gameActive = true;
    startTime = Date.now();
    updateTimer();
    updateStatus();
    animate();
}

function buildChessPiece(type, mat) {
    const group = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.08, 16), mat); base.position.y = 0.04; group.add(base);
    if (type === 'p') { const b = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 16), mat); b.position.y = 0.28; const h = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 16), mat); h.position.y = 0.5; group.add(b, h); } 
    else if (type === 'r') { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.5, 16), mat); b.position.y = 0.33; const t = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.15, 16), mat); t.position.y = 0.6; group.add(b, t); } 
    else if (type === 'n') { const b = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.38, 0.25), mat); b.position.set(0, 0.27, 0.03); const h = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.35), mat); h.position.set(0, 0.45, 0.08); group.add(b, h); } 
    else if (type === 'b') { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, 0.5, 16), mat); b.position.y = 0.33; const h = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), mat); h.scale.set(1, 1.4, 1); h.position.y = 0.6; group.add(b, h); } 
    else if (type === 'q') { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, 0.6, 16), mat); b.position.y = 0.38; const c = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.14, 0.2, 16), mat); c.position.y = 0.75; group.add(b, c); } 
    else if (type === 'k') { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 0.65, 16), mat); b.position.y = 0.4; const c = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.18, 0.2, 16), mat); c.position.y = 0.8; const ch = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 0.05), mat); ch.position.y = 0.95; const cv = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.05), mat); cv.position.y = 0.95; group.add(b, c, ch, cv); }
    return group;
}

function initBoard() {
    const backRow = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    for (let x = 0; x < 8; x++) {
        for (let z = 0; z < 8; z++) {
            const tile = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 1), (x + z) % 2 !== 0 ? blackTileMat : whiteTileMat);
            tile.position.set(x + offset, 0, z + offset); tile.userData = { x, z, isBlackTile: (x + z) % 2 !== 0 };
            boardGroup.add(tile); tiles.push(tile);
            if (z === 0) spawnPiece(x, z, backRow[x], 1);
            if (z === 1) spawnPiece(x, z, 'p', 1);
            if (z === 7) spawnPiece(x, z, backRow[x], 2);
            if (z === 6) spawnPiece(x, z, 'p', 2);
        }
    }
}

function spawnPiece(x, z, type, color) {
    const mesh = buildChessPiece(type, color === 1 ? pieceWhiteMat : pieceBlackMat);
    mesh.position.set(x + offset, 0.1, z + offset); mesh.userData = { x, z, type, color };
    boardGroup.add(mesh); pieces.push(mesh); grid[x][z] = { type, color, mesh };
}

function getPseudoMoves(x, z, checkGrid, ignoreColor = null) {
    const moves = []; const p = checkGrid[x][z]; if (!p || p.color === ignoreColor) return moves;
    const color = p.color; const type = p.type;
    function addRay(dx, dz) { let tx = x + dx, tz = z + dz; while (tx >= 0 && tx < 8 && tz >= 0 && tz < 8) { const t = checkGrid[tx][tz]; if (!t) { moves.push({ x: tx, z: tz }); } else { if (t.color !== color) moves.push({ x: tx, z: tz }); break; } tx += dx; tz += dz; } }
    function addStep(dx, dz) { const tx = x + dx, tz = z + dz; if (tx >= 0 && tx < 8 && tz >= 0 && tz < 8) { const t = checkGrid[tx][tz]; if (!t || t.color !== color) moves.push({ x: tx, z: tz }); } }
    if (type === 'p') {
        const dir = color === 1 ? 1 : -1; const startRow = color === 1 ? 1 : 6;
        if (z + dir >= 0 && z + dir < 8 && !checkGrid[x][z + dir]) { moves.push({ x, z: z + dir }); if (z === startRow && !checkGrid[x][z + dir * 2]) moves.push({ x, z: z + dir * 2 }); }
        [-1, 1].forEach(dx => { if (x + dx >= 0 && x + dx < 8 && z + dir >= 0 && z + dir < 8) { const t = checkGrid[x + dx][z + dir]; if (t && t.color !== color) moves.push({ x: x + dx, z: z + dir }); } });
    } else if (type === 'r') [[1,0], [-1,0], [0,1], [0,-1]].forEach(d => addRay(d[0], d[1]));
    else if (type === 'b') [[1,1], [1,-1], [-1,1], [-1,-1]].forEach(d => addRay(d[0], d[1]));
    else if (type === 'q') [[1,0], [-1,0], [0,1], [0,-1], [1,1], [1,-1], [-1,1], [-1,-1]].forEach(d => addRay(d[0], d[1]));
    else if (type === 'n') [[1,2], [2,1], [-1,2], [-2,1], [1,-2], [2,-1], [-1,-2], [-2,-1]].forEach(o => addStep(o[0], o[1]));
    else if (type === 'k') [[1,0], [-1,0], [0,1], [0,-1], [1,1], [1,-1], [-1,1], [-1,-1]].forEach(o => addStep(o[0], o[1]));
    return moves;
}

function isKingInCheck(color, checkGrid) {
    let kx = -1, kz = -1;
    for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) if (checkGrid[x][z] && checkGrid[x][z].type === 'k' && checkGrid[x][z].color === color) { kx = x; kz = z; break; }
    if (kx === -1) return false;
    const eColor = color === 1 ? 2 : 1;
    for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) if (checkGrid[x][z] && checkGrid[x][z].color === eColor) if (getPseudoMoves(x, z, checkGrid).some(m => m.x === kx && m.z === kz)) return true;
    return false;
}

function getLegalMoves(x, z) {
    const valid = []; const p = grid[x][z];
    getPseudoMoves(x, z, grid).forEach(m => {
        const temp = grid.map(r => r.map(c => c ? { type: c.type, color: c.color } : null));
        temp[m.x][m.z] = temp[x][z]; temp[x][z] = null;
        if (!isKingInCheck(p.color, temp)) valid.push(m);
    });
    return valid;
}

function checkGameState(color) {
    let hasMoves = false;
    for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) if (grid[x][z] && grid[x][z].color === color) if (getLegalMoves(x, z).length > 0) hasMoves = true;
    const inCheck = isKingInCheck(color, grid);
    if (inCheck && !hasMoves) endGame("Мат", color === 1 ? "Черные" : "Белые");
    else if (!inCheck && !hasMoves) endGame("Ничья (Пат)", "Никто не");
    else document.getElementById('check-alert').classList.toggle('hidden', !inCheck);
}

// --- ВЫПОЛНЕНИЕ ХОДА ---
function executeMove(pieceMesh, targetX, targetZ, isFromNetwork = false) {
    if (!gameActive || pendingPromotion) return;

    const startX = pieceMesh.userData.x; const startZ = pieceMesh.userData.z;
    const targetCell = grid[targetX][targetZ];

    // Отправка хода по сети, если это наш локальный ход
    if (gameMode === 'network' && !isFromNetwork) {
        socket.emit('move', { room: currentRoom, startX, startZ, targetX, targetZ });
    }

    if (targetCell && pieceWeight[targetCell.type] > pieceWeight[pieceMesh.userData.type]) diamondMovesCount++;
    if (targetCell) { boardGroup.remove(targetCell.mesh); pieces.splice(pieces.indexOf(targetCell.mesh), 1); }

    grid[targetX][targetZ] = grid[startX][startZ]; grid[startX][startZ] = null;
    pieceMesh.position.set(targetX + offset, 0.1, targetZ + offset);
    pieceMesh.userData.x = targetX; pieceMesh.userData.z = targetZ;
    
    clearHighlights();
    pieceMesh.children.forEach(child => child.material = pieceMesh.userData.color === 1 ? pieceWhiteMat : pieceBlackMat);
    selectedPiece = null;

    if (pieceMesh.userData.type === 'p' && (targetZ === 7 || targetZ === 0)) {
        pendingPromotion = { mesh: pieceMesh, x: targetX, z: targetZ, color: currentPlayer };
        
        if (gameMode === 'pvp' || (gameMode === 'network' && currentPlayer === myNetworkColor) || (gameMode === 'pvc' && currentPlayer === 1)) {
            document.getElementById('promotion-modal').classList.remove('hidden');
            return;
        } else if (gameMode === 'pvc') {
            applyPromotion('q'); 
            return;
        }
        return; // Если это ход сети, ждем события 'opponentPromote'
    }
    finalizeTurn();
}

window.sendPromotion = function(newType) {
    if (gameMode === 'network') socket.emit('promote', { room: currentRoom, x: pendingPromotion.x, z: pendingPromotion.z, type: newType });
    applyPromotion(newType);
}

function applyPromotion(newType) {
    if (!pendingPromotion) return;
    document.getElementById('promotion-modal').classList.add('hidden');
    const { mesh, x, z, color } = pendingPromotion;
    boardGroup.remove(mesh); pieces.splice(pieces.indexOf(mesh), 1);
    
    const newMesh = buildChessPiece(newType, color === 1 ? pieceWhiteMat : pieceBlackMat);
    newMesh.position.set(x + offset, 0.1, z + offset); newMesh.userData = { x, z, type: newType, color };
    boardGroup.add(newMesh); pieces.push(newMesh); grid[x][z] = { type: newType, color, mesh: newMesh };
    
    pendingPromotion = null;
    finalizeTurn();
}

function finalizeTurn() {
    totalMoves++; currentPlayer = currentPlayer === 1 ? 2 : 1;
    checkGameState(currentPlayer);
    if (!gameActive) { if (isKingInCheck(currentPlayer, grid)) diamondMovesCount++; return; }
    updateStatus();

    // Камера крутится только в локальном PVP
    if (gameMode === 'pvp') {
        camera.position.set(0, 9, currentPlayer === 1 ? -9 : 9);
    }
    if (gameMode === 'pvc' && currentPlayer === 2) setTimeout(makePCMove, 1000);
}

// --- УПРАВЛЕНИЕ И ИИ ---
const raycaster = new THREE.Raycaster(); const mouse = new THREE.Vector2();

window.addEventListener('mousedown', (e) => {
    if (!gameActive || pendingPromotion) return;
    // Блокировка нажатий не в свой ход
    if (gameMode === 'pvc' && currentPlayer === 2) return;
    if (gameMode === 'network' && currentPlayer !== myNetworkColor) return;

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1; mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    if(!camera) return;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(boardGroup.children, true);
    if (intersects.length === 0) return;

    let clicked = intersects[0].object;
    while (clicked.parent && clicked.parent !== boardGroup && clicked.parent !== scene) clicked = clicked.parent;

    if (pieces.includes(clicked) && clicked.userData.color === currentPlayer) {
        if (selectedPiece) selectedPiece.children.forEach(c => c.material = selectedPiece.userData.color === 1 ? pieceWhiteMat : pieceBlackMat);
        selectedPiece = clicked;
        selectedPiece.children.forEach(c => c.material = selectedMat);
        highlightMoves(getLegalMoves(clicked.userData.x, clicked.userData.z));
    } else if (highlightedTiles.includes(clicked) && selectedPiece) {
        executeMove(selectedPiece, clicked.userData.x, clicked.userData.z);
    }
});

function highlightMoves(moves) { clearHighlights(); moves.forEach(m => { const tile = tiles.find(t => t.userData.x === m.x && t.userData.z === m.z); if (tile) { tile.material = highlightMat; highlightedTiles.push(tile); } }); }
function clearHighlights() { highlightedTiles.forEach(t => t.material = t.userData.isBlackTile ? blackTileMat : whiteTileMat); highlightedTiles = []; }

function makePCMove() {
    if (!gameActive || pendingPromotion) return;
    let aiOptions = [];
    pieces.filter(p => p.userData.color === 2).forEach(mesh => {
        getLegalMoves(mesh.userData.x, mesh.userData.z).forEach(m => {
            let score = 1; const enemy = grid[m.x][m.z]; if (enemy) score = pieceWeight[enemy.type] * 10;
            aiOptions.push({ mesh, x: m.x, z: m.z, score });
        });
    });
    if (aiOptions.length > 0) {
        aiOptions.sort((a, b) => b.score - a.score);
        executeMove(aiOptions[0].mesh, aiOptions[0].x, aiOptions[0].z);
    }
}

// --- UI ОБНОВЛЕНИЯ ---
function updateStatus() {
    let txt = currentPlayer === 1 ? "Белые" : "Черные";
    if(gameMode === 'network') txt += (currentPlayer === myNetworkColor) ? " (Ваш ход)" : " (Ход противника)";
    document.getElementById('status').innerText = `Ход: ${txt}`;
}

function updateTimer() {
    if (!gameActive) return;
    const diff = Math.floor((Date.now() - startTime) / 1000);
    document.getElementById('timer').innerText = `Время: ${String(Math.floor(diff / 60)).padStart(2, '0')}:${String(diff % 60).padStart(2, '0')}`;
    setTimeout(updateTimer, 1000);
}

function endGame(reason, winner) {
    gameActive = false; document.getElementById('check-alert').classList.add('hidden');
    document.getElementById('end-title').innerText = reason === "Мат" ? "Шах и мат!" : "Ничья!";
    document.getElementById('end-winner').innerText = `${winner} победили`;
    document.getElementById('stat-moves').innerText = totalMoves;
    document.getElementById('stat-diamond').innerText = diamondMovesCount;
    document.getElementById('stat-time').innerText = document.getElementById('timer').innerText.replace('Время: ', '');
    document.getElementById('game-over').classList.remove('hidden');
}

window.addEventListener('resize', () => {
    if(!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
    if(!gameActive) return;
    requestAnimationFrame(animate);
    blackTileMat.uniforms.time.value = Date.now() * 0.001;
    
    // В локальном PVP камера плавно крутится при передаче хода
    if (gameMode === 'pvp') {
        const targetZ = currentPlayer === 1 ? -9 : 9;
        camera.position.lerp(new THREE.Vector3(0, 9, targetZ), 0.05);
    }
    
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
}
