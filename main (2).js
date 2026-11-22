// ============================================================================
//  THE LAST WANDERER 3D  —  v3
//  Vanilla JS + Canvas 2D. No external libs.
//
//  v3 changes vs v2:
//   * Endless procedural world (chunked infinite generation, deterministic
//     hash noise + fbm). Biomes: meadow, forest, plains, mountain, sand,
//     water (lakes & rivers). No animals.
//   * Multiple tree (oak/pine/birch), rock (granite/basalt/sandstone) and
//     metal deposit (iron/copper/gold) variants — all yield existing
//     resources so crafting stays balanced.
//   * Removed the screen-space texture overlay that "swam" like stars.
//     Terrain is solid shaded block colors again (blocky voxel look).
//   * Fog now fades toward a dark forest-green (not the bright sky horizon),
//     pushed further out — distant ground darkens instead of turning white.
//   * Green theme restored for the HUD (beveled mossy panels + stone buttons).
//   * Day/night cycle ~3x slower.
//   * Rebuilt Spirit NPC model (proper proportions + hover + warm glow).
//   * Placed torch shrunk to ~1/4 player height.
//   * Menu animations (fade/slide title, pulsing start button, drifting
//     particles) and procedural Web Audio sound (no asset files): UI blip,
//     gather thunk, craft chime, place whoosh, jump, ambient wind + mute.
//   * All v2 bug fixes retained (crafting deadlock, light baseIntensity,
//     stale gather timer, stacked ctx scale on resize, persistent crafting
//     menu with close button).
// ============================================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let GAME_W = 1280, GAME_H = 720;

function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
//  Audio — synthesized via Web Audio API (no files). Lazy-init on first gesture.
// ---------------------------------------------------------------------------
let audioCtx = null, masterGain = null, ambientNode = null;
let audioEnabled = true, ambientStarted = false;
function initAudio() {
    if (audioCtx) return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = audioEnabled ? 0.5 : 0;
        masterGain.connect(audioCtx.destination);
        startAmbient();
    } catch (e) { audioEnabled = false; }
}
function resumeAudio() { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); }
function tone(freq, dur, type='sine', vol=0.3, attack=0.005) {
    if (!audioEnabled || !audioCtx) return;
    resumeAudio();
    let t = audioCtx.currentTime;
    let osc = audioCtx.createOscillator();
    let g = audioCtx.createGain();
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(masterGain);
    osc.start(t); osc.stop(t + dur + 0.05);
}
function noiseBurst(dur, vol=0.2, filterFreq=800, filterType='lowpass') {
    if (!audioEnabled || !audioCtx) return;
    resumeAudio();
    let t = audioCtx.currentTime;
    let bufSize = Math.floor(audioCtx.sampleRate * dur);
    let buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
    let d = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) d[i] = (Math.random()*2-1) * (1 - i/bufSize);
    let src = audioCtx.createBufferSource(); src.buffer = buf;
    let filt = audioCtx.createBiquadFilter(); filt.type = filterType; filt.frequency.value = filterFreq;
    let g = audioCtx.createGain(); g.gain.value = vol;
    src.connect(filt); filt.connect(g); g.connect(masterGain);
    src.start(t); src.stop(t + dur + 0.05);
}
const SFX = {
    click()  { tone(660, 0.07, 'square', 0.16); },
    open()   { tone(520, 0.06, 'sine', 0.14); },
    close()  { tone(360, 0.06, 'sine', 0.12); },
    gather() { tone(150, 0.12, 'square', 0.20); noiseBurst(0.07, 0.10, 500); },
    craft()  { tone(523, 0.10, 'sine', 0.18); setTimeout(() => tone(784, 0.18, 'sine', 0.18), 90); },
    fail()   { tone(180, 0.12, 'sawtooth', 0.12); },
    place()  { noiseBurst(0.18, 0.12, 1200, 'bandpass'); tone(240, 0.14, 'sine', 0.10); },
    jump()   { tone(300, 0.08, 'sine', 0.12); setTimeout(() => tone(520, 0.07, 'sine', 0.10), 55); },
    night()  { tone(110, 1.0, 'sine', 0.06, 0.3); },
    select() { tone(880, 0.04, 'sine', 0.08); }
};
function startAmbient() {
    if (ambientStarted || !audioCtx) return; ambientStarted = true;
    let bufSize = audioCtx.sampleRate * 2;
    let buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
    let d = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) d[i] = Math.random()*2-1;
    let src = audioCtx.createBufferSource(); src.buffer = buf; src.loop = true;
    let filt = audioCtx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 380;
    let g = audioCtx.createGain(); g.gain.value = 0.035;
    let lfo = audioCtx.createOscillator(); lfo.frequency.value = 0.08;
    let lfoGain = audioCtx.createGain(); lfoGain.gain.value = 0.018;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    src.connect(filt); filt.connect(g); g.connect(masterGain);
    src.start(); lfo.start();
    ambientNode = { g, filt };
}
function toggleMute() {
    audioEnabled = !audioEnabled;
    if (masterGain) masterGain.gain.value = audioEnabled ? 0.5 : 0;
}

// ---------------------------------------------------------------------------
//  UI asset preloader — only ITEM icons are used (pixel-art SVGs).
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
//  Endless procedural world — deterministic hash noise + fbm.
//  height/biome/entity are pure functions of (tx,ty); worldMods tracks player
//  changes (harvested = removed, placed torch/campfire).
// ---------------------------------------------------------------------------
// Deterministic 2D hash -> uniform [0,1). Uses Math.imul for proper 32-bit
// integer multiplication (the earlier version overflowed JS's safe-integer
// range and biased values low, which starved mountains/forests of noise).
function hash2(x, y) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967295;
}
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { return t * t * (3 - 2 * t); }
function valueNoise(x, y) {
    let xi = Math.floor(x), yi = Math.floor(y);
    let xf = x - xi, yf = y - yi;
    let v00 = hash2(xi, yi), v10 = hash2(xi+1, yi), v01 = hash2(xi, yi+1), v11 = hash2(xi+1, yi+1);
    let u = smooth(xf), v = smooth(yf);
    return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
}
function fbm(x, y, oct) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += valueNoise(x*freq, y*freq) * amp; norm += amp; amp *= 0.5; freq *= 2; }
    return sum / norm;
}

const WATER_LEVEL = -0.2;
function inSpawnArea(tx, ty) { return Math.abs(tx) <= 5 && Math.abs(ty) <= 5; }

// Height: rolling hills around 0, mountains when base noise is high, and
// lakes/rivers carved by a SEPARATE low-frequency noise so water forms as
// pools/channels instead of being tied only to height lows.
function rawHeight(tx, ty) {
    if (inSpawnArea(tx, ty)) {
        return Math.max(-0.05, Math.sin(tx * 0.45) * 0.12 + Math.cos(ty * 0.45) * 0.12);
    }
    let n = fbm(tx * 0.05, ty * 0.05, 4);
    let mountainMask = Math.max(0, n - 0.5) * 2.4;
    let h = (n - 0.5) * 0.4 + mountainMask * mountainMask * 2.6;
    let lake = fbm(tx * 0.08 + 300, ty * 0.08 + 300, 3);
    if (lake < 0.35) h = Math.min(h, -0.22 - (0.35 - lake) * 1.4); // carve lakes & rivers
    return h;
}
function isWater(tx, ty) { return rawHeight(tx, ty) < WATER_LEVEL; }
function getHeight(tx, ty) {
    let r = rawHeight(tx, ty);
    if (r < WATER_LEVEL) return WATER_LEVEL;
    return Math.round(r * 4) * 0.25;
}
function getBiome(tx, ty) {
    if (inSpawnArea(tx, ty)) return 'meadow';
    let r = rawHeight(tx, ty);
    if (r < WATER_LEVEL) return 'water';
    if (r < WATER_LEVEL + 0.06) return 'sand';       // thin beach band just above water
    if (r > 0.55) return 'mountain';                   // tall rocky peaks
    let b = fbm(tx * 0.08 + 50, ty * 0.08 + 50, 3); // wider domain so forest/plains vary across the world
    if (b > 0.58) return 'forest';
    if (b < 0.42) return 'plains';
    return 'meadow';
}

// Per-frame caches so a tile isn't re-noised for top + 4 side faces.
let _cache = new Map();
function cacheClear() { _cache.clear(); }
function _H(tx, ty) { let k = 'h'+tx+','+ty; let v = _cache.get(k); if (v===undefined) { v = getHeight(tx, ty); _cache.set(k, v); } return v; }
function _B(tx, ty) { let k = 'b'+tx+','+ty; let v = _cache.get(k); if (v===undefined) { v = getBiome(tx, ty); _cache.set(k, v); } return v; }

