import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { InputSwitchModule } from 'primeng/inputswitch';
import { SelectModule } from 'primeng/select';
import { MessageModule } from 'primeng/message';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { environment } from '../../../../environments/environment';
import {
  isDraft,
  isPendingReview,
  isPublished,
  isSuspended,
  parseStorefrontWorkflowStatus,
  type StorefrontWorkflowStatus,
  workflowStatusLabel
} from './storefront-workflow-status';
import {
  isModerationReadyForSubmit,
  isValidStorefrontHexColor,
  STOREFRONT_DESCRIPTION_MAX_LENGTH,
  STOREFRONT_PUBLIC_URL_MAX_LENGTH,
  STOREFRONT_TAGLINE_MAX_LENGTH
} from './storefront-profile-edit.model';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string | null;
  errors?: string[];
}

/** Réponse `GET/POST` profil vitrine (camelCase, enums en chaîne ou nombre selon config API). */
interface StorefrontProfileApiDto {
  id: string;
  tenantId: string;
  slug: string;
  displayName: string;
  status: string | number;
  consentVersion: string;
  rejectionReason?: string | null;
  tagline?: string | null;
  descriptionMarkdown?: string | null;
  brandPrimaryColorHex?: string | null;
  brandSecondaryColorHex?: string | null;
  publicLogoUrl?: string | null;
  publicCoverImageUrl?: string | null;
  category?: string | number;
  facadeTheme?: string | number;
  publicContactEmail?: string | null;
  publicContactPhone?: string | null;
  publicContactWhatsApp?: string | null;
  orderSubmissionEnabled?: boolean;
}

export interface StorefrontProfileView {
  id: string;
  tenantId: string;
  slug: string;
  displayName: string;
  workflowStatus: StorefrontWorkflowStatus;
  consentVersion: string;
  rejectionReason?: string | null;
  tagline: string;
  descriptionMarkdown: string;
  brandPrimaryColorHex: string;
  brandSecondaryColorHex: string;
  publicLogoUrl: string;
  publicCoverImageUrl: string;
  category: number;
  facadeTheme: number;
  publicContactEmail: string;
  publicContactPhone: string;
  publicContactWhatsApp: string;
  orderSubmissionEnabled: boolean;
}

/** Formulaire éditable (brouillon / en attente), synchronisé depuis le profil chargé. */
export interface StorefrontEditForm {
  displayName: string;
  tagline: string;
  descriptionMarkdown: string;
  brandPrimaryColorHex: string;
  brandSecondaryColorHex: string;
  publicLogoUrl: string;
  publicCoverImageUrl: string;
  category: number;
  facadeTheme: number;
  publicContactEmail: string;
  publicContactPhone: string;
  publicContactWhatsApp: string;
  orderSubmissionEnabled: boolean;
}

function parseStorefrontCategory(raw: unknown): number {
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (!Number.isNaN(n) && Number.isInteger(n)) {
      return n;
    }
    const key = raw.trim().toLowerCase();
    const byName: Record<string, number> = {
      retail: 0,
      food: 1,
      fashion: 2,
      books: 3,
      electronics: 4,
      services: 5,
      crafts: 6,
      other: 99
    };
    if (key in byName) {
      return byName[key]!;
    }
  }
  return 0;
}

function parseFacadeTheme(raw: unknown): number {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 4) {
    return raw;
  }
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (!Number.isNaN(n) && n >= 0 && n <= 4) {
      return n;
    }
    const key = raw.trim().toLowerCase();
    const byName: Record<string, number> = {
      classic: 0,
      modern: 1,
      vintage: 2,
      minimal: 3,
      artisan: 4
    };
    if (key in byName) {
      return byName[key]!;
    }
  }
  return 0;
}

