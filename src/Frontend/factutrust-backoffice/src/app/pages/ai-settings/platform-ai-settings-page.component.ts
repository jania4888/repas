import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { InputTextModule } from 'primeng/inputtext';
import { MessageService } from 'primeng/api';

import { PlatformAiSettingsService } from '@core/services/platform-ai-settings.service';
import type { OllamaInferenceDevice, PlatformAiSettingsDto } from '@core/models/platform.models';
import { aiProviderLabel } from './ai-provider-label';
import { needsCursorCatalogWarning, needsCursorModelWarning } from './cursor-settings-warnings';
import { isStudioAdvancedModelSameAsStandard } from './studio-advanced-model-warnings';
import { ModalEndpointFieldsComponent } from './modal-endpoint-fields.component';

import { FtPageHeaderComponent } from '@core/ui/page-header/ft-page-header.component';
import { FtSkeletonComponent } from '@core/ui/skeleton/ft-skeleton.component';

interface ModelOption {
  label: string;
  value: string;
  /** Vrai pour un modèle configuré mais absent du moteur IA : affiché, jamais sélectionnable. */
  disabled?: boolean;
}

interface InferenceDeviceOption {
  label: string;
  value: OllamaInferenceDevice;
  description: string;
}

/**
 * Configuration du modèle IA global de la plateforme.
 *
 * Le modèle sélectionné est utilisé par l'Assistant IA de toutes les entreprises
 * (le moteur IA InstaFact tourne sur le serveur partagé de la plateforme). Les utilisateurs des
 * entreprises ne peuvent pas le modifier. L'endpoint Modal (Kimi) peut être surchargé
 * par entreprise depuis la fiche Entreprises.
 */
