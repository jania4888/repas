/**
 * Classification locale d'une pièce avant aperçu et avant envoi.
 * Aucun DOM, aucune URL : le dialogue décide ensuite de créer un blob typé.
 * La taille et l'extension sont tranchées avant toute lecture du contenu.
 */

export const ACCOUNTING_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export type PreviewKind = 'image' | 'pdf' | 'unsupported';

export type PreviewRejectionReason = 'empty' | 'too-large' | 'extension' | 'signature';

export interface AcceptedDocumentPreview {
  readonly accepted: true;
  readonly kind: PreviewKind;
  readonly mime: string;
  readonly extension: string;
  readonly attachmentMayBeRejected: boolean;
}

export interface RejectedDocumentPreview {
  readonly accepted: false;
  readonly reason: PreviewRejectionReason;
}

export type DocumentPreviewClassification = AcceptedDocumentPreview | RejectedDocumentPreview;

type SignatureFamily = 'pdf' | 'png' | 'jpeg' | 'webp' | 'bmp' | 'tiff' | 'zip';

interface ExtensionRule {
  readonly kind: PreviewKind;
  readonly mime: string;
  readonly family: SignatureFamily;
  readonly attachmentMayBeRejected: boolean;
}

const EXTENSIONS: Readonly<Record<string, ExtensionRule>> = {
  pdf: {
    kind: 'pdf',
    mime: 'application/pdf',
    family: 'pdf',
    attachmentMayBeRejected: false
  },
  png: {
    kind: 'image',
    mime: 'image/png',
    family: 'png',
    attachmentMayBeRejected: false
  },
  jpg: {
    kind: 'image',
    mime: 'image/jpeg',
    family: 'jpeg',
    attachmentMayBeRejected: false
  },
  jpeg: {
    kind: 'image',
    mime: 'image/jpeg',
    family: 'jpeg',
    attachmentMayBeRejected: false
  },
  webp: {
    kind: 'image',
    mime: 'image/webp',
    family: 'webp',
    attachmentMayBeRejected: false
  },
  bmp: {
    kind: 'image',
    mime: 'image/bmp',
    family: 'bmp',
    attachmentMayBeRejected: true
  },
  tif: {
    kind: 'unsupported',
    mime: 'image/tiff',
    family: 'tiff',
    attachmentMayBeRejected: true
  },
  tiff: {
    kind: 'unsupported',
    mime: 'image/tiff',
    family: 'tiff',
    attachmentMayBeRejected: true
  },
  docx: {
    kind: 'unsupported',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    family: 'zip',
    attachmentMayBeRejected: false
  },
  xlsx: {
    kind: 'unsupported',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    family: 'zip',
    attachmentMayBeRejected: false
  },
  xlsm: {
    kind: 'unsupported',
    mime: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    family: 'zip',
    attachmentMayBeRejected: true
  }
};

/** Dernière extension, sans le point, insensible à la casse. Vide si le nom n'en a pas. */
export function documentExtension(fileName: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? '';
  const trimmed = base.trim();
  const dot = trimmed.lastIndexOf('.');
  if (dot <= 0 || dot === trimmed.length - 1) {
    return '';
  }
  return trimmed.slice(dot + 1).toLowerCase();
}

/**
 * Classe un en-tête déjà lu (16 octets suffisent).
 * `size === 0`, au-dessus de 10 Mo, ou extension hors liste : refus sans se fier aux octets.
 */
export function classifyDocumentHeader(
  fileName: string,
  size: number,
  header: Uint8Array
): DocumentPreviewClassification {
  if (size <= 0) {
    return { accepted: false, reason: 'empty' };
  }
  if (size > ACCOUNTING_DOCUMENT_MAX_BYTES) {
    return { accepted: false, reason: 'too-large' };
  }
  const extension = documentExtension(fileName);
  const rule = EXTENSIONS[extension];
  if (!rule) {
    return { accepted: false, reason: 'extension' };
  }
  if (!signatureMatches(rule.family, header)) {
    return { accepted: false, reason: 'signature' };
  }
  return {
    accepted: true,
    kind: rule.kind,
    mime: rule.mime,
    extension,
    attachmentMayBeRejected: rule.attachmentMayBeRejected
  };
}

/**
 * Point d'entrée fichier. Ne lit rien lorsque la taille ou l'extension suffit à refuser.
 */
export async function classifyDocumentFile(file: File): Promise<DocumentPreviewClassification> {
  const extension = documentExtension(file.name);
  if (file.size <= 0 || file.size > ACCOUNTING_DOCUMENT_MAX_BYTES || !EXTENSIONS[extension]) {
    return classifyDocumentHeader(file.name, file.size, new Uint8Array());
  }
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return classifyDocumentHeader(file.name, file.size, header);
}

function signatureMatches(family: SignatureFamily, header: Uint8Array): boolean {
  switch (family) {
    case 'pdf':
      return startsWith(header, [0x25, 0x50, 0x44, 0x46]);
    case 'png':
      return startsWith(header, [0x89, 0x50, 0x4e, 0x47]);
    case 'jpeg':
      return startsWith(header, [0xff, 0xd8, 0xff]);
    case 'webp':
      return (
        startsWith(header, [0x52, 0x49, 0x46, 0x46]) &&
        header.length >= 12 &&
        header[8] === 0x57 &&
        header[9] === 0x45 &&
        header[10] === 0x42 &&
        header[11] === 0x50
      );
    case 'bmp':
      return startsWith(header, [0x42, 0x4d]);
    case 'tiff':
      return startsWith(header, [0x49, 0x49]) || startsWith(header, [0x4d, 0x4d]);
    case 'zip':
      return startsWith(header, [0x50, 0x4b, 0x03, 0x04]);
    default:
      return false;
  }
}

function startsWith(header: Uint8Array, bytes: readonly number[]): boolean {
  if (header.length < bytes.length) {
    return false;
  }
  for (let i = 0; i < bytes.length; i++) {
    if (header[i] !== bytes[i]) {
      return false;
    }
  }
  return true;
}
