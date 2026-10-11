# Fenêtre de lecture des pages — import de pièce comptable (Comptabilité › Saisie manuelle)

Document de référence pour le chemin `POST /api/accounting/document-import/propose`
(écran **Comptabilité › Saisie manuelle › Importer une facture**). Il décrit la règle de
réduction du nombre de pages envoyées au lecteur (Docstrange ou IA locale), la chaîne de délais
qui l'entoure, le journal attendu et la procédure de diagnostic d'un « Bad Gateway ».

Hors périmètre de ce document : l'import de facture Ventes/Achats (`POST /api/ai/invoice-import`,
qui envoie le fichier **entier**) et l'import de relevés bancaires (qui envoie **une page à la
fois**). Les deux partagent le client HTTP `"DocStrange"` avec ce chemin, mais pas sa logique de
fenêtre : voir `docs/developer/docstrange-api-contract.md` pour leur contrat.

---

## 1. Règle

**La fenêtre s'applique dès que la pièce compte 6 pages ou plus** — et non au-delà de 6 pages. À
partir de ce seuil, seules les deux premières et les trois dernières pages sont lues et envoyées :

- 5 pages ou moins → la pièce est lue **en entier**, aucune réduction, aucun avertissement ;
- 6 pages → pages **1, 2, 4, 5, 6** (seule la page 3 est sautée) ;
- 7 pages → pages **1, 2, 5, 6, 7** ;
- 66 pages → pages **1, 2, 64, 65, 66**.

Dans tous les cas où la fenêtre s'applique, **exactement 5 pages** sont envoyées — jamais plus. La
constante qui porte cette règle est `MaxPagesWithoutWindow = 5` dans
`src/Backend/FactuTrust.Application/Features/Accounting/DocumentImport/InvoicePdfReadingWindow.cs`
(renommée depuis `PageCountThreshold = 6` : « nombre maximal de pages sans fenêtre » se lit sans
ambiguïté, alors qu'un simple « seuil = 5 » laisse planer le doute sur l'inclusion de la valeur).

**La règle est identique pour Docstrange et pour l'IA locale** (Ollama/OpenRouter) : les deux
lecteurs externes au parseur natif reçoivent la pièce réduite dès 6 pages. Le **parseur natif
InstaFact**, lui, continue de lire la pièce **complète** dans tous les cas : il travaille en local,
sans coût fournisseur ni sortie de données, et a besoin de toutes les pages pour ses repères de
mise en page.

### 1.1 Pagination illisible

Quand le nombre de pages ne peut pas être déterminé (PDF chiffré avec mot de passe utilisateur,
fichier tronqué, format non reconnu) :

- **Docstrange actif** : l'import est **refusé**, message stable, et **aucun octet n'est envoyé**
  au fournisseur (comportement fail-closed, propre à ce chemin) ;
- **Docstrange inactif** : comportement **inchangé** — l'IA locale reçoit la pièce telle quelle
  (passthrough). Les données ne quittent pas le serveur et le pipeline local a ses propres
  plafonds (`MaxImages`, `MaxTextChars`) ; refuser ici retirerait une capacité existante sans gain
  de confidentialité.

### 1.2 Réduction en échec

Si la réduction du PDF échoue (par exemple une incohérence détectée entre le nombre de pages
attendu et le nombre de pages effectivement extraites), l'import est **refusé** : le fichier
d'origine ne part **jamais** à la place d'une réduction manquée.

---

## 2. Pourquoi 5 pages, précisément

Le fournisseur Docstrange annonce une voie asynchrone (`/api/v1/extract/async` + sondage) au-delà
de 5 pages sur la voie synchrone (`DocStrangeSettings.SyncPageThreshold = 5`, voir
`docs/developer/docstrange-api-contract.md`). Avec `MaxPagesWithoutWindow = 5`, une pièce arrivant
sur ce chemin est donc toujours dans l'un de ces trois cas :

