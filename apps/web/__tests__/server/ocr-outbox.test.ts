import { jest } from '@jest/globals';

jest.mock('~/server/engine', () => ({ getEngine: () => ({ db: {} as any }) }));

jest.mock('~/server/db', () => {
  const rows = [
    {
      id: 1,
      jobId: 'job-1',
      payload: {
        jobId: 'job-1',
        documentUrl: 'https://example.com/doc.pdf',
        documentName: 'doc.pdf',
        companyId: '1',
        userId: 'user-1',
        documentId: 42,
        category: 'invoices',
        options: {},
      },
      attemptCount: 0,
    },
  ];

  const select = jest.fn(() => ({ from: () => ({ where: () => Promise.resolve(rows) }) }));

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

import processPendingOutbox from '~/server/services/ocr-outbox';
import { triggerDocumentProcessing } from '@launchstack/core/ocr/trigger';

describe('ocr outbox processor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retries a failed dispatch and marks sent on success', async () => {
    const triggerMock = triggerDocumentProcessing as unknown as jest.Mock;
    triggerMock.mockRejectedValueOnce(new Error('dispatch failed'));
    triggerMock.mockResolvedValueOnce({ jobId: 'job-1', eventIds: ['evt-1'] });

    const dbMock = jest.requireMock('~/server/db').db as any;

    await processPendingOutbox();
    expect(triggerMock).toHaveBeenCalledTimes(1);
    expect(dbMock.update).toHaveBeenCalled();

    await processPendingOutbox();
    expect(triggerMock).toHaveBeenCalledTimes(2);
    expect(dbMock.update).toHaveBeenCalled();
  });

  it('skips dispatch if job is already completed', async () => {
    const triggerMock = triggerDocumentProcessing as unknown as jest.Mock;
    triggerMock.mockResolvedValue({ jobId: 'job-1', eventIds: ['evt-1'] });

    const dbMock = jest.requireMock('~/server/db').db as any;
    // make select return outbox rows on first call, then an ocrJobs row with status completed
    let callIndex = 0;
    (dbMock.select as jest.Mock).mockImplementation(() => {
      callIndex += 1;
      if (callIndex === 1) {
        return { from: () => ({ where: () => Promise.resolve([
          {
            id: 1,
            jobId: 'job-1',
            payload: {
              jobId: 'job-1',
              documentUrl: 'https://example.com/doc.pdf',
              documentName: 'doc.pdf',
              companyId: '1',
              userId: 'user-1',
              documentId: 42,
              category: 'invoices',
              options: {},
            },
            attemptCount: 0,
          },
        ]) }) };
      }
      return { from: () => ({ where: () => Promise.resolve([{ status: 'completed' }]) }) };
    });

    await processPendingOutbox();
    // trigger should not be called because job is completed
    expect(triggerMock).toHaveBeenCalledTimes(0);
    expect(dbMock.update).toHaveBeenCalled();
  });
});
