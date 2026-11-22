// ============================================================================
//  THE LAST WANDERER 3D  —  rewritten gameplay/render/UI layer
//  Vanilla JS + Canvas 2D. No external libs.
//  Fixes: crafting deadlock, stale gather timer, lost light intensity,
//         stacked ctx scale on resize; adds procedural pixel textures,
//         sky gradient + sun/moon + distance fog, warmer wood/stone HUD,
//         consolidated bottom dock, persistent crafting menu with close btn.
// ============================================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let GAME_W = 1280, GAME_H = 720;

function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap DPR for perf
    canvas.width  = Math.floor(window.innerWidth  * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width  = window.innerWidth  + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset before scaling (prevents stacking)
    ctx.scale(dpr, dpr);
    GAME_W = window.innerWidth;
    GAME_H = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
//  UI asset preloader — only the ITEM icons are still used (pixel-art SVGs).
//  All panels/slots/buttons/joystick are now drawn procedurally in canvas.
// ---------------------------------------------------------------------------
const uiAssets = {};
const assetList = [
    'item_wood', 'item_stone', 'item_metal', 'item_fiber',
    'item_axe', 'item_pickaxe', 'item_torch', 'item_campfire'
];

function loadAssets() {
    let promises = [];
    assetList.forEach(name => {
        uiAssets[name] = new Image();
        let p = new Promise((resolve) => {
            uiAssets[name].onload  = () => resolve();
            uiAssets[name].onerror = () => { console.warn(`Missing asset: ${name}`); resolve(); };
        });
        uiAssets[name].src = `assets/ui/${name}.svg`;
        promises.push(p);
    });
    return Promise.all(promises);
}

function drawUIImage(imgName, cx, cy, size) {
    if (uiAssets[imgName] && uiAssets[imgName].complete && uiAssets[imgName].naturalWidth !== 0) {
        ctx.drawImage(uiAssets[imgName], cx - size/2, cy - size/2, size, size);
    }
}

// ---------------------------------------------------------------------------
//  Procedural pixel textures (32x32, seeded) -> CanvasPatterns.
//  Applied to terrain tops and entity cube faces for a textured voxel look.
// ---------------------------------------------------------------------------
const PAT = {};
function buildPatterns() {
    let seed = 1337;
    const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const mk = (draw) => {
        const s = 32;
        const c = document.createElement('canvas');
        c.width = s; c.height = s;
        draw(c.getContext('2d'), s);
        return ctx.createPattern(c, 'repeat');
    };
    const px = (g, x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x|0, y|0, w, h); };

    PAT.grass = mk((g, s) => {
        g.fillStyle = '#4a5d23'; g.fillRect(0, 0, s, s);
        for (let i = 0; i < 80; i++) { g.fillStyle = rng() < 0.5 ? '#557128' : '#3e4d1c'; const ps = rng() < 0.2 ? 2 : 1; g.fillRect((rng()*s)|0, (rng()*s)|0, ps, ps); }
        for (let i = 0; i < 10; i++) { g.fillStyle = '#7a9a3a'; g.fillRect((rng()*s)|0, (rng()*s)|0, 1, 2); }
    });
    PAT.dirt = mk((g, s) => {
        g.fillStyle = '#6e5a3a'; g.fillRect(0, 0, s, s);
        for (let i = 0; i < 70; i++) { g.fillStyle = rng() < 0.5 ? '#5c4a30' : '#7e6a45'; g.fillRect((rng()*s)|0, (rng()*s)|0, 1, 1); }
        for (let i = 0; i < 10; i++) { g.fillStyle = '#3e3120'; g.fillRect((rng()*s)|0, (rng()*s)|0, 2, 1); }
    });
    PAT.stone = mk((g, s) => {
        g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, s, s);
        for (let i = 0; i < 60; i++) { g.fillStyle = rng() < 0.5 ? '#7a7a7a' : '#9a9a9a'; g.fillRect((rng()*s)|0, (rng()*s)|0, 1, 1); }
        for (let i = 0; i < 8; i++)  { g.fillStyle = '#6a6a6a'; g.fillRect((rng()*s)|0, (rng()*s)|0, 2, 1); }
    });
    PAT.water = mk((g, s) => {
        g.fillStyle = '#2d506e'; g.fillRect(0, 0, s, s);
        g.fillStyle = '#3a6688'; for (let y = 0; y < s; y += 4) g.fillRect(0, y, s, 1);
        for (let i = 0; i < 24; i++) { g.fillStyle = '#4a7898'; g.fillRect((rng()*s)|0, (rng()*s)|0, 2, 1); }
    });
    PAT.sand = mk((g, s) => {
        g.fillStyle = '#c2b078'; g.fillRect(0, 0, s, s);
        for (let i = 0; i < 50; i++) { g.fillStyle = rng() < 0.5 ? '#b09c66' : '#d2c288'; g.fillRect((rng()*s)|0, (rng()*s)|0, 1, 1); }
    });
    PAT.wood = mk((g, s) => {
        g.fillStyle = '#5c4033'; g.fillRect(0, 0, s, s);
        for (let x = 0; x < s; x += 4) { g.fillStyle = '#4a3429'; g.fillRect(x, 0, 1, s); g.fillStyle = '#6e4d3a'; g.fillRect(x + 2, 0, 1, s); }
        for (let i = 0; i < 8; i++) { g.fillStyle = '#3b2a1a'; g.fillRect(0, (rng()*s)|0, s, 1); }
    });
    PAT.leaves = mk((g, s) => {
        g.fillStyle = '#3e5a1e'; g.fillRect(0, 0, s, s);
        for (let i = 0; i < 90; i++) { const ps = rng() < 0.3 ? 2 : 1; g.fillStyle = rng() < 0.5 ? '#4a6a28' : '#34481a'; g.fillRect((rng()*s)|0, (rng()*s)|0, ps, ps); }
        for (let i = 0; i < 8; i++)  { g.fillStyle = '#6a8a3a'; g.fillRect((rng()*s)|0, (rng()*s)|0, 1, 1); }
    });
    PAT.metal = mk((g, s) => {
        g.fillStyle = '#6a6a6a'; g.fillRect(0, 0, s, s);
        for (let i = 0; i < 36; i++) { g.fillStyle = rng() < 0.5 ? '#5a5a5a' : '#7a7a7a'; g.fillRect((rng()*s)|0, (rng()*s)|0, 1, 1); }
        for (let i = 0; i < 7; i++)  { g.fillStyle = '#8a5a2a'; g.fillRect((rng()*s)|0, (rng()*s)|0, 1, 2); }
    });
    PAT.ruin = mk((g, s) => {
        g.fillStyle = '#7a7268'; g.fillRect(0, 0, s, s);
        g.fillStyle = '#5a5248';
        for (let y = 0; y < s; y += 8) g.fillRect(0, y, s, 1);
        for (let y = 0; y < s; y += 8) { const off = ((y / 8) | 0) % 2 ? 4 : 0; for (let x = off; x < s; x += 8) g.fillRect(x, y, 1, 8); }
        for (let i = 0; i < 24; i++) { g.fillStyle = rng() < 0.5 ? '#6a6258' : '#8a8278'; g.fillRect((rng()*s)|0, (rng()*s)|0, 1, 1); }
    });
}
buildPatterns();

// ---------------------------------------------------------------------------
//  Game state
// ---------------------------------------------------------------------------
const game = {
    mapW: 22, mapH: 22, map: [], obstacles: [], entities: [], grassTufts: [], flowers: [], lights: [],
    player: { tx: 11, ty: 11, x: 11.5, z: 11.5, y: 0, jumpY: 0, path: [], state: 'idle', angle: 0, targetAngle: 0 },
    frameCount: 0, destinationMarker: null, pendingInteraction: null, hoverTile: null,
    inventory: { Wood: 2, Stone: 2, Metal: 0, Fiber: 1, Axe: 0, Pickaxe: 0, Campfire: 0, Torch: 0 },
    feedbackTexts: [], state: 'menu',
    recipes: [
        { name: 'Stone Axe',     cost: { Wood: 3, Stone: 2 },          result: 'Axe' },
        { name: 'Stone Pickaxe', cost: { Wood: 2, Stone: 3 },          result: 'Pickaxe' },
        { name: 'Torch',         cost: { Wood: 1, Fiber: 1 },          result: 'Torch' },
        { name: 'Campfire',      cost: { Wood: 5, Stone: 3 },          result: 'Campfire' }
    ],
    timeOfDay: 0.32, ambientLight: 1.0,
    joy: { active: false, x: 0, y: 0, dx: 0, dy: 0 },
    hotbar: ['Hands', 'Axe', 'Pickaxe', 'Torch', 'Campfire'],
    selectedSlot: 0,
    dialogue: null
};

function getHeight(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= game.mapW || ty >= game.mapH) return 0;
    let tt = game.map[ty * game.mapW + tx];
    if (tt === 2) return -0.3;
    let h = Math.sin(tx * 0.4) + Math.cos(ty * 0.4);
    return Math.round(h) * 0.25;
}

// --- Handcrafted map zones ---
for (let y = 0; y < game.mapH; y++) {
    for (let x = 0; x < game.mapW; x++) {
        if (x >= 15 && x <= 18 && y >= 15 && y <= 18) {
            game.map.push(2); // Lake
        } else if (x >= 4 && x <= 7 && y >= 4 && y <= 7) {
            game.map.push(1); // Dirt patch (old road)
        } else {
            game.map.push(0); // Grass
            if (Math.random() < 0.22) game.grassTufts.push({ x: x + 0.2 + Math.random()*0.6, z: y + 0.2 + Math.random()*0.6 });
            if (Math.random() < 0.05) game.flowers.push({ x: x + 0.3 + Math.random()*0.4, z: y + 0.3 + Math.random()*0.4, c: Math.random() < 0.5 ? '#e6c84a' : '#d96a8a' });
        }
    }
}

