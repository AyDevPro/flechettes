# Fléchettes

Application web (PWA) pour gérer des parties de **301 / 501** entre amis :
les joueurs saisissent leurs fléchettes sur leur téléphone, la télévision
affiche le tableau des scores, et tout est synchronisé en temps réel.

```
Téléphones ──WebSocket──▶  serveur Node  ──WebSocket──▶  Télévision
   (saisie)                (moteur de jeu)                (affichage)
                                  │
                           /data/game.json
                  (partie en cours + journal des fléchettes)
```

L'application gère **une seule partie à la fois** : deux adresses suffisent.

| Adresse | Pour qui |
|---|---|
| `/` | les téléphones : création de la partie, puis saisie des fléchettes |
| `/tv` | la télévision : tableau d'affichage seul |

- **Production** : <https://flechettes.aydev.app> — TV sur <https://flechettes.aydev.app/tv>
- **Stack** : Node 22 + TypeScript, Express, `ws`. Front en HTML/CSS/JS natif
  (aucun framework, aucun bundler). **Aucune base de données** : la partie est
  recopiée dans un fichier JSON après chaque fléchette.

---

## 1. Utilisation

1. La télévision ouvre **`/tv`** et y affiche en permanence l'adresse et un QR code.
2. Un téléphone ouvre **`/`**, choisit le **type de partie** (301 ou 501), la
   **règle d'entrée**, la **règle de sortie**, le **niveau des conseils**, ajoute
   les joueurs et lance la partie.
3. Les autres téléphones ouvrent la même adresse (scan du QR) : ils tombent
   directement sur la partie en cours et choisissent leur joueur — ou le mode
   « téléphone partagé » pour saisir les fléchettes de tout le monde.
4. On saisit **chaque fléchette** : multiplicateur (simple / double / triple) puis
   le numéro, ou l'un des raccourcis (T20, T19, T18, D20, D16, BULL), plus les
   boutons `25`, `BULL 50` et `RATÉ`.
5. Le bouton **Terminer** (en haut à droite, disponible à tout moment) fige le
   classement ; **Nouvelle partie** libère la place pour la suivante.

Le score, les Busts, le passage au joueur suivant, le classement et les conseils
de checkout sont calculés par le serveur et poussés à tous les appareils.

### Règles disponibles

| Entrée | Effet |
|---|---|
| **Straight In** | on marque dès la première fléchette |
| **Double In** | rien ne compte tant qu'un double n'a pas été touché ; la fléchette du Double In compte normalement |

| Sortie | Dernière fléchette autorisée |
|---|---|
| **Straight Out** | n'importe quelle zone |
| **Double Out** | un double — le bull 50 compte comme un double 25 |
| **Master Out** | un double ou un triple |
| **Triple Out** | un triple uniquement |

**Bust** : dépassement du score, reste impossible à terminer (par exemple 1 en
Double Out, 1 ou 2 en Triple Out) ou sortie non conforme. Le joueur revient au
score qu'il avait au début du tour et la main passe.

Un joueur qui atteint zéro prend sa place au classement et sort de la rotation ;
la partie continue entre les autres. Elle s'arrête dès qu'il ne reste qu'un
joueur en lice — celui-ci prend la dernière place.

Tous les téléphones disposent des mêmes commandes : **Annuler** (autant de
fléchettes que nécessaire, y compris un Bust, une victoire ou un changement de
joueur), **Passer le tour**, **Pause**, **retirer un joueur** et **Terminer**.

---

## 2. Le moteur

Tout le calcul vit dans `server/src/engine/`, sans dépendance au réseau ni à la
base — ce qui le rend directement testable (`npm test`, 28 tests).

| Fichier | Rôle |
|---|---|
| `board.ts` | les 62 zones marquables (`S1..S20`, `D1..D20`, `T1..T20`, `S25`, `D25`) + le raté |
| `rules.ts` | entrée, sortie, Busts, plus haut score sortable |
| `classic.ts` | table des checkouts classiques en Double Out (2 → 170) |
| `checkout.ts` | recherche des routes, classement, recommandations |

### Recommandations

À chaque fléchette, le serveur recalcule un conseil pour le joueur actif :

- **entrée** (`D20`) tant que le Double In n'est pas passé ;
- **checkout** dès que le score est sortable avec les fléchettes restantes ;
- **préparation** sinon : quoi viser pour laisser le meilleur score possible.

