import { nifValueFromPaste } from './validation-rules';

describe('nifValueFromPaste', () => {
  it('rewrites the historical spelling to the fiscal card form', () => {
    expect(nifValueFromPaste('1772793/W/A/M/000')).toBe('1772793W/A/M/000');
    expect(nifValueFromPaste('1234567/A/B/C/000')).toBe('1234567A/B/C/000');
  });

  it('keeps an already official value', () => {
    expect(nifValueFromPaste('1772793W/A/M/000')).toBe('1772793W/A/M/000');
  });

  it('rejects an incomplete placeholder and free text', () => {
    expect(nifValueFromPaste('1234567A/M/000')).toBeNull();
    expect(nifValueFromPaste("' OR 1=1")).toBeNull();
  });
});
