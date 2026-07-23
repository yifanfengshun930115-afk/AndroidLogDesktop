import { parseLogcatLine } from './logcat'
import type { LogEntry, LogLevel } from './types'

export type LevelFilter = 'all' | LogLevel

export interface LogFilter {
  level: LevelFilter
  query: string
}

export interface LogStoreOptions {
  capacity?: number
  displayLimit?: number
}

export interface AppendRawBatchOptions {
  sessionId: string
  lines: string[]
  deviceSerial?: string
}

export interface LogStoreSnapshot {
  version: number
  totalCount: number
  filteredCount: number
  droppedCount: number
  capacity: number
  displayLimit: number
  visibleEntries: LogEntry[]
}

type Subscriber = () => void

const DEFAULT_CAPACITY = 100000
const DEFAULT_DISPLAY_LIMIT = 1000
const EMPTY_FILTER: LogFilter = {
  level: 'all',
  query: '',
}

function normalizeFilter(filter: Partial<LogFilter>): LogFilter {
  return {
    level: filter.level ?? EMPTY_FILTER.level,
    query: filter.query?.trim().toLowerCase() ?? EMPTY_FILTER.query,
  }
}

function filterKey(filter: LogFilter) {
  return `${filter.level}\u0000${filter.query}`
}

export class LogStore {
  private readonly capacity: number
  private readonly displayLimit: number
  private readonly entries: Array<LogEntry | undefined>
  private readonly subscribers = new Set<Subscriber>()
  private activeFilter = EMPTY_FILTER
  private activeFilterKey = filterKey(EMPTY_FILTER)
  private filteredSequences: number[] = []
  private start = 0
  private size = 0
  private nextSequence = 1
  private droppedCount = 0
  private version = 0
  private cachedSnapshot?: LogStoreSnapshot
  private cachedSnapshotVersion = -1
  private cachedSnapshotFilterKey = ''

  constructor(options: LogStoreOptions = {}) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY
    this.displayLimit = options.displayLimit ?? DEFAULT_DISPLAY_LIMIT

    if (!Number.isInteger(this.capacity) || this.capacity <= 0) {
      throw new Error('LogStore capacity must be a positive integer')
    }
    if (!Number.isInteger(this.displayLimit) || this.displayLimit <= 0) {
      throw new Error('LogStore displayLimit must be a positive integer')
    }

    this.entries = new Array(this.capacity)
  }

  subscribe = (subscriber: Subscriber) => {
    this.subscribers.add(subscriber)
    return () => {
      this.subscribers.delete(subscriber)
    }
  }

  getSnapshot = () => {
    this.trimStaleFilteredSequences()

    if (
      this.cachedSnapshot &&
      this.cachedSnapshotVersion === this.version &&
      this.cachedSnapshotFilterKey === this.activeFilterKey
    ) {
      return this.cachedSnapshot
    }

    const visibleEntries = this.filteredSequences
      .slice(-this.displayLimit)
      .map((sequence) => this.getBySequence(sequence))
      .filter((entry): entry is LogEntry => Boolean(entry))

    this.cachedSnapshot = {
      version: this.version,
      totalCount: this.size,
      filteredCount: this.filteredSequences.length,
      droppedCount: this.droppedCount,
      capacity: this.capacity,
      displayLimit: this.displayLimit,
      visibleEntries,
    }
    this.cachedSnapshotVersion = this.version
    this.cachedSnapshotFilterKey = this.activeFilterKey
    return this.cachedSnapshot
  }

  appendRawBatch({ sessionId, lines, deviceSerial }: AppendRawBatchOptions) {
    if (lines.length === 0) {
      return
    }

    for (const line of lines) {
      this.appendEntry(parseLogcatLine(line, sessionId, this.nextSequence++, deviceSerial))
    }

    this.commitChange()
  }

  setFilter(filter: Partial<LogFilter>) {
    const nextFilter = normalizeFilter(filter)
    const nextFilterKey = filterKey(nextFilter)
    if (nextFilterKey === this.activeFilterKey) {
      return
    }

    this.activeFilter = nextFilter
    this.activeFilterKey = nextFilterKey
    this.rebuildFilteredSequences()
    this.commitChange()
  }

  clear() {
    this.entries.fill(undefined)
    this.start = 0
    this.size = 0
    this.nextSequence = 1
    this.droppedCount = 0
    this.filteredSequences = []
    this.commitChange()
  }

  getFilteredEntries() {
    this.trimStaleFilteredSequences()
    return this.filteredSequences
      .map((sequence) => this.getBySequence(sequence))
      .filter((entry): entry is LogEntry => Boolean(entry))
  }

  getExportContent() {
    const entries = this.getFilteredEntries()
    return entries.length === 0 ? '' : `${entries.map((entry) => entry.raw).join('\n')}\n`
  }

  private appendEntry(entry: LogEntry) {
    if (this.size === this.capacity) {
      this.entries[this.start] = entry
      this.start = (this.start + 1) % this.capacity
      this.droppedCount += 1
    } else {
      this.entries[(this.start + this.size) % this.capacity] = entry
      this.size += 1
    }

    if (this.matchesActiveFilter(entry)) {
      this.filteredSequences.push(entry.sequence)
    }
  }

  private matchesActiveFilter(entry: LogEntry) {
    if (this.activeFilter.level !== 'all' && entry.level !== this.activeFilter.level) {
      return false
    }
    if (!this.activeFilter.query) {
      return true
    }
    return entry.searchText.includes(this.activeFilter.query)
  }

  private rebuildFilteredSequences() {
    const sequences: number[] = []
    for (let index = 0; index < this.size; index += 1) {
      const entry = this.entries[(this.start + index) % this.capacity]
      if (entry && this.matchesActiveFilter(entry)) {
        sequences.push(entry.sequence)
      }
    }
    this.filteredSequences = sequences
  }

  private trimStaleFilteredSequences() {
    const oldestSequence = this.oldestSequence()
    let staleCount = 0
    while (
      staleCount < this.filteredSequences.length &&
      this.filteredSequences[staleCount] < oldestSequence
    ) {
      staleCount += 1
    }
    if (staleCount > 0) {
      this.filteredSequences = this.filteredSequences.slice(staleCount)
    }
  }

  private oldestSequence() {
    if (this.size === 0) {
      return this.nextSequence
    }
    return this.nextSequence - this.size
  }

  private getBySequence(sequence: number) {
    const oldestSequence = this.oldestSequence()
    if (sequence < oldestSequence || sequence >= this.nextSequence) {
      return undefined
    }

    const offset = sequence - oldestSequence
    const entry = this.entries[(this.start + offset) % this.capacity]
    return entry?.sequence === sequence ? entry : undefined
  }

  private commitChange() {
    this.version += 1
    this.cachedSnapshot = undefined
    for (const subscriber of this.subscribers) {
      subscriber()
    }
  }
}

export const logStore = new LogStore()
