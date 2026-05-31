// --- ИНИЦИАЛИЗАЦИЯ СЦЕНЫ И КОНВЕЙЕРА РЕНДЕРИНГА ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c0c0e);
scene.fog = new THREE.Fog(0x0c0c0e, 12, 35);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
const targetCameraPos = new THREE.Vector3(0, 9, -9);
camera.position.copy(targetCameraPos);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Настройка источников освещения
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(5, 18, 2);
scene.add(dirLight);
scene.add(new THREE.AmbientLight(0x555566));

// --- ОПРЕДЕЛЕНИЕ ШЕЙДЕРОВ И МАТЕРИАЛОВ ---
const vertexShader = `
    varying vec2 vUv; 
    void main() { 
        vUv = uv; 
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); 
    }
`;

const fragmentShader = `
    uniform float time; 
    uniform vec3 baseColor; 
    varying vec2 vUv;
    void main() {
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x) * smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.88, vUv.y);
        vec3 glow = vec3(0.1, 0.12, 0.18) * (sin(time * 1.5) * 0.3 + 0.7) * (1.0 - edge);
        gl_FragColor = vec4(baseColor + glow, 1.0);
    }
`;

const blackTileMat = new THREE.ShaderMaterial({ 
    uniforms: { time: { value: 0 }, baseColor: { value: new THREE.Color(0x16161a) } }, 
    vertexShader, 
    fragmentShader 
});

const whiteTileMat = new THREE.MeshPhongMaterial({ color: 0xe2e2e9, shininess: 40 });
const pieceWhiteMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 70 });
const pieceBlackMat = new THREE.MeshPhongMaterial({ color: 0x222226, shininess: 70 });
const selectedMat = new THREE.MeshPhongMaterial({ color: 0x00ffcc, emissive: 0x003322 });
const highlightMat = new THREE.MeshPhongMaterial({ color: 0x00ff66, emissive: 0x004411 });

// --- ПЕРЕМЕННЫЕ СОСТОЯНИЯ И СИСТЕМЫ ОЦЕНКИ ---
let gameActive = true;
let totalMoves = 0;
let diamondMovesCount = 0;
let startTime = Date.now();
let pendingPromotion = null; 
const pieceWeight = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 900 };

const boardGroup = new THREE.Group();
scene.add(boardGroup);
const tiles = [];
const pieces = [];
let grid = Array(8).fill(null).map(() => Array(8).fill(null));

const offset = -3.5;
let currentPlayer = 1; // 1 = Белые, 2 = Черные
let gameMode = 'pvp';
let selectedPiece = null;
let highlightedTiles = [];

// --- МОДУЛЬ ПРОЦЕДУРНОЙ ГЕНЕРАЦИИ ГЕОМЕТРИИ ---
function buildChessPiece(type, mat) {
    const group = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.08, 16), mat);
    base.position.y = 0.04; 
    group.add(base);

    if (type === 'p') {
        const body = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 16), mat); body.position.y = 0.28;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 16), mat); head.position.y = 0.5;
        group.add(body, head);
    } else if (type === 'r') {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.5, 16), mat); body.position.y = 0.33;
        const top = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.15, 16), mat); top.position.y = 0.6;
        group.add(body, top);
    } else if (type === 'n') {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.38, 0.25), mat); body.position.set(0, 0.27, 0.03);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.35), mat); head.position.set(0, 0.45, 0.08);
        group.add(body, head);
    } else if (type === 'b') {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, 0.5, 16), mat); body.position.y = 0.33;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), mat); head.scale.set(1, 1.4, 1); head.position.y = 0.6;
        group.add(body, head);
    } else if (type === 'q') {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, 0.6, 16), mat); body.position.y = 0.38;
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.14, 0.2, 16), mat); crown.position.y = 0.75;
        group.add(body, crown);
    } else if (type === 'k') {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 0.65, 16), mat); body.position.y = 0.4;
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.18, 0.2, 16), mat); crown.position.y = 0.8;
        const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 0.05), mat); crossH.position.y = 0.95;
        const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.05), mat); crossV.position.y = 0.95;
        group.add(body, crown, crossH, crossV);
    }
    return group;
}

function createLabelMesh(text) {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#0c0c0e'; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 36px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 32, 32);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), side: THREE.DoubleSide }));
    plane.rotation.x = -Math.PI / 2; return plane;
}

