# Contrat HTTP Docstrange (Nanonets) — relevé le 2026-10-08

Document figé par une sonde réelle, les pages de documentation du fournisseur n'étant pas servies
aux robots (SPA). Toutes les requêtes ci-dessous ont été exécutées contre un **PDF synthétique**,
jamais contre un document client. Clé expurgée.

Ce fichier fait foi pour l'implémentation : ne pas se fier aux SDK publiés, qui décrivent des
générations d'API différentes (voir « Pièges » en fin de document).

---

## Point d'entrée

```
POST https://extraction-api.nanonets.com/api/v1/extract/sync
Authorization: Bearer <clé>
Content-Type: multipart/form-data
```

### Champs multipart

| Champ | Obligatoire | Valeurs |
|---|---|---|
| `file` | oui | le document (`application/pdf`, images…) |
| `output_format` | oui | `markdown` · `json` · `html` · `csv` |
| `json_options` | non | avec `output_format=json` : un **JSON Schema complet** sérialisé, ou une liste plate de noms de champs |

Forme des parties multipart : les noms sont écrits **entre guillemets**
(`Content-Disposition: form-data; name="output_format"`), comme le prescrit la RFC 7578. Vérifié
accepté avec un `Content-Type: text/plain; charset=utf-8` sur les champs texte, c'est-à-dire la
forme exacte que produit `HttpClient` de .NET.

Attention : `MultipartFormDataContent.Add(content, name)` écrit `name=output_format` **sans
guillemets**. Cette variante n'a pas été éprouvée contre ce fournisseur ; `DocStrangeHttpClient`
force donc la forme entre guillemets.

### Réponse 200

```json
{
  "success": true,
  "message": "Extraction completed successfully",
  "record_id": "17958884",
  "status": "completed",
  "result": {
    "markdown": { "content": "…", "metadata": { "bounding_boxes": null, "confidence_score": null, … } },
    "html": null,
    "json": { "content": { … } },
    "csv": null
  },
  "processing_time": 28.98,
  "filename": "releve-demo.pdf",
  "output_format": "markdown",
  "file_size": 1027,
  "pages_processed": null,
  "created_at": null,
  "signed_url": null,
  "progress": null,
  "request_config": null
}
```

Une seule branche de `result` est non nulle, celle désignée par `output_format`. Le contenu utile
est donc `result.markdown.content` (chaîne) ou `result.json.content` (objet).

### Codes d'erreur observés

| Code | Corps | Lecture |
|---|---|---|
| `401` | `{"detail":"Authentication required. Please provide a valid API key or sign in."}` | clé absente ou invalide |
| `429` | `{"detail":"…"}` | quota, **ou** appel d'un point d'entrée déprécié (voir pièges) |

Le corps d'erreur ne doit **jamais** être remonté tel quel à l'utilisateur (CWE-209) : le mapper
vers un message stable, comme le fait `CursorSdkErrorMapper`.

### Durées mesurées (1 page synthétique)

6 s à 35 s selon le format. Largement sous le `VisionCallTimeoutSeconds` de 300 s en vigueur.

---

## ⚠️ Le piège qui compte : la virgule décimale est détruite en JSON typé

Le PDF sonde imprime des montants tunisiens à trois décimales : `100,000` · `250,500` · `1138,155`.

**Voie `output_format=json`** — la virgule est lue comme un séparateur de milliers :

| Imprimé | Rendu | Facteur |
|---|---|---|
| `1000,000` | `1000000` | ×1000 |
| `100,000` | `100000` | ×1000 |
| `1138,155` | `1138155` | ×1000 |

L'erreur est **silencieuse** : le JSON est valide, le nombre est plausible, rien ne signale la
multiplication. Sur une comptabilité en dinars/millimes, c'est indétectable à l'œil.

**Voie `output_format=markdown`** — la valeur est recopiée **telle qu'imprimée** :

```html
<td>02/03/2026</td><td>VIREMENT DEMO 001</td><td>100,000</td><td></td>
```

### Conséquence pour l'implémentation

