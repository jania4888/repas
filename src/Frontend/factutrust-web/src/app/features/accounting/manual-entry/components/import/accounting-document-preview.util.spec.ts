import {
  ACCOUNTING_DOCUMENT_MAX_BYTES,
  AcceptedDocumentPreview,
  classifyDocumentFile,
  classifyDocumentHeader,
  RejectedDocumentPreview
} from './accounting-document-preview.util';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const BMP = new Uint8Array([0x42, 0x4d, 0x00, 0x00]);
const TIFF_LE = new Uint8Array([0x49, 0x49, 0x2a, 0x00]);
const TIFF_BE = new Uint8Array([0x4d, 0x4d, 0x00, 0x2a]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

function webp(): Uint8Array {
  const header = new Uint8Array(16);
  header.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  return header;
}

function accepted(fileName: string, size: number, header: Uint8Array): AcceptedDocumentPreview {
  const result = classifyDocumentHeader(fileName, size, header);
  if (!result.accepted) {
    throw new Error(`expected accept for ${fileName}, got ${result.reason}`);
  }
  return result;
}

function rejected(fileName: string, size: number, header: Uint8Array): RejectedDocumentPreview {
  const result = classifyDocumentHeader(fileName, size, header);
  if (result.accepted) {
    throw new Error(`expected rejection for ${fileName}`);
  }
  return result;
}

describe('classifyDocumentHeader', () => {
  it('accepts PDF, PNG, JPEG, WebP and BMP as visual previews', () => {
    expect(accepted('Facture.PDF', 1200, PDF)).toEqual({
      accepted: true,
      kind: 'pdf',
      mime: 'application/pdf',
      extension: 'pdf',
      attachmentMayBeRejected: false
    });
    expect(accepted('scan.png', 1200, PNG).kind).toBe('image');
    expect(accepted('scan.jpg', 1200, JPEG)).toEqual(
      jasmine.objectContaining({ accepted: true, kind: 'image', mime: 'image/jpeg', attachmentMayBeRejected: false })
    );
    expect(accepted('scan.jpeg', 1200, JPEG).extension).toBe('jpeg');
    expect(accepted('scan.webp', 1200, webp())).toEqual(
      jasmine.objectContaining({ accepted: true, kind: 'image', mime: 'image/webp' })
    );
    expect(accepted('scan.bmp', 1200, BMP)).toEqual(
      jasmine.objectContaining({ accepted: true, kind: 'image', mime: 'image/bmp', attachmentMayBeRejected: true })
    );
  });

  it('accepts TIFF and Office zip without a visual kind', () => {
    expect(accepted('scan.tif', 1200, TIFF_LE)).toEqual(
      jasmine.objectContaining({ accepted: true, kind: 'unsupported', attachmentMayBeRejected: true })
    );
    expect(accepted('scan.tiff', 1200, TIFF_BE).kind).toBe('unsupported');
    expect(accepted('piece.docx', 1200, ZIP)).toEqual(
      jasmine.objectContaining({
        accepted: true,
        kind: 'unsupported',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        attachmentMayBeRejected: false
      })
    );
    expect(accepted('piece.xlsx', 1200, ZIP).attachmentMayBeRejected).toBeFalse();
    expect(accepted('piece.xlsm', 1200, ZIP)).toEqual(
      jasmine.objectContaining({ accepted: true, kind: 'unsupported', attachmentMayBeRejected: true })
    );
  });

  it('rejects HTML renamed as PDF', () => {
    const html = new TextEncoder().encode('<!doctype html>');
    expect(rejected('note.pdf', html.length, html)).toEqual({
      accepted: false,
      reason: 'signature'
    });
  });

  it('rejects extensions outside the allowlist', () => {
    expect(rejected('a.svg', 10, PNG).reason).toBe('extension');
    expect(rejected('a.html', 10, PDF).reason).toBe('extension');
    expect(rejected('a.exe', 10, ZIP).reason).toBe('extension');
  });

  it('rejects an extension that does not match the signature family', () => {
    expect(rejected('photo.pdf', 1200, PNG)).toEqual({ accepted: false, reason: 'signature' });
    expect(rejected('sheet.docx', 1200, PDF)).toEqual({ accepted: false, reason: 'signature' });
  });

  it('rejects empty and oversized files and accepts exactly 10 Mo', () => {
    expect(rejected('a.pdf', 0, PDF)).toEqual({ accepted: false, reason: 'empty' });
    expect(rejected('a.pdf', ACCOUNTING_DOCUMENT_MAX_BYTES + 1, PDF)).toEqual({
      accepted: false,
      reason: 'too-large'
    });
    expect(accepted('a.pdf', ACCOUNTING_DOCUMENT_MAX_BYTES, PDF).accepted).toBeTrue();
  });

  it('does not warn about attachments for PDF, PNG, DOCX and XLSX', () => {
    expect(accepted('a.pdf', 20, PDF).attachmentMayBeRejected).toBeFalse();
    expect(accepted('a.png', 20, PNG).attachmentMayBeRejected).toBeFalse();
    expect(accepted('a.docx', 20, ZIP).attachmentMayBeRejected).toBeFalse();
    expect(accepted('a.xlsx', 20, ZIP).attachmentMayBeRejected).toBeFalse();
  });
});

describe('classifyDocumentFile', () => {
  it('does not read a file rejected on size or extension', async () => {
    let sliced = false;
    const oversized = {
      name: 'gros.pdf',
      size: ACCOUNTING_DOCUMENT_MAX_BYTES + 1,
      slice: () => {
        sliced = true;
        return new Blob();
      }
    } as unknown as File;

    await expectAsync(classifyDocumentFile(oversized)).toBeResolvedTo({ accepted: false, reason: 'too-large' });
    expect(sliced).toBeFalse();

    const foreign = {
      name: 'note.html',
      size: 32,
      slice: () => {
        sliced = true;
        return new Blob();
      }
    } as unknown as File;
    await expectAsync(classifyDocumentFile(foreign)).toBeResolvedTo({ accepted: false, reason: 'extension' });
    expect(sliced).toBeFalse();
  });

  it('reads the header of an accepted PDF', async () => {
    const file = new File([PDF], 'facture.pdf', { type: 'application/octet-stream' });
    await expectAsync(classifyDocumentFile(file)).toBeResolvedTo({
      accepted: true,
      kind: 'pdf',
      mime: 'application/pdf',
      extension: 'pdf',
      attachmentMayBeRejected: false
    });
  });
});