function initGame() {
    const backRow = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    for (let x = 0; x < 8; x++) {
        for (let z = 0; z < 8; z++) {
            const tile = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 1), (x + z) % 2 !== 0 ? blackTileMat : whiteTileMat);
            tile.position.set(x + offset, 0, z + offset);
            tile.userData = { x, z, isBlackTile: (x + z) % 2 !== 0 };
            boardGroup.add(tile); tiles.push(tile);

            if (z === 0) spawnPiece(x, z, backRow[x], 1);
            if (z === 1) spawnPiece(x, z, 'p', 1);
            if (z === 7) spawnPiece(x, z, backRow[x], 2);
            if (z === 6) spawnPiece(x, z, 'p', 2);
        }
        const lblB = createLabelMesh(letters[x]); lblB.position.set(x + offset, 0.11, -4.3); boardGroup.add(lblB);
        const lblT = createLabelMesh(letters[x]); lblT.position.set(x + offset, 0.11, 4.3); lblT.rotation.z = Math.PI; boardGroup.add(lblT);
        const lblL = createLabelMesh((x + 1).toString()); lblL.position.set(-4.3, 0.11, x + offset); lblL.rotation.z = -Math.PI / 2; boardGroup.add(lblL);
        const lblR = createLabelMesh((x + 1).toString()); lblR.position.set(4.3, 0.11, x + offset); lblR.rotation.z = Math.PI / 2; boardGroup.add(lblR);
    }
    updateTimer();
}

function spawnPiece(x, z, type, color) {
    const mesh = buildChessPiece(type, color === 1 ? pieceWhiteMat : pieceBlackMat);
    mesh.position.set(x + offset, 0.1, z + offset);
    mesh.userData = { x, z, type, color };
    boardGroup.add(mesh); pieces.push(mesh);
    grid[x][z] = { type, color, mesh };
}
initGame();

// --- АЛГОРИТМ ГЕНЕРАЦИИ ПСЕВДОЛЕГАЛЬНЫХ ХОДОВ ---
function getPseudoMoves(x, z, checkGrid, ignoreColor = null) {
    const moves = [];
    const p = checkGrid[x][z];
    if (!p || p.color === ignoreColor) return moves;

    const color = p.color;
    const type = p.type;

    function addRay(dx, dz) {
        let tx = x + dx, tz = z + dz;
        while (tx >= 0 && tx < 8 && tz >= 0 && tz < 8) {
            const target = checkGrid[tx][tz];
            if (!target) { moves.push({ x: tx, z: tz }); } 
            else { if (target.color !== color) moves.push({ x: tx, z: tz }); break; }
            tx += dx; tz += dz;
        }
    }
    function addStep(dx, dz) {
        const tx = x + dx, tz = z + dz;
        if (tx >= 0 && tx < 8 && tz >= 0 && tz < 8) {
            const target = checkGrid[tx][tz];
            if (!target || target.color !== color) moves.push({ x: tx, z: tz });
        }
    }

    if (type === 'p') {
        const dir = color === 1 ? 1 : -1;
        const startRow = color === 1 ? 1 : 6;
        if (z + dir >= 0 && z + dir < 8 && !checkGrid[x][z + dir]) {
            moves.push({ x, z: z + dir });
            if (z === startRow && !checkGrid[x][z + dir * 2] && !checkGrid[x][z + dir]) moves.push({ x, z: z + dir * 2 });
        }
        [-1, 1].forEach(dx => {
            if (x + dx >= 0 && x + dx < 8 && z + dir >= 0 && z + dir < 8) {
                const t = checkGrid[x + dx][z + dir];
                if (t && t.color !== color) moves.push({ x: x + dx, z: z + dir });
            }
        });
    } else if (type === 'r') [[1,0], [-1,0], [0,1], [0,-1]].forEach(d => addRay(d[0], d[1]));
    else if (type === 'b') [[1,1], [1,-1], [-1,1], [-1,-1]].forEach(d => addRay(d[0], d[1]));
    else if (type === 'q') [[1,0], [-1,0], [0,1], [0,-1], [1,1], [1,-1], [-1,1], [-1,-1]].forEach(d => addRay(d[0], d[1]));
    else if (type === 'n') [[1,2], [2,1], [-1,2], [-2,1], [1,-2], [2,-1], [-1,-2], [-2,-1]].forEach(o => addStep(o[0], o[1]));
    else if (type === 'k') [[1,0], [-1,0], [0,1], [0,-1], [1,1], [1,-1], [-1,1], [-1,-1]].forEach(o => addStep(o[0], o[1]));

    return moves;
}

