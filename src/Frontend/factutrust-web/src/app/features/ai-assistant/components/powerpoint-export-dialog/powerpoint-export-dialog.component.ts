import {
  Component,
  EventEmitter,
  Input,
  Output,
  OnInit,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
  computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { firstValueFrom } from 'rxjs';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  PowerPointExportRequest,
  PowerPointResponseSelection,
  PowerPointResponsePreview,
  PowerPointTemplate,
  PowerPointTemplateInfo,
  SlideContentBlock,
  SlideOrientation,
  MessageRole,
  powerPointTemplateToApi,
  toPowerPointTemplate
} from '../../models/ai-chat.models';
import {
  PowerPointExportError,
  PowerPointExportResult,
  PowerPointExportService
} from '../../services/powerpoint-export.service';
import { AiChatSessionService } from '../../services/ai-chat-session.service';
import { MessageSelectionService, SelectedAssistantMessage } from '../../services/message-selection.service';

import { PowerPointThemePickerComponent } from '../powerpoint-theme-picker/powerpoint-theme-picker.component';

type DialogStep = 'configure' | 'theme' | 'review' | 'generating' | 'done';

interface ResponseLine {
  conversationId: string;
  messageId: string;
  conversationTitle: string;
  preview: string;
  createdAt: string;
  customTitle: string;
  includeText: boolean;
  includeKpis: boolean;
  includeTables: boolean;
  includeCharts: boolean;
  includeSources: boolean;
  previewMeta?: PowerPointResponsePreview;
  previewLoading?: boolean;
}

/**
 * Multi-step dialog for generating a PowerPoint deck from selected assistant responses.
 *
 * Steps:
 *  1. **Configurer** — Title, subtitle, author, slide options, orientation.
 *  2. **Thème** — Galerie visuelle 36 thèmes (previews 16:9 type Dokie/Gamma).
 *  3. **Réponses** — Ordered list of selected messages with optional per-response custom title and
 *     content-block filters (text / KPI / tables / charts / sources).
 *  4. **Générer** — Loading spinner, then success state with inline download + history reminder.
 *
 * The dialog is fully self-contained and only depends on the two new services
 * (`PowerPointExportService`, `MessageSelectionService`) plus our shared `ButtonComponent`.
 */
