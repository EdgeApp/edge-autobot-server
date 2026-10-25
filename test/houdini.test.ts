import { expect } from 'chai'
import { asObject, asString } from 'cleaners'
import { afterEach, beforeEach, describe, it } from 'mocha'
import type nano from 'nano'

import { config } from '../src/config'
import { getConfirmTxUrl } from '../src/server/bots/houdini/confirmService'
import {
  createHoudiniDoc,
  saveHoudiniResult,
  writeHoudiniDoc
} from '../src/server/bots/houdini/databaseService'
import {
  answerHoudiniReport,
  attemptConfirm,
  isAttemptDue,
  processHoudiniOrders
} from '../src/server/bots/houdini/houdiniBot'
import {
  asHoudiniSubmission,
  type HoudiniDoc
} from '../src/server/bots/houdini/types'
import type { LogFunction } from '../src/server/types'

const ORDER_ID = '3UJocbNVFMn4wZ4b48tdUq'
const OTHER_ORDER_ID = 'kQ7vT2nWb9XyZ4LmPq8RsA'
const TX_HASH = `0x${'ab'.repeat(32)}`
const OTHER_TX_HASH = `0x${'cd'.repeat(32)}`

interface MemoryDb {
  db: nano.DocumentScope<HoudiniDoc>
  stored: (id: string) => HoudiniDoc | undefined
  // Writes to these doc ids fail with a 500, as a CouchDB outage would.
  failingIds: Set<string>
}

/**
 * Holds docs in a map with CouchDB's revision rule: a write must carry the
 * stored revision (none for a new doc) or it fails with a 409.
 */
const makeMemoryDb = (): MemoryDb => {
  const docs = new Map<string, HoudiniDoc>()
  const failingIds = new Set<string>()
  let revCount = 0
  const fail = (statusCode: number): Error =>
    Object.assign(new Error(`status ${statusCode}`), { statusCode })

  const fake = {
    insert: async (document: HoudiniDoc) => {
      if (failingIds.has(document._id)) throw fail(500)
      if (docs.get(document._id)?._rev !== document._rev) throw fail(409)
      const rev = `${++revCount}-memory`
      docs.set(document._id, { ...document, _rev: rev })
      return { ok: true, id: document._id, rev }
    },
    get: async (id: string) => {
      const document = docs.get(id)
      if (document == null) throw fail(404)
      return { ...document }
    },
    find: async (query: { selector: { status: string } }) => ({
      docs: Array.from(docs.values()).filter(
        document => document.status === query.selector.status
      ),
      bookmark: undefined
    })
  }
  return {
    // The fake covers only the three methods the bot calls:
    db: fake as unknown as nano.DocumentScope<HoudiniDoc>,
    stored: id => docs.get(id),
    failingIds
  }
}

interface LogLine {
  level: 'info' | 'warn' | 'error'
  text: string
}

/** A log that records each line with its level, for assertions. */
const makeLog = (): { log: LogFunction; lines: LogLine[] } => {
  const lines: LogLine[] = []
  const at =
    (level: LogLine['level']) =>
    (...args: unknown[]): void => {
      lines.push({ level, text: args.map(arg => String(arg)).join(' ') })
    }
  return {
    log: Object.assign(at('info'), { warn: at('warn'), error: at('error') }),
    lines
  }
}

const realFetch = globalThis.fetch
let fetchedIds: string[] = []
let fetchUrls: string[] = []

/** Answers every request with `status`, recording the URL and order id. */
const stubFetch = (status: number): void => {
  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    fetchUrls.push(input instanceof Request ? input.url : input.toString())
    // The bot sends a JSON string body with the order id under `id`:
    const { id } = asObject({ id: asString })(
      JSON.parse(typeof init?.body === 'string' ? init.body : '{}')
    )
    fetchedIds.push(id)
    return new Response(status === 200 ? '{}' : 'nope', { status })
  }
}

