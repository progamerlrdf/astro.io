// Serveur multijoueur minimal pour Astro.io
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });
const players = new Map();
let nextId = 1;

wss.on('connection', ws => {
  const id = nextId++;
  players.set(id, { x: 7000, y: 7000, a: 0, name: 'Pilote' + id, hp: 100 });
  ws.send(JSON.stringify({ type: 'welcome', id }));

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'input' && players.has(id)) {
      const p = players.get(id);
      if (typeof msg.x === 'number') p.x = msg.x;
      if (typeof msg.y === 'number') p.y = msg.y;
      if (typeof msg.a === 'number') p.a = msg.a;
    }
  });

  ws.on('close', () => players.delete(id));
});

// 20 fois par seconde : envoyer l'état du monde à tous
setInterval(() => {
  const snapshot = JSON.stringify({ type: 'state', players: [...players] });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(snapshot); });
}, 50);

console.log('Serveur lancé sur le port ' + PORT);
