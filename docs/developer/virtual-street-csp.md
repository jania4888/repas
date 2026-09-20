# Visite virtuelle (Rue 3D) — CSP et médias

Les textures de logos des vitrines publiques sont chargées dans WebGL (`TextureLoader`) uniquement si l’URL résolue appartient **exactement** à l’origine de `environment.apiUrl` (voir `isTrustedStreetTextureUrl` dans `street-media-url.ts`).

## En-têtes Content-Security-Policy recommandés

- **`img-src`** : inclure l’origine de l’API (même hôte que les médias stockés) ainsi que les origines explicitement autorisées pour les logos si vous élargissez la liste blanche côté code.
- **`connect-src`** : déjà nécessaire pour `environment.apiUrl` (appels REST). Les chargements d’images pour WebGL utilisent la même origine lorsque les logos sont servis depuis l’API.

## CORS

Pour que `TextureLoader` avec `crossOrigin = 'anonymous'` réussisse, les réponses image de l’API doivent exposer `Access-Control-Allow-Origin` compatible avec l’origine du front (ou même origine).

## Façades GLB (gltf 2.0)

Lorsque `storefrontGltfFacades` est **true** dans l’environnement Angular, le front charge des modèles **même origine** uniquement, sous :

`/assets/virtual-street/facades/<theme>.glb`

Les fichiers sont versionnés dans `src/Frontend/factutrust-web/src/assets/virtual-street/facades/` (copiés vers `/assets/...` au build). Le paramètre de requête `?v=` provient de `storefrontGltfFacadesVersion` pour invalider le cache navigateur après remplacement d’assets.

### CSP recommandé

- Conserver `default-src 'self'` ; les GLB sont servis comme tout autre asset statique (pas d’URL utilisateur dans le chemin).
- **`connect-src`** : inchangé pour les GLB (GET même origine, pas d’appel cross-origin).
- Éviter d’élargir `script-src` pour glTF : les fichiers ne doivent pas embarquer d’extensions exotiques exécutables ; le pipeline CI exécute `npm run validate:facade-glb` (`gltf-validator`).

### Matériaux / extensions

- **Préféré** : matériaux PBR cœur glTF 2.0, textures embarquées dans le GLB.
- **Compression Draco** : si `storefrontGltfDraco` est activé, servir les décodeurs **même origine** sous `/assets/vendor/draco/gltf/` (générés par `npm run vendor:draco` dans `factutrust-web`). Ne pas charger de décodeur depuis un CDN tiers sans revue CSP.
- **Meshopt** : activer `storefrontGltfMeshopt: true` uniquement si les GLB exportés utilisent `EXT_meshopt_compression` (extension reconnue par Three.js r161). Le décodeur est chargé depuis le module `three/examples/jsm/libs/meshopt_decoder.module.js` (bundlé par le build Angular) — pas de CDN ; vérifier Safari iOS après activation.
- **À éviter** : dépendances à des extensions non supportées par le loader web Three.js utilisé en production.

### IBL (environnement PBR)

Si `storefrontPbrEnvironment` est activé, la scène utilise un environnement procédural **RoomEnvironment** converti en PMREM (pas de HDR externe, pas d’élargissement `connect-src`). Désactiver le flag sur terminaux très faibles si besoin.

### Silhouettes d’arrière-plan (rue)

Des volumes statiques sombres (`__streetBackdrop` dans `street-scene.runtime.ts`) complètent la scène **sans texture externe** : même origine, aucune requête réseau supplémentaire, pas d’impact sur la whitelist des logos.

## Catalogue versionné à validation seule

Le futur catalogue sous `/assets/virtual-street/catalogs/<version>/` est immuable et validé par `npm run validate:street-catalog`. Les chemins du manifeste doivent rester relatifs et sans traversée, avec SHA-256 et dépendances déclarés. Contrairement aux cinq façades historiques, un export final peut être un GLB autonome avec textures embarquées ou utiliser des textures séparées explicitement listées ; dans les deux cas, leur poids décodé est comptabilisé. Le générateur historique de placeholders ne doit jamais écraser ce catalogue. Le gate qui ne regénère rien est `npm run quality:gate:street-catalog`.
