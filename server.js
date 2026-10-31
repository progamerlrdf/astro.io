// Serveur multijoueur Astro.io (positions, tirs, dégâts)
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });
const players = new Map(); // id -> { ws, x, y, a, name, hp }
let nextId = 1;

wss.on('connection', ws => {
  const id = nextId++;
  const p = { ws, x: 7000, y: 7000, a: 0, name: 'Pilote' + id, hp: 100 };
  players.set(id, p);
  ws.send(JSON.stringify({ type: 'welcome', id }));

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'input') {
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
  });

  ws.on('close', () => players.delete(id));
});

// 20 fois par seconde : état de tous les joueurs
setInterval(() => {
  const list = [...players].map(([id, q]) => [id, { x: q.x, y: q.y, a: q.a, name: q.name, hp: q.hp }]);
  const snapshot = JSON.stringify({ type: 'state', players: list });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(snapshot); });
}, 50);

console.log('Serveur lancé sur le port ' + PORT);
