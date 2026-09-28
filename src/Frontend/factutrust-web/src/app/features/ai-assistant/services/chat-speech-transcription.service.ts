import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface ChatSpeechStartOptions {
  /** Texte déjà présent dans la zone ; la dictée s’y ajoute. */
  baseText: string;
  /** Texte complet à afficher (base + segments finaux + segment interim). */
  onDisplayText: (text: string) => void;
  /** Défaut : fr-FR */
  lang?: string;
}

type RecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [i: number]: {
      isFinal: boolean;
      0: { transcript: string };
    };
  };
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

@Injectable({
  providedIn: 'root'
})
export class ChatSpeechTranscriptionService {
  private readonly platformId = inject(PLATFORM_ID);

  readonly listening = signal(false);
  /** Message court pour l’utilisateur (refus micro, etc.). Vidé au prochain démarrage. */
  readonly lastError = signal<string | null>(null);

  private recognition: RecognitionInstance | null = null;
  private committedFinal = '';
  private onDisplayText: ((text: string) => void) | null = null;
  private basePrefix = '';

  isSupported(): boolean {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }
    if (typeof window === 'undefined') {
      return false;
    }
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
  }

  start(options: ChatSpeechStartOptions): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.lastError.set(null);
    this.stop();

    const w = window as unknown as {
      SpeechRecognition?: new () => RecognitionInstance;
      webkitSpeechRecognition?: new () => RecognitionInstance;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      return;
    }

    this.basePrefix = options.baseText;
    this.committedFinal = '';
    this.onDisplayText = options.onDisplayText;
    const lang = options.lang ?? 'fr-FR';

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;

    rec.onresult = (event: SpeechRecognitionEventLike) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        const piece = r[0]?.transcript ?? '';
        if (r.isFinal) {
          this.committedFinal += piece;
        } else {
          interim += piece;
        }
      }
      const display = this.basePrefix + this.committedFinal + interim;
      this.onDisplayText?.(display);
    };

    rec.onerror = (event: SpeechRecognitionErrorEventLike) => {
      const code = event.error;
      if (code === 'not-allowed') {
        this.lastError.set($localize`:@@ai-assistant.chat-speech-transcription.ts.acces.au.microphone.refuse.autorisez.le.ddb1a61a:Accès au microphone refusé. Autorisez le micro dans les paramètres du navigateur.`);
      } else if (code === 'no-speech') {
        this.lastError.set(null);
      } else if (code !== 'aborted') {
        this.lastError.set($localize`:@@ai-assistant.chat-speech-transcription.ts.dictee.interrompue.reessayez.65e33ff5:Dictée interrompue. Réessayez.`);
      }
      this.finalizeFromEngine();
    };

    rec.onend = () => {
      this.finalizeFromEngine();
    };

    this.recognition = rec;
    this.listening.set(true);
    try {
      rec.start();
    } catch {
      this.lastError.set($localize`:@@ai-assistant.chat-speech-transcription.ts.impossible.de.demarrer.la.dictee.2020ea7f:Impossible de démarrer la dictée.`);
      this.finalizeFromEngine();
    }
  }

  /** Arrête la dictée (bouton utilisateur ou désactivation du champ). */
  stop(): void {
    const rec = this.recognition;
    if (!rec) {
      return;
    }
    this.recognition = null;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.stop();
    } catch {
      try {
        rec.abort();
      } catch {
        // ignore
      }
    }
    this.listening.set(false);
    this.onDisplayText = null;
  }

  /** Appelé depuis onerror / onend moteur (fin naturelle ou erreur). */
  private finalizeFromEngine(): void {
    if (!this.recognition) {
      return;
    }
    const rec = this.recognition;
    this.recognition = null;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    this.listening.set(false);
    this.onDisplayText = null;
  }
}