@Component({
  selector: 'app-platform-ai-settings-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ButtonModule,
    SelectModule,
    ToggleSwitchModule,
    InputTextModule,
    SelectButtonModule,
    FtPageHeaderComponent,
    FtSkeletonComponent,
    ModalEndpointFieldsComponent,
    RouterLink
  ],
  template: `
    <ft-page-header
      title="Configuration IA"
      subtitle="Valeurs par défaut pour toutes les entreprises. Un endpoint Modal dédié se configure sur la fiche de l'entreprise." />

    @if (loading()) {
      <ft-skeleton kind="line" count="5" />
    }
    @if (!loading() && data(); as d) {
      <section class="card">
        <h3>Moteur d'inférence</h3>
        <p class="hint">
          Choisit si le moteur IA InstaFact utilise le GPU (accélération matérielle) ou le CPU uniquement pour
          l'assistant, l'Assistant Studio, l'import de factures et le modèle vision.
        </p>
        <div class="field">
          <label for="inference-device">Exécution</label>
          <p-selectButton
            inputId="inference-device"
            [options]="inferenceDeviceOptions"
            [(ngModel)]="selectedInferenceDevice"
            optionLabel="label"
            optionValue="value"
            [allowEmpty]="false" />
        </div>
        <p class="hint device-hint">
          {{ inferenceDeviceHint() }}
        </p>
        @if (!d.isOllamaAssistantConfigured) {
          <p class="warn">
            Le modèle assistant configuré est cloud (OpenRouter, Modal ou Cursor) : ce réglage s'applique aux modèles InstaFact IA locaux uniquement.
          </p>
        }
        @if (selectedInferenceDevice === 'CpuOnly' && isLargeAssistantModel()) {
          <p class="warn">
            Modèle assistant volumineux détecté : privilégiez un modèle ≤ 4B (ex. qwen2.5:3b-instruct) pour des réponses rapides sur CPU.
          </p>
        }
        @if (selectedInferenceDevice === 'CpuOnly') {
          <p class="hint device-hint">
            Réglages serveur CPU (configuration serveur) : CpuFixedChatNumCtx, CpuFixedChatNumCtxCeiling, CpuNumBatch,
            UseCompactChatPromptOnCpu. Redémarrer l'API après modification.
          </p>
        }
        @if (selectedInferenceDevice === 'CpuOnly' && d.effectiveImportVisionCapable) {
          <p class="warn">
            Import documentaire multimodal : l'analyse d'images sera significativement plus lente en mode CPU uniquement.
          </p>
        }
      </section>

      <section class="card">
        <h3>Modèle IA — Assistant</h3>
        <p class="hint">
          Modèle utilisé par l'Assistant IA de toutes les entreprises (conversation).
        </p>

        @if (d.availableModels.length) {
          <div class="field">
            <label for="ai-model">Modèle utilisé</label>
            <p-select
              inputId="ai-model"
              [options]="modelOptions()"
              [(ngModel)]="selectedModelRef"
              optionLabel="label"
              optionValue="value"
              optionDisabled="disabled"
              appendTo="body"
              styleClass="w-full" />
          </div>
        } @else {
          <p class="empty">
            Aucun modèle détecté. Vérifiez que le moteur IA InstaFact est démarré sur le serveur de la plateforme.
          </p>
        }
        @if (needsCursorModelWarning()) {
          <p class="warn">
            Cursor est activé mais le modèle Assistant n'est pas un modèle Cursor. Le chat utilisera Ollama
            ou le défaut serveur.
          </p>
        }
      </section>

      <section class="card">
        <h3>Modèle IA — Import documentaire (factures et relevés bancaires)</h3>
        <p class="hint">
          Modèle utilisé pour l'import de factures, de pièces comptables scannées et la lecture IA des relevés bancaires.
          Prioritaire sur la configuration serveur. Utilisez un modèle instruct ; pour les PDF scannés et photos,
          choisissez un modèle multimodal (ex. GLM-OCR, gemma3).
        </p>
        @if (selectedImportModelRef && !importModelSupportsVision()) {
          <p class="warn">
            Le modèle d'import sélectionné ne semble pas multimodal : les relevés scannés et les photos de factures
            pourront échouer ou repasser par le repli texte uniquement.
          </p>
        }
        @if (isImportModelInvalid()) {
          <p class="warn">
            Le modèle d'import actuel n'est pas adapté (embedding). Choisissez un modèle instruct
            ou videz le champ pour utiliser la configuration serveur.
          </p>
        }
        @if (isModelMissing(selectedImportModelRef)) {
          <p class="warn">
            Le modèle d'import « {{ selectedImportModelRef }} » n'est pas installé sur le moteur IA :
            l'import de factures échouera. Choisissez un modèle de la liste, ou installez-le sur le
            serveur puis rechargez cette page.
          </p>
        }
        @if (d.availableModels.length) {
          <div class="field">
            <label for="ai-import-model">Modèle d'import</label>
            <p-select
              inputId="ai-import-model"
              [options]="importModelOptions()"
              [(ngModel)]="selectedImportModelRef"
              optionLabel="label"
              optionValue="value"
              optionDisabled="disabled"
              appendTo="body"
              styleClass="w-full" />
          </div>
        }
      </section>

      <section class="card">
        <h3>Modèle IA — Assistant Studio</h3>
        <p class="hint">
          Modèle utilisé par l'Assistant Studio (création de tables, systèmes et plans) pour toutes les entreprises.
          Prioritaire sur le modèle Assistant. « Aucun » = même modèle que l'Assistant / serveur.
        </p>
        @if (d.availableModels.length) {
          <div class="field">
            <label for="ai-studio-model">Modèle Studio</label>
            <p-select
              inputId="ai-studio-model"
              [options]="modelOptions()"
              [(ngModel)]="selectedStudioModelRef"
              optionLabel="label"
              optionValue="value"
              optionDisabled="disabled"
              appendTo="body"
              styleClass="w-full" />
          </div>
          <div class="field field-spaced">
            <label for="ai-studio-advanced-model">Modèle Studio avancé (GPU / cloud)</label>
            <p-select
              inputId="ai-studio-advanced-model"
              [options]="modelOptions()"
              [(ngModel)]="selectedStudioAdvancedModelRef"
              optionLabel="label"
              optionValue="value"
              optionDisabled="disabled"
              appendTo="body"
              styleClass="w-full" />
            <small class="hint">
              Utilisé quand l'utilisateur active « Modèle avancé » dans le Studio : autorise
              plusieurs tours d'outils (le modèle peut lire le schéma puis proposer un plan).
              Choisissez un modèle plus puissant que le modèle Studio standard — GPU distant,
              OpenRouter, Modal ou Cursor. « Aucun » = bascule masquée dans le Studio.
            </small>
          </div>
          @if (isStudioAdvancedModelSameAsStandard()) {
            <p class="warn">
              Le modèle Studio avancé doit être différent du modèle Studio standard : sans quoi la
              bascule « Modèle avancé » n'apporte rien. Choisissez un autre modèle ou « Aucun ».
            </p>
          }
          @if (isModelMissing(selectedStudioAdvancedModelRef)) {
            <p class="warn">
              Le modèle Studio avancé « {{ selectedStudioAdvancedModelRef }} » n'est pas installé
              sur le moteur IA : l'enregistrement sera refusé. Choisissez un modèle de la liste, ou
              installez-le sur le serveur puis rechargez cette page.
            </p>
          }
        }
      </section>

      <section class="card">
        <h3>Import — modèle effectif</h3>
        <p class="hint">
          Modèle réellement utilisé par l'API (plateforme prioritaire). La vision repose sur le même modèle s'il est multimodal.
        </p>
        <p class="reco-model">
          @if (d.effectiveImportModelRef) {
            {{ d.effectiveImportModelRef }}
            @if (d.effectiveImportVisionCapable) {
              <span class="hint"> — vision activée</span>
            } @else {
              <span class="hint"> — texte seul</span>
            }
          } @else {
            <span class="empty">Configuration serveur (aucun modèle plateforme)</span>
          }
        </p>
      </section>

      @if (d.recommendation; as reco) {
        <section class="card reco">
          <h3><i class="pi pi-star-fill" aria-hidden="true"></i> Modèle recommandé pour ce serveur</h3>
          <strong class="reco-model">{{ reco.displayLabel }}</strong>
          <p class="reco-reason">{{ reco.reason }}</p>
          <ul class="reco-specs">
            <li>RAM totale : {{ formatGb(reco.hardwareProfile.totalRamBytes) }} Go</li>
            <li>RAM disponible : {{ formatGb(reco.hardwareProfile.availableRamBytes) }} Go</li>
            <li>Cœurs CPU : {{ reco.hardwareProfile.cpuCores }}</li>
            @if (reco.hardwareProfile.gpu; as gpu) {
              <li>
                GPU : {{ gpu.name || 'détecté' }}@if (gpu.vramBytes) { · {{ formatGb(gpu.vramBytes) }} Go VRAM }
              </li>
            }
          </ul>
          <p-button
            label="Appliquer le modèle recommandé"
            icon="pi pi-check"
            [outlined]="true"
            severity="secondary"
            [disabled]="selectedModelRef === reco.recommendedModelRef"
            (onClick)="applyRecommendation(reco.recommendedModelRef)" />
        </section>
      }

      <section class="card">
        <h3>OpenRouter (cloud)</h3>
        <p class="hint">
          Clé API partagée pour les modèles cloud de l'assistant, WhatsApp et les imports.
          Laisser la clé vide conserve la valeur déjà enregistrée.
        </p>
        <div class="field field-row">
          <label for="or-enabled">Activer OpenRouter</label>
          <p-toggleswitch inputId="or-enabled" [(ngModel)]="openRouterEnabled" />
        </div>
        <div class="field">
          <label for="or-display">Nom affiché</label>
          <input id="or-display" type="text" pInputText class="w-full" [(ngModel)]="openRouterDisplayName" />
        </div>
        <div class="field">
          <label for="or-base">URL de base (optionnel)</label>
          <input
            id="or-base"
            type="url"
            pInputText
            class="w-full"
            [(ngModel)]="openRouterBaseUrl"
            [placeholder]="openRouterDefaultBaseUrl" />
          <small class="hint">Par défaut : {{ openRouterDefaultBaseUrl }}</small>
        </div>
        <div class="field">
          <label for="or-key">Clé API</label>
          <input
            id="or-key"
            type="password"
            pInputText
            class="w-full"
            autocomplete="off"
            [(ngModel)]="openRouterApiKey"
            [placeholder]="openRouterKeyPlaceholder()" />
          @if (openRouterApiKeyConfigured) {
            <small class="hint">Clé configurée (se termine par …{{ openRouterApiKeyLast4 }})</small>
          }
        </div>
        @if (needsOpenRouterKeyWarning()) {
          <p class="warn">
            Un modèle OpenRouter est sélectionné mais aucune clé API n'est configurée.
            Les appels cloud échoueront jusqu'à saisie de la clé.
          </p>
        }
      </section>

      <section class="card">
        <h3>Cursor (cloud)</h3>
        <p class="hint">
          Clé API Cursor pour l'assistant, WhatsApp, le Studio et les imports. L'inférence est hébergée
          chez Cursor : les prompts (factures, paie, CRM) quittent le serveur. Consultez Privacy Mode
          et le usage dashboard Cursor (tag SDK). Laisser la clé vide conserve la valeur déjà enregistrée.
        </p>
        <div class="field field-row">
          <label for="cursor-enabled">Activer Cursor</label>
          <p-toggleswitch inputId="cursor-enabled" [(ngModel)]="cursorEnabled" />
        </div>
        <div class="field">
          <label for="cursor-display">Nom affiché</label>
          <input id="cursor-display" type="text" pInputText class="w-full" [(ngModel)]="cursorDisplayName" />
        </div>
        <div class="field">
          <label for="cursor-key">Clé API</label>
          <input
            id="cursor-key"
            type="password"
            pInputText
            class="w-full"
            autocomplete="off"
            [(ngModel)]="cursorApiKey"
            [placeholder]="cursorKeyPlaceholder()" />
          @if (cursorApiKeyConfigured) {
            <small class="hint">Clé configurée (se termine par …{{ cursorApiKeyLast4 }})</small>
          }
        </div>
        @if (needsCursorKeyWarning()) {
          <p class="warn">
            Un modèle Cursor est sélectionné mais aucune clé API n'est configurée.
            Les appels Cursor échoueront jusqu'à saisie de la clé (et CursorSdk:Enabled=true côté serveur).
          </p>
        }
        @if (needsCursorCatalogWarning()) {
          <p class="warn">
            Catalogue Cursor vide : exécutez npm ci dans CursorSdkBridge et redémarrez l'API (Node 22.13+).
          </p>
        }
      </section>

      <section class="card">
        <h3>Modal (Kimi 3)</h3>
        <p class="hint">
          Endpoint OpenAI-compatible hébergé sur Modal (modèle moonshotai/Kimi-K3). Le token Bearer est
          TOKEN_ID.TOKEN_SECRET (Proxy Auth). Laisser les champs token vides conserve la valeur déjà enregistrée.
          Ne sélectionnez Kimi comme modèle d'import ou Studio que si vous acceptez le coût et la latence associés.
          Pour un endpoint propre à une entreprise :
          <a routerLink="/tenants">Entreprises</a> → menu ⋯ de la ligne, ou fiche → onglet Configuration IA.
        </p>
        <app-modal-endpoint-fields
          [(enabled)]="modalEnabled"
          [(displayName)]="modalDisplayName"
          [(baseUrl)]="modalBaseUrl"
          [(tokenId)]="modalTokenId"
          [(tokenSecret)]="modalTokenSecret"
          [apiKeyConfigured]="modalApiKeyConfigured"
          [apiKeyLast4]="modalApiKeyLast4"
          [urlPlaceholder]="modalUrlPlaceholder()"
          [warning]="modalWarning()" />
      </section>

      <section class="card">
        <h3>Docstrange (cloud)</h3>
        <p class="hint">
          Service d'extraction documentaire de Nanonets, utilisable pour la lecture des factures et
          des relevés bancaires. Ce n'est pas un modèle de conversation : il n'apparaît pas dans les
          listes de modèles ci-dessus.
        </p>
        <p class="warn">
          Les documents envoyés <strong>quittent le serveur</strong> vers Nanonets, qui ne publie
          aucune politique de rétention pour son offre cloud. Activer cette carte ne suffit pas à
          envoyer des relevés&nbsp;: cela exige en plus le réglage serveur
          <code>BankStatementImport:DocStrangeEnabled</code>, éteint par défaut.
        </p>
        <div class="field field-row">
          <label for="ds-enabled">Activer Docstrange</label>
          <p-toggleswitch inputId="ds-enabled" [(ngModel)]="docStrangeEnabled" />
        </div>
        <div class="field">
          <label for="ds-display">Nom affiché</label>
          <input id="ds-display" type="text" pInputText class="w-full" [(ngModel)]="docStrangeDisplayName" />
        </div>
        <div class="field">
          <label for="ds-base">URL de base (optionnel)</label>
          <input
            id="ds-base"
            type="url"
            pInputText
            class="w-full"
            [(ngModel)]="docStrangeBaseUrl"
            [placeholder]="docStrangeDefaultBaseUrl" />
          <small class="hint">Par défaut : {{ docStrangeDefaultBaseUrl }}</small>
        </div>
        <div class="field">
          <label for="ds-key">Clé API</label>
          <input
            id="ds-key"
            type="password"
            pInputText
            class="w-full"
            autocomplete="off"
            [(ngModel)]="docStrangeApiKey"
            [placeholder]="docStrangeKeyPlaceholder()" />
          @if (docStrangeApiKeyConfigured) {
            <small class="hint">Clé configurée (se termine par …{{ docStrangeApiKeyLast4 }})</small>
          }
          @else {
            <small class="hint">Laisser vide conserve la clé déjà enregistrée.</small>
          }
        </div>
        @if (needsDocStrangeKeyWarning()) {
          <p class="warn">
            Docstrange est activé mais aucune clé API n'est configurée. Les extractions échoueront
            et l'import retombera sur le moteur local.
          </p>
        }
      </section>

      <div class="footer-actions">
        <p-button
          label="Enregistrer"
          icon="pi pi-check"
          severity="primary"
          [disabled]="!canSubmit() || busy()"
          [loading]="busy()"
          (onClick)="submit()" />
      </div>
    }
  `,
  styles: [
    `
      .card {
        background: var(--ft-surface-2, var(--ft-surface));
        border: 1px solid var(--ft-border);
        border-radius: var(--ft-radius);
        padding: 1.1rem;
        margin-top: 1rem;
        max-width: 620px;
      }
      .card h3 {
        font-size: 0.95rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--ft-text-muted);
        margin: 0 0 0.6rem;
      }
      .hint {
        margin: 0 0 0.9rem;
        font-size: 0.85rem;
        color: var(--ft-text-muted);
        line-height: 1.5;
      }
      .empty {
        margin: 0;
        font-size: 0.85rem;
        color: var(--ft-text-muted);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      .field-spaced {
        margin-top: 0.9rem;
      }
      .field label {
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--ft-text-muted);
        font-weight: 600;
      }
      .reco {
        border-color: var(--ft-accent-border, var(--ft-border));
        background: var(--ft-accent-muted, var(--ft-surface-2));
      }
      .reco h3 {
        color: var(--ft-accent, var(--ft-text));
      }
      .reco-model {
        display: block;
        font-size: 0.95rem;
        color: var(--ft-text);
      }
      .reco-reason {
        margin: 0.3rem 0 0.6rem;
        font-size: 0.85rem;
        color: var(--ft-text-muted);
      }
      .reco-specs {
        margin: 0 0 0.9rem;
        padding-left: 1.1rem;
        font-size: 0.85rem;
        color: var(--ft-text);
        line-height: 1.6;
      }
      .device-hint {
        margin-top: 0.65rem;
      }
      .warn {
        margin: 0.65rem 0 0;
        font-size: 0.85rem;
        color: var(--ft-warning);
        line-height: 1.5;
      }
      .footer-actions {
        margin-top: 1.25rem;
        display: flex;
        justify-content: flex-start;
        max-width: 620px;
      }
      :host ::ng-deep .w-full {
        width: 100%;
      }
    `
  ]
})
export class PlatformAiSettingsPageComponent implements OnInit {
  private readonly api = inject(PlatformAiSettingsService);
  private readonly toast = inject(MessageService);

