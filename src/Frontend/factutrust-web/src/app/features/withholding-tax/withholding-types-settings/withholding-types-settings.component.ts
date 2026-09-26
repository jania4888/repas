import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { WithholdingTaxService, WithholdingTaxTypeDto } from '@core/services/withholding-tax.service';

@Component({
  selector: 'app-withholding-types-settings',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="page-container">
      <div class="page-header">
        <div>
          <h1 i18n="@@withholding-tax.withholding-types-settings.types.de.retenue.a.la.source.0fd2fb62">Types de retenue à la source</h1>
          <p class="subtitle" i18n="@@withholding-tax.withholding-types-settings.catalogue.des.codes.d.operation.conformes.aux.ar.3137d8c5">Catalogue des codes d'opération conformes aux articles 52 et 53 du Code IRPP/IS</p>
        </div>
        <a routerLink="/withholding-tax/dashboard" class="btn btn-outline">
          <i class="fa-solid fa-arrow-left"></i> Tableau de bord
        </a>
      </div>

      @if (loading) {
        <div class="loading-state"><i class="fa-solid fa-spinner fa-spin"></i> Chargement…</div>
      }

      @if (!loading) {
        <!-- Summary -->
        <div class="summary-bar">
          <span>{{ types.length }} type(s) configuré(s)</span>
          <div class="filter-group">
            <button class="chip" [class.active]="filter === ''" (click)="filter = ''" i18n="@@withholding-tax.withholding-types-settings.tous.b97ae3b4">Tous</button>
            @for (cat of categories; track cat) {
              <button class="chip" [class.active]="filter === cat" (click)="filter = cat">{{ cat }}</button>
            }
          </div>
        </div>

        <div class="table-card">
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th i18n="@@withholding-tax.withholding-types-settings.code.adac6937">Code</th>
                  <th i18n="@@withholding-tax.withholding-types-settings.libelle.f5485bba">Libellé</th>
                  <th i18n="@@withholding-tax.withholding-types-settings.categorie.6b38300a">Catégorie</th>
                  <th class="right" i18n="@@withholding-tax.withholding-types-settings.taux.bb9a8c5a">Taux (%)</th>
                  <th class="center" i18n="@@withholding-tax.withholding-types-settings.residents.d48bc77b">Résidents</th>
                  <th class="center" i18n="@@withholding-tax.withholding-types-settings.non.residents.5d688ea2">Non-résidents</th>
                  <th class="center" i18n="@@withholding-tax.withholding-types-settings.actif.2eb75f84">Actif</th>
                </tr>
              </thead>
              <tbody>
                @for (type of filteredTypes; track type.id) {
                  <tr>
                    <td><code>{{ type.code }}</code></td>
                    <td>{{ type.label }}</td>
                    <td><span class="category-badge">{{ type.categoryLabel }}</span></td>
                    <td class="right">{{ type.defaultRate | number:'1.2-2' }}</td>
                    <td class="center">
                      @if (type.applicableToResident) {
                        <i class="fa-solid fa-check check-icon"></i>
                      } @else {
                        <span class="dash" i18n="@@withholding-tax.withholding-types-settings.text.1b93795b">—</span>
                      }
                    </td>
                    <td class="center">
                      @if (type.applicableToNonResident) {
                        <i class="fa-solid fa-check check-icon"></i>
                      } @else {
                        <span class="dash" i18n="@@withholding-tax.withholding-types-settings.text.1b93795b">—</span>
                      }
                    </td>
                    <td class="center">
                      @if (type.isActive) {
                        <span class="active-dot"></span>
                      } @else {
                        <span class="inactive-dot"></span>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7" class="empty-state" i18n="@@withholding-tax.withholding-types-settings.aucun.type.de.retenue.trouve.pour.ce.filtre.efc8bc97">Aucun type de retenue trouvé pour ce filtre.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>

        <!-- Info card -->
        <div class="info-card">
          <h3><i class="fa-solid fa-info-circle"></i> Référentiel fiscal</h3>
          <p i18n="@@withholding-tax.withholding-types-settings.les.codes.d.operation.sont.definis.par.l.adminis.3dec3bd1">Les codes d'opération sont définis par l'administration fiscale tunisienne et correspondent aux
            catégories prévues par les articles 52 et 53 du Code de l'IRPP et de l'IS.
            Les taux affichés sont les taux par défaut ; un taux réduit ou une exonération peut s'appliquer
            en vertu d'une convention de non-double imposition (CNPC).</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .page-container { padding: 1.5rem; max-width: 1100px; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem; }
    .page-header h1 { font-size: 1.5rem; font-weight: 600; margin: 0; }
    .subtitle { color: var(--text-secondary); margin: 0.25rem 0 0; font-size: 0.875rem; }
    .loading-state { padding: 3rem; text-align: center; color: var(--text-secondary); }
    .summary-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.75rem; font-size: 0.875rem; color: var(--text-secondary); }
    .filter-group { display: flex; gap: 0.375rem; flex-wrap: wrap; }
    .chip { padding: 0.25rem 0.75rem; border: 1px solid var(--border); border-radius: 999px; font-size: 0.75rem; cursor: pointer; background: transparent; color: var(--text-secondary); transition: all 0.15s; }
    .chip.active { background: var(--primary); color: white; border-color: var(--primary); }
    .table-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin-bottom: 1.5rem; }
    .table-wrapper { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th, td { padding: 0.625rem 0.75rem; border-bottom: 1px solid var(--border); text-align: left; }
    th { font-weight: 500; color: var(--text-secondary); font-size: 0.8125rem; background: var(--bg-secondary); }
    .right { text-align: right; font-variant-numeric: tabular-nums; }
    .center { text-align: center; }
    code { font-size: 0.8125rem; background: var(--bg-secondary); padding: 0.125rem 0.375rem; border-radius: 3px; }
    .category-badge { display: inline-block; padding: 0.125rem 0.5rem; background: #e0e7ff; color: #3730a3; border-radius: 999px; font-size: 0.75rem; font-weight: 500; }
    .check-icon { color: #16a34a; font-size: 0.875rem; }
    .dash { color: var(--text-secondary); }
    .active-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #16a34a; }
    .inactive-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #d1d5db; }
    .empty-state { text-align: center; color: var(--text-secondary); padding: 2rem; }
    .info-card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem; }
    .info-card h3 { font-size: 0.875rem; font-weight: 600; margin: 0 0 0.5rem; display: flex; align-items: center; gap: 0.5rem; }
    .info-card p { font-size: 0.8125rem; color: var(--text-secondary); margin: 0; line-height: 1.6; }
    .btn { padding: 0.5rem 1rem; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; font-size: 0.875rem; display: inline-flex; align-items: center; gap: 0.5rem; text-decoration: none; background: transparent; }
    .btn-outline { background: transparent; }
  `]
})
export class WithholdingTypesSettingsComponent implements OnInit {
  private service = inject(WithholdingTaxService);

  types: WithholdingTaxTypeDto[] = [];
  loading = true;
  filter = '';

  get categories(): string[] {
    const cats = new Set(this.types.map(t => t.categoryLabel).filter(Boolean));
    return [...cats];
  }

  get filteredTypes(): WithholdingTaxTypeDto[] {
    if (!this.filter) return this.types;
    return this.types.filter(t => t.categoryLabel === this.filter);
  }

  ngOnInit() {
    this.service.getTypes(false).subscribe({
      next: types => { this.types = types; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }
}
