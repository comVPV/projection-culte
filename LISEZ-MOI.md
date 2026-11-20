# Projection du culte — version 0.3

Verset, paroles de chants, images/annonces et déroulé du culte, en calques
transparents pour OBS et vMix. Fonctionne sous Windows et Mac.

## Démarrer
1. Installer Node.js (version LTS) : https://nodejs.org  (une seule fois)
2. Mac : double-clic sur `start.command` (la 1re fois : clic droit > Ouvrir).
   Windows : double-clic sur `start.bat`.
3. La fenêtre affiche les adresses. Ouvre la **régie** dans un navigateur :
   `http://localhost:8080/` (ou depuis un téléphone / une tablette sur le même Wi-Fi).

## Mise à jour depuis une version précédente
Décompresse la nouvelle version dans un nouveau dossier, puis **copie ton ancien dossier `data`** dans le nouveau
(en remplaçant) : tes Bibles, chants, images et réglages sont conservés.

## Brancher OBS / vMix (machine de diffusion)
Onglet **Réglages** de la régie : les adresses y sont listées avec un bouton « Copier ».
- OBS : Sources > + > Navigateur, URL = `http://IP-DE-LA-REGIE:8080/output.html`, largeur 1920, hauteur 1080.
  Laisse le CSS personnalisé tel quel (le fond est déjà transparent).
- vMix : Add Input > Web Browser, même URL, 1920 x 1080.
- Si la transparence pose problème : ajoute `?bg=green` à l'adresse et utilise un filtre « Clé chroma ».
- Placer la source **au-dessus** de la caméra du prédicateur.

La régie et la diffusion peuvent être sur deux machines : la régie lance le serveur,
la machine de diffusion charge l'adresse de sortie (même réseau).

## Moniteur du prédicateur
Adresse `http://IP-DE-LA-REGIE:8080/output.html?monitor=1` : affiche en plein écran exactement le même verset que le direct
(fond, couleurs et taille réglables dans Réglages > Moniteur du prédicateur). Rien d'autre n'y apparaît.

## Parcourir la Bible
Onglet Verset : tape « Jean » pour voir Jean, 1 Jean, 2 Jean, 3 Jean ; touche un livre, puis un chapitre, puis un verset.
Un verset touché est **sélectionné** ; il part à l'écran avec **▶ Projeter** (ou Entrée). Option « Projection directe » dans Réglages.
« Plage de versets » (ou Maj + clic) sélectionne plusieurs versets d'affilée.

## Polices et fonds
Réglages : une police commune (verset, paroles, moniteur), importable (.ttf .otf .woff .woff2) ; elle est servie par la régie,
rien à installer sur les machines de diffusion. Images de fond distinctes pour les versets, les annonces et le moniteur.

## Mises en page images / annonces
Onglet **Images** : choisir une disposition (plein écran, image à droite, à gauche, petite incrustation dans un coin).
Coche « guide zone caméra » dans Réglages pour voir où placer / recadrer la caméra du prédicateur
dans OBS ou vMix (rectangle vert pointillé), puis décoche-le.

## Écrans auxiliaires (grands écrans de salle) avec fond vidéo
- Onglet **Images / annonces** > « Ajouter images / vidéos » : ajoute un fichier .mp4 ou .webm (court, en boucle).
- Clique sur la vidéo dans la section **Fond** pour l'activer ; le curseur « Assombrir » améliore la lisibilité.
- Adresse de l'écran : `http://IP-DE-LA-REGIE:8080/output.html?screen=1` — à ouvrir en plein écran (F11) sur le PC
  relié à l'écran, ou à charger comme source navigateur. Les paroles et versets s'affichent par-dessus le fond.
- La sortie OBS / vMix normale (transparente) n'affiche jamais ce fond.

## Bibles
- Fournie : King James (KJV).
- Ajouter Louis Segond 1910, Darby, etc. : Réglages > Importer une Bible
  (fichier JSON ou XML Zefania ; un livre manquant est toléré et signalé). Choisis un identifiant (ex. `lsg`), un nom, une abréviation.
- Référence : `Jn 3:16`, `1 Co 13:4-7`, `Ps 23`. Cocher plusieurs versions = affichage côte à côte.

## Chants
- ➕ Nouveau : sépare les strophes et refrains par une ligne vide (1 bloc = 1 diapo de paroles).
- 📥 Importer PowerPoint (.pptx) : récupère le texte de chaque diapo ; la mise en page est ensuite
  entièrement gérée par la régie (police, taille, contour, position : Réglages).

## Raccourcis
`→` ou `Espace` : suivant (strophe suivante, puis élément suivant du déroulé) — `←` : précédent — `Échap` : tout masquer.

## Données
Tout est stocké dans le dossier `data/` (chants, images, Bibles, déroulé, apparence). Pour sauvegarder ou
déplacer sur une autre machine, copie ce dossier.