function getEntityAt(tx, ty) {
    const key = tx + ',' + ty;
    const mod = game.worldMods[key];
    if (mod) return mod.removed ? null : mod;
    if (game.spirit && game.spirit.tx === tx && game.spirit.ty === ty) return game.spirit;
    let biome = _B(tx, ty);
    if (biome === 'water' || biome === 'sand') return null;
    let r  = hash2(tx * 31 + 7, ty * 17 + 11);
    let r2 = hash2(tx * 13 + 5, ty * 29 + 3);
    let sway = hash2(tx + 1, ty + 2) * 6;
    if (biome === 'forest') {
        if (r < 0.22) return { type: 'tree', variant: r2 < 0.5 ? 'oak' : (r2 < 0.8 ? 'pine' : 'birch'), tx, ty, swayPhase: sway };
    }
    if (biome === 'meadow') {
        if (r < 0.05) return { type: 'tree', variant: 'oak', tx, ty, swayPhase: sway };
        if (r < 0.10) return { type: 'bush', tx, ty, swayPhase: sway };
        if (r < 0.16) return { type: 'flower', color: r2 < 0.5 ? '#e6c84a' : '#d96a8a', tx, ty };
    }
    if (biome === 'plains') {
        if (r < 0.03) return { type: 'rock', variant: r2 < 0.6 ? 'granite' : 'basalt', tx, ty };
        if (r < 0.07) return { type: 'bush', tx, ty, swayPhase: sway };
    }
    if (biome === 'mountain') {
        if (r < 0.14) return { type: 'rock', variant: r2 < 0.5 ? 'granite' : (r2 < 0.8 ? 'basalt' : 'sandstone'), tx, ty };
        if (r < 0.18) return { type: 'metal', variant: r2 < 0.5 ? 'iron' : (r2 < 0.85 ? 'copper' : 'gold'), tx, ty };
        if (r < 0.20) return { type: 'ruin_wall', tx, ty };
    }
    return null;
}
function _E(tx, ty) { let k = 'e'+tx+','+ty; let v = _cache.get(k); if (v===undefined) { v = getEntityAt(tx, ty); _cache.set(k, v); } return v; }

function entityBlocks(e) {
    return e && e.type !== 'flower' && e.type !== 'bush' && e.type !== 'spirit';
}
function isWalkable(tx, ty) {
    if (isWater(tx, ty)) return false;
    let e = _E(tx, ty);
    return !entityBlocks(e);
}

// ---------------------------------------------------------------------------
//  Game state
// ---------------------------------------------------------------------------
const game = {
    player: { tx: 0, ty: 0, x: 0.5, z: 0.5, y: 0, jumpY: 0, path: [], state: 'idle', angle: 0, targetAngle: 0 },
    frameCount: 0, menuTime: 0, destinationMarker: null, pendingInteraction: null,
    worldMods: {}, spirit: null,
    inventory: { Wood: 2, Stone: 2, Metal: 0, Fiber: 1, Axe: 0, Pickaxe: 0, Campfire: 0, Torch: 0 },
    feedbackTexts: [], state: 'menu', lastNight: false,
    recipes: [
        { name: 'Stone Axe',     cost: { Wood: 3, Stone: 2 }, result: 'Axe' },
        { name: 'Stone Pickaxe', cost: { Wood: 2, Stone: 3 }, result: 'Pickaxe' },
        { name: 'Torch',         cost: { Wood: 1, Fiber: 1 }, result: 'Torch' },
        { name: 'Campfire',      cost: { Wood: 5, Stone: 3 }, result: 'Campfire' }
    ],
    timeOfDay: 0.33, ambientLight: 1.0,
    joy: { active: false, x: 0, y: 0, dx: 0, dy: 0 },
    hotbar: ['Hands', 'Axe', 'Pickaxe', 'Torch', 'Campfire'],
    selectedSlot: 0,
    dialogue: null,
    lights: []
};

// Spirit of Nature — persistent NPC at a fixed meadow tile near spawn.
game.spirit = { type: 'spirit', tx: 4, ty: 2, swayPhase: 0, talked: false };
(function addSpiritLight() {
    let s = game.spirit, h = getHeight(s.tx, s.ty);
    game.lights.push({ x: s.tx + 0.5, y: h + 1.2, z: s.ty + 0.5, r: 6, intensity: 0.6, baseIntensity: 0.6 });
})();

