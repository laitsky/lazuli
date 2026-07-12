export class BoundedEventIds {
  private readonly ids = new Set<string>();
  private readonly order: string[] = [];

  constructor(private readonly maximum: number) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      throw new Error('Event dedupe capacity must be positive');
    }
  }

  remember(eventId: string): boolean {
    if (this.ids.has(eventId)) return false;
    this.ids.add(eventId);
    this.order.push(eventId);
    while (this.order.length > this.maximum) {
      const oldest = this.order.shift();
      if (oldest) this.ids.delete(oldest);
    }
    return true;
  }
}
