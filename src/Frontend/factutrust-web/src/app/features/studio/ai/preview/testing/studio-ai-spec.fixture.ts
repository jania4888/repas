import {
  StudioAiPlanListItemDto,
  StudioAiPlanPreviewDto,
  StudioSystemExportDto,
  StudioSystemSpec
} from '../../studio-ai.models';

/**
 * Spec canonique de référence pour les specs de l'aperçu (forme réellement émise par le backend P0).
 *
 * Contenu : 2 entités, une relation entre entités (`demandes.employe_id` → `employes`), une relation
 * ERP (`demandes.client_id` → `clients`), un formulaire à 2 sections, des données de référence et un
 * rapport. Chaque appel renvoie une copie fraîche : les tests peuvent muter le résultat sans se
 * contaminer entre eux.
 */
export function studioAiSpecFixture(): StudioSystemSpec {
  return {
    system: {
      displayName: 'Gestion des congés',
      icon: 'fa-solid fa-umbrella-beach',
      description: 'Suivi des demandes de congés et de leurs validations.',
      onboarding: ['Créer les types de congés', 'Saisir une première demande']
    },
    entities: [
      {
        ref: 'employes',
        displayName: 'Employé',
        displayNamePlural: 'Employés',
        icon: 'fa-solid fa-user',
        description: 'Personnel concerné par les congés.',
        fields: [
          { key: 'matricule', label: 'Matricule', type: 'text', required: true, unique: true },
          { key: 'nom', label: 'Nom', type: 'text', required: true, unique: false },
          {
            key: 'statut',
            label: 'Statut',
            type: 'select',
            required: false,
            unique: false,
            options: [
              { value: 'actif', label: 'Actif' },
              { value: 'inactif', label: 'Inactif' }
            ]
          }
        ]
      },
      {
        ref: 'demandes',
        displayName: 'Demande de congé',
        displayNamePlural: 'Demandes de congés',
        icon: 'fa-solid fa-calendar-days',
        fields: [
          { key: 'employe_id', label: 'Employé', type: 'relation', required: true, unique: false, relationTo: 'employes' },
          { key: 'client_id', label: 'Client concerné', type: 'relation', required: false, unique: false, relationTo: 'clients' },
          { key: 'date_debut', label: 'Date de début', type: 'date', required: true, unique: false },
          { key: 'nb_jours', label: 'Nombre de jours', type: 'number', required: true, unique: false },
          { key: 'montant', label: 'Indemnité', type: 'money', required: false, unique: false, config: { currency: 'EUR' } }
        ],
        form: {
          sections: [
            {
              title: 'Demandeur',
              fields: [
                { field: 'employe_id', width: 'half' },
                { field: 'client_id', width: 'half' }
              ]
            },
            {
              title: 'Période',
              fields: [
                { field: 'date_debut', width: 'half' },
                { field: 'nb_jours', width: 'half' },
                { field: 'montant', width: 'full' }
              ]
            }
          ]
        },
        report: {
          displayName: 'État des congés',
          groupBy: ['employe_id'],
          measures: [{ fn: 'sum', field: 'nb_jours' }, { fn: 'count' }],
          columns: ['employe_id', 'date_debut', 'nb_jours'],
          filters: [{ field: 'nb_jours', op: 'gte', value: 1 }],
          sort: [{ field: 'date_debut', dir: 'desc' }]
        }
      }
    ],
    seed: [
      {
        entityRef: 'employes',
        records: [
          { matricule: 'E-001', nom: 'Dupont', statut: 'actif' },
          { matricule: 'E-002', nom: 'Martin', statut: 'inactif' }
        ]
      }
    ]
  };
}

/**
 * Même système avec un champ `statut` (Select) ajouté à `demandes`, des vues enregistrées sur
 * `demandes` (un mode canonique `kanban` groupé sur `statut`, un alias français `calendrier`) et une
 * relation racine N-N `employes ↔ demandes` — sert aux tests de
 * `countSpec`, `counterChips` et de l'onglet « Vues ».
 */
export function studioAiSpecWithViewsFixture(): StudioSystemSpec {
  const spec = studioAiSpecFixture();
  const demandes = spec.entities.find(e => e.ref === 'demandes');
  if (demandes) {
    // D5 (3.4n) : la vue kanban groupe sur `statut`, qui doit exister sur `demandes` (6 champs ici, 9 au total).
    demandes.fields = [
      ...demandes.fields,
      {
        key: 'statut',
        label: 'Statut',
        type: 'select',
        required: false,
        unique: false,
        options: [
          { value: 'soumise', label: 'Soumise' },
          { value: 'validee', label: 'Validée' },
          { value: 'refusee', label: 'Refusée' }
        ]
      }
    ];
    demandes.views = [
      { name: 'Par statut', mode: 'kanban', groupBy: 'statut' },
      { name: 'Calendrier', mode: 'calendrier', start: 'date_debut', end: 'nb_jours' }
    ];
  }
  spec.relations = [{ kind: 'many_to_many', from: 'employes', to: 'demandes', junctionName: 'employes_demandes' }];
  return spec;
}