// --- СИСТЕМЫ ВАЛИДАЦИИ, МАТРИЧНЫХ КЛОНОВ И АНАЛИЗА УГРОЗ ---
function cloneGrid() {
    return grid.map(r => r.map(c => c ? { type: c.type, color: c.color } : null));
}

function isKingInCheck(color, checkGrid) {
    let kx = -1, kz = -1;
    for (let x = 0; x < 8; x++) {
        for (let z = 0; z < 8; z++) {
            if (checkGrid[x][z] && checkGrid[x][z].type === 'k' && checkGrid[x][z].color === color) {
                kx = x; kz = z; break;
            }
        }
    }
    if (kx === -1) return false;

    const enemyColor = color === 1 ? 2 : 1;
    for (let x = 0; x < 8; x++) {
        for (let z = 0; z < 8; z++) {
            if (checkGrid[x][z] && checkGrid[x][z].color === enemyColor) {
                const enemyMoves = getPseudoMoves(x, z, checkGrid);
                if (enemyMoves.some(m => m.x === kx && m.z === kz)) return true;
            }
        }
    }
    return false;
}

function getLegalMoves(x, z) {
    const pseudoMoves = getPseudoMoves(x, z, grid);
    const validMoves = [];
    const p = grid[x][z];

    pseudoMoves.forEach(m => {
        const tempGrid = cloneGrid();
        tempGrid[m.x][m.z] = tempGrid[x][z];
        tempGrid[x][z] = null;
        if (!isKingInCheck(p.color, tempGrid)) {
            validMoves.push(m);
        }
    });
    return validMoves;
}

function checkGameState(color) {
    let hasMoves = false;
    for (let x = 0; x < 8; x++) {
        for (let z = 0; z < 8; z++) {
            if (grid[x][z] && grid[x][z].color === color) {
                if (getLegalMoves(x, z).length > 0) hasMoves = true;
            }
        }
    }

    const inCheck = isKingInCheck(color, grid);
    
    if (inCheck && !hasMoves) endGame("Мат", color === 1 ? "Черные" : "Белые");
    else if (!inCheck && !hasMoves) endGame("Ничья (Пат)", "Никто не");
    else if (inCheck) document.getElementById('check-alert').classList.remove('hidden');
    else document.getElementById('check-alert').classList.add('hidden');
}

// --- ОБРАБОТКА ДВИЖЕНИЯ И ТРАНСФОРМАЦИЯ ПЕШКИ ---
function executeMove(pieceMesh, targetX, targetZ) {
    if (!gameActive || pendingPromotion) return;

    const startX = pieceMesh.userData.x;
    const startZ = pieceMesh.userData.z;
    const targetCell = grid[targetX][targetZ];

    // Оценка ценности взятия для "алмазного хода"
    if (targetCell && pieceWeight[targetCell.type] > pieceWeight[pieceMesh.userData.type]) {
        diamondMovesCount++;
    }

    if (targetCell) {
        boardGroup.remove(targetCell.mesh);
        pieces.splice(pieces.indexOf(targetCell.mesh), 1);
    }

    grid[targetX][targetZ] = grid[startX][startZ];
    grid[startX][startZ] = null;
    pieceMesh.position.set(targetX + offset, 0.1, targetZ + offset);
    pieceMesh.userData.x = targetX; pieceMesh.userData.z = targetZ;
    
    clearHighlights();
    pieceMesh.children.forEach(child => child.material = pieceMesh.userData.color === 1 ? pieceWhiteMat : pieceBlackMat);
    selectedPiece = null;

    // Проверка условий превращения пешки (крайние горизонтали)
    if (pieceMesh.userData.type === 'p' && (targetZ === 7 || targetZ === 0)) {
        pendingPromotion = { mesh: pieceMesh, x: targetX, z: targetZ, color: currentPlayer };
        
        if (gameMode === 'pvp' || currentPlayer === 1) {
            document.getElementById('promotion-modal').classList.remove('hidden');
            return; // Прерываем завершение хода до выбора игрока
        } else {
            promotePawn('q'); // ИИ по умолчанию производит автовыбор ферзя
            return;
        }
    }

    finalizeTurn();
}

