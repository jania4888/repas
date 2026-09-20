import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';
import { environment } from '@environments/environment';
import { createHttpContextSkipGlobalErrorUi } from '@core/http-context';
import { ApiResponse, PagedResult } from '@core/services/client.service';
import { CustomField, CustomFieldType, parseFieldType } from '@shared/studio-runtime/studio-runtime.models';
import { CustomEntitySchema, CustomRecord } from '../studio.models';
import { EntityRelationDto } from './studio-relations.models';

/** Ligne d'un lien N-N affichée dans l'onglet « Liés » (2.5e). */
export interface LinkedRecordRow {
  /** Identifiant de l'enregistrement de jonction (utilisé par `unlink`). */
  junctionRecordId: string;
  /** Identifiant de l'enregistrement cible. */
  targetId: string;
  /** Libellé lisible de la cible (`primaryLabel`). */
  targetLabel: string;
  rowVersion?: string | null;
  /** Date de création du lien (jonction). */
  createdAt?: string;
  /** v1.1 / D-47-40 : valeur de l'attribut de liaison (présent seulement si la jonction en porte un). */
  attributeValue?: number | string | null;
}

/** v1.1 / D-47-40 : attribut de liaison d'une jonction (premier champ actif non `RelationCustom`). */
export interface JunctionAttribute {
  key: string;
  label: string;
  /** `Number`/`Decimal`/`Money` — seuls ces types sont ÉDITÉS inline ; les autres sont affichés. */
  numeric: boolean;
}

/**
 * Libellé lisible d'un enregistrement : première valeur textuelle non vide du `data` selon les
 * champs du schéma (dans l'ordre), sinon `id` tronqué. Réutilisé par l'onglet « Liés » (2.5e2) et
 * les résultats de recherche.
 */