@Component({
  selector: 'app-powerpoint-export-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogModule, ButtonComponent, PowerPointThemePickerComponent],
  template: `
    <p-dialog
      header="Exporter en PowerPoint" i18n-header="@@ai-assistant.components.exporter.en.powerpoint.1032c468"
      [(visible)]="visibleInternal"
      [modal]="true"
      [style]="{ width: '900px', maxWidth: '96vw' }"
      [draggable]="false"
      [resizable]="false"
      [closable]="!isGenerating()"
      (onHide)="onHide()"
      ariaLabel="Exporter en PowerPoint" i18n-ariaLabel="@@ai-assistant.components.exporter.en.powerpoint.ac2ac00f">

      <nav class="ppt-stepper" aria-label="Étapes de l'export" i18n-aria-label="@@ai-assistant.components.etapes.de.l.export.5cbdb578">
        @for (s of stepDefs; track s.id) {
          <button
            type="button"
            class="ppt-step"
            [class.active]="currentStep() === s.id"
            [class.completed]="isStepCompleted(s.id)"
            [disabled]="!canJumpTo(s.id)"
            (click)="jumpTo(s.id)"
            [attr.aria-current]="currentStep() === s.id ? 'step' : null">
            <span class="ppt-step-index" aria-hidden="true">{{ s.index }}</span>
            <span class="ppt-step-label">{{ s.label }}</span>
          </button>
        }
      </nav>

      <div class="ppt-dialog-body" [attr.aria-busy]="isGenerating() ? 'true' : null">
        @switch (currentStep()) {

          @case ('configure') {
            <div class="ppt-grid">
              <div class="ppt-card">
                <h4 i18n="@@ai-assistant.components.informations.generales.be6ba6e5">Informations générales</h4>
                <label class="ppt-field">
                  <span><ng-container i18n="@@ai-assistant.components.titre.de.la.presentation.c3df8df5">Titre de la présentation </ng-container> <em i18n="@@ai-assistant.components.text.df58248c">*</em></span>
                  <input
                    type="text"
                    name="title"
                    [(ngModel)]="title"
                    maxlength="200"
                    required
                    aria-required="true"
                    placeholder="Synthèse hebdomadaire — Ventes Q4" i18n-placeholder="@@ai-assistant.components.synthese.hebdomadaire.ventes.q4.4c4c43b5" />
                </label>
                <label class="ppt-field">
                  <span i18n="@@ai-assistant.components.sous.titre.optionnel.9e0b8fa9">Sous-titre (optionnel)</span>
                  <input type="text" name="subtitle" [(ngModel)]="subtitle" maxlength="250" />
                </label>
                <label class="ppt-field">
                  <span i18n="@@ai-assistant.components.auteur.affiche.sur.la.couverture.d6eaf75f">Auteur affiché sur la couverture</span>
                  <input type="text" name="author" [(ngModel)]="authorName" maxlength="200" />
                </label>
              </div>

              <div class="ppt-card">
                <div class="ppt-card-header-row">
                  <h4 i18n="@@ai-assistant.components.slides.a.inclure.71d6b043">Slides à inclure</h4>
                  <button type="button" class="ppt-preset-link" (click)="applyExecutivePreset()" i18n="@@ai-assistant.components.preset.deck.executif.c2d0a8dd"> Preset « Deck exécutif » </button>
                </div>
                <div class="ppt-options-grid">
                  <label class="ppt-check">
                    <input type="checkbox" name="cover" [(ngModel)]="includeCoverSlide" />
                    <span i18n="@@ai-assistant.components.slide.de.couverture.1ff99904">Slide de couverture</span>
                  </label>
                  <label class="ppt-check">
                    <input type="checkbox" name="agenda" [(ngModel)]="includeAgenda" />
                    <span i18n="@@ai-assistant.components.agenda.891e9d6d">Agenda</span>
                  </label>
                  <label class="ppt-check">
                    <input type="checkbox" name="toc" [(ngModel)]="includeTableOfContents" />
                    <span i18n="@@ai-assistant.components.sommaire.numerote.0c75bebc">Sommaire numéroté</span>
                  </label>
                  <label class="ppt-check">
                    <input type="checkbox" name="notes" [(ngModel)]="includeSpeakerNotes" />
                    <span i18n="@@ai-assistant.components.notes.du.presentateur.1e2e486d">Notes du présentateur</span>
                  </label>
                  <label class="ppt-check">
                    <input type="checkbox" name="sources" [(ngModel)]="includeSources" />
                    <span i18n="@@ai-assistant.components.page.sources.6e642190">Page « Sources »</span>
                  </label>
                  <label class="ppt-check">
                    <input type="checkbox" name="appendix" [(ngModel)]="includeAppendix" />
                    <span i18n="@@ai-assistant.components.annexe.texte.brut.05b5a314">Annexe (texte brut)</span>
                  </label>
                </div>
              </div>

              <div class="ppt-card">
                <h4 i18n="@@ai-assistant.components.format.041a5dec">Format</h4>
                <label class="ppt-field">
                  <span i18n="@@ai-assistant.components.orientation.des.slides.108d44bf">Orientation des slides</span>
                  <select name="orientation" [(ngModel)]="orientation">
                    <option [ngValue]="SlideOrientation.Widescreen16x9" i18n="@@ai-assistant.components.16.9.recommande.dd88e126">16:9 (recommandé)</option>
                    <option [ngValue]="SlideOrientation.Standard4x3">4:3</option>
                  </select>
                </label>
              </div>
            </div>
          }

          @case ('theme') {
            <div class="ppt-card ppt-card-theme-step">
              <header class="ppt-theme-step-header">
                <h4 i18n="@@ai-assistant.components.choisissez.un.theme.visuel.917e8b7d">Choisissez un thème visuel</h4>
                <p class="ppt-muted" i18n="@@ai-assistant.components.apercu.fidele.des.slides.de.couverture.recherche.7c9f793e">Aperçu fidèle des slides de couverture — recherche et filtres disponibles.</p>
              </header>
              @if (loadingTemplates()) {
                <p class="ppt-muted" i18n="@@ai-assistant.components.chargement.des.themes.1310aeb5">Chargement des thèmes…</p>
              } @else if (templates().length === 0) {
                <p class="ppt-muted" i18n="@@ai-assistant.components.aucun.theme.disponible.d7f7ca4d">Aucun thème disponible.</p>
              } @else {
                <app-powerpoint-theme-picker
                  [templates]="templates()"
                  [(selected)]="template" />
              }
            </div>
          }

          @case ('review') {
            <div class="ppt-card ppt-review">
              <header class="ppt-review-header">
                <h4 i18n="@@ai-assistant.components.reponses.selectionnees.2ae928a8">Réponses sélectionnées ({{ responseLines().length }})</h4>
                <small class="ppt-muted" i18n="@@ai-assistant.components.personnalisez.le.titre.filtrez.les.blocs.ou.reti.2c6a8200"> Personnalisez le titre, filtrez les blocs ou retirez une réponse avant l'export. </small>
              </header>

              @if (responseLines().length === 0) {
                <p class="ppt-empty" i18n="@@ai-assistant.components.aucune.reponse.selectionnee.activez.le.mode.sele.2ab2d239"> Aucune réponse sélectionnée. Activez le mode sélection dans la barre de l'assistant
                  pour cocher les réponses à inclure. </p>
              } @else {
                <ul class="ppt-response-list" role="list">
                  @for (line of responseLines(); track line.messageId; let i = $index) {
                    <li class="ppt-response-row">
                      <div class="ppt-response-index" aria-hidden="true">{{ i + 1 }}</div>
                      <div class="ppt-response-body">
                        <div class="ppt-response-title">{{ line.conversationTitle || 'Conversation' }}</div>
                        <p class="ppt-response-preview">{{ line.preview }}</p>
                        <label class="ppt-field ppt-field-inline">
                          <span i18n="@@ai-assistant.components.titre.personnalise.du.slide.74470fbe">Titre personnalisé du slide</span>
                          <input
                            type="text"
                            [(ngModel)]="line.customTitle"
                            maxlength="200"
                            [name]="'cust-' + line.messageId"
                            placeholder="Hériter du titre auto-détecté" i18n-placeholder="@@ai-assistant.components.heriter.du.titre.auto.detecte.2ee69f9a" />
                        </label>
                        <div class="ppt-block-filters" role="group" [attr.aria-label]="loc_ui_tern_filtrer_le_contenu_pour_la_reponse_7da43f + (i + 1)">
                          <label class="ppt-mini-check"><input type="checkbox" [(ngModel)]="line.includeText" [name]="'txt-' + line.messageId" /><ng-container i18n="@@ai-assistant.components.texte.ff9afef1"> Texte</ng-container></label>
                          <label class="ppt-mini-check"><input type="checkbox" [(ngModel)]="line.includeKpis" [name]="'kpi-' + line.messageId" /> KPI</label>
                          <label class="ppt-mini-check"><input type="checkbox" [(ngModel)]="line.includeTables" [name]="'tbl-' + line.messageId" /><ng-container i18n="@@ai-assistant.components.tableaux.c0501eb6"> Tableaux</ng-container></label>
                          <label class="ppt-mini-check"><input type="checkbox" [(ngModel)]="line.includeCharts" [name]="'cht-' + line.messageId" /><ng-container i18n="@@ai-assistant.components.graphiques.a5050c7d"> Graphiques</ng-container></label>
                          <label class="ppt-mini-check"><input type="checkbox" [(ngModel)]="line.includeSources" [name]="'src-' + line.messageId" /><ng-container i18n="@@ai-assistant.components.sources.2eb56be3"> Sources</ng-container></label>
                        </div>
                        @if (line.previewMeta) {
                          <div class="ppt-preview-badges" [attr.aria-describedby]="'preview-desc-' + line.messageId">
                            @if (line.previewMeta.kpiCount) {
                              <span class="ppt-badge">{{ line.previewMeta.kpiCount }} KPI</span>
                            }
                            @if (line.previewMeta.tableCount) {
                              <span class="ppt-badge" i18n="@@ai-assistant.components.tableau.x.994346ac">{{ line.previewMeta.tableCount }} tableau(x)</span>
                            }
                            @if (line.previewMeta.chartCount) {
                              <span class="ppt-badge" i18n="@@ai-assistant.components.graphique.s.12fab29d">{{ line.previewMeta.chartCount }} graphique(s)</span>
                            }
                            @if (line.previewMeta.sectionCount) {
                              <span class="ppt-badge" i18n="@@ai-assistant.components.section.s.6377fc71">{{ line.previewMeta.sectionCount }} section(s)</span>
                            }
                          </div>
                          @if (line.previewMeta.slideOutline.length) {
                            <ol class="ppt-slide-outline" [id]="'preview-desc-' + line.messageId">
                              @for (item of line.previewMeta.slideOutline; track $index) {
                                <li>{{ item }}</li>
                              }
                            </ol>
                          }
                        } @else if (line.previewLoading) {
                          <p class="ppt-muted ppt-preview-loading" i18n="@@ai-assistant.components.analyse.du.contenu.3b98a85a">Analyse du contenu…</p>
                        }
                      </div>
                      <div class="ppt-response-actions">
                        <button type="button" class="ppt-icon" (click)="moveUp(i)" [disabled]="i === 0" aria-label="Monter" i18n-aria-label="@@ai-assistant.components.monter.dd1b79d9" i18n="@@ai-assistant.components.text.9555ffd7"> ↑ </button>
                        <button type="button" class="ppt-icon" (click)="moveDown(i)" [disabled]="i === responseLines().length - 1" aria-label="Descendre" i18n-aria-label="@@ai-assistant.components.descendre.383f2e3e" i18n="@@ai-assistant.components.text.fc486696"> ↓ </button>
                        <button type="button" class="ppt-icon ppt-icon-danger" (click)="removeLine(i)" aria-label="Retirer cette réponse" i18n-aria-label="@@ai-assistant.components.retirer.cette.reponse.daf692c8" i18n="@@ai-assistant.components.text.67fba2f3"> × </button>
                      </div>
                    </li>
                  }
                </ul>
              }
            </div>
          }

          @case ('generating') {
            <div class="ppt-loading" role="status" aria-live="polite">
              <div class="ppt-spinner" aria-hidden="true"></div>
              <p class="ppt-loading-title" i18n="@@ai-assistant.components.generation.de.la.presentation.a17c3590">Génération de la présentation…</p>
              <p class="ppt-muted" i18n="@@ai-assistant.components.pour.une.presentation.contenant.reponse.2be441ec">
                Pour une présentation contenant {{ responseLines().length }} réponse(s), comptez quelques secondes.
              </p>
            </div>
          }

          @case ('done') {
            <div class="ppt-done" role="status" aria-live="polite">
              @if (lastError()) {
                <div class="ppt-error">
                  <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
                  <div>
                    <strong i18n="@@ai-assistant.components.l.export.a.echoue.d3506fe9">L'export a échoué.</strong>
                    <p>{{ lastError()!.message }}</p>
                    @if (lastError()!.details?.length) {
                      <ul>
                        @for (d of lastError()!.details!; track d) {
                          <li>{{ d }}</li>
                        }
                      </ul>
                    }
                  </div>
                </div>
              } @else if (lastResult()) {
                <div class="ppt-success">
                  <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
                  <div>
                    <strong>{{ lastResult()!.fileName }}</strong>
                    <p i18n="@@ai-assistant.components.slide.s.generee.s.le.lien.de.telechargem.76da2a07">{{ lastResult()!.slideCount }} slide(s) générée(s). Le lien de téléchargement expire après une heure.</p>
                  </div>
                </div>
              }
            </div>
          }
        }
      </div>

      <ng-template pTemplate="footer">
        <div class="ppt-footer">
          @if (currentStep() === 'configure') {
            <app-button variant="secondary" (click)="onHide()" i18n="@@ai-assistant.components.annuler.49ba3292">Annuler</app-button>
            <app-button [disabled]="!isConfigValid()" (click)="goToTheme()" i18n="@@ai-assistant.components.suivant.theme.9ac5d3ea">Suivant : thème</app-button>
          }
          @if (currentStep() === 'theme') {
            <app-button variant="secondary" (click)="setStep('configure')" i18n="@@ai-assistant.components.retour.e5befb1f">Retour</app-button>
            <app-button (click)="goToReview()" i18n="@@ai-assistant.components.suivant.reponses.b32fbbe1">Suivant : réponses</app-button>
          }
          @if (currentStep() === 'review') {
            <app-button variant="secondary" (click)="setStep('theme')" i18n="@@ai-assistant.components.retour.e5befb1f">Retour</app-button>
            <app-button
              [disabled]="!isReviewValid()"
              (click)="startGeneration()" i18n="@@ai-assistant.components.generer.la.presentation.69409076"> Générer la présentation </app-button>
          }
          @if (currentStep() === 'generating') {
            <app-button variant="secondary" [disabled]="true" i18n="@@ai-assistant.components.generation.en.cours.46fb6bcf">Génération en cours…</app-button>
          }
          @if (currentStep() === 'done') {
            <app-button variant="secondary" (click)="onHide()" i18n="@@ai-assistant.components.fermer.5ab4ec64">Fermer</app-button>
            @if (lastResult()) {
              <app-button (click)="downloadAgain()" i18n="@@ai-assistant.components.telecharger.a.nouveau.3f2fef3c">Télécharger à nouveau</app-button>
            }
            @if (lastError()) {
              <app-button (click)="retryAfterError()" i18n="@@ai-assistant.components.reessayer.895d416b">Réessayer</app-button>
            }
          }
        </div>
      </ng-template>

    </p-dialog>
  `,
  styleUrls: ['./powerpoint-export-dialog.component.scss']
})
export class PowerPointExportDialogComponent implements OnInit, OnChanges {
  readonly loc_ui_tern_filtrer_le_contenu_pour_la_reponse_7da43f = $localize`:@@ui.tern.filtrer.le.contenu.pour.la.reponse.7da43f:Filtrer le contenu pour la réponse `;
  private static readonly LAST_THEME_KEY = 'factutrust.ppt.lastTheme';