window.promotePawn = function(newType) {
    if (!pendingPromotion) return;
    
    document.getElementById('promotion-modal').classList.add('hidden');
    const { mesh, x, z, color } = pendingPromotion;
    
    // Удаление меша пешки со сцены
    boardGroup.remove(mesh);
    pieces.splice(pieces.indexOf(mesh), 1);
    
    // Создание новой сгенерированной фигуры на той же позиции
    const mat = color === 1 ? pieceWhiteMat : pieceBlackMat;
    const newMesh = buildChessPiece(newType, mat);
    newMesh.position.set(x + offset, 0.1, z + offset);
    newMesh.userData = { x, z, type: newType, color };
    
    boardGroup.add(newMesh);
    pieces.push(newMesh);
    grid[x][z] = { type: newType, color, mesh: newMesh };
    
    pendingPromotion = null;
    finalizeTurn();
};

function finalizeTurn() {
    totalMoves++;
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    
    checkGameState(currentPlayer);
    if (!gameActive) {
        if (isKingInCheck(currentPlayer, grid)) diamondMovesCount++; 
        return;
    }

    updateStatus();
    targetCameraPos.set(0, 9, currentPlayer === 1 ? -9 : 9);

    if (gameMode === 'pvc' && currentPlayer === 2) setTimeout(makePCMove, 1000);
}

// --- СИСТЕМА RAYCASTING (ОБРАБОТКА НАЖАТИЙ) ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

window.addEventListener('mousedown', (e) => {
    if (!gameActive || pendingPromotion || (gameMode === 'pvc' && currentPlayer === 2)) return;

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1; 
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    
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

function highlightMoves(moves) {
    clearHighlights();
    moves.forEach(m => {
        const tile = tiles.find(t => t.userData.x === m.x && t.userData.z === m.z);
        if (tile) { tile.material = highlightMat; highlightedTiles.push(tile); }
    });
}
function clearHighlights() {
    highlightedTiles.forEach(t => t.material = t.userData.isBlackTile ? blackTileMat : whiteTileMat);
    highlightedTiles = [];
}

// --- МОДУЛЬ ИСКУССТВЕННОГО ИНТЕЛЛЕКТА (ОЦЕНКА ВЕСОВ) ---
function makePCMove() {
    if (!gameActive || pendingPromotion) return;
    let aiOptions = [];
    pieces.filter(p => p.userData.color === 2).forEach(mesh => {
        getLegalMoves(mesh.userData.x, mesh.userData.z).forEach(m => {
            let score = 1;
            const enemy = grid[m.x][m.z];
            if (enemy) score = pieceWeight[enemy.type] * 10;
            aiOptions.push({ mesh, x: m.x, z: m.z, score });
        });
    });

    if (aiOptions.length > 0) {
        aiOptions.sort((a, b) => b.score - a.score);
        const best = aiOptions[0];
        executeMove(best.mesh, best.x, best.z);
    }
}

// --- ИНТЕРФЕЙС, ТАЙМЕРЫ И ФИКСАЦИЯ ИСХОДОВ ---
window.setMode = function(mode) {
    gameMode = mode;
    document.getElementById('btn-pvp').classList.toggle('active', mode === 'pvp');
    document.getElementById('btn-pvc').classList.toggle('active', mode === 'pvc');
};

function updateStatus() {
    document.getElementById('status').innerText = `Ход: ${currentPlayer === 1 ? "Белые" : (gameMode === 'pvc' ? "Компьютер (Черные)" : "Черные")}`;
}

function updateTimer() {
    if (!gameActive) return;
    const diff = Math.floor((Date.now() - startTime) / 1000);
    const m = String(Math.floor(diff / 60)).padStart(2, '0');
    const s = String(diff % 60).padStart(2, '0');
    document.getElementById('timer').innerText = `Время: ${m}:${s}`;
    setTimeout(updateTimer, 1000);
}

function endGame(reason, winner) {
    gameActive = false;
    document.getElementById('check-alert').classList.add('hidden');
    
    document.getElementById('end-title').innerText = reason === "Мат" ? "Шах и мат!" : "Ничья!";
    document.getElementById('end-winner').innerText = `${winner} победили`;
    
    document.getElementById('stat-moves').innerText = totalMoves;
    document.getElementById('stat-diamond').innerText = diamondMovesCount;
    document.getElementById('stat-time').innerText = document.getElementById('timer').innerText.replace('Время: ', '');
    
    document.getElementById('game-over').classList.remove('hidden');
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- ЦИКЛ РЕНДЕРИНГА И ЛИНЕЙНОЙ ИНТЕРПОЛЯЦИИ ---
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    blackTileMat.uniforms.time.value = clock.getElapsedTime();
    camera.position.lerp(targetCameraPos, 0.012);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
}
animate();