function mapApiDtoToView(dto: StorefrontProfileApiDto): StorefrontProfileView | null {
  const parsed = parseStorefrontWorkflowStatus(dto.status);
  if (!parsed.ok) {
    return null;
  }
  return {
    id: dto.id,
    tenantId: dto.tenantId,
    slug: dto.slug,
    displayName: dto.displayName ?? '',
    workflowStatus: parsed.value,
    consentVersion: dto.consentVersion,
    rejectionReason: dto.rejectionReason ?? null,
    tagline: dto.tagline ?? '',
    descriptionMarkdown: dto.descriptionMarkdown ?? '',
    brandPrimaryColorHex: (dto.brandPrimaryColorHex ?? '#2563EB').trim().toUpperCase(),
    brandSecondaryColorHex: (dto.brandSecondaryColorHex ?? '#0EA5E9').trim().toUpperCase(),
    publicLogoUrl: dto.publicLogoUrl ?? '',
    publicCoverImageUrl: dto.publicCoverImageUrl ?? '',
    category: parseStorefrontCategory(dto.category),
    facadeTheme: parseFacadeTheme(dto.facadeTheme),
    publicContactEmail: dto.publicContactEmail ?? '',
    publicContactPhone: dto.publicContactPhone ?? '',
    publicContactWhatsApp: dto.publicContactWhatsApp ?? '',
    orderSubmissionEnabled: dto.orderSubmissionEnabled !== false
  };
}

function emptyEditForm(): StorefrontEditForm {
  return {
    displayName: '',
    tagline: '',
    descriptionMarkdown: '',
    brandPrimaryColorHex: '#2563EB',
    brandSecondaryColorHex: '#0EA5E9',
    publicLogoUrl: '',
    publicCoverImageUrl: '',
    category: 0,
    facadeTheme: 0,
    publicContactEmail: '',
    publicContactPhone: '',
    publicContactWhatsApp: '',
    orderSubmissionEnabled: true
  };
}

function editFormFromView(v: StorefrontProfileView): StorefrontEditForm {
  return {
    displayName: v.displayName,
    tagline: v.tagline,
    descriptionMarkdown: v.descriptionMarkdown,
    brandPrimaryColorHex: v.brandPrimaryColorHex,
    brandSecondaryColorHex: v.brandSecondaryColorHex,
    publicLogoUrl: v.publicLogoUrl,
    publicCoverImageUrl: v.publicCoverImageUrl,
    category: v.category,
    facadeTheme: v.facadeTheme,
    publicContactEmail: v.publicContactEmail,
    publicContactPhone: v.publicContactPhone,
    publicContactWhatsApp: v.publicContactWhatsApp,
    orderSubmissionEnabled: v.orderSubmissionEnabled
  };
}

