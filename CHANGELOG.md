# Journal des modifications — Astro.io

## v3.4 — 31/10/2026

### Multijoueur
- La vie, le bouclier et les parties cassées sont gérés par le serveur.
- Les dégâts aux astéroïdes sont partagés, y compris pour un joueur qui rejoint une partie en cours.
- Un joueur mort n'est plus visible, ne bouge plus et ne tire plus jusqu'à Rejouer.
- Les vaisseaux des adversaires s'affichent avec leur type et leur niveau.
- Défense triplée à 10 % de vie ou moins.
- Les coups sont validés par le serveur (cadence, portée, dégâts plafonnés).

### Comptes
- Connexion par adresse e-mail, avec récupération du mot de passe.
- Bouton Compte (se déconnecter, changer son e-mail, supprimer son compte).
- Bouton Crédits, masquable dans les Paramètres.

### Modération
- Panneau Modération réservé aux comptes désignés, avec bannissement.

### Classement
- Meilleur score et plus de kills en une partie (en ligne uniquement).

### Sécurité
- Limite de taille des requêtes et messages (3 Mo).

## v3.3 — 31/10/2026

### Classement
- Classement en ligne : meilleur score et plus de kills en une partie (visible depuis le menu).
- Les scores sont enregistrés uniquement pour les parties en ligne.

## v3.2 — 31/10/2026

### Interface
- Le chat ne recouvre plus le panneau des systèmes du vaisseau.
- Le journal des modifications, la section Compte et les messages de suppression sont traduits dans les 10 langues.

## v3.1 — 31/10/2026

### Comptes
- Bouton « Supprimer mon compte » (supprime la progression et le compte Firebase).
- Bouton « Se déconnecter ».
- Les options de compte sont dans le menu Paramètres.

## v3.0 — 31/10/2026

### Multijoueur
- Reconnexion automatique au serveur (le serveur gratuit met du temps à démarrer).
- Le serveur sert maintenant le jeu : une seule adresse suffit.
- Astéroïdes partagés entre joueurs : même position au départ, destructions visibles pour tous.

### Modes de jeu
- Nouveau mode **Survie** : vagues de bots de plus en plus nombreuses et fortes.

### Comptes
- Connexion par identifiant et mot de passe (Firebase Authentication).
- Progression sauvegardée sur le compte : succès, statistiques et meilleure vague.

### Langues
- Ajout du portugais et de l'italien.
- La langue est choisie automatiquement selon l'appareil, avec repli sur l'anglais.

### Corrections
- La jauge de puissance restait visible dans le menu principal.
- Le bouton Survie est traduit dans toutes les langues.

## v2.5 — Version de départ
- Jeu hors ligne et en ligne de base, guide, succès, 8 langues.
