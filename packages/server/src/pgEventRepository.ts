import type { ListenMeta, Sql } from 'postgres'
import {
  EVENT_MAX_BYTES, type EventEnvelope, type EventPublishInput, eventPublishSchema,
  type EventReadInput, type EventReadResult, eventReadSchema, type EventReceipt, type EventRepository, type EventTopicBinding, KEY_NODE, TBError,
} from '@tool-bridge/core'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod/v4'

const bindingSchema = z.object({ kind: z.literal('topic'), authRef: z.string().min(1), provider: z.string().min(1), export: z.string().min(1) })
const CHANNEL = 'tb_event_published'
const MAX_RECORDS = 4096
const MAX_RECEIPTS = 16_384
const MAX_PUBLISHES_PER_MINUTE = 120
const MAX_WAITS = 8
const positionSchema = z.tuple([z.string(), z.uuid(), z.string().nullable(), z.string().regex(/^(0|[1-9]\d{0,18})$/)])
type Position = z.infer<typeof positionSchema>

function pathId(path: string): string {
  return createHash('sha256').update(path).digest('base64url')
}

function cursor(topic: string, generation: string, type: string | undefined, sequence: string): string {
  return Buffer.from(JSON.stringify([topic, generation, type ?? null, sequence])).toString('base64url')
}

function position(after: string, topic: string, type?: string): Position {
  try {
    const parsed = positionSchema.parse(JSON.parse(Buffer.from(after, 'base64url').toString('utf8')))
    if (parsed[0] === topic && parsed[2] === (type ?? null)) return parsed
  } catch { /* Invalid cursors share one error. */ }
  throw new TBError('invalid_argument', 'invalid cursor for this topic and type filter')
}

/** Registry mutations and topic generations change in the same database transaction. */
export class PgEventRepository implements EventRepository {
  private readonly watchers = new Map<string, Set<() => void>>()
  private listener?: ListenMeta
  constructor(private readonly sql: Sql) {}

