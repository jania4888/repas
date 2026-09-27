import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { ClientService, ClientType } from '@core/services/client.service';
import { SupplierService, SupplierType } from '@core/services/supplier.service';
import { ProposedThirdParty } from '../../models/accounting-document-import.models';

/**
 * Création rapide du client ou du fournisseur d'une pièce importée, pré-remplie avec les
 * données extraites.
 *
 * Trois garde-fous :
 * - la création n'a lieu que sur clic explicite (jamais dans le flux de proposition) ;
 * - les champs obligatoires que l'extraction ne peut pas deviner (adresse, e-mail) doivent être
 *   saisis : le bouton reste désactivé tant qu'ils manquent ;
 * - un tiers proche existant est proposé au rattachement plutôt qu'à la création.
 */
@Component({
  selector: 'app-accounting-third-party-quick-create',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent],
  template: `
    @if (canCreate()) {
      @if (!expanded()) {
        <app-button variant="secondary" icon="pi-user-plus" iconPos="left"
                    (click)="expand()"
                    [ariaLabel]="isSupplier() ? loc_ui_tern_creer_le_fournisseur_13e0a7 : loc_ui_tern_creer_le_client_aba191">
          {{ isSupplier() ? loc_ui_tern_creer_le_fournisseur_13e0a7 : loc_ui_tern_creer_le_client_aba191 }}
        </app-button>
      } @else {
        <form class="tpq" (ngSubmit)="submit()">
          @if (duplicates().length > 0) {
            <div class="tpq-duplicates" role="alert">
              <p class="tpq-duplicates__title" i18n="@@accounting.manual-entry.un.tiers.proche.existe.deja.686e0759">
                <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                Un tiers proche existe déjà :
              </p>
              <ul>
                @for (d of duplicates(); track d.id) {
                  <li>{{ d.name }} @if (d.nif) { <code>{{ d.nif }}</code> }</li>
                }
              </ul>
              <p class="tpq-duplicates__hint" i18n="@@accounting.manual-entry.rattachez.le.depuis.la.colonne.auxiliaire.de.la..b4d3a19d"> Rattachez-le depuis la colonne « Auxiliaire » de la grille plutôt que d'en créer un doublon. </p>
            </div>
          }

          <div class="tpq-grid">
            <label class="tpq-field">
              <span><ng-container i18n="@@accounting.manual-entry.nom.7ff20370">Nom </ng-container> <abbr title="obligatoire" i18n-title="@@accounting.manual-entry.obligatoire.3cef74c6" i18n="@@accounting.manual-entry.text.df58248c">*</abbr></span>
              <input type="text" [(ngModel)]="form.name" name="name" required />
            </label>
            <label class="tpq-field">
              <span i18n="@@accounting.manual-entry.matricule.fiscal.304096c4">Matricule fiscal</span>
              <input type="text" [(ngModel)]="form.nif" name="nif"
                     placeholder="1772793W/A/M/000" i18n-placeholder="@@accounting.manual-entry.1772793w.a.m.000.e4c6f482" />
            </label>
            <label class="tpq-field">
              <span i18n="@@accounting.manual-entry.e.mail.0d01e2e8">E-mail</span>
              <input type="email" [(ngModel)]="form.email" name="email" />
            </label>
            <label class="tpq-field">
              <span i18n="@@accounting.manual-entry.telephone.d3b023ea">Téléphone</span>
              <input type="tel" [(ngModel)]="form.phone" name="phone" />
            </label>
            <label class="tpq-field tpq-field--wide">
              <span><ng-container i18n="@@accounting.manual-entry.adresse.522e1466">Adresse </ng-container> <abbr title="obligatoire" i18n-title="@@accounting.manual-entry.obligatoire.3cef74c6" i18n="@@accounting.manual-entry.text.df58248c">*</abbr></span>
              <input type="text" [(ngModel)]="form.street" name="street" required />
            </label>
            <label class="tpq-field">
              <span i18n="@@accounting.manual-entry.code.postal.74779109">Code postal</span>
              <input type="text" [(ngModel)]="form.postalCode" name="postalCode" />
            </label>
            <label class="tpq-field">
              <span><ng-container i18n="@@accounting.manual-entry.ville.97217611">Ville </ng-container> <abbr title="obligatoire" i18n-title="@@accounting.manual-entry.obligatoire.3cef74c6" i18n="@@accounting.manual-entry.text.df58248c">*</abbr></span>
              <input type="text" [(ngModel)]="form.city" name="city" required />
            </label>
            <label class="tpq-field">
              <span><ng-container i18n="@@accounting.manual-entry.gouvernorat.b9cd1d99">Gouvernorat </ng-container> <abbr title="obligatoire" i18n-title="@@accounting.manual-entry.obligatoire.3cef74c6" i18n="@@accounting.manual-entry.text.df58248c">*</abbr></span>
              <input type="text" [(ngModel)]="form.governorate" name="governorate" required />
            </label>
          </div>

          @if (error()) {
            <p class="tpq-error" role="alert">{{ error() }}</p>
          }

          <div class="tpq-actions">
            <app-button variant="secondary" (click)="expanded.set(false)" ariaLabel="Annuler la création" i18n-ariaLabel="@@accounting.manual-entry.annuler.la.creation.506b2d1c" i18n="@@accounting.manual-entry.annuler.49ba3292"> Annuler </app-button>
            <app-button variant="primary" type="submit" icon="pi-check" iconPos="left"
                        [disabled]="!isValid() || saving()"
                        ariaLabel="Enregistrer le tiers" i18n-ariaLabel="@@accounting.manual-entry.enregistrer.le.tiers.ddc05ea6">
              {{ saving() ? loc_ui_tern_creation_2a06d1 : loc_ui_tern_creer_et_rattacher_87edac }}
            </app-button>
          </div>
          <p class="tpq-note" i18n="@@accounting.manual-entry.le.tiers.sera.cree.dans.le.dossier.l.ecriture.el.15c79a0a"> Le tiers sera créé dans le dossier. L'écriture, elle, n'est enregistrée qu'après
            votre validation dans la saisie. </p>
        </form>
      }
    } @else {
      <p class="tpq-forbidden" i18n="@@accounting.manual-entry.vous.n.avez.pas.l.autorisation.de.creer.un.tiers.cfe3d61d"> Vous n'avez pas l'autorisation de créer un tiers. L'écriture utilisera le compte
        collectif sans auxiliaire. </p>
    }
  `,
  styles: `
    .tpq { margin-top:var(--spacing-3); display:flex; flex-direction:column; gap:var(--spacing-2); }
    .tpq-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:var(--spacing-2); }
    .tpq-field { display:flex; flex-direction:column; gap:2px; font-size:var(--font-size-xs); }
    .tpq-field--wide { grid-column:1 / -1; }
    .tpq-field span { color:var(--color-text-secondary); }
    .tpq-field abbr { color:var(--color-danger); text-decoration:none; }
    .tpq-field input { padding:var(--spacing-1) var(--spacing-2); border:1px solid var(--color-border-default); border-radius:var(--radius-sm); background:var(--color-background-default); color:var(--color-text-primary); font-size:var(--font-size-sm); }
    .tpq-actions { display:flex; justify-content:flex-end; gap:var(--spacing-2); }
    .tpq-error { margin:0; color:var(--color-danger); font-size:var(--font-size-xs); }
    .tpq-note { margin:0; color:var(--color-text-tertiary); font-size:var(--font-size-xs); }
    .tpq-forbidden { margin:var(--spacing-2) 0 0; color:var(--color-text-tertiary); font-size:var(--font-size-xs); }
    .tpq-duplicates { border:1px solid var(--color-warning); border-radius:var(--radius-sm); padding:var(--spacing-2); font-size:var(--font-size-xs); }
    .tpq-duplicates__title { margin:0 0 var(--spacing-1); color:var(--color-warning); display:flex; align-items:center; gap:var(--spacing-1); }
    .tpq-duplicates ul { margin:0; padding-left:var(--spacing-4); }
    .tpq-duplicates__hint { margin:var(--spacing-1) 0 0; color:var(--color-text-secondary); }
  `
})
export class ThirdPartyQuickCreateComponent {
  readonly loc_ui_tern_creer_le_fournisseur_13e0a7 = $localize`:@@ui.tern.creer.le.fournisseur.13e0a7:Créer le fournisseur`;
  readonly loc_ui_tern_creer_le_client_aba191 = $localize`:@@ui.tern.creer.le.client.aba191:Créer le client`;
  readonly loc_ui_tern_creation_2a06d1 = $localize`:@@ui.tern.creation.2a06d1:Création…`;
  readonly loc_ui_tern_creer_et_rattacher_87edac = $localize`:@@ui.tern.creer.et.rattacher.87edac:Créer et rattacher`;
  private readonly auth = inject(AuthService);
  private readonly clientService = inject(ClientService);
  private readonly supplierService = inject(SupplierService);