1. **Relevés bancaires** : demander `markdown`. La `<table>` HTML rendue entre directement dans
   `BankStatementTableTextParser`, qui gère déjà HTML et Markdown (écrit pour le mode
   « Table Recognition » de GLM-OCR), puis dans `BankStatementAiPageReader` — arrondi millime,
   ancrage des montants, codes d'anomalie. Aucun code d'analyse nouveau.
2. **Factures** : ne jamais demander de **nombres** à Docstrange. Le schéma envoyé doit typer tout
   montant en **chaîne**, pour obtenir une recopie verbatim, et la conversion reste serveur. C'est
   exactement la raison d'être de `LlmOutputSchemas.BankStatementPageVerbatim`, qui type déjà
   `debit` / `credit` / soldes en chaînes — précédent à suivre, pas à réinventer.

---

## Docstrange activé = seul lecteur, pièces **et** relevés

Depuis le 2026-10-08, activer la carte Docstrange au back-office ne l'ajoute plus comme étage
supplémentaire : elle en fait le **seul lecteur** de l'import de pièces, sur les **deux** points
d'entrée — `POST /accounting/document-import/propose` (saisie comptable) et
`POST /ai/invoice-import` (assistant de facturation) — **et** de l'import de relevés bancaires.

| | Carte éteinte | Carte allumée |
|---|---|---|
| Parseur natif InstaFact | prioritaire | **contourné** |
| LLM local (pièces) | utilisé | **jamais appelé** |
| Échelle vision locale (relevés) | 2 essais + repli texte | **jamais appelée** |
| Modèle vision local | résolu et préchauffé | **ni résolu, ni préchauffé** |
| Échec du service (pièces) | — | **l'import échoue**, avec un message actionnable |
| Échec du service (une page de relevé) | — | **cette page seule** est non lue, les suivantes continuent |

### La carte décide seule

Le second interrupteur `Accounting:BankStatementImport:DocStrangeEnabled` a été **supprimé**. Il
doublait la décision pour les seuls relevés, alors que les pièces n'obéissaient déjà qu'à la carte :
une même case du back-office gouvernait donc deux flux selon deux règles différentes. Le modèle est
désormais uniforme — une carte, deux flux.

**La contrepartie, à assumer :** la garde au niveau de la configuration serveur n'existe plus.
Activer la carte pour les factures envoie désormais **aussi** les relevés chez Nanonets, sans
seconde décision écrite dans un fichier. C'est précisément ce que le second interrupteur empêchait.
Un test (`The_docstrange_statement_switch_no_longer_exists`) épingle l'**absence** du réglage :
le réintroduire produirait de la configuration morte, un administrateur lisant
« DocStrangeEnabled: false » et croyant les relevés protégés alors que la carte continuerait de les
envoyer. Un réglage qui mente est pire qu'un réglage absent.

### Plafonds propres à ce lecteur (`DocStrange:*`)

| Réglage | Défaut | Pourquoi pas celui du modèle local |
|---|---|---|
| `MaxStatementPages` | 60 (borné 1 à 60) | `MaxAiPages` vaut 20, calibré sur 180 s/page ; à 30 s/page un relevé de 21 pages se lit en ~11 min — le refus observé n'avait plus lieu d'être |
| `EstimatedSecondsPerPage` | 30 (borné 5 à 300) | `VisionEstimatedSecondsPerPage` vaut 180 s ; l'écran annonçait six fois le temps réel |

60 pages à 35 s (le haut de la fourchette mesurée) font 35 min, sous les 120 min du budget de tâche
par défaut : `AiJobBudgetMinutes` n'a donc pas de jumeau Docstrange, un réglage de plus qui ne
changerait rien.

Deux détails qui se déduisent mal du code :

- **Le garde de rendu ne s'applique pas.** Il borne une rastérisation locale (format × DPI ⇒ pixels
  et mégapixels) pour un modèle vision. Docstrange reçoit la page PDF telle quelle et fait son OCR
  chez lui : rien n'est rastérisé. L'appliquer quand même aurait envoyé les pages grand format au
  modèle texte local — soit à l'IA que l'activation de la carte écarte.
- **`VisionReadingEnabled` ne le gouverne pas.** Ce réglage concerne le modèle vision **local**. L'y
  soumettre aurait fait retomber le plan sur le moteur texte dès qu'il serait éteint.

