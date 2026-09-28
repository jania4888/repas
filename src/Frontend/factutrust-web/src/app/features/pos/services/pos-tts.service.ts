import { Injectable, inject } from '@angular/core';
import { PosStateService, PosOrderLine } from './pos-state.service';

@Injectable({
  providedIn: 'root'
})
export class PosTtsService {
  private readonly posState = inject(PosStateService);

  private synth(): SpeechSynthesis | null {
    return typeof window !== 'undefined' ? window.speechSynthesis : null;
  }

  isSupported(): boolean {
    return !!this.synth();
  }

  speakTotal(): void {
    const s = this.synth();
    if (!s) return;
    s.cancel();
    const lines = this.posState.lines();
    if (lines.length === 0) {
      this.speak('Panier vide.');
      return;
    }
    const total = this.posState.totals().totalTTC;
    const currency = this.posState.currency() ?? 'TND';
    const text = $localize`:@@pos.pos-tts.ts.total.a.payer.tofixed.currency.6b8a8056:Total à payer : ${total.toFixed(3)}:toFixed: ${currency}:currency:.`;
    this.speak(text);
  }

  speakLines(): void {
    const s = this.synth();
    if (!s) return;
    s.cancel();
    const lines = this.posState.lines();
    if (lines.length === 0) {
      this.speak('Panier vide.');
      return;
    }
    const parts = lines.map((l: PosOrderLine) => `${l.quantity} ${l.designation}, ${l.totalTTC.toFixed(3)} dinars`);
    const text = parts.join('. ');
    this.speak(text);
  }

  speak(text: string, lang = 'fr-FR'): void {
    const s = this.synth();
    if (!s || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.95;
    u.pitch = 1;
    s.speak(u);
  }

  cancel(): void {
    this.synth()?.cancel();
  }
}
