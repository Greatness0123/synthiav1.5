/**
 * Tests for core coordinator components.
 */

import { PayloadBuilder } from '../payloadBuilder';
import { InjectionQueue } from '../injectionQueue';
import { MemoryManager } from '../memoryManager';

// Mocks
jest.mock('../embeddingEngine', () => ({
  embeddingEngine: {
    embed: jest.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
  },
}));

describe('PayloadBuilder', () => {
  let memoryManager: any;
  let payloadBuilder: PayloadBuilder;

  beforeEach(() => {
    memoryManager = {
      retrieveRelevant: jest.fn().mockResolvedValue([{ id: '1', thought: 'test' }]),
      retrieveRecent: jest.fn().mockResolvedValue([{ id: '2', thought: 'recent' }]),
    };
    payloadBuilder = new PayloadBuilder(memoryManager);
  });

  it('should build a valid payload', async () => {
    const worldState = {
      heartbeat: 100,
      frame: 1000,
      lightState: 'day',
      goal: 'test goal',
      objects: [{ name: 'cube' }],
      joints: { head: 0 },
      audio: {}
    };
    const directives = { mode: 'free_will', goal: 'default goal' };

    const payload = await payloadBuilder.build(worldState, 'agent_a', directives);

    expect(payload.agent_id).toBe('agent_a');
    expect(payload.heartbeat).toBe(100);
    expect(payload.current_goal).toBe('test goal');
    expect(payload.relevant_memories.length).toBe(1);
    expect(payload.recent_working_memories.length).toBe(1);
  });
});

describe('InjectionQueue', () => {
  let queue: InjectionQueue;

  beforeEach(() => {
    queue = new InjectionQueue();
  });

  it('should enqueue and dequeue in order', () => {
    queue.enqueue('thought 1', 'agent_a');
    queue.enqueue('thought 2', 'agent_a');

    expect(queue.dequeue('agent_a').item).toBe('thought 1');
    expect(queue.dequeue('agent_a').item).toBe('thought 2');
    expect(queue.dequeue('agent_a').item).toBeNull();
  });
});
