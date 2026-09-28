# Documentation FactuTrust

Ce dossier contient la documentation du projet FactuTrust.

## Documentation utilisateur

La **documentation utilisateur** est destinée aux utilisateurs novices et non-informaticiens. Elle explique chaque fonctionnalité de la plateforme avec des captures d'écran.

- **[Guide utilisateur](utilisateur/README.md)** : index et navigation

## Documentation stratégie produit

- **[Analyse des écarts ERP](strategy/erp-gap-analysis.md)** : matrice module × fonctionnalité × priorité × effort, benchmark Odoo / Sage / Dynamics, roadmap par phases et positionnement produit.
- **[Présentation PowerPoint](strategy/erp-gap-analysis.pptx)** : deck comité produit (13 slides) — synthèse, maturité, gaps, roadmap, benchmark, recommandations.

## Vidéo partenariat expert-comptable

- **[Pipeline vidéo](partnership/README.md)** : screencast + voix off TTS + assemblage MP4
- **Vidéo finale** : [partnership/expert-comptable/factutrust-partenariat-expert-comptable.mp4](partnership/expert-comptable/factutrust-partenariat-expert-comptable.mp4)
- **[Script voix off](partnership/expert-comptable/script-voix-off.md)** et **[checklist démo](partnership/expert-comptable/demo-data-checklist.md)**

## Documentation développeur

- **[FAQ — erreurs console (extensions vs application)](developer/console-errors-faq.md)** : distinguer les messages `Uncaught (in promise)` / permissions liés aux extensions Chrome des erreurs réelles de l’API FactuTrust ; procédure Network, navigation privée, et politique de non-régression sur les intercepteurs HTTP.
- **[Configuration des secrets (JWT, signature électronique)](developer/secrets-configuration.md)** : `dotnet user-secrets` / variables d'environnement pour `JwtSettings:SecretKey` et `SignatureSettings:SecretKey`, blocage par hash des clés compromises, procédure de rotation.
- **[Inscription entreprise en local](developer/local-registration-setup.md)** : démarrage API/LocalDB, proxy Vite, provisionnement tenant (`Migrate` en dev), dépannage 409/500.
- **[Sécurité des dépendances npm](../SECURITY.md)** : processus d’audit trimestriel, seuils CI, risques résiduels acceptés (Angular 19.2 LTS).

## Structure

```
docs/
├── strategy/              # Analyse produit & roadmap
│   └── erp-gap-analysis.md
├── developer/             # Notes développeur (debug, bonnes pratiques)
│   └── console-errors-faq.md
├── utilisateur/          # Documentation utilisateur
│   ├── README.md         # Index
│   ├── 01-premiers-pas.md
│   ├── 02-tableau-de-bord.md
│   ├── ...
│   └── glossaire.md
├── screenshots/          # Captures d'écran (générées par le script)
│   ├── 01-premiers-pas/
│   ├── 02-tableau-de-bord/
│   └── ...
└── scripts/              # Scripts de génération
    ├── capture-screenshots.spec.ts
    └── README.md
```

## Générer les captures d'écran

Voir [scripts/README.md](scripts/README.md) pour les instructions détaillées.

Résumé :

1. Démarrer le backend et le frontend
2. Depuis `src/Frontend/factutrust-web`, exécuter : `npm run docs:screenshots`
3. Pour les pages protégées (dashboard, factures, etc.), définir `DOC_EMAIL` et `DOC_PASSWORD`
4. Ou prendre les captures manuellement selon la checklist dans scripts/README.md