  @Input() visible = false;
  @Input() initialSelection: SelectedAssistantMessage[] = [];

  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() exported = new EventEmitter<PowerPointExportResult>();

  private readonly exportService = inject(PowerPointExportService);
  private readonly selectionService = inject(MessageSelectionService);
  private readonly session = inject(AiChatSessionService);

  protected readonly SlideOrientation = SlideOrientation;
  protected readonly PowerPointTemplate = PowerPointTemplate;

  protected readonly stepDefs: ReadonlyArray<{ id: DialogStep; index: number; label: string }> = [
    { id: 'configure', index: 1, label: 'Configurer' },
    { id: 'theme', index: 2, label: 'Thème' },
    { id: 'review', index: 3, label: 'Réponses' },
    { id: 'generating', index: 4, label: 'Générer' },
    { id: 'done', index: 5, label: 'Terminer' }
  ];

  protected readonly currentStep = signal<DialogStep>('configure');

  protected visibleInternal = false;

  protected title = '';
  protected subtitle = '';
  protected authorName = '';
  protected includeCoverSlide = true;
  protected includeAgenda = true;
  protected includeTableOfContents = false;
  protected includeSpeakerNotes = true;
  protected includeSources = true;
  protected includeAppendix = false;
  protected template: PowerPointTemplate = PowerPointTemplate.Standard;
  protected orientation: SlideOrientation = SlideOrientation.Widescreen16x9;

