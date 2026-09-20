namespace FactuTrust.Application.Configuration;

public sealed class OllamaSettings
{
    public const string SectionName = "Ollama";

    public string BaseUrl { get; set; } = "http://localhost:11434";
    public string DefaultModel { get; set; } = "mistral";

    /// <summary>
    /// Modèle dédié à l'import de facture par IA. Vide => utilise <see cref="DefaultModel"/>.
    /// Permet de pointer l'import vers un modèle plus léger/rapide (ex. un modèle 3B)
    /// sans impacter le chat de l'assistant.
    /// </summary>
    public string InvoiceImportModel { get; set; } = "";

    /// <summary>
    /// Modèle dédié à l'Assistant Studio (IA). Vide => utilise DefaultModelRef plateforme puis <see cref="DefaultModel"/>.
    /// </summary>
    public string StudioAiModel { get; set; } = "";

    /// <summary>Modèle dédié à l'import de relevé bancaire PDF. Vide => <see cref="InvoiceImportModel"/> puis <see cref="DefaultModel"/>.</summary>
    public string BankStatementImportModel { get; set; } = "";

    public int TimeoutSeconds { get; set; } = 120;

    /// <summary>
    /// Nombre maximal de générations LLM Ollama exécutées simultanément (toutes requêtes / tous comptes confondus).
    /// Sur un moteur mono-instance CPU, 1 = sérialisation stricte (recommandé) : évite que des générations
    /// concurrentes se ralentissent mutuellement jusqu'à l'expiration (cause de « Génération interrompue »
    /// en usage multi-comptes simultané). À relever sur GPU / Ollama configuré pour le parallélisme.
    /// </summary>
    public int MaxConcurrentGenerations { get; set; } = 1;

    /// <summary>
    /// Délai d'inactivité (en secondes) toléré entre deux fragments reçus pendant le streaming du chat
    /// (0 = désactivé). Un dépassement lève une erreur 408 explicite et ré-essayable au lieu d'une coupure
    /// silencieuse. Ne s'applique PAS à l'import de facture, qui conserve son propre budget total
    /// (paramètre <c>streamReadTimeout</c>).
    /// </summary>
    public int ChatStreamInactivityTimeoutSeconds { get; set; } = 120;

    public int MaxTokens { get; set; } = 4096;

    /// <summary>
    /// Plafond de tokens générés DÉDIÉ au scope <c>FirmMission</c> (Assistant Chef de mission). Les
    /// synthèses de revue de portefeuille sont courtes : 1536 borne le pire cas de génération CPU
    /// (Lot 3.2). <c>0</c> = hérite du <see cref="MaxTokens"/> global (comportement historique).
    /// Scope-guardé : aucun impact sur les autres scopes.
    /// </summary>
    public int FirmMissionMaxTokens { get; set; } = 1536;

    /// <summary>Context window size passed to Ollama (num_ctx). 0 = let Ollama use model default.</summary>
    public int NumCtx { get; set; } = 16384;

    /// <summary>
    /// Plancher (en tokens) pour la fenêtre de contexte adaptative côté chat.
    /// Le calcul ne descendra jamais en dessous, et restera plafonné à <see cref="NumCtx"/>.
    /// </summary>
    public int NumCtxMin { get; set; } = 4096;

    /// <summary>
    /// Fenêtre de contexte FIXE (num_ctx) pour le chat GPU. Quand &gt; 0, cette valeur constante est utilisée pour
    /// TOUTES les requêtes du modèle de chat (tours d'agent, synthèse finale, warm-up, keep-alive) afin
    /// qu'Ollama NE RECHARGE JAMAIS le modèle : un changement de num_ctx entre deux requêtes force un
    /// rechargement très coûteux (plusieurs minutes sous pression mémoire). 0 = calcul adaptatif historique
    /// (<see cref="AdaptiveContextEnabled"/> / <c>AiChatContextSizing</c>).
    /// </summary>
    public int FixedChatNumCtx { get; set; } = 16384;

    /// <summary>
    /// Fenêtre de contexte FIXE (num_ctx) pour le chat en mode CPU-only. Identique pour warm-up, keep-alive et chat
    /// afin d'éviter les rechargements Ollama. 0 = rétrocompat via <see cref="FixedChatNumCtx"/> / <see cref="NumCtxMin"/>.
    /// Valeur recommandée : 6144 (équilibre prefill / capacité outils).
    /// </summary>
    public int CpuFixedChatNumCtx { get; set; } = 6144;

