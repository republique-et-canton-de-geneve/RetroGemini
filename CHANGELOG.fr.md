# Changelog (French)

French translation of `CHANGELOG.md`, shown in the "What's New" list to readers
whose interface is in French. `CHANGELOG.md` is the source; this file only
translates the releases it already lists.

## [33.0] - 2026-10-06

### Added
- Utilisez RetroGemini en français : les écrans suivent la langue de votre navigateur et peuvent passer de l'anglais au français à tout moment, pour les facilitateurs, les participants invités comme pour la console d'administration, cette liste des nouveautés s'affiche dans votre langue, les invitations sont envoyées par e-mail dans la langue que vous utilisez, et lorsque vous lancez une rétrospective, vous choisissez si son modèle est en français ou en anglais, quelle que soit la langue de votre écran

## [32.0] - 2026-09-22

### Added
- Déplacez des cartes d'une colonne à l'autre pendant le brainstorming : faites-en glisser une vers une autre colonne, touchez-la sur un téléphone et choisissez où elle va, ou prenez-la avec le clavier — les cartes restent indépendantes et rien n'est regroupé, les cartes que vous ne pouvez pas encore lire restent en place jusqu'à ce que le facilitateur les révèle, et un groupe formé plus tôt passe dans une autre colonne avec toutes ses cartes

## [31.0] - 2026-09-09

### Added
- Évaluez ce que vos actions clôturées ont réellement changé : à l'étape des actions ouvertes, l'équipe attribue de une à trois étoiles à chaque action clôturée depuis la dernière rétrospective, ou indique qu'elle n'est pas concernée, les résultats restent masqués jusqu'à ce que le facilitateur les révèle, et le facilitateur peut reporter une action à la rétrospective suivante. Chaque rétrospective affiche désormais son ROTI à côté du score des actions qu'elle a produites, les actions clôturées portent ce score dans l'onglet Actions, la liste Clôturées est triée par date de clôture, et l'ensemble peut être désactivé dans les paramètres de l'équipe

## [30.0] - 2026-08-25

### Added
- Regroupez les idées sans souris : prenez une carte avec Entrée et choisissez où elle va — une autre carte, un groupe ou une colonne —, fermez n'importe quelle fenêtre avec Échap, et repérez où vous êtes grâce à un contour de focus visible ; les textes et les boutons sont aussi plus foncés, pour rester lisibles sur un projecteur ou sur un téléphone en plein soleil

## [29.1] - 2026-08-19

### Added
- Chaque sujet pour lequel vous avez voté affiche désormais votre propre nombre de votes pendant l'étape de discussion, pour voir d'un coup d'œil quels sujets vous avez soutenus et quel poids vous avez donné à chacun pendant que l'équipe avance dans la liste

## [28.0] - 2026-08-06

### Changed
- Les mots de passe d'équipe doivent désormais comporter au moins 8 caractères, et chaque écran qui en définit un — création d'une équipe, changement du mot de passe, réinitialisation depuis un lien reçu par e-mail — l'indique avant que vous ne le saisissiez ; les mots de passe existants continuent de fonctionner, rien ne change donc avant que vous n'en choisissiez un nouveau

## [27.0] - 2026-07-06

