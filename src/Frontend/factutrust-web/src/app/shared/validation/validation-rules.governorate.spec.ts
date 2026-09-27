import { TUNISIAN_GOVERNORATE_OPTIONS, TUNISIAN_GOVERNORATES } from './validation-rules';

describe('TUNISIAN_GOVERNORATE_OPTIONS', () => {
  it('keeps API values equal to the official Latin names', () => {
    expect(TUNISIAN_GOVERNORATE_OPTIONS.map(o => o.value)).toEqual([...TUNISIAN_GOVERNORATES]);
  });
});
