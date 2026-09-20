import { HttpErrorResponse } from '@angular/common/http';
import {
  CustomField,
  CustomFieldType,
  FieldValidationRules,
  FormLayout,
  FormSection,
  SelectOption
} from '@shared/studio-runtime/studio-runtime.models';
import { STUDIO_AI_LABELS, formatLabel } from './studio-ai-labels';
import {
  STUDIO_SPEC_LIMITS,
  StudioAppSpec,
  StudioSpecChange,
  StudioSpecCounters,
  StudioSpecEntity,
  StudioSpecField,
  StudioSpecFieldType,
  StudioSystemSpec,
  isAppSpec,
  isErpRelationTarget,
  isSystemSpec,
  toSystemSpecView
} from './studio-ai.models';

/**
 * Fonctions pures autour de la spec canonique Studio IA.
 *
 * Tout ce qui se calcule sans réseau vit ici pour être testable directement (convention du dépôt) :
 * clonage, (dé)sérialisation, erreurs HTTP → message FR, bornes/intégrité de la spec, passerelles
 * vers les modèles runtime (`CustomField`, `FormLayout`) pour le sandbox, et les helpers d'édition
 * (`diffSpec`, `summarizeChanges`, `parseCsv`) prévus pour le mode Personnaliser (PR 3.4) — couverts par
 * leurs specs, sans consommateur en 1.4.
 */

/** Puces de compteurs (en-tête de l'aperçu, Vue d'ensemble) dans l'ordre canonique. */
export function counterChips(counters: StudioSpecCounters): { label: string; value: number }[] {
  const labels = STUDIO_AI_LABELS.preview;
  return [
    { label: labels.tables, value: counters.entities },
    { label: labels.fields, value: counters.fields },
    { label: labels.relations, value: counters.relations },
    { label: labels.forms, value: counters.forms },
    { label: labels.seedRecords, value: counters.seedRecords },
    { label: labels.reports, value: counters.reports },
    // Puce « Vues » seulement quand la spec en propose (les specs P0 n'en ont pas : 6 puces inchangées).
    ...(counters.views > 0 ? [{ label: STUDIO_AI_LABELS.views.title, value: counters.views }] : [])
  ];
}

/** Clone profond structurel — la spec est un JSON pur, `structuredClone` suffit. */
export function cloneSpec<T>(spec: T): T {
  return structuredClone(spec);
}

/** Sérialisation stable envoyée au serveur (`specJson`) : 2 espaces, ordre des clés d'origine. */
export function serializeSpec(spec: unknown): string {
  return JSON.stringify(spec, null, 2);
}

/**
 * Lit une spec reçue du serveur (objet déjà désérialisé OU chaîne JSON, le backend ayant fait les
 * deux selon les endpoints). Renvoie `null` si le contenu n'a la forme ni d'un système ni d'une app.
 */
export function parseSpecPayload(payload: unknown): StudioSystemSpec | StudioAppSpec | null {
  let value = payload;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (isSystemSpec(value) || isAppSpec(value)) return value;
  return null;
}

/**
 * Message utilisateur pour une erreur HTTP de l'atelier. Les endpoints P0 renvoient 404 aussi bien
 * pour « plan introuvable / pas à vous » que pour « atelier désactivé » : `context` lève l'ambiguïté.
 */
