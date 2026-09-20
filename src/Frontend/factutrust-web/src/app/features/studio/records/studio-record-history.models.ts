/**
 * Modèles de l'historique d'un enregistrement Studio (4.7h3, D-47-64).
 * Miroir du contrat `GET api/studio/records/{entityKey}/{id}/history`
 * (`RecordHistoryEntryDto` / `RecordHistoryChangeDto`, PR #171) : lecture seule, aucune donnée
 * personnelle au-delà du nom d'affichage de l'utilisateur.
 */

/** Actions journalisées par `StudioRecordAudit` (backend). */
export type StudioRecordHistoryAction = 'Studio.Record.Created' | 'Studio.Record.Updated' | 'Studio.Record.Deleted';

/**
 * Un changement de champ : `oldValue` nul ⇒ valeur ajoutée (création), `newValue` nul ⇒ valeur retirée.
 * Les valeurs sont déjà rendues en texte (et tronquées à 200 caractères) par le serveur.
 * La clé de repli `_raw` porte un document illisible tel quel.
 */
export interface StudioRecordHistoryChange {
  key: string;
  oldValue: string | null;
  newValue: string | null;
}

/** Une entrée d'historique (une ligne du tableau), du plus récent au plus ancien côté serveur. */
export interface StudioRecordHistoryEntry {
  id: string;
  /** Action connue ou action brute inattendue (affichée telle quelle plutôt que de casser). */
  action: StudioRecordHistoryAction | string;
  /** Horodatage ISO 8601 tel que sérialisé par l'API (`CreatedAt`), affiché via `DatePipe`. */
  createdAt: string;
  /** Nom d'affichage ; nul ⇒ « Utilisateur inconnu ». */
  userName: string | null;
  changes: StudioRecordHistoryChange[];
}

/** Taille de page par défaut de l'onglet (défaut de l'API ; borne serveur 100). */
export const STUDIO_RECORD_HISTORY_PAGE_SIZE = 20;
