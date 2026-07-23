import { describe, expect, it } from 'vitest'
import { LogStore } from './logStore'

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

  it('returns a stable snapshot object until data or filters change', () => {
    const store = new LogStore({ capacity: 10, displayLimit: 10 })

    store.appendRawBatch({ sessionId: 's1', lines: lines.slice(0, 1) })
    const first = store.getSnapshot()
    const second = store.getSnapshot()
    expect(second).toBe(first)

    store.appendRawBatch({ sessionId: 's1', lines: lines.slice(1, 2) })
    expect(store.getSnapshot()).not.toBe(first)
  })
})