  protected readonly data = signal<PlatformAiSettingsDto | null>(null);
  protected readonly loading = signal<boolean>(false);
  protected readonly busy = signal<boolean>(false);
  protected readonly savedModelRef = signal<string>('');
  protected readonly savedImportModelRef = signal<string>('');
  protected readonly savedStudioModelRef = signal<string>('');
  protected readonly savedStudioAdvancedModelRef = signal<string>('');
  protected readonly savedInferenceDevice = signal<OllamaInferenceDevice>('Gpu');
  protected readonly savedOpenRouterEnabled = signal<boolean>(false);
  protected readonly savedOpenRouterDisplayName = signal<string>('');
  protected readonly savedOpenRouterBaseUrl = signal<string>('');
  protected readonly savedCursorEnabled = signal<boolean>(false);
  protected readonly savedCursorDisplayName = signal<string>('');
  protected readonly savedModalEnabled = signal<boolean>(false);
  protected readonly savedModalDisplayName = signal<string>('');
  protected readonly savedModalBaseUrl = signal<string>('');
  protected readonly savedDocStrangeEnabled = signal<boolean>(false);
  protected readonly savedDocStrangeDisplayName = signal<string>('');
  protected readonly savedDocStrangeBaseUrl = signal<string>('');

  /** Liée par [(ngModel)] au sélecteur. */
  protected selectedModelRef = '';
  protected selectedImportModelRef = '';
  protected selectedStudioModelRef = '';
  protected selectedStudioAdvancedModelRef = '';
  protected selectedInferenceDevice: OllamaInferenceDevice = 'Gpu';

