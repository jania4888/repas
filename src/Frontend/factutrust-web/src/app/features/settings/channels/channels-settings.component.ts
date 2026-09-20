import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { TagModule } from 'primeng/tag';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AuthService } from '@core/services/auth.service';
import { environment } from '../../../../environments/environment';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string | null;
  errors?: string[];
}

interface ChannelStatusDto {
  enabled: boolean;
  whatsAppEnabled: boolean;
  linked: boolean;
  linkedNumberMasked?: string | null;
  verifiedAtUtc?: string | null;
}

interface ChannelLinkCodeDto {
  code: string;
  expiresAtUtc: string;
  ttlMinutes: number;
}

interface ChannelBridgeStatusDto {
  enabled: boolean;
  whatsAppEnabled: boolean;
  state: string;
  lastError?: string | null;
  sinceUtc: string;
}

interface ChannelBridgeQrDto {
  qrPng?: string | null;
}

/**
 * Paramètres → WhatsApp : liaison du numéro WhatsApp personnel à l'assistant IA.
 * Page personnelle (chaque utilisateur gère SA liaison) — patron storefront-settings :
 * standalone + signals + HttpClient direct sur `environment.apiUrl`.
 */
@Component({
  selector: 'app-channels-settings',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    ButtonModule,
    MessageModule,
    TagModule,
    ConfirmDialogModule,
    PageHeaderComponent,
    BreadcrumbComponent
  ],
  providers: [ConfirmationService],
  template: `
    <div class="channels-settings">
      <app-breadcrumb [items]="breadcrumbItems()" />
      <app-page-header
        title="WhatsApp"
        subtitle="Liez votre WhatsApp à l'assistant IA et recevez vos rappels fiscaux" />

      <p-confirmDialog />

      @if (error(); as message) {
        <p-message severity="error" [text]="message" />
      }

      @if (loading()) {
        <p-card><p class="muted">Chargement…</p></p-card>
      } @else if (!featureEnabled()) {
        <p-card>
          <div class="feature-off">
            <i class="pi pi-lock feature-off-icon"></i>
            <h3>Fonctionnalité non activée</h3>
            <p class="muted">
              Le canal WhatsApp n'est pas activé sur cette installation.
              Contactez votre administrateur de plateforme.
            </p>
          </div>
        </p-card>
      } @else if (status()?.linked) {
        <p-card>
          <div class="linked-panel">
            <div class="linked-head">
              <i class="pi pi-whatsapp wa-icon"></i>
              <div>
                <h3>WhatsApp lié <p-tag severity="success" value="Actif" /></h3>
                <p class="muted">
                  Numéro {{ status()?.linkedNumberMasked || 'lié' }}
                  @if (status()?.verifiedAtUtc) {
                    — lié le {{ status()?.verifiedAtUtc | date: 'dd/MM/yyyy à HH:mm' }}
                  }
                </p>
              </div>
            </div>
            <p>
              Envoyez vos questions en français au numéro WhatsApp de l'assistant :
              « Quel est mon chiffre d'affaires ce mois-ci ? », « Mes factures impayées ? »…
              L'assistant répond en <strong>lecture seule</strong> : aucune modification de vos
              données n'est possible depuis WhatsApp.
            </p>
            <p-button
              label="Délier ce numéro"
              icon="pi pi-times"
              severity="danger"
              [outlined]="true"
              [loading]="working()"
              (onClick)="confirmUnlink()" />
          </div>
        </p-card>
      } @else {
        <p-card>
          <div class="link-panel">
            <div class="linked-head">
              <i class="pi pi-whatsapp wa-icon"></i>
              <div>
                <h3>Lier votre WhatsApp</h3>
                <p class="muted">
                  Générez un code, puis envoyez-le depuis votre WhatsApp au numéro de l'assistant.
                </p>
              </div>
            </div>

            @if (issuedCode(); as issued) {
              <div class="code-panel">
                <span class="code-label">Votre code de liaison (valable {{ issued.ttlMinutes }} min)&nbsp;:</span>
                <span class="code-value">{{ issued.code }}</span>
                @if (remainingSeconds() > 0) {
                  <span class="code-countdown">Expire dans {{ remainingLabel() }}</span>
                } @else {
                  <span class="code-countdown expired">Code expiré — générez-en un nouveau.</span>
                }
                <ol class="steps">
                  <li>Ouvrez WhatsApp sur votre téléphone.</li>
                  <li>Écrivez au numéro WhatsApp de l'assistant de votre entreprise.</li>
                  <li>Envoyez le message : <code>LIER {{ issued.code }}</code></li>
                  <li>Vous recevrez une confirmation, puis posez vos questions librement.</li>
                </ol>
              </div>
            }

            <p-button
              [label]="issuedCode() ? 'Générer un nouveau code' : 'Générer un code'"
              icon="pi pi-key"
              [loading]="working()"
              (onClick)="generateCode()" />

            <p-message
              severity="info"
              text="Lecture seule : l'assistant WhatsApp consulte vos données mais ne peut jamais les modifier." />
          </div>
        </p-card>
      }

      @if (!loading() && featureEnabled() && isAdmin()) {
        <p-card>
          <div class="admin-panel">
            <div class="linked-head">
              <i class="pi pi-server wa-icon admin-icon"></i>
              <div>
                <h3>
                  Connexion du bot WhatsApp
                  <p-tag [severity]="bridgeSeverity()" [value]="bridgeLabel()" />
                </h3>
                <p class="muted">
                  Administration de la session WhatsApp partagée (le bot qui répond à vos équipes).
                </p>
              </div>
            </div>

            @if (bridgeStatus()?.lastError; as lastError) {
              <p-message severity="warn" [text]="lastError" />
            }

            @switch (bridgeStatus()?.state) {
              @case ('WaitingQr') {
                <div class="qr-panel">
                  <p>Scannez ce QR code avec WhatsApp (Réglages → Appareils connectés → Connecter un appareil) :</p>
                  @if (qrDataUri(); as qr) {
                    <img class="qr-image" [src]="qr" alt="QR code de connexion WhatsApp" />
                  } @else {
                    <p class="muted">Génération du QR code…</p>
                  }
                </div>
              }
              @case ('Ready') {
                <p-message severity="success" text="Le bot est connecté et opérationnel." />
              }
              @case ('DependenciesMissing') {
                <p-message severity="error"
                  text="Dépendances Node manquantes : exécutez « npm ci » dans le dossier WhatsAppBridge du serveur, puis redémarrez." />
              }
              @case ('NodeMissing') {
                <p-message severity="error"
                  text="Node.js est introuvable sur le serveur. Installez Node.js puis redémarrez le bot." />
              }
            }

            <div class="admin-actions">
              <p-button
                label="Redémarrer"
                icon="pi pi-refresh"
                [outlined]="true"
                [loading]="bridgeWorking()"
                (onClick)="restartBridge()" />
              <p-button
                label="Déconnecter la session"
                icon="pi pi-sign-out"
                severity="danger"
                [outlined]="true"
                [loading]="bridgeWorking()"
                (onClick)="confirmLogoutBridge()" />
            </div>
          </div>
        </p-card>
      }
    </div>
  `,
  styles: [`
    .channels-settings {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    .muted { color: var(--color-neutral-500); margin: 0; }

    .feature-off {
      text-align: center;
      padding: var(--spacing-6);

      .feature-off-icon { font-size: 2rem; color: var(--color-neutral-400); }
      h3 { margin: var(--spacing-3) 0 var(--spacing-2); }
    }

    .linked-panel, .link-panel {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    .linked-head {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);

      h3 { margin: 0; display: flex; align-items: center; gap: var(--spacing-2); }
    }

    .wa-icon { font-size: 2rem; color: var(--color-success-600); }

    .code-panel {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      padding: var(--spacing-4);
      border: 1px dashed var(--color-neutral-300);
      border-radius: var(--radius-md);
      background: var(--color-neutral-50);
    }

    .code-label { font-size: var(--font-size-sm); color: var(--color-neutral-600); }

    .code-value {
      font-family: var(--font-family-mono, monospace);
      font-size: 1.75rem;
      font-weight: 700;
      letter-spacing: 0.35em;
      color: var(--color-primary-700);
    }

    .code-countdown { font-size: var(--font-size-sm); color: var(--color-warning-600); }
    .code-countdown.expired { color: var(--color-danger-600, #d32f2f); }

    .steps {
      margin: var(--spacing-2) 0 0;
      padding-left: var(--spacing-5);
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);

      code {
        background: var(--color-neutral-100);
        padding: 0 var(--spacing-1);
        border-radius: var(--radius-sm);
      }
    }

    .admin-panel {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    .admin-icon { color: var(--color-neutral-600); }

    .qr-panel {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-4);
      border: 1px dashed var(--color-neutral-300);
      border-radius: var(--radius-md);
      background: var(--color-neutral-50);
    }

    .qr-image {
      width: 264px;
      height: 264px;
      max-width: 100%;
      image-rendering: pixelated;
      background: #fff;
      padding: var(--spacing-2);
      border-radius: var(--radius-sm);
    }

    .admin-actions {
      display: flex;
      gap: var(--spacing-2);
      flex-wrap: wrap;
    }
  `]
})
export class ChannelsSettingsComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly auth = inject(AuthService);

  readonly loading = signal(true);
  readonly working = signal(false);
  readonly error = signal<string | null>(null);
  readonly status = signal<ChannelStatusDto | null>(null);
  readonly issuedCode = signal<ChannelLinkCodeDto | null>(null);
  readonly remainingSeconds = signal(0);

  // Section administration (bot partagé) — réservée aux Administrateurs.
  readonly bridgeStatus = signal<ChannelBridgeStatusDto | null>(null);
  readonly qrDataUri = signal<string | null>(null);
  readonly bridgeWorking = signal(false);

  readonly isAdmin = this.auth.isAdmin;

  private countdownHandle: ReturnType<typeof setInterval> | null = null;
  private bridgePollHandle: ReturnType<typeof setInterval> | null = null;

  readonly breadcrumbItems = computed<BreadcrumbItem[]>(() => [
    { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
    { label: 'Paramètres', route: '/settings' },
    { label: 'WhatsApp' }
  ]);

  readonly featureEnabled = computed(() => {
    const s = this.status();
    return !!s && s.enabled && s.whatsAppEnabled;
  });

  readonly remainingLabel = computed(() => {
    const total = this.remainingSeconds();
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  });

  readonly bridgeLabel = computed(() => {
    switch (this.bridgeStatus()?.state) {
      case 'Ready': return 'Connecté';
      case 'WaitingQr': return 'En attente de scan';
      case 'Initializing':
      case 'Authenticated': return 'Démarrage…';
      case 'Disconnected': return 'Déconnecté';
      case 'AuthFailure': return 'Échec d’authentification';
      case 'DependenciesMissing': return 'Dépendances manquantes';
      case 'NodeMissing': return 'Node.js introuvable';
      case 'Stopped': return 'Arrêté';
      default: return 'Inconnu';
    }
  });

  readonly bridgeSeverity = computed<'success' | 'warn' | 'danger' | 'info' | 'secondary'>(() => {
    switch (this.bridgeStatus()?.state) {
      case 'Ready': return 'success';
      case 'WaitingQr':
      case 'Disconnected': return 'warn';
      case 'AuthFailure':
      case 'DependenciesMissing':
      case 'NodeMissing': return 'danger';
      case 'Initializing':
      case 'Authenticated': return 'info';
      default: return 'secondary';
    }
  });

  ngOnInit(): void {
    this.refreshStatus();
  }

  ngOnDestroy(): void {
    this.stopCountdown();
    this.stopBridgePolling();
  }

  refreshStatus(): void {
    this.loading.set(true);
    this.error.set(null);
    this.http.get<ApiResponse<ChannelStatusDto>>(`${environment.apiUrl}/channels/status`).subscribe({
      next: response => {
        this.status.set(response.data ?? null);
        this.loading.set(false);
        if (this.featureEnabled() && this.isAdmin()) {
          this.startBridgePolling();
        }
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errorHandler.extractErrorMessage(err));
      }
    });
  }

  generateCode(): void {
    this.working.set(true);
    this.error.set(null);
    this.http.post<ApiResponse<ChannelLinkCodeDto>>(`${environment.apiUrl}/channels/link-code`, {}).subscribe({
      next: response => {
        this.working.set(false);
        const issued = response.data ?? null;
        this.issuedCode.set(issued);
        if (issued) {
          this.startCountdown(issued.expiresAtUtc);
        }
      },
      error: err => {
        this.working.set(false);
        this.error.set(this.errorHandler.extractErrorMessage(err));
      }
    });
  }

  confirmUnlink(): void {
    this.confirmation.confirm({
      header: 'Délier ce numéro ?',
      message: 'Votre WhatsApp ne pourra plus interroger l’assistant ni recevoir de rappels. Vous pourrez le relier à tout moment.',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Délier',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.unlink()
    });
  }

  private unlink(): void {
    this.working.set(true);
    this.error.set(null);
    this.http.delete<ApiResponse<boolean>>(`${environment.apiUrl}/channels/links/whatsapp`).subscribe({
      next: () => {
        this.working.set(false);
        this.issuedCode.set(null);
        this.stopCountdown();
        this.refreshStatus();
      },
      error: err => {
        this.working.set(false);
        this.error.set(this.errorHandler.extractErrorMessage(err));
      }
    });
  }

  private startCountdown(expiresAtUtc: string): void {
    this.stopCountdown();
    const expiresAt = new Date(expiresAtUtc).getTime();
    const tick = () => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      this.remainingSeconds.set(remaining);
      if (remaining <= 0) {
        this.stopCountdown();
      }
    };
    tick();
    this.countdownHandle = setInterval(tick, 1000);
  }

  private stopCountdown(): void {
    if (this.countdownHandle !== null) {
      clearInterval(this.countdownHandle);
      this.countdownHandle = null;
    }
  }

  // ── Administration du pont WhatsApp ──

  restartBridge(): void {
    this.bridgeWorking.set(true);
    this.error.set(null);
    this.http.post<ApiResponse<boolean>>(`${environment.apiUrl}/channels/bridge/restart`, {}).subscribe({
      next: () => {
        this.bridgeWorking.set(false);
        this.refreshBridge();
      },
      error: err => {
        this.bridgeWorking.set(false);
        this.error.set(this.errorHandler.extractErrorMessage(err));
      }
    });
  }

  confirmLogoutBridge(): void {
    this.confirmation.confirm({
      header: 'Déconnecter la session WhatsApp ?',
      message: 'Le bot cessera de répondre jusqu’à ce qu’un nouveau QR code soit scanné. Continuer ?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Déconnecter',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.logoutBridge()
    });
  }

  private logoutBridge(): void {
    this.bridgeWorking.set(true);
    this.error.set(null);
    this.http.post<ApiResponse<boolean>>(`${environment.apiUrl}/channels/bridge/logout`, {}).subscribe({
      next: () => {
        this.bridgeWorking.set(false);
        this.qrDataUri.set(null);
        this.refreshBridge();
      },
      error: err => {
        this.bridgeWorking.set(false);
        this.error.set(this.errorHandler.extractErrorMessage(err));
      }
    });
  }

  private startBridgePolling(): void {
    if (this.bridgePollHandle !== null) {
      return;
    }
    this.refreshBridge();
    this.bridgePollHandle = setInterval(() => this.refreshBridge(), 4000);
  }

  private stopBridgePolling(): void {
    if (this.bridgePollHandle !== null) {
      clearInterval(this.bridgePollHandle);
      this.bridgePollHandle = null;
    }
  }

  private refreshBridge(): void {
    this.http.get<ApiResponse<ChannelBridgeStatusDto>>(`${environment.apiUrl}/channels/bridge/status`).subscribe({
      next: response => {
        const bridge = response.data ?? null;
        this.bridgeStatus.set(bridge);
        if (bridge?.state === 'WaitingQr') {
          this.refreshQr();
        } else {
          this.qrDataUri.set(null);
        }
      },
      // Erreur silencieuse : le polling ne doit pas noyer l'UI de messages (ex. 403 si non-admin).
      error: () => this.stopBridgePolling()
    });
  }

  private refreshQr(): void {
    this.http.get<ApiResponse<ChannelBridgeQrDto>>(`${environment.apiUrl}/channels/bridge/qr`).subscribe({
      next: response => this.qrDataUri.set(response.data?.qrPng ?? null),
      error: () => this.qrDataUri.set(null)
    });
  }
}
