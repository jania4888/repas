import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { debounceTime } from 'rxjs';
import { environment } from '@environments/environment';
import { LandingLocaleService } from '@core/services/landing-locale.service';
import { LandingCopyService } from '../content/landing-copy.service';
// L'adresse de repli est locale-indépendante : la constante est exportée par les fichiers
// `content/fr/contact.ts` et `content/ar/contact.ts` (clé hors type figé `LandingContactCopy`).
import { CONTACT_FALLBACK_EMAIL } from '../content/fr/contact';
import {
  CONTACT_REQUEST_LIMITS,
  CONTACT_REQUEST_SUBJECTS,
  isContactRequestSubject,
  type ContactRequestSize,
  type ContactRequestSubject,
  type ContactSubmitError,
  type CreateContactRequestDto
} from './contact-request.models';
import { ContactRequestDraftService } from './contact-request-draft.service';
import { mapContactSubmitError } from './contact-submit-error.mapper';
import { PublicContactRequestsClient } from './public-contact-requests.client';
import { ContactValidators, normalizeTunisianPhone } from './tunisian-validators';
import { TurnstileWidgetComponent } from './turnstile-widget.component';

type ContactFormStatus = 'idle' | 'submitting' | 'success' | 'error';

type ContactControlName =
  | 'subject'
  | 'fullName'
  | 'organization'
  | 'email'
  | 'phone'
  | 'size'
  | 'message'
  | 'consent'
  | 'website';

/**
 * Formulaire public de demande d'accès / de démo (plan § 6.4, B.6).
 * - DTO strictement conforme à § 4.5 (`POST /api/public/contact-requests`, anonyme) ;
 * - machine d'états `idle → submitting → success | error` (400 / 429 avec compte à rebours /
 *   503 avec e-mail de repli / réseau) ;
 * - champ piège `website` hors écran : rempli ⇒ faux succès silencieux, aucun appel HTTP ;
 * - aucune donnée persistée côté client (brouillon en mémoire uniquement), aucun JWT.
 */
