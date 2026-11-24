# Assistant du premier lancement (P4-23)

Au premier lancement, Mire pose quelques questions, puis installe les plugins qui correspondent aux réponses
(D-14, D-19, D-20). Tout se change ensuite dans le Centre (onglet Plugins) ; l'assistant se relance depuis les
Réglages (« Assistant de démarrage »).

## Quand il s'ouvre

- **Premier lancement** : la configuration (`config.json`) n'existe pas encore au démarrage. Mire crée alors
  `userData/assistant.json` (`{ "pending": true }`) et ouvre l'assistant en fin de démarrage.
- Il se rouvre aux lancements suivants tant qu'il n'est ni terminé ni passé (Mire quitté en plein assistant).
- **Installation existante** (configuration déjà là, pas de fichier `assistant.json`) : jamais, sauf si on le relance
  depuis les Réglages.
- Il ne s'ouvre pas par-dessus le mode secours, ni quand Mire a été lancé pour ouvrir des fichiers.

Code : `src/main/app/assistant.ts` (processus principal, méthodes IPC `assistantState` et `assistantFinish`, sans
argument) ; `src/renderer/assistant/` (logique sans DOM et page) ; contrôleur `mire-assistant`
(`src/renderer/controllers/assistant.ts`) ; composants `mire-assistant` et `mire-assistant-view` (`packages/ui`).

## Les étapes

1. **Bienvenue** : « Commencer » lit la liste des plugins en ligne (`reposRefresh`, première lecture des dépôts sans
   que l'utilisateur ait ouvert le Centre). Sans connexion, le dernier index gardé en cache sert ; sans cache,
   l'assistant le dit et continue. « Passer » termine l'assistant sans rien installer.
2. **Langue** : celle du système (la première langue préférée). Si un dépôt propose le pack de cette langue (catégorie
   `language:<code>`, la langue exacte puis sa langue de base), il est ajouté d'office au récapitulatif ; sinon rien,
   sans erreur. L'anglais est au cœur de Mire : jamais de pack pour lui.
3. **Ce que vous voulez faire** : les familles de la fiche (films et séries, musique, photos, jeux, télévision,
   streaming), seulement celles pour lesquelles l'index a au moins un plugin.
4. **Votre box** (si « Télévision » est choisie et que l'index propose des box) : une seule, ou aucune.
5. **Vos services de streaming** (si « Streaming » est choisi et que l'index en propose) : plusieurs.
6. **Récapitulatif** : chaque plugin à installer, pourquoi il est là, ce qu'il demande (permissions, comme dans le
   Centre), ses badges (« Tiers », « Accord demandé ») ; les dépendances avec « Nécessaire à … ». **Rien n'est
   installé avant « Installer ».** « Ne rien installer » termine l'assistant.
7. **Installation** : un appel `pluginsInstall` par plugin demandé (ses dépendances viennent avec lui), avec son
   avancement. Un plugin qui demande l'accord (plugin tiers de code sensible) affiche l'avertissement du Centre ; le
   bouton mis en avant est « Annuler », et l'accord n'est donné qu'après « J'ai compris, installer ». Un échec n'arrête
   rien : il est montré, et se rattrape dans le Centre (« Ouvrir le Centre »).

L'interface n'envoie au processus principal que des identifiants de plugin et de dépôt, et, pour un accord, la version
qu'il a lui-même demandée ; il revérifie tout (`src/main/ipc/handlers/plugins.ts`). Les noms et descriptions venus de
l'index sont affichés comme du texte.

## Catégories de l'index

Les choix viennent du champ **facultatif** `categories` de chaque version dans l'index signé d'un dépôt (il fait partie
du contenu signé). Le client des dépôts (`categoriesOf`, `src/main/repos/index-file.ts`) ne garde que des valeurs bien
formées (motif `^[a-z][a-z0-9-]{0,31}(:[a-z0-9][a-z0-9-]{0,31})?$`, sans doublon, 16 au plus) ; un index sans ce champ
reste valable, ses plugins n'ont simplement pas de catégorie.

| Catégorie | Sens |
| --- | --- |
| `movies`, `music`, `photos`, `games`, `tv`, `streaming` | Plugin proposé quand on choisit cette famille |
| `tv-box` | Pack d'une box (compte pour `tv`), choisi à l'étape « Votre box » |
| `streaming-service` | Service de streaming (compte pour `streaming`), choisi à l'étape « Vos services » |
| `language:<code>` | Pack de langue (code BCP 47 en minuscules : `fr`, `pt-br`) |

Le format 1 de `mire-addons` n'a pas encore ce champ : le SDK (manifeste) et la construction de l'index devront
l'émettre (tâche de suivi). En attendant, l'assistant s'éprouve avec un dépôt factice.

## L'essayer sans les plugins publiés

Avec le dépôt factice du test de bout en bout (index signé en cache, plugins `org.essai.*` avec catégories et
dépendances ; leurs paquets n'existent pas, l'installation échoue donc proprement) :

```sh
node test/e2e/fake-repo.js /tmp/mire-assistant   # dossier de données vide, sans configuration
MIRE_USER_DATA=/tmp/mire-assistant npm start
```

L'assistant s'ouvre ; le parcours complet, l'installation (en échec, rattrapable dans le Centre) et le retour à
l'accueil se vérifient à la manette puis au clavier. Le relancer : Réglages → « Assistant de démarrage » →
« Relancer l'assistant ». Un nouvel essai de premier lancement : supprimer le dossier et recommencer.

Test automatique : `test/e2e/assistant.e2e.js` (le `fetch` de Node y est coupé par `test/e2e/offline.js`).
