import { describe, expect, it } from 'vitest'
import { createPidDeviceKey, LogStore } from './logStore'

const lines = [
  '07-23 16:24:57.485  1619  2231 D DemoTag: debug message',
  '07-23 16:24:57.486  1619  2231 I DemoTag: info message',
  '07-23 16:24:57.487  1619  2231 E CrashTag: FATAL EXCEPTION: main',
  'raw line without threadtime shape',
]

describe('LogStore', () => {
  it('stores parsed logs in append order', () => {
    const store = new LogStore({ capacity: 10, displayLimit: 10 })

    store.appendRawBatch({ sessionId: 's1', lines })

    const snapshot = store.getSnapshot()
    expect(snapshot.totalCount).toBe(4)
    expect(snapshot.filteredCount).toBe(4)
    expect(snapshot.visibleEntries.map((entry) => entry.sequence)).toEqual([1, 2, 3, 4])
    expect(snapshot.visibleEntries[0]).toMatchObject({
      level: 'D',
      tag: 'DemoTag',
      message: 'debug message',
    })
    expect(snapshot.tagOptions).toEqual(['CrashTag', 'DemoTag'])
    expect(snapshot.visibleEntries[2]?.isCrash).toBe(true)
  })

  it('evicts oldest logs with a fixed capacity ring buffer', () => {
    const store = new LogStore({ capacity: 3, displayLimit: 10 })

    store.appendRawBatch({ sessionId: 's1', lines })

    const snapshot = store.getSnapshot()
    expect(snapshot.totalCount).toBe(3)
    expect(snapshot.droppedCount).toBe(1)
    expect(snapshot.visibleEntries.map((entry) => entry.sequence)).toEqual([2, 3, 4])
  })

  it('reads a stable visible window by filtered index', () => {
    const store = new LogStore({ capacity: 10, displayLimit: 3 })

    store.appendRawBatch({ sessionId: 's1', lines })
    expect(store.getVisibleEntriesWindow(0).map((entry) => entry.sequence)).toEqual([1, 2, 3])

    store.appendRawBatch({ sessionId: 's1', lines: lines.slice(0, 1) })
    expect(store.getVisibleEntriesWindow(0).map((entry) => entry.sequence)).toEqual([1, 2, 3])
    expect(store.getVisibleEntriesWindow(2).map((entry) => entry.sequence)).toEqual([3, 4, 5])
  })

  it('maintains an incremental filtered sequence list for active filters', () => {
    const store = new LogStore({ capacity: 10, displayLimit: 10 })

    store.setFilter({ level: 'E', query: 'fatal' })
    store.appendRawBatch({ sessionId: 's1', lines: lines.slice(0, 2) })
    expect(store.getSnapshot().filteredCount).toBe(0)

    store.appendRawBatch({ sessionId: 's1', lines: lines.slice(2) })
    const snapshot = store.getSnapshot()
    expect(snapshot.filteredCount).toBe(1)
    expect(snapshot.visibleEntries[0]?.tag).toBe('CrashTag')
  })

  it('rebuilds filtered sequences when filters change', () => {
    const store = new LogStore({ capacity: 10, displayLimit: 10 })

    store.appendRawBatch({ sessionId: 's1', lines })
    store.setFilter({ level: 'D', query: 'demo' })
    expect(store.getSnapshot().visibleEntries.map((entry) => entry.level)).toEqual(['D'])

    store.setFilter({ level: 'all', query: 'message' })
    expect(store.getSnapshot().visibleEntries.map((entry) => entry.level)).toEqual(['D', 'I'])
  })

  it('exports only the current filtered result', () => {
    const store = new LogStore({ capacity: 10, displayLimit: 10 })

    store.appendRawBatch({ sessionId: 's1', lines })
    store.setFilter({ level: 'E', query: 'fatal' })

    expect(store.getExportContent()).toBe(`${lines[2]}\n`)
  })

  it('queries indexed fields before applying text filters', () => {
    const store = new LogStore({ capacity: 10, displayLimit: 10 })

    store.appendRawBatch({
      sessionId: 'session-a',
      deviceSerial: 'device-a',
      lines: lines.slice(0, 2),
    })
    store.appendRawBatch({
      sessionId: 'session-b',
      deviceSerial: 'device-b',
      lines: lines.slice(2),
    })

    store.setQuery({
      tags: ['crashtag'],
      pids: ['1619'],
      sessions: ['SESSION-B'],
      devices: ['DEVICE-B'],
      crashOnly: true,
      includeText: 'fatal',
    })

    const snapshot = store.getSnapshot()
    expect(snapshot.filteredCount).toBe(1)
    expect(snapshot.visibleEntries[0]).toMatchObject({
      sessionId: 'session-b',
      deviceSerial: 'device-b',
      tag: 'CrashTag',
      isCrash: true,
    })
  })

  it('filters by exact device and pid pairs', () => {
    const store = new LogStore({ capacity: 10, displayLimit: 10 })
    const sharedPidLines = [
      '07-23 16:24:57.485  1619  2231 D DemoTag: device a message',
      '07-23 16:24:57.486  1619  2231 D DemoTag: device b message',
    ]

    store.appendRawBatch({
      sessionId: 'session-a',
      deviceSerial: 'device-a',
      lines: [sharedPidLines[0]],
    })
    store.appendRawBatch({
      sessionId: 'session-b',
      deviceSerial: 'device-b',
      lines: [sharedPidLines[1]],
    })

    store.setQuery({
      pidDeviceKeys: [createPidDeviceKey('DEVICE-B', '1619')],
    })

    const snapshot = store.getSnapshot()
    expect(snapshot.filteredCount).toBe(1)
    expect(snapshot.visibleEntries[0]).toMatchObject({
      deviceSerial: 'device-b',
      message: 'device b message',
    })
  })

  it('supports exclude text and time ranges in queries', () => {
    const store = new LogStore({ capacity: 10, displayLimit: 10 })

    store.appendRawBatch({ sessionId: 's1', lines })
    const infoEntry = store.getSnapshot().visibleEntries[1]
    expect(infoEntry?.timestampEpochMs).toBeTypeOf('number')

    store.setQuery({
      includeText: 'message',
      excludeText: 'debug',
      startEpochMs: infoEntry.timestampEpochMs,
    })

    expect(store.getSnapshot().visibleEntries.map((entry) => entry.level)).toEqual(['I'])
  })

  it('supports match case, whole word, and regex search filters', () => {
    const store = new LogStore({ capacity: 10, displayLimit: 10 })

    store.appendRawBatch({ sessionId: 's1', lines })

    store.setQuery({
      includeText: 'fatal',
      searchOptions: { matchCase: true },
    })
    expect(store.getSnapshot().filteredCount).toBe(0)

    store.setQuery({
      includeText: 'FATAL',
      searchOptions: { matchCase: true },
    })
    expect(store.getSnapshot().visibleEntries.map((entry) => entry.tag)).toEqual(['CrashTag'])

    store.setQuery({
      includeText: 'mess',
      searchOptions: { wholeWords: true },
    })
    expect(store.getSnapshot().filteredCount).toBe(0)

    store.setQuery({
      includeText: 'message',
      searchOptions: { wholeWords: true },
    })
    expect(store.getSnapshot().visibleEntries.map((entry) => entry.level)).toEqual(['D', 'I'])

    store.setQuery({
      includeText: 'debug|info',
      searchOptions: { regex: true },
    })
    expect(store.getSnapshot().visibleEntries.map((entry) => entry.level)).toEqual(['D', 'I'])
  })

  it('returns no search results for invalid regex filters', () => {
    const store = new LogStore({ capacity: 10, displayLimit: 10 })

    store.appendRawBatch({ sessionId: 's1', lines })
    store.setQuery({
      includeText: '[',
      searchOptions: { regex: true },
    })

    expect(store.getSnapshot().filteredCount).toBe(0)
  })

  it('does not return stale indexed entries after capacity eviction', () => {
    const store = new LogStore({ capacity: 2, displayLimit: 10 })

    store.appendRawBatch({ sessionId: 's1', lines: lines.slice(0, 2) })
    store.appendRawBatch({ sessionId: 's1', lines: lines.slice(2, 4) })
    store.setQuery({ tags: ['demotag'] })

    const snapshot = store.getSnapshot()
    expect(snapshot.totalCount).toBe(2)
    expect(snapshot.droppedCount).toBe(2)
    expect(snapshot.filteredCount).toBe(0)
  })

  it('ignores invalid time range values', () => {
    const store = new LogStore({ capacity: 10, displayLimit: 10 })

    store.appendRawBatch({ sessionId: 's1', lines })
    store.setQuery({ startEpochMs: Number.NaN, endEpochMs: Number.POSITIVE_INFINITY })

    expect(store.getSnapshot().filteredCount).toBe(4)
  })

  it('returns a stable snapshot object until data or filters change', () => {
    const store = new LogStore({ capacity: 10, displayLimit: 10 })

    store.appendRawBatch({ sessionId: 's1', lines: lines.slice(0, 1) })
    const first = store.getSnapshot()
    const second = store.getSnapshot()
    expect(second).toBe(first)

    store.appendRawBatch({ sessionId: 's1', lines: lines.slice(1, 2) })
    expect(store.getSnapshot()).not.toBe(first)
  })

  it('exports and hydrates transfer entries with rebuilt indexes', () => {
    const source = new LogStore({ capacity: 10, displayLimit: 10 })
    source.appendRawBatch({
      sessionId: 'session-a',
      deviceSerial: 'device-a',
      lines,
    })

    const target = new LogStore({ capacity: 3, displayLimit: 10 })
    target.hydrateTransferEntries(source.getTransferEntries())
    target.setQuery({
      tags: ['crashtag'],
      devices: ['device-a'],
      includeText: 'fatal',
    })

    const snapshot = target.getSnapshot()
    expect(snapshot.totalCount).toBe(3)
    expect(snapshot.droppedCount).toBe(1)
    expect(snapshot.visibleEntries.map((entry) => entry.raw)).toEqual([lines[2]])
    expect(snapshot.visibleEntries[0]).toMatchObject({
      sessionId: 'session-a',
      deviceSerial: 'device-a',
      tag: 'CrashTag',
    })
  })
})
