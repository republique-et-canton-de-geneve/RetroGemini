# Team Retrospective

Application web de rétrospective d'équipe collaborative et auto-hébergée. Aucune dépendance externe à des APIs cloud n'est requise.

## Fonctionnalités

- **Gestion d'équipes** : Création d'équipes avec authentification par mot de passe
- **Templates de rétrospective** : Start/Stop/Continue, 4L (Liked/Learned/Lacked/Longed For), personnalisés
- **Phases de rétrospective** : Icebreaker, Brainstorm, Groupement, Vote, Discussion, Revue
- **Système de vote** : Votes configurables par personne
- **Suivi des actions** : Création, assignation et suivi des actions entre rétrospectives
- **Mode anonyme** : Brainstorming anonyme optionnel
- **Timer** : Minuteur configurable avec notification audio
- **Stockage local** : Toutes les données sont stockées dans le localStorage du navigateur

## Prérequis

- **Node.js** 20+ (pour le développement)
- **Docker** (pour le déploiement)
- **OpenShift CLI** (`oc`) ou **kubectl** (pour le déploiement Kubernetes)

## Développement local

### Option 1 : Node.js direct

```bash
# Installer les dépendances
npm install

# Lancer le serveur de développement
npm run dev
```

L'application sera disponible sur http://localhost:3000

### Option 2 : Docker Compose

```bash
# Mode développement avec hot reload
docker-compose up dev

# Mode production local
docker-compose up app
```

- Mode dev : http://localhost:3000
- Mode production : http://localhost:8080

## Configuration pour proxy/MITM (Windows)

Si vous êtes derrière un proxy d'entreprise avec interception SSL (MITM) :

### Pour npm

Créez ou modifiez `~/.npmrc` :

```ini
proxy=http://proxy.example.com:8080
https-proxy=http://proxy.example.com:8080
strict-ssl=false
```

### Pour Docker

Créez `~/.docker/config.json` :

```json
{
  "proxies": {
    "default": {
      "httpProxy": "http://proxy.example.com:8080",
      "httpsProxy": "http://proxy.example.com:8080",
      "noProxy": "localhost,127.0.0.1"
    }
  }
}
```

### Variables d'environnement

```powershell
# PowerShell
$env:HTTP_PROXY = "http://proxy.example.com:8080"
$env:HTTPS_PROXY = "http://proxy.example.com:8080"
$env:NO_PROXY = "localhost,127.0.0.1"
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"  # Dev uniquement!
```

```cmd
:: CMD
set HTTP_PROXY=http://proxy.example.com:8080
set HTTPS_PROXY=http://proxy.example.com:8080
set NO_PROXY=localhost,127.0.0.1
set NODE_TLS_REJECT_UNAUTHORIZED=0
```

## Build

```bash
# Build local
npm run build

# Build Docker
npm run docker:build
# ou
docker build -t team-retrospective .

# Lancer l'image Docker
npm run docker:run
# ou
docker run -p 8080:8080 team-retrospective
```

## Déploiement OpenShift

### Avec Kustomize

```bash
# Créer le namespace
oc new-project team-retrospective-dev

# Déployer en environnement de développement
oc apply -k k8s/overlays/dev

# Déployer en production
oc apply -k k8s/overlays/prod
```

### Build sur OpenShift (Source-to-Image)

```bash
# Créer une BuildConfig
oc new-build --name=team-retrospective \
  --binary \
  --strategy=docker

# Lancer le build
oc start-build team-retrospective --from-dir=. --follow

# Créer le déploiement
oc apply -k k8s/overlays/dev
```

### Avec un registry externe

```bash
# Tag et push vers votre registry
docker tag team-retrospective your-registry.com/team-retrospective:latest
docker push your-registry.com/team-retrospective:latest

# Mettre à jour le kustomization avec votre image
# Modifier k8s/overlays/prod/kustomization.yaml :
# images:
#   - name: team-retrospective
#     newName: your-registry.com/team-retrospective
#     newTag: latest

oc apply -k k8s/overlays/prod
```

## Structure du projet

```
.
├── App.tsx                 # Composant principal React
├── index.tsx               # Point d'entrée React
├── index.html              # Template HTML
├── index.css               # Styles Tailwind + CSS custom
├── types.ts                # Types TypeScript
├── components/
│   ├── Session.tsx         # Composant de session de rétrospective
│   ├── Dashboard.tsx       # Tableau de bord équipe
│   ├── TeamLogin.tsx       # Authentification
│   └── InviteModal.tsx     # Modal d'invitation
├── services/
│   └── dataService.ts      # Gestion des données localStorage
├── k8s/                    # Fichiers Kubernetes/OpenShift
│   ├── base/               # Configuration de base
│   └── overlays/           # Overlays dev/prod
├── Dockerfile              # Build production multi-stage
├── Dockerfile.dev          # Build développement
├── docker-compose.yml      # Orchestration locale
├── nginx.conf              # Configuration Nginx
├── vite.config.ts          # Configuration Vite
├── tailwind.config.js      # Configuration Tailwind
└── package.json            # Dépendances npm
```

## Sécurité

- L'application fonctionne entièrement côté client (pas de backend)
- Les données sont stockées dans le localStorage du navigateur
- Aucune donnée n'est envoyée vers des serveurs externes
- Le conteneur s'exécute en tant qu'utilisateur non-root (compatible OpenShift)
- Headers de sécurité configurés dans Nginx (X-Frame-Options, CSP, etc.)

## Personnalisation

### Modifier les couleurs

Éditez `tailwind.config.js` pour personnaliser la palette :

```javascript
colors: {
  retro: {
    bg: '#F8FAFC',
    primary: '#6366F1',      // Couleur principale
    primaryHover: '#4F46E5',
    secondary: '#CBD5E1',
    dark: '#0F172A',
  }
}
```

### Ajouter des templates de rétrospective

Modifiez la fonction `getPresets()` dans `services/dataService.ts`.

## Licence

MIT