  @Input({ required: true }) set thirdParty(value: ProposedThirdParty) {
    this._thirdParty.set(value);
    this.form = {
      name: value.name ?? '',
      nif: value.nif ?? '',
      email: value.email ?? '',
      phone: value.phone ?? '',
      street: value.street ?? '',
      postalCode: value.postalCode ?? '',
      city: value.city ?? '',
      governorate: value.governorate ?? value.city ?? ''
    };
  }

  /** Émet l'identifiant du tiers créé. */
  @Output() created = new EventEmitter<string>();

  private readonly _thirdParty = signal<ProposedThirdParty | null>(null);

  readonly expanded = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly duplicates = signal<{ id: string; name: string; nif?: string | null }[]>([]);

  form = {
    name: '',
    nif: '',
    email: '',
    phone: '',
    street: '',
    postalCode: '',
    city: '',
    governorate: ''
  };

  readonly isSupplier = computed(() => this._thirdParty()?.kind === 2);

  readonly canCreate = computed(() =>
    this.isSupplier()
      ? this.auth.hasPermission(PERMISSIONS.suppliers.create)
      : this.auth.hasPermission(PERMISSIONS.clients.create)
  );

  isValid(): boolean {
    return (
      this.form.name.trim().length > 0 &&
      this.form.street.trim().length > 0 &&
      this.form.city.trim().length > 0 &&
      this.form.governorate.trim().length > 0
    );
  }