export function studioAiHttpError(
  err: unknown,
  context: 'plan' | 'workbench' | 'generic' = 'generic'
): string {
  const labels = STUDIO_AI_LABELS.errors;
  if (err instanceof HttpErrorResponse) {
    const serverMessage = extractServerMessage(err);
    switch (err.status) {
      case 0: return labels.network;
      case 400: return serverMessage ?? labels.invalidSpec;
      case 401: return labels.unauthorized;
      case 403: return labels.forbidden;
      case 404: return context === 'plan' ? labels.planNotFound : labels.workbenchDisabled;
      case 409: return labels.conflict;
      case 413: return labels.tooLarge;
      case 429: return labels.rateLimited;
      default: return serverMessage ?? labels.generic;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return labels.generic;
}

function extractServerMessage(err: HttpErrorResponse): string | null {
  const body = err.error as { message?: unknown; errors?: unknown } | string | null | undefined;
  if (!body || typeof body === 'string') return null;
  if (Array.isArray(body.errors) && body.errors.length > 0 && typeof body.errors[0] === 'string') {
    return body.errors.filter((e): e is string => typeof e === 'string').join(' ');
  }
  return typeof body.message === 'string' && body.message.trim() ? body.message : null;
}

// ---------------------------------------------------------------------------------------------
// Clés (slug) — mêmes règles que `StudioAiSpecParser.Slugify` côté serveur
// ---------------------------------------------------------------------------------------------

/** Longueur maximale d'une clé de champ / d'entité acceptée par le serveur. */
const SLUG_MAX_LENGTH = 64;

/**
 * Transforme un libellé en clé technique : minuscules, accents retirés, tout ce qui n'est pas
 * `[a-z0-9]` devient `_` (répétitions repliées, bords coupés), 64 caractères au plus. Une clé doit
 * commencer par une lettre : sinon elle est préfixée `f_` (`« 2 e trimestre » → f_2_e_trimestre`).
 * Un libellé vide donne `field` (le composant ajoutera un suffixe unique).
 */
export function slugify(label: string): string {
  const base = (label ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, SLUG_MAX_LENGTH);
  if (!base) return 'field';
  const prefixed = /^[a-z]/.test(base) ? base : `f_${base}`;
  return prefixed.slice(0, SLUG_MAX_LENGTH).replace(/_+$/g, '');
}

/** Rend `base` unique face aux clés déjà prises en ajoutant `_2`, `_3`… (jamais `_1`). */
export function uniqueKey(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

// ---------------------------------------------------------------------------------------------
// Bornes et cohérence de la spec (contrôles locaux, avant tout appel serveur)
// ---------------------------------------------------------------------------------------------

/**
 * Messages FR des contrôles de bornes. Ils restent locaux à ce fichier (ce ne sont pas des libellés
 * d'écran) ; les jetons `{…}` sont remplacés par `formatLabel`.
 */
const BOUND_MESSAGES = {
  tooManyEntities: 'Trop de tables : {count} proposées, {max} au maximum.',
  tooManyFields: 'La table « {entity} » a {count} champs : {max} au maximum.',
  tooManySeedRecords: 'La table « {entity} » a {count} valeurs de référence : {max} au maximum.',
  duplicateEntity: 'Deux tables portent la même clé « {ref} ».',
  duplicateField: 'La table « {entity} » contient deux champs « {key} ».',
  unknownRelationTarget: 'Le champ « {field} » de la table « {entity} » pointe vers une table inconnue « {target} ».',
  missingRelationTarget: 'Le champ « {field} » de la table « {entity} » est une relation sans table cible.'
} as const;

/**
 * Vérifie localement ce que le parseur serveur refuserait (8 tables / 40 champs / 200 valeurs de
 * référence, clés en double, relations pendantes). Renvoie `[]` quand la spec est acceptable.
 */
export function checkSpecBounds(spec: StudioSystemSpec): string[] {
  const messages: string[] = [];
  const entities = spec?.entities ?? [];

  if (entities.length > STUDIO_SPEC_LIMITS.maxEntities) {
    messages.push(formatLabel(BOUND_MESSAGES.tooManyEntities, {
      count: entities.length,
      max: STUDIO_SPEC_LIMITS.maxEntities
    }));
  }

  const refs = new Set<string>();
  for (const entity of entities) {
    if (refs.has(entity.ref)) {
      messages.push(formatLabel(BOUND_MESSAGES.duplicateEntity, { ref: entity.ref }));
    }
    refs.add(entity.ref);
  }

  for (const entity of entities) {
    const fields = entity.fields ?? [];
    const name = entity.displayName || entity.ref;
    if (fields.length > STUDIO_SPEC_LIMITS.maxFields) {
      messages.push(formatLabel(BOUND_MESSAGES.tooManyFields, {
        entity: name,
        count: fields.length,
        max: STUDIO_SPEC_LIMITS.maxFields
      }));
    }
    const keys = new Set<string>();
    for (const field of fields) {
      if (keys.has(field.key)) {
        messages.push(formatLabel(BOUND_MESSAGES.duplicateField, { entity: name, key: field.key }));
      }
      keys.add(field.key);
      if (field.type !== 'relation') continue;
      if (!field.relationTo) {
        messages.push(formatLabel(BOUND_MESSAGES.missingRelationTarget, { entity: name, field: field.label || field.key }));
      } else if (!refs.has(field.relationTo) && !isErpRelationTarget(field.relationTo)) {
        messages.push(formatLabel(BOUND_MESSAGES.unknownRelationTarget, {
          entity: name,
          field: field.label || field.key,
          target: field.relationTo
        }));
      }
    }
  }

  for (const block of spec?.seed ?? []) {
    const count = block.records?.length ?? 0;
    if (count <= STUDIO_SPEC_LIMITS.maxSeedRecords) continue;
    const entity = entities.find(e => e.ref === block.entityRef);
    messages.push(formatLabel(BOUND_MESSAGES.tooManySeedRecords, {
      entity: entity?.displayName || block.entityRef,
      count,
      max: STUDIO_SPEC_LIMITS.maxSeedRecords
    }));
  }

  return messages;
}

/**
 * Nettoie une spec de ses références pendantes (champ supprimé encore cité par un formulaire ou un
 * rapport, bloc de données de référence d'une table disparue, relation vers une table renommée).
 * Fonction pure : l'entrée n'est jamais modifiée, un clone nettoyé est renvoyé.
 */
export function ensureIntegrity(spec: StudioSystemSpec): StudioSystemSpec {
  const next = cloneSpec(spec);
  const entities = next.entities ?? [];
  const refs = new Set(entities.map(e => e.ref));

  for (const entity of entities) {
    const fields = entity.fields ?? [];
    // 1. Relations : cible inconnue ⇒ champ retiré (relation) ou `relationTo` effacé (autre type).
    entity.fields = fields.filter(field => {
      const target = field.relationTo;
      const valid = !!target && (refs.has(target) || isErpRelationTarget(target));
      if (field.type === 'relation') return valid;
      if (target && !valid) delete field.relationTo;
      return true;
    });

    const keys = new Set(entity.fields.map(f => f.key));

    // 2. Formulaire : sections vidées de leurs champs inconnus, formulaire retiré s'il ne reste rien.
    if (entity.form) {
      const sections = (entity.form.sections ?? [])
        .map(section => ({ ...section, fields: (section.fields ?? []).filter(ref => keys.has(ref.field)) }))
        .filter(section => section.fields.length > 0);
      if (sections.length > 0) entity.form = { ...entity.form, sections };
      else delete entity.form;
    }

    // 3. Rapport : dimensions, mesures, colonnes, tris et filtres restreints aux champs existants.
    if (entity.report) {
      const report = { ...entity.report };
      const groupBy = (report.groupBy ?? []).filter(k => keys.has(k));
      report.groupBy = groupBy.length > 0 ? groupBy : undefined;
      const measures = (report.measures ?? []).filter(m => !m.field || keys.has(m.field));
      report.measures = measures.length > 0 ? measures : undefined;
      const columns = (report.columns ?? []).filter(k => keys.has(k));
      report.columns = columns.length > 0 ? columns : undefined;
      const sort = (report.sort ?? []).filter(s => keys.has(s.field));
      report.sort = sort.length > 0 ? sort : undefined;
      const filters = (report.filters ?? []).filter(f => keys.has(f.field));
      report.filters = filters.length > 0 ? filters : undefined;
      entity.report = report;
    }
  }

  // 4. Données de référence : les blocs d'une table inconnue sont abandonnés.
  if (next.seed) next.seed = next.seed.filter(block => refs.has(block.entityRef));

  return next;
}

// ---------------------------------------------------------------------------------------------
// Spec → modèles du runtime Studio (bac à sable : DynamicFormComponent / DynamicTableComponent)
// ---------------------------------------------------------------------------------------------

/** Correspondance type de spec → `CustomFieldType` du runtime (les relations sont traitées à part). */
const SPEC_TYPE_TO_RUNTIME: Record<StudioSpecFieldType, CustomFieldType> = {
  text: CustomFieldType.Text,
  multilinetext: CustomFieldType.MultilineText,
  number: CustomFieldType.Number,
  decimal: CustomFieldType.Decimal,
  boolean: CustomFieldType.Boolean,
  date: CustomFieldType.Date,
  datetime: CustomFieldType.DateTime,
  select: CustomFieldType.Select,
  multiselect: CustomFieldType.MultiSelect,
  money: CustomFieldType.Money,
  percentage: CustomFieldType.Percentage,
  rating: CustomFieldType.Rating,
  qrcode: CustomFieldType.QrCode,
  barcode: CustomFieldType.Barcode,
  autonumber: CustomFieldType.AutoNumber,
  attachment: CustomFieldType.Attachment,
  signature: CustomFieldType.Signature,
  relation: CustomFieldType.RelationCustom
};

/** Type runtime d'un champ de spec ; une relation vers l'ERP devient `RelationExisting`. */
export function specFieldTypeToRuntime(field: StudioSpecField): CustomFieldType {
  if (field.type === 'relation') {
    return isErpRelationTarget(field.relationTo) ? CustomFieldType.RelationExisting : CustomFieldType.RelationCustom;
  }
  return SPEC_TYPE_TO_RUNTIME[field.type] ?? CustomFieldType.Text;
}

/**
 * Convertit un champ de spec en `CustomField` du runtime pour le bac à sable : **aucun appel réseau**.
 * L'identifiant est synthétique (`entité:champ`) puisque rien n'existe encore en base ; les options
 * d'une relation sont dérivées des données de référence de la table cible, ce qui permet au
 * `DynamicFormComponent` d'afficher un `p-select` renseigné sans jamais interroger le serveur.
 */
export function specFieldToCustomField(
  field: StudioSpecField,
  entityKey: string,
  index: number,
  spec: StudioSystemSpec
): CustomField {
  const fieldType = specFieldTypeToRuntime(field);
  const isRelation = field.type === 'relation';
  const options: SelectOption[] | null = isRelation
    ? relationOptions(field.relationTo, spec)
    : (field.options?.length ? field.options.map(o => ({ value: o.value, label: o.label })) : null);
  return {
    id: `${entityKey}:${field.key}`,
    key: field.key,
    label: field.label || field.key,
    fieldType,
    isRequired: !!field.required,
    isUnique: !!field.unique,
    sortOrder: index,
    rules: specFieldRules(field),
    options,
    relation: field.relationTo
      ? { kind: isErpRelationTarget(field.relationTo) ? 'existing' : 'custom', ref: field.relationTo }
      : null,
    isActive: true,
    config: specFieldConfig(field)
  };
}

/** Valeurs sélectionnables d'une relation : les données de référence de la table cible (jamais le réseau). */
function relationOptions(target: string | undefined, spec: StudioSystemSpec): SelectOption[] {
  if (!target) return [];
  const entity = (spec?.entities ?? []).find(e => e.ref === target);
  if (!entity) return [];
  const records = (spec.seed ?? []).find(s => s.entityRef === target)?.records ?? [];
  const labelKey = (entity.fields ?? []).find(f => f.type === 'text')?.key;
  return records.map((record, i) => {
    const raw = labelKey ? record[labelKey] : undefined;
    const label = raw != null && String(raw).trim() ? String(raw) : `${entity.displayName} ${i + 1}`;
    return { value: label, label };
  });
}

/** `config` du runtime (imbriqué par famille : `money.currency`, `rating.max`, `render.format`). */
function specFieldConfig(field: StudioSpecField): Record<string, unknown> | null {
  const config = field.config;
  if (!config) return null;
  const out: Record<string, unknown> = {};
  if (field.type === 'money' && typeof config.currency === 'string') out['money'] = { currency: config.currency };
  if (field.type === 'rating' && typeof config.max === 'number') out['rating'] = { max: config.max };
  if ((field.type === 'barcode' || field.type === 'qrcode') && typeof config.format === 'string') {
    out['render'] = { format: config.format };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Règles de validation dérivées du `config` : `max` borne la valeur (nombres) ou la longueur (textes). */
function specFieldRules(field: StudioSpecField): FieldValidationRules | null {
  const max = field.config?.max;
  if (typeof max !== 'number' || field.type === 'rating') return null;
  if (field.type === 'text' || field.type === 'multilinetext') return { maxLength: max };
  if (field.type === 'number' || field.type === 'decimal' || field.type === 'money' || field.type === 'percentage') {
    return { max };
  }
  return null;
}

/**
 * Mise en page de saisie du runtime à partir du formulaire de la spec ; `null` quand la spec ne
 * propose rien (le `DynamicFormComponent` retombe alors sur une section unique pleine largeur).
 */
export function specFormToLayout(entity: StudioSpecEntity): FormLayout | null {
  const sections = entity?.form?.sections ?? [];
  if (sections.length === 0) return null;
  const mapped: FormSection[] = sections.map(section => ({
    title: section.title?.trim() ? section.title : null,
    fields: (section.fields ?? []).map(ref => ({
      key: ref.field,
      labelOverride: ref.label ?? null,
      width: ref.width === 'half' ? 'half' : 'full'
    }))
  }));
  return { sections: mapped };
}

/** Tous les champs d'une entité de spec en `CustomField[]` (ordre de la spec). */
export function specEntityToCustomFields(entity: StudioSpecEntity, spec: StudioSystemSpec): CustomField[] {
  return (entity.fields ?? []).map((field, i) => specFieldToCustomField(field, entity.ref, i, spec));
}

// ---- Édition : différences, résumé FR, collage CSV --------------------------------------------------

/** Aplatissement stable d'une valeur pour comparer deux nœuds de spec sans dépendre de l'ordre des clés. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(',')}}`;
}

function sameValue(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function entityLabel(entity: StudioSpecEntity | undefined, ref: string): string {
  return entity?.displayName || ref;
}

/**
 * Compare la spec serveur (`base`) et le brouillon (`draft`) et renvoie la liste des changements,
 * entité par entité : tables ajoutées/supprimées/renommées/réutilisées, champs ajoutés/supprimés/modifiés,
 * formulaire, rapport, données de référence et paramètres du système. Pur, sans DOM.
 */
export function diffSpec(base: StudioSystemSpec | StudioAppSpec, draft: StudioSystemSpec | StudioAppSpec): StudioSpecChange[] {
  const before = toSystemSpecView(base);
  const after = toSystemSpecView(draft);
  const changes: StudioSpecChange[] = [];
  const labels = STUDIO_AI_LABELS.changes;

  if (!sameValue(before.system, after.system)) {
    changes.push({ path: 'system', kind: 'changed', label: labels.systemChanged, before: before.system, after: after.system });
  }

  const beforeByRef = new Map((before.entities ?? []).map(e => [e.ref, e] as const));
  const afterByRef = new Map((after.entities ?? []).map(e => [e.ref, e] as const));

  for (const [ref, entity] of beforeByRef) {
    if (!afterByRef.has(ref)) {
      changes.push({
        path: `entities.${ref}`, kind: 'removed',
        label: formatLabel(labels.entityRemoved, { entity: entityLabel(entity, ref) }), before: entity
      });
    }
  }

  for (const [ref, next] of afterByRef) {
    const prev = beforeByRef.get(ref);
    if (!prev) {
      changes.push({
        path: `entities.${ref}`, kind: 'added',
        label: formatLabel(labels.entityAdded, { entity: entityLabel(next, ref) }), after: next
      });
      continue;
    }
    if (prev.displayName !== next.displayName || prev.displayNamePlural !== next.displayNamePlural) {
      changes.push({
        path: `entities.${ref}.displayName`, kind: 'changed',
        label: formatLabel(labels.entityRenamed, { before: prev.displayName, after: next.displayName }),
        before: prev.displayName, after: next.displayName
      });
    }
    if ((prev.existingKey ?? null) !== (next.existingKey ?? null) && next.existingKey) {
      changes.push({
        path: `entities.${ref}.existingKey`, kind: 'changed',
        label: formatLabel(labels.entityReused, { entity: entityLabel(next, ref), existingKey: next.existingKey }),
        before: prev.existingKey ?? null, after: next.existingKey
      });
    }
    diffFields(ref, prev, next, changes);
    if (!sameValue(prev.form ?? null, next.form ?? null)) {
      changes.push({
        path: `entities.${ref}.form`, kind: 'changed',
        label: formatLabel(labels.formChanged, { entity: entityLabel(next, ref) }), before: prev.form, after: next.form
      });
    }
    if (!sameValue(prev.report ?? null, next.report ?? null)) {
      changes.push({
        path: `entities.${ref}.report`, kind: 'changed',
        label: formatLabel(labels.reportChanged, { entity: entityLabel(next, ref) }), before: prev.report, after: next.report
      });
    }
    if (!sameValue(prev.views ?? null, next.views ?? null)) {
      changes.push({
        path: `entities.${ref}.views`, kind: 'changed',
        label: formatLabel(labels.viewsChanged, { entity: entityLabel(next, ref) }),
        before: prev.views ?? null, after: next.views ?? null
      });
    }
  }

  const seedBefore = new Map((before.seed ?? []).map(s => [s.entityRef, s.records] as const));
  const seedAfter = new Map((after.seed ?? []).map(s => [s.entityRef, s.records] as const));
  for (const ref of new Set([...seedBefore.keys(), ...seedAfter.keys()])) {
    if (!sameValue(seedBefore.get(ref) ?? [], seedAfter.get(ref) ?? [])) {
      changes.push({
        path: `seed.${ref}`, kind: 'changed',
        label: formatLabel(labels.seedChanged, { entity: entityLabel(afterByRef.get(ref) ?? beforeByRef.get(ref), ref) }),
        before: seedBefore.get(ref), after: seedAfter.get(ref)
      });
    }
  }
  return changes;
}

function diffFields(ref: string, prev: StudioSpecEntity, next: StudioSpecEntity, out: StudioSpecChange[]): void {
  const prevByKey = new Map((prev.fields ?? []).map(f => [f.key, f] as const));
  const nextByKey = new Map((next.fields ?? []).map(f => [f.key, f] as const));
  const entity = entityLabel(next, ref);
  for (const [key, field] of prevByKey) {
    if (!nextByKey.has(key)) {
      out.push({ path: `entities.${ref}.fields.${key}`, kind: 'removed', label: `${field.label} — ${entity}`, before: field });
    }
  }
  for (const [key, field] of nextByKey) {
    const old = prevByKey.get(key);
    if (!old) {
      out.push({ path: `entities.${ref}.fields.${key}`, kind: 'added', label: `${field.label} — ${entity}`, after: field });
    } else if (!sameValue(old, field)) {
      out.push({ path: `entities.${ref}.fields.${key}`, kind: 'changed', label: `${field.label} — ${entity}`, before: old, after: field });
    }
  }

  // Réordonnancement (3.4g2) : le diff par clé est insensible à l'ordre, or l'ordre de la spec
  // commande le `sortOrder` des champs créés — un déplacement seul doit rester enregistrable.
  const prevOrder = (prev.fields ?? []).map(f => f.key);
  const nextOrder = (next.fields ?? []).map(f => f.key);
  const sameKeySet = prevOrder.length === nextOrder.length && prevOrder.every(key => nextByKey.has(key));
  if (sameKeySet && prevOrder.some((key, i) => key !== nextOrder[i])) {
    out.push({
      path: `entities.${ref}.fields`, kind: 'changed',
      label: formatLabel(STUDIO_AI_LABELS.changes.fieldsReordered, { entity }),
      before: prevOrder, after: nextOrder
    });
  }
}

const FIELD_PATH = /^entities\.([^.]+)\.fields\.[^.]+$/;

/**
 * Résume les changements en phrases FR groupées par table : « 2 champ(s) ajouté(s) à Projets »,
 * « Table « Clients » renommée « Clients (2) » »… (utilisé par « Régénérer avec ces modifications »).
 */
export function summarizeChanges(changes: StudioSpecChange[]): string[] {
  const labels = STUDIO_AI_LABELS.changes;
  const lines: string[] = [];
  const fieldGroups = new Map<string, { entity: string; added: number; removed: number; changed: number }>();

  for (const change of changes) {
    const m = FIELD_PATH.exec(change.path);
    if (!m) { lines.push(change.label); continue; }
    const ref = m[1];
    // Les chemins de champs ne viennent que de `diffFields`, dont le libellé est « <champ> — <entité> ».
    const entity = change.label.split(' — ').pop() || ref;
    const group = fieldGroups.get(ref) ?? { entity, added: 0, removed: 0, changed: 0 };
    group[change.kind] += 1;
    fieldGroups.set(ref, group);
  }

  for (const group of fieldGroups.values()) {
    if (group.added) lines.push(formatLabel(labels.fieldsAdded, { count: group.added, entity: group.entity }));
    if (group.removed) lines.push(formatLabel(labels.fieldsRemoved, { count: group.removed, entity: group.entity }));
    if (group.changed) lines.push(formatLabel(labels.fieldsChanged, { count: group.changed, entity: group.entity }));
  }
  return lines;
}

/** Bornes du collage CSV : au-delà, `truncated` passe à `true` et le reste est ignoré. */
export const CSV_MAX_ROWS = 500;
export const CSV_MAX_CHARS = 64 * 1024;

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  truncated: boolean;
}

/**
 * Analyse un texte CSV collé (première ligne = en-têtes). Délimiteur détecté (`;`, tabulation, `,`)
 * sauf s'il est imposé ; guillemets doubles gérés (`""` = guillemet échappé, retours à la ligne
 * autorisés dans une cellule) ; lignes vides ignorées ; borné à `maxRows` lignes et 64 Ko de texte.
 */
export function parseCsv(text: string, opts: { delimiter?: ',' | ';' | '\t'; maxRows?: number } = {}): ParsedCsv {
  const maxRows = Math.max(1, opts.maxRows ?? CSV_MAX_ROWS);
  let truncated = false;
  let input = text ?? '';
  if (input.length > CSV_MAX_CHARS) { input = input.slice(0, CSV_MAX_CHARS); truncated = true; }
  input = input.replace(/^\uFEFF/, '');
  const delimiter = opts.delimiter ?? detectDelimiter(input);

  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let cellStarted = false;

  const endRow = () => {
    if (cellStarted || row.length) row.push(cell);
    if (row.some(c => c.trim() !== '')) records.push(row);
    row = []; cell = ''; cellStarted = false;
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') { quoted = true; cellStarted = true; continue; }
    if (ch === delimiter) { row.push(cell); cell = ''; cellStarted = true; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { endRow(); continue; }
    cell += ch; cellStarted = true;
  }
  endRow();

  if (!records.length) return { headers: [], rows: [], truncated };
  const headers = records[0].map(h => h.trim());
  let rows = records.slice(1).map(r => {
    const cells = r.map(c => c.trim());
    while (cells.length < headers.length) cells.push('');
    return cells.slice(0, headers.length);
  });
  if (rows.length > maxRows) { rows = rows.slice(0, maxRows); truncated = true; }
  return { headers, rows, truncated };
}

function detectDelimiter(text: string): ',' | ';' | '\t' {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts: [',' | ';' | '\t', number][] = [
    [';', (firstLine.match(/;/g) ?? []).length],
    ['\t', (firstLine.match(/\t/g) ?? []).length],
    [',', (firstLine.match(/,/g) ?? []).length]
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}