    /// <summary>
    /// Plafond fixe CPU si le prompt dépasse <see cref="CpuFixedChatNumCtx"/> (jamais adaptatif par requête).
    /// 0 = <c>min(NumCtx, 8192)</c>.
    /// </summary>
    public int CpuFixedChatNumCtxCeiling { get; set; }

    /// <summary>
    /// Taille de batch Ollama (num_batch) en mode CPU-only. 0 = 128.
    /// </summary>
    public int CpuNumBatch { get; set; }

    /// <summary>
    /// Quand true (défaut en CPU via <see cref="UseCompactChatPromptOnCpu"/>), utilise un prompt système condensé
    /// pour réduire le prefill sans retirer les garde-fous anti-hallucination.
    /// </summary>
    public bool UseCompactChatPrompt { get; set; }

    /// <summary>
    /// Active automatiquement <see cref="UseCompactChatPrompt"/> quand InferenceDevice = CpuOnly.
    /// </summary>
    public bool UseCompactChatPromptOnCpu { get; set; } = true;

    /// <summary>
    /// Max tours agent en mode CPU pour requêtes à intention simple (Sales, Stock, etc.). 0 = utilise <see cref="MaxToolCallRounds"/>.
    /// </summary>
    public int CpuMaxToolCallRounds { get; set; } = 1;

    /// <summary>
    /// Nombre de threads CPU exposés à Ollama (num_thread). null = Ollama décide (recommandé sur GPU).
    /// Sur machine CPU-only, fixer ce paramètre au nombre de cœurs physiques peut diminuer la latence par token.
    /// </summary>
    public int? NumThread { get; set; }

    /// <summary>
    /// Taille de batch côté Ollama (num_batch). null = Ollama décide. Valeur typique pour CPU : 256.
    /// </summary>
    public int? NumBatch { get; set; }

    /// <summary>
    /// Active le calcul adaptatif de <c>num_ctx</c> en fonction de la taille réelle du prompt
    /// (cf. <c>AiChatContextSizing.Resolve</c>). false = comportement historique (NumCtx fixe).
    /// </summary>
    public bool AdaptiveContextEnabled { get; set; } = true;

    /// <summary>
    /// Active l'exécution parallèle des tool-calls considérés sûrs (lecture seule, déterministes).
    /// false = exécution strictement séquentielle (comportement historique).
    /// </summary>
    public bool EnableParallelToolCalls { get; set; } = true;

    /// <summary>
    /// Active le cache court (60 s) pour les outils purement déterministes
    /// (<c>resolve_reporting_period</c>, <c>get_tunisian_commercial_calendar</c>).
    /// </summary>
    public bool EnableDeterministicToolCache { get; set; } = true;

    public double Temperature { get; set; } = 0.3;

    /// <summary>
    /// Graine de génération LLM (Ollama <c>seed</c> / OpenRouter <c>seed</c>). null = aléatoire (historique).
    /// Fixée (ex. 42) => réponses reproductibles pour une même question, à température/contexte constants.
    /// </summary>
    public int? Seed { get; set; }

    /// <summary>Échantillonnage nucleus (top_p). null = défaut du modèle (aucun champ envoyé).</summary>
    public double? TopP { get; set; }

    /// <summary>Max agent tool rounds (LLM call + tool execution per round).</summary>
    public int MaxToolCallRounds { get; set; } = 2;

    /// <summary>
    /// Plafond de caractères d'un résultat d'outil réinjecté dans le contexte LLM (au-delà : troncature + marqueur
    /// « [résultat tronqué] »). 2500 historiquement coupait les rapports volumineux (ex. top 20 clients) et poussait
    /// le modèle à inventer les lignes manquantes. 8000 ≈ 2000 tokens, soit ~12 % de NumCtx (16384).
    /// </summary>
    public int MaxToolResultChars { get; set; } = 8000;

    /// <summary>
    /// Plafond par défaut (en lignes) appliqué aux outils de classement (get_sales_revenue, get_product_performance,
    /// get_client_balances) quand le modèle ne fournit pas de <c>top_n</c> explicite. Borne les résultats volumineux
    /// à la source (tri par montant décroissant) AVANT réinjection LLM : évite la troncature au milieu d'une ligne
    /// et garde le prompt court (prefill rapide). Le modèle peut demander un top_n plus petit (ex. « 5 meilleurs »).
    /// Clamp dur à 200 côté exécuteur.
    /// </summary>
    public int DefaultRankingRows { get; set; } = 50;