describe('houdini bot', function () {
  const realConfig = { ...config, enablePlugins: { ...config.enablePlugins } }

  beforeEach(function () {
    fetchedIds = []
    fetchUrls = []
    config.houdiniApiUrl = 'https://api-partner.houdiniswap.com/v2/'
    config.houdiniApiKey = 'key'
    config.houdiniApiSecret = 'secret'
    config.enablePlugins = { ...realConfig.enablePlugins, houdini: true }
  })
  afterEach(function () {
    globalThis.fetch = realFetch
    Object.assign(config, realConfig)
  })

  describe('answering a report', function () {
    const report = { orderId: ORDER_ID, txHash: TX_HASH }

    const offCases: Array<[string, () => void]> = [
      [
        'houdini is not enabled',
        () => {
          config.enablePlugins = { ...config.enablePlugins, houdini: false }
        }
      ],
      [
        'enablePlugins predates houdini',
        () => {
          config.enablePlugins = {}
        }
      ],
      [
        'the secret is empty',
        () => {
          config.houdiniApiSecret = ''
        }
      ]
    ]
    for (const [name, turnOff] of offCases) {
      it(`answers 503 without opening the db when ${name}`, async function () {
        turnOff()
        const { log } = makeLog()
        let opened = false
        const answer = await answerHoudiniReport(
          () => {
            opened = true
            return makeMemoryDb().db
          },
          report,
          log
        )
        expect(answer.status).equals(503)
        expect(opened).equals(false)
      })
    }

    it('stores a new report for the engine without calling Houdini', async function () {
      const { db, stored } = makeMemoryDb()
      const { log } = makeLog()
      stubFetch(200)

      const answer = await answerHoudiniReport(() => db, report, log)
      expect(answer).deep.equals({ status: 200 })
      expect(stored(ORDER_ID)).includes({
        txHash: TX_HASH,
        status: 'pending',
        attempts: 0
      })
      expect(fetchUrls).deep.equals([])
    })

    it('answers 400 to a malformed report and stores nothing', async function () {
      const { db, stored } = makeMemoryDb()
      const { log, lines } = makeLog()

      const answer = await answerHoudiniReport(
        () => db,
        { orderId: ORDER_ID },
        log
      )
      expect(answer.status).equals(400)
      expect(stored(ORDER_ID)).equals(undefined)
      expect(lines.map(line => line.level)).deep.equals(['warn'])
    })

    it('answers 200 to a repeat with the same hash in another case', async function () {
      const { db, stored } = makeMemoryDb()
      const { log, lines } = makeLog()
      await answerHoudiniReport(() => db, report, log)

      const answer = await answerHoudiniReport(
        () => db,
        { orderId: ORDER_ID, txHash: `0x${'AB'.repeat(32)}` },
        log
      )
      expect(answer).deep.equals({ status: 200 })
      expect(stored(ORDER_ID)?.txHash).equals(TX_HASH)
      expect(lines).deep.equals([])
    })

    it('answers 409 to a repeat with another tx and logs both hashes', async function () {
      const { db, stored } = makeMemoryDb()
      const { log, lines } = makeLog()
      await answerHoudiniReport(() => db, report, log)

      const answer = await answerHoudiniReport(
        () => db,
        { orderId: ORDER_ID, txHash: OTHER_TX_HASH },
        log
      )
      expect(answer.status).equals(409)
      expect(stored(ORDER_ID)?.txHash).equals(TX_HASH)
      expect(lines.length).equals(1)
      expect(lines[0].level).equals('warn')
      expect(lines[0].text)
        .includes(ORDER_ID)
        .and.includes(TX_HASH)
        .and.includes(OTHER_TX_HASH)
    })

    it('answers 500 when the insert fails and logs the order and tx', async function () {
      const { db, failingIds } = makeMemoryDb()
      const { log, lines } = makeLog()
      failingIds.add(ORDER_ID)

      const answer = await answerHoudiniReport(() => db, report, log)
      expect(answer.status).equals(500)
      expect(lines.length).equals(1)
      expect(lines[0].level).equals('error')
      expect(lines[0].text).includes(ORDER_ID).and.includes(TX_HASH)
    })
  })

  describe('running the engine', function () {
    it('attempts only the pending reports that are due', async function () {
      const { db, stored } = makeMemoryDb()
      const { log } = makeLog()
      const now = Date.now()
      // Due: a new report.
      await createHoudiniDoc(db, { orderId: ORDER_ID, txHash: TX_HASH })
      // Not due: attempted a second ago.
      const recent = await createHoudiniDoc(db, {
        orderId: OTHER_ORDER_ID,
        txHash: OTHER_TX_HASH
      })
      await writeHoudiniDoc(db, {
        ...recent,
        attempts: 1,
        lastAttemptAt: new Date(now - 1000).toISOString()
      })
      // Not pending: already confirmed.
      const done = await createHoudiniDoc(db, {
        orderId: ORDER_ID.toLowerCase(),
        txHash: TX_HASH
      })
      await writeHoudiniDoc(db, { ...done, status: 'confirmed' })
      stubFetch(200)

      await processHoudiniOrders(db, log, now)
      expect(fetchedIds).deep.equals([ORDER_ID])
      expect(stored(ORDER_ID)).includes({ status: 'confirmed', attempts: 1 })
      expect(stored(OTHER_ORDER_ID)).includes({
        status: 'pending',
        attempts: 1
      })
    })

    it('logs a failing order and goes on to the next', async function () {
      const { db, stored, failingIds } = makeMemoryDb()
      const { log, lines } = makeLog()
      await createHoudiniDoc(db, { orderId: ORDER_ID, txHash: TX_HASH })
      await createHoudiniDoc(db, {
        orderId: OTHER_ORDER_ID,
        txHash: OTHER_TX_HASH
      })
      failingIds.add(ORDER_ID)
      stubFetch(200)

      await processHoudiniOrders(db, log, Date.now())
      expect(stored(OTHER_ORDER_ID)?.status).equals('confirmed')
      const errors = lines.filter(line => line.level === 'error')
      expect(errors.length).equals(1)
      expect(errors[0].text).includes(ORDER_ID).and.includes(TX_HASH)
    })
  })

  describe('saving an attempt', function () {
    it('drops a late failure over a confirmed doc', async function () {
      const { db, stored } = makeMemoryDb()
      const created = await createHoudiniDoc(db, {
        orderId: ORDER_ID,
        txHash: TX_HASH
      })
      const claimed = await writeHoudiniDoc(db, { ...created, attempts: 1 })
      if (claimed == null) throw new Error('claim failed')
      await writeHoudiniDoc(db, { ...claimed, status: 'confirmed' })

      const saved = await saveHoudiniResult(db, {
        ...claimed,
        status: 'pending',
        lastError: '503 down'
      })
      expect(saved).equals(false)
      expect(stored(ORDER_ID)?.status).equals('confirmed')
    })

    it('keeps a late confirmation over a pending doc', async function () {
      const { db, stored } = makeMemoryDb()
      const created = await createHoudiniDoc(db, {
        orderId: ORDER_ID,
        txHash: TX_HASH
      })
      const claimed = await writeHoudiniDoc(db, { ...created, attempts: 1 })
      if (claimed == null) throw new Error('claim failed')
      await writeHoudiniDoc(db, { ...claimed, attempts: 2 })

      const saved = await saveHoudiniResult(db, {
        ...claimed,
        status: 'confirmed',
        confirmedAt: '2026-11-16T00:00:00.000Z'
      })
      expect(saved).equals(true)
      expect(stored(ORDER_ID)).includes({
        status: 'confirmed',
        attempts: 2,
        confirmedAt: '2026-11-16T00:00:00.000Z'
      })
    })
  })

  describe('attempting a report', function () {
    it('skips an order claimed from a stale revision', async function () {
      const { db, stored } = makeMemoryDb()
      const stale = await createHoudiniDoc(db, {
        orderId: ORDER_ID,
        txHash: TX_HASH
      })
      await writeHoudiniDoc(db, { ...stale, attempts: 1 })
      stubFetch(200)

      await attemptConfirm(db, stale, makeLog().log)
      expect(fetchUrls).deep.equals([])
      expect(stored(ORDER_ID)).includes({ status: 'pending', attempts: 1 })
    })

    // Each outcome with the level of the line it logs. Every line names the
    // order id and tx hash, the pair a manual report needs.
    const outcomes: Array<[number, HoudiniDoc['status'], LogLine['level']]> = [
      [200, 'confirmed', 'info'],
      [400, 'rejected', 'warn'],
      [401, 'pending', 'error'],
      [402, 'pending', 'error'],
      [403, 'pending', 'error'],
      [404, 'notFound', 'warn'],
      [429, 'pending', 'warn'],
      [500, 'pending', 'warn'],
      [503, 'pending', 'warn']
    ]
    for (const [status, expected, level] of outcomes) {
      it(`stores ${expected} for a ${status} answer`, async function () {
        const { db, stored } = makeMemoryDb()
        const { log, lines } = makeLog()
        const created = await createHoudiniDoc(db, {
          orderId: ORDER_ID,
          txHash: TX_HASH
        })
        stubFetch(status)

        await attemptConfirm(db, created, log)
        expect(fetchUrls.length).equals(1)
        expect(stored(ORDER_ID)).includes({ status: expected, attempts: 1 })
        expect(lines.length).equals(1)
        expect(lines[0].level).equals(level)
        expect(lines[0].text).includes(ORDER_ID).and.includes(TX_HASH)
      })
    }

    it('leaves the doc pending on a network error', async function () {
      const { db, stored } = makeMemoryDb()
      const created = await createHoudiniDoc(db, {
        orderId: ORDER_ID,
        txHash: TX_HASH
      })
      const { log, lines } = makeLog()
      globalThis.fetch = async () => {
        throw new Error('socket hang up')
      }

      await attemptConfirm(db, created, log)
      expect(stored(ORDER_ID)).includes({
        status: 'pending',
        lastError: 'socket hang up'
      })
      expect(lines.length).equals(1)
      expect(lines[0].level).equals('warn')
      expect(lines[0].text).includes(ORDER_ID).and.includes(TX_HASH)
    })
  })

  describe('confirm url', function () {
    it('keeps the version segment of a base without a trailing slash', function () {
      config.houdiniApiUrl = 'https://api-partner.houdiniswap.com/v2'
      expect(getConfirmTxUrl().toString()).equals(
        'https://api-partner.houdiniswap.com/v2/dex/confirmTx'
      )
    })
  })

  describe('retry spacing', function () {
    const at = (attempts: number, lastAttemptAt?: string): HoudiniDoc => ({
      _id: ORDER_ID,
      _rev: undefined,
      orderId: ORDER_ID,
      txHash: TX_HASH,
      status: 'pending',
      attempts,
      createdAt: '2026-11-16T00:00:00.000Z',
      lastAttemptAt,
      lastError: undefined,
      confirmedAt: undefined
    })
    const start = Date.parse('2026-11-16T00:00:00.000Z')
    const last = '2026-11-16T00:00:00.000Z'

    it('makes the first attempt at once', function () {
      expect(isAttemptDue(at(0), start)).equals(true)
    })

    it('doubles the spacing with each attempt', function () {
      expect(isAttemptDue(at(1, last), start + 29_000)).equals(false)
      expect(isAttemptDue(at(1, last), start + 30_000)).equals(true)
      expect(isAttemptDue(at(2, last), start + 59_000)).equals(false)
      expect(isAttemptDue(at(2, last), start + 60_000)).equals(true)
      expect(isAttemptDue(at(4, last), start + 239_000)).equals(false)
      expect(isAttemptDue(at(4, last), start + 240_000)).equals(true)
    })

    it('caps the spacing at an hour', function () {
      expect(isAttemptDue(at(30, last), start + 3_599_000)).equals(false)
      expect(isAttemptDue(at(30, last), start + 3_600_000)).equals(true)
    })
  })

  describe('report shape', function () {
    it('takes a Houdini order id and an EVM tx hash', function () {
      expect(
        asHoudiniSubmission({ orderId: ORDER_ID, txHash: TX_HASH })
      ).deep.equals({ orderId: ORDER_ID, txHash: TX_HASH })
    })

    const bad: Array<[string, unknown]> = [
      [
        'a reserved doc id',
        { orderId: '_design/houdini-indexes', txHash: TX_HASH }
      ],
      [
        'a 21-character order id',
        { orderId: ORDER_ID.slice(1), txHash: TX_HASH }
      ],
      ['a 23-character order id', { orderId: `${ORDER_ID}x`, txHash: TX_HASH }],
      [
        'an order id with a hyphen',
        { orderId: `${ORDER_ID.slice(1)}-`, txHash: TX_HASH }
      ],
      ['a hash without 0x', { orderId: ORDER_ID, txHash: 'ab'.repeat(32) }],
      ['a short hash', { orderId: ORDER_ID, txHash: '0xabc' }]
    ]
    for (const [name, body] of bad) {
      it(`refuses ${name}`, function () {
        expect(() => asHoudiniSubmission(body)).throws(TypeError)
      })
    }
  })
})