- ≤ 5 pages : envoyée telle quelle ;
- ramenée à **exactement 5 pages** par la fenêtre ;
- refusée (pagination illisible, ou réduction en échec).

**Aucune pièce de plus de 5 pages ne part donc jamais sur `/sync` depuis ce chemin.** C'est pour
cette raison que la voie asynchrone Docstrange reste **non implémentée** : elle serait inutile tant
que la fenêtre ramène toute pièce longue à 5 pages au plus.

Cette propriété est un **invariant testé** (et non une simple observation) :

```
FirstPages (2) + LastPages (3) ≤ MaxPagesWithoutWindow (5) ≤ DocStrangeSettings.SyncPageThreshold (5)
```

Elle est aussi protégée par une **garde défensive à l'exécution** : si une pièce dont le nombre de
pages est connu dépassait `SyncPageThreshold` sans qu'une fenêtre ait été appliquée, un
avertissement serait journalisé (§6). Après ce correctif, ce journal ne doit **jamais** apparaître
pour ce chemin ; s'il apparaît, c'est un défaut à corriger, pas un cas fonctionnel.

---

## 3. Matrice

| Pages de la pièce | Docstrange actif | Docstrange inactif, parseur natif inapplicable (IA locale) | Parseur natif InstaFact |
|---|---|---|---|
| 1 à 5 | pièce entière, aucun avertissement | pièce entière, aucun avertissement | pièce entière |
| 6 | 1, 2, 4, 5, 6 — avertissement **au singulier** (page 3 non analysée) | 1, 2, 4, 5, 6 — même avertissement | pièce entière |
| 7 | 1, 2, 5, 6, 7 — avertissement au pluriel (pages 3-4 non analysées) | idem | pièce entière |
| 66 | 1, 2, 64, 65, 66 — avertissement au pluriel | idem | pièce entière |
| pagination illisible | **refus**, aucun octet envoyé | pièce entière (passthrough, inchangé) | pièce entière |
| réduction en échec | **refus**, le fichier d'origine ne part jamais | — (la réduction n'est tentée que dès 6 pages ; un échec de comptage relève du cas précédent) | pièce entière |

L'avertissement « Cette pièce compte N pages. Seules les pages 1, 2, … et N ont été lues. Les pages
intermédiaires n'ont pas été analysées : contrôlez le détail avant d'enregistrer. » apparaît dans
les diagnostics de la proposition avec `severity = warning` et **n'empêche pas** l'enregistrement.
À 6 pages, une seule page est sautée : le texte est rédigé au singulier (« La page 3 n'a pas été
analysée »).

---

## 4. Nom de fichier et type de contenu envoyés

- Le nom de fichier multipart est **conservé à l'identique** pour la pièce réduite — pas de
  suffixe du type « (p1-2,64-66) ». La traçabilité existe déjà par l'identifiant d'enregistrement
  et par les journaux (§6) ; un nom différent de celui vu à l'écran compliquerait le support.
- Quand une fenêtre est appliquée, le `Content-Type` envoyé est forcé à `application/pdf` : les
  octets envoyés sont alors certainement un PDF reconstruit en mémoire. Sinon, le `Content-Type`
  d'origine est conservé.
- Le nom de fichier multipart est assaini avant l'envoi (caractères de contrôle, guillemets,
  antislash et séparateurs de chemin retirés ; longueur plafonnée ; nom vide → `document.pdf`) —
  un durcissement partagé avec les autres usages du client Docstrange.

---

## 5. Message utilisateur sur 502/503/504

Un 502 (Bad Gateway), 503 (Service Unavailable) ou 504 (Gateway Timeout) renvoyé par la chaîne de
proxys affiche désormais un message français stable et actionnable — jamais le texte brut du
proxy (« Bad Gateway »). Ce mapping est **local** au service front d'import de pièce comptable
(`accounting-document-import.service.ts`), pas dans le gestionnaire d'erreurs global : celui-ci est
utilisé par tout le produit, le modifier serait une régression de portée inconnue. Le message de
délai existant (`TimeoutError`, affiché quand le délai front de 190 s est dépassé) n'est pas
modifié par ce correctif.