    /// <summary>
    /// Filet de sécurité (mode chat). Quand true (défaut) : si la boucle agent se termine sur un tour d'appels
    /// d'outils SANS texte produit, un unique appel LLM sans outils synthétise une réponse à partir des résultats
    /// déjà obtenus. Garantit que l'utilisateur n'obtient jamais une réponse vide. false = comportement historique.
    /// </summary>
    public bool ForceFinalSynthesis { get; set; } = true;

    /// <summary>
    /// Seuil minimal (caractères de prose visible, hors fences JSON/ft-meta) pour considérer qu'un tour
    /// agent a produit une réponse complète. En dessous, le filet de synthèse finale se déclenche.
    /// </summary>
    public int MinAssistantTextCharsForCompleteResponse { get; set; } = 80;

    /// <summary>
    /// When true (default), applies a deterministic French fallback (identity template or tool-result
    /// humanization) if forced synthesis still produces insufficient visible prose.
    /// </summary>
    public bool DeterministicFallbackEnabled { get; set; } = true;

    /// <summary>When true (default), salutations and identity questions skip the agent loop and return a template instantly.</summary>
    public bool ConversationalFastPathEnabled { get; set; } = true;

    /// <summary>
    /// Quand true (défaut), le contenu du round final est streamé EN DIRECT au client (segments sûrs,
    /// assainis, throttlés ~200 ms) puis réconcilié à la fin par un content_replace avec le corps
    /// post-traité — identique à celui produit historiquement. false = comportement historique strict
    /// (un seul bloc de contenu émis après la fin complète du round). Aucun impact sur le temps total
    /// de génération : mêmes appels LLM, seul le moment d'affichage change.
    /// </summary>
    public bool LiveContentStreamingEnabled { get; set; } = true;

    /// <summary>
    /// Quand true (défaut) : si la réponse visible finale contient un nom d'outil interne (ex. « resolve_reporting_period »)
    /// — une fuite que le petit modèle produit parfois malgré le prompt — et qu'au moins un outil a été exécuté,
    /// la réponse est remplacée par une synthèse déterministe propre des résultats d'outils (ou un message générique
    /// si aucune donnée exploitable). Garantit qu'aucun identifiant interne n'est jamais montré à l'utilisateur.
    /// </summary>
    public bool RedactInternalToolNamesEnabled { get; set; } = true;

    /// <summary>When true (default), forced synthesis only runs if at least one tool was executed in this request.</summary>
    public bool ForceFinalSynthesisOnlyAfterTools { get; set; } = true;

    /// <summary>When true, pre-calls get_sales_revenue(preset=today) for unambiguous daily revenue questions before the agent loop.</summary>
    public bool SalesTodayPresetShortcutEnabled { get; set; } = true;

    /// <summary>
    /// When true (default), pre-calls get_sales_revenue(preset=current_month) for unambiguous monthly revenue
    /// questions (« CA ce mois-ci ») before the agent loop. Guarantees a tool result is in context so a small
    /// model never returns a clarification/refusal instead of the figure. Independent of
    /// <see cref="SalesTodayPresetShortcutEnabled"/> for reversibility.
    /// </summary>
    public bool SalesMonthPresetShortcutEnabled { get; set; } = true;

    /// <summary>
    /// Quand true (défaut), pré-appelle get_sales_revenue(group_by=Client, top_n=N) pour les questions de
    /// CLASSEMENT clients (« mes 5 meilleurs clients ») avant la boucle agent — le petit modèle choisissait
    /// parfois un mauvais outil (performance produits). Période par défaut si non précisée : last_30_days
    /// (décision produit — un « mois en cours » est dégénéré en début de mois). Même patron réversible que
    /// les deux raccourcis ci-dessus.
    /// </summary>
    public bool SalesClientRankingShortcutEnabled { get; set; } = true;

    /// <summary>
    /// Quand true (défaut), pré-appelle compliance_check_invoice pour une demande non ambiguë de
    /// contrôle de conformité d'une facture (« vérifie la conformité de ma dernière facture »,
    /// « la facture FAC-2026-000123 est-elle conforme ? ») avant la boucle agent — l'outil résout
    /// lui-même la facture (numéro ou plus récente). Même patron réversible que les raccourcis ventes.
    /// </summary>
    public bool ComplianceCheckShortcutEnabled { get; set; } = true;

