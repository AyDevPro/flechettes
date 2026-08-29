/**
 * Une seule partie à la fois, gardée en mémoire et recopiée dans un fichier JSON
 * (`STATE_FILE`) après chaque action. Une actualisation de page, une coupure de
 * réseau ou un redémarrage du conteneur retrouvent donc la partie en cours —
 * sans base de données.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Game, type CreateOptions } from './game.ts';
import type { GameState } from './types.ts';

const STATE_FILE = process.env.STATE_FILE ?? '/data/game.json';

class Store {
  private game: Game | null = null;

  get current(): Game | null {
    return this.game;
  }

  /** Recharge la partie éventuellement laissée par l'instance précédente. */
  load(): void {
    try {
      const raw = readFileSync(STATE_FILE, 'utf8');
      const state = JSON.parse(raw) as GameState;
      if (state && Array.isArray(state.players)) {
        this.game = new Game(state);
        console.log(`[store] partie restaurée (${state.players.length} joueurs, ${state.status})`);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') console.error('[store] état illisible, on repart de zéro', err);
    }
  }

  create(options: CreateOptions): Game {
    this.game = Game.create(options);
    this.save();
    return this.game;
  }

  /** Termine la partie et libère la place pour la suivante. */
  clear(): void {
    this.game = null;
    this.save();
  }

  /** Écriture atomique : fichier temporaire puis renommage. */
  save(): void {
    try {
      mkdirSync(dirname(STATE_FILE), { recursive: true });
      const tmp = `${STATE_FILE}.tmp`;
      writeFileSync(tmp, this.game ? JSON.stringify(this.game.state) : 'null');
      renameSync(tmp, STATE_FILE);
    } catch (err) {
      console.error('[store] sauvegarde impossible', err);
    }
  }
}

export const store = new Store();
