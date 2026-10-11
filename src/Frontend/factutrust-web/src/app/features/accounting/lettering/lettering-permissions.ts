import { PERMISSIONS } from '@core/config/permission-keys';

/**
 * Permission requise pour délettrer un groupe de lettrage (`accounting:unletter`).
 *
 * ⚠️ Dépendance inter-phases : cette clé est ajoutée par la Phase 1 (backend, D6) à
 * `permission-keys.ts` (`PERMISSIONS.accounting.unletter`), en cours de développement en
 * parallèle sur la branche `vorflux/lettering-p1-backend-security`. Au moment où ce fichier a
 * été écrit, la clé n'existe pas encore sur `main` : la compilation de ce fichier (et de
 * `lettering.store.ts` qui l'utilise pour `canUnletter`) ne réussira qu'après le rebase de cette
 * branche sur la Phase 1 (ou l'ajout anticipé de la clé). Voir le rapport de session pour le
 * détail de ce blocage attendu.
 */
export const LETTERING_UNLETTER_PERMISSION = PERMISSIONS.accounting.unletter;
