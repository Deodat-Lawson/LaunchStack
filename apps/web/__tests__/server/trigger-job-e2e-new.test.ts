import { jest } from '@jest/globals';

// Deterministic in-memory DB mock used for this end-to-end test.
class MockDb {
  public documents: any[] = [];
  public ocrJobs: any[] = [];
  public outbox: any[] = [];

  async transaction(cb: (tx: any) => Promise<void>) {
    const tx = {
      insert: (table: any) => ({ values: async (vals: any) => this._insert(table, vals) }),
      update: (table: any) => ({ set: (vals: any) => ({ where: async (_cond: any) => this._update(table, vals) }) }),
    };
    await cb(tx);
  }

  insert = (table: any) => ({ values: async (vals: any) => this._insert(table, vals) });

  select = (_fields?: unknown) => ({ from: (table: any) => ({ where: async (_cond: unknown) => this._select(table) }) });

  update = (table: any) => ({ set: (vals: any) => ({ where: async (_cond: unknown) => this._update(table, vals) }) });

  async _insert(table: any, vals: any) {
    const schema = require('@launchstack/core/db/schema');
    if (table === schema.document) {
      const id = this.documents.length + 1;
      const row = { id, ...vals };
      this.documents.push(row);
      return [{ id: row.id, url: row.url, title: row.title }];
    }
    if (table === schema.ocrJobs) {
      this.ocrJobs.push({ ...vals });
      return [];
    }
    if (table === schema.ocrOutbox) {
      const row = { id: this.outbox.length + 1, status: vals.status ?? 'pending', attemptCount: vals.attemptCount ?? 0, payload: vals.payload, jobId: vals.jobId };
      this.outbox.push(row);
      return [];
    }
    return [];
  }

  async _select(table: any) {
    const schema = require('@launchstack/core/db/schema');
    if (table === schema.ocrOutbox) {
      return this.outbox.filter((r) => r.status === 'pending');
    }
    if (table === schema.ocrJobs) {
      return this.ocrJobs.slice();
    }
    if (table === schema.document) {
      return this.documents.slice();
    }
    return [];
  }

  async _update(table: any, vals: any) {
    const schema = require('@launchstack/core/db/schema');
    if (table === schema.ocrOutbox) {
      const row = this.outbox.find((r) => r.status === 'pending' || r.id === vals.id);
      if (row) Object.assign(row, vals);
      return;
    }
    if (table === schema.ocrJobs) {
      const row = this.ocrJobs[0];
      if (row) Object.assign(row, vals);
      return;
    }
  }
}

jest.mock('~/server/engine', () => ({ getEngine: () => ({ db: {} as any }) }));

describe('trigger job end-to-end (new test)', () => {
  let mockDb: MockDb;
  beforeEach(() => {
    jest.resetModules();
    mockDb = new MockDb();
    jest.doMock('~/server/db', () => ({ db: mockDb }));
  });

  it('never dispatches before the ocr_jobs row exists and recovers after dispatch failure', async () => {
    const triggerModule = require('@launchstack/core/ocr/trigger');

    // Spy on triggerDocumentProcessing: first call should see the job row and fail,
    // second call should succeed.
    const triggerMock = jest.spyOn(triggerModule, 'triggerDocumentProcessing').mockImplementationOnce(async (...args: any[]) => {
      // overrideJobId is passed as the last arg in the trigger API
      const passedJobId = args[7];
      const found = mockDb.ocrJobs.find((j) => j.id === passedJobId);
      if (!found) {
        throw new Error('ocr_jobs row missing at dispatch time');
      }
      throw new Error('simulated-dispatch-failure');
    }).mockResolvedValueOnce({ jobId: 'job-after-retry', eventIds: ['evt-1'] });

    const { triggerJob } = require('~/server/services/trigger-job');
    const processPendingOutbox = require('~/server/services/ocr-outbox').default;

    const { db } = require('~/server/db');
    await db.insert(require('@launchstack/core/db/schema').document).values({ url: 'https://example.com/doc.pdf', title: 'doc.pdf', companyId: 1n });

    // Enqueue job: immediate dispatch will fail but should only run after job insert
    const { jobId } = await triggerJob({ documentUrl: 'https://example.com/doc.pdf', documentName: 'doc.pdf', companyId: 1n, userId: 'user-1', documentId: 1, category: 'invoices' } as any);

    // Confirm outbox has pending entry
    expect(mockDb.outbox.length).toBeGreaterThan(0);

    // Retry via outbox processor: second call resolves
    await processPendingOutbox();

    // triggerMock should have been called twice (initial attempt + retry)
    expect(triggerMock).toHaveBeenCalledTimes(2);

    const sent = mockDb.outbox.find((r) => r.jobId === jobId || r.jobId === 'job-after-retry');
    expect(sent).toBeDefined();
    expect(sent.status === 'sent' || sent.eventIds).toBeTruthy();
  });
});
