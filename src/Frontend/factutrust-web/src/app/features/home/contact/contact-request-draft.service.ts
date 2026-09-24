import { Injectable, signal } from '@angular/core';
import type { ContactRequestSize, ContactRequestSubject } from './contact-request.models';

/** Valeur brute du formulaire (avant normalisation) telle que mémorisée entre deux navigations. */
export interface ContactFormDraft {
  subject: ContactRequestSubject;
  fullName: string;
  organization: string;
  email: string;
  phone: string;
  size: ContactRequestSize | '';
  message: string;
  consent: boolean;
}

/**
 * Brouillon du formulaire de contact — en mémoire uniquement (jamais `localStorage` / `sessionStorage` :
 * aucune donnée personnelle persistée côté client). Vidé après un envoi réussi.
 */
@Injectable({ providedIn: 'root' })
export class ContactRequestDraftService {
  private readonly draft = signal<Partial<ContactFormDraft>>({});

  get(): Partial<ContactFormDraft> {
    return this.draft();
  }

  set(value: Partial<ContactFormDraft>): void {
    // Le champ piège n'est jamais mémorisé.
    const { website: _ignored, ...rest } = value as Partial<ContactFormDraft> & { website?: string };
    this.draft.set({ ...rest });
  }

  patch(value: Partial<ContactFormDraft>): void {
    this.set({ ...this.draft(), ...value });
  }

  clear(): void {
    this.draft.set({});
  }

  isEmpty(): boolean {
    return Object.keys(this.draft()).length === 0;
  }
}