@Component({
  selector: 'app-contact-request-form',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, TurnstileWidgetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (status() === 'success') {
      <div #statusPanel class="cr-panel cr-panel--success" tabindex="-1" role="status">
        <p class="cr-panel__icon cr-panel__icon--success" aria-hidden="true">✓</p>
        <h3 class="cr-panel__title">{{ t().contact.success.title }}</h3>
        @if (reference(); as ref) {
          <p class="cr-panel__ref">
            <span dir="ltr">{{ successReference(ref) }}</span>
          </p>
        }
        <p class="cr-panel__text">{{ t().contact.success.text }}</p>
        <div class="cr-panel__actions">
          <button type="button" class="cr-btn cr-btn--secondary" (click)="resetForAnother()">
            {{ t().contact.submit.another }}
          </button>
        </div>
      </div>
    } @else if (disabledState()) {
      <div #statusPanel class="cr-panel cr-panel--disabled" tabindex="-1" role="status">
        <p class="cr-panel__text">{{ disabledMessage() }}</p>
        <p class="cr-panel__actions">
          <a class="cr-btn cr-btn--primary cr-btn--inline" dir="ltr" [href]="mailtoHref">{{ fallbackEmail }}</a>
        </p>
      </div>
    } @else {
      <form
        class="cr-form"
        [formGroup]="form"
        (ngSubmit)="submit()"
        novalidate
        [attr.aria-busy]="status() === 'submitting'"
      >
        @if (alertMessages().length > 0) {
          <div
            #alertPanel
            class="cr-alert"
            [class.cr-alert--warning]="error()?.kind === 'rateLimited'"
            [class.cr-alert--error]="error()?.kind !== 'rateLimited'"
            role="alert"
            tabindex="-1"
          >
            @for (message of alertMessages(); track message) {
              <p>{{ message }}</p>
            }
          </div>
        }

        <div class="cr-field">
          <label for="cr-subject">{{ t().contact.fields.subject.label }}</label>
          <select
            id="cr-subject"
            class="cr-control"
            formControlName="subject"
            [attr.aria-invalid]="ariaInvalid('subject')"
            [attr.aria-describedby]="describedBy('cr-subject', errorFor('subject'))"
          >
            @for (value of subjects; track value) {
              <option [value]="value">{{ t().contact.subjects[value] }}</option>
            }
          </select>
          <p id="cr-subject-hint" class="cr-field__hint">{{ t().contact.fields.subject.hint }}</p>
          @if (errorFor('subject'); as message) {
            <p id="cr-subject-error" class="cr-field__error" role="alert">{{ message }}</p>
          }
        </div>

        <div class="cr-grid-2">
          <div class="cr-field">
            <label for="cr-fullname">{{ t().contact.fields.fullName.label }}</label>
            <input
              id="cr-fullname"
              class="cr-control"
              type="text"
              formControlName="fullName"
              autocomplete="name"
              [attr.placeholder]="t().contact.fields.fullName.placeholder"
              [attr.maxlength]="limits.fullName.max"
              [attr.aria-invalid]="ariaInvalid('fullName')"
              [attr.aria-describedby]="describedBy('cr-fullname', errorFor('fullName'))"
            />
            <p id="cr-fullname-hint" class="cr-field__hint">{{ t().contact.fields.fullName.hint }}</p>
            @if (errorFor('fullName'); as message) {
              <p id="cr-fullname-error" class="cr-field__error" role="alert">{{ message }}</p>
            }
          </div>

          <div class="cr-field">
            <label for="cr-organization">{{ t().contact.fields.organization.label }}</label>
            <input
              id="cr-organization"
              class="cr-control"
              type="text"
              formControlName="organization"
              autocomplete="organization"
              [attr.placeholder]="t().contact.fields.organization.placeholder"
              [attr.maxlength]="limits.organization.max"
              [attr.aria-invalid]="ariaInvalid('organization')"
              [attr.aria-describedby]="describedBy('cr-organization', errorFor('organization'))"
            />
            <p id="cr-organization-hint" class="cr-field__hint">{{ t().contact.fields.organization.hint }}</p>
            @if (errorFor('organization'); as message) {
              <p id="cr-organization-error" class="cr-field__error" role="alert">{{ message }}</p>
            }
          </div>
        </div>

        <div class="cr-grid-2">
          <div class="cr-field">
            <label for="cr-email">{{ t().contact.fields.email.label }}</label>
            <input
              id="cr-email"
              class="cr-control"
              type="email"
              formControlName="email"
              autocomplete="email"
              dir="ltr"
              [attr.placeholder]="t().contact.fields.email.placeholder"
              [attr.maxlength]="limits.email.max"
              [attr.aria-invalid]="ariaInvalid('email')"
              [attr.aria-describedby]="describedBy('cr-email', errorFor('email'))"
            />
            <p id="cr-email-hint" class="cr-field__hint">{{ t().contact.fields.email.hint }}</p>
            @if (errorFor('email'); as message) {
              <p id="cr-email-error" class="cr-field__error" role="alert">{{ message }}</p>
            }
          </div>

          <div class="cr-field">
            <label for="cr-phone">{{ t().contact.fields.phone.label }}</label>
            <input
              id="cr-phone"
              class="cr-control"
              type="tel"
              inputmode="tel"
              formControlName="phone"
              autocomplete="tel"
              dir="ltr"
              [attr.placeholder]="t().contact.fields.phone.placeholder"
              [attr.maxlength]="limits.phone.max"
              [attr.aria-invalid]="ariaInvalid('phone')"
              [attr.aria-describedby]="describedBy('cr-phone', errorFor('phone'), phonePreview() ? 'cr-phone-preview' : null)"
            />
            <p id="cr-phone-hint" class="cr-field__hint">{{ t().contact.fields.phone.hint }}</p>
            @if (phonePreview(); as preview) {
              <p id="cr-phone-preview" class="cr-field__hint cr-field__hint--preview" aria-live="polite">
                <span dir="ltr">{{ preview }}</span>
              </p>
            }
            @if (errorFor('phone'); as message) {
              <p id="cr-phone-error" class="cr-field__error" role="alert">{{ message }}</p>
            }
          </div>
        </div>

        <div class="cr-field">
          <label for="cr-size">{{ t().contact.fields.size.label }}</label>
          <select
            id="cr-size"
            class="cr-control"
            formControlName="size"
            [attr.aria-invalid]="ariaInvalid('size')"
            [attr.aria-describedby]="describedBy('cr-size', errorFor('size'))"
          >
            <option value="">{{ t().contact.sizes.none }}</option>
            @for (option of sizeOptions(); track option.value) {
              <option [value]="option.value">{{ option.label }}</option>
            }
          </select>
          <p id="cr-size-hint" class="cr-field__hint">{{ t().contact.fields.size.hint }}</p>
          @if (errorFor('size'); as message) {
            <p id="cr-size-error" class="cr-field__error" role="alert">{{ message }}</p>
          }
        </div>

        <div class="cr-field">
          <label for="cr-message">{{ t().contact.fields.message.label }}</label>
          <textarea
            id="cr-message"
            class="cr-control cr-control--area"
            rows="6"
            formControlName="message"
            [attr.placeholder]="t().contact.fields.message.placeholder"
            [attr.maxlength]="limits.message.max"
            [attr.aria-invalid]="ariaInvalid('message')"
            [attr.aria-describedby]="describedBy('cr-message', errorFor('message'), 'cr-message-counter')"
          ></textarea>
          <div class="cr-field__row">
            <p id="cr-message-hint" class="cr-field__hint">{{ t().contact.fields.message.hint }}</p>
            <p id="cr-message-counter" class="cr-counter" aria-live="polite" aria-atomic="true">{{ messageCounter() }}</p>
          </div>
          @if (errorFor('message'); as message) {
            <p id="cr-message-error" class="cr-field__error" role="alert">{{ message }}</p>
          }
        </div>

        <div class="cr-field">
          <div class="cr-check">
            <input
              id="cr-consent"
              type="checkbox"
              formControlName="consent"
              [attr.aria-invalid]="ariaInvalid('consent')"
              [attr.aria-describedby]="errorFor('consent') ? 'cr-consent-error' : null"
            />
            <label for="cr-consent">
              {{ t().contact.fields.consent.label }}
              <a [routerLink]="'/legal/terms'">{{ t().contact.fields.consent.linkLabel }}</a>
            </label>
          </div>
          @if (errorFor('consent'); as message) {
            <p id="cr-consent-error" class="cr-field__error" role="alert">{{ message }}</p>
          }
        </div>

        <!--
          Champ piège anti-robots : hors écran, jamais atteint au clavier ni annoncé.
          Toute valeur non vide ⇒ aucun appel HTTP, faux succès silencieux (plan § 4.5).
        -->
        <div class="cr-honeypot" aria-hidden="true">
          <label for="cr-website">{{ t().contact.fields.website.label }}</label>
          <input id="cr-website" type="text" formControlName="website" tabindex="-1" autocomplete="off" />
        </div>

        @if (turnstileSiteKey) {
          <app-turnstile-widget
            [siteKey]="turnstileSiteKey"
            [locale]="locale()"
            [ariaLabel]="t().contact.turnstile.ariaLabel"
            (token)="turnstileToken.set($event)"
            (failed)="onTurnstileFailed()"
          />
          @if (turnstileFailed()) {
            <p class="cr-field__hint" role="status">{{ t().contact.errors.turnstileUnavailable }}</p>
          }
        }

        <div class="cr-actions">
          <button type="submit" class="cr-btn cr-btn--primary" [disabled]="!canSubmit()">
            @if (status() === 'submitting') {
              <span class="cr-spinner" aria-hidden="true"></span>
              {{ t().contact.submit.submitting }}
            } @else {
              {{ t().contact.submit.idle }}
            }
          </button>
          <p class="cr-reassurance">
            @for (item of t().contact.reassurance; track item; let last = $last) {
              <span>{{ item }}</span>
              @if (!last) {
                <span class="cr-reassurance__sep" aria-hidden="true">·</span>
              }
            }
          </p>
        </div>
      </form>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .cr-form {
        display: grid;
        gap: 1.15rem;
      }
      .cr-grid-2 {
        display: grid;
        gap: 1.15rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      @media (max-width: 640px) {
        .cr-grid-2 {
          grid-template-columns: 1fr;
        }
      }
      .cr-field {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        min-inline-size: 0;
      }
      .cr-field label {
        font-size: 0.9rem;
        font-weight: 600;
        color: #334155;
      }
      .cr-field__row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 1rem;
      }
      .cr-field__hint {
        margin: 0;
        font-size: 0.8rem;
        color: #64748b;
      }
      .cr-field__hint--preview {
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.04em;
      }
      .cr-field__error {
        margin: 0;
        font-size: 0.85rem;
        font-weight: 500;
        color: #991b1b;
      }
      .cr-control {
        inline-size: 100%;
        min-block-size: 48px;
        padding-block: 0;
        padding-inline: 0.9rem;
        border: 1px solid #cbd5e1;
        border-radius: 0.5rem;
        background: #fff;
        font: inherit;
        font-size: 0.95rem;
        color: #0f172a;
        transition:
          border-color 0.15s,
          box-shadow 0.15s;
      }
      .cr-control::placeholder {
        color: #94a3b8;
      }
      .cr-control:hover {
        border-color: #94a3b8;
      }
      .cr-control:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 4px #dbeafe;
      }
      .cr-control[aria-invalid='true'] {
        border-color: #dc2626;
      }
      .cr-control[aria-invalid='true']:focus {
        box-shadow: 0 0 0 4px #fee2e2;
      }
      .cr-control:disabled {
        background: #f8fafc;
        color: #64748b;
        cursor: not-allowed;
      }
      .cr-control--area {
        min-block-size: 140px;
        padding-block: 0.75rem;
        resize: vertical;
        line-height: 1.5;
      }
      .cr-counter {
        margin: 0;
        font-size: 0.8rem;
        color: #64748b;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .cr-check {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        min-block-size: 44px;
        padding-block: 0.35rem;
      }
      .cr-check input {
        inline-size: 20px;
        block-size: 20px;
        margin-block-start: 0.15rem;
        accent-color: #2563eb;
        flex-shrink: 0;
        cursor: pointer;
      }
      .cr-check label {
        font-size: 0.9rem;
        color: #334155;
        cursor: pointer;
      }
      .cr-check a {
        color: #1d4ed8;
        font-weight: 600;
        text-decoration: underline;
        text-underline-offset: 0.15em;
      }
      .cr-check input[aria-invalid='true'] {
        outline: 2px solid #dc2626;
        outline-offset: 2px;
        border-radius: 3px;
      }
      /*
       * Exception volontaire et unique à la règle « propriétés CSS logiques » (plan § 6.4 / B.6.2) :
       * le champ piège doit rester hors écran quelle que soit la direction (LTR/RTL) — left physique.
       * Pas de display:none : certains robots l'ignorent.
       */
      .cr-honeypot {
        position: absolute;
        left: -9999px;
        inline-size: 1px;
        block-size: 1px;
        overflow: hidden;
      }
      .cr-actions {
        display: grid;
        gap: 0.9rem;
        margin-block-start: 0.25rem;
      }
      .cr-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.55rem;
        min-block-size: 48px;
        padding-block: 0;
        padding-inline: 1.5rem;
        border-radius: 999px;
        border: 1px solid transparent;
        font: inherit;
        font-size: 0.95rem;
        font-weight: 600;
        text-decoration: none;
        cursor: pointer;
        transition:
          background-color 0.15s,
          box-shadow 0.15s;
      }
      .cr-btn:focus-visible {
        outline: 3px solid #93c5fd;
        outline-offset: 2px;
      }
      .cr-btn--primary {
        inline-size: 100%;
        background: #2563eb;
        color: #fff;
      }
      .cr-btn--primary:hover:not(:disabled) {
        background: #1d4ed8;
      }
      .cr-btn--primary:disabled {
        cursor: not-allowed;
        opacity: 0.75;
      }
      .cr-btn--secondary {
        background: #fff;
        color: #1d4ed8;
        border-color: #bfdbfe;
      }
      .cr-btn--secondary:hover {
        background: #eff6ff;
        border-color: #93c5fd;
      }
      .cr-btn--inline {
        inline-size: auto;
      }
      .cr-spinner {
        inline-size: 18px;
        block-size: 18px;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.4);
        border-block-start-color: #fff;
        animation: cr-spin 0.8s linear infinite;
      }
      @keyframes cr-spin {
        to {
          transform: rotate(360deg);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .cr-spinner {
          animation: none;
          border-color: #fff;
        }
        .cr-control {
          transition: none;
        }
      }
      .cr-reassurance {
        margin: 0;
        text-align: center;
        font-size: 0.8rem;
        color: #64748b;
      }
      .cr-reassurance__sep {
        padding-inline: 0.45rem;
        color: #94a3b8;
      }
      .cr-alert {
        padding-block: 0.95rem;
        padding-inline: 1.05rem;
        border: 1px solid;
        border-radius: 0.75rem;
        font-size: 0.95rem;
      }
      .cr-alert p {
        margin: 0;
      }
      .cr-alert p + p {
        margin-block-start: 0.3rem;
      }
      .cr-alert--error {
        background: #fef2f2;
        border-color: #fecaca;
        color: #991b1b;
      }
      .cr-alert--warning {
        background: #fffbeb;
        border-color: #fde68a;
        color: #92400e;
      }
      .cr-panel {
        padding-block: 1rem 0.5rem;
        text-align: center;
      }
      .cr-panel:focus {
        outline: none;
      }
      .cr-panel:focus-visible {
        outline: 3px solid #93c5fd;
        outline-offset: 2px;
      }
      .cr-panel__icon {
        inline-size: 72px;
        block-size: 72px;
        margin-block: 0 1.25rem;
        margin-inline: auto;
        border-radius: 50%;
        display: grid;
        place-items: center;
        font-size: 2rem;
      }
      .cr-panel__icon--success {
        background: #f0fdf4;
        border: 1px solid #bbf7d0;
        color: #16a34a;
      }
      .cr-panel__title {
        margin-block: 0 0.75rem;
        margin-inline: 0;
        font-size: 1.5rem;
        font-weight: 800;
        letter-spacing: -0.01em;
        color: #0f172a;
      }
      .cr-panel__ref {
        margin: 0;
      }
      .cr-panel__ref span {
        display: inline-flex;
        padding-block: 0.45rem;
        padding-inline: 0.9rem;
        border-radius: 999px;
        background: #f1f5f9;
        border: 1px solid #e2e8f0;
        color: #0f172a;
        font-weight: 700;
        letter-spacing: 0.04em;
        unicode-bidi: isolate;
      }
      .cr-panel__text {
        margin-block: 1rem 0;
        margin-inline: auto;
        max-inline-size: 34rem;
        color: #475569;
      }
      .cr-panel__actions {
        display: flex;
        gap: 0.75rem;
        justify-content: center;
        flex-wrap: wrap;
        margin-block-start: 1.5rem;
      }
    `
  ]
})
export class ContactRequestFormComponent implements OnInit, OnDestroy {
  /** Objet présélectionné quand `?objet=` est absent ou invalide. */
  readonly defaultSubject = input<ContactRequestSubject>('acces-entreprise');

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly client = inject(PublicContactRequestsClient);
  private readonly draft = inject(ContactRequestDraftService);
  private readonly route = inject(ActivatedRoute);
  private readonly landingLocale = inject(LandingLocaleService);
  private readonly copy = inject(LandingCopyService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly t = this.copy.t;
  protected readonly locale = this.landingLocale.locale;
  protected readonly limits = CONTACT_REQUEST_LIMITS;
  protected readonly subjects = CONTACT_REQUEST_SUBJECTS;
  /** `''` ⇒ le widget (et son script) n'est jamais chargé. */
  protected readonly turnstileSiteKey = environment.turnstileSiteKey;
  protected readonly fallbackEmail = CONTACT_FALLBACK_EMAIL;
  protected readonly mailtoHref = `mailto:${CONTACT_FALLBACK_EMAIL}`;

  protected readonly status = signal<ContactFormStatus>('idle');
  protected readonly error = signal<ContactSubmitError | null>(null);
  protected readonly reference = signal<string | null>(null);
  protected readonly turnstileToken = signal<string | null>(null);
  protected readonly turnstileFailed = signal(false);
  /** Secondes restantes avant réactivation du bouton après un 429. */
  protected readonly blockedSecondsLeft = signal(0);

  private readonly statusPanel = viewChild<ElementRef<HTMLElement>>('statusPanel');
  private readonly alertPanel = viewChild<ElementRef<HTMLElement>>('alertPanel');
  private readonly turnstileWidget = viewChild(TurnstileWidgetComponent);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private openedAt = 0;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  readonly form = this.fb.group({
    subject: this.fb.control<ContactRequestSubject>('acces-entreprise', Validators.required),
    fullName: this.fb.control('', [
      Validators.required,
      Validators.minLength(CONTACT_REQUEST_LIMITS.fullName.min),
      Validators.maxLength(CONTACT_REQUEST_LIMITS.fullName.max),
      ContactValidators.singleLine()
    ]),
    organization: this.fb.control('', [
      Validators.required,
      Validators.minLength(CONTACT_REQUEST_LIMITS.organization.min),
      Validators.maxLength(CONTACT_REQUEST_LIMITS.organization.max),
      ContactValidators.singleLine()
    ]),
    email: this.fb.control('', [Validators.required, ContactValidators.email()]),
    phone: this.fb.control('', [
      Validators.required,
      Validators.maxLength(CONTACT_REQUEST_LIMITS.phone.max),
      ContactValidators.tunisianPhone()
    ]),
    size: this.fb.control<ContactRequestSize | ''>('', ContactValidators.contactSize()),
    message: this.fb.control('', [
      Validators.required,
      Validators.minLength(CONTACT_REQUEST_LIMITS.message.min),
      Validators.maxLength(CONTACT_REQUEST_LIMITS.message.max),
      ContactValidators.noControlChars()
    ]),
    consent: this.fb.control(false, Validators.requiredTrue),
    website: this.fb.control('')
  });

  private readonly subjectValue = toSignal(this.form.controls.subject.valueChanges, {
    initialValue: this.form.controls.subject.value
  });

  /** Options de taille : dossiers pour une démo cabinet, employés sinon. */
  protected readonly sizeOptions = computed(() =>
    this.subjectValue() === 'demo-cabinet' ? this.t().contact.sizes.dossiers : this.t().contact.sizes.employes
  );

  private readonly messageValue = toSignal(this.form.controls.message.valueChanges, { initialValue: '' });
  protected readonly messageCounter = computed(() =>
    this.copy.format(this.t().contact.messageCounter, {
      count: this.messageValue().length,
      max: CONTACT_REQUEST_LIMITS.message.max
    })
  );

  private readonly phoneValue = toSignal(this.form.controls.phone.valueChanges, { initialValue: '' });
  /** Aperçu du numéro normalisé (affiché seulement s'il diffère de la saisie). */
  protected readonly phonePreview = computed(() => {
    const raw = this.phoneValue();
    if (!raw.trim()) {
      return null;
    }
    const normalized = normalizeTunisianPhone(raw);
    return normalized !== raw.trim() ? normalized : null;
  });

  protected readonly disabledState = computed(() => this.status() === 'error' && this.error()?.kind === 'disabled');
  protected readonly canSubmit = computed(() => this.status() !== 'submitting' && this.blockedSecondsLeft() === 0);

  protected readonly disabledMessage = computed(() =>
    this.copy.format(this.t().contact.errors.disabled, { email: CONTACT_FALLBACK_EMAIL })
  );

  protected readonly rateLimitMessage = computed(() => {
    const seconds = this.blockedSecondsLeft();
    return seconds > 0
      ? this.copy.format(this.t().contact.errors.rateLimited, { seconds })
      : this.t().contact.errors.rateLimitedFallback;
  });

  /** Messages du bandeau global (`role="alert"`) selon l'erreur courante. */
  protected readonly alertMessages = computed<string[]>(() => {
    const err = this.error();
    if (!err || this.status() !== 'error') {
      return [];
    }
    switch (err.kind) {
      case 'validation': {
        const messages = [this.t().contact.errors.validationGlobal];
        // Messages serveur sans contrôle correspondant (locale, honeypot, elapsedMs, turnstileToken…).
        for (const [name, message] of Object.entries(err.fieldErrors)) {
          if (!this.form.get(name) && message) {
            messages.push(message);
          }
        }
        return messages;
      }
      case 'rateLimited':
        return [this.rateLimitMessage()];
      case 'network':
        return [this.t().contact.errors.network];
      case 'unknown':
        return [this.t().contact.errors.unknown];
      default:
        return [];
    }
  });

  ngOnInit(): void {
    this.openedAt = Date.now();
    const fromQuery = this.route.snapshot.queryParamMap.get('objet');
    this.form.patchValue({
      ...this.draft.get(),
      subject: isContactRequestSubject(fromQuery) ? fromQuery : this.defaultSubject()
    });

    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const objet = params.get('objet');
      if (isContactRequestSubject(objet)) {
        this.form.controls.subject.setValue(objet);
      }
    });

    // Brouillon en mémoire uniquement (jamais localStorage/sessionStorage) ; rien n'est
    // réécrit après un succès (le brouillon est vidé et le formulaire réinitialisé).
    this.form.valueChanges.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe(value => {
      if (this.status() !== 'success') {
        this.draft.set(value);
      }
    });

    // La liste des tailles dépend de l'objet : toute sélection devient invalide au changement.
    this.form.controls.subject.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.form.controls.size.setValue('');
    });

    // Une erreur serveur attachée à un champ disparaît dès que l'utilisateur le modifie.
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.clearServerErrors());
  }

  ngOnDestroy(): void {
    this.stopCountdown();
  }

  protected onTurnstileFailed(): void {
    this.turnstileFailed.set(true);
    this.turnstileToken.set(null);
  }

  submit(): void {
    if (this.status() === 'submitting' || this.blockedSecondsLeft() > 0) {
      return;
    }
    this.clearServerErrors();
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.focusFirstInvalid();
      return;
    }
    const value = this.form.getRawValue();
    if (value.website.trim() !== '') {
      // Piège rempli : faux succès silencieux, rien n'est envoyé ni persisté (plan § 4.5).
      this.reference.set(null);
      this.status.set('success');
      this.draft.clear();
      this.focusStatusPanel();
      return;
    }
    const token = this.turnstileToken();
    const dto: CreateContactRequestDto = {
      subject: value.subject,
      fullName: value.fullName.trim(),
      organization: value.organization.trim(),
      email: value.email.trim(),
      phone: normalizeTunisianPhone(value.phone),
      ...(value.size ? { size: value.size } : {}),
      message: value.message.trim(),
      consent: true,
      locale: this.landingLocale.locale(),
      honeypot: '',
      elapsedMs: Math.max(0, Math.round(Date.now() - this.openedAt)),
      ...(token ? { turnstileToken: token } : {})
    };
    this.status.set('submitting');
    this.form.disable();
    this.client.submit(dto).subscribe({
      next: accepted => {
        this.reference.set(accepted.reference || null);
        this.status.set('success');
        this.draft.clear();
        this.form.enable();
        // Le formulaire est réinitialisé mais l'objet de la demande est conservé.
        this.form.reset({ subject: value.subject });
        this.turnstileWidget()?.reset();
        this.turnstileToken.set(null);
        this.focusStatusPanel();
      },
      error: (err: unknown) => {
        const mapped = mapContactSubmitError(err);
        this.form.enable();
        this.error.set(mapped);
        this.status.set('error');
        this.turnstileWidget()?.reset();
        this.turnstileToken.set(null);
        if (mapped.kind === 'validation') {
          this.applyServerErrors(mapped);
          this.focusAlertPanel();
        } else if (mapped.kind === 'rateLimited') {
          this.startCountdown(mapped.retryAfterSeconds);
          this.focusAlertPanel();
        } else if (mapped.kind === 'disabled') {
          this.focusStatusPanel();
        } else {
          this.focusAlertPanel();
        }
      }
    });
  }

  /** Retour au formulaire vide (objet conservé) après un succès. */
  protected resetForAnother(): void {
    this.status.set('idle');
    this.error.set(null);
    this.reference.set(null);
    this.openedAt = Date.now();
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('#cr-subject')?.focus());
  }

  protected successReference(ref: string): string {
    return this.copy.format(this.t().contact.success.reference, { reference: ref });
  }

  protected ariaInvalid(name: ContactControlName): 'true' | null {
    return this.errorFor(name) !== null ? 'true' : null;
  }

  protected describedBy(fieldId: string, error: string | null, ...extra: (string | null)[]): string | null {
    const ids = [`${fieldId}-hint`, ...extra.filter((id): id is string => !!id)];
    if (error !== null) {
      ids.push(`${fieldId}-error`);
    }
    return ids.length > 0 ? ids.join(' ') : null;
  }

  /** Message d'erreur d'un champ : erreur serveur prioritaire, sinon première règle en échec. */
  protected errorFor(name: ContactControlName): string | null {
    const control = this.form.controls[name];
    const errors = control.errors;
    if (!errors || (!control.touched && !control.dirty)) {
      return null;
    }
    const copy = this.t().contact.errors;
    const server = errors['server'];
    if (typeof server === 'string') {
      return server;
    }
    if (name === 'consent' && (errors['required'] || errors['requiredTrue'])) {
      return copy.consent;
    }
    if (errors['required']) {
      return copy.required;
    }
    if (errors['email']) {
      return copy.email;
    }
    if (errors['tunisianPhone']) {
      return copy.phone;
    }
    if (errors['minlength']) {
      return this.copy.format(copy.minLength, { min: errors['minlength'].requiredLength });
    }
    if (errors['maxlength']) {
      return this.copy.format(copy.maxLength, { max: errors['maxlength'].requiredLength });
    }
    return copy.validationGlobal;
  }

  private applyServerErrors(err: Extract<ContactSubmitError, { kind: 'validation' }>): void {
    for (const [name, message] of Object.entries(err.fieldErrors)) {
      const control = this.form.get(name);
      if (control && message) {
        control.setErrors({ ...control.errors, server: message });
        control.markAsTouched();
      }
    }
  }

  private clearServerErrors(): void {
    for (const control of Object.values(this.form.controls)) {
      const current = control.errors;
      if (current && typeof current['server'] === 'string') {
        const { server: _dropped, ...rest } = current;
        control.setErrors(Object.keys(rest).length > 0 ? rest : null);
      }
    }
  }

  private startCountdown(seconds: number): void {
    this.stopCountdown();
    this.blockedSecondsLeft.set(Math.max(0, Math.round(seconds)));
    this.countdownTimer = setInterval(() => {
      const left = Math.max(0, this.blockedSecondsLeft() - 1);
      this.blockedSecondsLeft.set(left);
      if (left === 0) {
        this.stopCountdown();
        this.error.set(null);
        this.status.set('idle');
      }
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.countdownTimer !== null) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  private focusFirstInvalid(): void {
    this.host.nativeElement.querySelector<HTMLElement>('form .ng-invalid')?.focus();
  }

  private focusStatusPanel(): void {
    setTimeout(() => this.statusPanel()?.nativeElement.focus());
  }

  private focusAlertPanel(): void {
    setTimeout(() => this.alertPanel()?.nativeElement.focus());
  }
}