// --- Handcrafted entities ---
game.entities.push({ type: 'spirit', tx: 13, ty: 11, swayPhase: 0, talked: false });
game.obstacles.push("13,11");

for (let i = 0; i < 15; i++) {
    let tx = Math.floor(Math.random() * 8) + 1;
    let ty = Math.floor(Math.random() * 8) + 1;
    if (game.map[ty*game.mapW+tx] === 0 && !game.obstacles.includes(`${tx},${ty}`)) {
        game.entities.push({ type: 'tree', tx, ty, swayPhase: Math.random() * 6 });
        game.obstacles.push(`${tx},${ty}`);
    }
}
const ruinTypes = ['ruin_wall', 'ruin_wall', 'metal', 'bush'];
for (let i = 0; i < 12; i++) {
    let tx = Math.floor(Math.random() * 8) + 14;
    let ty = Math.floor(Math.random() * 8) + 1;
    if (game.map[ty*game.mapW+tx] === 0 && !game.obstacles.includes(`${tx},${ty}`)) {
        game.entities.push({ type: ruinTypes[Math.floor(Math.random()*ruinTypes.length)], tx, ty, swayPhase: Math.random() * 6 });
        game.obstacles.push(`${tx},${ty}`);
    }
}
for (let i = 0; i < 6; i++) {
    let tx = Math.floor(Math.random() * 8) + 1;
    let ty = Math.floor(Math.random() * 8) + 14;
    if (game.map[ty*game.mapW+tx] === 0 && !game.obstacles.includes(`${tx},${ty}`)) {
        game.entities.push({ type: 'rock', tx, ty, swayPhase: 0 });
        game.obstacles.push(`${tx},${ty}`);
    }
}

function isWalkable(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= game.mapW || ty >= game.mapH) return false;
    return !game.obstacles.includes(`${tx},${ty}`);
}

// --- A* pathfinding (8-dir) ---
function findPath(start, end) {
    if (!isWalkable(end[0], end[1])) return [];
    let open = [{ tx: start[0], ty: start[1], g: 0, h: 0, f: 0, parent: null }];
    let closed = [];
    const dirs = [[0,-1,1],[0,1,1],[-1,0,1],[1,0,1],[-1,-1,1.4],[1,-1,1.4],[-1,1,1.4],[1,1,1.4]];
    while (open.length > 0) {
        open.sort((a, b) => a.f - b.f);
        let curr = open.shift();
        if (curr.tx === end[0] && curr.ty === end[1]) {
            let path = []; let temp = curr;
            while (temp) { path.push([temp.tx, temp.ty]); temp = temp.parent; }
            return path.reverse();
        }
        closed.push(`${curr.tx},${curr.ty}`);
        for (let d of dirs) {
            let ntx = curr.tx + d[0], nty = curr.ty + d[1];
            if (!isWalkable(ntx, nty) || closed.includes(`${ntx},${nty}`)) continue;
            if (d[0] !== 0 && d[1] !== 0) {
                if (!isWalkable(curr.tx + d[0], curr.ty) || !isWalkable(curr.tx, curr.ty + d[1])) continue;
            }
            let g = curr.g + d[2];
            let h = Math.hypot(ntx - end[0], nty - end[1]);
            let f = g + h;
            let exist = open.find(n => n.tx === ntx && n.ty === nty);
            if (exist && exist.g <= g) continue;
            open.push({ tx: ntx, ty: nty, g, h, f, parent: curr });
        }
    }
    return [];
}

// --- Fixed isometric camera ---
const p = game.player;
const camInit = [p.x - 10, 12, p.z - 10];
let _dx = p.x - camInit[0], _dz = p.z - camInit[2], _dy = 0 - camInit[1];
const GAME_YAW = Math.atan2(_dx, _dz);
const distXZ = Math.hypot(_dx, _dz);
const GAME_PITCH = Math.atan2(_dy, distXZ);
const FOV = 950;
const SIN_YAW = Math.sin(-GAME_YAW), COS_YAW = Math.cos(-GAME_YAW);
const SIN_PITCH = Math.sin(GAME_PITCH), COS_PITCH = Math.cos(GAME_PITCH);
const W_VEC = [Math.sin(GAME_YAW), Math.cos(GAME_YAW)];
const D_VEC = [Math.cos(GAME_YAW), -Math.sin(GAME_YAW)];

function project(x, y, z, cam) {
    x -= cam[0]; y -= cam[1]; z -= cam[2];
    let x2 =  x * COS_YAW + z * SIN_YAW;
    let z2 = -x * SIN_YAW + z * COS_YAW;
    let y3 = y * COS_PITCH - z2 * SIN_PITCH;
    let z3 = y * SIN_PITCH + z2 * COS_PITCH;
    if (z3 <= 0.1) return null;
    return [(x2 / z3) * FOV + GAME_W / 2, (-y3 / z3) * FOV + GAME_H / 2, z3];
}

// --- Lighting ---
function getLightAt(x, y, z) {
    let light = 0;
    let pD = Math.hypot(x - p.x, y - (p.y + 1), z - p.z);
    if (pD < 4) light += (1 - pD / 4) * 0.35;
    for (let l of game.lights) {
        let d = Math.hypot(x - l.x, y - l.y, z - l.z);
        if (d < l.r) light += (1 - d / l.r) * l.intensity;
    }
    return Math.min(0.85, light);
}

// shade() now returns an [r,g,b] array so the renderer can apply distance fog.
function shade(color, factor, x, y, z) {
    let total = factor * game.ambientLight + getLightAt(x, y, z) * factor;
    return [color[0] * total, color[1] * total, color[2] * total];
}

function rotateY(x, y, z, a) { let c = Math.cos(a), s = Math.sin(a); return [x*c+z*s, y, -x*s+z*c]; }
function rotateX(x, y, z, a) { let c = Math.cos(a), s = Math.sin(a); return [x, y*c-z*s, y*s+z*c]; }

// addCube: texTop/texSide name a PAT pattern to overlay on the face.
function addCube(faces, px, py, pz, w, h, d, color, rx=0, ry=0, ox=0, oy=0, oz=0, texTop=null, texSide=null) {
    const v = [[-w/2,-h/2,-d/2],[w/2,-h/2,-d/2],[w/2,-h/2,d/2],[-w/2,-h/2,d/2],[-w/2,h/2,-d/2],[w/2,h/2,-d/2],[w/2,h/2,d/2],[-w/2,h/2,d/2]];
    let rv = v.map(vert => {
        let cx = vert[0]+ox, cy = vert[1]+oy, cz = vert[2]+oz;
        let r = rotateX(cx, cy, cz, rx);
        r = rotateY(r[0], r[1], r[2], ry);
        return [px+r[0], py+r[1], pz+r[2]];
    });
    let cx = px+ox, cy = py+oy, cz = pz+oz;
    faces.push({ verts: [rv[4], rv[5], rv[6], rv[7]], color: shade(color, 1.0,  cx, cy+0.5, cz), tex: texTop });   // top
    faces.push({ verts: [rv[3], rv[2], rv[6], rv[7]], color: shade(color, 0.78, cx, cy, cz+0.5), tex: texSide }); // front
    faces.push({ verts: [rv[1], rv[0], rv[4], rv[5]], color: shade(color, 0.62, cx, cy, cz-0.5), tex: texSide }); // back
    faces.push({ verts: [rv[0], rv[3], rv[7], rv[4]], color: shade(color, 0.52, cx-0.5, cy, cz), tex: texSide }); // left
    faces.push({ verts: [rv[2], rv[1], rv[5], rv[6]], color: shade(color, 0.52, cx+0.5, cy, cz), tex: texSide }); // right
}

function addDiamondGrass(faces, px, pz, sway) {
    let c = [74, 93, 35];
    faces.push({ verts: [[px-0.05, 0, pz], [px+0.05, 0, pz], [px+sway, 0.4, pz], [px+sway-0.1, 0.4, pz]], color: shade(c, 1.0, px, 0.2, pz) });
    faces.push({ verts: [[px-0.05, 0, pz], [px+0.05, 0, pz], [px-0.3+sway, 0.35, pz+0.2], [px-0.4+sway, 0.35, pz+0.2]], color: shade(c, 0.8, px, 0.2, pz) });
}

function addFlower(faces, px, pz, color) {
    faces.push({ verts: [[px-0.04, 0.3, pz], [px+0.04, 0.3, pz], [px+0.04, 0.45, pz], [px-0.04, 0.45, pz]], color: color });
    faces.push({ verts: [[px-0.02, 0, pz], [px+0.02, 0, pz], [px+0.02, 0.32, pz], [px-0.02, 0.32, pz]], color: shade([74,93,35], 0.8, px, 0.15, pz) });
}

function addShadow(faces, px, pz, r, op=80) {
    let nf = game.ambientLight;
    faces.push({ verts: [[px-r, 0.01, pz-r], [px+r, 0.01, pz-r], [px+r, 0.01, pz+r], [px-r, 0.01, pz+r]], color: `rgba(18,24,9,${(op/255)*nf})` });
}

