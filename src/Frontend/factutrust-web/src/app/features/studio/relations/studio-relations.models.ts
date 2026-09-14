/**
 * Miroir de `StudioDtos.cs` l. 109-136 (backend PR 2.1/2.2) : relations d'une table Studio
 * (`many_to_one` / `one_to_many` / `many_to_many`, chaîne snake_case) et création d'une relation
 * plusieurs-à-plusieurs par table de jonction.
 */
export type EntityRelationKind = 'many_to_one' | 'one_to_many' | 'many_to_many';

/**
 * Une relation vue depuis une table donnée. Pour `many_to_many`, `fieldId`/`fieldKey` sont le champ
 * de jonction pointant vers la table SOURCE et `junctionTargetFieldId`/`junctionTargetFieldKey`
 * (PR 2.2, additif) le champ de jonction pointant vers la CIBLE.
 */
export interface EntityRelationDto {
  kind: EntityRelationKind;
  sourceEntityId: string;
  sourceEntityKey: string;
  sourceLabel: string;
  targetEntityId: string;
  targetEntityKey: string;
  targetLabel: string;
  fieldId: string;
  fieldKey: string;
  isRequired: boolean;
  isUnique: boolean;
  junctionEntityId?: string | null;
  junctionEntityKey?: string | null;
  junctionTargetFieldId?: string | null;
  junctionTargetFieldKey?: string | null;
}

/** Corps de `POST api/studio/entities/{id}/relations/many-to-many` (nom backend, V11). */
export interface CreateManyToManyRelationRequest {
  targetEntityId: string;
  label?: string | null;
  junctionKey?: string | null;
  junctionDisplayName?: string | null;
}