    /// <summary>
    /// Quand true (défaut), pré-appelle un ou deux outils <c>get_firm_*</c> avant la boucle agent
    /// pour les 19 questions suggérées du Chef de mission (scope <c>FirmMission</c>) — même patron
    /// réversible que les raccourcis ventes/conformité (Lot 1.2 du plan v3). false = plus de
    /// pré-appel déterministe firm (le modèle décide seul, comportement historique).
    /// </summary>
    public bool FirmMissionShortcutEnabled { get; set; } = true;

    /// <summary>
    /// Quand true (défaut), une réponse « données » du scope <c>FirmMission</c> sans lecture firm
    /// exploitable (<c>firmGroundedReads == 0</c>) au tour courant est rejetée : une tentative de
    /// secours est lancée, sinon un repli honnête déterministe est persisté à la place de la prose
    /// non ancrée (Lot 1.3 du plan v3). false = comportement historique (prose 0-outil persistée
    /// telle quelle).
    /// </summary>
    public bool FirmMissionGroundingGateEnabled { get; set; } = true;

    /// <summary>Short-lived positive cache for Ollama /api/tags availability (reduces duplicate HTTP calls per message).</summary>
    public int AvailabilityCacheSeconds { get; set; } = 5;

    /// <summary>Cache duration for model list (/api/tags body) used by IsModelInstalled and GET /api/ai/models.</summary>
    public int ModelListCacheSeconds { get; set; } = 60;

    /// <summary>In-memory cache for tenant system prompt (company name block).</summary>
    public int SystemPromptCacheMinutes { get; set; } = 60;

    /// <summary>Interval between SSE heartbeat events during long AI streams (0 = disabled).</summary>
    public int SseHeartbeatIntervalSeconds { get; set; } = 15;

    /// <summary>
    /// When false, mutating AI tools (create/update/delete, etc.) are hidden from the model and rejected if invoked.
    /// Recommended false in production until validated.
    /// </summary>
    public bool EnableMutationTools { get; set; }

    /// <summary>
    /// Master switch for the Studio "AI-native" tools (studio_*). When false they are rejected even if invoked.
    /// Generation (studio_generate_app) additionally requires <see cref="EnableMutationTools"/> + the design permission.
    /// </summary>
    public bool EnableStudioAiTools { get; set; } = true;

    /// <summary>
    /// When false, <c>studio_generate_system</c> (multi-table apps) is rejected. Recommended false in production until validated.
    /// </summary>
    public bool EnableStudioSystemGeneration { get; set; } = true;

    /// <summary>
    /// Flux « plan → aperçu → confirmation » du Studio IA : quand true, le mode StudioBuilder expose
    /// les outils <c>studio_plan_*</c> (l'IA prépare un plan validé par l'utilisateur, exécuté via un
    /// endpoint REST déterministe) à la place de la génération directe. False (défaut) = comportement
    /// historique strictement inchangé.
    /// </summary>
    public bool EnableStudioAiPlanPreview { get; set; }

    /// <summary>
    /// Outils de MODIFICATION d'artefacts Studio existants (<c>studio_plan_changes</c>,
    /// <c>studio_get_table_schema</c>). Sans effet si <see cref="EnableStudioAiPlanPreview"/> est false :
    /// une modification ne s'applique jamais sans aperçu validé. False (défaut) = l'assistant ne peut
    /// que créer, comme aujourd'hui.
    /// </summary>
    public bool EnableStudioAiModifyTools { get; set; }

    /// <summary>
    /// Coupe-circuit de l'impression PDF des états Studio (endpoint purement additif).
    /// True par défaut : le désactiver retire seulement le bouton d'export, rien d'autre.
    /// </summary>
    public bool EnableStudioReportPdf { get; set; } = true;

    /// <summary>
    /// Outils de création de FENÊTRES par l'assistant (<c>studio_plan_view</c>, <c>studio_list_sql_tables</c>) :
    /// vues LECTURE SEULE sur des tables réelles, via le même fournisseur gardé (<c>SqlSchemaGuard</c>)
    /// que le concepteur humain. Sans effet si <see cref="EnableStudioAiPlanPreview"/> est false.
    /// </summary>
    public bool EnableStudioAiViewTools { get; set; }

