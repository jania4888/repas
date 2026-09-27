import { Injectable } from '@angular/core';

/**
 * Pont sans dépendance entre la landing et la locale ERP : la landing n'a pas à connaître
 * ErpLocaleService (ni l'authentification qu'il utilise). ErpLocaleService y enregistre la
 * réapplication de `html[lang][dir]` ; en son absence, la landing garde son comportement FR/LTR.
 */
@Injectable({ providedIn: 'root' })
export class ErpDocumentLocaleBridge {
  reapply: (() => void) | null = null;
}