  /** Docstrange (cloud) : extraction documentaire, jamais un modèle sélectionnable. */
  protected docStrangeEnabled = false;
  protected docStrangeDisplayName = '';
  protected docStrangeBaseUrl = '';
  protected docStrangeDefaultBaseUrl = 'https://extraction-api.nanonets.com';
  protected docStrangeApiKey = '';
  protected docStrangeApiKeyConfigured = false;
  protected docStrangeApiKeyLast4: string | null = null;

  /** OpenRouter (cloud) : clé partagée assistant/WhatsApp/imports. */
  protected openRouterEnabled = false;
  protected openRouterDisplayName = '';
  protected openRouterBaseUrl = '';
  protected openRouterDefaultBaseUrl = 'https://openrouter.ai/api/v1';
  protected openRouterApiKey = '';
  protected openRouterApiKeyConfigured = false;
  protected openRouterApiKeyLast4: string | null = null;

  /** Cursor SDK : clé partagée assistant/WhatsApp/imports. */
  protected cursorEnabled = false;
  protected cursorDisplayName = '';
  protected cursorApiKey = '';
  protected cursorApiKeyConfigured = false;
  protected cursorApiKeyLast4: string | null = null;

  /** Modal (Kimi 3) : token proxy partagé. */
  protected modalEnabled = false;
  protected modalDisplayName = '';
  protected modalBaseUrl = '';
  protected modalDefaultBaseUrl = '';
  protected modalTokenId = '';
  protected modalTokenSecret = '';
  protected modalApiKeyConfigured = false;
  protected modalApiKeyLast4: string | null = null;

