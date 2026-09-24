import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { FirmAssignmentService, AccountingFirmProfile, AccountingFirmDirectoryItem } from '@core/services/firm-assignment.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { FirmDirectoryCardComponent } from '@shared/accounting-firm/firm-directory-card.component';
import { GOVERNORATE_OPTIONS } from '@features/auth/shared/auth-governorate.options';
import {
  CLIENT_SEGMENT_OPTIONS,
  LANGUAGE_OPTIONS,
  MISSING_LABELS,
  PRACTICE_AREA_OPTIONS,
  TEAM_SIZE_OPTIONS
} from '@shared/accounting-firm/firm-directory.labels';

@Component({
  selector: 'app-firm-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent, FirmDirectoryCardComponent],
  template: `
    <app-page-header
      title="Fiche annuaire"
      subtitle="Présentez votre cabinet tel que les sociétés le verront avant de vous choisir.">
    </app-page-header>

    @if (loading()) {
      <p>Chargement de la fiche…</p>
    } @else if (profile()) {
      @if (profile(); as form) {
      <div class="fp-layout">
        <form class="fp-form" (ngSubmit)="save()">
          <label for="fpName">Nom affiché</label>
          <input id="fpName" class="fp-input" [(ngModel)]="form.displayName" name="displayName" required />

          <label for="fpDesc">Description</label>
          <textarea id="fpDesc" class="fp-input" rows="5" name="description" [(ngModel)]="form.description" maxlength="2000"></textarea>
          <small>{{ (form.description ?? '').length }} / 2000. Décrivez vos domaines et le type de sociétés que vous accompagnez ; n’y mettez pas votre téléphone.</small>

          <div class="fp-row">
            <div>
              <label for="fpCity">Ville</label>
              <input id="fpCity" class="fp-input" name="city" [(ngModel)]="form.city" required />
            </div>
            <div>
              <label for="fpGov">Gouvernorat</label>
              <select id="fpGov" class="fp-input" name="governorate" [(ngModel)]="form.governorate">
                @for (g of governorates; track g.value) {
                  <option [value]="g.value">{{ g.label }}</option>
                }
              </select>
            </div>
          </div>

          <label for="fpReg">N° d’inscription professionnelle</label>
          <input id="fpReg" class="fp-input" name="registration" [(ngModel)]="form.professionalRegistrationNumber" />

          <fieldset>
            <legend>Domaines</legend>
            @for (o of practiceOptions; track o.value) {
              <label class="fp-check">
                <input type="checkbox" [checked]="has(form.practiceAreas, o.value)" (change)="toggle(form, 'practiceAreas', o.value)" />
                {{ o.label }}
              </label>
            }
          </fieldset>

          <fieldset>
            <legend>Sociétés accompagnées</legend>
            @for (o of segmentOptions; track o.value) {
              <label class="fp-check">
                <input type="checkbox" [checked]="has(form.clientSegments, o.value)" (change)="toggle(form, 'clientSegments', o.value)" />
                {{ o.label }}
              </label>
            }
          </fieldset>

          <fieldset>
            <legend>Langues</legend>
            @for (o of languageOptions; track o.value) {
              <label class="fp-check">
                <input type="checkbox" [checked]="has(form.languages, o.value)" (change)="toggle(form, 'languages', o.value)" />
                {{ o.label }}
              </label>
            }
          </fieldset>

          <div class="fp-row">
            <div>
              <label for="fpTeam">Taille de l’équipe</label>
              <select id="fpTeam" class="fp-input" name="team" [(ngModel)]="form.teamSizeBand">
                <option [ngValue]="null">Non renseignée</option>
                @for (o of teamOptions; track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
            </div>
            <div>
              <label for="fpYears">Années d’expérience</label>
              <input id="fpYears" class="fp-input" type="number" min="0" max="60" name="years" [(ngModel)]="form.yearsOfExperience" />
            </div>
          </div>

          <label class="fp-check">
            <input type="checkbox" name="remote" [(ngModel)]="remoteChecked" (ngModelChange)="form.acceptsRemote = $event ? true : null" />
            Accepte le distanciel
          </label>

          <label for="fpWeb">Site https <span class="fp-optional">(public)</span></label>
          <input id="fpWeb" class="fp-input" name="website" [(ngModel)]="form.publicWebsite" placeholder="https://" />

          <label for="fpEmail">E-mail de contact</label>
          <input id="fpEmail" class="fp-input" name="email" [(ngModel)]="form.contactEmail" />
          <small>Visible par la société seulement après acceptation de la liaison.</small>

          <label for="fpPhone">Téléphone</label>
          <input id="fpPhone" class="fp-input" name="phone" [(ngModel)]="form.contactPhone" />
          <small>Visible par la société seulement après acceptation de la liaison.</small>

          <label class="fp-check">
            <input type="checkbox" name="visible" [ngModel]="form.isPublicInDirectory" (ngModelChange)="onVisibility($event)" />
            Visible dans l’annuaire
          </label>

          <button type="submit" class="fp-save" [disabled]="saving()">Enregistrer</button>
        </form>

        <aside class="fp-side">
          <p class="fp-score">Fiche complète à {{ form.completeness }} %</p>
          @if (form.missing.length) {
            <ul>
              @for (code of form.missing; track code) {
                <li>{{ missingLabel(code) }}</li>
              }
            </ul>
          }
          <h2>Aperçu société</h2>
          <app-firm-directory-card [firm]="preview()"></app-firm-directory-card>
          <p class="fp-private">L’aperçu ne montre ni l’e-mail ni le téléphone.</p>
        </aside>
      </div>
      }
    }
  `,
  styles: [`
    .fp-layout { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(260px, 0.8fr); gap: 24px; align-items: start; }
    .fp-form, .fp-side { display: flex; flex-direction: column; gap: 8px; }
    .fp-form { background: var(--color-surface, #fff); border: 1px solid var(--color-border-subtle, #e2e8f0); border-radius: 16px; padding: 20px; }
    .fp-input { width: 100%; padding: 10px 12px; border: 1px solid var(--color-border, #cbd5e1); border-radius: 12px; font: inherit; }
    .fp-input:focus-visible { outline: 2px solid var(--color-primary-600, #2563eb); outline-offset: 2px; }
    .fp-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    fieldset { border: 1px solid var(--color-border-subtle, #e2e8f0); border-radius: 12px; display: flex; flex-wrap: wrap; gap: 8px 16px; }
    .fp-check { display: flex; align-items: center; gap: 8px; font-size: 0.9rem; }
    .fp-optional { color: var(--color-text-tertiary, #94a3b8); font-weight: 400; }
    small { color: var(--color-text-secondary, #64748b); }
    .fp-save { align-self: flex-start; margin-top: 8px; padding: 10px 18px; border: 0; border-radius: 12px; background: var(--color-primary-600, #2563eb); color: #fff; font-weight: 600; cursor: pointer; }
    .fp-save:disabled { opacity: 0.6; }
    .fp-score { font-weight: 700; margin: 0; }
    .fp-private { font-size: 0.8rem; color: var(--color-text-secondary, #64748b); }
    @media (max-width: 900px) {
      .fp-layout, .fp-row { grid-template-columns: 1fr; }
      .fp-save { width: 100%; }
    }
  `]
})
export class FirmProfileComponent implements OnInit {
  private readonly assignments = inject(FirmAssignmentService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly profile = signal<AccountingFirmProfile | null>(null);
  remoteChecked = false;

  readonly governorates = GOVERNORATE_OPTIONS;
  readonly practiceOptions = PRACTICE_AREA_OPTIONS;
  readonly segmentOptions = CLIENT_SEGMENT_OPTIONS;
  readonly languageOptions = LANGUAGE_OPTIONS;
  readonly teamOptions = TEAM_SIZE_OPTIONS;

  preview(): AccountingFirmDirectoryItem {
    const form = this.profile();
    return {
      firmTenantId: form?.tenantId ?? '',
      displayName: form?.displayName || 'Votre cabinet',
      city: form?.city ?? '',
      governorate: form?.governorate ?? '',
      description: form?.description ?? undefined,
      professionalRegistrationNumber: form?.professionalRegistrationNumber ?? undefined,
      practiceAreas: form?.practiceAreas ?? [],
      clientSegments: form?.clientSegments ?? [],
      languages: form?.languages ?? [],
      teamSizeBand: form?.teamSizeBand,
      acceptsRemote: form?.acceptsRemote,
      yearsOfExperience: form?.yearsOfExperience,
      publicWebsite: form?.publicWebsite
    };
  }

  ngOnInit(): void {
    this.assignments.getMyProfile().subscribe({
      next: r => {
        if (r.success && r.data) {
          this.profile.set({
            ...r.data,
            practiceAreas: r.data.practiceAreas ?? [],
            clientSegments: r.data.clientSegments ?? [],
            languages: r.data.languages ?? [],
            missing: r.data.missing ?? []
          });
          this.remoteChecked = r.data.acceptsRemote === true;
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  has(list: string[] | undefined, code: string): boolean {
    return !!list?.includes(code);
  }

  toggle(form: AccountingFirmProfile, key: 'practiceAreas' | 'clientSegments' | 'languages', code: string): void {
    const current = form[key] ?? [];
    form[key] = current.includes(code) ? current.filter(c => c !== code) : [...current, code];
  }

  missingLabel(code: string): string {
    return MISSING_LABELS[code] ?? code;
  }

  onVisibility(next: boolean): void {
    const form = this.profile();
    if (!form) return;
    if (form.isPublicInDirectory && !next) {
      this.confirmation.confirm({
        header: 'Masquer la fiche',
        message: 'Les sociétés ne vous trouveront plus dans l’annuaire. Les liaisons déjà actives ne changent pas.',
        icon: 'pi pi-eye-slash',
        acceptLabel: 'Masquer',
        rejectLabel: 'Rester visible',
        accept: () => { form.isPublicInDirectory = false; },
        reject: () => { form.isPublicInDirectory = true; }
      });
      return;
    }
    form.isPublicInDirectory = next;
  }

  save(): void {
    const form = this.profile();
    if (!form) return;
    this.saving.set(true);
    this.assignments.updateMyProfile(form).subscribe({
      next: r => {
        this.saving.set(false);
        if (r.success) {
          this.toast.add({ severity: 'success', summary: 'Fiche enregistrée' });
          this.ngOnInit();
        } else {
          this.toast.add({ severity: 'error', summary: 'Enregistrement impossible', detail: r.message ?? 'Vérifiez les champs.' });
        }
      },
      error: err => {
        this.saving.set(false);
        const message = (err as { error?: { message?: string } })?.error?.message ?? 'Vérifiez les champs.';
        this.toast.add({ severity: 'error', summary: 'Enregistrement impossible', detail: message });
      }
    });
  }
}
