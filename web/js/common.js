/* Utilitaires partagés : DOM, API, WebSocket auto-reconnectant, stockage local. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

let toastTimer;
export function toast(message, bad = false) {
  const node = $('#toast');
  if (!node) return;
  node.textContent = message;
  node.classList.toggle('bad', bad);
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2600);
}

export const store = {
  get: (key) => { try { return localStorage.getItem(`flechettes:${key}`); } catch { return null; } },
  set: (key, value) => { try { localStorage.setItem(`flechettes:${key}`, value); } catch { /* mode privé */ } },
  del: (key) => { try { localStorage.removeItem(`flechettes:${key}`); } catch { /* mode privé */ } },
};

/**
 * Connexion WebSocket au serveur, avec reconnexion automatique.
 * `onState` reçoit la vue complète de la partie — ou `null` s'il n'y en a pas.
 */
export function connect({ role, playerId, onState, onOpen, onClose, onError, onWelcome }) {
  let socket = null;
  let attempt = 0;
  let closed = false;

  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const params = new URLSearchParams({ role });
    if (playerId) params.set('playerId', playerId);
    socket = new WebSocket(`${proto}://${location.host}/ws?${params}`);

    socket.addEventListener('open', () => { attempt = 0; onOpen?.(); });
    socket.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'state') onState?.(msg.view, msg.presence);
      else if (msg.type === 'error') onError?.(msg.message);
      else if (msg.type === 'welcome') onWelcome?.(msg);
    });
    socket.addEventListener('close', () => {
      onClose?.();
      if (closed) return;
      attempt += 1;
      setTimeout(open, Math.min(500 * attempt, 4000));
    });
    socket.addEventListener('error', () => socket?.close());
  };

  open();

  // Reconnexion immédiate au retour de veille / d'onglet.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && socket && socket.readyState > 1) open();
  });

  return {
    send(payload) {
      if (socket && socket.readyState === 1) socket.send(JSON.stringify(payload));
      else toast('Connexion perdue, reconnexion…', true);
    },
    setPlayer(id) { playerId = id; },
    close() { closed = true; socket?.close(); },
  };
}

export function registerSW() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* sans importance */ });
  }
}

export function buzz(ms = 12) {
  try { navigator.vibrate?.(ms); } catch { /* non supporté */ }
}

export const RULE_LABELS = {
  in: { straight: 'Straight In', double: 'Double In' },
  out: { straight: 'Straight Out', double: 'Double Out', master: 'Master Out', triple: 'Triple Out' },
  level: { beginner: 'Débutant', standard: 'Standard', expert: 'Expert' },
};

/** Charge le QR code SVG d'une URL dans un conteneur. */
export async function loadQr(container, url) {
  try {
    const res = await fetch(`/api/qr?text=${encodeURIComponent(url)}`);
    if (!res.ok) return;
    container.innerHTML = await res.text();
  } catch { /* le code reste lisible à l'écran */ }
}