  protected readonly inferenceDeviceOptions: InferenceDeviceOption[] = [
    {
      label: 'GPU',
      value: 'Gpu',
      description: 'Le moteur IA InstaFact utilise le GPU si disponible (comportement par défaut).'
    },
    {
      label: 'CPU uniquement',
      value: 'CpuOnly',
      description: 'Force num_gpu=0 : le GPU n\'est pas sollicité pour l\'IA.'
    }
  ];

  protected readonly modelOptions = computed<ModelOption[]>(() => {
    const d = this.data();
    const options: ModelOption[] = [{ label: 'Aucun — modèle serveur par défaut', value: '' }];
    if (!d) {
      return options;
    }
    for (const m of d.availableModels) {
      const src = aiProviderLabel(m.providerKey);
      options.push({ label: `${src} · ${m.displayLabel}`, value: m.modelRef });
    }
    // Modèle configuré mais plus installé : on l'affiche pour ne pas masquer la configuration en
    // cours, mais on le rend NON SÉLECTIONNABLE. L'enregistrer conduisait à un échec silencieux au
    // premier import (le serveur le refuse désormais aussi, cf. EnsureModelInstalledAsync).
    const configuredRefs = [
      d.configuredModelRef,
      d.invoiceImportModelRef,
      d.studioAiModelRef,
      d.studioAiAdvancedModelRef
    ];
    for (const configured of configuredRefs) {
      if (configured
        && !d.availableModels.some(m => m.modelRef === configured)
        && !options.some(o => o.value === configured)) {
        options.push({
          label: `${configured} — non installé, à retirer`,
          value: configured,
          disabled: true
        });
      }
    }
    return options;
  });

