import { describe, expect, it } from 'vitest';
import { parseJavaMajor } from '../electron/services/java';

describe('parseJavaMajor', () => {
  it('parses modern Java version strings', () => {
    expect(parseJavaMajor('openjdk version "21.0.3" 2024-04-16')).toBe(21);
    expect(parseJavaMajor('java version "17.0.12" 2024-07-16')).toBe(17);
  });

  it('parses the legacy 1.x Java version format', () => {
    expect(parseJavaMajor('java version "1.8.0_402"')).toBe(8);
  });

  it('returns null for unrelated process output', () => {
    expect(parseJavaMajor('Could not create the Java Virtual Machine')).toBeNull();
  });
});