/**
 * Aperçu structuré (`GET {id}/preview`) miroir de `studioAiSpecFixture()` : 2 entités, `seedSample`
 * de 2 lignes sur `employes`, 1 relation N-N, aucun workflow (3.x).
 */
export function studioAiPlanPreviewFixture(): StudioAiPlanPreviewDto {
  return {
    planId: 'p-preview-1',
    kind: 'CreateSystem',
    status: 'Pending',
    title: 'Gestion des congés',
    entities: [
      {
        ref: 'employes',
        displayName: 'Employé',
        existingKey: null,
        fields: [
          { key: 'matricule', label: 'Matricule', fieldType: 'Text', required: true, unique: true, options: null, relationToRef: null },
          { key: 'nom', label: 'Nom', fieldType: 'Text', required: true, unique: false, options: null, relationToRef: null },
          { key: 'statut', label: 'Statut', fieldType: 'Select', required: false, unique: false, options: ['Actif', 'Inactif'], relationToRef: null }
        ],
        formLayout: null,
        views: [],
        seedCount: 2,
        seedSample: [
          { matricule: 'E-001', nom: 'Dupont', statut: 'actif' },
          { matricule: 'E-002', nom: 'Martin', statut: 'inactif' }
        ]
      },
      {
        ref: 'demandes',
        displayName: 'Demande de congé',
        existingKey: null,
        fields: [
          { key: 'employe_id', label: 'Employé', fieldType: 'RelationCustom', required: true, unique: false, options: null, relationToRef: 'employes' },
          { key: 'client_id', label: 'Client concerné', fieldType: 'RelationExisting', required: false, unique: false, options: null, relationToRef: null },
          { key: 'date_debut', label: 'Date de début', fieldType: 'Date', required: true, unique: false, options: null, relationToRef: null },
          { key: 'nb_jours', label: 'Nombre de jours', fieldType: 'Number', required: true, unique: false, options: null, relationToRef: null },
          { key: 'montant', label: 'Indemnité', fieldType: 'Money', required: false, unique: false, options: null, relationToRef: null }
        ],
        formLayout: {
          sections: [
            { title: 'Demandeur', fields: [{ key: 'employe_id', width: 'half', labelOverride: null }, { key: 'client_id', width: 'half', labelOverride: null }] },
            {
              title: 'Période',
              fields: [
                { key: 'date_debut', width: 'half', labelOverride: null },
                { key: 'nb_jours', width: 'half', labelOverride: null },
                { key: 'montant', width: 'full', labelOverride: null }
              ]
            }
          ]
        },
        views: [{ mode: 'kanban', displayName: 'Par statut' }],
        seedCount: 0,
        seedSample: []
      }
    ],
    relations: [{ kind: 'many_to_many', fromRef: 'employes', toRef: 'demandes', label: null, junctionName: 'employes_demandes' }],
    amendment: null,
    workflows: [],
    warnings: [],
    duplicates: []
  };
}

/** Ligne d'historique (`GET api/studio/ai/plans`) avec les 5 clés PR 3.x ; `overrides` écrase les valeurs par défaut. */
export function studioAiPlanListItemFixture(overrides: Partial<StudioAiPlanListItemDto> = {}): StudioAiPlanListItemDto {
  return {
    id: 'p-list-1',
    kind: 'CreateSystem',
    status: 'Completed',
    title: 'Gestion des congés',
    entityCount: 2,
    createdAt: '2026-09-15T10:00:00Z',
    expiresAt: '2026-09-15T10:15:00Z',
    executedAt: '2026-09-15T10:05:00Z',
    systemKey: 'gestion_des_conges',
    errorMessage: null,
    openUrl: '/studio/systems/gestion_des_conges',
    relationCount: 1,
    viewCount: 2,
    replayable: true,
    ...overrides
  };
}

/** Export d'un système (`GET systems/{key}/export`) : `spec` = fixture avec vues, sans seed (`includesSeed: false`). */
export function studioSystemExportFixture(): StudioSystemExportDto {
  const spec = studioAiSpecWithViewsFixture();
  delete spec.seed;
  return {
    specVersion: 1,
    systemKey: 'gestion_des_conges',
    systemDisplayName: 'Gestion des congés',
    exportedAt: '2026-09-15T10:30:00Z',
    entityCount: 2,
    relationCount: 1,
    viewCount: 2,
    includesSeed: false,
    warnings: [],
    spec
  };
}
