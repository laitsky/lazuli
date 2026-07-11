import { describe, expect, test } from 'bun:test';
import { faultInjectionAllowed, parseFaultDuration, parseProviderFaultPath } from './control';

describe('ingest control safety', () => {
  test('accepts only bounded known-provider disconnect paths', () => {
    expect(parseProviderFaultPath('/control/providers/bybit/disconnect')).toBe('bybit');
    expect(parseProviderFaultPath('/control/providers/unknown/disconnect')).toBe(null);
    expect(parseFaultDuration('30')).toBe(30);
    expect(() => parseFaultDuration('301')).toThrow('5 to 300');
  });

  test('rejects production fault injection', () => {
    expect(faultInjectionAllowed('staging')).toBe(true);
    expect(faultInjectionAllowed('production')).toBe(false);
  });
});
