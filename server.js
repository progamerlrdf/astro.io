// Serveur Astro.io : sert le jeu (index.html) et gère le multijoueur (WebSocket) sur le même port
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const https = require('https');

// ===== Modération =====
// MOD_UIDS et BANNED_UIDS sont des variables d'environnement sur Render (identifiants Firebase séparés par des virgules)
const FB_PROJECT = 'astroio';
const MOD_UIDS = (process.env.MOD_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const bannedUids = new Set((process.env.BANNED_UIDS || '').split(',').map(s => s.trim()).filter(Boolean));
let certCache = { at: 0, certs: null };

function getCerts() {
  return new Promise((resolve, reject) => {
    if (certCache.certs && Date.now() - certCache.at < 3600000) return resolve(certCache.certs);
    https.get('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com', res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try { certCache = { at: Date.now(), certs: JSON.parse(d) }; resolve(certCache.certs); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Vérifie le jeton Firebase et renvoie l'identifiant du compte (ou null)
async function verifyToken(token) {
  try {
    const [h, pl, sg] = token.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(pl, 'base64url').toString());
    const certs = await getCerts();
    const cert = certs[header.kid];
    if (!cert || header.alg !== 'RS256') return null;
    const ok = crypto.createVerify('RSA-SHA256').update(h + '.' + pl).verify(cert, Buffer.from(sg, 'base64url'));
    if (!ok) return null;
    const now = Math.floor(Date.now() / 1000);
    if (payload.aud !== FB_PROJECT || payload.iss !== 'https://securetoken.google.com/' + FB_PROJECT) return null;
    if (payload.exp < now || payload.iat > now + 300) return null;
    return payload.sub || null;
  } catch (e) {
    return null;
  }
}

const PORT = process.env.PORT || 8080;
const MAX_SIZE = 3 * 1024 * 1024; // taille maximale d'une requête ou d'un message : 3 Mo

// Serveur HTTP : renvoie le jeu à l'adresse principale
const server = http.createServer((req, res) => {
  // Requête trop grosse : refusée avant tout traitement
  if (Number(req.headers['content-length'] || 0) > MAX_SIZE) {
    res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8', 'Connection': 'close' });
    return res.end('Requête trop volumineuse');
  }
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('index.html introuvable sur le serveur');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else if (req.url === '/confidentialite.html') {
    fs.readFile(path.join(__dirname, 'confidentialite.html'), (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Page introuvable');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

// WebSocket attaché au même serveur HTTP
const wss = new WebSocketServer({ server, maxPayload: MAX_SIZE }); // message WebSocket trop grand : connexion fermée
const players = new Map(); // id -> { ws, x, y, a, name, hp, last }
let nextId = 1;
const WORLD_SEED = (Date.now() % 4294967296) >>> 0; // graine commune des astéroïdes
const destroyed = new Set(); // astéroïdes déjà détruits
const CHAT_KEEP = 30 * 60 * 1000; // les messages du chat sont conservés 30 minutes
const chatLog = []; // { t, msg }
function purgeChat() {
  const cut = Date.now() - CHAT_KEEP;
  while (chatLog.length && chatLog[0].t < cut) chatLog.shift();
}
setInterval(purgeChat, 60000);
const astDmg = new Map(); // dégâts déjà subis par chaque astéroïde (uid -> total)

// Filtre de secours côté serveur (le filtre principal est dans le jeu)
const BAD = ['fuck','shit','putain','merde','connard','salope','pute','nazi','hitler','tiktok','discord','instagram','youtube','snapchat','onlyfans'];
function clean(t) { return String(t || '').replace(/[\u0000-\u001f\u007f]/g, '').trim(); }
function chatOk(t) {
  if (!t || t.length > 120) return false;
  if (/https?:|www\.|@|\.(com|fr|net|gg|tv)\b/i.test(t)) return false;
  const n = t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
  return !BAD.some(b => n.includes(b));
}
function cleanName(n) { const c = clean(n).slice(0, 10); return c || null; }

wss.on('connection', ws => {
  const id = nextId++;
  const p = { ws, uid: null, isMod: false, x: 7000, y: 7000, a: 0, name: 'Pilote' + id, hp: 100, maxHp: 100, def: 0, type: 'A', lvl: 1, dead: false, last: 0, sh: 0, maxSh: 0, shT: 0, dmA: 0, bp: {}, pendingBreaks: [], runKills: 0 };
  players.set(id, p);
  ws.send(JSON.stringify({ type: 'welcome', id, seed: WORLD_SEED, destroyed: [...destroyed], dmg: [...astDmg] }));
  purgeChat();
  ws.send(JSON.stringify({ type: 'chatHistory', list: chatLog.map(x => x.msg) }));

  ws.on('error', () => {}); // évite un crash si une connexion coupe brutalement

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'hello') {
      const n = cleanName(msg.name);
      if (n) p.name = n;
      if (typeof msg.token === 'string') {
        verifyToken(msg.token).then(uid => {
          if (!uid) return;
          if (bannedUids.has(uid)) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'banned' }));
            ws.close();
            return;
          }
          p.uid = uid;
          p.isMod = MOD_UIDS.includes(uid);
          if (p.isMod && ws.readyState === 1) ws.send(JSON.stringify({ type: 'mod' }));
        });
      }
    }
    else if (msg.type === 'modlist' && p.isMod) {
      const list = [...players].map(([id, q]) => ({ id, name: q.name, mod: q.isMod }));
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'modlist', list }));
    }
    else if (msg.type === 'ban' && p.isMod) {
      const target = players.get(msg.target);
      if (!target || target === p || target.isMod) return;
      if (target.uid) bannedUids.add(target.uid); // invité : simple expulsion
      if (target.ws.readyState === 1) target.ws.send(JSON.stringify({ type: 'banned' }));
      setTimeout(() => target.ws.close(), 200);
    }
    else if (msg.type === 'input') {
      if (p.dead) return;
      if (typeof msg.tp === 'string') p.type = msg.tp;
      if (typeof msg.lv === 'number') p.lvl = Math.max(1, Math.min(60, msg.lv));
      if (typeof msg.x === 'number') p.x = msg.x;
      if (typeof msg.y === 'number') p.y = msg.y;
      if (typeof msg.a === 'number') p.a = msg.a;
      if (typeof msg.mh === 'number') p.maxHp = Math.max(50, Math.min(600, msg.mh));
      if (typeof msg.df === 'number') p.def = Math.max(0, Math.min(10, msg.df));
      if (typeof msg.mxs === 'number') p.maxSh = Math.max(0, Math.min(300, msg.mxs));
      if (msg.bp && typeof msg.bp === 'object') {
        for (const k of Object.keys(msg.bp)) {
          if (msg.bp[k] && !p.bp[k] && p.pendingBreaks.length > 0) { p.bp[k] = true; p.pendingBreaks.shift(); }
        }
      }
    }
    else if (msg.type === 'fire') {
      if (p.dead) return;
      const now = Date.now();
      p.fires = (p.fires || []).filter(x => now - x < 1000);
      if (p.fires.length >= 20) return; // trop de tirs : ignoré
      p.fires.push(now);
      const out = JSON.stringify({ type: 'fire', x: msg.x, y: msg.y, vx: msg.vx, vy: msg.vy, c: msg.c, ch: msg.ch });
      players.forEach((q, qid) => { if (qid !== id && q.ws.readyState === 1) q.ws.send(out); });
    }
    else if (msg.type === 'hit') {
      if (p.dead) return;
      const now = Date.now();
      p.hits = (p.hits || []).filter(x => now - x < 1000);
      if (p.hits.length >= 15) return; // trop de coups par seconde : ignoré
      p.hits.push(now);
      const target = players.get(msg.target);
      const dmg = Math.min(300, Math.max(0, Number(msg.dmg) || 0));
      if (!target || target === p || target.dead || dmg <= 0) return;
      // Le point d'impact doit être proche de la position connue de la cible
      if (typeof msg.x === 'number' && typeof msg.y === 'number' &&
          Math.hypot(msg.x - target.x, msg.y - target.y) > 150) return;
      // Portée maximale : impossible de toucher quelqu'un à l'autre bout de la carte
      if (Math.hypot(p.x - target.x, p.y - target.y) > 2500) return;
      // Vie critique (10 % ou moins) : la défense est multipliée par 3
      const defEff = target.def * (target.hp <= target.maxHp * 0.1 ? 3 : 1);
      const dd = dmg / (1 + 0.15 * defEff);
      if (target.ws.readyState === 1) target.ws.send(JSON.stringify({ type: 'hurt', dmg: Math.round(dd) }));
      let rest = dd;
      const ab = Math.min(target.sh, rest);
      target.sh -= ab; rest -= ab;
      target.shT = 0;
      target.hp -= rest;
      target.dmA += rest;
      if (target.dmA > target.maxHp * 0.3 && target.hp > 0) {
        target.dmA = 0;
        // La partie cassée dépend de l'endroit où le tir a touché
        const imp = (typeof msg.x === 'number' && typeof msg.y === 'number') ? { x: msg.x, y: msg.y } : { x: target.x, y: target.y };
        target.pendingBreaks.push(imp);
        if (target.ws.readyState === 1) target.ws.send(JSON.stringify({ type: 'break', x: imp.x, y: imp.y }));
      }
      if (target.hp <= 0 && !target.dead) {
        target.hp = 0; target.dead = true;
        p.runKills++;
        if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ type: 'kill' }));
      }
    }
    else if (msg.type === 'respawn') {
      if (p.dead) { p.dead = false; p.hp = p.maxHp; p.sh = p.maxSh; p.dmA = 0; p.pendingBreaks = []; p.bp = {}; p.runKills = 0; }
    }
    else if (msg.type === 'mat') {
      if (p.dead) return;
      const broken = Object.keys(p.bp).filter(k => p.bp[k]);
      if (broken.length) {
        p.bp[broken[Math.floor(Math.random() * broken.length)]] = false;
      } else {
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.25);
      }
    }
    else if (msg.type === 'adestroy') {
      if (typeof msg.uid !== 'number' || destroyed.has(msg.uid)) return;
      destroyed.add(msg.uid);
      astDmg.delete(msg.uid);
      const out = JSON.stringify({ type: 'adestroy', uid: msg.uid });
      wss.clients.forEach(c => { if (c.readyState === 1) c.send(out); });
    }
    else if (msg.type === 'ahit') {
      if (typeof msg.uid !== 'number' || destroyed.has(msg.uid)) return;
      const dmg = Math.min(500, Math.max(0, Number(msg.dmg) || 0));
      astDmg.set(msg.uid, (astDmg.get(msg.uid) || 0) + dmg);
      const out = JSON.stringify({ type: 'ahit', uid: msg.uid, dmg });
      wss.clients.forEach(c => { if (c !== ws && c.readyState === 1) c.send(out); });
    }
    else if (msg.type === 'chat') {
      const now = Date.now();
      if (now - p.last < 1200) return; // anti-spam : 1 message toutes les 1,2 s
      const text = clean(msg.text).slice(0, 120);
      if (!chatOk(text)) {
        if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ type: 'chatBlocked' }));
        return;
      }
      p.last = now;
      const msgObj = { type: 'chat', id, name: p.name, text };
      chatLog.push({ t: now, msg: msgObj });
      purgeChat();
      const out = JSON.stringify(msgObj);
      players.forEach(q => { if (q.ws.readyState === 1) q.ws.send(out); });
    }
  });

  ws.on('close', () => players.delete(id));
});

// Régénération de la vie, côté serveur
setInterval(() => {
  players.forEach(q => {
    if (q.dead) return;
    if (q.hp < q.maxHp) q.hp = Math.min(q.maxHp, q.hp + 0.12);
    q.shT += 3;
    if (q.shT > 240 && q.sh < q.maxSh) q.sh = Math.min(q.maxSh, q.sh + 1.8);
  });
}, 50);

// 20 fois par seconde : état de tous les joueurs
setInterval(() => {
  const list = [...players].map(([id, q]) => [id, { x: q.x, y: q.y, a: q.a, name: q.name, hp: q.hp, sh: Math.round(q.sh), bp: q.bp || null, dead: q.dead, tp: q.type, lv: q.lvl }]);
  const snapshot = JSON.stringify({ type: 'state', players: list });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(snapshot); });
}, 50);

server.listen(PORT, () => console.log('Serveur lancé sur le port ' + PORT));
