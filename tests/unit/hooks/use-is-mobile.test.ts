import { describe, expect, it } from 'vitest';
import { buildMobileMediaQuery } from '@/hooks/use-is-mobile';

describe('buildMobileMediaQuery', () => {
  it('combines the max-width threshold with hover:none and pointer:coarse', () => {
    expect(buildMobileMediaQuery(768)).toBe(
      '(max-width: 767px), (hover: none) and (pointer: coarse)',
    );
  });

  it('applies custom breakpoint values', () => {
    expect(buildMobileMediaQuery(1024)).toBe(
      '(max-width: 1023px), (hover: none) and (pointer: coarse)',
    );
  });
});