// --- Interaction ---
// FIX: no longer aborts gathering when the "right tool" isn't equipped.
// Bare hands still gather, just slower with less yield. Tools give bonus.
function toolHint(entity) {
    let sel = game.hotbar[game.selectedSlot];
    if ((entity.type === 'rock' || entity.type === 'ruin_wall') && sel !== 'Pickaxe') {
        game.feedbackTexts.push({ text: 'Slow without a Pickaxe', x: GAME_W/2, y: GAME_H*0.40, timer: 1.6 });
    } else if (entity.type === 'tree' && sel !== 'Axe') {
        game.feedbackTexts.push({ text: 'Slow without an Axe', x: GAME_W/2, y: GAME_H*0.40, timer: 1.6 });
    }
}

function handleMoveClick(mx, my) {
    let closestTx = -1, closestTy = -1, minDist = 1000.0;
    let p = game.player, cam = [p.x - 10, 12, p.z - 10];
    for (let ty = 0; ty < game.mapH; ty++) {
        for (let tx = 0; tx < game.mapW; tx++) {
            let proj = project(tx+0.5, 0, ty+0.5, cam);
            if (proj) {
                let dist = Math.hypot(mx - proj[0], my - proj[1]);
                if (dist < minDist) { minDist = dist; closestTx = tx; closestTy = ty; }
            }
        }
    }
    if (closestTx !== -1 && minDist < 110) {
        let sel = game.hotbar[game.selectedSlot];
        if ((sel === 'Torch' || sel === 'Campfire') && game.inventory[sel] > 0) {
            if (isWalkable(closestTx, closestTy) && !(closestTx === p.tx && closestTy === p.ty)) {
                game.inventory[sel]--;
                let h = getHeight(closestTx, closestTy);
                if (sel === 'Torch') {
                    game.entities.push({ type: 'torch', tx: closestTx, ty: closestTy, swayPhase: 0 });
                    game.lights.push({ x: closestTx+0.5, y: h+1.0, z: closestTy+0.5, r: 6,  intensity: 1.0, baseIntensity: 1.0 });
                } else {
                    game.entities.push({ type: 'campfire', tx: closestTx, ty: closestTy, swayPhase: 0 });
                    game.lights.push({ x: closestTx+0.5, y: h+0.8, z: closestTy+0.5, r: 10, intensity: 1.5, baseIntensity: 1.5 });
                }
                game.obstacles.push(`${closestTx},${closestTy}`);
                game.feedbackTexts.push({ text: `Placed ${sel}`, x: GAME_W/2, y: GAME_H*0.40, timer: 1.6 });
            } else if (closestTx === p.tx && closestTy === p.ty) {
                game.feedbackTexts.push({ text: "Can't place here", x: GAME_W/2, y: GAME_H*0.40, timer: 1.6 });
            }
        } else {
            let path = findPath([p.tx, p.ty], [closestTx, closestTy]);
            if (path.length > 0) {
                p.path = path.slice(1);
                game.pendingInteraction = null;
                delete p.gatherTimer; // FIX: cancel any in-progress gather
                game.destinationMarker = { tx: closestTx, ty: closestTy };
            }
        }
    }
}

function handleBreak() {
    let p = game.player;
    let closest = null, minD = 2.5;
    game.entities.forEach(e => {
        if (e.type === 'torch' || e.type === 'campfire' || e.type === 'spirit') return;
        let d = Math.hypot(p.x - (e.tx+0.5), p.z - (e.ty+0.5));
        if (d < minD) { minD = d; closest = e; }
    });
    if (!closest) {
        game.feedbackTexts.push({ text: 'Nothing to gather nearby', x: GAME_W/2, y: GAME_H*0.40, timer: 1.4 });
        return;
    }
    toolHint(closest); // non-blocking hint

    // If already adjacent, gather immediately; otherwise path to an adjacent tile.
    let adjacent = Math.hypot(p.x - (closest.tx+0.5), p.z - (closest.ty+0.5)) < 1.6;
    if (adjacent) {
        p.path = [];
        game.pendingInteraction = closest;
        game.destinationMarker = { tx: closest.tx, ty: closest.ty };
        return;
    }
    let bestAdj = null, minAdjD = 999;
    for (let dx=-1; dx<=1; dx++) {
        for (let dy=-1; dy<=1; dy++) {
            if (dx===0 && dy===0) continue;
            let atx = closest.tx+dx, aty = closest.ty+dy;
            if (isWalkable(atx, aty)) {
                let d = Math.hypot(atx-p.tx, aty-p.ty);
                if (d < minAdjD) { minAdjD = d; bestAdj = [atx, aty]; }
            }
        }
    }
    if (bestAdj) {
        let path = findPath([p.tx, p.ty], bestAdj);
        if (path.length > 0) {
            p.path = path.slice(1);
            game.pendingInteraction = closest;
            game.destinationMarker = { tx: bestAdj[0], ty: bestAdj[1] };
        }
    }
}

// ---------------------------------------------------------------------------
//  HUD layout helpers (shared by input + render so they never disagree)
// ---------------------------------------------------------------------------
function getButtons() {
    let scale = Math.min(GAME_W / 1280, GAME_H / 720);
    scale = Math.max(0.65, Math.min(scale, 1.3));
    let btnBreakSize = 76 * scale;
    let btnSmallSize = 58 * scale;
    let padding = 20 * scale;
    let baseRight = GAME_W - padding - btnBreakSize/2;
    let baseBottom = GAME_H - padding - btnBreakSize/2;
    return {
        break: { x: baseRight, y: baseBottom, r: btnBreakSize / 2 },
        jump:  { x: baseRight - (88 * scale),  y: baseBottom - (10 * scale), r: btnSmallSize / 2 },
        craft: { x: baseRight - (8 * scale),   y: baseBottom - (92 * scale), r: btnSmallSize / 2 },
        inv:   { x: baseRight - (82 * scale),  y: baseBottom - (100 * scale), r: btnSmallSize / 2 },
        scale: scale
    };
}

function getHotbarLayout() {
    let s = getButtons().scale;
    let hbSize = Math.floor(56 * s);
    let gap = Math.floor(6 * s);
    let totalW = 5 * hbSize + 4 * gap;
    let hbStartX = (GAME_W / 2) - (totalW / 2);
    let hbY = GAME_H - hbSize - (14 * s);
    return { hbSize, gap, totalW, hbStartX, hbY };
}

function getWindowRect() {
    let winW = Math.min(GAME_W * 0.92, 560);
    let winH = Math.min(GAME_H * 0.82, 460);
    return { x: (GAME_W - winW) / 2, y: (GAME_H - winH) / 2, w: winW, h: winH };
}

function getCloseBtn() {
    let w = getWindowRect();
    let s = Math.min(34, w.w * 0.06);
    return { x: w.x + w.w - s - 6, y: w.y + 6, w: s, h: s };
}

function getCraftRows() {
    let w = getWindowRect();
    let pad = w.w * 0.06;
    let listX = w.x + pad;
    let listW = w.w - pad * 2;
    let rowH = Math.min(58, w.h * 0.12);
    let gap = rowH * 0.22;
    let startY = w.y + w.h * 0.22;
    return game.recipes.map((rec, i) => {
        let sy = startY + i * (rowH + gap);
        let canCraft = Object.keys(rec.cost).every(r => (game.inventory[r] || 0) >= rec.cost[r]);
        return { recipe: rec, x: listX, y: sy, w: listW, h: rowH, canCraft };
    });
}

function getInvSlots() {
    let w = getWindowRect();
    let items = Object.keys(game.inventory);
    let cols = 4;
    let pad = w.w * 0.06;
    let gridW = w.w - pad * 2;
    let boxW = gridW / cols;
    let startX = w.x + pad;
    let startY = w.y + w.h * 0.22;
    return items.map((name, i) => {
        let col = i % cols, row = Math.floor(i / cols);
        return { name, x: startX + col * boxW, y: startY + row * boxW, w: boxW, h: boxW };
    });
}

function inRect(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

// ---------------------------------------------------------------------------
//  Input
// ---------------------------------------------------------------------------
canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    let x = e.clientX, y = e.clientY;
    if (game.state === 'menu') { game.state = 'playing'; return; }
    if (game.state === 'dialogue') { game.state = 'playing'; return; }

    // --- Windows: stay open until explicitly closed ---
    if (game.state === 'crafting' || game.state === 'inventory') {
        let w = getWindowRect();
        if (inRect(x, y, getCloseBtn())) { game.state = 'playing'; return; }
        if (game.state === 'crafting') {
            for (let row of getCraftRows()) {
                if (inRect(x, y, row)) {
                    let rec = row.recipe;
                    let canCraft = Object.keys(rec.cost).every(r => (game.inventory[r] || 0) >= rec.cost[r]);
                    if (canCraft) {
                        Object.keys(rec.cost).forEach(r => game.inventory[r] -= rec.cost[r]);
                        game.inventory[rec.result]++;
                        game.feedbackTexts.push({ text: `Crafted ${rec.name}`, x: GAME_W/2, y: GAME_H*0.40, timer: 1.6 });
                    } else {
                        let need = Object.keys(rec.cost).filter(r => (game.inventory[r]||0) < rec.cost[r]).map(r => `${r} ${game.inventory[r]||0}/${rec.cost[r]}`).join('  ');
                        game.feedbackTexts.push({ text: `Need: ${need}`, x: GAME_W/2, y: GAME_H*0.40, timer: 1.8 });
                    }
                    return; // STAY OPEN — do not close the menu
                }
            }
        }
        // Tap inside window (but not on a row) does nothing; tap outside closes.
        if (!inRect(x, y, w)) game.state = 'playing';
        return;
    }

    // --- Hotbar selection ---
    let hb = getHotbarLayout();
    if (y > hb.hbY && y < hb.hbY + hb.hbSize) {
        for (let i = 0; i < 5; i++) {
            let hx = hb.hbStartX + i * (hb.hbSize + hb.gap);
            if (x > hx && x < hx + hb.hbSize) { game.selectedSlot = i; return; }
        }
    }

    // --- Action buttons (bottom-right cluster) ---
    let btns = getButtons();
    if (x > GAME_W - 260 * btns.scale) {
        if (Math.hypot(x - btns.break.x, y - btns.break.y) < btns.break.r) { handleBreak(); return; }
        if (Math.hypot(x - btns.jump.x,  y - btns.jump.y)  < btns.jump.r)  { if (game.player.jumpY === 0) game.player.jumpY = 0.6; return; }
        if (Math.hypot(x - btns.craft.x, y - btns.craft.y) < btns.craft.r) { game.state = 'crafting'; return; }
        if (Math.hypot(x - btns.inv.x,   y - btns.inv.y)   < btns.inv.r)   { game.state = 'inventory'; return; }
    }

    let sel = game.hotbar[game.selectedSlot];
    let isPlacing = (sel === 'Torch' || sel === 'Campfire') && game.inventory[sel] > 0;

    if (!isPlacing && x < GAME_W / 2) {
        game.joy.active = true; game.joy.x = x; game.joy.y = y; game.joy.dx = 0; game.joy.dy = 0;
    } else {
        handleMoveClick(x, y);
    }
});

