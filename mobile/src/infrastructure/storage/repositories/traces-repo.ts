import type { Trace, TraceNode } from '@/domain/entities/Trace';

import type { Database } from '../database';

interface TraceRow {
  id: string;
  message_id: string;
  nodes: string | Buffer;
  updated_at: number;
}

function decodeNodes(raw: string | Buffer): TraceNode[] {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error(`Corrupt trace blob: expected array, got ${typeof parsed}`);
  }
  return parsed as TraceNode[];
}

function rowToTrace(row: TraceRow): Trace {
  return {
    id: row.id,
    messageId: row.message_id,
    nodes: decodeNodes(row.nodes),
    updatedAt: row.updated_at,
  };
}

export class TracesRepository {
  constructor(private readonly db: Database) {}

  upsert(trace: Trace): void {
    this.db.run(
      `INSERT INTO traces (id, message_id, nodes, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         message_id=excluded.message_id,
         nodes=excluded.nodes,
         updated_at=excluded.updated_at`,
      [trace.id, trace.messageId, JSON.stringify(trace.nodes), trace.updatedAt],
    );
  }

  findByMessageId(messageId: string): Trace | null {
    const row = this.db.first<TraceRow>('SELECT * FROM traces WHERE message_id = ?', [
      messageId,
    ]);
    return row ? rowToTrace(row) : null;
  }
}
