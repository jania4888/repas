/// <reference types="@angular/localize" />
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';
import { ButtonModule } from 'primeng/button';
import { Subject, takeUntil } from 'rxjs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AuthService } from '@core/services/auth.service';
import { AppModule } from '@core/models/app-module';
import { CompanyModuleDto, CompanyModulesService } from '@core/services/company-modules.service';
import { ModuleRecommendationsService, ModuleRecommendationDto } from '@core/services/module-recommendations.service';
import { MODULE_ICON_BY_ID } from '@core/utils/module-icon.util';
import { TenantUsersService } from '@core/services/tenant-users.service';
import { backendDisplayLabel } from '@shared/pipes/backend-label.pipe';

/**
 * Paramètres > Modules (plan v1 §2.2). Lets a tenant admin activate/deactivate
 * modules after registration; changes apply immediately (no relogin) thanks to
 * {@link AuthService.refreshUserProfile} (Phase 1, tâche 1.3).
 */
@Component({
  selector: 'app-modules-settings',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ToggleSwitchModule,
    TooltipModule,
    ButtonModule,
    PageHeaderComponent,
    BreadcrumbComponent
  ],
  templateUrl: './modules-settings.component.html',
  styleUrl: './modules-settings.component.scss'
})
export class ModulesSettingsComponent implements OnInit, OnDestroy {
  protected loc_activer_labelfr_ed496d(p0: unknown): string {
    return $localize`:@@settings.modules-settings.tpl.activer.labelfr.ed496db0:Activer ${p0}:labelFr:`;
  }

  private readonly modulesService = inject(CompanyModulesService);
  private readonly authService = inject(AuthService);
  private readonly toastService = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly recommendationsService = inject(ModuleRecommendationsService);
  private readonly tenantUsersService = inject(TenantUsersService);
  private readonly destroy$ = new Subject<void>();

  breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@settings.modules-settings.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
    { label: $localize`:@@settings.modules-settings.ts.parametres.ef8f0121:Paramètres`, route: '/settings' },
    { label: $localize`:@@settings.modules-settings.ts.modules.04e9462c:Modules` }
  ];

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly planCode = signal<string | null>(null);
  readonly modules = signal<CompanyModuleDto[]>([]);
  /** Ids the user has toggled on/off locally; not yet persisted until Save. */
  readonly selectedIds = signal<AppModule[]>([]);
  /** Modules just auto-enabled as a hard dependency of the last toggle (mirrors register-wizard's hint). */
  readonly lastAutoEnabled = signal<AppModule[]>([]);
  private autoEnabledHintTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly byId = computed(() => new Map(this.modules().map(m => [m.id, m])));

  readonly companySegmentLabel = computed(() => this.authService.user()?.companySegment ?? null);

  readonly coreModules = computed(() => this.modules().filter(m => m.isCore));
  readonly recommendedModules = computed(() =>
    this.modules().filter(m => !m.isCore && m.recommendedForSector)
  );
  readonly otherModules = computed(() =>
    this.modules().filter(m => !m.isCore && !m.recommendedForSector)
  );

  /** Usage-based recommendations (plan §3.3) — distinct from the sector-based `recommendedForSector` flag. */
  readonly usageRecommendations = signal<ModuleRecommendationDto[]>([]);
  /** Quick lookup: module ids that have a usage recommendation, for badge display on cards. */
  private readonly usageRecommendationIds = computed(() => new Set(this.usageRecommendations().map(r => r.moduleId)));

  readonly isDirty = computed(() => {
    const initial = new Set(this.modules().filter(m => m.isEnabled).map(m => m.id));
    const current = new Set(this.selectedIds());
    if (initial.size !== current.size) return true;
    for (const id of initial) {
      if (!current.has(id)) return true;
    }
    return false;
  });

  ngOnInit(): void {
    this.load();
    this.loadUsageRecommendations();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.autoEnabledHintTimer) {
      clearTimeout(this.autoEnabledHintTimer);
    }
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.modulesService.getModules().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.planCode.set(res.data.planCode);
          this.modules.set(res.data.modules);
          this.selectedIds.set(res.data.modules.filter(m => m.isEnabled).map(m => m.id));
        } else {
          this.loadError.set(res.message || $localize`:@@settings.modules-settings.ts.impossible.de.charger.les.modules.e56b7f1e:Impossible de charger les modules.`);
        }
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loadError.set(this.errorHandler.extractErrorMessage(err));
        this.loading.set(false);
      }
    });
  }

  /** Fetches usage-based recommendations (plan §3.3) — non-blocking, fails silently. */
  loadUsageRecommendations(): void {
    this.recommendationsService.getRecommendations().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.usageRecommendations.set(res.data);
        }
      },
      error: () => {
        /* les recos d'usage sont optionnelles — la page reste fonctionnelle */
      }
    });
  }

  /** True when a module card should show the "Recommandé pour vous" usage badge (plan §3.3). */
  hasUsageRecommendation(id: AppModule): boolean {
    return this.usageRecommendationIds().has(id);
  }

  /** French reason for a usage recommendation on a given module (for tooltip/display). */
  usageRecommendationReason(id: AppModule): string {
    return this.usageRecommendations().find(r => r.moduleId === id)?.reasonFr ?? '';
  }

  /** Nom affiché d'un module : `labelFr` de l'API, traduit hors français (FR inchangé). */
  displayName(module: CompanyModuleDto): string {
    return backendDisplayLabel(module.labelFr);
  }

  /** Nom affiché d'un module à partir de son id (pour l'affichage du bandeau de recos). */
  moduleLabel(id: AppModule): string {
    const module = this.byId().get(id);
    return module ? this.displayName(module) : String(id);
  }

  moduleIcon(id: AppModule): string {
    return MODULE_ICON_BY_ID[id]?.icon ?? 'pi-box';
  }

  moduleTone(id: AppModule): string {
    return MODULE_ICON_BY_ID[id]?.tone ?? 'tone-gray';
  }

  isSelected(id: AppModule): boolean {
    return this.selectedIds().includes(id);
  }

  /** True when another currently-selected module requires `id` — cannot be turned off. */
  dependentsOf(id: AppModule): CompanyModuleDto[] {
    const selected = new Set(this.selectedIds());
    return this.modules().filter(m => m.id !== id && selected.has(m.id) && m.requires.includes(id));
  }

  isLockedByDependency(id: AppModule): boolean {
    return this.dependentsOf(id).length > 0;
  }

  dependencyLockLabel(id: AppModule): string {
    const labels = this.dependentsOf(id).map(m => this.displayName(m)).join(', ');
    return $localize`:@@settings.modules-settings.ts.requis.par.labels.1cfd4a45:Requis par ${labels}:labels:`;
  }

  wasAutoEnabled(id: AppModule): boolean {
    return this.lastAutoEnabled().includes(id);
  }

  isLockedByPlan(module: CompanyModuleDto): boolean {
    return !module.allowedByPlan;
  }

  /**
   * Un module verrouillé l'est pour deux raisons très différentes, qui ne se disent pas de la même
   * façon. Réservé aux offres payantes ⇒ « Plan supérieur requis », c'est un argumentaire de vente
   * légitime. Verrouillé sans être premium ⇒ anomalie de configuration du plan : proposer une
   * montée en gamme serait mensonger puisque le module fait déjà partie de l'offre.
   */
  isPremiumLock(module: CompanyModuleDto): boolean {
    return this.isLockedByPlan(module) && module.isPaidPlanOnly === true;
  }

  planLockLabel(module: CompanyModuleDto): string {
    return this.isPremiumLock(module) ? $localize`:@@ui.tern.plan.superieur.requis.d9c212:Plan supérieur requis` : $localize`:@@ui.tern.temporairement.indisponible.ca38b2:Temporairement indisponible`;
  }

  toggleModule(module: CompanyModuleDto): void {
    if (module.isCore || this.isLockedByPlan(module)) {
      return;
    }

    const current = this.selectedIds();
    const isEnabling = !current.includes(module.id);

    if (!isEnabling) {
      if (this.isLockedByDependency(module.id)) {
        return;
      }
      this.selectedIds.set(current.filter(id => id !== module.id));
      this.setAutoEnabledHint([]);
      return;
    }

    // Dependency hint (plan §2.2 "dependency hint auto-enabling requirements"): auto-enable
    // the transitive closure of `requires`, skipping anything already selected or plan-locked.
    const closure = this.closeRequirements(module.id, current);
    const next = Array.from(new Set([...current, module.id, ...closure]));
    this.selectedIds.set(next);
    this.setAutoEnabledHint(closure);
  }

  private closeRequirements(id: AppModule, alreadySelected: readonly AppModule[]): AppModule[] {
    const map = this.byId();
    const result: AppModule[] = [];
    const visited = new Set<AppModule>([id, ...alreadySelected]);
    const queue: AppModule[] = [...(map.get(id)?.requires ?? [])];

    while (queue.length > 0) {
      const next = queue.shift() as AppModule;
      if (visited.has(next)) continue;
      visited.add(next);
      result.push(next);
      const dep = map.get(next);
      if (dep) queue.push(...dep.requires);
    }

    return result;
  }

  private setAutoEnabledHint(ids: AppModule[]): void {
    if (this.autoEnabledHintTimer) {
      clearTimeout(this.autoEnabledHintTimer);
      this.autoEnabledHintTimer = null;
    }
    this.lastAutoEnabled.set(ids);
    if (ids.length > 0) {
      this.autoEnabledHintTimer = setTimeout(() => this.lastAutoEnabled.set([]), 6000);
    }
  }

  resetChanges(): void {
    this.selectedIds.set(this.modules().filter(m => m.isEnabled).map(m => m.id));
    this.setAutoEnabledHint([]);
  }

  save(): void {
    if (!this.isDirty() || this.saving()) return;

    this.saving.set(true);
    this.modulesService.updateModules(this.selectedIds()).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.saving.set(false);
        if (!res.success || !res.data) {
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@modules-settings.component.summary.Échec de la :Échec de la mise à jour`,
            detail: res.message || $localize`:@@settings.modules-settings.ts.impossible.de.mettre.a.jour.les.modules.dc20d027:Impossible de mettre à jour les modules.`
          });
          return;
        }

        // Sidebar/nav must reflect the change immediately — no logout/login (plan 1.3/2.2).
        this.authService.refreshUserProfile().pipe(takeUntil(this.destroy$)).subscribe();

        // Le catalogue « Ajouter un utilisateur » est filtré par le périmètre de la société : son
        // cache par rôle devient obsolète dès cet enregistrement.
        this.tenantUsersService.clearCatalogCache();

        const warnings = res.data.warnings?.filter(w => !!w?.trim()) ?? [];
        if (warnings.length > 0) {
          this.toastService.add({
            severity: 'warn',
            summary: $localize`:@@modules-settings.component.summary.Modules_mis_jo:Modules mis à jour avec avertissements`,
            detail: warnings.join(' '),
            life: 8000
          });
        } else {
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@modules-settings.component.summary.Modules mis :Modules mis à jour`,
            detail: $localize`:@@modules-settings.component.detail.Votre_navigation:Votre navigation a été actualisée.`
          });
        }

        this.load();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@modules-settings.component.summary.Échec de la :Échec de la mise à jour`,
          detail: this.errorHandler.extractErrorMessage(err),
          life: 8000
        });
      }
    });
  }
}
