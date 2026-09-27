import { Component, inject, OnInit, OnDestroy, signal, Input, Output, EventEmitter, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { PosOfflineService } from '../../services/pos-offline.service';
import { PosAudioService } from '../../services/pos-audio.service';
import { PosThemeService, PosThemeId } from '../../services/pos-theme.service';
import { PosStateService } from '../../services/pos-state.service';
import { PosVoiceCommandService } from '../../services/pos-voice-command.service';
import { PosIdleService } from '../../services/pos-idle.service';
import { WarehouseContextService } from '@core/services/warehouse-context.service';
import { PosRegisterSessionService } from '../../services/pos-register-session.service';

@Component({
  selector: 'app-pos-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="pos-header">
      <div class="pos-header__left">
        <button class="pos-header__back" (click)="goBack()" title="Retour au tableau de bord" i18n-title="Retour au tableau de bord" aria-label="Retour" i18n-aria-label="Retour">
          <i class="pi pi-arrow-left"></i>
        </button>
        <div class="pos-header__brand">
          <div class="pos-header__logo">
            <i class="pi pi-shopping-cart"></i>
          </div>
          <h1 class="pos-header__title" i18n="@@pos.components.point.de.vente.420a8974">Point de Vente</h1>
        </div>
          <button class="pos-header__pill pos-header__pill--overflow" type="button" (click)="onOpenHistory.emit()" title="Historique des transactions" i18n-title="Historique des transactions" aria-label="Historique" i18n-aria-label="Historique">
          <i class="pi pi-folder-open"></i>
          <span i18n="@@pos.components.historiques.feb0e8f3">Historiques</span>
        </button>
      </div>

      

      <div class="pos-header__center">
        <div class="pos-header__center-group">
          @if (warehouseContext.resolvedWarehouse(); as wh) {
            <div
              class="pos-header__warehouse"
              role="status"
              [attr.title]="loc_ui_tern_entrepot_a7c1cf + wh.name"
              [attr.aria-label]="loc_ui_tern_entrepot_actif_75675f + wh.name">
              <i class="pi pi-building" aria-hidden="true"></i>
              <span class="pos-header__warehouse-name">{{ wh.name }}</span>
            </div>
          }
          @if (registerSession.currentRegister(); as cr) {
            <div class="pos-header__warehouse pos-header__warehouse--register" [attr.title]="loc_ui_tern_caisse_4214e6 + cr.code">
              <i class="pi pi-inbox" aria-hidden="true"></i>
              <span class="pos-header__warehouse-name">{{ cr.code }}</span>
            </div>
          }
          @if (registerSession.requireOpenSession()) {
            <button
              type="button"
              class="pos-header__pill"
              [class.pos-header__pill--session-open]="registerSession.currentSession()"
              [class.pos-header__pill--session-closed]="!registerSession.currentSession()"
              (click)="registerSession.currentSession() ? onXReport.emit() : onOpenRegister.emit()"
              [title]="registerSession.currentSession() ? loc_ui_tern_caisse_ouverte_72457d : loc_ui_tern_ouvrir_la_caisse_7e98a3"
              [attr.aria-label]="registerSession.currentSession() ? loc_ui_tern_caisse_ouverte_72457d : loc_ui_tern_ouvrir_la_caisse_7e98a3">
              <i class="pi" [class.pi-lock-open]="registerSession.currentSession()" [class.pi-lock]="!registerSession.currentSession()"></i>
              <span>{{ registerSession.currentSession() ? loc_ui_tern_caisse_ouverte_72457d : loc_ui_tern_caisse_fermee_8f0e89 }}</span>
            </button>
          }
          @if (registerSession.currentSession()) {
            <button type="button" class="pos-header__pill pos-header__pill--overflow" (click)="onXReport.emit()" title="Rapport X" i18n-title="Rapport X" aria-label="Rapport X" i18n-aria-label="Rapport X">
              <i class="pi pi-eye"></i>
              <span i18n="@@pos.components.x.c032adc1">X</span>
            </button>
            <button type="button" class="pos-header__pill pos-header__pill--z" (click)="onCloseZ.emit()" title="Clôturer Z" i18n-title="Clôturer Z" aria-label="Clôturer Z" i18n-aria-label="Clôturer Z">
              <i class="pi pi-book"></i>
              <span i18n="@@pos.components.cloturer.z.9bcddf02">Clôturer Z</span>
            </button>
          }
          @if (!registerSession.currentSession() && registerSession.requireOpenSession()) {
            <button type="button" class="pos-header__pill pos-header__pill--active" (click)="onOpenRegister.emit()" title="Ouvrir la caisse" i18n-title="Ouvrir la caisse" aria-label="Ouvrir la caisse" i18n-aria-label="Ouvrir la caisse">
              <i class="pi pi-unlock"></i>
              <span i18n="@@pos.components.ouvrir.42c07747">Ouvrir</span>
            </button>
          }
        </div>
      </div>

      <div class="pos-header__right">
        @if (!offlineService.isOnline()) {
          <span class="pos-header__offline" title="Hors ligne" i18n-title="Hors ligne">
            <i class="pi pi-wifi-off"></i>
            <span i18n="@@pos.components.hors.ligne.2b3e7dce">Hors ligne</span>
          </span>
        }
        @if (heldCount > 0) {
          <button class="pos-header__pill pos-header__pill--held" type="button" (click)="onOpenHeld.emit()" [title]="loc_ui_tern_en_attente_5baac0 + heldCount + ')'" [attr.aria-label]="loc_ui_tern_en_attente_b9cac2 + heldCount + loc_ui_tern_commandes_4f2b74">
            <i class="pi pi-pause"></i>
            <span>En attente ({{ heldCount }})</span>
          </button>
        }
       
        <button
          class="pos-header__pill pos-header__pill--overflow"
          [class.pos-header__pill--active]="audioService.isSoundEnabled()"
          type="button"
          (click)="audioService.toggleSound()"
          [title]="audioService.isSoundEnabled() ? loc_ui_tern_desactiver_le_son_76b567 : loc_ui_tern_activer_le_son_4fec90"
          [attr.aria-label]="audioService.isSoundEnabled() ? loc_ui_tern_desactiver_le_son_76b567 : loc_ui_tern_activer_le_son_4fec90">
          <i class="pi" [class.pi-volume-up]="audioService.isSoundEnabled()" [class.pi-volume-off]="!audioService.isSoundEnabled()"></i>
          <span i18n="@@pos.components.son.cdff1da1">Son</span>
        </button>
        <button
          class="pos-header__pill pos-header__pill--compact-label"
          [class.pos-header__pill--active]="isDualScreenOpen"
          type="button"
          (click)="onDualScreenToggle.emit()"
          title="Ecran client" i18n-title="Ecran client"
          aria-label="Ecran client" i18n-aria-label="Ecran client">
          <i class="pi pi-desktop"></i>
          <span i18n="@@pos.components.ecran.client.1a2e7c98">Ecran client</span>
        </button>
        <button
          class="pos-header__pill pos-header__pill--compact-label"
          [class.pos-header__pill--active]="isQuickMode"
          type="button"
          (click)="onQuickModeToggle.emit()"
          title="Mode rapide (F4)" i18n-title="Mode rapide (F4)"
          aria-label="Mode rapide" i18n-aria-label="Mode rapide">
          <i class="pi pi-bolt"></i>
          <span i18n="@@pos.components.mode.rapide.1c78b5f0">Mode rapide</span>
        </button>

        <div class="pos-header__theme pos-header__pill--overflow" (click)="$event.stopPropagation()">
          <button type="button" class="pos-header__pill" title="Theme" i18n-title="Theme" aria-label="Changer le theme" i18n-aria-label="Changer le theme" (click)="toggleThemeMenu($event)">
            <i class="pi pi-palette"></i>
            <span i18n="@@pos.components.theme.a797e309">Theme</span>
          </button>
          @if (showThemeMenu) {
            <div class="pos-header__theme-menu" (click)="$event.stopPropagation()">
              @for (t of themeOptions; track t.id) {
                <button type="button" class="pos-header__theme-option" [class.pos-header__theme-option--active]="themeService.currentTheme() === t.id" (click)="setTheme(t.id); showThemeMenu = false">
                  {{ t.label }}
                </button>
              }
            </div>
          }
        </div>
        <button class="pos-header__pill pos-header__pill--overflow" type="button" (click)="openShortcuts()" title="Raccourcis clavier" i18n-title="Raccourcis clavier" aria-label="Shortcuts" i18n-aria-label="Shortcuts">
          <i class="pi pi-th-large"></i>
          <span i18n="@@pos.components.raccourcis.0e0d6404">Raccourcis</span>
        </button>

        <div class="pos-header__clock" aria-live="off" [attr.title]="currentTime()">
          <i class="pi pi-clock" aria-hidden="true"></i>
          <span>{{ currentTime() }}</span>
        </div>

        <div class="pos-header__plus-wrap" (click)="$event.stopPropagation()">
          <button
            type="button"
            class="pos-header__pill pos-header__plus-trigger"
            (click)="togglePlusMenu($event)"
            title="Plus d'actions" i18n-title="Plus d'actions"
            aria-label="Plus d'actions" i18n-aria-label="Plus d'actions"
            [attr.aria-expanded]="showPlusMenu">
            <i class="pi pi-ellipsis-h"></i>
          </button>
          @if (showPlusMenu) {
            <div class="pos-header__plus-menu" (click)="$event.stopPropagation()">
              <button type="button" class="pos-header__plus-item" (click)="onOpenHistory.emit(); closeMenus()">
                <i class="pi pi-folder-open"></i>
                <span i18n="@@pos.components.historiques.feb0e8f3">Historiques</span>
              </button>
              @if (registerSession.currentSession()) {
                <button type="button" class="pos-header__plus-item" (click)="onXReport.emit(); closeMenus()">
                  <i class="pi pi-eye"></i>
                  <span i18n="@@pos.components.rapport.x.5a5924ab">Rapport X</span>
                </button>
              }
              <button
                type="button"
                class="pos-header__plus-item"
                (click)="audioService.toggleSound(); closeMenus()">
                <i class="pi" [class.pi-volume-up]="audioService.isSoundEnabled()" [class.pi-volume-off]="!audioService.isSoundEnabled()"></i>
                <span>{{ audioService.isSoundEnabled() ? loc_ui_tern_desactiver_le_son_76b567 : loc_ui_tern_activer_le_son_4fec90 }}</span>
              </button>
              <div class="pos-header__plus-divider"></div>
              @for (t of themeOptions; track t.id) {
                <button
                  type="button"
                  class="pos-header__plus-item"
                  [class.pos-header__plus-item--active]="themeService.currentTheme() === t.id"
                  (click)="setTheme(t.id); closeMenus()">
                  <i class="pi pi-palette"></i>
                  <span>Theme : {{ t.label }}</span>
                </button>
              }
              <div class="pos-header__plus-divider"></div>
              <button type="button" class="pos-header__plus-item" (click)="openShortcuts(); closeMenus()">
                <i class="pi pi-th-large"></i>
                <span i18n="@@pos.components.raccourcis.clavier.8a7de23a">Raccourcis clavier</span>
              </button>
            </div>
          }
        </div>

        <button class="pos-header__new-order" (click)="onNewOrder.emit()" title="Nouvelle commande (F9)" i18n-title="Nouvelle commande (F9)">
          <i class="pi pi-plus"></i>
          <span i18n="@@pos.components.nouveau.b9676c8f">Nouveau</span>
        </button>
      </div>

      @if (showShortcuts) {
        <div class="pos-header__shortcuts-panel" (click)="showShortcuts = false">
          <div class="pos-header__shortcuts-content" (click)="$event.stopPropagation()">
            <div class="pos-header__shortcuts-header">
              <h3 i18n="@@pos.components.raccourcis.clavier.8a7de23a">Raccourcis clavier</h3>
              <p class="pos-header__shortcuts-desc" i18n="@@pos.components.accelerez.votre.saisie.avec.ces.raccourcis.d1431e65">Accelerez votre saisie avec ces raccourcis</p>
              <button class="pos-header__shortcuts-close" (click)="showShortcuts = false" aria-label="Fermer" i18n-aria-label="Fermer">
                <i class="pi pi-times"></i>
              </button>
            </div>
            <div class="shortcut-grid">
              <div class="shortcut-item">
                <kbd i18n="@@pos.components.f2.999d0cd6">F2</kbd>
                <span i18n="@@pos.components.rechercher.un.produit.3ce811dc">Rechercher un produit</span>
              </div>
              <div class="shortcut-separator"></div>
              <div class="shortcut-item">
                <kbd i18n="@@pos.components.f5.b5cbd343">F5</kbd>
                <span i18n="@@pos.components.valider.imprimer.925055ea">Valider & Imprimer</span>
              </div>
              <div class="shortcut-separator"></div>
              <div class="shortcut-item">
                <kbd i18n="@@pos.components.f9.cfd1e0d8">F9</kbd>
                <span i18n="@@pos.components.nouvelle.commande.061f365b">Nouvelle commande</span>
              </div>
              <div class="shortcut-separator"></div>
              <div class="shortcut-item">
                <kbd i18n="@@pos.components.echap.17c19948">Echap</kbd>
                <span i18n="@@pos.components.annuler.fermer.ad7cd766">Annuler / Fermer</span>
              </div>
              <div class="shortcut-separator"></div>
              <div class="shortcut-item">
                <kbd i18n="@@pos.components.f6.d2b73763">F6</kbd>
                <span i18n="@@pos.components.lire.le.total.accessibilite.29aaa0d2">Lire le total (accessibilite)</span>
              </div>
            </div>
          </div>
        </div>
      }
    </header>
  `,
  styles: [`
    .pos-header {
      --pos-header-height: 64px;
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      height: var(--pos-header-height);
      padding: 0 var(--spacing-5);
      background: linear-gradient(135deg, #1a5c4c 0%, #0f4c3d 50%, #0d3d32 100%);
      position: relative;
      z-index: var(--z-sticky);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      overflow: visible;
    }

    .pos-header__left {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      min-width: 0;
      flex: 1 1 0;
      overflow: hidden;
    }

    .pos-header__back {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: var(--radius-lg);
      background: rgba(255, 255, 255, 0.15);
      color: var(--color-white);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .pos-header__back:hover {
      background: rgba(255, 255, 255, 0.25);
    }

    .pos-header__brand {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
    }

    .pos-header__logo {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: var(--radius-lg);
      background: rgba(255, 255, 255, 0.2);
      color: var(--color-white);
      font-size: 1.15rem;
      transition: transform 300ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .pos-header__logo:hover {
      transform: scale(1.05);
    }

    .pos-header__title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-bold);
      color: var(--color-white);
      line-height: 1.2;
      margin: 0;
      letter-spacing: -0.02em;
      white-space: nowrap;
    }

    @media (max-width: 1280px) {
      .pos-header__title {
        display: none;
      }
    }

    .pos-header__center {
      min-width: 0;
      flex: 1 1 0;
      overflow: hidden;
      display: flex;
      justify-content: center;
    }

    .pos-header__center-group {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      flex-wrap: nowrap;
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
    }

    .pos-header__center-group .pos-header__pill--z,
    .pos-header__center-group > .pos-header__pill:not(.pos-header__pill--overflow) {
      flex-shrink: 0;
    }

    .pos-header__warehouse {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: 6px 14px;
      min-width: 0;
      max-width: 140px;
      flex-shrink: 1;
      background: linear-gradient(135deg, #1e3a5f 0%, #0f2744 100%);
      border: 1px solid rgba(96, 165, 250, 0.35);
      border-radius: var(--radius-full);
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.1) inset;
      color: var(--color-white);
      font-size: var(--font-size-sm);
    }

    .pos-header__warehouse-name {
      font-weight: var(--font-weight-semibold);
      letter-spacing: 0.02em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }

    .pos-header__warehouse--register {
      max-width: 110px;
    }

    .pos-header__warehouse i {
      font-size: 0.9rem;
      color: inherit;
      flex-shrink: 0;
    }

    .pos-header__clock {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: 6px 16px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: var(--radius-full);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
      color: var(--color-white);
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
    }

    .pos-header__clock i {
      font-size: 0.85rem;
      color: inherit;
      flex-shrink: 0;
    }

    .pos-header__right {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      flex: 0 0 auto;
      flex-wrap: nowrap;
    }

    .pos-header__pill--overflow {
      display: flex;
    }

    .pos-header__plus-wrap {
      position: relative;
      display: none;
      flex-shrink: 0;
    }

    .pos-header__plus-trigger {
      min-width: 36px;
      justify-content: center;
      padding: var(--spacing-2) var(--spacing-3);
    }

    .pos-header__plus-menu {
      position: absolute;
      top: calc(100% + var(--spacing-2));
      right: 0;
      min-width: 220px;
      background: var(--color-white);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-2xl);
      padding: var(--spacing-2);
      z-index: 120;
      border: 1px solid var(--color-border-subtle);
    }

    .pos-header__plus-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      width: 100%;
      padding: var(--spacing-2) var(--spacing-3);
      border: none;
      border-radius: var(--radius-md);
      background: transparent;
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
      text-align: left;
      cursor: pointer;
    }

    .pos-header__plus-item:hover {
      background: var(--color-neutral-100);
    }

    .pos-header__plus-item--active {
      background: var(--color-primary-50);
      color: var(--color-primary-700);
    }

    .pos-header__plus-item i {
      color: var(--color-text-secondary);
      flex-shrink: 0;
    }

    .pos-header__plus-divider {
      height: 1px;
      background: var(--color-border-subtle);
      margin: var(--spacing-1) 0;
    }

    @media (max-width: 1919px) {
      .pos-header__pill--overflow {
        display: none;
      }

      .pos-header__plus-wrap {
        display: block;
      }

      .pos-header__pill--compact-label span {
        display: none;
      }

      .pos-header__pill--compact-label {
        min-width: 36px;
        justify-content: center;
        padding: var(--spacing-2) var(--spacing-3);
      }

      .pos-header__clock span {
        display: none;
      }

      .pos-header__clock {
        padding: 6px 10px;
      }
    }

    .pos-header__pill {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-4);
      border: none;
      border-radius: var(--radius-full);
      background: rgba(255, 255, 255, 0.2);
      color: var(--color-white);
      cursor: pointer;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      transition: all var(--transition-fast);
    }

    .pos-header__pill:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    .pos-header__pill--active {
      background: rgba(45, 139, 111, 0.5);
      color: var(--color-white);
    }

    .pos-header__pill--session-open {
      background: rgba(34, 197, 94, 0.35);
    }

    .pos-header__pill--session-closed,
    .pos-header__pill--z {
      background: rgba(234, 179, 8, 0.35);
      color: #fef3c7;
    }

    .pos-header__pill--demo {
      background: rgba(234, 179, 8, 0.35);
      color: #fef3c7;
    }

    .pos-header__theme {
      position: relative;
    }

    .pos-header__theme-menu {
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: var(--spacing-2);
      background: var(--color-white);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-2xl);
      padding: var(--spacing-2);
      min-width: 140px;
      z-index: 100;
    }

    .pos-header__theme-option {
      display: block;
      width: 100%;
      padding: var(--spacing-2) var(--spacing-3);
      border: none;
      border-radius: var(--radius-md);
      background: transparent;
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
      text-align: left;
      cursor: pointer;
    }

    .pos-header__theme-option:hover {
      background: var(--color-neutral-100);
    }

    .pos-header__theme-option--active {
      background: var(--color-primary-100);
      color: var(--color-primary-700);
    }

    .pos-header__pill i {
      font-size: 0.9rem;
      color: inherit;
      flex-shrink: 0;
    }

    .pos-header__back i,
    .pos-header__logo i,
    .pos-header__offline i {
      color: inherit;
      flex-shrink: 0;
    }

    .pos-header__new-order i {
      color: inherit;
      flex-shrink: 0;
    }

    .pos-header__new-order {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-5);
      background: linear-gradient(135deg, #2d8b6f 0%, #238b6a 100%);
      color: var(--color-white);
      border: none;
      border-radius: var(--radius-full);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      cursor: pointer;
      transition: all var(--transition-fast);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      flex-shrink: 0;
    }

    .pos-header__new-order:hover {
      background: linear-gradient(135deg, #35a07d 0%, #2a9b75 100%);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    }

    .pos-header__new-order:active {
      transform: translateY(0) scale(0.98);
    }

    .pos-header__offline {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-4);
      background: rgba(234, 179, 8, 0.2);
      color: #eab308;
      border-radius: var(--radius-full);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
    }

    .pos-header__shortcuts-panel {
      position: fixed;
      inset: 0;
      z-index: var(--z-modal);
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(15, 23, 42, 0.25);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      animation: fadeIn 200ms ease-out;
    }

    .pos-header__shortcuts-content {
      background: var(--color-white);
      border-radius: var(--radius-2xl);
      padding: var(--spacing-6);
      box-shadow: var(--shadow-2xl);
      min-width: 400px;
      border: 1px solid var(--color-border-subtle);
      animation: scaleInBounce 280ms cubic-bezier(0.34, 1.2, 0.64, 1) forwards;
    }

    .pos-header__shortcuts-header {
      position: relative;
      margin-bottom: var(--spacing-4);
    }

    .pos-header__shortcuts-content h3 {
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-bold);
      margin: 0 0 var(--spacing-1) 0;
      color: var(--color-text-primary);
      letter-spacing: -0.02em;
    }

    .pos-header__shortcuts-desc {
      font-size: var(--font-size-sm);
      color: var(--color-text-tertiary);
      margin: 0;
    }

    .pos-header__shortcuts-close {
      position: absolute;
      top: -4px;
      right: -4px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: none;
      border-radius: var(--radius-lg);
      background: var(--color-neutral-100);
      color: var(--color-text-tertiary);
      cursor: pointer;
      transition: all 200ms ease;
    }

    .pos-header__shortcuts-close:hover {
      background: var(--color-neutral-200);
      color: var(--color-text-primary);
    }

    .shortcut-grid {
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .shortcut-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
      padding: var(--spacing-3) 0;
    }

    .shortcut-separator {
      height: 1px;
      background: var(--color-border-subtle);
      margin: 0;
    }

    .shortcut-item kbd {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 64px;
      width: 64px;
      height: 32px;
      padding: 0 var(--spacing-3);
      background: linear-gradient(180deg, var(--color-neutral-100) 0%, var(--color-neutral-200) 100%);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.5), 0 2px 0 rgba(0, 0, 0, 0.06);
    }

    .shortcut-item span {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @media (max-width: 1024px) {
      .pos-header {
        --pos-header-height: 56px;
        height: var(--pos-header-height);
        padding: 0 var(--spacing-4);
      }
    }

    @media (max-width: 768px) {
      .pos-header {
        --pos-header-height: 56px;
        height: var(--pos-header-height);
      }

      .pos-header__back {
        width: 44px;
        height: 44px;
      }

      .pos-header__pill span { display: none; }
      .pos-header__pill i {
        font-size: 1rem;
      }
      .pos-header__new-order span { display: none; }
      .pos-header__new-order {
        min-width: 44px;
        min-height: 44px;
        padding: var(--spacing-2);
      }
      .pos-header__new-order i {
        font-size: 1rem;
      }

      .pos-header__center {
        max-width: none;
      }

      .pos-header__clock {
        display: none;
      }

      .pos-header__warehouse {
        max-width: 100px;
        padding: 6px 10px;
      }
    }
  `]
})
export class PosHeaderComponent implements OnInit, OnDestroy {
  readonly loc_ui_tern_entrepot_a7c1cf = $localize`:@@ui.tern.entrepot.a7c1cf:Entrepôt : `;
  readonly loc_ui_tern_entrepot_actif_75675f = $localize`:@@ui.tern.entrepot.actif.75675f:Entrepôt actif : `;
  readonly loc_ui_tern_caisse_4214e6 = $localize`:@@ui.tern.caisse.4214e6:Caisse : `;
  readonly loc_ui_tern_caisse_ouverte_72457d = $localize`:@@ui.tern.caisse.ouverte.72457d:Caisse ouverte`;
  readonly loc_ui_tern_ouvrir_la_caisse_7e98a3 = $localize`:@@ui.tern.ouvrir.la.caisse.7e98a3:Ouvrir la caisse`;
  readonly loc_ui_tern_caisse_fermee_8f0e89 = $localize`:@@ui.tern.caisse.fermee.8f0e89:Caisse fermée`;
  readonly loc_ui_tern_en_attente_5baac0 = $localize`:@@ui.tern.en.attente.5baac0:En attente (`;
  readonly loc_ui_tern_en_attente_b9cac2 = $localize`:@@ui.tern.en.attente.b9cac2:En attente `;
  readonly loc_ui_tern_commandes_4f2b74 = $localize`:@@ui.tern.commandes.4f2b74: commandes`;
  readonly loc_ui_tern_desactiver_le_son_76b567 = $localize`:@@ui.tern.desactiver.le.son.76b567:Desactiver le son`;
  readonly loc_ui_tern_activer_le_son_4fec90 = $localize`:@@ui.tern.activer.le.son.4fec90:Activer le son`;
  @Input() heldCount = 0;
  @Input() isDualScreenOpen = false;
  @Input() isQuickMode = false;
  @Output() onNewOrder = new EventEmitter<void>();
  @Output() onOpenHeld = new EventEmitter<void>();
  @Output() onOpenHistory = new EventEmitter<void>();
  @Output() onDualScreenToggle = new EventEmitter<void>();
  @Output() onQuickModeToggle = new EventEmitter<void>();
  @Output() onOpenRegister = new EventEmitter<void>();
  @Output() onXReport = new EventEmitter<void>();
  @Output() onCloseZ = new EventEmitter<void>();

  private readonly router = inject(Router);
  readonly offlineService = inject(PosOfflineService);
  readonly audioService = inject(PosAudioService);
  readonly themeService = inject(PosThemeService);
  readonly posState = inject(PosStateService);
  readonly voiceCommandService = inject(PosVoiceCommandService);
  readonly warehouseContext = inject(WarehouseContextService);
  readonly registerSession = inject(PosRegisterSessionService);

  themeOptions: { id: PosThemeId; label: string }[] = [
    { id: 'default', label: 'Defaut' },
    { id: 'christmas', label: 'Noel' },
    { id: 'ramadan', label: 'Ramadan' },
    { id: 'sales', label: 'Soldes' }
  ];
  showThemeMenu = false;
  showPlusMenu = false;

  currentTime = signal(this.getFormattedTime());
  showShortcuts = false;
  private clockInterval?: ReturnType<typeof setInterval>;

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeMenus();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.showThemeMenu = false;
    this.showPlusMenu = false;
  }

  setTheme(id: PosThemeId): void {
    this.themeService.setTheme(id);
  }

  toggleThemeMenu(event: Event): void {
    event.stopPropagation();
    this.showThemeMenu = !this.showThemeMenu;
    this.showPlusMenu = false;
  }

  togglePlusMenu(event: Event): void {
    event.stopPropagation();
    this.showPlusMenu = !this.showPlusMenu;
    this.showThemeMenu = false;
  }

  openShortcuts(): void {
    this.showShortcuts = true;
    this.closeMenus();
  }

  closeMenus(): void {
    this.showThemeMenu = false;
    this.showPlusMenu = false;
  }

  toggleVoiceUndo(): void {
    if (this.voiceCommandService.listening()) {
      this.voiceCommandService.stop();
    } else {
      this.voiceCommandService.startListeningForUndo();
    }
  }

  ngOnInit(): void {
    this.clockInterval = setInterval(() => {
      this.currentTime.set(this.getFormattedTime());
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this.clockInterval) clearInterval(this.clockInterval);
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }

  private getFormattedTime(): string {
    return new Date().toLocaleTimeString('fr-TN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }
}