    /// <summary>
    /// Moteur d'ÉTATS sur les tables réelles du tenant (<c>SqlReportEngine</c>) : agrégation faite par
    /// SQL, jointures dérivées des clés étrangères réelles, accès filtré par
    /// <c>SqlReportAccessPolicy</c>. False (défaut) = seules les sources historiques
    /// (<c>ExistingDataSourceCatalog</c>) restent disponibles, comportement inchangé.
    /// </summary>
    public bool EnableStudioSqlReportEngine { get; set; }

    /// <summary>
    /// Outils d'ÉTATS de l'assistant Studio (<c>studio_list_report_sources</c>,
    /// <c>studio_describe_report_source</c>, <c>studio_run_report</c>, <c>studio_plan_report</c>).
    /// Sans effet si <see cref="EnableStudioSqlReportEngine"/> est false. False (défaut) = catalogue
    /// d'outils strictement identique à aujourd'hui.
    /// </summary>
    public bool EnableStudioAiReportTools { get; set; }

    /// <summary>
    /// Applique le classement par domaine de <c>SqlReportAccessPolicy</c> AUSSI aux fenêtres
    /// (<c>studio_plan_view</c>, concepteur de fenêtres). False (défaut) = introspection historique
    /// inchangée. Passer un runbook d'impact avant activation : des fenêtres enregistrées sur des
    /// tables sensibles cesseraient de se charger.
    /// </summary>
    public bool EnableStudioSqlSourceGuard { get; set; }

    /// <summary>
    /// Raccourci DÉTERMINISTE d'état : quand la demande de l'utilisateur désigne sans ambiguïté un
    /// état prêt à l'emploi, celui-ci est exécuté AVANT l'appel au modèle (même patron que le
    /// raccourci de contrôle de conformité). Rend le résultat indépendant de la capacité du modèle
    /// configuré à émettre un appel d'outil. Sans effet si <see cref="EnableStudioAiReportTools"/>
    /// ou <see cref="EnableStudioSqlReportEngine"/> est false.
    /// </summary>
    public bool EnableStudioReportShortcut { get; set; }

    /// <summary>Active le « workbench » Studio IA : liste/lecture/édition de plans, création déterministe (from-spec/from-template), capacités détaillées.</summary>
    public bool EnableStudioAiWorkbench { get; set; }

    /// <summary>Active la bibliothèque de modèles tenant, l'import/export ZIP et la duplication de systèmes.</summary>
    public bool EnableStudioTemplates { get; set; }

    /// <summary>Active le constructeur de pages Studio (CRUD pages, rendu serveur des blocs, entrées de navigation).</summary>
    public bool EnableStudioPages { get; set; }

    /// <summary>
    /// Bascule « Modèle avancé » du Studio : expose le modèle plateforme
    /// <c>PlatformAiSettings.StudioAiAdvancedModelRef</c> (GPU distant / cloud) aux utilisateurs du
    /// Studio. False (défaut) = <c>AdvancedModelAvailable</c> reste false et l'option de requête
    /// <c>useAdvancedModel</c> est ignorée : la chaîne de résolution du modèle Studio est inchangée.
    /// Sans effet si aucun modèle avancé n'est configuré en back-office.
    /// </summary>
    public bool EnableStudioAiAdvancedModel { get; set; }

    /// <summary>
    /// Digest de contexte du Studio : injecte dans le prompt StudioBuilder la liste des tables Studio
    /// du tenant (vraies clés + champs) et le dernier plan de l'utilisateur. False (défaut) = prompt
    /// identique à la révision précédente (aucune section « SCHÉMA EXISTANT » / « DERNIER PLAN »).
    /// </summary>
    public bool EnableStudioAiSchemaDigest { get; set; }

    /// <summary>
    /// PR 2.1 — relations plusieurs‑à‑plusieurs du Studio (table de jonction <c>Kind = Junction</c>).
    /// False (défaut) = <c>GET/POST api/studio/entities/{id}/relations[/many-to-many]</c> répondent 404
    /// et <c>CustomEntitySchemaDto.Relations</c> est vide ; la colonne <c>Kind</c> et le filtre serveur
    /// <c>filterField/filterValue</c> des enregistrements restent actifs quoi qu'il arrive.
    /// </summary>
    public bool EnableStudioManyToMany { get; set; }

