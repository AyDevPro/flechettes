/**
 * Diffusion temps réel : tous les appareils connectés suivent la même partie
 * (l'application n'en gère qu'une à la fois), §15.
 */

import type { WebSocket } from 'ws';

export interface Client {
  socket: WebSocket;
  role: 'tv' | 'phone';
  /** Joueur revendiqué par ce téléphone, ou `null` pour un téléphone partagé. */
  playerId: string | null;
}

class Hub {
  private clients = new Set<Client>();

  join(client: Client): void {
    this.clients.add(client);
  }

  leave(client: Client): void {
    this.clients.delete(client);
  }

  broadcast(payload: unknown): void {
    const message = JSON.stringify(payload);
    for (const client of this.clients) {
      if (client.socket.readyState === 1) client.socket.send(message);
    }
  }

  send(client: Client, payload: unknown): void {
    if (client.socket.readyState === 1) client.socket.send(JSON.stringify(payload));
  }

  /** Nombre d'appareils connectés, par rôle. */
  presence(): { tv: number; phones: number } {
    const list = [...this.clients];
    return { tv: list.filter((c) => c.role === 'tv').length, phones: list.filter((c) => c.role === 'phone').length };
  }
}

export const hub = new Hub();