  protected readonly templates = signal<PowerPointTemplateInfo[]>([]);
  protected readonly loadingTemplates = signal(false);

  protected readonly responseLines = signal<ResponseLine[]>([]);

  protected readonly isGenerating = computed(() => this.currentStep() === 'generating');
  protected readonly lastResult = signal<InlineOrEnvelope | null>(null);
  protected readonly lastError = signal<PowerPointExportError | null>(null);

  ngOnInit(): void {
    this.visibleInternal = this.visible;
    if (this.visible) this.bootstrap();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']) {
      const next = !!changes['visible'].currentValue;
      this.visibleInternal = next;
      if (next) this.bootstrap();
    }
  }

  private bootstrap(): void {
    this.lastResult.set(null);
    this.lastError.set(null);
    this.currentStep.set('configure');
    this.title = this.title || this.buildDefaultTitle();
    this.template = this.restoreLastTheme();
    this.responseLines.set(this.buildLines(this.initialSelection));
    if (this.templates().length === 0 && !this.loadingTemplates()) {
      this.loadTemplates();
    }
  }

  private restoreLastTheme(): PowerPointTemplate {
    try {
      const raw = localStorage.getItem(PowerPointExportDialogComponent.LAST_THEME_KEY);
      if (raw === null) return PowerPointTemplate.Standard;
      return toPowerPointTemplate(raw);
    } catch {
      // localStorage may be unavailable in private mode
    }
    return PowerPointTemplate.Standard;
  }

  private persistLastTheme(): void {
    try {
      localStorage.setItem(
        PowerPointExportDialogComponent.LAST_THEME_KEY,
        powerPointTemplateToApi(this.template)
      );
    } catch {
      // ignore storage failures
    }
  }

  private loadTemplates(): void {
    this.loadingTemplates.set(true);
    this.exportService.listTemplates().subscribe({
      next: list => {
        this.templates.set(list);
        this.loadingTemplates.set(false);
      },
      error: () => {
        this.templates.set([]);
        this.loadingTemplates.set(false);
      }
    });
  }

  private buildDefaultTitle(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `Synthèse Assistant IA — ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  }

  private buildLines(input: SelectedAssistantMessage[]): ResponseLine[] {
    return input.map(s => ({
      conversationId: s.conversationId,
      messageId: s.messageId,
      conversationTitle: s.conversationTitle,
      preview: s.preview,
      createdAt: s.createdAt,
      customTitle: '',
      includeText: true,
      includeKpis: true,
      includeTables: true,
      includeCharts: true,
      includeSources: true
    }));
  }

  protected isStepCompleted(step: DialogStep): boolean {
    const order = this.stepDefs.findIndex(s => s.id === step);
    const current = this.stepDefs.findIndex(s => s.id === this.currentStep());
    return order < current;
  }

  protected canJumpTo(step: DialogStep): boolean {
    if (this.isGenerating()) return false;
    if (step === 'generating') return false;
    if (step === 'configure') return true;
    if (step === 'theme') return this.isConfigValid();
    if (step === 'review') return this.isConfigValid();
    if (step === 'done') return !!this.lastResult() || !!this.lastError();
    return false;
  }

  protected jumpTo(step: DialogStep): void {
    if (!this.canJumpTo(step)) return;
    this.currentStep.set(step);
  }

  protected setStep(step: DialogStep): void {
    this.currentStep.set(step);
  }

  protected isConfigValid(): boolean {
    return this.title.trim().length > 0 && this.title.length <= 200;
  }

  protected isReviewValid(): boolean {
    if (this.responseLines().length === 0) return false;
    return this.responseLines().every(line => this.lineHasContentBlock(line));
  }

  private lineHasContentBlock(line: ResponseLine): boolean {
    return line.includeText || line.includeKpis || line.includeTables || line.includeCharts || line.includeSources;
  }

  protected goToTheme(): void {
    if (this.isConfigValid()) {
      this.currentStep.set('theme');
    }
  }

  protected goToReview(): void {
    if (this.isConfigValid()) {
      this.persistLastTheme();
      this.loadPreviews();
      this.currentStep.set('review');
    }
  }

  private loadPreviews(): void {
    this.responseLines.update(lines =>
      lines.map(line => ({ ...line, previewLoading: true, previewMeta: undefined }))
    );

    for (const line of this.responseLines()) {
      this.exportService
        .previewResponse(line.conversationId, line.messageId, line.customTitle.trim() || undefined)
        .subscribe({
          next: meta => {
            this.responseLines.update(lines =>
              lines.map(l =>
                l.messageId === line.messageId
                  ? { ...l, previewMeta: meta, previewLoading: false }
                  : l
              )
            );
          },
          error: () => {
            this.responseLines.update(lines =>
              lines.map(l =>
                l.messageId === line.messageId ? { ...l, previewLoading: false } : l
              )
            );
          }
        });
    }
  }

  protected applyExecutivePreset(): void {
    this.template = PowerPointTemplate.Executive;
    this.includeCoverSlide = true;
    this.includeAgenda = true;
    this.includeTableOfContents = true;
    this.includeSpeakerNotes = true;
    this.includeSources = true;
    this.includeAppendix = false;
  }

  protected moveUp(idx: number): void {
    if (idx <= 0) return;
    const next = [...this.responseLines()];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    this.responseLines.set(next);
  }

  protected moveDown(idx: number): void {
    const next = [...this.responseLines()];
    if (idx >= next.length - 1) return;
    [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
    this.responseLines.set(next);
  }

  protected removeLine(idx: number): void {
    const next = [...this.responseLines()];
    next.splice(idx, 1);
    this.responseLines.set(next);
  }

  protected async startGeneration(): Promise<void> {
    if (!this.isReviewValid()) return;
    this.currentStep.set('generating');
    this.lastError.set(null);
    this.lastResult.set(null);

    const request: PowerPointExportRequest = {
      title: this.title.trim(),
      subtitle: this.subtitle.trim() || undefined,
      authorName: this.authorName.trim() || undefined,
      template: this.template,
      orientation: this.orientation,
      includeCoverSlide: this.includeCoverSlide,
      includeAgenda: this.includeAgenda,
      includeTableOfContents: this.includeTableOfContents,
      includeSpeakerNotes: this.includeSpeakerNotes,
      includeSources: this.includeSources,
      includeAppendix: this.includeAppendix,
      locale: navigator.language?.startsWith('fr') ? 'fr-TN' : navigator.language || 'fr-TN',
      responses: this.responseLines().map(line => this.toSelection(line))
    };

    try {
      const result = await firstValueFrom(this.exportService.generate(request));
      const inline = await this.resolveInlineAsync(result);
      this.lastResult.set(inline);
      this.exported.emit(result);
      this.exportService.saveBlobToDisk(inline.blob, inline.fileName);
      this.currentStep.set('done');
      this.selectionService.clear();
    } catch (e) {
      this.lastError.set(this.normalizeError(e));
      this.currentStep.set('done');
    }
  }

  protected async retryAfterError(): Promise<void> {
    await this.session.reconcileActiveConversation();
    this.refreshResponseLineIds();
    this.lastError.set(null);
    this.setStep('review');
  }

  private refreshResponseLineIds(): void {
    const conversationId = this.session.activeConversationId();
    const sessionMessages = this.session.messages();
    this.responseLines.update(lines =>
      lines.map(line => {
        const byId = sessionMessages.find(message => message.id === line.messageId);
        if (byId) {
          return {
            ...line,
            conversationId: conversationId ?? line.conversationId
          };
        }

        const byPreview = sessionMessages.find(
          message =>
            message.role === MessageRole.Assistant &&
            !!line.preview &&
            message.content.replace(/\s+/g, ' ').trim().startsWith(line.preview.slice(0, 80))
        );
        if (!byPreview) {
          return line;
        }

        return {
          ...line,
          messageId: byPreview.id,
          conversationId: conversationId ?? line.conversationId
        };
      })
    );
  }

  private async resolveInlineAsync(result: PowerPointExportResult): Promise<InlineOrEnvelope> {
    if (result.kind === 'inline') {
      return {
        blob: result.blob,
        fileName: result.fileName,
        slideCount: result.slideCount,
        downloadUrl: result.downloadUrl
      };
    }
    const blob = await firstValueFrom(this.exportService.download(result.envelope.downloadUrl));
    return {
      blob,
      fileName: result.envelope.fileName,
      slideCount: result.envelope.slideCount,
      downloadUrl: result.envelope.downloadUrl
    };
  }

  protected async downloadAgain(): Promise<void> {
    const current = this.lastResult();
    if (!current) return;
    try {
      if (current.blob.size > 0) {
        this.exportService.saveBlobToDisk(current.blob, current.fileName);
        return;
      }
      const blob = await firstValueFrom(this.exportService.download(current.downloadUrl));
      this.exportService.saveBlobToDisk(blob, current.fileName);
    } catch (e) {
      this.lastError.set(this.normalizeError(e));
    }
  }

  private toSelection(line: ResponseLine): PowerPointResponseSelection {
    let mask = SlideContentBlock.None;
    if (line.includeText) mask |= SlideContentBlock.Text;
    if (line.includeKpis) mask |= SlideContentBlock.KpiCards;
    if (line.includeTables) mask |= SlideContentBlock.Tables;
    if (line.includeCharts) mask |= SlideContentBlock.Charts;
    if (line.includeSources) mask |= SlideContentBlock.Sources;
    return {
      conversationId: line.conversationId,
      messageId: line.messageId,
      customTitle: line.customTitle.trim() || undefined,
      includeOnly: mask === SlideContentBlock.None ? SlideContentBlock.None : mask === SlideContentBlock.All ? undefined : mask
    };
  }

  private normalizeError(e: unknown): PowerPointExportError {
    if (e && typeof e === 'object' && 'status' in e && 'message' in e) {
      return e as PowerPointExportError;
    }
    if (e instanceof Error) return { status: 0, message: e.message };
    return { status: 0, message: 'Erreur inattendue.' };
  }

  protected onHide(): void {
    this.visibleInternal = false;
    this.visibleChange.emit(false);
  }
}

interface InlineOrEnvelope {
  blob: Blob;
  fileName: string;
  slideCount: number;
  downloadUrl: string;
}
