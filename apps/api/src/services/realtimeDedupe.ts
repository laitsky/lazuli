export class BoundedRealtimeEventIndex {
  private readonly sequences = new Map<string, number>();

  constructor(private readonly maximum: number) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      throw new Error('Realtime dedupe capacity must be positive');
    }
  }

  get(eventId: string): number | undefined {
    return this.sequences.get(eventId);
  }

  remember(eventId: string, sequence: number): void {
    if (this.sequences.has(eventId)) return;
    this.sequences.set(eventId, sequence);
    while (this.sequences.size > this.maximum) {
      const oldest = this.sequences.keys().next().value as string | undefined;
      if (!oldest) break;
      this.sequences.delete(oldest);
    }
  }

  restore(entries: Array<[string, number]>): void {
    for (const [eventId, sequence] of entries.slice(-this.maximum)) {
      this.remember(eventId, sequence);
    }
  }

  entries(): Array<[string, number]> {
    return [...this.sequences.entries()];
  }
}