// --- A* pathfinding (8-dir, bounded for the infinite grid) ---
function findPath(start, end) {
    if (!isWalkable(end[0], end[1])) return [];
    // local walkability cache for this pathfind
    const wcache = new Map();
    const lw = (tx, ty) => {
        const k = tx + ',' + ty;
        let v = wcache.get(k);
        if (v === undefined) {
            if (isWater(tx, ty)) v = false;
            else { let e = getEntityAt(tx, ty); v = !entityBlocks(e); }
            wcache.set(k, v);
        }
        return v;
    };
    let open = [{ tx: start[0], ty: start[1], g: 0, h: 0, f: 0, parent: null }];
    let closed = new Set();
    const dirs = [[0,-1,1],[0,1,1],[-1,0,1],[1,0,1],[-1,-1,1.4],[1,-1,1.4],[-1,1,1.4],[1,1,1.4]];
    let iter = 0;
    const MAX_ITER = 1000;
    while (open.length > 0 && iter < MAX_ITER) {
        iter++;
        open.sort((a, b) => a.f - b.f);
        let curr = open.shift();
        if (curr.tx === end[0] && curr.ty === end[1]) {
            let path = []; let temp = curr;
            while (temp) { path.push([temp.tx, temp.ty]); temp = temp.parent; }
            return path.reverse();
        }
        closed.add(curr.tx + ',' + curr.ty);
        for (let d of dirs) {
            let ntx = curr.tx + d[0], nty = curr.ty + d[1];
            if (closed.has(ntx + ',' + nty)) continue;
            if (!lw(ntx, nty)) continue;
            if (d[0] !== 0 && d[1] !== 0) {
                if (!lw(curr.tx + d[0], curr.ty) || !lw(curr.tx, curr.ty + d[1])) continue; // no corner cutting
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
// shade returns [r,g,b] so the renderer can apply distance fog.
function shade(color, factor, x, y, z) {
    let total = factor * game.ambientLight + getLightAt(x, y, z) * factor;
    return [color[0] * total, color[1] * total, color[2] * total];
}
function rotateY(x, y, z, a) { let c = Math.cos(a), s = Math.sin(a); return [x*c+z*s, y, -x*s+z*c]; }
function rotateX(x, y, z, a) { let c = Math.cos(a), s = Math.sin(a); return [x, y*c-z*s, y*s+z*c]; }

// addCube — solid shaded faces (textures removed in v3 to fix the "swimming").
function addCube(faces, px, py, pz, w, h, d, color, rx=0, ry=0, ox=0, oy=0, oz=0) {
    const v = [[-w/2,-h/2,-d/2],[w/2,-h/2,-d/2],[w/2,-h/2,d/2],[-w/2,-h/2,d/2],[-w/2,h/2,-d/2],[w/2,h/2,-d/2],[w/2,h/2,d/2],[-w/2,h/2,d/2]];
    let rv = v.map(vert => {
        let cx = vert[0]+ox, cy = vert[1]+oy, cz = vert[2]+oz;
        let r = rotateX(cx, cy, cz, rx);
        r = rotateY(r[0], r[1], r[2], ry);
        return [px+r[0], py+r[1], pz+r[2]];
    });
    let cx = px+ox, cy = py+oy, cz = pz+oz;
    faces.push({ verts: [rv[4], rv[5], rv[6], rv[7]], color: shade(color, 1.0,  cx, cy+0.5, cz) });
    faces.push({ verts: [rv[3], rv[2], rv[6], rv[7]], color: shade(color, 0.78, cx, cy, cz+0.5) });
    faces.push({ verts: [rv[1], rv[0], rv[4], rv[5]], color: shade(color, 0.62, cx, cy, cz-0.5) });
    faces.push({ verts: [rv[0], rv[3], rv[7], rv[4]], color: shade(color, 0.52, cx-0.5, cy, cz) });
    faces.push({ verts: [rv[2], rv[1], rv[5], rv[6]], color: shade(color, 0.52, cx+0.5, cy, cz) });
}
function addDiamondGrass(faces, px, pz, sway) {
    let c = [74, 93, 35];
    faces.push({ verts: [[px-0.05, 0, pz], [px+0.05, 0, pz], [px+sway, 0.4, pz], [px+sway-0.1, 0.4, pz]], color: shade(c, 1.0, px, 0.2, pz) });
    faces.push({ verts: [[px-0.05, 0, pz], [px+0.05, 0, pz], [px-0.3+sway, 0.35, pz+0.2], [px-0.4+sway, 0.35, pz+0.2]], color: shade(c, 0.8, px, 0.2, pz) });
}
function addFlower(faces, px, pz, color) {
    faces.push({ verts: [[px-0.05, 0.3, pz], [px+0.05, 0.3, pz], [px+0.05, 0.45, pz], [px-0.05, 0.45, pz]], color: color });
    faces.push({ verts: [[px-0.02, 0, pz], [px+0.02, 0, pz], [px+0.02, 0.32, pz], [px-0.02, 0.32, pz]], color: shade([74,93,35], 0.8, px, 0.15, pz) });
}
function addShadow(faces, px, pz, r, op=80) {
    let nf = game.ambientLight;
    faces.push({ verts: [[px-r, 0.01, pz-r], [px+r, 0.01, pz-r], [px+r, 0.01, pz+r], [px-r, 0.01, pz+r]], color: `rgba(18,24,9,${(op/255)*nf})` });
}

// --- Interaction ---
function toolHint(entity) {
    let sel = game.hotbar[game.selectedSlot];
    if ((entity.type === 'rock' || entity.type === 'ruin_wall' || entity.type === 'metal') && sel !== 'Pickaxe')
        game.feedbackTexts.push({ text: 'Slow without a Pickaxe', x: GAME_W/2, y: GAME_H*0.40, timer: 1.4 });
    else if (entity.type === 'tree' && sel !== 'Axe')
        game.feedbackTexts.push({ text: 'Slow without an Axe', x: GAME_W/2, y: GAME_H*0.40, timer: 1.4 });
}
function gatherNearbyCandidates() {
    let p = game.player, out = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        let tx = p.tx + dx, ty = p.ty + dy;
        let e = _E(tx, ty);
        if (e && ['tree','rock','metal','bush','ruin_wall'].includes(e.type)) {
            let d = Math.hypot(p.x - (tx+0.5), p.z - (ty+0.5));
            if (d < 2.6) out.push({ type: e.type, variant: e.variant, tx, ty, d });
        }
    }
    out.sort((a, b) => a.d - b.d);
    return out;
}
function handleMoveClick(mx, my) {
    let closestTx = -1, closestTy = -1, minDist = 1000.0;
    let p = game.player, cam = [p.x - 10, 12, p.z - 10], pr = 14;
    for (let ty = p.ty - pr; ty <= p.ty + pr; ty++) {
        for (let tx = p.tx - pr; tx <= p.tx + pr; tx++) {
            let proj = project(tx+0.5, _H(tx,ty), ty+0.5, cam);
            if (proj) {
                let dist = Math.hypot(mx - proj[0], my - proj[1]);
                if (dist < minDist) { minDist = dist; closestTx = tx; closestTy = ty; }
            }
        }
    }
    if (closestTx === -1 || minDist > 110) return;
    let sel = game.hotbar[game.selectedSlot];
    if ((sel === 'Torch' || sel === 'Campfire') && game.inventory[sel] > 0) {
        if (isWalkable(closestTx, closestTy) && !(closestTx === p.tx && closestTy === p.ty)) {
            game.inventory[sel]--;
            let h = getHeight(closestTx, closestTy);
            if (sel === 'Torch') {
                game.worldMods[closestTx+','+closestTy] = { type: 'torch', tx: closestTx, ty: closestTy, swayPhase: 0 };
                game.lights.push({ x: closestTx+0.5, y: h+0.35, z: closestTy+0.5, r: 6,  intensity: 1.0, baseIntensity: 1.0 });
            } else {
                game.worldMods[closestTx+','+closestTy] = { type: 'campfire', tx: closestTx, ty: closestTy, swayPhase: 0 };
                game.lights.push({ x: closestTx+0.5, y: h+0.30, z: closestTy+0.5, r: 10, intensity: 1.5, baseIntensity: 1.5 });
            }
            game.feedbackTexts.push({ text: `Placed ${sel}`, x: GAME_W/2, y: GAME_H*0.40, timer: 1.4 });
            SFX.place();
        } else {
            game.feedbackTexts.push({ text: "Can't place here", x: GAME_W/2, y: GAME_H*0.40, timer: 1.4 });
            SFX.fail();
        }
    } else {
        let path = findPath([p.tx, p.ty], [closestTx, closestTy]);
        if (path.length > 0) {
            p.path = path.slice(1);
            game.pendingInteraction = null; delete p.gatherTimer;
            game.destinationMarker = { tx: closestTx, ty: closestTy };
        }
    }
}
function handleBreak() {
    let p = game.player;
    let cands = gatherNearbyCandidates();
    if (!cands.length) {
        game.feedbackTexts.push({ text: 'Nothing to gather nearby', x: GAME_W/2, y: GAME_H*0.40, timer: 1.3 });
        SFX.fail();
        return;
    }
    let target = cands[0];
    toolHint(target);
    if (target.d < 1.6) {
        p.path = []; game.pendingInteraction = target; game.destinationMarker = { tx: target.tx, ty: target.ty };
        return;
    }
    let bestAdj = null, minAdjD = 999;
    for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) {
        if (dx===0 && dy===0) continue;
        let atx = target.tx+dx, aty = target.ty+dy;
        if (isWalkable(atx, aty)) {
            let d = Math.hypot(atx-p.tx, aty-p.ty);
            if (d < minAdjD) { minAdjD = d; bestAdj = [atx, aty]; }
        }
    }
    if (bestAdj) {
        let path = findPath([p.tx, p.ty], bestAdj);
        if (path.length > 0) {
            p.path = path.slice(1);
            game.pendingInteraction = target;
            game.destinationMarker = { tx: bestAdj[0], ty: bestAdj[1] };
        }
    }
}

// ---------------------------------------------------------------------------
//  HUD layout helpers (shared by input + render)
// ---------------------------------------------------------------------------
function getButtons() {
    let scale = Math.min(GAME_W / 1280, GAME_H / 720);
    scale = Math.max(0.65, Math.min(scale, 1.3));
    let btnBreakSize = 76 * scale, btnSmallSize = 58 * scale, padding = 20 * scale;
    let baseRight = GAME_W - padding - btnBreakSize/2;
    let baseBottom = GAME_H - padding - btnBreakSize/2;
    return {
        break: { x: baseRight, y: baseBottom, r: btnBreakSize / 2 },
        jump:  { x: baseRight - (88 * scale),  y: baseBottom - (10 * scale), r: btnSmallSize / 2 },
        craft: { x: baseRight - (8 * scale),   y: baseBottom - (92 * scale), r: btnSmallSize / 2 },
        inv:   { x: baseRight - (82 * scale),  y: baseBottom - (100 * scale), r: btnSmallSize / 2 },
        scale
    };
}
function getMuteBtn() {
    let s = getButtons().scale, sz = 30 * s, pad = 12 * s;
    return { x: GAME_W - sz - pad, y: pad, w: sz, h: sz };
}
function getHotbarLayout() {
    let s = getButtons().scale;
    let hbSize = Math.floor(56 * s), gap = Math.floor(6 * s);
    let totalW = 5 * hbSize + 4 * gap;
    let hbStartX = (GAME_W / 2) - (totalW / 2);
    let hbY = GAME_H - hbSize - (14 * s);
    return { hbSize, gap, totalW, hbStartX, hbY };
}
function getWindowRect() {
    let winW = Math.min(GAME_W * 0.92, 560), winH = Math.min(GAME_H * 0.82, 460);
    return { x: (GAME_W - winW) / 2, y: (GAME_H - winH) / 2, w: winW, h: winH };
}
function getCloseBtn() {
    let w = getWindowRect(), s = Math.min(34, w.w * 0.06);
    return { x: w.x + w.w - s - 6, y: w.y + 6, w: s, h: s };
}
function getCraftRows() {
    let w = getWindowRect(), pad = w.w * 0.06, listX = w.x + pad, listW = w.w - pad * 2;
    let rowH = Math.min(58, w.h * 0.12), gap = rowH * 0.22, startY = w.y + w.h * 0.22;
    return game.recipes.map((rec, i) => {
        let sy = startY + i * (rowH + gap);
        let canCraft = Object.keys(rec.cost).every(r => (game.inventory[r] || 0) >= rec.cost[r]);
        return { recipe: rec, x: listX, y: sy, w: listW, h: rowH, canCraft };
    });
}
function getInvSlots() {
    let w = getWindowRect(), items = Object.keys(game.inventory), cols = 4, pad = w.w * 0.06;
    let gridW = w.w - pad * 2, boxW = gridW / cols, startX = w.x + pad, startY = w.y + w.h * 0.22;
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
    if (game.state === 'menu') { initAudio(); SFX.click(); game.state = 'playing'; return; }
    if (game.state === 'dialogue') { SFX.click(); game.state = 'playing'; return; }

    if (game.state === 'crafting' || game.state === 'inventory') {
        let w = getWindowRect();
        if (inRect(x, y, getCloseBtn())) { SFX.close(); game.state = 'playing'; return; }
        if (game.state === 'crafting') {
            for (let row of getCraftRows()) {
                if (inRect(x, y, row)) {
                    let rec = row.recipe;
                    let canCraft = Object.keys(rec.cost).every(r => (game.inventory[r] || 0) >= rec.cost[r]);
                    if (canCraft) {
                        Object.keys(rec.cost).forEach(r => game.inventory[r] -= rec.cost[r]);
                        game.inventory[rec.result]++;
                        game.feedbackTexts.push({ text: `Crafted ${rec.name}`, x: GAME_W/2, y: GAME_H*0.40, timer: 1.5 });
                        SFX.craft();
                    } else {
                        let need = Object.keys(rec.cost).filter(r => (game.inventory[r]||0) < rec.cost[r]).map(r => `${r} ${game.inventory[r]||0}/${rec.cost[r]}`).join('  ');
                        game.feedbackTexts.push({ text: `Need: ${need}`, x: GAME_W/2, y: GAME_H*0.40, timer: 1.8 });
                        SFX.fail();
                    }
                    return; // stay open
                }
            }
        }
        if (!inRect(x, y, w)) { SFX.close(); game.state = 'playing'; }
        return;
    }

    if (inRect(x, y, getMuteBtn())) { toggleMute(); return; }

    let hb = getHotbarLayout();
    if (y > hb.hbY && y < hb.hbY + hb.hbSize) {
        for (let i = 0; i < 5; i++) {
            let hx = hb.hbStartX + i * (hb.hbSize + hb.gap);
            if (x > hx && x < hx + hb.hbSize) {
                if (game.selectedSlot !== i) { game.selectedSlot = i; SFX.select(); }
                return;
            }
        }
    }

    let btns = getButtons();
    if (x > GAME_W - 260 * btns.scale) {
        if (Math.hypot(x - btns.break.x, y - btns.break.y) < btns.break.r) { handleBreak(); return; }
        if (Math.hypot(x - btns.jump.x,  y - btns.jump.y)  < btns.jump.r)  { if (game.player.jumpY === 0) { game.player.jumpY = 0.6; SFX.jump(); } return; }
        if (Math.hypot(x - btns.craft.x, y - btns.craft.y) < btns.craft.r) { game.state = 'crafting'; SFX.open(); return; }
        if (Math.hypot(x - btns.inv.x,   y - btns.inv.y)   < btns.inv.r)   { game.state = 'inventory'; SFX.open(); return; }
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
        let dx = e.clientX - game.joy.x, dy = e.clientY - game.joy.y;
        let dist = Math.hypot(dx, dy);
        let maxDist = 48 * getButtons().scale;
        if (dist > maxDist) { dx = (dx / dist) * maxDist; dy = (dy / dist) * maxDist; }
        game.joy.dx = dx; game.joy.dy = dy;
    }
});
canvas.addEventListener('pointerup', e => { e.preventDefault(); game.joy.active = false; game.joy.dx = 0; game.joy.dy = 0; });

window.addEventListener('keydown', e => {
    let k = e.key.toLowerCase();
    if (k === 'c') { if (game.state === 'playing') { game.state = 'crafting'; SFX.open(); } else if (game.state === 'crafting') { game.state = 'playing'; SFX.close(); } }
    else if (k === 'e') { if (game.state === 'playing') { game.state = 'inventory'; SFX.open(); } else if (game.state === 'inventory') { game.state = 'playing'; SFX.close(); } }
    else if (k === 'escape') { if (game.state !== 'menu') { game.state = 'playing'; SFX.close(); } }
    else if (k === ' ') { if (game.state === 'playing' && game.player.jumpY === 0) { game.player.jumpY = 0.6; SFX.jump(); } }
    else if (k === 'm') { toggleMute(); }
    else if (['1','2','3','4','5'].includes(k)) { let i = parseInt(k) - 1; if (game.selectedSlot !== i) { game.selectedSlot = i; SFX.select(); } }
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ---------------------------------------------------------------------------
//  Update
// ---------------------------------------------------------------------------
let lastTime = performance.now();
function update(dt) {
    game.frameCount++;
    if (game.state === 'menu') { game.menuTime += dt; return; }
    if (game.state !== 'playing') return;

    game.timeOfDay = (game.timeOfDay + dt * 0.0025) % 1.0; // ~3x slower than v2
    let lv = Math.sin(game.timeOfDay * Math.PI * 2 - Math.PI / 2);
    game.ambientLight = 0.25 + (lv + 1) / 2 * 0.75;

    let isNight = game.ambientLight < 0.35;
    if (isNight && !game.lastNight) SFX.night();
    game.lastNight = isNight;
    if (ambientNode) ambientNode.filt.frequency.value = 380 - (1 - game.ambientLight) * 160;

    let p = game.player;
    if (p.jumpY > 0) { p.jumpY -= dt * 1.5; if (p.jumpY < 0) p.jumpY = 0; }

    let ad = p.targetAngle - p.angle;
    while (ad > Math.PI) ad -= 2 * Math.PI;
    while (ad < -Math.PI) ad += 2 * Math.PI;
    p.angle += ad * Math.min(1.0, dt * 10.0);

    if (game.spirit && !game.spirit.talked) {
        let s = game.spirit;
        if (Math.hypot(p.x - (s.tx+0.5), p.z - (s.ty+0.5)) < 2.5) {
            game.state = 'dialogue';
            game.dialogue = { speaker: "Spirit of Nature", text: "Welcome, Wanderer. The Earth has healed. Gather Wood and Fiber, craft tools, then seek the mountains for Stone and Metal. The world stretches endlessly now." };
            s.talked = true;
        }
    }

    let isMovingJoy = game.joy.active && (Math.abs(game.joy.dx) > 4 || Math.abs(game.joy.dy) > 4);
    if (isMovingJoy) {
        p.path = []; game.pendingInteraction = null; game.destinationMarker = null; delete p.gatherTimer;
        let joyScale = 48 * getButtons().scale;
        let inputX = game.joy.dx / joyScale, inputY = -game.joy.dy / joyScale;
        let moveX = inputX * D_VEC[0] + inputY * W_VEC[0];
        let moveZ = inputX * D_VEC[1] + inputY * W_VEC[1];
        let mag = Math.hypot(moveX, moveZ);
        if (mag > 0) {
            moveX /= mag; moveZ /= mag;
            let speed = 4.8 * dt;
            let nx = p.x + moveX * speed, nz = p.z + moveZ * speed;
            let targetTx = Math.floor(nx), targetTy = Math.floor(nz);
            let currentH = _H(p.tx, p.ty), targetH = _H(targetTx, targetTy);
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
            let gatherTime = 1.2, yieldAmount = 1;
            if (e.type === 'tree' && sel === 'Axe' && hasTool)         { gatherTime = 0.5; yieldAmount = 2; }
            if (e.type === 'rock' && sel === 'Pickaxe' && hasTool)     { gatherTime = 0.5; yieldAmount = 2; }
            if (e.type === 'ruin_wall' && sel === 'Pickaxe' && hasTool){ gatherTime = 0.5; yieldAmount = 2; }
            if (e.type === 'metal' && sel === 'Pickaxe' && hasTool)    { gatherTime = 0.6; yieldAmount = 2; }
            if (!p.gatherTimer || p.gatherTarget !== (e.tx+','+e.ty)) { p.gatherTimer = gatherTime; p.gatherTarget = e.tx+','+e.ty; }
            p.gatherTimer -= dt;
            if (p.gatherTimer <= 0) {
                let label = '';
                if      (e.type === 'tree')      { game.inventory.Wood  += yieldAmount; label = `+${yieldAmount} Wood`; }
                else if (e.type === 'rock')      { game.inventory.Stone += yieldAmount; label = `+${yieldAmount} Stone`; }
                else if (e.type === 'metal')     { game.inventory.Metal += yieldAmount; label = `+${yieldAmount} Metal`; }
                else if (e.type === 'bush')      { game.inventory.Fiber += yieldAmount; label = `+${yieldAmount} Fiber`; }
                else if (e.type === 'ruin_wall') { game.inventory.Stone += yieldAmount; label = `+${yieldAmount} Stone`; }
                game.feedbackTexts.push({ text: label, x: GAME_W/2, y: GAME_H*0.40, timer: 1.4 });
                SFX.gather();
                game.worldMods[e.tx+','+e.ty] = { removed: true };
                game.pendingInteraction = null; p.state = 'idle'; game.destinationMarker = null;
                delete p.gatherTimer; delete p.gatherTarget;
            }
        } else { p.state = 'idle'; }
    } else p.state = 'idle';

    let terrainY = getHeight(p.tx, p.ty);
    p.y += ((terrainY + p.jumpY) - p.y) * Math.min(1, dt * 15);

    game.lights.forEach(l => { l.intensity = (l.baseIntensity || 1) + Math.sin(game.frameCount * 0.4 + l.x) * 0.08; });
    game.feedbackTexts.forEach(ft => { ft.y -= 22 * dt; ft.timer -= dt; });
    game.feedbackTexts = game.feedbackTexts.filter(ft => ft.timer > 0);
}

// ---------------------------------------------------------------------------
//  Sky + stars
// ---------------------------------------------------------------------------
const STARS = [];
for (let i = 0; i < 70; i++) STARS.push([Math.random(), Math.random()]);
function lerp3(a, b, f) { return [a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f]; }
function skyColors(t) {
    const keys = [
        { t: 0.00, top: [10,14,26],  hor: [26,32,48] },
        { t: 0.22, top: [40,40,70],  hor: [205,115,60] },
        { t: 0.30, top: [70,110,160],hor: [230,170,120] },
        { t: 0.50, top: [80,140,200],hor: [170,200,225] },
        { t: 0.70, top: [70,110,160],hor: [230,150,110] },
        { t: 0.78, top: [40,40,70],  hor: [200,80,55] },
        { t: 1.00, top: [10,14,26],  hor: [26,32,48] }
    ];
    for (let i = 0; i < keys.length - 1; i++) {
        if (t >= keys[i].t && t <= keys[i+1].t) {
            let f = (t - keys[i].t) / (keys[i+1].t - keys[i].t);
            return { top: lerp3(keys[i].top, keys[i+1].top, f), hor: lerp3(keys[i].hor, keys[i+1].hor, f) };
        }
    }
    return { top: keys[0].top, hor: keys[0].hor };
}
// Fog target = dark forest-green (NOT the bright sky horizon) so distant
// ground darkens instead of turning white. Darker at night.
let _fogColor = [20, 28, 18];
function drawSky() {
    const sky = skyColors(game.timeOfDay);
    let nightAmt = 1 - game.ambientLight;
    _fogColor = lerp3([24, 32, 20], [10, 14, 10], nightAmt);
    let g = ctx.createLinearGradient(0, 0, 0, GAME_H);
    g.addColorStop(0, `rgb(${sky.top[0]|0},${sky.top[1]|0},${sky.top[2]|0})`);
    g.addColorStop(1, `rgb(${sky.hor[0]|0},${sky.hor[1]|0},${sky.hor[2]|0})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, GAME_W, GAME_H);

    const t = game.timeOfDay, horizonY = GAME_H * 0.55;
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
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        for (const s of STARS) ctx.fillRect(s[0] * GAME_W, s[1] * GAME_H * 0.5, 1, 1);
        ctx.fillStyle = 'rgba(220,230,245,0.18)'; ctx.beginPath(); ctx.arc(sx, sy, 34, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#e6ecf5'; ctx.beginPath(); ctx.arc(sx, sy, 17, 0, Math.PI*2); ctx.fill();
    }
}

// ---------------------------------------------------------------------------
//  HUD primitives — green theme (beveled mossy panels + stone buttons)
// ---------------------------------------------------------------------------
const COL = {
    panelBorder: '#10160a',
    panelFill:   '#2a3318',
    panelBevel:  '#4a5d23',
    panelShadow: '#1a2010',
    slotFill:    '#1f2812',
    slotBevel:   '#3a4a1c',
    stoneFill:   '#4a4a40',
    stoneBevel:  '#6a6258',
    accent:      '#a2d15b',
    good:        '#8fb84a',
    bad:         '#c45a3a',
    text:        '#e8e6c8',
    textDim:     '#8a986a'
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
    if (selected) { ctx.strokeStyle = COL.accent; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, size - 2, size - 2); }
}
function drawCircleButton(cx, cy, r, icon) {
    ctx.fillStyle = COL.panelBorder; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = COL.stoneFill; ctx.beginPath(); ctx.arc(cx, cy, r - 2, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = COL.stoneBevel; ctx.beginPath(); ctx.arc(cx, cy, r - 2, Math.PI, Math.PI*2); ctx.fill();
    ctx.fillStyle = COL.panelShadow; ctx.beginPath(); ctx.arc(cx, cy, r - 2, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#3a3a32'; ctx.beginPath(); ctx.arc(cx, cy, r - 6, 0, Math.PI*2); ctx.fill();
    if (icon) icon(cx, cy, r);
}
function drawJoystick(jx, jy, alpha) {
    let s = getButtons().scale, baseR = 52 * s;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = COL.panelBorder; ctx.beginPath(); ctx.arc(jx, jy, baseR, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = COL.stoneFill; ctx.beginPath(); ctx.arc(jx, jy, baseR - 2, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = COL.slotBevel; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(jx, jy, baseR * 0.55, 0, Math.PI*2); ctx.stroke();
    if (game.joy.active) {
        let kr = 24 * s, kx = jx + game.joy.dx, ky = jy + game.joy.dy;
        ctx.fillStyle = COL.panelBorder; ctx.beginPath(); ctx.arc(kx, ky, kr, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = COL.accent; ctx.beginPath(); ctx.arc(kx, ky, kr - 2, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = COL.slotBevel; ctx.beginPath(); ctx.arc(kx, ky, kr - 5, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
}
const BTN_ICONS = {
    break: (cx, cy, r) => { ctx.fillStyle = '#6e4d3a'; ctx.fillRect(cx - 2, cy - r*0.45, 4, r*0.7); ctx.fillStyle = '#b0b0b0'; ctx.fillRect(cx - r*0.45, cy - r*0.45, r*0.9, 5); },
    jump:  (cx, cy, r) => { ctx.fillStyle = COL.accent; ctx.beginPath(); ctx.moveTo(cx, cy - r*0.4); ctx.lineTo(cx + r*0.4, cy + r*0.15); ctx.lineTo(cx + r*0.18, cy + r*0.15); ctx.lineTo(cx, cy - r*0.12); ctx.lineTo(cx - r*0.18, cy + r*0.15); ctx.lineTo(cx - r*0.4, cy + r*0.15); ctx.closePath(); ctx.fill(); },
    craft: (cx, cy, r) => { let u = r * 0.22, g2 = r * 0.10; ctx.fillStyle = COL.accent; ctx.fillRect(cx - u - g2/2, cy - u - g2/2, u, u); ctx.fillRect(cx + g2/2, cy - u - g2/2, u, u); ctx.fillRect(cx - u - g2/2, cy + g2/2, u, u); ctx.fillRect(cx + g2/2, cy + g2/2, u, u); },
    inv:   (cx, cy, r) => { let w = r * 0.6, h = r * 0.5; ctx.fillStyle = COL.accent; ctx.fillRect(cx - w/2, cy - h/2, w, h*0.4); ctx.fillStyle = '#8a9a4a'; ctx.fillRect(cx - w/2, cy - h/2 + h*0.4, w, h*0.6); ctx.fillStyle = '#1a2010'; ctx.fillRect(cx - 2, cy - h/2, 4, h*0.4); }
};

// ---------------------------------------------------------------------------
//  Entity renderers (per type/variant)
// ---------------------------------------------------------------------------
const TREE_COLORS = {
    oak:   { trunk: [92,64,51],  canopy: [58,85,30] },
    pine:  { trunk: [70,48,38],  canopy: [38,60,24] },
    birch: { trunk: [210,205,190], canopy: [130,150,70] }
};
const ROCK_COLORS = {
    granite:   [128,128,128],
    basalt:    [74,74,86],
    sandstone: [196,160,96]
};
const METAL_COLORS = {
    iron:   [112,112,112],
    copper: [150,86,46],
    gold:   [176,140,48]
};
function addTree(faces, e) {
    let h = _H(e.tx, e.ty), s = Math.sin(game.frameCount * 0.03 + e.swayPhase) * 0.08;
    let c = TREE_COLORS[e.variant] || TREE_COLORS.oak;
    addShadow(faces, e.tx+0.5, e.ty+0.5, 0.7);
    if (e.variant === 'pine') {
        addCube(faces, e.tx+0.5, h+1.2, e.ty+0.5, 0.35, 1.6, 0.35, c.trunk);
        addCube(faces, e.tx+0.5+s, h+2.0, e.ty+0.5, 1.0, 0.8, 1.0, c.canopy);
        addCube(faces, e.tx+0.5+s, h+2.6, e.ty+0.5, 0.7, 0.6, 0.7, c.canopy);
        addCube(faces, e.tx+0.5+s, h+3.1, e.ty+0.5, 0.4, 0.4, 0.4, c.canopy);
    } else if (e.variant === 'birch') {
        addCube(faces, e.tx+0.5, h+1.1, e.ty+0.5, 0.28, 1.4, 0.28, c.trunk);
        addCube(faces, e.tx+0.5+s, h+1.9, e.ty+0.5, 0.9, 0.7, 0.9, c.canopy);
    } else {
        addCube(faces, e.tx+0.5, h+1.2, e.ty+0.5, 0.32, 1.2, 0.32, c.trunk);
        addCube(faces, e.tx+0.5+s, h+2.0, e.ty+0.5, 1.3, 1.3, 1.3, c.canopy);
    }
}
function addRock(faces, e) {
    let h = _H(e.tx, e.ty);
    addShadow(faces, e.tx+0.5, e.ty+0.5, 0.6);
    let c = ROCK_COLORS[e.variant] || ROCK_COLORS.granite;
    addCube(faces, e.tx+0.5, h+0.32, e.ty+0.5, 0.8, 0.6, 0.8, c);
    if (e.variant === 'basalt') addCube(faces, e.tx+0.5, h+0.7, e.ty+0.5, 0.4, 0.3, 0.4, [60,60,70]);
}
function addMetal(faces, e) {
    let h = _H(e.tx, e.ty);
    addShadow(faces, e.tx+0.5, e.ty+0.5, 0.55);
    let c = METAL_COLORS[e.variant] || METAL_COLORS.iron;
    addCube(faces, e.tx+0.5, h+0.22, e.ty+0.5, 0.9, 0.4, 0.9, c);
    addCube(faces, e.tx+0.5, h+0.45, e.ty+0.5, 0.5, 0.15, 0.5, [c[0]*0.7, c[1]*0.7, c[2]*0.7]);
}
function addBush(faces, e) {
    let h = _H(e.tx, e.ty), s = Math.sin(game.frameCount * 0.04 + e.swayPhase) * 0.04;
    addCube(faces, e.tx+0.5+s, h+0.3, e.ty+0.5, 0.8, 0.6, 0.8, [85,122,43]);
}
function addRuinWall(faces, e) {
    let h = _H(e.tx, e.ty);
    addShadow(faces, e.tx+0.5, e.ty+0.5, 0.6);
    addCube(faces, e.tx+0.5, h+0.5, e.ty+0.5, 0.8, 1.0, 0.3, [90,85,80]);
}
function addTorchEntity(faces, e) {
    let h = _H(e.tx, e.ty);
    addShadow(faces, e.tx+0.5, e.ty+0.5, 0.25, 50);
    // ~1/4 player height: stick 0.34 tall + small flame
    addCube(faces, e.tx+0.5, h+0.17, e.ty+0.5, 0.06, 0.34, 0.06, [92,64,51]);
    addCube(faces, e.tx+0.5, h+0.40, e.ty+0.5, 0.13, 0.13, 0.13, [255, Math.random()<0.5?180:140, 40]);
}
function addCampfireEntity(faces, e) {
    let h = _H(e.tx, e.ty);
    addShadow(faces, e.tx+0.5, e.ty+0.5, 0.5);
    addCube(faces, e.tx+0.5, h+0.08, e.ty+0.5, 0.7, 0.15, 0.7, [70,55,40]);
    addCube(faces, e.tx+0.5, h+0.22, e.ty+0.5, 0.4, 0.3, 0.4, [255, Math.random()<0.5?150:110, 30]);
}
function addSpirit(faces) {
    let s = game.spirit, h = _H(s.tx, s.ty);
    let hover = Math.sin(game.frameCount * 0.05) * 0.08;
    let baseY = h + hover;
    addShadow(faces, s.tx+0.5, s.ty+0.5, 0.45, 60);
    addCube(faces, s.tx+0.5, baseY+0.10, s.ty+0.5, 0.55, 0.18, 0.45, [40,60,28]);    // dress hem
    addCube(faces, s.tx+0.5, baseY+0.35, s.ty+0.5, 0.45, 0.40, 0.35, [58,88,40]);    // lower body
    addCube(faces, s.tx+0.5, baseY+0.80, s.ty+0.5, 0.34, 0.42, 0.26, [78,108,52]);   // torso
    let sw = Math.sin(game.frameCount * 0.06) * 0.12;
    let ao = rotateY(0.26,0,0,sw);
    addCube(faces, s.tx+0.5+ao[0], baseY+0.82, s.ty+0.5+ao[2], 0.11, 0.38, 0.11, [68,96,46], sw, 0, 0, -0.19, 0);
    let ao2 = rotateY(-0.26,0,0,-sw);
    addCube(faces, s.tx+0.5+ao2[0], baseY+0.82, s.ty+0.5+ao2[2], 0.11, 0.38, 0.11, [68,96,46], -sw, 0, 0, -0.19, 0);
    addCube(faces, s.tx+0.5, baseY+1.22, s.ty+0.5, 0.30, 0.30, 0.30, [222,202,172]);  // head
    addCube(faces, s.tx+0.5, baseY+1.40, s.ty+0.5, 0.38, 0.12, 0.38, [44,66,30]);     // leafy crown
    let glow = 0.7 + Math.sin(game.frameCount * 0.12) * 0.3;
    addCube(faces, s.tx+0.5, baseY+1.52, s.ty+0.5, 0.12, 0.12, 0.12, [255, Math.floor(240*glow+15), Math.floor(180*glow+40)]); // glowing flower
}
function addPlayer(faces) {
    let p = game.player, playerY = p.y;
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
    let equippedTool = game.hotbar[game.selectedSlot];
    let toolCount = (equippedTool !== 'Hands') ? (game.inventory[equippedTool] || 0) : 1;
    if (toolCount > 0) {
        let hx = p.x+rao[0], hy = shoulderY, hz = p.z+rao[2];
        if (equippedTool === 'Axe') {
            addCube(faces, hx, hy, hz, 0.08, 0.4, 0.08, [100,70,40], -asr, p.angle, 0, -0.2, 0);
            addCube(faces, hx, hy, hz, 0.25, 0.1, 0.15, [130,130,130], -asr, p.angle, 0.15, 0.1, 0);
        } else if (equippedTool === 'Pickaxe') {
            addCube(faces, hx, hy, hz, 0.08, 0.4, 0.08, [100,70,40], -asr, p.angle, 0, -0.2, 0);
            addCube(faces, hx, hy, hz, 0.2, 0.08, 0.1, [130,130,130], -asr, p.angle, 0.15, 0.1, 0);
            addCube(faces, hx, hy, hz, 0.2, 0.08, 0.1, [130,130,130], -asr, p.angle, -0.15, 0.1, 0);
        } else if (equippedTool === 'Torch') {
            addCube(faces, hx, hy, hz, 0.08, 0.3, 0.08, [100,70,40], -asr, p.angle, 0, -0.15, 0);
            addCube(faces, hx, hy, hz, 0.15, 0.15, 0.15, [255,200,0], -asr, p.angle, 0, -0.35, 0);
        }
    }
}

// ---------------------------------------------------------------------------
//  Biome -> terrain colors
// ---------------------------------------------------------------------------
function biomeColors(biome) {
    switch (biome) {
        case 'water':    return { top: [45,80,110],   side: [194,176,120] };
        case 'sand':     return { top: [194,176,120], side: [170,150,100] };
        case 'mountain': return { top: [122,118,108], side: [92,88,80] };
        case 'forest':   return { top: [54,80,28],    side: [90,70,45] };
        case 'plains':   return { top: [98,110,50],   side: [110,90,50] };
        default:         return { top: [74,93,35],    side: [110,90,50] };
    }
}

// ---------------------------------------------------------------------------
//  Render
// ---------------------------------------------------------------------------
const VIEW_RADIUS = 14;
const FOG_NEAR = 14, FOG_RANGE = 9;

function render() {
    if (game.state === 'menu') { drawSky(); renderMenu(); return; }
    drawSky();
    cacheClear();

    let p = game.player, cam = [p.x - 10, 12, p.z - 10];
    let faces = [];

    let minTx = p.tx - VIEW_RADIUS, maxTx = p.tx + VIEW_RADIUS;
    let minTy = p.ty - VIEW_RADIUS, maxTy = p.ty + VIEW_RADIUS;

    // --- Terrain tile window (with frustum cull) ---
    for (let ty = minTy; ty <= maxTy; ty++) {
        for (let tx = minTx; tx <= maxTx; tx++) {
            let h = _H(tx, ty);
            let cp = project(tx + 0.5, h, ty + 0.5, cam);
            if (!cp) continue;
            if (cp[0] < -260 || cp[0] > GAME_W + 260 || cp[1] < -260 || cp[1] > GAME_H + 260) continue;

            let biome = _B(tx, ty);
            let col = biomeColors(biome);
            faces.push({ verts: [[tx,h,ty],[tx+1,h,ty],[tx+1,h,ty+1],[tx,h,ty+1]], color: shade(col.top, 1.0, tx+0.5, h, ty+0.5) });

            if (biome !== 'water') {
                let hL = _H(tx-1, ty); if (h < hL) faces.push({ verts: [[tx,h,ty],[tx,hL,ty],[tx,hL,ty+1],[tx,h,ty+1]], color: shade(col.side, 0.6, tx, (h+hL)/2, ty+0.5) });
                let hR = _H(tx+1, ty); if (h < hR) faces.push({ verts: [[tx+1,h,ty],[tx+1,hR,ty],[tx+1,hR,ty+1],[tx+1,h,ty+1]], color: shade(col.side, 0.6, tx+1, (h+hR)/2, ty+0.5) });
                let hF = _H(tx, ty-1); if (h < hF) faces.push({ verts: [[tx,h,ty],[tx+1,h,ty],[tx+1,hF,ty],[tx,hF,ty]], color: shade(col.side, 0.5, tx+0.5, (h+hF)/2, ty) });
                let hB = _H(tx, ty+1); if (h < hB) faces.push({ verts: [[tx,h,ty+1],[tx+1,h,ty+1],[tx+1,hB,ty+1],[tx,hB,ty+1]], color: shade(col.side, 0.5, tx+0.5, (h+hB)/2, ty+1) });
            }

            if (biome === 'meadow' || biome === 'forest' || biome === 'plains') {
                let g = hash2(tx*5+3, ty*5+9);
                if (g < 0.30) {
                    let sw = Math.sin(game.frameCount * 0.04 + g*10) * 0.08;
                    addDiamondGrass(faces, tx + 0.2 + g*0.6, ty + 0.2 + (1-g)*0.6, sw);
                }
            }
        }
    }

    // --- Destination marker ---
    if (game.destinationMarker) {
        let tx = game.destinationMarker.tx, ty = game.destinationMarker.ty;
        let h = _H(tx, ty) + 0.02;
        let pulse = 0.5 + Math.sin(game.frameCount * 0.15) * 0.2;
        faces.push({ verts: [[tx+0.1,h,ty+0.1],[tx+0.9,h,ty+0.1],[tx+0.9,h,ty+0.9],[tx+0.1,h,ty+0.9]], color: `rgba(162,209,91,${pulse})` });
    }

    // --- Entities (per tile in window) ---
    for (let ty = minTy; ty <= maxTy; ty++) {
        for (let tx = minTx; tx <= maxTx; tx++) {
            let e = _E(tx, ty);
            if (!e) continue;
            let h = _H(tx, ty);
            let cp = project(tx+0.5, h+0.5, ty+0.5, cam);
            if (!cp) continue;
            if (cp[0] < -300 || cp[0] > GAME_W + 300 || cp[1] < -400 || cp[1] > GAME_H + 300) continue;
            switch (e.type) {
                case 'tree':       addTree(faces, e); break;
                case 'rock':       addRock(faces, e); break;
                case 'metal':      addMetal(faces, e); break;
                case 'bush':       addBush(faces, e); break;
                case 'ruin_wall':  addRuinWall(faces, e); break;
                case 'flower':     addFlower(faces, tx+0.5, ty+0.5, e.color); break;
                case 'torch':      addTorchEntity(faces, e); break;
                case 'campfire':   addCampfireEntity(faces, e); break;
                case 'spirit':     addSpirit(faces); break;
            }
        }
    }

    addPlayer(faces);

    // --- Project + sort + fill (painter's algorithm) with dark fog ---
    let renderables = [];
    for (let f of faces) {
        let pv = [], valid = true;
        for (let v of f.verts) { let proj = project(v[0], v[1], v[2], cam); if (!proj) { valid = false; break; } pv.push(proj); }
        if (valid) {
            let avgZ = (pv[0][2] + pv[1][2] + pv[2][2] + pv[3][2]) / 4;
            renderables.push({ verts: pv, color: f.color, z: avgZ });
        }
    }
    renderables.sort((a, b) => b.z - a.z);
    for (let r of renderables) {
        ctx.beginPath();
        ctx.moveTo(r.verts[0][0], r.verts[0][1]);
        for (let i = 1; i < r.verts.length; i++) ctx.lineTo(r.verts[i][0], r.verts[i][1]);
        ctx.closePath();
        if (typeof r.color === 'string') {
            ctx.fillStyle = r.color;
        } else {
            let fog = Math.max(0, Math.min(1, (r.z - FOG_NEAR) / FOG_RANGE));
            let r0 = r.color[0] + (_fogColor[0] - r.color[0]) * fog;
            let g0 = r.color[1] + (_fogColor[1] - r.color[1]) * fog;
            let b0 = r.color[2] + (_fogColor[2] - r.color[2]) * fog;
            ctx.fillStyle = `rgba(${r0|0},${g0|0},${b0|0},1)`;
        }
        ctx.fill();
    }

    // --- HUD ---
    drawTopBar();
    drawFeedback();
    drawHotbar();
    drawMuteBtn();
    if (game.state === 'playing') {
        let s = getButtons().scale;
        let jx = game.joy.active ? game.joy.x : 90 * s;
        let jy = game.joy.active ? game.joy.y : GAME_H - (100 * s);
        drawJoystick(jx, jy, game.joy.active ? 0.95 : 0.40);
        let b = getButtons();
        drawCircleButton(b.break.x, b.break.y, b.break.r, BTN_ICONS.break);
        drawCircleButton(b.jump.x,  b.jump.y,  b.jump.r,  BTN_ICONS.jump);
        drawCircleButton(b.craft.x, b.craft.y, b.craft.r, BTN_ICONS.craft);
        drawCircleButton(b.inv.x,   b.inv.y,   b.inv.r,   BTN_ICONS.inv);
    }
    if (game.state === 'crafting') renderCrafting();
    if (game.state === 'inventory') renderInventory();
    if (game.state === 'dialogue' && game.dialogue) renderDialogue();
}

function renderMenu() {
    let mt = game.menuTime;
    let titleAlpha = Math.min(1, mt / 0.8);
    let subAlpha = Math.max(0, Math.min(1, (mt - 0.4) / 0.6));
    let btnAlpha = Math.max(0, Math.min(1, (mt - 0.7) / 0.6));
    if (!game._menuParts) {
        game._menuParts = [];
        for (let i = 0; i < 40; i++) game._menuParts.push({ x: Math.random()*GAME_W, y: Math.random()*GAME_H, vy: -0.3 - Math.random()*0.8, s: 1 + Math.random()*2, a: Math.random()*0.4 });
    }
    game._menuParts.forEach(pt => {
        pt.y += pt.vy;
        if (pt.y < 0) { pt.y = GAME_H; pt.x = Math.random()*GAME_W; }
        ctx.fillStyle = `rgba(162,209,91,${pt.a})`;
        ctx.fillRect(pt.x, pt.y, pt.s, pt.s);
    });

    let frameW = Math.min(GAME_W * 0.92, 620), frameH = Math.min(GAME_H * 0.6, 340);
    let frameX = (GAME_W - frameW) / 2, frameY = (GAME_H - frameH) / 2;
    ctx.globalAlpha = titleAlpha;
    drawPanel(frameX, frameY, frameW, frameH);

    let pulse = 0.5 + Math.sin(mt * 3) * 0.5;
    ctx.fillStyle = `rgba(162,209,91,${0.05 + pulse*0.05})`;
    ctx.fillRect(frameX + 12, frameY + frameH * 0.18 - 6, frameW - 24, frameH * 0.20);

    let titleY = frameY + frameH * 0.28 + (1 - titleAlpha) * 18 + Math.sin(mt * 1.5) * 3;
    ctx.fillStyle = COL.accent;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.floor(frameW * 0.075)}px "Courier New", monospace`;
    ctx.fillText('THE LAST WANDERER', GAME_W/2, titleY);

    ctx.globalAlpha = subAlpha;
    ctx.fillStyle = COL.textDim;
    ctx.font = `${Math.floor(frameW * 0.025)}px Arial`;
    ctx.fillText('A 3D voxel survival prototype · endless world', GAME_W/2, frameY + frameH * 0.42);

    ctx.globalAlpha = btnAlpha;
    let baseBtnW = frameW * 0.5, baseBtnH = Math.min(54, frameH * 0.18);
    let scl = 1 + Math.sin(mt * 3) * 0.04;
    let btnW = baseBtnW * scl, btnH = baseBtnH * scl;
    let btnX = (GAME_W - btnW) / 2, btnY = frameY + frameH * 0.58 - (btnH - baseBtnH)/2;
    drawPanel(btnX, btnY, btnW, btnH, COL.stoneFill, COL.stoneBevel);
    ctx.fillStyle = COL.text;
    ctx.font = `900 ${Math.floor(btnH * 0.4)}px "Courier New", monospace`;
    ctx.fillText('TAP TO START', GAME_W/2, btnY + btnH * 0.5);

    ctx.globalAlpha = Math.min(titleAlpha, 1);
    ctx.fillStyle = COL.textDim;
    ctx.font = `${Math.floor(frameW * 0.022)}px Arial`;
    ctx.fillText('WASD move · Space jump · C craft · E inventory · 1-5 hotbar · M mute', GAME_W/2, frameY + frameH * 0.86);
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
}

function drawTopBar() {
    let s = getButtons().scale, pad = 12 * s;
    let pillW = 150 * s, pillH = 30 * s;
    drawPanel(pad, pad, pillW, pillH, COL.stoneFill, COL.stoneBevel);
    let t = game.timeOfDay;
    let label = (t < 0.22 || t > 0.78) ? 'Night' : (t < 0.35) ? 'Dawn' : (t < 0.65) ? 'Day' : 'Dusk';
    let ix = pad + pillH * 0.5, iy = pad + pillH * 0.5;
    let isDay = t > 0.22 && t < 0.78;
    ctx.fillStyle = isDay ? '#ffe9a0' : '#e6ecf5';
    ctx.beginPath(); ctx.arc(ix, iy, pillH * 0.28, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = COL.text;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.floor(pillH * 0.5)}px Arial`;
    ctx.fillText(label, ix + pillH * 0.5, iy);

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
function drawMuteBtn() {
    let b = getMuteBtn();
    drawPanel(b.x, b.y, b.w, b.h, COL.stoneFill, COL.stoneBevel);
    let cx = b.x + b.w/2, cy = b.y + b.h/2, r = b.w * 0.18;
    ctx.fillStyle = COL.text;
    ctx.fillRect(cx - r, cy - r*0.6, r*0.7, r*1.2);
    ctx.beginPath();
    ctx.moveTo(cx - r*0.3, cy - r*0.6); ctx.lineTo(cx + r*0.4, cy - r*1.1);
    ctx.lineTo(cx + r*0.4, cy + r*1.1); ctx.lineTo(cx - r*0.3, cy + r*0.6); ctx.closePath(); ctx.fill();
    if (!audioEnabled) {
        ctx.strokeStyle = COL.bad; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(b.x + 4, b.y + 4); ctx.lineTo(b.x + b.w - 4, b.y + b.h - 4); ctx.stroke();
    } else {
        ctx.strokeStyle = COL.text; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx + r*0.6, cy, r*0.5, -0.5, 0.5); ctx.stroke();
    }
}
function drawFeedback() {
    let s = getButtons().scale;
    game.feedbackTexts.forEach(ft => {
        ctx.globalAlpha = Math.max(0, Math.min(1, ft.timer / 1.4));
        ctx.font = `bold ${Math.floor(15 * s)}px Arial`;
        let tw = ctx.measureText(ft.text).width;
        let bw = tw + 24 * s, bh = 26 * s;
        drawPanel(ft.x - bw/2, ft.y - bh/2, bw, bh, COL.stoneFill, COL.stoneBevel);
        ctx.fillStyle = COL.text;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(ft.text, ft.x, ft.y);
    });
    ctx.globalAlpha = 1.0; ctx.textBaseline = 'alphabetic';
}
function drawHotbar() {
    let hb = getHotbarLayout(), s = getButtons().scale, dockPad = 8 * s;
    drawPanel(hb.hbStartX - dockPad, hb.hbY - dockPad, hb.totalW + dockPad*2, hb.hbSize + dockPad*2, COL.panelFill, COL.panelBevel);
    for (let i = 0; i < 5; i++) {
        let cx = hb.hbStartX + i * (hb.hbSize + hb.gap) + hb.hbSize / 2;
        let cy = hb.hbY + hb.hbSize / 2;
        drawSlot(cx, cy, hb.hbSize, game.selectedSlot === i);
        let itemName = game.hotbar[i];
        if (itemName !== 'Hands' && (game.inventory[itemName] || 0) > 0) drawUIImage('item_' + itemName.toLowerCase(), cx, cy, hb.hbSize * 0.66);
        let count = game.inventory[itemName];
        if (count !== undefined && count > 0) {
            ctx.fillStyle = COL.accent;
            ctx.font = `bold ${Math.floor(12 * s)}px Arial`;
            ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
            ctx.fillText(count, cx + hb.hbSize/2 - 4, cy + hb.hbSize/2 - 2);
        }
        ctx.fillStyle = COL.textDim;
        ctx.font = `bold ${Math.floor(9 * s)}px Arial`;
        ctx.textAlign = 'left';
        ctx.fillText(i + 1, cx - hb.hbSize/2 + 3, hb.hbY + 11);
    }
}
function renderCrafting() {
    ctx.fillStyle = 'rgba(10,14,8,0.72)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
    let w = getWindowRect();
    drawPanel(w.x, w.y, w.w, w.h);
    ctx.fillStyle = COL.accent; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.floor(w.w * 0.045)}px "Courier New", monospace`;
    ctx.fillText('CRAFTING', GAME_W/2, w.y + w.h * 0.10);
    ctx.fillStyle = COL.textDim; ctx.font = `${Math.floor(w.w * 0.02)}px Arial`;
    ctx.fillText('Tap a recipe to craft · stays open · press C or ✕ to close', GAME_W/2, w.y + w.h * 0.155);
    drawCloseBtn();
    getCraftRows().forEach(row => {
        let rec = row.recipe;
        let fill = row.canCraft ? '#2d3a1e' : '#1f2812';
        let bevel = row.canCraft ? '#4a6a28' : '#3a4a1c';
        drawPanel(row.x, row.y, row.w, row.h, fill, bevel);
        drawUIImage('item_' + rec.result.toLowerCase(), row.x + row.h * 0.5, row.y + row.h * 0.5, row.h * 0.78);
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillStyle = COL.text;
        ctx.font = `900 ${Math.floor(w.w * 0.032)}px "Courier New", monospace`;
        ctx.fillText(rec.name, row.x + row.h * 1.1, row.y + row.h * 0.35);
        let costStr = Object.keys(rec.cost).map(r => `${r} ${game.inventory[r]||0}/${rec.cost[r]}`).join('   ');
        ctx.fillStyle = row.canCraft ? COL.good : COL.bad;
        ctx.font = `bold ${Math.floor(w.w * 0.024)}px Arial`;
        ctx.fillText(costStr, row.x + row.h * 1.1, row.y + row.h * 0.72);
        let cbW = Math.min(80, row.h * 1.3), cbH = row.h * 0.7;
        let cbX = row.x + row.w - cbW - 6, cbY = row.y + (row.h - cbH)/2;
        drawPanel(cbX, cbY, cbW, cbH, row.canCraft ? '#3a2a1a' : '#10160a', row.canCraft ? COL.accent : COL.panelShadow);
        ctx.fillStyle = row.canCraft ? COL.accent : COL.textDim;
        ctx.textAlign = 'center';
        ctx.font = `900 ${Math.floor(cbH * 0.4)}px "Courier New", monospace`;
        ctx.fillText(row.canCraft ? 'CRAFT' : 'LOCKED', cbX + cbW/2, cbY + cbH * 0.5);
    });
    ctx.textBaseline = 'alphabetic';
}
function renderInventory() {
    ctx.fillStyle = 'rgba(10,14,8,0.72)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
    let w = getWindowRect();
    drawPanel(w.x, w.y, w.w, w.h);
    ctx.fillStyle = COL.accent; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.floor(w.w * 0.045)}px "Courier New", monospace`;
    ctx.fillText('INVENTORY', GAME_W/2, w.y + w.h * 0.10);
    ctx.fillStyle = COL.textDim; ctx.font = `${Math.floor(w.w * 0.02)}px Arial`;
    ctx.fillText('Materials & tools · press E or ✕ to close', GAME_W/2, w.y + w.h * 0.155);
    drawCloseBtn();
    let s = getButtons().scale;
    getInvSlots().forEach(slot => {
        let cx = slot.x + slot.w / 2, cy = slot.y + slot.w / 2;
        let size = Math.min(slot.w, slot.h) * 0.86;
        drawSlot(cx, cy, size);
        let name = slot.name;
        if ((game.inventory[name] || 0) > 0 || ['Wood','Stone','Metal','Fiber'].includes(name)) drawUIImage('item_' + name.toLowerCase(), cx, cy, size * 0.66);
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
    ctx.moveTo(b.x + b.w*0.28, b.y + b.h*0.28); ctx.lineTo(b.x + b.w*0.72, b.y + b.h*0.72);
    ctx.moveTo(b.x + b.w*0.72, b.y + b.h*0.28); ctx.lineTo(b.x + b.w*0.28, b.y + b.h*0.72);
    ctx.stroke();
}
function renderDialogue() {
    let s = getButtons().scale;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, GAME_W, GAME_H);
    let boxW = Math.min(GAME_W * 0.9, 600), boxH = 160;
    let boxX = (GAME_W - boxW) / 2, boxY = GAME_H - boxH - 50;
    drawPanel(boxX, boxY, boxW, boxH);
    ctx.fillStyle = COL.accent; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = `bold ${Math.floor(18 * s)}px Arial`;
    ctx.fillText(game.dialogue.speaker + ":", boxX + 24, boxY + 20);
    ctx.fillStyle = COL.text; ctx.font = `${Math.floor(15 * s)}px Arial`;
    let words = game.dialogue.text.split(' '), line = '', y = boxY + 52;
    for (let i = 0; i < words.length; i++) {
        let testLine = line + words[i] + ' ';
        if (ctx.measureText(testLine).width > boxW - 48 && i > 0) { ctx.fillText(line, boxX + 24, y); line = words[i] + ' '; y += 22; }
        else { line = testLine; }
    }
    ctx.fillText(line, boxX + 24, y);
    ctx.textAlign = 'center'; ctx.fillStyle = COL.textDim;
    ctx.font = `bold ${Math.floor(12 * s)}px Arial`;
    ctx.fillText("[ Tap to Continue ]", GAME_W/2, boxY + boxH - 24);
    ctx.textBaseline = 'alphabetic';
}

// ---------------------------------------------------------------------------
//  Isometric loading screen
// ---------------------------------------------------------------------------
const tips = [
    "Tip: You can mine bare-handed, but tools are faster.",
    "Tip: Place Campfires and Torches to light up the night.",
    "Tip: The Spirit of Nature waits near your spawn.",
    "Tip: The world is endless — forests, mountains, lakes await.",
    "Tip: Mountains hold Stone, Metal, and ruins.",
    "Tip: Press C to craft, E for inventory, M to mute."
];
let currentTip = tips[Math.floor(Math.random() * tips.length)];
let particles = [];
for (let i = 0; i < 50; i++) particles.push({ x: Math.random()*GAME_W, y: Math.random()*GAME_H, vy: -0.5 - Math.random(), size: 1 + Math.random()*2, alpha: Math.random()*0.5 });
function renderLoadingScreen(frameCount) {
    let sky = skyColors(0.4);
    let g = ctx.createLinearGradient(0, 0, 0, GAME_H);
    g.addColorStop(0, `rgb(${sky.top[0]|0},${sky.top[1]|0},${sky.top[2]|0})`);
    g.addColorStop(1, `rgb(${sky.hor[0]|0},${sky.hor[1]|0},${sky.hor[2]|0})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, GAME_W, GAME_H);
    particles.forEach(pt => { pt.y += pt.vy; if (pt.y < 0) { pt.y = GAME_H; pt.x = Math.random()*GAME_W; } ctx.fillStyle = `rgba(162,209,91,${pt.alpha})`; ctx.fillRect(pt.x, pt.y, pt.size, pt.size); });
    let cx = GAME_W / 2, cy = GAME_H / 2 - 40, w = 80, h = 40;
    let activeTile = Math.floor(frameCount / 30) % 4;
    const tiles = [
        { gx: 0, gy: 0, color: '#4a5d23', name: 'Meadow' },
        { gx: 1, gy: 0, color: '#3e5a1e', name: 'Forest' },
        { gx: 1, gy: 1, color: '#7a7268', name: 'Mountain' },
        { gx: 0, gy: 1, color: '#2d506e', name: 'Lake' }
    ];
    tiles.forEach((tile, i) => {
        let isoX = cx + (tile.gx - tile.gy) * (w/2), isoY = cy + (tile.gx + tile.gy) * (h/2);
        ctx.beginPath(); ctx.moveTo(isoX, isoY); ctx.lineTo(isoX + w/2, isoY + h/2); ctx.lineTo(isoX, isoY + h); ctx.lineTo(isoX - w/2, isoY + h/2); ctx.closePath();
        ctx.fillStyle = tile.color; ctx.fill();
        if (i === activeTile) { ctx.strokeStyle = COL.accent; ctx.lineWidth = 3; ctx.stroke(); ctx.fillStyle = COL.text; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center'; ctx.fillText(tile.name, isoX, isoY - 10); }
    });
    ctx.fillStyle = COL.text; ctx.font = 'bold 24px "Courier New", monospace'; ctx.textAlign = 'center';
    ctx.fillText('LOADING...', GAME_W / 2, cy + h * 2 + 30);
    ctx.fillStyle = COL.textDim; ctx.font = '16px Arial';
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
function loadingLoop() { loadingFrame++; renderLoadingScreen(loadingFrame); requestAnimationFrame(loadingLoop); }
loadingLoop();
loadAssets().then(() => { lastTime = performance.now(); requestAnimationFrame(loop); });