canvas.addEventListener('pointermove', e => {
    e.preventDefault();
    if (game.joy.active) {
        let dx = e.clientX - game.joy.x;
        let dy = e.clientY - game.joy.y;
        let dist = Math.hypot(dx, dy);
        let maxDist = 48 * getButtons().scale;
        if (dist > maxDist) { dx = (dx / dist) * maxDist; dy = (dy / dist) * maxDist; }
        game.joy.dx = dx; game.joy.dy = dy;
    }
});

canvas.addEventListener('pointerup', e => {
    e.preventDefault();
    game.joy.active = false; game.joy.dx = 0; game.joy.dy = 0;
});

window.addEventListener('keydown', e => {
    let k = e.key.toLowerCase();
    if (k === 'c') { if (game.state === 'playing') game.state = 'crafting'; else if (game.state === 'crafting') game.state = 'playing'; }
    else if (k === 'e') { if (game.state === 'playing') game.state = 'inventory'; else if (game.state === 'inventory') game.state = 'playing'; }
    else if (k === 'escape') { if (game.state !== 'menu') game.state = 'playing'; }
    else if (k === ' ') { if (game.state === 'playing' && game.player.jumpY === 0) game.player.jumpY = 0.6; }
    else if (['1','2','3','4','5'].includes(k)) game.selectedSlot = parseInt(k) - 1;
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ---------------------------------------------------------------------------
//  Update
// ---------------------------------------------------------------------------
let lastTime = performance.now();
function update(dt) {
    game.frameCount++;
    if (game.state !== 'playing') return;

    game.timeOfDay = (game.timeOfDay + dt * 0.008) % 1.0;
    let lv = Math.sin(game.timeOfDay * Math.PI * 2 - Math.PI / 2);
    game.ambientLight = 0.25 + (lv + 1) / 2 * 0.75; // night floor 0.25 so torches matter

    let p = game.player;
    if (p.jumpY > 0) { p.jumpY -= dt * 1.5; if (p.jumpY < 0) p.jumpY = 0; }

    let ad = p.targetAngle - p.angle;
    while (ad > Math.PI) ad -= 2 * Math.PI;
    while (ad < -Math.PI) ad += 2 * Math.PI;
    p.angle += ad * Math.min(1.0, dt * 10.0);

    // Spirit encounter
    let spirit = game.entities.find(e => e.type === 'spirit');
    if (spirit && !spirit.talked) {
        let distToSpirit = Math.hypot(p.x - (spirit.tx+0.5), p.z - (spirit.ty+0.5));
        if (distToSpirit < 2.5) {
            game.state = 'dialogue';
            game.dialogue = { speaker: "Spirit of Nature", text: "Welcome, Wanderer. The Earth has healed, but remnants of the past remain. Gather Wood and Fiber, then craft tools. Seek the Ruins to the East for Stone and Metal." };
            spirit.talked = true;
        }
    }

    let isMovingJoy = game.joy.active && (Math.abs(game.joy.dx) > 4 || Math.abs(game.joy.dy) > 4);
    if (isMovingJoy) {
        // FIX: moving manually cancels any pending auto-gather + stale timer
        p.path = []; game.pendingInteraction = null; game.destinationMarker = null; delete p.gatherTimer;
        let joyScale = 48 * getButtons().scale;
        let inputX = game.joy.dx / joyScale;
        let inputY = -game.joy.dy / joyScale;
        let moveX = inputX * D_VEC[0] + inputY * W_VEC[0];
        let moveZ = inputX * D_VEC[1] + inputY * W_VEC[1];
        let mag = Math.hypot(moveX, moveZ);
        if (mag > 0) {
            moveX /= mag; moveZ /= mag;
            let speed = 4.8 * dt;
            let nx = p.x + moveX * speed, nz = p.z + moveZ * speed;
            let targetTx = Math.floor(nx), targetTy = Math.floor(nz);
            let currentH = getHeight(p.tx, p.ty);
            let targetH = getHeight(targetTx, targetTy);
            if (Math.abs(targetH - currentH) < 0.35 || p.jumpY > 0) {
                if (isWalkable(targetTx, Math.floor(p.z))) p.x = nx;
                if (isWalkable(Math.floor(p.x), targetTy)) p.z = nz;
            }
            p.tx = Math.floor(p.x); p.ty = Math.floor(p.z);
            p.targetAngle = Math.atan2(moveX, moveZ);
            p.state = 'walk';
        } else p.state = 'idle';
    } else if (p.path.length > 0) {
        p.state = 'walk';
        let target = p.path[0];
        let tx = target[0] + 0.5, tz = target[1] + 0.5;
        let ddx = tx - p.x, ddz = tz - p.z, dist = Math.hypot(ddx, ddz);
        if (dist > 0.01) p.targetAngle = Math.atan2(ddx, ddz);
        let speed = 4.8 * dt;
        if (dist <= speed) {
            p.x = tx; p.z = tz; p.tx = target[0]; p.ty = target[1]; p.path.shift();
            if (p.path.length === 0 && !game.pendingInteraction) { p.state = 'idle'; game.destinationMarker = null; }
        } else { p.x += (ddx/dist)*speed; p.z += (ddz/dist)*speed; }
    } else if (game.pendingInteraction) {
        let e = game.pendingInteraction;
        if (Math.hypot(p.x - (e.tx+0.5), p.z - (e.ty+0.5)) < 1.5) {
            p.state = 'gather';
            let ddx = (e.tx+0.5) - p.x, ddz = (e.ty+0.5) - p.z;
            p.targetAngle = Math.atan2(ddx, ddz);

            let sel = game.hotbar[game.selectedSlot];
            let hasTool = (sel !== 'Hands') && (game.inventory[sel] || 0) > 0;
            let gatherTime = 1.2;   // bare-hand baseline
            let yieldAmount = 1;

            if (e.type === 'tree' && sel === 'Axe' && hasTool)        { gatherTime = 0.5; yieldAmount = 2; }
            if (e.type === 'rock' && sel === 'Pickaxe' && hasTool)    { gatherTime = 0.5; yieldAmount = 2; }
            if (e.type === 'ruin_wall' && sel === 'Pickaxe' && hasTool){ gatherTime = 0.5; yieldAmount = 2; }
            if (e.type === 'metal' && sel === 'Pickaxe' && hasTool)   { gatherTime = 0.6; yieldAmount = 2; }

            if (!p.gatherTimer || p.gatherTarget !== e) {
                p.gatherTimer = gatherTime; p.gatherTarget = e; // FIX: reset when target changes
            }
            p.gatherTimer -= dt;
            if (p.gatherTimer <= 0) {
                let label = '';
                if      (e.type === 'tree')      { game.inventory.Wood  += yieldAmount; label = `+${yieldAmount} Wood`; }
                else if (e.type === 'rock')      { game.inventory.Stone += yieldAmount; label = `+${yieldAmount} Stone`; }
                else if (e.type === 'metal')     { game.inventory.Metal += yieldAmount; label = `+${yieldAmount} Metal`; }
                else if (e.type === 'bush')      { game.inventory.Fiber += yieldAmount; label = `+${yieldAmount} Fiber`; }
                else if (e.type === 'ruin_wall') { game.inventory.Stone += yieldAmount; label = `+${yieldAmount} Stone`; }
                game.feedbackTexts.push({ text: label, x: GAME_W/2, y: GAME_H*0.40, timer: 1.6 });
                game.entities.splice(game.entities.indexOf(e), 1);
                game.obstacles.splice(game.obstacles.indexOf(`${e.tx},${e.ty}`), 1);
                game.pendingInteraction = null; p.state = 'idle'; game.destinationMarker = null;
                delete p.gatherTimer; delete p.gatherTarget;
            }
        } else { p.state = 'idle'; }
    } else p.state = 'idle';

    let terrainY = getHeight(p.tx, p.ty);
    let targetY = terrainY + p.jumpY;
    p.y += (targetY - p.y) * Math.min(1, dt * 15);

    // FIX: flicker around stored baseIntensity (was overwriting 1.5 campfires down to ~1.0)
    game.lights.forEach(l => { l.intensity = (l.baseIntensity || 1) + Math.sin(game.frameCount * 0.4 + l.x) * 0.08; });
    game.feedbackTexts.forEach(ft => { ft.y -= 22 * dt; ft.timer -= dt; });
    game.feedbackTexts = game.feedbackTexts.filter(ft => ft.timer > 0);
}

// ---------------------------------------------------------------------------
//  Sky + stars
// ---------------------------------------------------------------------------
const STARS = [];
for (let i = 0; i < 60; i++) STARS.push([Math.random(), Math.random()]);

function lerp3(a, b, f) { return [a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f]; }
function skyColors(t) {
    const keys = [
        { t: 0.00, top: [10,14,26],  hor: [26,32,48] },     // night
        { t: 0.22, top: [40,40,70],  hor: [205,115,60] },   // dawn
        { t: 0.30, top: [70,110,160],hor: [230,170,120] },  // early day
        { t: 0.50, top: [80,140,200],hor: [170,200,225] },  // noon
        { t: 0.70, top: [70,110,160],hor: [230,150,110] },  // late day
        { t: 0.78, top: [40,40,70],  hor: [200,80,55] },    // dusk
        { t: 1.00, top: [10,14,26],  hor: [26,32,48] }      // night
    ];
    for (let i = 0; i < keys.length - 1; i++) {
        if (t >= keys[i].t && t <= keys[i+1].t) {
            let f = (t - keys[i].t) / (keys[i+1].t - keys[i].t);
            return { top: lerp3(keys[i].top, keys[i+1].top, f), hor: lerp3(keys[i].hor, keys[i+1].hor, f) };
        }
    }
    return { top: keys[0].top, hor: keys[0].hor };
}

let _fogColor = [26,32,48];
function drawSky() {
    const sky = skyColors(game.timeOfDay);
    _fogColor = sky.hor;
    let g = ctx.createLinearGradient(0, 0, 0, GAME_H);
    g.addColorStop(0, `rgb(${sky.top[0]|0},${sky.top[1]|0},${sky.top[2]|0})`);
    g.addColorStop(1, `rgb(${sky.hor[0]|0},${sky.hor[1]|0},${sky.hor[2]|0})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, GAME_W, GAME_H);

    const t = game.timeOfDay;
    const horizonY = GAME_H * 0.55;
    if (t > 0.20 && t < 0.80) {
        let p2 = (t - 0.20) / 0.60;
        let sx = GAME_W * (0.12 + p2 * 0.76);
        let sy = horizonY - Math.sin(p2 * Math.PI) * (GAME_H * 0.42);
        ctx.fillStyle = 'rgba(255,225,140,0.22)'; ctx.beginPath(); ctx.arc(sx, sy, 42, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#ffe9a0'; ctx.beginPath(); ctx.arc(sx, sy, 22, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.arc(sx, sy, 13, 0, Math.PI*2); ctx.fill();
    } else {
        let mt = t >= 0.80 ? t - 0.80 : t + 0.20;
        let p2 = mt / 0.40;
        let sx = GAME_W * (0.12 + p2 * 0.76);
        let sy = horizonY - Math.sin(p2 * Math.PI) * (GAME_H * 0.42);
        // stars
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        for (const s of STARS) ctx.fillRect(s[0] * GAME_W, s[1] * GAME_H * 0.5, 1, 1);
        ctx.fillStyle = 'rgba(220,230,245,0.18)'; ctx.beginPath(); ctx.arc(sx, sy, 34, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#e6ecf5'; ctx.beginPath(); ctx.arc(sx, sy, 17, 0, Math.PI*2); ctx.fill();
    }
}

// ---------------------------------------------------------------------------
//  Procedural HUD primitives (warm wood/stone palette — no flat green panels)
// ---------------------------------------------------------------------------
const COL = {
    panelBorder: '#1c140a',
    panelFill:   '#3b2a1a',
    panelBevel:  '#5c4033',
    panelShadow: '#241a10',
    slotFill:    '#2a2018',
    slotBevel:   '#4a3a2a',
    stoneFill:   '#5a5650',
    stoneBevel:  '#7a7268',
    accent:      '#d9b44a', // warm gold for selectors/labels
    good:        '#8fb84a',
    bad:         '#c45a3a',
    text:        '#f0e6d2',
    textDim:     '#a89878'
};

function drawPanel(x, y, w, h, fill=COL.panelFill, bevel=COL.panelBevel) {
    ctx.fillStyle = COL.panelBorder; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = fill; ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
    ctx.fillStyle = bevel; ctx.fillRect(x + 3, y + 3, w - 6, 2); ctx.fillRect(x + 3, y + 3, 2, h - 6);
    ctx.fillStyle = COL.panelShadow; ctx.fillRect(x + 3, y + h - 5, w - 6, 2); ctx.fillRect(x + w - 5, y + 3, 2, h - 6);
}

function drawSlot(cx, cy, size, selected=false) {
    let x = cx - size/2, y = cy - size/2;
    ctx.fillStyle = COL.panelBorder; ctx.fillRect(x, y, size, size);
    ctx.fillStyle = COL.slotFill; ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
    ctx.fillStyle = COL.slotBevel; ctx.fillRect(x + 2, y + 2, size - 4, 1); ctx.fillRect(x + 2, y + 2, 1, size - 4);
    ctx.fillStyle = COL.panelShadow; ctx.fillRect(x + 2, y + size - 3, size - 4, 1); ctx.fillRect(x + size - 3, y + 2, 1, size - 4);
    if (selected) {
        ctx.strokeStyle = COL.accent; ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
    }
}

function drawCircleButton(cx, cy, r, icon) {
    // wood disc with stone inner
    ctx.fillStyle = COL.panelBorder; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = COL.panelFill; ctx.beginPath(); ctx.arc(cx, cy, r - 2, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = COL.panelBevel; ctx.beginPath(); ctx.arc(cx, cy, r - 2, Math.PI, Math.PI*2); ctx.fill();
    ctx.fillStyle = COL.panelShadow; ctx.beginPath(); ctx.arc(cx, cy, r - 2, 0, Math.PI); ctx.fill();
    ctx.fillStyle = COL.slotFill; ctx.beginPath(); ctx.arc(cx, cy, r - 6, 0, Math.PI*2); ctx.fill();
    if (icon) icon(cx, cy, r);
}

function drawJoystick(jx, jy, alpha) {
    let s = getButtons().scale;
    ctx.globalAlpha = alpha;
    let baseR = 52 * s;
    ctx.fillStyle = COL.panelBorder; ctx.beginPath(); ctx.arc(jx, jy, baseR, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = COL.panelFill; ctx.beginPath(); ctx.arc(jx, jy, baseR - 2, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = COL.slotBevel; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(jx, jy, baseR * 0.55, 0, Math.PI*2); ctx.stroke();
    if (game.joy.active) {
        let kr = 24 * s;
        let kx = jx + game.joy.dx, ky = jy + game.joy.dy;
        ctx.fillStyle = COL.panelBorder; ctx.beginPath(); ctx.arc(kx, ky, kr, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = COL.stoneBevel; ctx.beginPath(); ctx.arc(kx, ky, kr - 2, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = COL.stoneFill; ctx.beginPath(); ctx.arc(kx, ky, kr - 5, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
}

// Tiny pixel icons drawn inside the round action buttons
const BTN_ICONS = {
    break: (cx, cy, r) => { // pickaxe
        ctx.fillStyle = '#6e4d3a'; ctx.fillRect(cx - 2, cy - r*0.45, 4, r*0.7);
        ctx.fillStyle = '#9a9a9a'; ctx.fillRect(cx - r*0.45, cy - r*0.45, r*0.9, 5);
    },
    jump: (cx, cy, r) => { // up chevron
        ctx.fillStyle = COL.accent;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r*0.4); ctx.lineTo(cx + r*0.4, cy + r*0.15); ctx.lineTo(cx + r*0.18, cy + r*0.15);
        ctx.lineTo(cx, cy - r*0.12); ctx.lineTo(cx - r*0.18, cy + r*0.15); ctx.lineTo(cx - r*0.4, cy + r*0.15);
        ctx.closePath(); ctx.fill();
    },
    craft: (cx, cy, r) => { // 2x2 grid
        let u = r * 0.22, g = r * 0.10;
        ctx.fillStyle = COL.accent;
        ctx.fillRect(cx - u - g/2, cy - u - g/2, u, u);
        ctx.fillRect(cx + g/2,     cy - u - g/2, u, u);
        ctx.fillRect(cx - u - g/2, cy + g/2,     u, u);
        ctx.fillRect(cx + g/2,     cy + g/2,     u, u);
    },
    inv: (cx, cy, r) => { // chest
        let w = r * 0.6, h = r * 0.5;
        ctx.fillStyle = COL.accent;
        ctx.fillRect(cx - w/2, cy - h/2, w, h*0.4);
        ctx.fillStyle = '#b88a2a';
        ctx.fillRect(cx - w/2, cy - h/2 + h*0.4, w, h*0.6);
        ctx.fillStyle = '#3b2a1a'; ctx.fillRect(cx - 2, cy - h/2, 4, h*0.4);
    }
};

// ---------------------------------------------------------------------------
//  Render
// ---------------------------------------------------------------------------
const FOG_NEAR = 12, FOG_RANGE = 12;

function render() {
    let btns = getButtons();

    if (game.state === 'menu') {
        drawSky();
        renderMenu();
        return;
    }

    drawSky();

    let p = game.player;
    let cam = [p.x - 10, 12, p.z - 10];
    let faces = [];

    // --- Terrain ---
    for (let ty = 0; ty < game.mapH; ty++) {
        for (let tx = 0; tx < game.mapW; tx++) {
            let tt = game.map[ty*game.mapW+tx];
            let topColor, topTex, sideColor;
            if      (tt === 0) { topColor = [74, 93, 35];  topTex = 'grass'; sideColor = [110, 90, 50]; } // grass top, dirt sides
            else if (tt === 1) { topColor = [110, 90, 50]; topTex = 'dirt';  sideColor = [110, 90, 50]; }
            else               { topColor = [45, 80, 110]; topTex = 'water'; sideColor = [194, 176, 120]; } // water top, sand banks

            let h = getHeight(tx, ty);
            faces.push({ verts: [[tx, h, ty], [tx+1, h, ty], [tx+1, h, ty+1], [tx, h, ty+1]], color: shade(topColor, 1.0, tx+0.5, h, ty+0.5), tex: topTex });

            let hL = getHeight(tx-1, ty);
            if (h < hL) faces.push({ verts: [[tx, h, ty], [tx, hL, ty], [tx, hL, ty+1], [tx, h, ty+1]], color: shade(sideColor, 0.6, tx, (h+hL)/2, ty+0.5) });
            let hR = getHeight(tx+1, ty);
            if (h < hR) faces.push({ verts: [[tx+1, h, ty], [tx+1, hR, ty], [tx+1, hR, ty+1], [tx+1, h, ty+1]], color: shade(sideColor, 0.6, tx+1, (h+hR)/2, ty+0.5) });
            let hF = getHeight(tx, ty-1);
            if (h < hF) faces.push({ verts: [[tx, h, ty], [tx+1, h, ty], [tx+1, hF, ty], [tx, hF, ty]], color: shade(sideColor, 0.5, tx+0.5, (h+hF)/2, ty) });
            let hB = getHeight(tx, ty+1);
            if (h < hB) faces.push({ verts: [[tx, h, ty+1], [tx+1, h, ty+1], [tx+1, hB, ty+1], [tx, hB, ty+1]], color: shade(sideColor, 0.5, tx+0.5, (h+hB)/2, ty+1) });
        }
    }

    // --- Grass tufts & flowers ---
    game.grassTufts.forEach(t => { let s = Math.sin(game.frameCount * 0.04 + t.x) * 0.08; addDiamondGrass(faces, t.x, t.z, s); });
    game.flowers.forEach(f => { addFlower(faces, f.x, f.z, f.c); });

    // --- Destination marker ---
    if (game.destinationMarker) {
        let tx = game.destinationMarker.tx, ty = game.destinationMarker.ty;
        let h = getHeight(tx, ty) + 0.02;
        let pulse = 0.5 + Math.sin(game.frameCount * 0.15) * 0.2;
        faces.push({ verts: [[tx+0.1,h,ty+0.1], [tx+0.9,h,ty+0.1], [tx+0.9,h,ty+0.9], [tx+0.1,h,ty+0.9]], color: `rgba(217,180,74,${pulse})` });
    }

    // --- Entities ---
    game.entities.forEach(e => {
        let h = getHeight(e.tx, e.ty);
        if (e.type === 'tree') addShadow(faces, e.tx+0.5, e.ty+0.5, 0.7);
        else if (['rock','ruin_wall','metal'].includes(e.type)) addShadow(faces, e.tx+0.5, e.ty+0.5, 0.6);
        else if (e.type === 'spirit') addShadow(faces, e.tx+0.5, e.ty+0.5, 0.4);
        else if (e.type !== 'torch' && e.type !== 'campfire') addShadow(faces, e.tx+0.5, e.ty+0.5, 0.4);

        if (e.type === 'tree') {
            let s = Math.sin(game.frameCount * 0.03 + e.swayPhase) * 0.08;
            addCube(faces, e.tx+0.5+s, h+1.5, e.ty+0.5, 1.2, 1.2, 1.2, [58, 85, 30], 0, 0, 0, 0, 0, 'leaves', 'leaves');
            addCube(faces, e.tx+0.5,   h+0.5, e.ty+0.5, 0.3, 1.0, 0.3, [92, 64, 51], 0, 0, 0, 0, 0, 'wood', 'wood');
        }
        else if (e.type === 'rock')      addCube(faces, e.tx+0.5, h+0.3, e.ty+0.5, 0.8, 0.6, 0.8, [128,128,128], 0,0,0,0,0,'stone','stone');
        else if (e.type === 'metal')     addCube(faces, e.tx+0.5, h+0.2, e.ty+0.5, 0.9, 0.4, 0.9, [112,112,112], 0,0,0,0,0,'metal','metal');
        else if (e.type === 'bush')      { let s = Math.sin(game.frameCount*0.04 + e.swayPhase)*0.04; addCube(faces, e.tx+0.5+s, h+0.3, e.ty+0.5, 0.8, 0.6, 0.8, [85,122,43], 0,0,0,0,0,'leaves','leaves'); }
        else if (e.type === 'ruin_wall') addCube(faces, e.tx+0.5, h+0.5, e.ty+0.5, 0.8, 1.0, 0.3, [90,85,80], 0,0,0,0,0,'ruin','ruin');
        else if (e.type === 'torch')     { addCube(faces, e.tx+0.5, h+0.5, e.ty+0.5, 0.1, 1.0, 0.1, [92,64,51], 0,0,0,0,0,'wood','wood'); addCube(faces, e.tx+0.5, h+1.0, e.ty+0.5, 0.25, 0.25, 0.25, [255,200,0]); }
        else if (e.type === 'campfire')  { addCube(faces, e.tx+0.5, h+0.1, e.ty+0.5, 0.7, 0.15, 0.7, [80,80,80], 0,0,0,0,0,'wood','wood'); addCube(faces, e.tx+0.5, h+0.3, e.ty+0.5, 0.4, 0.3, 0.4, [255,140,0]); }
        else if (e.type === 'spirit') {
            let baseY = h;
            addCube(faces, e.tx+0.35, baseY+0.25, e.ty+0.5, 0.2, 0.5, 0.2, [34,43,20]);
            addCube(faces, e.tx+0.65, baseY+0.25, e.ty+0.5, 0.2, 0.5, 0.2, [34,43,20]);
            addCube(faces, e.tx+0.5,  baseY+0.8,  e.ty+0.5, 0.5, 0.6, 0.3, [74,93,35]);
            addCube(faces, e.tx+0.5,  baseY+1.4,  e.ty+0.5, 0.3, 0.3, 0.3, [210,160,110]);
            addCube(faces, e.tx+0.5,  baseY+1.5,  e.ty+0.5, 0.35, 0.1, 0.35, [34,43,20]);
            addCube(faces, e.tx+0.5,  baseY+1.6,  e.ty+0.5, 0.1, 0.1, 0.1, [255,255,255]);
        }
    });

    // --- Player ---
    let playerY = p.y;
    addShadow(faces, p.x, p.z, 0.4, 80 * (1 - Math.min(1, p.jumpY / 0.6)));
    let breathe = 0, ls = 0, asr = 0, asl = 0;
    if (p.state === 'walk')   { ls = Math.sin(game.frameCount * 0.35) * 0.45; asr = -ls; asl = ls; breathe = Math.abs(Math.sin(game.frameCount * 0.35)) * 0.04; }
    else if (p.state === 'gather') { asr = Math.sin(game.frameCount * 0.7) * 1.1; breathe = Math.sin(game.frameCount * 0.4) * 0.04; }
    else { breathe = Math.sin(game.frameCount * 0.05) * 0.04; }

    let hipY = playerY + 0.5, torsoY = playerY + 0.8 + breathe, shoulderY = playerY + 1.1 + breathe, headY = playerY + 1.4 + breathe;
    let ro = rotateY(0.15,0,0,p.angle); addCube(faces, p.x+ro[0], hipY, p.z+ro[2], 0.2, 0.5, 0.2, [60,45,30], -ls, p.angle, 0, -0.25, 0);
    let lo = rotateY(-0.15,0,0,p.angle); addCube(faces, p.x+lo[0], hipY, p.z+lo[2], 0.2, 0.5, 0.2, [60,45,30], ls, p.angle, 0, -0.25, 0);
    addCube(faces, p.x, torsoY, p.z, 0.5, 0.6, 0.3, [74,93,35], 0, p.angle);
    let rao = rotateY(0.35,0,0,p.angle); addCube(faces, p.x+rao[0], shoulderY, p.z+rao[2], 0.2, 0.5, 0.2, [136,110,60], -asr, p.angle, 0, -0.25, 0);
    let lao = rotateY(-0.35,0,0,p.angle); addCube(faces, p.x+lao[0], shoulderY, p.z+lao[2], 0.2, 0.5, 0.2, [136,110,60], -asl, p.angle, 0, -0.25, 0);
    addCube(faces, p.x, headY, p.z, 0.3, 0.3, 0.3, [210,160,110], 0, p.angle);

    // Equipped tool in hand
    let equippedTool = game.hotbar[game.selectedSlot];
    let toolCount = (equippedTool !== 'Hands') ? (game.inventory[equippedTool] || 0) : 1;
    if (toolCount > 0) {
        if (equippedTool === 'Axe') {
            let hx = p.x+rao[0], hy = shoulderY, hz = p.z+rao[2];
            addCube(faces, hx, hy, hz, 0.08, 0.4, 0.08, [100,70,40], -asr, p.angle, 0, -0.2, 0, 'wood', 'wood');
            addCube(faces, hx, hy, hz, 0.25, 0.1, 0.15, [130,130,130], -asr, p.angle, 0.15, 0.1, 0, 'stone', 'stone');
        } else if (equippedTool === 'Pickaxe') {
            let hx = p.x+rao[0], hy = shoulderY, hz = p.z+rao[2];
            addCube(faces, hx, hy, hz, 0.08, 0.4, 0.08, [100,70,40], -asr, p.angle, 0, -0.2, 0, 'wood', 'wood');
            addCube(faces, hx, hy, hz, 0.2, 0.08, 0.1, [130,130,130], -asr, p.angle, 0.15, 0.1, 0, 'stone', 'stone');
            addCube(faces, hx, hy, hz, 0.2, 0.08, 0.1, [130,130,130], -asr, p.angle, -0.15, 0.1, 0, 'stone', 'stone');
        } else if (equippedTool === 'Torch') {
            let hx = p.x+rao[0], hy = shoulderY, hz = p.z+rao[2];
            addCube(faces, hx, hy, hz, 0.08, 0.3, 0.08, [100,70,40], -asr, p.angle, 0, -0.15, 0, 'wood', 'wood');
            addCube(faces, hx, hy, hz, 0.15, 0.15, 0.15, [255,200,0], -asr, p.angle, 0, -0.35, 0);
        }
    }

    // --- Project + sort + fill (painter's algorithm), with fog + textures ---
    let renderables = [];
    for (let f of faces) {
        let pv = []; let valid = true;
        for (let v of f.verts) { let proj = project(v[0], v[1], v[2], cam); if (!proj) { valid = false; break; } pv.push(proj); }
        if (valid) {
            let avgZ = (pv[0][2] + pv[1][2] + pv[2][2] + pv[3][2]) / 4;
            renderables.push({ verts: pv, color: f.color, tex: f.tex, z: avgZ });
        }
    }
    renderables.sort((a, b) => b.z - a.z);

    for (let r of renderables) {
        ctx.beginPath();
        ctx.moveTo(r.verts[0][0], r.verts[0][1]);
        for (let i = 1; i < r.verts.length; i++) ctx.lineTo(r.verts[i][0], r.verts[i][1]);
        ctx.closePath();
        if (typeof r.color === 'string') {
            ctx.fillStyle = r.color; // shadows/markers with explicit alpha
        } else {
            let fog = Math.max(0, Math.min(1, (r.z - FOG_NEAR) / FOG_RANGE));
            let r0 = r.color[0] + (_fogColor[0] - r.color[0]) * fog;
            let g0 = r.color[1] + (_fogColor[1] - r.color[1]) * fog;
            let b0 = r.color[2] + (_fogColor[2] - r.color[2]) * fog;
            ctx.fillStyle = `rgba(${r0|0},${g0|0},${b0|0},1)`;
        }
        ctx.fill();
        // texture overlay — fades with fog and dims at night so textures don't glow
        if (r.tex && PAT[r.tex]) {
            ctx.globalAlpha = 0.4 * game.ambientLight * (1 - Math.max(0, Math.min(1, (r.z - FOG_NEAR) / FOG_RANGE)));
            ctx.fillStyle = PAT[r.tex];
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    // --- HUD ---
    drawTopBar();
    drawFeedback(btns);
    drawHotbar();
    if (game.state === 'playing') {
        let s = btns.scale;
        let jx = game.joy.active ? game.joy.x : 90 * s;
        let jy = game.joy.active ? game.joy.y : GAME_H - (100 * s);
        drawJoystick(jx, jy, game.joy.active ? 0.95 : 0.40);
        drawCircleButton(btns.break.x, btns.break.y, btns.break.r, BTN_ICONS.break);
        drawCircleButton(btns.jump.x,  btns.jump.y,  btns.jump.r,  BTN_ICONS.jump);
        drawCircleButton(btns.craft.x, btns.craft.y, btns.craft.r, BTN_ICONS.craft);
        drawCircleButton(btns.inv.x,   btns.inv.y,   btns.inv.r,   BTN_ICONS.inv);
    }

    if (game.state === 'crafting') renderCrafting();
    if (game.state === 'inventory') renderInventory();
    if (game.state === 'dialogue' && game.dialogue) renderDialogue(btns);
}

function renderMenu() {
    let frameW = Math.min(GAME_W * 0.92, 620);
    let frameH = Math.min(GAME_H * 0.55, 320);
    let frameX = (GAME_W - frameW) / 2;
    let frameY = (GAME_H - frameH) / 2;
    drawPanel(frameX, frameY, frameW, frameH);

    ctx.fillStyle = COL.accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.floor(frameW * 0.075)}px "Courier New", monospace`;
    ctx.fillText('THE LAST WANDERER', GAME_W/2, frameY + frameH * 0.28);

    ctx.fillStyle = COL.textDim;
    ctx.font = `${Math.floor(frameW * 0.025)}px Arial`;
    ctx.fillText('A 3D voxel survival prototype', GAME_W/2, frameY + frameH * 0.42);

    let btnW = frameW * 0.5, btnH = Math.min(54, frameH * 0.18);
    let btnX = (GAME_W - btnW) / 2, btnY = frameY + frameH * 0.58;
    drawPanel(btnX, btnY, btnW, btnH, COL.stoneFill, COL.stoneBevel);
    ctx.fillStyle = COL.text;
    ctx.font = `900 ${Math.floor(btnH * 0.4)}px "Courier New", monospace`;
    ctx.fillText('TAP TO START', GAME_W/2, btnY + btnH * 0.5);

    ctx.fillStyle = COL.textDim;
    ctx.font = `${Math.floor(frameW * 0.022)}px Arial`;
    ctx.fillText('WASD move · Space jump · C craft · E inventory · 1-5 hotbar', GAME_W/2, frameY + frameH * 0.84);
    ctx.textBaseline = 'alphabetic';
}

function drawTopBar() {
    let s = getButtons().scale;
    let pillW = 150 * s, pillH = 30 * s, pad = 12 * s;
    drawPanel(pad, pad, pillW, pillH, COL.stoneFill, COL.stoneBevel);
    let t = game.timeOfDay;
    let label = (t < 0.22 || t > 0.78) ? 'Night' : (t < 0.35) ? 'Dawn' : (t < 0.65) ? 'Day' : 'Dusk';
    // mini sun/moon icon
    let ix = pad + pillH * 0.5, iy = pad + pillH * 0.5;
    let isDay = t > 0.22 && t < 0.78;
    ctx.fillStyle = isDay ? '#ffe9a0' : '#e6ecf5';
    ctx.beginPath(); ctx.arc(ix, iy, pillH * 0.28, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = COL.text;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.floor(pillH * 0.5)}px Arial`;
    ctx.fillText(label, ix + pillH * 0.5, iy);

    // Placing-mode hint
    let sel = game.hotbar[game.selectedSlot];
    if ((sel === 'Torch' || sel === 'Campfire') && (game.inventory[sel] || 0) > 0) {
        let hw = 220 * s, hh = 28 * s;
        drawPanel((GAME_W - hw) / 2, pad, hw, hh, COL.stoneFill, COL.stoneBevel);
        ctx.fillStyle = COL.accent; ctx.textAlign = 'center';
        ctx.font = `bold ${Math.floor(hh * 0.5)}px Arial`;
        ctx.fillText(`Placing ${sel} — tap a tile`, GAME_W / 2, pad + hh * 0.5);
    }
    ctx.textBaseline = 'alphabetic';
}

function drawFeedback(btns) {
    let s = btns.scale;
    game.feedbackTexts.forEach(ft => {
        ctx.globalAlpha = Math.max(0, Math.min(1, ft.timer / 1.6));
        ctx.font = `bold ${Math.floor(15 * s)}px Arial`;
        let tw = ctx.measureText(ft.text).width;
        let bw = tw + 24 * s, bh = 26 * s;
        drawPanel(ft.x - bw/2, ft.y - bh/2, bw, bh, COL.stoneFill, COL.stoneBevel);
        ctx.fillStyle = COL.text;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(ft.text, ft.x, ft.y);
    });
    ctx.globalAlpha = 1.0;
    ctx.textBaseline = 'alphabetic';
}

function drawHotbar() {
    let hb = getHotbarLayout();
    let s = getButtons().scale;
    // dock behind the hotbar
    let dockPad = 8 * s;
    drawPanel(hb.hbStartX - dockPad, hb.hbY - dockPad, hb.totalW + dockPad*2, hb.hbSize + dockPad*2, COL.panelFill, COL.panelBevel);
    for (let i = 0; i < 5; i++) {
        let cx = hb.hbStartX + i * (hb.hbSize + hb.gap) + hb.hbSize / 2;
        let cy = hb.hbY + hb.hbSize / 2;
        drawSlot(cx, cy, hb.hbSize, game.selectedSlot === i);
        let itemName = game.hotbar[i];
        if (itemName !== 'Hands' && (game.inventory[itemName] || 0) > 0) {
            drawUIImage('item_' + itemName.toLowerCase(), cx, cy, hb.hbSize * 0.66);
        }
        let count = game.inventory[itemName];
        if (count !== undefined && count > 0) {
            ctx.fillStyle = COL.accent;
            ctx.font = `bold ${Math.floor(12 * s)}px Arial`;
            ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
            ctx.fillText(count, cx + hb.hbSize/2 - 4, cy + hb.hbSize/2 - 2);
        }
        // slot index label
        ctx.fillStyle = COL.textDim;
        ctx.font = `bold ${Math.floor(9 * s)}px Arial`;
        ctx.textAlign = 'left';
        ctx.fillText(i + 1, cx - hb.hbSize/2 + 3, hb.hbY + 11);
    }
}

function renderCrafting() {
    ctx.fillStyle = 'rgba(10,12,6,0.72)';
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    let w = getWindowRect();
    drawPanel(w.x, w.y, w.w, w.h);

    ctx.fillStyle = COL.accent;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.floor(w.w * 0.045)}px "Courier New", monospace`;
    ctx.fillText('CRAFTING', GAME_W/2, w.y + w.h * 0.10);
    ctx.fillStyle = COL.textDim;
    ctx.font = `${Math.floor(w.w * 0.02)}px Arial`;
    ctx.fillText('Tap a recipe to craft · stays open · press C or ✕ to close', GAME_W/2, w.y + w.h * 0.155);
    drawCloseBtn();

    let rows = getCraftRows();
    rows.forEach(row => {
        let rec = row.recipe;
        // row background: green-tinted if craftable, dim if not
        let fill = row.canCraft ? '#2d3a1e' : '#241a10';
        let bevel = row.canCraft ? '#4a6a28' : '#3a2a1a';
        drawPanel(row.x, row.y, row.w, row.h, fill, bevel);

        // result icon
        drawUIImage('item_' + rec.result.toLowerCase(), row.x + row.h * 0.5, row.y + row.h * 0.5, row.h * 0.78);

        // name + cost
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillStyle = COL.text;
        ctx.font = `900 ${Math.floor(w.w * 0.032)}px "Courier New", monospace`;
        ctx.fillText(rec.name, row.x + row.h * 1.1, row.y + row.h * 0.35);

        let costStr = Object.keys(rec.cost).map(r => {
            let have = game.inventory[r] || 0, need = rec.cost[r];
            return `${r} ${have}/${need}`;
        }).join('   ');
        ctx.fillStyle = row.canCraft ? COL.good : COL.bad;
        ctx.font = `bold ${Math.floor(w.w * 0.024)}px Arial`;
        ctx.fillText(costStr, row.x + row.h * 1.1, row.y + row.h * 0.72);

        // craft button on the right
        let cbW = Math.min(80, row.h * 1.3), cbH = row.h * 0.7;
        let cbX = row.x + row.w - cbW - 6, cbY = row.y + (row.h - cbH)/2;
        drawPanel(cbX, cbY, cbW, cbH, row.canCraft ? '#3a2a1a' : '#1c140a', row.canCraft ? COL.accent : COL.panelShadow);
        ctx.fillStyle = row.canCraft ? COL.accent : COL.textDim;
        ctx.textAlign = 'center';
        ctx.font = `900 ${Math.floor(cbH * 0.4)}px "Courier New", monospace`;
        ctx.fillText(row.canCraft ? 'CRAFT' : 'LOCKED', cbX + cbW/2, cbY + cbH * 0.5);
    });
    ctx.textBaseline = 'alphabetic';
}

function renderInventory() {
    ctx.fillStyle = 'rgba(10,12,6,0.72)';
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    let w = getWindowRect();
    drawPanel(w.x, w.y, w.w, w.h);

    ctx.fillStyle = COL.accent;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.floor(w.w * 0.045)}px "Courier New", monospace`;
    ctx.fillText('INVENTORY', GAME_W/2, w.y + w.h * 0.10);
    ctx.fillStyle = COL.textDim;
    ctx.font = `${Math.floor(w.w * 0.02)}px Arial`;
    ctx.fillText('Materials & tools · press E or ✕ to close', GAME_W/2, w.y + w.h * 0.155);
    drawCloseBtn();

    let slots = getInvSlots();
    let s = getButtons().scale;
    slots.forEach(slot => {
        let cx = slot.x + slot.w / 2, cy = slot.y + slot.w / 2;
        let size = Math.min(slot.w, slot.h) * 0.86;
        drawSlot(cx, cy, size);
        let name = slot.name;
        if ((game.inventory[name] || 0) > 0 || ['Wood','Stone','Metal','Fiber'].includes(name)) {
            drawUIImage('item_' + name.toLowerCase(), cx, cy, size * 0.66);
        }
        let count = game.inventory[name];
        if (count !== undefined && count > 0) {
            ctx.fillStyle = COL.accent;
            ctx.font = `bold ${Math.floor(13 * s)}px Arial`;
            ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
            ctx.fillText(count, cx + size/2 - 4, cy + size/2 - 2);
        }
    });
    ctx.textBaseline = 'alphabetic';
}

function drawCloseBtn() {
    let b = getCloseBtn();
    drawPanel(b.x, b.y, b.w, b.h, COL.bad, '#a04030');
    ctx.strokeStyle = COL.text; ctx.lineWidth = Math.max(2, b.w * 0.12);
    ctx.beginPath();
    ctx.moveTo(b.x + b.w * 0.28, b.y + b.h * 0.28);
    ctx.lineTo(b.x + b.w * 0.72, b.y + b.h * 0.72);
    ctx.moveTo(b.x + b.w * 0.72, b.y + b.h * 0.28);
    ctx.lineTo(b.x + b.w * 0.28, b.y + b.h * 0.72);
    ctx.stroke();
}

function renderDialogue(btns) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    let boxW = Math.min(GAME_W * 0.9, 600);
    let boxH = 150;
    let boxX = (GAME_W - boxW) / 2;
    let boxY = GAME_H - boxH - 50;
    drawPanel(boxX, boxY, boxW, boxH);

    ctx.fillStyle = COL.accent;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = `bold ${Math.floor(18 * btns.scale)}px Arial`;
    ctx.fillText(game.dialogue.speaker + ":", boxX + 24, boxY + 20);

    ctx.fillStyle = COL.text;
    ctx.font = `${Math.floor(15 * btns.scale)}px Arial`;
    let words = game.dialogue.text.split(' ');
    let line = '', y = boxY + 50;
    for (let i = 0; i < words.length; i++) {
        let testLine = line + words[i] + ' ';
        if (ctx.measureText(testLine).width > boxW - 48 && i > 0) {
            ctx.fillText(line, boxX + 24, y);
            line = words[i] + ' ';
            y += 22;
        } else { line = testLine; }
    }
    ctx.fillText(line, boxX + 24, y);

    ctx.textAlign = 'center';
    ctx.fillStyle = COL.textDim;
    ctx.font = `bold ${Math.floor(12 * btns.scale)}px Arial`;
    ctx.fillText("[ Tap to Continue ]", GAME_W/2, boxY + boxH - 22);
    ctx.textBaseline = 'alphabetic';
}

// ---------------------------------------------------------------------------
//  Isometric loading screen (warmed palette)
// ---------------------------------------------------------------------------
const tips = [
    "Tip: Craft a Pickaxe to mine stone faster — but you can mine bare-handed too.",
    "Tip: Place Campfires and Torches to light up the night.",
    "Tip: The Spirit of Nature guides you. Approach her.",
    "Tip: Trees yield more wood with an Axe.",
    "Tip: Explore the ruins to the East for Stone and Metal.",
    "Tip: Press C to craft, E for inventory, 1-5 to switch hotbar."
];
let currentTip = tips[Math.floor(Math.random() * tips.length)];
let particles = [];
for (let i = 0; i < 50; i++) {
    particles.push({ x: Math.random()*GAME_W, y: Math.random()*GAME_H, vy: -0.5 - Math.random(), size: 1 + Math.random()*2, alpha: Math.random()*0.5 });
}

function renderLoadingScreen(frameCount) {
    let sky = skyColors(0.4);
    let g = ctx.createLinearGradient(0, 0, 0, GAME_H);
    g.addColorStop(0, `rgb(${sky.top[0]|0},${sky.top[1]|0},${sky.top[2]|0})`);
    g.addColorStop(1, `rgb(${sky.hor[0]|0},${sky.hor[1]|0},${sky.hor[2]|0})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, GAME_W, GAME_H);

    particles.forEach(p => {
        p.y += p.vy;
        if (p.y < 0) { p.y = GAME_H; p.x = Math.random() * GAME_W; }
        ctx.fillStyle = `rgba(217,180,74,${p.alpha})`;
        ctx.fillRect(p.x, p.y, p.size, p.size);
    });

    let cx = GAME_W / 2, cy = GAME_H / 2 - 40;
    let w = 80, h = 40;
    let activeTile = Math.floor(frameCount / 30) % 4;
    const tiles = [
        { gx: 0, gy: 0, color: '#4a5d23', name: 'Meadow' },
        { gx: 1, gy: 0, color: '#3e5a1e', name: 'Forest' },
        { gx: 1, gy: 1, color: '#7a7268', name: 'Ruins' },
        { gx: 0, gy: 1, color: '#2d506e', name: 'Lake' }
    ];
    tiles.forEach((tile, i) => {
        let isoX = cx + (tile.gx - tile.gy) * (w / 2);
        let isoY = cy + (tile.gx + tile.gy) * (h / 2);
        ctx.beginPath();
        ctx.moveTo(isoX, isoY);
        ctx.lineTo(isoX + w/2, isoY + h/2);
        ctx.lineTo(isoX, isoY + h);
        ctx.lineTo(isoX - w/2, isoY + h/2);
        ctx.closePath();
        ctx.fillStyle = tile.color; ctx.fill();
        if (i === activeTile) {
            ctx.strokeStyle = COL.accent; ctx.lineWidth = 3; ctx.stroke();
            ctx.fillStyle = COL.text;
            ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center';
            ctx.fillText(tile.name, isoX, isoY - 10);
        }
    });

    ctx.fillStyle = COL.text;
    ctx.font = 'bold 24px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('LOADING...', GAME_W / 2, cy + h * 2 + 30);

    ctx.fillStyle = COL.textDim;
    ctx.font = '16px Arial';
    ctx.fillText(currentTip, GAME_W / 2, GAME_H - 50);
}

function loop(now) {
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
}

// --- Init ---
let loadingFrame = 0;
function loadingLoop() {
    loadingFrame++;
    renderLoadingScreen(loadingFrame);
    requestAnimationFrame(loadingLoop);
}
loadingLoop();

loadAssets().then(() => {
    lastTime = performance.now();
    requestAnimationFrame(loop);
});