@Component({
  selector: 'app-storefront-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    CardModule,
    ButtonModule,
    InputTextModule,
    Textarea,
    InputSwitchModule,
    SelectModule,
    MessageModule,
    PageHeaderComponent,
    BreadcrumbComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>
    <app-page-header
      title="Vitrine publique & rue 3D" i18n-title="@@settings.storefront.vitrine.publique.rue.3d.2f3995b8"
      subtitle="Exposez une vitrine modérée sur la Rue InstaFact (opt-in, données publiques uniquement).">
    </app-page-header>

    @if (!enabled) {
      <p-message severity="warn" text="La fonctionnalité est désactivée côté client (environment)."></p-message>
    } @else {
      @if (error()) {
        <p-message severity="error" [text]="error()!" role="alert"></p-message>
      }
      @if (profile()) {
        <p-card header="Vitrine configurée" i18n-header="@@settings.storefront.vitrine.configuree.23f52efd">
          <p><strong i18n="@@settings.storefront.slug.c22372b0">Slug :</strong> {{ profile()!.slug }}</p>
          <p><strong i18n="@@settings.storefront.nom.public.3e9fc9db">Nom public :</strong> {{ profile()!.displayName }}</p>
          <p><strong i18n="@@settings.storefront.statut.b20e7fc2">Statut :</strong> {{ workflowStatusLabel(profile()!.workflowStatus) }}</p>
          @if (profile()!.rejectionReason) {
            <p><strong i18n="@@settings.storefront.motif.refus.cd5d8a22">Motif refus :</strong> {{ profile()!.rejectionReason }}</p>
          }
          @if (isPendingReview(profile()!.workflowStatus)) {
            <p-message
              class="block mt-3"
              severity="info"
              text="Votre vitrine a été transmise à la modération plateforme. Vous serez informé après décision (publication ou retour en brouillon avec motif)." />
          }
          <p class="mt-3">
            @if (isPublished(profile()!.workflowStatus)) {
              <a routerLink="/visite-virtuelle/{{ profile()!.slug }}" target="_blank" rel="noopener"
                 i18n="@@settings.storefront.ouvrir.la.vitrine.publique.dc25a21d">Ouvrir la vitrine publique</a
              >
            } @else {
              <p-message severity="info" [text]="publicUrlBlockedMessage(profile()!.slug)" />
            }
          </p>
          @if (workflowMessage()) {
            <p-message class="block mt-3" severity="success" [text]="workflowMessage()!" />
          }
          @if (saveMessage()) {
            <p-message class="block mt-3" severity="success" [text]="saveMessage()!" />
          }
          <div class="workflow-actions mt-3">
            @if (isDraft(profile()!.workflowStatus)) {
              <p-button
                label="Soumettre à la modération" i18n-label="@@settings.storefront.soumettre.a.la.moderation.1018d7e2"
                icon="pi pi-send"
                (onClick)="submitForReview()"
                [loading]="workflowBusy()"
                [disabled]="workflowBusy() || !isModerationReady()" />
            }
            @if (isPublished(profile()!.workflowStatus)) {
              <p-button
                label="Dépublier (retour brouillon)" i18n-label="@@settings.storefront.depublier.retour.brouillon.1e94578c"
                icon="pi pi-eye-slash"
                severity="secondary"
                [outlined]="true"
                (onClick)="unpublish()"
                [loading]="workflowBusy()" />
            }
          </div>
        </p-card>

        @if (canEditProfileFields()) {
          <p-card header="Contenu et habillage publics" i18n-header="@@settings.storefront.contenu.et.habillage.publics.482238e3" class="mt-3">
            <p class="lede mb-3">
              <ng-container i18n="@@settings.storefront.ces.champs.sont.visibles.apres.moderation.et.pub.77a89db2"> Ces champs sont visibles après modération et publication. Une </ng-container>
              <strong i18n="@@settings.storefront.description.cb329146">description</strong> et une <strong i18n="@@settings.storefront.url.de.logo.public.a9ca3375">URL de logo public</strong> sont obligatoires pour soumettre
              la vitrine.
            </p>
            @if (moderationChecklistItems().length > 0) {
              <p-message
                class="block mb-3"
                severity="info"
                [text]="loc_ui_tern_a_completer_avant_soumission_688cf2 + moderationChecklistItems().join(' · ') + '.'"></p-message>
            }
            @if (fieldErrors().length > 0) {
              <p-message
                class="block mb-3"
                severity="error"
                role="alert"
                [text]="fieldErrors().join(' ')"></p-message>
            }
            <div class="field">
              <label for="sf-displayName" i18n="@@settings.storefront.nom.public.38b747b0">Nom public</label>
              <input id="sf-displayName" pInputText [(ngModel)]="editForm.displayName" autocomplete="organization" />
            </div>
            <div class="field">
              <label for="sf-tagline">Slogan (optionnel, max. {{ taglineMax }} car.)</label>
              <input
                id="sf-tagline"
                pInputText
                [(ngModel)]="editForm.tagline"
                [maxlength]="taglineMax"
                aria-describedby="sf-tagline-hint" />
              <small id="sf-tagline-hint" class="hint">{{ editForm.tagline.length }} / {{ taglineMax }}</small>
            </div>
            <div class="field">
              <label for="sf-desc" i18n="@@settings.storefront.description.markdown.obligatoire.pour.soumission.fa4a35be">Description (Markdown, obligatoire pour soumission)</label>
              <textarea
                id="sf-desc"
                pTextarea
                [(ngModel)]="editForm.descriptionMarkdown"
                [rows]="8"
                [maxlength]="descriptionMax"
                class="w-full"
                aria-describedby="sf-desc-hint"></textarea>
              <small id="sf-desc-hint" class="hint">{{ editForm.descriptionMarkdown.length }} / {{ descriptionMax }}</small>
            </div>
            <div class="field-row">
              <div class="field grow">
                <label for="sf-primary" i18n="@@settings.storefront.couleur.primaire.rrggbb.af10a08e">Couleur primaire (#RRGGBB)</label>
                <input id="sf-primary" pInputText [(ngModel)]="editForm.brandPrimaryColorHex" maxlength="7" />
              </div>
              <div class="field grow">
                <label for="sf-secondary" i18n="@@settings.storefront.couleur.secondaire.rrggbb.3084d45f">Couleur secondaire (#RRGGBB)</label>
                <input id="sf-secondary" pInputText [(ngModel)]="editForm.brandSecondaryColorHex" maxlength="7" />
              </div>
            </div>
            <div class="field">
              <label for="sf-email" i18n="@@settings.storefront.email.public.de.contact.221f0cf6">Email public de contact</label>
              <input id="sf-email" pInputText [(ngModel)]="editForm.publicContactEmail" type="email" autocomplete="email" />
            </div>
            <div class="field-row">
              <div class="field grow">
                <label for="sf-phone" i18n="@@settings.storefront.telephone.optionnel.23768a3e">Téléphone (optionnel)</label>
                <input id="sf-phone" pInputText [(ngModel)]="editForm.publicContactPhone" />
              </div>
              <div class="field grow">
                <label for="sf-wa" i18n="@@settings.storefront.whatsapp.optionnel.7f2f84d5">WhatsApp (optionnel)</label>
                <input id="sf-wa" pInputText [(ngModel)]="editForm.publicContactWhatsApp" />
              </div>
            </div>
            <div class="field">
              <label for="sf-logo">URL du logo public (obligatoire pour soumission, max. {{ urlMax }} car.)</label>
              <input id="sf-logo" pInputText [(ngModel)]="editForm.publicLogoUrl" [maxlength]="urlMax" />
            </div>
            <div class="field">
              <label for="sf-cover">URL image de couverture (optionnel, max. {{ urlMax }} car.)</label>
              <input id="sf-cover" pInputText [(ngModel)]="editForm.publicCoverImageUrl" [maxlength]="urlMax" />
            </div>
            <div class="field">
              <label for="sf-cat" i18n="@@settings.storefront.categorie.6b38300a">Catégorie</label>
              <p-select
                inputId="sf-cat"
                [options]="categories"
                [(ngModel)]="editForm.category"
                optionLabel="label"
                optionValue="value" />
            </div>
            <div class="field">
              <label for="sf-theme" i18n="@@settings.storefront.theme.facade.8db2163f">Thème façade</label>
              <p-select
                inputId="sf-theme"
                [options]="themes"
                [(ngModel)]="editForm.facadeTheme"
                optionLabel="label"
                optionValue="value" />
            </div>
            <div class="field switch-field">
              <label for="sf-orders" i18n="@@settings.storefront.autoriser.les.commandes.depuis.la.vitrine.publiq.054fb621">Autoriser les commandes depuis la vitrine publique</label>
              <p-inputSwitch inputId="sf-orders" [(ngModel)]="editForm.orderSubmissionEnabled" />
            </div>
            <p-button label="Enregistrer" i18n-label="@@settings.storefront.enregistrer.f7c8bcd8" icon="pi pi-save" (onClick)="saveProfile()" [loading]="saveBusy()" />
          </p-card>
        }
      } @else if (!loading() && profile() === null && !invalidStatusFromServer()) {
        <p-card header="Activer la vitrine (brouillon)" i18n-header="@@settings.storefront.activer.la.vitrine.brouillon.c4b94584">
          <p class="mb-3">
            <ng-container i18n="@@settings.storefront.les.cgu.de.publication.version.1e109255"> Les CGU de publication version </ng-container> <strong>{{ termsVersion }}</strong> seront enregistrées pour votre
            entreprise.
          </p>
          <div class="field">
            <label for="slug" i18n="@@settings.storefront.slug.url.minuscules.tirets.9a01339c">Slug URL (minuscules, tirets)</label>
            <input id="slug" pInputText [(ngModel)]="draft.slug" />
          </div>
          <div class="field">
            <label for="dn" i18n="@@settings.storefront.nom.affiche.c3c2717f">Nom affiché</label>
            <input id="dn" pInputText [(ngModel)]="draft.displayName" />
          </div>
          <div class="field">
            <label for="mail" i18n="@@settings.storefront.email.public.497079b4">Email public</label>
            <input id="mail" pInputText [(ngModel)]="draft.publicContactEmail" />
          </div>
          <div class="field">
            <label i18n="@@settings.storefront.categorie.6b38300a">Catégorie</label>
            <p-select [options]="categories" [(ngModel)]="draft.category" optionLabel="label" optionValue="value" />
          </div>
          <div class="field">
            <label i18n="@@settings.storefront.theme.facade.8db2163f">Thème façade</label>
            <p-select [options]="themes" [(ngModel)]="draft.facadeTheme" optionLabel="label" optionValue="value" />
          </div>
          <p-button label="Créer la vitrine (brouillon)" i18n-label="@@settings.storefront.creer.la.vitrine.brouillon.89285cd7" (onClick)="optIn()" [loading]="saving()" />
        </p-card>
      } @else if (!loading() && invalidStatusFromServer()) {
        <p class="sr-only" i18n="@@settings.storefront.reponse.serveur.incoherente.statut.vitrine.68d1e8a9">Réponse serveur incohérente (statut vitrine).</p>
      } @else {
        <p i18n="@@settings.storefront.chargement.du.profil.vitrine.9373dcfc">Chargement du profil vitrine…</p>
      }
    }
  `,
  styles: [
    `
      .field {
        margin-bottom: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      .field-row {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
      }
      .field-row .grow {
        flex: 1 1 200px;
      }
      .switch-field {
        flex-direction: row;
        align-items: center;
        gap: 0.75rem;
      }
      .hint {
        color: var(--text-color-secondary, #64748b);
        font-size: 0.8rem;
      }
      .lede {
        color: var(--text-color-secondary, #475569);
        margin: 0;
      }
      .mb-3 {
        margin-bottom: 1rem;
      }
      .mt-3 {
        margin-top: 1rem;
      }
      .block {
        display: block;
      }
      .workflow-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      .w-full {
        width: 100%;
      }
    `
  ]
})
export class StorefrontSettingsComponent implements OnInit {
  readonly loc_ui_tern_a_completer_avant_soumission_688cf2 = $localize`:@@ui.tern.a.completer.avant.soumission.688cf2:À compléter avant soumission : `;
  private readonly http = inject(HttpClient);
  private readonly errorHandler = inject(ErrorHandlerService);

  readonly enabled = environment.storefrontEnabled;
  readonly termsVersion = '1.0.0';
  readonly descriptionMax = STOREFRONT_DESCRIPTION_MAX_LENGTH;
  readonly taglineMax = STOREFRONT_TAGLINE_MAX_LENGTH;
  readonly urlMax = STOREFRONT_PUBLIC_URL_MAX_LENGTH;

  readonly breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
    { label: 'Paramètres', route: '/settings' },
    { label: 'Vitrine publique' }
  ];

  readonly profile = signal<StorefrontProfileView | null | undefined>(undefined);
  readonly invalidStatusFromServer = signal(false);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly saveBusy = signal(false);
  readonly error = signal<string | null>(null);
  readonly workflowBusy = signal(false);
  readonly workflowMessage = signal<string | null>(null);
  readonly saveMessage = signal<string | null>(null);
  readonly fieldErrors = signal<string[]>([]);

  readonly isDraft = isDraft;
  readonly isPendingReview = isPendingReview;
  readonly isPublished = isPublished;
  readonly workflowStatusLabel = workflowStatusLabel;

  editForm: StorefrontEditForm = emptyEditForm();

  draft = {
    slug: '',
    displayName: '',
    publicContactEmail: '',
    category: 0,
    facadeTheme: 0
  };

  categories = [
    { label: 'Commerce général', value: 0 },
    { label: 'Alimentation', value: 1 },
    { label: 'Mode', value: 2 },
    { label: 'Livres', value: 3 },
    { label: 'Électronique', value: 4 },
    { label: 'Services', value: 5 },
    { label: 'Artisanat', value: 6 },
    { label: 'Autre', value: 99 }
  ];

  themes = [
    { label: 'Classique', value: 0 },
    { label: 'Moderne', value: 1 },
    { label: 'Vintage', value: 2 },
    { label: 'Minimal', value: 3 },
    { label: 'Artisan', value: 4 }
  ];

  ngOnInit(): void {
    if (!this.enabled) {
      this.loading.set(false);
      return;
    }
    this.loadProfile();
  }

  canEditProfileFields(): boolean {
    const p = this.profile();
    return !!p && (isDraft(p.workflowStatus) || isPendingReview(p.workflowStatus)) && !isSuspended(p.workflowStatus);
  }

  /** Prérequis domaine pour `SubmitForReview` (aperçu UX ; le serveur reste autoritaire). */
  isModerationReady(): boolean {
    return isModerationReadyForSubmit(this.editForm.descriptionMarkdown, this.editForm.publicLogoUrl);
  }

  moderationChecklistItems(): string[] {
    const missing: string[] = [];
    if (!(this.editForm.descriptionMarkdown ?? '').trim()) {
      missing.push('description');
    }
    if (!(this.editForm.publicLogoUrl ?? '').trim()) {
      missing.push('URL du logo public');
    }
    return missing;
  }

  loadProfile(): void {
    this.loading.set(true);
    this.http.get<ApiResponse<StorefrontProfileApiDto>>(`${environment.apiUrl}/storefront/tenant/profile`).subscribe({
      next: res => {
        const raw = res.data;
        if (!raw) {
          this.profile.set(null);
          this.invalidStatusFromServer.set(false);
          this.editForm = emptyEditForm();
          this.loading.set(false);
          return;
        }
        const view = mapApiDtoToView(raw);
        if (!view) {
          this.error.set('Réponse serveur inattendue (statut vitrine). Contactez le support.');
          this.profile.set(null);
          this.invalidStatusFromServer.set(true);
          this.editForm = emptyEditForm();
        } else {
          this.invalidStatusFromServer.set(false);
          this.profile.set(view);
          this.editForm = editFormFromView(view);
        }
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.errorHandler.extractErrorMessage(err));
        this.loading.set(false);
      }
    });
  }

  publicUrlBlockedMessage(slug: string): string {
    return (
      `L’URL publique (/visite-virtuelle/${slug}) ne sera active qu’après publication sur la Rue InstaFact ` +
      $localize`:@@ui.tern.validation.plateforme.en.brouillon.en.atte.413df7:(validation plateforme). En brouillon, en attente ou suspendue, cette adresse ne renvoie pas la vitrine côté public.`
    );
  }

  private applyProfileFromApiDto(dto: StorefrontProfileApiDto): boolean {
    const view = mapApiDtoToView(dto);
    if (!view) {
      this.error.set('Réponse serveur inattendue (statut vitrine). Contactez le support.');
      this.invalidStatusFromServer.set(true);
      return false;
    }
    this.invalidStatusFromServer.set(false);
    this.profile.set(view);
    this.editForm = editFormFromView(view);
    return true;
  }

  private validateEditFormBeforeSave(): string[] {
    const errs: string[] = [];
    if (!this.editForm.displayName?.trim()) {
      errs.push('Le nom public est obligatoire.');
    }
    if (!this.editForm.publicContactEmail?.trim()) {
      errs.push("L'email public de contact est obligatoire.");
    }
    const p1 = (this.editForm.brandPrimaryColorHex ?? '').trim();
    const p2 = (this.editForm.brandSecondaryColorHex ?? '').trim();
    if (!isValidStorefrontHexColor(p1)) {
      errs.push('La couleur primaire doit être au format #RRGGBB.');
    }
    if (!isValidStorefrontHexColor(p2)) {
      errs.push('La couleur secondaire doit être au format #RRGGBB.');
    }
    if ((this.editForm.publicLogoUrl ?? '').length > STOREFRONT_PUBLIC_URL_MAX_LENGTH) {
      errs.push(`L'URL du logo ne peut pas dépasser ${STOREFRONT_PUBLIC_URL_MAX_LENGTH} caractères.`);
    }
    if ((this.editForm.publicCoverImageUrl ?? '').length > STOREFRONT_PUBLIC_URL_MAX_LENGTH) {
      errs.push(`L'URL de couverture ne peut pas dépasser ${STOREFRONT_PUBLIC_URL_MAX_LENGTH} caractères.`);
    }
    if ((this.editForm.tagline ?? '').length > STOREFRONT_TAGLINE_MAX_LENGTH) {
      errs.push(`Le slogan ne peut pas dépasser ${STOREFRONT_TAGLINE_MAX_LENGTH} caractères.`);
    }
    if ((this.editForm.descriptionMarkdown ?? '').length > STOREFRONT_DESCRIPTION_MAX_LENGTH) {
      errs.push(`La description ne peut pas dépasser ${STOREFRONT_DESCRIPTION_MAX_LENGTH} caractères.`);
    }
    return errs;
  }

  saveProfile(): void {
    if (!this.canEditProfileFields()) {
      return;
    }
    this.fieldErrors.set([]);
    this.saveMessage.set(null);
    this.workflowMessage.set(null);
    this.error.set(null);
    const localErrs = this.validateEditFormBeforeSave();
    if (localErrs.length > 0) {
      this.fieldErrors.set(localErrs);
      return;
    }
    const f = this.editForm;
    const body = {
      displayName: f.displayName.trim(),
      tagline: f.tagline.trim() || null,
      descriptionMarkdown: f.descriptionMarkdown.trim() || null,
      brandPrimaryColorHex: f.brandPrimaryColorHex.trim().toUpperCase(),
      brandSecondaryColorHex: f.brandSecondaryColorHex.trim().toUpperCase(),
      category: f.category,
      facadeTheme: f.facadeTheme,
      publicContactEmail: f.publicContactEmail.trim(),
      publicContactPhone: f.publicContactPhone.trim() || null,
      publicContactWhatsApp: f.publicContactWhatsApp.trim() || null,
      publicLogoUrl: f.publicLogoUrl.trim() || null,
      publicCoverImageUrl: f.publicCoverImageUrl.trim() || null,
      orderSubmissionEnabled: f.orderSubmissionEnabled
    };
    this.saveBusy.set(true);
    this.http.put<ApiResponse<StorefrontProfileApiDto>>(`${environment.apiUrl}/storefront/tenant/profile`, body).subscribe({
      next: res => {
        this.saveBusy.set(false);
        if (!res.success || !res.data) {
          this.error.set(res.errors?.join(' ') ?? res.message ?? $localize`:@@ui.tern.enregistrement.impossible.206044:Enregistrement impossible.`);
          return;
        }
        if (this.applyProfileFromApiDto(res.data)) {
          this.fieldErrors.set([]);
          this.saveMessage.set(res.message ?? $localize`:@@ui.tern.vitrine.mise.a.jour.ed7ec2:Vitrine mise à jour.`);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.saveBusy.set(false);
        this.error.set(this.errorHandler.extractErrorMessage(err));
      }
    });
  }

  submitForReview(): void {
    this.workflowBusy.set(true);
    this.workflowMessage.set(null);
    this.saveMessage.set(null);
    this.error.set(null);
    this.http
      .post<ApiResponse<StorefrontProfileApiDto>>(`${environment.apiUrl}/storefront/tenant/submit-for-review`, {})
      .subscribe({
        next: res => {
          this.workflowBusy.set(false);
          if (!res.success || !res.data) {
            this.error.set(res.errors?.join(' ') ?? res.message ?? $localize`:@@ui.tern.soumission.impossible.543f0c:Soumission impossible.`);
            return;
          }
          if (this.applyProfileFromApiDto(res.data)) {
            this.workflowMessage.set(res.message ?? $localize`:@@ui.tern.soumise.a.la.moderation.c769d8:Soumise à la modération.`);
          }
        },
        error: (err: HttpErrorResponse) => {
          this.workflowBusy.set(false);
          this.error.set(this.errorHandler.extractErrorMessage(err));
        }
      });
  }

  unpublish(): void {
    this.workflowBusy.set(true);
    this.workflowMessage.set(null);
    this.saveMessage.set(null);
    this.error.set(null);
    this.http
      .post<ApiResponse<StorefrontProfileApiDto>>(`${environment.apiUrl}/storefront/tenant/unpublish`, {})
      .subscribe({
        next: res => {
          this.workflowBusy.set(false);
          if (!res.success || !res.data) {
            this.error.set(res.errors?.join(' ') ?? res.message ?? $localize`:@@ui.tern.depublication.impossible.0d9c38:Dépublication impossible.`);
            return;
          }
          if (this.applyProfileFromApiDto(res.data)) {
            this.workflowMessage.set(res.message ?? $localize`:@@ui.tern.vitrine.depubliee.93f44b:Vitrine dépubliée.`);
          }
        },
        error: (err: HttpErrorResponse) => {
          this.workflowBusy.set(false);
          this.error.set(this.errorHandler.extractErrorMessage(err));
        }
      });
  }

  optIn(): void {
    this.saving.set(true);
    this.error.set(null);
    const body = {
      slug: this.draft.slug.trim(),
      displayName: this.draft.displayName.trim(),
      publicContactEmail: this.draft.publicContactEmail.trim(),
      category: this.draft.category,
      facadeTheme: this.draft.facadeTheme,
      acceptedTermsVersion: this.termsVersion
    };
    this.http.post<ApiResponse<StorefrontProfileApiDto>>(`${environment.apiUrl}/storefront/tenant/profile`, body).subscribe({
      next: res => {
        if (!res.success || !res.data) {
          this.error.set(res.errors?.join(' ') ?? res.message ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
        } else if (!this.applyProfileFromApiDto(res.data)) {
          // erreur statut déjà posée
        }
        this.saving.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.errorHandler.extractErrorMessage(err));
        this.saving.set(false);
      }
    });
  }
}
