import { jest } from '@jest/globals';

// Mock engine to avoid importing ESM-only modules during test initialization
jest.mock('~/server/engine', () => ({
  getEngine: () => ({ db: {} as any }),
}));

import { triggerDocumentProcessing } from '@launchstack/core/ocr/trigger';
import { triggerJob } from '~/server/services/trigger-job';

jest.mock('~/server/db', () => {
  const state = { inserted: false };
  const valuesFn = jest.fn(async (_vals: unknown) => {
    state.inserted = true;
    return Promise.resolve();
  });

  const insertMock = jest.fn(() => ({ values: valuesFn }));
  const tx = { insert: insertMock } as any;

  return {
    __mockState: state,
    db: {
      insert: insertMock,
      transaction: jest.fn(async (cb: (tx: any) => Promise<void>) => cb(tx)),
    },
  };
});

// Partial mock of the trigger module so we can assert order while keeping
// parseProvider and other utilities intact.
jest.mock('@launchstack/core/ocr/trigger', () => {
  const actual = jest.requireActual('@launchstack/core/ocr/trigger');
  return {
    ...actual,
    triggerDocumentProcessing: jest.fn(async (...args: unknown[]) => {
      // At runtime, read the mocked DB state to verify insert happened.
      const dbMock = jest.requireMock('~/server/db') as any;
      if (!dbMock.__mockState || !dbMock.__mockState.inserted) {
        throw new Error('Dispatch ran before DB insert');
      }
      const jobId = args[args.length - 1] as string | undefined;
      return { jobId: jobId ?? 'mock-job', eventIds: ['evt-1'] };
    }),
  };
});

describe('triggerJob ordering', () => {
  beforeEach(() => {
    const dbMock = jest.requireMock('~/server/db') as any;
    dbMock.__mockState.inserted = false;
    (triggerDocumentProcessing as jest.Mock).mockClear();
  });

  it('does not dispatch before the DB row exists', async () => {
    const params = {
      documentUrl: 'https://example.com/doc.pdf',
      documentName: 'doc.pdf',
      companyId: 1n,
      userId: 'user-1',
      documentId: 42,
      category: 'invoices',
    } as const;

    const result = await triggerJob(params as any);

    expect(result.jobId).toBeDefined();
    // Immediate dispatch may fail; ensure the dispatcher was invoked and the DB row was inserted
    expect((triggerDocumentProcessing as jest.Mock).mock.calls.length).toBe(1);
    const dbMock = jest.requireMock('~/server/db') as any;
    expect(dbMock.__mockState.inserted).toBe(true);
  });
});