    /// <summary>
    /// PR 2.3 — vues enregistrées du Studio (Liste / Kanban / Calendrier exécutées côté serveur) et
    /// PATCH partiel d'enregistrement. False (défaut) = <c>api/studio/records/{entityKey}/views[…]</c>
    /// et <c>PATCH api/studio/records/{entityKey}/{id}</c> répondent 404 et
    /// <c>CustomEntitySchemaDto.Views</c> est vide ; la table <c>CustomRecordViewDefinitions</c> reste inerte.
    /// </summary>
    public bool EnableStudioRecordViews { get; set; }

    /// <summary>Active les workflows Studio (moteur d'étapes, API de conception). Flag off ⇒ routes 404, déclencheurs inertes.</summary>
    public bool EnableStudioWorkflows { get; set; } = false;

    /// <summary>Durée max (s) d'un segment d'exécution synchrone du moteur de workflows (borné 1..30).</summary>
    public int StudioWorkflowMaxSegmentSeconds { get; set; } = 5;

    /// <summary>
    /// Durée (minutes) du bail posé sur une instance de workflow avant sa reprise (D-01, D-19 : ajouté en
    /// 4.2c2 — 4.2d le consomme tel quel). Un worker mort sans relâcher son bail laisse l'instance
    /// récupérable par le reaper après ce délai. Borné 5..120 — voir <see cref="StudioWorkflowLeaseDuration"/>.
    /// </summary>
    public int StudioWorkflowLeaseMinutes { get; set; } = 30;

    /// <summary>
    /// Durée effective du bail de reprise : <see cref="StudioWorkflowLeaseMinutes"/> bornée à 5..120 minutes.
    /// Source unique partagée par le runner (pose du bail) et le job (reaper) — calculée, jamais liée à la configuration.
    /// </summary>
    public TimeSpan StudioWorkflowLeaseDuration => TimeSpan.FromMinutes(Math.Clamp(StudioWorkflowLeaseMinutes, 5, 120));

    /// <summary>
    /// Active l'outil IA <c>studio_plan_workflow</c> (PR 4.3) : préparation de plans de workflows à
    /// confirmer. Exige AUSSI <see cref="EnableStudioWorkflows"/> et le flux d'aperçu — règle unique
    /// <c>StudioAiPlanCreation.WorkflowToolsEnabled</c>. <c>false</c> jusqu'à validation manuelle (QA 86–90).
    /// </summary>
    public bool EnableStudioAiWorkflowTools { get; set; } = false;

    /// <summary>
    /// Taille de lot par tenant et par tick du job <c>studio-workflow-resume</c> (reaper, expirations,
    /// reprises, purge). Borné 10..500 par le job (4.2d).
    /// </summary>
    public int StudioWorkflowResumeBatchSize { get; set; } = 100;

    /// <summary>
    /// Rétention (jours) des instances de workflow terminales avant purge par le job
    /// <c>studio-workflow-resume</c>. Borné 30..3650 par le job (4.2d).
    /// </summary>
    public int StudioWorkflowRetentionDays { get; set; } = 180;

    /// <summary>
    /// Taille de lot du balayage d'un déclencheur planifié (4.7b3 / D-47-B05) : au plus ce nombre
    /// d'enregistrements correspondants sont démarrés par tick et par définition ; si le total dépasse
    /// le lot, un avertissement est journalisé et la suite est traitée au prochain tick.
    /// Borné 10..500 par le job. Défaut 100.
    /// </summary>
    public int StudioWorkflowScheduledBatchSize { get; set; } = 100;

    /// <summary>Cartes maximales chargées par une vue Kanban (au-delà, <c>truncated = true</c>). Défaut 500.</summary>
    public int StudioRecordViewMaxKanbanCards { get; set; } = 500;

    /// <summary>Événements maximaux chargés par une vue Calendrier (au-delà, <c>truncated = true</c>). Défaut 1000.</summary>
    public int StudioRecordViewMaxCalendarEvents { get; set; } = 1000;

    /// <summary>PR 2.4 — outil IA <c>studio_plan_record_view</c> et <c>entities[].views[]</c> dans les specs système.
    /// Effectif seulement si <see cref="EnableStudioRecordViews"/> et <see cref="EnableStudioAiPlanPreview"/> sont actifs.</summary>
    public bool EnableStudioAiRecordViewTools { get; set; } = false;

