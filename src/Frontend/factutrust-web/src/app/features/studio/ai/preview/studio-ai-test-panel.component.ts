import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { DynamicFormComponent } from '@shared/studio-runtime/dynamic-form.component';
import { DynamicReportComponent } from '@shared/studio-runtime/dynamic-report.component';
import { CustomField, FormLayout, ReportResult } from '@shared/studio-runtime/studio-runtime.models';
import { STUDIO_AI_LABELS } from '../studio-ai-labels';
import { StudioAiPlanPreviewDto, StudioSpecEntity, StudioSpecReport, StudioSystemSpec } from '../studio-ai.models';
import { specEntityToCustomFields, specFormToLayout } from '../studio-ai-spec.util';
import { sampleFromSeed } from './studio-ai-test-report.util';

/**
 * Panneau « Tester » de l'aperçu (M5, 3.4f1) : le formulaire d'une table de la spec, rendu par le
 * `DynamicFormComponent` réel mais en simulation pure — **aucun appel HTTP, rien n'est enregistré**.
 *
 * Tout est calculé localement : champs et mise en page viennent de la spec (`specEntityToCustomFields`
 * / `specFormToLayout`) ; les options des champs relation sont dérivées des données de référence de la
 * spec par `specFieldToCustomField`, complétées le cas échéant par l'échantillon serveur
 * (`preview.entities[].seedSample`) quand l'aperçu a pu être chargé. Quand `GET {id}/preview` répond
 * 404, le panneau reste pleinement fonctionnel depuis la spec seule (Q1 b) et l'indique.
 *
 * « Enregistrer » (bouton du formulaire dynamique) se contente d'afficher `simulation.saved` en ligne
 * ; les erreurs de validation sont celles du `DynamicFormComponent` (maquette « erreurs »).
 *
 * Carte « Rapport » (M6, 3.4f2) : quand la table choisie déclare un `report`, le résultat est
 * l'échantillon serveur (`summary.sample`, P5) s'il est fourni, sinon l'agrégation locale
 * `sampleFromSeed` sur les données de départ ; le bouton « Exporter » du `DynamicReportComponent`
 * partagé (jamais modifié) est masqué par le conteneur `.sai-test-report--noexport` (D21).
 */
