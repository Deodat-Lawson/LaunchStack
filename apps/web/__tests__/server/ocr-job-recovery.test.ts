import { jest } from '@jest/globals';

// Mock engine before importing the module under test
jest.mock('~/server/engine', () => ({ getEngine: () => ({ db: {} as any }) }));

// Mock DB and schema-aware behavior
jest.mock('~/server/db', () => {
  const { ocrJobs, document } = jest.requireActual('@launchstack/core/db/schema');

  const jobs = [
    {
      id: 'job-1',
      documentId: 42,
      companyId: 1n,
      userId: 'user-1',
      documentUrl: 'https://example.com/doc.pdf',
      documentName: 'doc.pdf',
      retryCount: 0,
    },
  ];

  const select = jest.fn((fields?: unknown) => ({
    from: (table: unknown) => ({
      where: (cond: unknown) => {
        if (table === ocrJobs) return Promise.resolve(jobs);
        if (table === document) return Promise.resolve([{ category: 'invoices' }]);
        return Promise.resolve([]);
      },
    }),
  }));

  const updateWhere = jest.fn(async () => Promise.resolve());
  const updateSet = jest.fn(() => ({ where: updateWhere }));
  const update = jest.fn(() => ({ set: updateSet }));

  return {
    db: {
      select,
      update,
    },
  };
});

jest.mock('@launchstack/core/ocr/trigger', () => ({
  ...jest.requireActual('@launchstack/core/ocr/trigger'),
  triggerDocumentProcessing: jest.fn(),
}));

import sweepQueuedOcrJobs from '~/server/services/ocr-job-recovery';
import { triggerDocumentProcessing } from '@launchstack/core/ocr/trigger';

describe('sweepQueuedOcrJobs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('retries on failure and succeeds on next sweep', async () => {
    const triggerMock = triggerDocumentProcessing as unknown as jest.Mock;
    // First call fails, second call succeeds
    triggerMock.mockRejectedValueOnce(new Error('dispatch failed'));
    triggerMock.mockResolvedValueOnce({ jobId: 'job-1', eventIds: ['evt-1'] });

    const dbMock = jest.requireMock('~/server/db').db as any;

    // First sweep: dispatch fails, retryCount should be incremented
    await sweepQueuedOcrJobs();
    expect(triggerMock).toHaveBeenCalledTimes(1);
    expect(dbMock.update).toHaveBeenCalled();

    // Second sweep: dispatch succeeds
    await sweepQueuedOcrJobs();
    expect(triggerMock).toHaveBeenCalledTimes(2);
    expect(dbMock.update).toHaveBeenCalled();
  });
});
