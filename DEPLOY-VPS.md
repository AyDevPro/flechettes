# Mise en ligne sur le VPS aydev

Application : **flechettes** — <https://flechettes.aydev.app>

## 1. DNS (une seule fois)

```
flechettes.aydev.app.  A     212.47.72.94
flechettes.aydev.app.  AAAA  <IPv6 du VPS>
```

Le certificat Let's Encrypt n'est délivré qu'une fois le nom résolu (challenge
HTTP sur le port 80).

## 2. Secrets GitHub

Repo › Settings › Secrets and variables › Actions — identiques aux autres apps :

| Nom | Valeur |
|---|---|
| `VPS_HOST` | `212.47.72.94` |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | contenu de `/root/.ssh/deploy_key` |

## 3. Premier démarrage (sur le VPS)

```bash
cd /root/aydev
git clone <url-du-repo> flechettes
cd flechettes
cp .env.prod.example .env     # rien de secret : seulement le fuseau horaire
docker compose up -d --build
curl https://flechettes.aydev.app/health
```

Un seul conteneur, aucune base de données : la partie en cours vit dans le
volume Docker `state` (`/data/game.json`).

## 4. Ensuite

Chaque `git push origin main` rejoue les tests puis redéploie tout seul
(pull → build → healthcheck → nettoyage). Les migrations SQL sont appliquées au
démarrage de l'application : aucun geste manuel.

## 5. Exploitation

```bash
docker logs flechettes-app --tail 50 -f              # journaux
docker compose restart app                           # redémarrage (la partie survit)
docker exec flechettes-app cat /data/game.json       # partie en cours
```

## 6. Points de vigilance

- **Aucun port publié** : Traefik tient 80/443. L'app n'utilise que `expose`.
- Les noms de routeur/service Traefik (`flechettes`) doivent rester **uniques**
  sur le VPS.
- Le conteneur est durci (`cap_drop: ALL`, `tmpfs noexec`, `no-new-privileges`,
  `mem_limit`). Le volume `state` appartient à l'utilisateur `node` (créé par le
  Dockerfile) : l'app peut y écrire sans privilège supplémentaire.
- **Une seule partie à la fois** : `POST /api/game` refuse (409) d'écraser une
  partie en cours ; le bouton « Terminer » de l'interface libère la place.
- Le WebSocket passe par Traefik sans configuration particulière ; un ping
  applicatif toutes les 30 s garde les connexions ouvertes.
