# Prototype de l'hôte isolé (P3-02)

Prototype mesuré, **hors de Mire** : rien ici n'est construit dans `dist/`, embarqué par l'installateur ni importé par
`src/`. Résultats, choix et conséquences : `docs/adr/0002-hote-isole.md`.

## Relancer

```sh
npm ci && node node_modules/electron/install.js        # moteur Electron (une fois)
xvfb-run -a -s "-screen 0 1920x1080x24" npx electron spikes/hote-isole/main.mjs
```

- Sous Windows ou macOS : `npx electron spikes/hote-isole/main.mjs`.
- En root (conteneur), Electron exige `--no-sandbox` après `npx electron` : la sandbox du système est alors coupée,
  le rapport le signale.
- Options : `--repetitions=10`, `--elements=20000`, `--lot=500`, `--seulement=mesures` ou `--seulement=verifications`,
  `--sortie=<fichier.json>` (résultats bruts).
- Code de sortie : 0 si le prototype A (retenu) passe toutes les vérifications, 1 sinon, 2 en cas d'erreur.
- Durée : environ 3 min 20 s avec les options par défaut (4 cœurs).

Vérifier le plugin d'essai :

```sh
node packages/plugin-sdk/src/cli.ts validate spikes/hote-isole/plugins/essai
npx tsc -p spikes/hote-isole/tsconfig.json
```

## Contenu

| Fichier | Rôle |
| --- | --- |
| `main.mjs` | Processus principal : crée les hôtes, sert `mire-plugin://`, mesure, vérifie, écrit le rapport |
| `canal.mjs` | Requêtes, réponses, délais, annulation et événements sur un `MessagePort` (les deux côtés) |
| `runtime.mjs` | Runtime de l'hôte, le même dans A et B : charge les contributions, relaie le contexte |
| `hote-a/` | Hôte A : page cachée (`index.html`, `hote-a.mjs`), Worker des plugins (`travailleur.mjs`), preload |
| `hote-b.mjs` | Hôte B : entrée de l'`utilityProcess` |
| `plugins/essai/` | Plugin d'essai (niveau `code`, valide) : tag automatique et infos en ligne factices |
| `plugins/sonde/` | Essaie depuis le plugin tout ce qui doit être refusé (fichiers, réseau, fenêtre, processus) |
| `plugins/boucle/`, `plugins/memoire/` | Plugins fautifs : boucle sans fin, mémoire épuisée |

Les plugins sont copiés à chaque lancement dans un dossier temporaire (comme `userData/plugins/<id>/`), avec un
fichier secret à côté et un lien symbolique vers lui dans la sonde ; le dossier est supprimé à la fin.