---

## 6. Chaîne de délais

De l'extérieur vers l'intérieur, chaque couche est plus patiente que celle qu'elle englobe, pour
que le message vienne toujours de l'application plutôt que d'un proxy :

**Traefik 1500 s > Nginx 300 s > front 190 s > budget Docstrange de ce chemin ≈ 170 s.**

| Couche | Valeur | Où |
|---|---|---|
| Traefik `respondingTimeouts.readTimeout` (entrypoint TLS) | **1500 s** | hors dépôt, `/docker/traefik/docker-compose.yml` — procédure et compromis de sécurité dans `deploy/README.md` §9 |
| Traefik `respondingTimeouts.idleTimeout` | 180 s (conservé) | idem — ne borne que l'inactivité d'une connexion keep-alive, pas une requête en cours |
| Nginx `proxy_read_timeout` / `proxy_send_timeout` | 300 s (inchangé) | `deploy/nginx/templates/default.conf.template` |
| Front `ImportTimeoutMs` | 190 s (inchangé) | `accounting-document-import.service.ts` |
| Budget Docstrange de `/propose` | **170 s** (option `Accounting:DocumentImportExternalBudgetSeconds`, bornée 30-180 s : 10 s de marge sous le délai du navigateur) | `appsettings.json`, encadre uniquement l'appel Docstrange de ce chemin |
| `HttpClient "DocStrange"` | 300 s (inchangé, clamp 30-600) | partagé avec les relevés bancaires et l'import Ventes/Achats — non touché |

**Après le changement Traefik, c'est Nginx (300 s) qui borne effectivement** la durée d'une
requête d'analyse sur ce chemin : Traefik à 1500 s ne joue plus de rôle de coupure, il laisse
passer. Le budget applicatif de 170 s et le délai front de 190 s restent sous ce plafond, donc
l'utilisateur voit toujours un message de l'application plutôt qu'une erreur de passerelle — sauf
dépassement du budget de 170 s, qui rend alors un message applicatif de dépassement (pas une
erreur de passerelle).

Avec 5 pages à 6-35 s par page mesurés côté fournisseur, le pire cas attendu est d'environ 175 s :
le budget de 170 s est délibérément serré, pour qu'un dépassement soit un signal plutôt qu'une
attente silencieuse. Si la pratique montre régulièrement plus de 170 s, la valeur est ajustable
par configuration (sans redéploiement de code), dans la borne 30-180 s (le plafond reste sous le délai fixe du navigateur, 190 s).

### 6.1 Journal attendu

- `grep "[AccountingDocumentImport]"` : trace de chaque analyse de ce chemin.
- `grep "lecture limitée aux pages"` : une réduction a été appliquée (fenêtre dès 6 pages) ; en
  hausse attendue après ce correctif, puisque les pièces de 6 pages entrent désormais dans la
  fenêtre.
- `grep "SyncPageThreshold"` : garde défensive — **doit rester vide** après ce correctif (§2). Toute
  occurrence est un défaut à corriger, pas un cas fonctionnel.
- `grep "délai imparti"` : dépassement du budget de 170 s.

Aucun contenu de pièce, aucun montant, aucune clé fournisseur n'apparaît dans ces journaux.

---

## 7. Diagnostic « Bad Gateway » — procédure

Une coupure franche, sans page HTML, au bout d'environ 60 s sur une analyse longue, est la
signature du proxy inverse de Go utilisé par Traefik avec sa valeur par défaut de `readTimeout`
(60 s v3) — pas celle de Nginx (qui renvoie une page HTML et coupe à 300 s). La console du
fournisseur peut ne montrer aucune trace de la requête sur le créneau concerné : soit elle n'a
jamais atteint le fournisseur, soit son tableau de bord n'affiche pas les traitements en cours.