Exemple de préparation, à 301 : aucune sortie n'existe (le maximum en trois
fléchettes est 170), le moteur propose donc `T20 → T20 → T19` — *« laisse 124,
sortable au prochain tour »*. La dernière fléchette est choisie pour tomber sur
un reste confortable (124 se sort en `T20 → T16 → D8`) plutôt que pour marquer
le maximum : trois T20 laisseraient 121, légèrement moins bon.

Les routes sont classées par un coût qui mélange le nombre de fléchettes, la
difficulté des cibles, la qualité du double final (un D16 manqué laisse 16, donc
D8, D4, D2…), la souplesse du reste et les conséquences d'un lancer manqué. En
Double Out, les niveaux Standard et Expert utilisent d'abord la table des routes
classiques.

Trois niveaux, qui ne changent **jamais** les règles :

| Niveau | Comportement |
|---|---|
| **Débutant** | évite les triples quand un chemin simple existe, préfère les grands segments et les doubles rattrapables (52 → `20 → D16`) |
| **Standard** | routes de checkout classiques (100 → `T20 → D20`, 141 → `T20 → T19 → D12`) |
| **Expert** | routes optimisées, marge sur le reste laissé après un lancer manqué |

Exemple de recalcul dynamique (Standard, Double Out) :

```
100, 3 fléchettes  →  T20 → D20
 80, 2 fléchettes  →  T20 → D10        (le T20 est passé à côté)
 32, 1 fléchette   →  D16
```

---

## 3. Développement

```bash
npm run install:server                   # installe les dépendances du serveur
STATE_FILE=./.data/game.json npm run dev # http://localhost:3000
npm test                                 # tests du moteur et de la machine à états
npm run typecheck
```

`STATE_FILE` indique où sauvegarder la partie (par défaut `/data/game.json`, le
volume du conteneur). Pour lancer l'image de production en local :

```bash
docker compose -f docker-compose.dev.yml up --build
```

Les icônes PNG de la PWA sont générées (sans dépendance) par `npm run icons`.

### Organisation

```
server/src/
  index.ts        Express + WebSocket + fichiers statiques
  game.ts         machine à états d'une partie (tours, Busts, classement, Undo)
  store.ts        la partie courante + sauvegarde JSON atomique
  hub.ts          diffusion WebSocket à tous les appareils
  engine/         moteur pur (cf. §2)
web/
  index.html      création + saisie mobile    js/app.js
  tv.html         tableau d'affichage TV      js/tv.js
  sw.js           service worker (PWA)
```

### API

| Route | Description |
|---|---|
| `GET /health` | sonde du healthcheck Docker |
| `GET /api/options` | valeurs acceptées (scores, règles, niveaux, cibles) |
| `GET /api/game` | état courant, ou `{ view: null }` |
| `POST /api/game` | crée la partie (409 si une partie tourne déjà, sauf `replace: true`) |
| `DELETE /api/game` | efface la partie et libère la place |
| `GET /api/qr?text=…` | QR code SVG |
| `WS /ws?role=tv\|phone&playerId=…` | flux temps réel |

Messages WebSocket montants : `throw` (`{ code: 'T20' }`), `undo`, `skip`,
`pause`, `remove`, `end`, `claim`. Le serveur répond `welcome`, `state` (vue
complète, `null` s'il n'y a pas de partie) ou `error`.

### Persistance

L'état complet de la partie est réécrit dans `STATE_FILE` (écriture atomique :
fichier temporaire puis renommage) après chaque action : elle survit à une
actualisation de page, à une déconnexion, au redémarrage du conteneur. Ce même
état contient le journal de **chaque fléchette** (joueur, tour, cible, score
avant/après) — la matière première des statistiques à venir (moyennes,
100+/140+/180, pourcentage de doubles, meilleur checkout).

---

## 4. Déploiement

Push sur `main` → GitHub Actions → SSH sur le VPS → `docker compose up -d --build`.
Voir [DEPLOY-VPS.md](DEPLOY-VPS.md) pour la première mise en ligne.

---

## 5. Suite possible

L'architecture (moteur pur, état sérialisable, journal des fléchettes) est prête
pour : Cricket et Around the Clock, parties en équipes, comptes joueurs et
statistiques, historique, tournois, mode entraînement, sons et thèmes TV.
Plusieurs parties simultanées redeviendraient possibles en remplaçant `store.ts`
par un registre indexé (et, à ce moment-là seulement, par une base).
