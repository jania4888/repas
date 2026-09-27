import {
  BLOCK_TYPE_LABELS,
  isDocumentNumberBlock,
  NumberingBlock,
  NumberingBlockType
} from './models/numbering.models';

export const MAX_RENDERED_LENGTH = 50;

export interface RenderValidationResult {
  valid: boolean;
  error?: string;
}

function padSequence(sequence: number, digits: number): string {
  return sequence.toString().padStart(digits, '0');
}

function renderBlock(
  block: NumberingBlock,
  sequence: number,
  referenceDate: Date,
  freeTextOverride?: string
): string | null {
  switch (block.type) {
    case NumberingBlockType.FreeText:
      return (freeTextOverride ?? block.value ?? '').trim().toUpperCase();
    case NumberingBlockType.Separator:
      return block.value ?? '-';
    case NumberingBlockType.DocumentNumber:
      return sequence.toString();
    case NumberingBlockType.DocumentNumberPadded3:
      return padSequence(sequence, 3);
    case NumberingBlockType.DocumentNumberPadded4:
      return padSequence(sequence, 4);
    case NumberingBlockType.DocumentNumberPadded5:
      return padSequence(sequence, 5);
    case NumberingBlockType.DocumentNumberPadded6:
      return padSequence(sequence, 6);
    case NumberingBlockType.Day:
      return referenceDate.getDate().toString().padStart(2, '0');
    case NumberingBlockType.Month:
      return (referenceDate.getMonth() + 1).toString().padStart(2, '0');
    case NumberingBlockType.Year4:
      return referenceDate.getFullYear().toString();
    case NumberingBlockType.Year2:
      return (referenceDate.getFullYear() % 100).toString().padStart(2, '0');
    default:
      return null;
  }
}

export function render(
  blocks: NumberingBlock[],
  sequence: number,
  referenceDate: Date,
  freeTextOverride?: string
): { value: string; error?: string } {
  const validation = validateBlocks(blocks);
  if (!validation.valid) {
    return { value: '', error: validation.error };
  }

  const ordered = [...blocks].sort((a, b) => a.order - b.order);
  const parts: string[] = [];

  for (const block of ordered) {
    const part = renderBlock(block, sequence, referenceDate, freeTextOverride);
    if (part === null) {
      return { value: '', error: $localize`:@@settings.numbering-format-renderer.ts.type.de.bloc.inconnu.type.290bd27d:Type de bloc inconnu: ${block.type}:type:` };
    }
    parts.push(part);
  }

  const rendered = parts.join('');
  if (rendered.length > MAX_RENDERED_LENGTH) {
    return {
      value: '',
      error: $localize`:@@settings.numbering-format-renderer.ts.le.numero.genere.depasse.max.rendered.le.75804980:Le numéro généré dépasse ${MAX_RENDERED_LENGTH}:MAX_RENDERED_LENGTH: caractères.`
    };
  }

  return { value: rendered };
}

export function validateBlocks(blocks: NumberingBlock[]): RenderValidationResult {
  if (!blocks.length) {
    return { valid: false, error: $localize`:@@settings.numbering-format-renderer.ts.le.format.de.numerotation.est.vide.bf6040e1:Le format de numérotation est vide.` };
  }

  if (!blocks.some((b) => isDocumentNumberBlock(b.type))) {
    return {
      valid: false,
      error: $localize`:@@settings.numbering-format-renderer.ts.le.format.doit.contenir.au.moins.un.bloc.ea747be6:Le format doit contenir au moins un bloc numéro de document.`
    };
  }

  for (const block of blocks) {
    if (block.type === NumberingBlockType.FreeText) {
      if (!block.value || !block.value.trim()) {
        return { valid: false, error: $localize`:@@settings.numbering-format-renderer.ts.le.texte.libre.est.obligatoire.248f1f10:Le texte libre est obligatoire.` };
      }
      if (block.value.trim().length > 20) {
        return { valid: false, error: $localize`:@@settings.numbering-format-renderer.ts.le.texte.libre.ne.peut.pas.depasser.20.c.9d88a149:Le texte libre ne peut pas dépasser 20 caractères.` };
      }
    }

    if (block.type === NumberingBlockType.Separator) {
      if (block.value !== '-' && block.value !== '/') {
        return { valid: false, error: $localize`:@@settings.numbering-format-renderer.ts.le.separateur.doit.etre.ou.22cbf785:Le séparateur doit être « - » ou « / ».` };
      }
    }
  }

  return { valid: true };
}

export function blockDisplayLabel(block: NumberingBlock): string {
  return block.label ?? BLOCK_TYPE_LABELS[block.type];
}