@Component({
  selector: 'app-studio-ai-test-panel',
  standalone: true,
  imports: [FormsModule, MessageModule, SelectModule, DynamicFormComponent, DynamicReportComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './studio-ai-preview.scss',
  template: `
    <div class="sai-test" data-component-id="sai-test-panel">
      <p-message severity="warn" styleClass="sai-test__banner" [text]="labels.banner" />
      @if (previewUnavailable()) {
        <p-message severity="info" styleClass="sai-test__banner" [text]="previewUnavailableLabel" />
      }

      <div class="sai-test__bar">
        <label class="sai-test__label" for="sai-test-entity">{{ labels.entity }}</label>
        <p-select
          inputId="sai-test-entity"
          [options]="entityOptions()"
          [ngModel]="selectedEntity()?.ref ?? null"
          (ngModelChange)="onEntityChange($event)"
          optionLabel="label"
          optionValue="value"
          [ariaLabel]="labels.entity"
          appendTo="body"
          panelStyleClass="studio-theme"
          styleClass="sai-test__select"
          data-component-id="sai-test-entity" />
      </div>

      @if (selectedEntity(); as entity) {
        <div class="sai-test__form">
          <app-dynamic-form
            [fields]="fields()"
            [layout]="layout()"
            [entityKey]="entity.ref"
            (save)="simulateSave()"
            (formCancel)="resetSimulation()" />
        </div>
        @if (saved()) {
          <p-message severity="success" styleClass="sai-test__saved" data-component-id="sai-test-saved" [text]="labels.saved" />
        }
      }

      <div class="sai-test__report" data-component-id="sai-test-report">
        @if (report(); as report) {
          <h3 class="sai-test__report-title">
            <i class="fa-solid fa-chart-column" aria-hidden="true"></i>
            {{ report.displayName || selectedEntity()?.displayName }}
          </h3>
        }
        @if (reportResult(); as result) {
          <p class="sai-hint sai-test__report-source" data-component-id="sai-test-report-source">{{ reportSourceLabel() }}</p>
          <!-- D21 : export masqué en simulation — le composant partagé n'est pas modifié. -->
          <div class="sai-test-report--noexport" [attr.aria-disabled]="true">
            <app-dynamic-report [result]="result" exportName="simulation" />
          </div>
          <p class="sai-hint sai-test__export-hint">{{ labels.exportUnavailable }}</p>
        } @else {
          <p class="sai-hint">{{ labels.reportUnavailable }}</p>
        }
      </div>
    </div>
  `
})
export class StudioAiTestPanelComponent {
  /** Spec canonique de la proposition — source unique du formulaire simulé (0 réseau). */
  readonly spec = input.required<StudioSystemSpec>();
  /** Aperçu serveur (`GET {id}/preview`) ; son `seedSample` complète les relations sans seed local. */
  readonly preview = input<StudioAiPlanPreviewDto | null>(null);
  /** Vrai quand l'aperçu serveur est indisponible (404) : mode dégradé local, toujours utilisable. */
  readonly previewUnavailable = input(false);
  /**
   * Échantillon de rapport calculé par le serveur (`summary.sample`, P5 — présent pour un plan
   * d'état) : préféré à l'agrégation locale sur les données de départ quand il est fourni.
   */
  readonly sample = input<ReportResult | null>(null);

  readonly labels = STUDIO_AI_LABELS.simulation;
  readonly previewUnavailableLabel = STUDIO_AI_LABELS.modes.previewUnavailable;

  /** Table choisie dans le sélecteur ; `null` ⇒ première table de la spec. */
  readonly selectedRef = signal<string | null>(null);
  /** Message « enregistrement simulé » affiché après un `(save)` valide du formulaire. */
  readonly saved = signal(false);
  /** Incrémenté par « Annuler » pour reconstruire un formulaire vierge (nouvelles références). */
  private readonly formEpoch = signal(0);

  readonly entityOptions = computed(() =>
    (this.spec().entities ?? []).map(entity => ({ value: entity.ref, label: entity.displayName }))
  );

  readonly selectedEntity = computed<StudioSpecEntity | null>(() => {
    const entities = this.spec().entities ?? [];
    const ref = this.selectedRef();
    return entities.find(entity => entity.ref === ref) ?? entities[0] ?? null;
  });

  /**
   * Spec enrichie de l'échantillon serveur : pour une table sans données de référence locales,
   * `preview.entities[].seedSample` (déjà borné par le serveur) alimente les options de relation.
   */
  private readonly specWithServerSeed = computed<StudioSystemSpec>(() => {
    const spec = this.spec();
    const preview = this.preview();
    if (!preview?.entities?.length) return spec;
    const seed = [...(spec.seed ?? [])];
    let added = false;
    for (const entity of preview.entities) {
      const hasLocalSeed = seed.some(s => s.entityRef === entity.ref && (s.records?.length ?? 0) > 0);
      if (!hasLocalSeed && entity.seedSample?.length) {
        seed.push({ entityRef: entity.ref, records: entity.seedSample.map(record => ({ ...record })) });
        added = true;
      }
    }
    return added ? { ...spec, seed } : spec;
  });

  readonly fields = computed<CustomField[]>(() => {
    this.formEpoch();
    const entity = this.selectedEntity();
    return entity ? specEntityToCustomFields(entity, this.specWithServerSeed()) : [];
  });

  readonly layout = computed<FormLayout | null>(() => {
    this.formEpoch();
    const entity = this.selectedEntity();
    return entity ? specFormToLayout(entity) : null;
  });

  /** Rapport déclaré sur la table choisie (`entity.report` — un rapport par table). */
  readonly report = computed<StudioSpecReport | null>(() => this.selectedEntity()?.report ?? null);

  /**
   * Résultat affiché (P5) : échantillon serveur si fourni, sinon agrégation locale
   * `sampleFromSeed` sur les données de départ (locales, complétées du `seedSample` serveur).
   */
  readonly reportResult = computed<ReportResult | null>(() => {
    const report = this.report();
    const entity = this.selectedEntity();
    if (!report || !entity) return null;
    const server = this.sample();
    if (server) return server;
    const seed = (this.specWithServerSeed().seed ?? []).find(s => s.entityRef === entity.ref)?.records ?? [];
    return sampleFromSeed(report, entity, seed);
  });

  /** Provenance de l'échantillon affiché : serveur, ou calcul local sur les données de départ. */
  readonly reportSourceLabel = computed<string>(() =>
    this.sample() ? this.labels.sampleFromServer : this.labels.sampleFromSeed
  );

  onEntityChange(ref: string): void {
    this.selectedRef.set(ref);
    this.saved.set(false);
  }

  /** `(save)` du formulaire dynamique (données valides) : simulation pure, aucun appel HTTP. */
  simulateSave(): void {
    this.saved.set(true);
  }

  /** « Annuler » du formulaire : efface le message et reconstruit un formulaire vierge. */
  resetSimulation(): void {
    this.saved.set(false);
    this.formEpoch.update(value => value + 1);
  }
}
