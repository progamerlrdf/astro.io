// Serveur Astro.io : sert le jeu (index.html) et gère le multijoueur (WebSocket) sur le même port
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;

// Serveur HTTP : renvoie le jeu à l'adresse principale
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('index.html introuvable sur le serveur');
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
const wss = new WebSocketServer({ server });
const players = new Map(); // id -> { ws, x, y, a, name, hp, last }
let nextId = 1;
const WORLD_SEED = (Date.now() % 4294967296) >>> 0; // graine commune des astéroïdes
const destroyed = new Set(); // astéroïdes déjà détruits

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
  const p = { ws, x: 7000, y: 7000, a: 0, name: 'Pilote' + id, hp: 100, last: 0 };
  players.set(id, p);
  ws.send(JSON.stringify({ type: 'welcome', id, seed: WORLD_SEED, destroyed: [...destroyed] }));

  ws.on('error', () => {}); // évite un crash si une connexion coupe brutalement

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'hello') {
      const n = cleanName(msg.name);
      if (n) p.name = n;
    }
    else if (msg.type === 'input') {
      if (typeof msg.x === 'number') p.x = msg.x;
      if (typeof msg.y === 'number') p.y = msg.y;
      if (typeof msg.a === 'number') p.a = msg.a;
    }
    else if (msg.type === 'fire') {
      const out = JSON.stringify({ type: 'fire', x: msg.x, y: msg.y, vx: msg.vx, vy: msg.vy, c: msg.c });
      players.forEach((q, qid) => { if (qid !== id && q.ws.readyState === 1) q.ws.send(out); });
    }
    else if (msg.type === 'hit') {
      const target = players.get(msg.target);
      const dmg = Math.min(500, Math.max(0, Number(msg.dmg) || 0));
      if (!target || target === p || dmg <= 0) return;
      target.hp -= dmg;
      if (target.ws.readyState === 1) target.ws.send(JSON.stringify({ type: 'hurt', dmg }));
      if (target.hp <= 0) target.hp = 100; // réapparition
    }
    else if (msg.type === 'adestroy') {
      if (typeof msg.uid !== 'number' || destroyed.has(msg.uid)) return;
      destroyed.add(msg.uid);
      const out = JSON.stringify({ type: 'adestroy', uid: msg.uid });
      wss.clients.forEach(c => { if (c.readyState === 1) c.send(out); });
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
      const out = JSON.stringify({ type: 'chat', id, name: p.name, text });
      players.forEach(q => { if (q.ws.readyState === 1) q.ws.send(out); });
    }
  });

  ws.on('close', () => players.delete(id));
});

// 20 fois par seconde : état de tous les joueurs
setInterval(() => {
  const list = [...players].map(([id, q]) => [id, { x: q.x, y: q.y, a: q.a, name: q.name, hp: q.hp }]);
  const snapshot = JSON.stringify({ type: 'state', players: list });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(snapshot); });
}, 50);

server.listen(PORT, () => console.log('Serveur lancé sur le port ' + PORT));