  expand(): void {
    this.expanded.set(true);
    this.error.set(null);
    this.searchDuplicates();
  }

  submit(): void {
    if (!this.isValid() || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.error.set(null);

    const request = {
      name: this.form.name.trim(),
      email: this.form.email.trim() || null,
      phone: this.form.phone.trim() || undefined,
      nif: this.form.nif.trim() || undefined,
      street: this.form.street.trim(),
      city: this.form.city.trim(),
      postalCode: this.form.postalCode.trim() || undefined,
      governorate: this.form.governorate.trim()
    };

    const onResult = (res: { success: boolean; data: string; message: string | null } | null | undefined): void => {
      this.saving.set(false);
      if (res?.success && res.data) {
        this.expanded.set(false);
        this.created.emit(res.data);
      } else {
        this.error.set(res?.message || $localize`:@@accounting.third-party-quick-create.ts.la.creation.du.tiers.a.echoue.ddde35ef:La création du tiers a échoué.`);
      }
    };
    const onError = (err: {
      error?: { message?: string | null; error?: string; errors?: string[] };
      message?: string;
    }): void => {
      this.saving.set(false);
      const payload = err?.error;
      const detail =
        (Array.isArray(payload?.errors) && payload.errors[0]) ||
        payload?.error ||
        payload?.message ||
        err?.message ||
        "La création du tiers a échoué.";
      this.error.set(detail);
    };

    if (this.isSupplier()) {
      this.supplierService
        .createSupplier({
          ...request,
          type: this.form.nif.trim() ? SupplierType.Business : SupplierType.Individual,
          paymentTermDays: 30
        })
        .subscribe({ next: onResult, error: onError });
    } else {
      this.clientService
        .createClient({
          ...request,
          type: this.form.nif.trim() ? ClientType.Business : ClientType.Individual
        })
        .subscribe({ next: onResult, error: onError });
    }
  }

  /** Garde anti-doublon : recherche par matricule fiscal puis par nom avant de créer. */
  private searchDuplicates(): void {
    const name = this.form.name.trim();
    const nif = this.form.nif.trim();
    if (name.length < 2 && nif.length === 0) {
      this.duplicates.set([]);
      return;
    }

    const terms = [nif, name].filter((t) => t.length >= 2);
    if (terms.length === 0) {
      this.duplicates.set([]);
      return;
    }

    const searches = terms.map((term) => this.searchThirdParty(term));

    forkJoin(searches).subscribe((results) => {
      const flat = results.flat();
      const unique = new Map(flat.map((item) => [item.id, item]));
      this.duplicates.set([...unique.values()].slice(0, 5));
    });
  }

  /** Recherche normalisée client/fournisseur, isolée pour éviter l'union de types des deux services. */
  private searchThirdParty(
    term: string
  ): Observable<{ id: string; name: string; nif: string | null }[]> {
    const empty: { id: string; name: string; nif: string | null }[] = [];

    if (this.isSupplier()) {
      return this.supplierService.getSuppliers({ search: term, page: 1, pageSize: 5 }).pipe(
        map((res) => (res.data?.items ?? []).map((i) => ({ id: i.id, name: i.name, nif: i.nif }))),
        catchError(() => of(empty))
      );
    }

    return this.clientService.getClients({ search: term, page: 1, pageSize: 5 }).pipe(
      map((res) => (res.data?.items ?? []).map((i) => ({ id: i.id, name: i.name, nif: i.nif }))),
      catchError(() => of(empty))
    );
  }
}