### Conséquences communes aux deux flux

Trois conséquences à connaître avant d'activer :

1. **Plus de repli.** L'ancien comportement rattrapait silencieusement tout échec par le LLM :
   l'utilisateur attendait le service externe *puis* le modèle local, sans qu'aucun écran ne le
   dise. C'est ce que montrait une capture à 48 s. Désormais, chaque cause produit un message
   distinct — injoignable, quota épuisé, clé refusée, réponse inexploitable.
2. **Le parseur natif est contourné** : vos propres factures InstaFact, qu'il lit localement,
   gratuitement et exactement, partent chez Nanonets et consomment du quota. Décision assumée ;
   elle tient à une seule condition dans `AccountingDocumentExtractor.ExtractAsync`, et un test
   l'épingle sur une vraie fixture InstaFact.
3. **Disponibilité** : conjuguées, les deux règles ci-dessus signifient que si Nanonets ne répond
   pas, **aucune facture ne peut plus être importée**. Le retour arrière est immédiat : désactiver
   la carte rend exactement le comportement d'avant.

La permission `ai:chat` **reste exigée** sur les deux chemins : ce service fait sortir des données
du serveur, l'activer ne dispense personne.

Les deux endpoints de capacités publient `documentExtractionProvider` — le **nom** du service, et
jamais sa clé ni son URL — pour que l'écran annonce le bon moteur au lieu de parler d'« analyse IA ».
Côté relevés, c'est `session.aiProviderKind = "docstrange"` qui porte l'information, et l'écran de
relecture en dérive sa bannière, son estimation et son libellé de méthode. Aucun de ces textes ne
nomme le fournisseur à l'utilisateur, la règle « ne jamais nommer le moteur » restant entière.

Le coupe-circuit « deux pages consécutives en échec » **ne s'applique pas** à ce service : il protège
d'un modèle local qui s'effondre et dont chaque appel coûte des minutes, pas d'un service HTTP dont
les pages sont indépendantes.

---

## Comportement de `json_options`

| Entrée | Résultat |
|---|---|
| JSON Schema complet (imbriqué) | forme **respectée** : objets et tableaux imbriqués rendus tels que décrits |
| liste plate de noms de champs | le modèle **invente** la sous-structure (un champ `totals` demandé est revenu tantôt objet, tantôt scalaire) |
| absent | le modèle invente le schéma entier, en français (`releve_de_compte`, `titulaire`, `operations`…) |

Seule la première forme est déterministe. Les deux autres sont inutilisables pour un mapping stable.

---

## Pièges

- **`POST /extract` est DÉPRÉCIÉ** et répond `429` :
  `{"detail":"The /extract endpoint is deprecated. Please migrate to /api/v1/extract."}`.
  C'est pourtant le point d'entrée codé en dur dans le SDK **Python** publié
  (`docstrange/processors/cloud_processor.py`), avec un champ `output_type` et des valeurs
  (`specified-json`, `specified-fields`) qui n'existent plus. Ne pas s'en inspirer.
- Le champ s'appelle `output_format` sur l'API vivante, **pas** `output_type`.
- Au-delà de 5 pages, le fournisseur annonce une voie asynchrone
  (`/api/v1/extract/async` + sondage par `record_id`). **Non vérifiée par cette sonde** : le PDF
  témoin ne fait qu'une page. À sonder avant d'envoyer un document multipage entier. L'import de
  relevés envoie de toute façon **une page à la fois**, ce qui reste sous le seuil.
- Quota du compte de recette : 500 pages. Suffisant pour une recette, pas pour un usage courant.
- Nanonets **ne publie aucune politique de rétention** pour son offre cloud. Le mode on-premise
  existe (bibliothèque Python + CUDA) mais relève d'un autre chantier.

---

## Reproduire la sonde

Les deux scripts vivent hors du dépôt (scratchpad de session) et lisent la clé dans
`DOCSTRANGE_API_KEY` — elle n'est écrite dans aucun fichier. Le PDF témoin est généré par
`make-synthetic-pdf.py` et ne contient que des données inventées.
