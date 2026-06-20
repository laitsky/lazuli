declare module 'bun:test' {
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect(actual: unknown): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toHaveLength(expected: number): void;
    resolves: {
      toBe(expected: unknown): Promise<void>;
    };
    rejects: {
      toThrow(expected?: string | RegExp): Promise<void>;
    };
  };
}
