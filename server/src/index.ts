/**
 * Serveur HTTP + WebSocket de l'application de fléchettes.
 *
 * L'application gère **une seule partie à la fois** : deux adresses suffisent,
 * `/` pour les téléphones (création puis saisie) et `/tv` pour la télévision.
 * L'état vit en mémoire et se recopie dans un fichier JSON — aucune base.
 */

import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import QRCode from 'qrcode';
import { WebSocketServer, type WebSocket } from 'ws';

import { store } from './store.ts';
import { hub, type Client } from './hub.ts';
import { IN_RULES, OUT_RULES, type InRule, type OutRule } from './engine/rules.ts';
import { LEVELS, type Level } from './engine/checkout.ts';
import { MISS, TARGETS } from './engine/board.ts';

const PORT = Number(process.env.PORT ?? 3000);
const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = process.env.WEB_DIR ?? join(HERE, '../../web');
const START_SCORES = [301, 501];

const app = express();
app.set('trust proxy', true); // derrière Traefik (TLS terminé en amont)
app.use(express.json({ limit: '64kb' }));
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

// ── API ─────────────────────────────────────────────────────────────────────

const health = (_req: express.Request, res: express.Response) =>
  res.json({ ok: true, game: store.current ? store.current.state.status : null, uptime: Math.round(process.uptime()) });
app.get('/health', health);
app.get('/api/health', health);

/** Options proposées à l'écran de création. */
app.get('/api/options', (_req, res) => {
  res.json({
    startScores: START_SCORES,
    inRules: IN_RULES,
    outRules: OUT_RULES,
    levels: LEVELS,
    targets: [MISS, ...TARGETS].map((t) => ({ code: t.code, label: t.label, value: t.value })),
  });
});

/** État courant, ou `{ view: null }` s'il n'y a pas de partie. */
app.get('/api/game', (_req, res) => {
  const game = store.current;
  res.json({ view: game ? game.view() : null, presence: hub.presence() });
});

/** Crée la partie. Refuse d'écraser une partie en cours sans `replace: true`. */
app.post('/api/game', (req, res) => {
  const body = req.body ?? {};
  const startScore = Number(body.startScore);
  const inRule = String(body.inRule) as InRule;
  const outRule = String(body.outRule) as OutRule;
  const level = String(body.level) as Level;
  const players: string[] = Array.isArray(body.players)
    ? body.players.map((n: unknown) => String(n ?? '').trim().slice(0, 20)).filter(Boolean)
    : [];

  if (!START_SCORES.includes(startScore)) return res.status(400).json({ error: 'Score de départ invalide' });
  if (!IN_RULES.includes(inRule)) return res.status(400).json({ error: 'Règle d\'entrée invalide' });
  if (!OUT_RULES.includes(outRule)) return res.status(400).json({ error: 'Règle de sortie invalide' });
  if (!LEVELS.includes(level)) return res.status(400).json({ error: 'Niveau de recommandation invalide' });
  if (players.length < 1) return res.status(400).json({ error: 'Ajoutez au moins un joueur' });
  if (players.length > 12) return res.status(400).json({ error: 'Douze joueurs maximum' });

  const running = store.current;
  if (running && running.state.status !== 'finished' && !body.replace) {
    return res.status(409).json({ error: 'Une partie est déjà en cours', view: running.view() });
  }

  const game = store.create({ startScore, inRule, outRule, level, players, shuffle: !!body.shuffle });
  broadcastState();
  res.status(201).json({ view: game.view() });
});

/** Met fin à la partie et libère la place (bouton « Terminer », à tout moment). */
app.delete('/api/game', (_req, res) => {
  store.clear();
  broadcastState();
  res.json({ ok: true });
});

/** QR code (SVG) pointant vers l'application — pour connecter les téléphones. */
app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text ?? '');
  if (!text || text.length > 512) return res.status(400).send('Paramètre `text` manquant');
  try {
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
  } catch {
    res.status(500).send('Erreur QR');
  }
});

// ── Pages ───────────────────────────────────────────────────────────────────

const page = (file: string) => (_req: express.Request, res: express.Response) => res.sendFile(join(WEB_DIR, file));

app.use(express.static(WEB_DIR, { maxAge: 0, etag: true, index: false }));
app.get('/', page('index.html'));
app.get('/tv', page('tv.html'));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Route inconnue' });
  res.status(404).sendFile(join(WEB_DIR, '404.html'));
});

// ── WebSocket ───────────────────────────────────────────────────────────────

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

type Incoming =
  | { type: 'throw'; code: string }
  | { type: 'undo' }
  | { type: 'skip' }
  | { type: 'pause'; paused: boolean }
  | { type: 'remove'; playerId: string }
  | { type: 'end' }
  | { type: 'claim'; playerId: string | null }
  | { type: 'ping' };

function broadcastState(): void {
  const game = store.current;
  hub.broadcast({ type: 'state', view: game ? game.view() : null, presence: hub.presence() });
}

wss.on('connection', (socket: WebSocket, request) => {
  const url = new URL(request.url ?? '/ws', 'http://localhost');
  const client: Client = {
    socket,
    role: url.searchParams.get('role') === 'tv' ? 'tv' : 'phone',
    playerId: url.searchParams.get('playerId') || null,
  };
  hub.join(client);
  hub.send(client, { type: 'welcome', playerId: client.playerId });
  broadcastState();

  // Garde-fou : une saisie humaine dépasse rarement quelques messages par seconde.
  let budget = 20;
  const refill = setInterval(() => { budget = 20; }, 1000);

  socket.on('message', (raw) => {
    let msg: Incoming;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (budget-- <= 0) return;

    const deny = (message: string) => hub.send(client, { type: 'error', message });

    if (msg.type === 'ping') return hub.send(client, { type: 'pong' });

    if (msg.type === 'claim') {
      client.playerId = msg.playerId || null;
      hub.send(client, { type: 'welcome', playerId: client.playerId });
      return broadcastState();
    }

    const game = store.current;
    if (!game) return deny('Aucune partie en cours');
    if (client.role === 'tv') return deny('La TV ne modifie pas la partie');

    switch (msg.type) {
      case 'throw': {
        if (client.playerId && client.playerId !== game.state.currentPlayerId) return deny('Ce n\'est pas votre tour');
        const result = game.applyDart(String(msg.code));
        if (!result.ok) return deny(result.error);
        break;
      }
      case 'undo':
        if (!game.undo()) return deny('Rien à annuler');
        break;
      case 'skip':
        if (!game.skipTurn()) return deny('Impossible de passer le tour');
        break;
      case 'pause':
        game.setPaused(!!msg.paused);
        break;
      case 'remove':
        if (!game.removePlayer(String(msg.playerId))) return deny('Joueur introuvable');
        break;
      case 'end':
        game.endGame();
        break;
      default:
        return;
    }

    broadcastState();
    store.save();
  });

  socket.on('close', () => {
    clearInterval(refill);
    hub.leave(client);
    broadcastState();
  });
  socket.on('error', () => {
    clearInterval(refill);
    hub.leave(client);
  });
});

// Ping applicatif : évite que Traefik ferme les connexions inactives.
const keepAlive = setInterval(() => {
  for (const ws of wss.clients) if (ws.readyState === 1) ws.ping();
}, 30_000);

// ── Démarrage ───────────────────────────────────────────────────────────────

store.load();
server.listen(PORT, '0.0.0.0', () => console.log(`[flechettes] écoute sur http://0.0.0.0:${PORT}`));

function shutdown(signal: string): void {
  console.log(`[flechettes] arrêt (${signal})`);
  clearInterval(keepAlive);
  store.save();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