### 7.1 Hypothèses, dans l'ordre à vérifier

| # | Hypothèse | Discriminant |
|---|---|---|
| H1 | Coupure par les `respondingTimeouts` de l'entrypoint Traefik | `docker inspect` de Traefik + journal Traefik (502 + durée) |
| H2 | Version déployée **antérieure** à l'application de ce correctif : un PDF long part entier sur `/sync`, l'appel dépasse largement la minute | commit déployé + présence du log « lecture limitée aux pages » |
| H3 | Conteneur API redémarré ou tué par la limite mémoire | `RestartCount` / `OOMKilled` |
| H4 | Exception non gérée côté API, connexion fermée | journal API au moment précis |

### 7.2 Commandes (sur le VPS, lecture seule)

```bash
# 1) Version réellement déployée
cd <répertoire de déploiement> && git rev-parse HEAD && git log -1 --date=iso --format='%h %ad %s'
docker inspect factutrust-api --format '{{.Config.Image}} {{.Created}}'

# 2) Traces applicatives du créneau (adapter l'horodatage)
docker logs factutrust-api --since 2026-10-10T15:35:00 --until 2026-10-10T15:45:00 \
  | grep -E "AccountingDocumentImport|lecture limitée aux pages|DocStrange"

# 3) Santé du conteneur API
docker inspect factutrust-api --format '{{.RestartCount}} {{.State.OOMKilled}} {{.State.StartedAt}}'

# 4) Délais Traefik (hors dépôt)
docker inspect traefik-traefik-1 --format '{{json .Config.Cmd}}' | tr ',' '\n' | grep -i timeout
cat /docker/traefik/docker-compose.yml
docker logs traefik-traefik-1 --since 2026-10-10T15:35:00 | grep -E '502|Bad Gateway'

# 5) Nginx
docker logs factutrust-nginx --since 2026-10-10T15:35:00 | tail -50
```

Lecture attendue : si H2 se confirme (aucun log « lecture limitée aux pages » sur le créneau), le
seul correctif nécessaire est de **déployer le code actuel** — le changement Traefik de
`deploy/README.md` §9 reste utile mais cesse d'être urgent. Si H1 se confirme, appliquer la
procédure Traefik de `deploy/README.md` §9.

### 7.3 Reproduction après correctif

Rejouer un PDF long (plusieurs dizaines de pages) sur l'écran d'import, Docstrange actif, en
relevant : durée perçue, durée du log de réduction, durée de l'appel Docstrange, pages
effectivement consommées sur le quota fournisseur (**5 attendues**, jamais plus), message affiché
en cas d'échec.

---

## 8. Fichiers concernés

| Fichier | Rôle |
|---|---|
| `src/Backend/FactuTrust.Application/Features/Accounting/DocumentImport/InvoicePdfReadingWindow.cs` | règle de fenêtre (`MaxPagesWithoutWindow`, `SelectPageNumbers`, `DescribeSkippedPages`) |
| `src/Backend/FactuTrust.Infrastructure/Services/DocumentImport/InvoicePdfPageWindow.cs` | réduction effective du PDF, comptage à deux lecteurs |
| `src/Backend/FactuTrust.Infrastructure/Services/DocumentImport/AccountingDocumentExtractor.cs` | orchestration, fail-closed, budget de délai, garde `SyncPageThreshold` |
| `src/Backend/FactuTrust.Application/Configuration/AccountingSettings.cs` | `DocumentImportExternalBudgetSeconds` |
| `src/Frontend/factutrust-web/src/app/features/accounting/manual-entry/services/accounting-document-import.service.ts` | mapping 502/503/504 côté front |
| `docs/developer/docstrange-api-contract.md` | contrat HTTP Docstrange, invariant `SyncPageThreshold` |
| `deploy/README.md` | reconnaissance et procédure de changement Traefik (`respondingTimeouts`) |