export function primaryLabel(record: CustomRecord, fields: CustomField[]): string {
  const data = record.data ?? {};
  for (const field of fields) {
    const value = data[field.key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  for (const value of Object.values(data)) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return record.id.slice(0, 8);
}

/**
 * Projection jonctions → lignes affichées (libellé résolu ou repli sur l'id tronqué), partagée par
 * l'onglet « Liés » et l'éditeur de puces de la fiche. Sans attribut de liaison (`attributeKey`
 * null), la ligne reste STRICTEMENT la v1 (pas de clé `attributeValue`).
 */
export function projectLinkedRows(
  junctions: CustomRecord[], targetFieldKey: string | null | undefined,
  labelsById: ReadonlyMap<string, string>, attributeKey?: string | null): LinkedRecordRow[] {
  if (!targetFieldKey) return [];
  return junctions
    .map(j => ({ junction: j, targetId: String(j.data?.[targetFieldKey] ?? '') }))
    .filter(p => p.targetId.length > 0)
    .map(p => {
      const row: LinkedRecordRow = {
        junctionRecordId: p.junction.id,
        targetId: p.targetId,
        targetLabel: labelsById.get(p.targetId) ?? p.targetId.slice(0, 8),
        rowVersion: p.junction.rowVersion,
        createdAt: p.junction.createdAt
      };
      if (attributeKey) {
        const value = p.junction.data?.[attributeKey];
        row.attributeValue = typeof value === 'number' || typeof value === 'string' ? value : null;
      }
      return row;
    });
}

/**
 * Accès aux enregistrements liés (relations plusieurs-à-plusieurs, PR 2.5e). **Aucun endpoint
 * « linked » dédié n'existe côté backend** : le service compose les endpoints CRUD de la jonction :
 * liste = `GET records/{jonction}?filterField=<fieldKey source>&filterValue=<recordId>`, ajout =
 * `POST records/{jonction}` avec les deux clés de la jonction, retrait = `DELETE records/{jonction}/{id}`.
 * Une paire déjà liée renvoie 409 `code: record.duplicate_link` (rendu en ligne par l'appelant,
 * d'où `createHttpContextSkipGlobalErrorUi()` sur l'écriture).
 */
@Injectable({ providedIn: 'root' })
export class StudioLinkedRecordsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/studio/records`;
  private readonly attributeCache = new Map<string, Observable<JunctionAttribute | null>>();

  listLinks(rel: EntityRelationDto, recordId: string, page = 1, pageSize = 50): Observable<ApiResponse<PagedResult<CustomRecord>>> {
    if (!rel.junctionEntityKey) throw new Error('listLinks exige une relation many_to_many (junctionEntityKey).');
    const params = new HttpParams()
      .set('page', page)
      .set('pageSize', Math.min(Math.max(pageSize, 1), 200))
      .set('filterField', rel.fieldKey)
      .set('filterValue', recordId);
    return this.http.get<ApiResponse<PagedResult<CustomRecord>>>(`${this.base}/${rel.junctionEntityKey}`, { params });
  }

  /** `link` : 409 `record.duplicate_link` si la paire existe déjà (pas de toast global).
   *  v1.1 : la valeur de l'attribut de liaison part dans le même `data` quand elle est fournie. */
  link(rel: EntityRelationDto, recordId: string, targetId: string,
       attribute?: JunctionAttribute | null, attributeValue?: number | null): Observable<ApiResponse<CustomRecord>> {
    if (!rel.junctionEntityKey || !rel.junctionTargetFieldKey) throw new Error('link exige une relation many_to_many.');
    const data: Record<string, unknown> = { [rel.fieldKey]: recordId, [rel.junctionTargetFieldKey]: targetId };
    if (attribute && attributeValue !== null && attributeValue !== undefined) data[attribute.key] = attributeValue;
    return this.http.post<ApiResponse<CustomRecord>>(
      `${this.base}/${rel.junctionEntityKey}`,
      { data },
      { context: createHttpContextSkipGlobalErrorUi() });
  }

  /**
   * v1.1 / D-47-40 (R4) : attribut de liaison de la jonction = **premier champ actif non
   * `RelationCustom` par `sortOrder`**, lu via `GET records/{jonction}/schema` (existant, policy
   * `CustomRecordsRead`) et mis en cache par clé de jonction. Dégradé : schéma indisponible (404
   * drapeau, entité inconnue) ⇒ `null` (l'onglet reste strictement le rendu v1) ; une 401/403 réelle
   * n'est PAS masquée ici (pas de `skipErrorUi` : l'intercepteur global la traite).
   */
  getJunctionAttribute(rel: EntityRelationDto): Observable<JunctionAttribute | null> {
    if (!rel.junctionEntityKey) return of(null);
    let cached = this.attributeCache.get(rel.junctionEntityKey);
    if (!cached) {
      cached = this.http.get<ApiResponse<CustomEntitySchema>>(`${this.base}/${rel.junctionEntityKey}/schema`).pipe(
        map(res => {
          if (!res.success || !res.data) return null;
          const field = [...res.data.fields]
            .filter(f => f.isActive && parseFieldType(f.fieldType) !== CustomFieldType.RelationCustom)
            .sort((a, b) => a.sortOrder - b.sortOrder)[0];
          if (!field) return null;
          const type = parseFieldType(field.fieldType);
          return {
            key: field.key,
            label: field.label,
            numeric: type === CustomFieldType.Number || type === CustomFieldType.Decimal || type === CustomFieldType.Money
          };
        }),
        catchError(() => of(null)),
        shareReplay(1));
      this.attributeCache.set(rel.junctionEntityKey, cached);
    }
    return cached;
  }

  /** v1.1 : édition de l'attribut via le PATCH existant (`rowVersion` obligatoire ; 409 périmé). */
  patchLink(rel: EntityRelationDto, junctionRecordId: string, data: Record<string, unknown>, rowVersion: string): Observable<ApiResponse<CustomRecord>> {
    if (!rel.junctionEntityKey) throw new Error('patchLink exige une relation many_to_many.');
    return this.http.patch<ApiResponse<CustomRecord>>(
      `${this.base}/${rel.junctionEntityKey}/${junctionRecordId}`,
      { data, rowVersion },
      { context: createHttpContextSkipGlobalErrorUi() });
  }

  unlink(rel: EntityRelationDto, junctionRecordId: string): Observable<void> {
    if (!rel.junctionEntityKey) throw new Error('unlink exige une relation many_to_many.');
    return this.http.delete<void>(
      `${this.base}/${rel.junctionEntityKey}/${junctionRecordId}`,
      { context: createHttpContextSkipGlobalErrorUi() });
  }

  /**
   * Cibles candidates : `GET records/{cible}?search=…&page=1&pageSize=…` triées par libellé.
   * `pageSize` 20 pour la liste déroulante ; `resolveTargetLabels` monte à 200 (borne haute du
   * endpoint) pour couvrir les cibles déjà liées.
   */
  searchTargets(rel: EntityRelationDto, search: string | null, pageSize = 20): Observable<ApiResponse<PagedResult<CustomRecord>>> {
    let params = new HttpParams().set('page', 1).set('pageSize', pageSize);
    if (search) params = params.set('search', search);
    return this.http.get<ApiResponse<PagedResult<CustomRecord>>>(`${this.base}/${rel.targetEntityKey}`, { params });
  }

  /**
   * Libellés des cibles en une passe (pageSize 200, borne haute — couvre les cibles déjà liées),
   * partagée par l'onglet « Liés » et l'éditeur de puces. Recherche indisponible ⇒ Map vide
   * (les lignes retombent sur l'id tronqué).
   */
  resolveTargetLabels(rel: EntityRelationDto): Observable<Map<string, string>> {
    return this.searchTargets(rel, null, 200).pipe(
      map(res => {
        const labels = new Map<string, string>();
        if (res.success) for (const r of res.data.items ?? []) labels.set(r.id, primaryLabel(r, []));
        return labels;
      }),
      catchError(() => of(new Map<string, string>())));
  }
}