  /** Vrai si la valeur actuellement sélectionnée désigne un modèle absent du moteur IA. */
  protected isModelMissing(ref: string | null | undefined): boolean {
    const trimmed = ref?.trim();
    if (!trimmed) return false;
    const d = this.data();
    if (!d || d.availableModels.length === 0) return false;
    return !d.availableModels.some(m => m.modelRef === trimmed);
  }

  /** Options import : exclut les modèles embedding-only (nomic-embed-text, bge, etc.). */
  protected readonly importModelOptions = computed<ModelOption[]>(() => {
    const d = this.data();
    return this.modelOptions().filter(o => {
      if (!o.value) return true;
      if (!d) return true;
      const model = d.availableModels.find(m => m.modelRef === o.value);
      return model?.supportsChat !== false;
    });
  });

  protected isImportModelInvalid(): boolean {
    const ref = this.selectedImportModelRef?.trim();
    if (!ref) return false;
    const d = this.data();
    const model = d?.availableModels.find(m => m.modelRef === ref);
    if (model) return model.supportsChat === false;
    return /embed/i.test(ref);
  }

  protected importModelSupportsVision(): boolean {
    const ref = this.selectedImportModelRef?.trim();
    if (!ref) return false;
    const d = this.data();
    const model = d?.availableModels.find(m => m.modelRef === ref);
    // L'API renvoie la capacité déclarée par le moteur : elle fait foi, dans les deux sens.
    if (model) return model.supportsVision === true;
    // Modèle saisi à la main, absent de la liste : repli sur le nom.
    const lower = ref.toLowerCase();
    return /glm-ocr|gemma3|llava|vision|-vl[-:]|qwen-vl|-ocr|ocr-|surya/.test(lower);
  }

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.api.get().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.applyLoadedData(res.data);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Chargement de la configuration IA impossible.'
        });
      }
    });
  }

  private applyLoadedData(d: PlatformAiSettingsDto): void {
    this.data.set(d);
    this.selectedModelRef = d.configuredModelRef ?? '';
    this.savedModelRef.set(this.selectedModelRef);
    this.selectedImportModelRef = d.invoiceImportModelRef ?? '';
    this.savedImportModelRef.set(this.selectedImportModelRef);
    this.selectedStudioModelRef = d.studioAiModelRef ?? '';
    this.savedStudioModelRef.set(this.selectedStudioModelRef);
    this.selectedStudioAdvancedModelRef = d.studioAiAdvancedModelRef ?? '';
    this.savedStudioAdvancedModelRef.set(this.selectedStudioAdvancedModelRef);
    this.selectedInferenceDevice = d.inferenceDevice ?? 'Gpu';
    this.savedInferenceDevice.set(this.selectedInferenceDevice);

    const or = d.openRouter;
    this.openRouterEnabled = or?.isEnabled ?? false;
    this.openRouterDisplayName = or?.displayName ?? '';
    this.openRouterBaseUrl = or?.baseUrl ?? '';
    this.openRouterDefaultBaseUrl = or?.defaultBaseUrl || 'https://openrouter.ai/api/v1';
    this.openRouterApiKeyConfigured = or?.isApiKeyConfigured ?? false;
    this.openRouterApiKeyLast4 = or?.apiKeyLast4 ?? null;
    this.openRouterApiKey = '';
    this.savedOpenRouterEnabled.set(this.openRouterEnabled);
    this.savedOpenRouterDisplayName.set(this.openRouterDisplayName);
    this.savedOpenRouterBaseUrl.set(this.openRouterBaseUrl);

    const ds = d.docStrange;
    this.docStrangeEnabled = ds?.isEnabled ?? false;
    this.docStrangeDisplayName = ds?.displayName ?? '';
    this.docStrangeBaseUrl = ds?.baseUrl ?? '';
    this.docStrangeDefaultBaseUrl = ds?.defaultBaseUrl || 'https://extraction-api.nanonets.com';
    this.docStrangeApiKeyConfigured = ds?.isApiKeyConfigured ?? false;
    this.docStrangeApiKeyLast4 = ds?.apiKeyLast4 ?? null;
    this.docStrangeApiKey = '';
    this.savedDocStrangeEnabled.set(this.docStrangeEnabled);
    this.savedDocStrangeDisplayName.set(this.docStrangeDisplayName);
    this.savedDocStrangeBaseUrl.set(this.docStrangeBaseUrl);

    const cursor = d.cursor;
    this.cursorEnabled = cursor?.isEnabled ?? false;
    this.cursorDisplayName = cursor?.displayName ?? '';
    this.cursorApiKeyConfigured = cursor?.isApiKeyConfigured ?? false;
    this.cursorApiKeyLast4 = cursor?.apiKeyLast4 ?? null;
    this.cursorApiKey = '';
    this.savedCursorEnabled.set(this.cursorEnabled);
    this.savedCursorDisplayName.set(this.cursorDisplayName);

    const modal = d.modal;
    this.modalEnabled = modal?.isEnabled ?? false;
    this.modalDisplayName = modal?.displayName ?? '';
    this.modalBaseUrl = modal?.baseUrl ?? '';
    this.modalDefaultBaseUrl = modal?.defaultBaseUrl || '';
    this.modalApiKeyConfigured = modal?.isApiKeyConfigured ?? false;
    this.modalApiKeyLast4 = modal?.apiKeyLast4 ?? null;
    this.modalTokenId = '';
    this.modalTokenSecret = '';
    this.savedModalEnabled.set(this.modalEnabled);
    this.savedModalDisplayName.set(this.modalDisplayName);
    this.savedModalBaseUrl.set(this.modalBaseUrl);
  }

  protected hasChanges(): boolean {
    return this.selectedModelRef !== this.savedModelRef()
      || this.selectedImportModelRef !== this.savedImportModelRef()
      || this.selectedStudioModelRef !== this.savedStudioModelRef()
      || this.selectedStudioAdvancedModelRef !== this.savedStudioAdvancedModelRef()
      || this.selectedInferenceDevice !== this.savedInferenceDevice()
      || this.openRouterEnabled !== this.savedOpenRouterEnabled()
      || this.openRouterDisplayName !== this.savedOpenRouterDisplayName()
      || this.openRouterBaseUrl !== this.savedOpenRouterBaseUrl()
      || !!this.openRouterApiKey.trim()
      || this.cursorEnabled !== this.savedCursorEnabled()
      || this.cursorDisplayName !== this.savedCursorDisplayName()
      || !!this.cursorApiKey.trim()
      || this.modalEnabled !== this.savedModalEnabled()
      || this.modalDisplayName !== this.savedModalDisplayName()
      || this.modalBaseUrl !== this.savedModalBaseUrl()
      || !!this.modalTokenId.trim()
      || !!this.modalTokenSecret.trim()
      || this.docStrangeEnabled !== this.savedDocStrangeEnabled()
      || this.docStrangeDisplayName !== this.savedDocStrangeDisplayName()
      || this.docStrangeBaseUrl !== this.savedDocStrangeBaseUrl()
      || !!this.docStrangeApiKey.trim();
  }

  protected openRouterKeyPlaceholder(): string {
    return this.openRouterApiKeyConfigured
      ? `••••••••${this.openRouterApiKeyLast4 ?? ''}`
      : 'sk-or-…';
  }

  protected docStrangeKeyPlaceholder(): string {
    return this.docStrangeApiKeyConfigured
      ? `••••••••${this.docStrangeApiKeyLast4 ?? ''}`
      : 'clé Docstrange…';
  }

  /** Activé sans clé : les extractions échoueraient silencieusement. */
  protected needsDocStrangeKeyWarning(): boolean {
    return this.docStrangeEnabled && !this.docStrangeApiKeyConfigured && !this.docStrangeApiKey.trim();
  }

  protected cursorKeyPlaceholder(): string {
    return this.cursorApiKeyConfigured
      ? `••••••••${this.cursorApiKeyLast4 ?? ''}`
      : 'cursor_…';
  }

  protected modalUrlPlaceholder(): string {
    return this.modalDefaultBaseUrl
      || 'https://…--ep-kimi-k3-server.us-west.modal.direct/v1';
  }

  protected needsCursorKeyWarning(): boolean {
    const refs = [
      this.selectedModelRef,
      this.selectedImportModelRef,
      this.selectedStudioModelRef,
      this.selectedStudioAdvancedModelRef
    ];
    const usesCursor = refs.some(r => r.toLowerCase().startsWith('cursor:'));
    const hasKey = this.cursorApiKeyConfigured || !!this.cursorApiKey.trim();
    return usesCursor && (!this.cursorEnabled || !hasKey);
  }

  protected needsCursorModelWarning(): boolean {
    return needsCursorModelWarning({
      cursorEnabled: this.cursorEnabled,
      cursorApiKeyConfigured: this.cursorApiKeyConfigured,
      cursorApiKey: this.cursorApiKey,
      selectedModelRef: this.selectedModelRef
    });
  }

  protected needsCursorCatalogWarning(): boolean {
    const d = this.data();
    if (!d) {
      return false;
    }

    return needsCursorCatalogWarning({
      cursorEnabled: this.cursorEnabled,
      availableModels: d.availableModels
    });
  }

  protected needsOpenRouterKeyWarning(): boolean {
    const refs = [
      this.selectedModelRef,
      this.selectedImportModelRef,
      this.selectedStudioModelRef,
      this.selectedStudioAdvancedModelRef
    ];
    const usesCloud = refs.some(r => r.toLowerCase().startsWith('openrouter:'));
    const hasKey = this.openRouterApiKeyConfigured || !!this.openRouterApiKey.trim();
    return usesCloud && (!this.openRouterEnabled || !hasKey);
  }

  protected modalWarning(): string | null {
    if (!this.needsModalKeyWarning()) {
      return null;
    }
    return "Un modèle Modal est sélectionné mais le token n'est pas configuré. Les appels Kimi échoueront jusqu'à saisie du TOKEN_ID et du TOKEN_SECRET.";
  }

  protected needsModalKeyWarning(): boolean {
    const refs = [
      this.selectedModelRef,
      this.selectedImportModelRef,
      this.selectedStudioModelRef,
      this.selectedStudioAdvancedModelRef
    ];
    const usesModal = refs.some(r => r.toLowerCase().startsWith('modal:'));
    const hasKey = this.modalApiKeyConfigured
      || (!!this.modalTokenId.trim() && !!this.modalTokenSecret.trim());
    return usesModal && (!this.modalEnabled || !hasKey);
  }

  /** Vrai si le modèle Studio avancé sélectionné est identique au modèle Studio standard. */
  protected isStudioAdvancedModelSameAsStandard(): boolean {
    return isStudioAdvancedModelSameAsStandard({
      standardModelRef: this.selectedStudioModelRef,
      advancedModelRef: this.selectedStudioAdvancedModelRef
    });
  }

  /** Vrai si la configuration en cours serait refusée par l'API : on désactive l'enregistrement. */
  protected canSubmit(): boolean {
    return this.hasChanges()
      && !this.isStudioAdvancedModelSameAsStandard()
      && !this.isModelMissing(this.selectedStudioAdvancedModelRef);
  }

  protected inferenceDeviceHint(): string {
    const option = this.inferenceDeviceOptions.find(o => o.value === this.selectedInferenceDevice);
    const base = option?.description ?? '';
    return `${base} Le changement peut provoquer un rechargement du modèle au prochain message.`;
  }

  protected isLargeAssistantModel(): boolean {
    const ref = (this.selectedModelRef || this.data()?.configuredModelRef || '').toLowerCase();
    return /\b(7b|8b|13b|14b|32b|70b)\b/.test(ref);
  }

  protected applyRecommendation(modelRef: string): void {
    this.selectedModelRef = modelRef;
  }

  protected formatGb(bytes: number): string {
    return (bytes / 1024 ** 3).toFixed(1);
  }

  submit(): void {
    this.busy.set(true);
    const modelRef = this.selectedModelRef ? this.selectedModelRef : null;
    const invoiceImportModelRef = this.selectedImportModelRef ? this.selectedImportModelRef : null;
    const studioAiModelRef = this.selectedStudioModelRef ? this.selectedStudioModelRef : null;
    // Chaîne vide (et non null) : l'API interprète null comme « champ non fourni » et ne toucherait
    // pas au réglage — « Aucun » doit pouvoir désactiver la bascule « Modèle avancé ».
    const studioAiAdvancedModelRef = this.selectedStudioAdvancedModelRef?.trim() ?? '';
    const apiKey = this.openRouterApiKey.trim();
    const cursorApiKey = this.cursorApiKey.trim();
    const modalTokenId = this.modalTokenId.trim();
    const modalTokenSecret = this.modalTokenSecret.trim();
    const modalApiKey = modalTokenId && modalTokenSecret
      ? `${modalTokenId}.${modalTokenSecret}`
      : null;
    this.api.update({
      modelRef,
      invoiceImportModelRef,
      studioAiModelRef,
      studioAiAdvancedModelRef,
      inferenceDevice: this.selectedInferenceDevice,
      openRouter: {
        isEnabled: this.openRouterEnabled,
        displayName: this.openRouterDisplayName.trim() || null,
        baseUrl: this.openRouterBaseUrl.trim() || null,
        apiKey: apiKey || null
      },
      cursor: {
        isEnabled: this.cursorEnabled,
        displayName: this.cursorDisplayName.trim() || null,
        apiKey: cursorApiKey || null
      },
      modal: {
        isEnabled: this.modalEnabled,
        displayName: this.modalDisplayName.trim() || null,
        baseUrl: this.modalBaseUrl.trim() || null,
        apiKey: modalApiKey
      },
      docStrange: {
        isEnabled: this.docStrangeEnabled,
        displayName: this.docStrangeDisplayName.trim() || null,
        baseUrl: this.docStrangeBaseUrl.trim() || null,
        apiKey: this.docStrangeApiKey.trim() || null
      }
    }).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.applyLoadedData(res.data);
          this.toast.add({
            severity: 'success',
            summary: 'Configuration IA enregistrée',
            detail: 'Les modèles et credentials cloud (OpenRouter, Modal ou Cursor) sont à jour.'
          });
        } else {
          this.toast.add({ severity: 'error', summary: 'Erreur', detail: res.message ?? '' });
        }
        this.busy.set(false);
      },
      error: (err) => {
        this.busy.set(false);
        const detail = err?.error?.message
          || err?.error?.errors?.[0]
          || 'Enregistrement impossible.';
        this.toast.add({ severity: 'error', summary: 'Erreur', detail });
      }
    });
  }
}