### Added
- Les rétrospectives suivent mieux les personnes et les idées : les cartes regroupées dans une autre colonne affichent désormais un badge « Origine : … » (et gardent la couleur de leur post-it d'origine) pendant les phases de regroupement, de vote, de discussion et de revue, le facilitateur peut signaler un participant qui a dû partir en cours de rétro pour qu'il reste visible dans le panneau sans qu'aucun compteur de votes ne l'attende plus (il revient automatiquement à sa reconnexion), et les coéquipiers invités par e-mail apparaissent sous « Invitations · en attente de connexion » dans le panneau des participants, pour savoir qui vous attendez encore avant de commencer

## [25.0] - 2026-06-29

### Added
- Le panneau des participants s'anime pendant une rétrospective : voyez qui est en train d'écrire une carte (brainstorming) ou de proposer une action (discussion) grâce à un indicateur de saisie, comme dans une messagerie, à côté de son nom, et distinguez d'un coup d'œil les contributeurs actifs des plus discrets grâce à des points qui comptent les cartes ajoutées par chaque participant

## [24.0] - 2026-06-23

### Changed
- L'analyse des rétrospectives de release est désormais plus lisible et plus fiable : sa synthèse par l'IA s'affiche en texte proprement mis en forme (titres, listes à puces, mise en valeur) au lieu de symboles Markdown bruts, et les longues analyses ne sont plus coupées en cours de route

## [23.0] - 2026-06-19

### Changed
- Les actions du tableau de bord sont désormais triées par date de création, de la plus récente à la plus ancienne, dans les vues Ouvertes et Clôturées
- Les discussions des bilans de santé sont plus faciles à suivre : consultez à la demande les descriptions Bon/Mauvais de chaque dimension grâce au nouveau bouton d'information, et les commentaires suivent désormais un parcours clair, envoyer puis modifier, au lieu d'un champ toujours ouvert qui dupliquait votre propre commentaire de façon déroutante

## [22.0] - 2026-06-11

### Added
- Une phase de discussion plus intelligente : quand le vote multiple est autorisé, les sujets affichent le nombre de votants distincts à côté du total des votes, les propositions d'action montrent l'avancement du vote avec un indicateur « Tout le monde a voté » (facilitateur exclu), et les facilitateurs peuvent rejeter des propositions (affichées barrées) ou annuler toute décision d'acceptation ou de rejet

## [21.0] - 2026-06-10

### Changed
- Les suggestions de groupes de l'IA peuvent désormais être ajustées avant d'être appliquées : décochez une carte que vous voulez laisser hors d'un groupe proposé, puis acceptez le groupe avec les seules cartes que vous avez gardées

## [20.1] - 2026-05-13

### Added
- Un regroupement des cartes plus simple pendant la phase de regroupement : le tableau défile automatiquement quand vous faites glisser une carte près d'un bord, et les facilitateurs connectés à un LLM peuvent demander à l'assistant de suggérer des groupes thématiques, qu'ils valident un par un avant leur application

## [19.0] - 2026-04-27

### Added
- Analyse des rétrospectives de release : lorsque l'IA est configurée, les facilitateurs peuvent désormais combiner plusieurs rétrospectives en une synthèse couvrant les moteurs, les points d'ancrage, les thèmes récurrents, les changements de pratiques et les nouveaux outils — soit en saisissant un mot-clé de release présent dans le nom des sprints (par exemple « 2606 ») pour sélectionner automatiquement les rétros correspondantes, soit en cochant les sessions à la main

## [18.0] - 2026-04-13

### Added
- Intégration d'un assistant IA : connectez un LLM compatible OpenAI dans les paramètres du super administrateur pour activer les suggestions automatiques de titres de groupe pendant la phase de regroupement et les résumés de rétrospective générés par l'IA pendant la phase de revue

## [17.0] - 2026-04-09

### Added
- Prise en charge complète des déploiements hors ligne et isolés d'Internet : toutes les icônes, polices, sons et codes QR se chargent désormais sans accès à Internet
- Code QR Wi-Fi dans la fenêtre d'invitation : lorsque `WIFI_SSID` et `WIFI_PASSWORD` sont configurés, les participants peuvent scanner un code QR pour se connecter au réseau local

## [16.0] - 2026-04-01

### Added
- Ajout d'un panneau facultatif de conseils de rétro, avec des recommandations adaptées au contexte et des durées suggérées pour chaque étape de la rétrospective

## [15.0] - 2026-03-27

### Added
- Commentez les cartes pendant les phases de brainstorming (une fois les cartes révélées), de regroupement et de vote, pour que les participants discutent de chaque idée en temps réel

## [14.0] - 2026-03-19

### Changed
- Une étape de discussion plus claire : le bouton de vote pour le sujet suivant s'appelle désormais « Passer », et une indication « Cliquer pour discuter » apparaît sur les sujets repliés, pour que les nouveaux utilisateurs découvrent facilement comment ouvrir le sujet suivant

## [13.0] - 2026-03-18

### Added
- Épinglez vos équipes favorites en haut de la page Vos équipes pour y accéder instantanément, sans faire défiler ni chercher

## [12.0] - 2026-03-10

### Added
- Rédigez un résumé de la rétro à l'étape de revue et continuez à vous améliorer à la clôture avec des propositions de suivi issues du ROTI, le vote de l'équipe, l'acceptation par le facilitateur et le choix d'un responsable pour les actions acceptées

## [11.0] - 2026-03-10

### Added
- Les propositions d'action des bilans de santé rejoignent celles des rétrospectives : les votes sont colorés selon leur valeur, et le facilitateur voit qui a voté, qui ne l'a pas encore fait et chaque vote lorsque « Afficher les votes » est activé

## [10.0] - 2026-03-03

### Added
- Une phase de discussion améliorée : ajoutez des commentaires depuis l'étape de discussion sans revenir à l'évaluation, voyez qui a donné quelle note grâce aux infobulles dans les bilans de santé non anonymes, et le premier sujet des rétrospectives s'ouvre automatiquement pour que les propositions d'action soient visibles tout de suite

## [9.0] - 2026-02-26

### Added
- Sauvegardes automatiques des données côté serveur, avec une planification configurable, des instantanés au démarrage et des points de sauvegarde manuels que vous pouvez nommer et restaurer depuis le panneau du super administrateur

## [8.0] - 2026-02-20

### Added
- Recherchez et filtrez les équipes sur la page d'accueil pour trouver rapidement la vôtre

## [7.0] - 2026-02-05

### Added
- Voyez qui a voté et qui ne l'a pas encore fait sur chaque proposition d'action, grâce à une infobulle qui indique où en est chaque participant
- Le texte des cartes reste visible pendant le regroupement, pour comparer facilement leur contenu en les organisant
- Les retours (signalements de bugs et demandes de fonctionnalité) sont conservés lorsqu'une équipe est supprimée, pour que rien ne se perde

## [6.0] - 2026-02-02

### Added
- Espace retours : consultez les bugs et les demandes de fonctionnalité de toutes les équipes pour éviter les doublons, ajoutez des commentaires et recevez un e-mail quand un statut change ou qu'un commentaire est ajouté

## [5.0] - 2026-01-29

### Added
- Huit nouveaux formats de rétrospective : KALM, DAKI, Étoile de mer, Rose/Épine/Bourgeon, Montgolfière, Voiture de course, Lean Coffee et Les trois petits cochons

## [4.0] - 2026-01-23

### Added
- Les facilitateurs peuvent modifier le profil des membres et aider les invités à associer leur adresse e-mail à un membre existant

## [3.0] - 2026-01-21

### Added
- Les facilitateurs d'équipe et les super administrateurs peuvent désormais renommer leur équipe depuis l'onglet Paramètres

## [2.0] - 2026-01-20

### Added
- Les facilitateurs d'équipe peuvent désormais changer le mot de passe de leur équipe depuis l'onglet Paramètres
- Les super administrateurs peuvent changer directement le mot de passe de n'importe quelle équipe, sans qu'une messagerie soit configurée

## [1.1] - 2026-01-14

### Changed
- Consultez les nouveautés de chaque version dans la fenêtre « Nouveautés »

---

<!--
TRANSLATION GUIDE FOR DEVELOPERS — CHANGELOG.md holds the release rules.

This file mirrors CHANGELOG.md for the French "What's New" list. The backend
parses it with the same parser and attaches each bullet to the English release
with the same version. Every release added to CHANGELOG.md needs its twin here,
in the same change:

- the same "## [X.Y] - YYYY-MM-DD" header (same version, same date);
- the section heading kept as the English key ("### Added", "### Changed",
  "### Removed") — a translated "### Ajouté" is not recognised and the release
  silently shows in English;
- the same number of bullets, translated (formal "vous", the glossary of
  i18n/locales/fr/);
- plain spaces before ? ! ; : and inside « » — the parser inserts the French
  no-break spaces itself.

__tests__/versionService.test.ts checks the versions, dates and section types
of both files against each other, and that no bullet was left in English.
-->