    /// <summary>Export/duplication/import de systèmes Studio (PR 3.3).</summary>
    public bool EnableStudioSystemExport { get; set; } = false;

    /// <summary>Lignes de seed exportées par table (borne).</summary>
    public int StudioExportMaxSeedRows { get; set; } = 200;

    /// <summary>
    /// Budget de tours d'outils quand la requête Studio utilise le modèle avancé (GPU / cloud) :
    /// remplace le plafond CPU (<see cref="CpuMaxToolCallRounds"/>) pour ce seul tour. Borné 1..20.
    /// </summary>
    public int StudioAdvancedMaxToolCallRounds { get; set; } = 4;

    /// <summary>Température des générations StudioBuilder (specs JSON déterministes). Défaut 0.1.</summary>
    public double StudioTemperature { get; set; } = 0.1;

    /// <summary>Taille maximale (caractères) du digest de schéma sur le modèle standard / CPU.</summary>
    public int StudioSchemaDigestMaxCharsCpu { get; set; } = 1200;

    /// <summary>Taille maximale (caractères) du digest de schéma quand le modèle avancé sert la requête.</summary>
    public int StudioSchemaDigestMaxCharsAdvanced { get; set; } = 4000;

    /// <summary>Taille maximale (caractères) du digest « DERNIER PLAN ».</summary>
    public int StudioLastPlanDigestMaxChars { get; set; } = 600;

    /// <summary>Lignes de DÉTAIL renvoyées par un état SQL. Les agrégats restent exacts au-delà.</summary>
    public int StudioReportMaxRows { get; set; } = 5000;

    /// <summary>Délai maximal d'une requête d'état, en secondes (protection de la base tenant).</summary>
    public int StudioReportCommandTimeoutSeconds { get; set; } = 30;

    /// <summary>Maximum conversation messages included in LLM context. Lower values suit smaller models.</summary>
    public int MaxContextMessages { get; set; } = 10;

    /// <summary>
    /// When true, the user message is persisted with the assistant response at end of stream (single DB round-trip)
    /// instead of an extra write before the first LLM token. Improves time-to-first-token.
    /// </summary>
    public bool DeferUserMessagePersist { get; set; } = true;

    /// <summary>
    /// When true, only the most recent messages needed for LLM context are loaded from the database
    /// (see <see cref="MaxContextMessages"/> + slack), instead of the full conversation history.
    /// </summary>
    public bool LoadPartialConversationMessages { get; set; } = true;

    /// <summary>Extra messages loaded beyond <see cref="MaxContextMessages"/> for DB query slack.</summary>
    public int ConversationLoadMessageSlack { get; set; } = 2;

    /// <summary>
    /// When true, exposes a reduced tool catalog based on query intent (sales, stock, accounting, greeting).
    /// Falls back to the full catalog when intent is ambiguous.
    /// </summary>
    public bool EnableToolIntentRouting { get; set; } = true;

    /// <summary>
    /// Kill-switch des assistants experts par module (AgentScope). Quand false, tout scope demandé par le
    /// client est ignoré (résolu None) : l'assistant redevient global sans redéploiement frontend.
    /// </summary>
    public bool EnableAgentScopes { get; set; } = true;

    /// <summary>
    /// When true, read-only report tools may run in parallel using an isolated DI scope per tool (separate DbContext).
    /// </summary>
    public bool EnableParallelDbTools { get; set; } = true;

    /// <summary>Max concurrent read-only DB tool executions per agent round (clamped 1–8).</summary>
    public int MaxParallelDbTools { get; set; } = 3;

    /// <summary>When true, caches read-only DB tool results briefly per tenant (reduces duplicate SQL in agent rounds).</summary>
    public bool EnableReadOnlyToolCache { get; set; } = true;

    /// <summary>TTL in seconds for <see cref="EnableReadOnlyToolCache"/> entries (clamped 5–300).</summary>
    public int ReadOnlyToolCacheSeconds { get; set; } = 45;

