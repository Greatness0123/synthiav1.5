/**
 * FIFO queue for pending thought injections per agent.
 */

export class InjectionQueue {
  private queues: Map<string, string[]> = new Map();

  enqueue(text: string, agentId: string): string[] {
    if (!this.queues.has(agentId)) {
      this.queues.set(agentId, []);
    }
    const queue = this.queues.get(agentId)!;
    queue.push(text);
    return [...queue];
  }

  dequeue(agentId: string): { item: string | null, queue: string[] } {
    const queue = this.queues.get(agentId);
    if (!queue || queue.length === 0) return { item: null, queue: [] };
    const item = queue.shift() || null;
    return { item, queue: [...queue] };
  }
}

export const injectionQueue = new InjectionQueue();