  async ensureSchema(): Promise<void> {
    await this.sql.begin(async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext('tb_event_schema'))`
      await sql`CREATE TABLE IF NOT EXISTS tb_event_topics (
        node_key text PRIMARY KEY REFERENCES tb_kv(key) ON DELETE CASCADE,
        binding jsonb, generation uuid UNIQUE NOT NULL DEFAULT gen_random_uuid(), head bigint NOT NULL DEFAULT 0)`
      await sql`CREATE TABLE IF NOT EXISTS tb_event_records (
        generation uuid NOT NULL REFERENCES tb_event_topics(generation) ON DELETE CASCADE,
        seq bigint NOT NULL, id uuid NOT NULL, source text NOT NULL, body jsonb NOT NULL,
        recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(generation,seq))`
      await sql`CREATE INDEX IF NOT EXISTS tb_event_record_time ON tb_event_records(recorded_at)`
      await sql`CREATE TABLE IF NOT EXISTS tb_event_receipts (
        generation uuid NOT NULL REFERENCES tb_event_topics(generation) ON DELETE CASCADE,
        actor text NOT NULL, key text NOT NULL, digest bytea NOT NULL, id uuid NOT NULL, seq bigint NOT NULL,
        expires_at timestamptz NOT NULL, PRIMARY KEY(generation,actor,key))`
      await sql`CREATE INDEX IF NOT EXISTS tb_event_topic_receipt_expiry ON tb_event_receipts(generation,expires_at)`
      await sql`CREATE INDEX IF NOT EXISTS tb_event_receipt_expiry ON tb_event_receipts(expires_at)`
      await sql`CREATE TABLE IF NOT EXISTS tb_event_rates (
        actor text PRIMARY KEY, window_start timestamptz NOT NULL, used integer NOT NULL)`
      await sql`CREATE TABLE IF NOT EXISTS tb_event_waits (
        id uuid PRIMARY KEY, actor text NOT NULL, expires_at timestamptz NOT NULL)`
      await sql`CREATE INDEX IF NOT EXISTS tb_event_wait_actor ON tb_event_waits(actor,expires_at)`
      await sql`CREATE OR REPLACE FUNCTION tb_sync_event_topic() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF TG_OP='UPDATE' AND (OLD.value->>'kind'='topic') IS DISTINCT FROM (NEW.value->>'kind'='topic') THEN
            RAISE EXCEPTION 'topic binding conflicts with occupied path' USING ERRCODE='TB409';
          END IF;
          IF NEW.value->>'kind' = 'topic' THEN
            IF TG_OP='UPDATE' AND OLD.value ? 'config' AND NOT NEW.value ? 'config' THEN
              RAISE EXCEPTION 'remove the bound topic before creating a user topic' USING ERRCODE='TB409';
            END IF;
            DELETE FROM tb_event_topics WHERE node_key=NEW.key AND binding IS DISTINCT FROM NEW.value->'config';
            INSERT INTO tb_event_topics(node_key,binding) VALUES(NEW.key,NEW.value->'config') ON CONFLICT DO NOTHING;
          ELSE
            DELETE FROM tb_event_topics WHERE node_key=NEW.key;
          END IF;
          RETURN NEW;
        END $$`
      await sql`CREATE OR REPLACE TRIGGER tb_event_registry AFTER INSERT OR UPDATE OF value ON tb_kv
        FOR EACH ROW WHEN (left(NEW.key,5)='node:') EXECUTE FUNCTION tb_sync_event_topic()`
      await sql`INSERT INTO tb_event_topics(node_key,binding) SELECT key,value->'config' FROM tb_kv
        WHERE left(key,5)='node:' AND value->>'kind'='topic' ON CONFLICT DO NOTHING`
    })
    this.listener ??= await this.sql.listen(CHANNEL, (topic) => {
      for (const wake of this.watchers.get(topic) ?? []) wake()
    })
  }

  watch(path: string, wake: () => void): () => void {
    const topic = pathId(path)
    const listeners = this.watchers.get(topic) ?? new Set<() => void>()
    listeners.add(wake)
    this.watchers.set(topic, listeners)
    return () => {
      listeners.delete(wake)
      if (!listeners.size) this.watchers.delete(topic)
    }
  }

  async close(): Promise<void> {
    await this.listener?.unlisten()
    this.listener = undefined
  }

  async cleanup(): Promise<void> {
    await this.sql`DELETE FROM tb_event_records WHERE recorded_at <= now() - interval '24 hours'`
    await this.sql`DELETE FROM tb_event_receipts WHERE expires_at <= now()`
    await this.sql`DELETE FROM tb_event_waits WHERE expires_at <= now()`
    await this.sql`DELETE FROM tb_event_rates WHERE window_start < now() - interval '1 minute'`
  }

  async acquireWait(keyId: string): Promise<() => Promise<void>> {
    const id = randomUUID()
    await this.sql.begin(async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext('tb_event_waits'),hashtext(${keyId}))`
      const added = await sql`INSERT INTO tb_event_waits(id,actor,expires_at)
        SELECT ${id},${keyId},clock_timestamp()+interval '35 seconds'
        WHERE (SELECT count(*) FROM tb_event_waits WHERE actor=${keyId} AND expires_at>clock_timestamp()) < ${MAX_WAITS}
        RETURNING id`
      if (!added.length) throw new TBError('rate_limited', 'too many concurrent event reads', { retryable: true })
    })
    return async () => {
      await this.sql`DELETE FROM tb_event_waits WHERE id=${id}`
    }
  }

  async binding(path: string): Promise<EventTopicBinding | null> {
    const [row] = await this.sql<{ binding: unknown, generation: string }[]>`SELECT generation,binding FROM tb_event_topics WHERE node_key=${KEY_NODE + path}`
    if (!row) return null
    const parsed = bindingSchema.safeParse(row.binding)
    if (!parsed.success) return null
    const { authRef, provider, export: exportId } = parsed.data
    return { generation: row.generation, provider, export: exportId, authRef }
  }

  async publish(path: string, actor: { keyId: string, owner: string }, input: EventPublishInput, expectedBinding?: EventTopicBinding): Promise<EventReceipt> {
    // Webhook ingress calls this boundary directly after signature verification.
    const parsed = eventPublishSchema.safeParse(input)
    if (!parsed.success) throw new TBError('invalid_argument', 'invalid event publish input')
    const { idempotencyKey, ...fields } = parsed.data
    const body = { ...fields, schemaVersion: fields.schemaVersion ?? 1 }
    const serialized = JSON.stringify(body)
    if (Buffer.byteLength(serialized) > EVENT_MAX_BYTES) throw new TBError('invalid_argument', 'event exceeds 16 KiB')
    const topic = pathId(path)
    return this.sql.begin(async (sql) => {
      const [row] = await sql<{ binding: unknown, generation: string }[]>`SELECT generation,binding FROM tb_event_topics
        WHERE node_key=${KEY_NODE + path} FOR UPDATE`
      if (!row) throw TBError.notFound()
      const { generation } = row
      if (expectedBinding) {
        const bound = bindingSchema.safeParse(row.binding)
        if (!bound.success || generation !== expectedBinding.generation || bound.data.provider !== expectedBinding.provider
          || bound.data.export !== expectedBinding.export || bound.data.authRef !== expectedBinding.authRef) {
          throw new TBError('conflict', 'event source binding has changed')
        }
      } else if (row.binding !== null) {
        throw new TBError('permission_denied', 'this topic only accepts events from its bound source')
      }
      const rate = await sql`INSERT INTO tb_event_rates(actor,window_start,used)
        VALUES(${actor.keyId},date_trunc('minute',clock_timestamp()),1) ON CONFLICT(actor) DO UPDATE
        SET used=CASE WHEN tb_event_rates.window_start=excluded.window_start THEN tb_event_rates.used+1 ELSE 1 END,
          window_start=excluded.window_start
        WHERE tb_event_rates.window_start<>excluded.window_start OR tb_event_rates.used<${MAX_PUBLISHES_PER_MINUTE}
        RETURNING used`
      if (!rate.length) throw new TBError('rate_limited', 'event publish rate exceeded', { retryable: true })
      // jsonb canonicalizes object keys before hashing. The separate receipt outlives count-based pruning.
      const digest = sql`sha256(convert_to((${sql.json(body)}::jsonb)::text,'UTF8'))`
      if (idempotencyKey !== undefined) {
        const [prior] = await sql<{ id: string, matches: boolean, seq: string }[]>`SELECT id,seq::text,digest=${digest} AS matches
          FROM tb_event_receipts WHERE generation=${generation} AND actor=${actor.keyId}
          AND key=${idempotencyKey} AND expires_at>clock_timestamp()`
        if (prior) {
          if (!prior.matches) throw new TBError('conflict', 'idempotency key already used with different event content')
          return { id: prior.id, cursor: cursor(topic, generation, undefined, prior.seq) }
        }
        const full = await sql`SELECT 1 FROM tb_event_receipts WHERE generation=${generation}
          AND expires_at>clock_timestamp() LIMIT 1 OFFSET ${MAX_RECEIPTS - 1}`
        if (full.length) throw new TBError('rate_limited', 'topic idempotency receipt capacity reached', { retryable: true })
      }
      const [next] = await sql<{ seq: string }[]>`UPDATE tb_event_topics SET head=head+1
        WHERE generation=${generation} RETURNING head::text AS seq`
      const seq = next!.seq
      const id = randomUUID()
      await sql`INSERT INTO tb_event_records(generation,seq,id,source,body)
        VALUES(${generation},${seq},${id},${actor.owner},${sql.json(body)})`
      if (idempotencyKey !== undefined) {
        await sql`INSERT INTO tb_event_receipts(generation,actor,key,digest,id,seq,expires_at)
          VALUES(${generation},${actor.keyId},${idempotencyKey},${digest},${id},${seq},clock_timestamp()+interval '24 hours')
          ON CONFLICT(generation,actor,key) DO UPDATE SET digest=excluded.digest,id=excluded.id,seq=excluded.seq,expires_at=excluded.expires_at`
      }
      await sql`DELETE FROM tb_event_records WHERE generation=${generation} AND seq<=${seq}::bigint-${MAX_RECORDS}`
      await sql`SELECT pg_notify(${CHANNEL},${topic})`
      return { id, cursor: cursor(topic, generation, undefined, seq) }
    }).catch((error: unknown) => {
      // PostgreSQL jsonb cannot represent NUL or unpaired UTF-16 surrogates.
      if (['22P02', '22P05', '22021'].includes((error as { code?: string }).code ?? '')) {
        throw new TBError('invalid_argument', 'event contains an unsupported Unicode value')
      }
      throw error
    })
  }

  async read(path: string, input: EventReadInput): Promise<EventReadResult> {
    if (!eventReadSchema.safeParse(input).success) throw new TBError('invalid_argument', 'invalid event read input')
    const topic = pathId(path)
    const old = input.after === undefined ? undefined : position(input.after, topic, input.type)
    const limit = input.limit ?? 50
    return this.sql.begin('isolation level repeatable read read only', async (sql) => {
      const [row] = await sql<{ floor: string, generation: string, head: string }[]>`
        SELECT generation,head::text,COALESCE((SELECT min(seq)-1 FROM tb_event_records r
          WHERE r.generation=t.generation AND recorded_at>now()-interval '24 hours'),head)::text AS floor
        FROM tb_event_topics t WHERE node_key=${KEY_NODE + path}`
      if (!row) throw TBError.notFound()
      const at = (seq: string) => cursor(topic, row.generation, input.type, seq)
      if (old && (old[1] !== row.generation || BigInt(old[3]) < BigInt(row.floor))) {
        const earliestCursor = at(row.floor)
        return { events: [], nextCursor: earliestCursor, timedOut: false,
          gap: { reason: old[1] !== row.generation ? 'generation' as const : 'retention' as const, earliestCursor } }
      }
      const seq = old?.[3] ?? row.head
      if (BigInt(seq) > BigInt(row.head)) throw new TBError('invalid_argument', 'cursor exceeds topic head')
      const rows = await sql<{ body: Pick<EventEnvelope, 'type' | 'subject' | 'data' | 'schemaVersion'>, id: string, recorded_at: Date, seq: string, source: string }[]>`
        SELECT id,seq,source,recorded_at,body FROM tb_event_records
        WHERE generation=${row.generation} AND seq>${seq} AND recorded_at>now()-interval '24 hours'
        ${input.type === undefined ? sql`` : sql`AND body->>'type'=${input.type}`}
        ORDER BY seq LIMIT ${limit}`
      const events = rows.map(r => ({ ...r.body, id: r.id, source: r.source, recordedAt: r.recorded_at.toISOString(), cursor: at(String(r.seq)) }))
      return { events, nextCursor: events.length === limit ? events[events.length - 1]!.cursor : at(row.head), timedOut: false }
    })
  }
}