    /// <summary>
    /// Flag DÉDIÉ au cache inter-requêtes des outils firm <c>get_firm_*</c> (Lot 3.3). Indépendant de
    /// <see cref="EnableReadOnlyToolCache"/> : un rollback firm ne désactive pas le cache tenant, et
    /// réciproquement. Réservé au scope <c>FirmManager</c> (clé user-scopée <c>TenantId:UserId:Role</c>) ;
    /// <c>FirmAccountant</c> n'est JAMAIS caché inter-requêtes (ACL par affectation — une révocation
    /// resterait visible jusqu'au TTL, fenêtre d'autorisation périmée). La TTL partagée est
    /// <see cref="ReadOnlyToolCacheSeconds"/>. <c>false</c> = pas de cache firm (la mémoïsation
    /// intra-requête du Lot 2.3 reste active). <c>send_fiscal_deadline_reminder</c> n'est jamais cacheable.
    /// </summary>
    public bool FirmMissionReadOnlyToolCacheEnabled { get; set; } = true;

    /// <summary>When true, the host background service pings Ollama periodically to keep the model loaded.</summary>
    public bool KeepAliveEnabled { get; set; }

    /// <summary>Minutes between keep-alive pings (clamped 1–30 by the service).</summary>
    public int KeepAliveIntervalMinutes { get; set; } = 5;

    /// <summary>Ollama <c>keep_alive</c> request parameter, e.g. "30m" (clamped 1–1440 minutes).</summary>
    public int KeepAliveMinutes { get; set; } = 60;

    /// <summary>
    /// Quand false (défaut), le service keep-alive NE maintient PAS le modèle vision (llava) résident en
    /// mémoire : il n'est chargé qu'à la demande lors d'un import photo (via <c>WarmUpModelAsync</c>).
    /// Évite de gaspiller ~4–5 Go de RAM en permanence (cause directe de la pression mémoire / pagination).
    /// true = comportement historique (vision gardée chaude en continu).
    /// </summary>
    public bool KeepVisionModelWarm { get; set; }

    /// <summary>Plafond de tokens générés pour l'import de facture (JSON structuré court).</summary>
    public int ImportMaxOutputTokens { get; set; } = 1536;

    /// <summary>Délai maximal de l'appel LLM d'import (streaming inclus), en secondes.</summary>
    public int ImportLlmTimeoutSeconds { get; set; } = 180;

    /// <summary>Utilise un prompt système condensé pour l'import (moins de tokens d'entrée).</summary>
    public bool UseCompactImportPrompt { get; set; }

    /// <summary>
    /// Modèle vision Ollama pour photos / OCR insuffisant (ex. llava, qwen2.5-vl). Vide = désactivé.
    /// </summary>
    public string InvoiceImportVisionModel { get; set; } = "";

    /// <summary>
    /// Autorise une 2ᵉ passe en vision quand la 1re passe (texte/OCR) rend une réponse
    /// inexploitable. Coupe-circuit d'exploitation : à <c>false</c>, un seul appel LLM par import.
    /// </summary>
    public bool InvoiceImportVisionRetryEnabled { get; set; } = true;

    /// <summary>
    /// Transmet à Ollama un SCHÉMA JSON (clé <c>format</c>) plutôt que le simple <c>"json"</c>, ce
    /// qui contraint les types produits par le modèle. Nécessite Ollama ≥ 0.5 ; en cas de rejet, le
    /// pipeline retombe automatiquement sur <c>"json"</c>. Sans effet sur OpenRouter.
    /// </summary>
    public bool UseStructuredOutputSchema { get; set; } = true;

    /// <summary>
    /// Nombre de caractères de la réponse LLM brute journalisés lorsqu'elle est inexploitable.
    ///
    /// <para><b>Attention</b> : cette trace contient des données de facture (raison sociale,
    /// matricule fiscal, montants). La relever au-delà de 500 en production suppose que les journaux
    /// sont traités comme des données à caractère personnel. L'extrait ciblé autour de l'erreur,
    /// lui, est toujours journalisé et reste borné.</para>
    /// </summary>
    public int ImportRawResponseLogChars { get; set; } = 500;

    /// <summary>Seuil minimal de caractères OCR avant déclenchement du fallback vision.</summary>
    public int InvoiceImportVisionMinOcrChars { get; set; } = 80;

    /// <summary>Déclenche le fallback vision si l'OCR est vide (photos manuscrites).</summary>
    public bool InvoiceImportVisionOnEmptyOcr { get; set; } = true;

    /// <summary>
    /// Utilise le modèle vision pour toute pièce au format image (PNG/JPG), même si l'OCR semble suffisant.
    /// </summary>
    public bool InvoiceImportVisionOnImages { get; set; } = true;
}
