import { parseLogcatLine } from './logcat'
import type { LogEntry, LogLevel } from './types'

export type LevelFilter = 'all' | LogLevel

export interface LogFilter {
  level: LevelFilter
  query: string
}

export interface LogQuery {
  levels?: LogLevel[]
  includeText?: string
  excludeText?: string
  tags?: string[]
  pids?: string[]
  tids?: string[]
  sessions?: string[]
  devices?: string[]
  crashOnly?: boolean
  startEpochMs?: number
  endEpochMs?: number
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
  tagOptions: string[]
  visibleEntries: LogEntry[]
}

type Subscriber = () => void
type IndexedField = 'level' | 'tag' | 'pid' | 'tid' | 'session' | 'device' | 'crash'

const DEFAULT_CAPACITY = 100000
const DEFAULT_DISPLAY_LIMIT = 1000
const EMPTY_FILTER: LogFilter = {
  level: 'all',
  query: '',
}
const EMPTY_QUERY: NormalizedLogQuery = {
  levels: [],
  includeText: '',
  excludeText: '',
  tags: [],
  pids: [],
  tids: [],
  sessions: [],
  devices: [],
  crashOnly: false,
}

interface NormalizedLogQuery {
  levels: LogLevel[]
  includeText: string
  excludeText: string
  tags: string[]
  pids: string[]
  tids: string[]
  sessions: string[]
  devices: string[]
  crashOnly: boolean
  startEpochMs?: number
  endEpochMs?: number
}

class SequenceBucket {
  private sequences: number[] = []
  private head = 0

  append(sequence: number) {
    this.sequences.push(sequence)
  }

  firstValue(minSequence: number) {
    this.pruneBefore(minSequence)
    return this.sequences[this.head]
  }

  values(minSequence: number) {
    this.pruneBefore(minSequence)
    return this.sequences.slice(this.head)
  }

  count(minSequence: number) {
    this.pruneBefore(minSequence)
    return this.sequences.length - this.head
  }

  pruneBefore(minSequence: number) {
    while (this.head < this.sequences.length && this.sequences[this.head] < minSequence) {
      this.head += 1
    }
    if (this.head > 1024 && this.head * 2 > this.sequences.length) {
      this.sequences = this.sequences.slice(this.head)
      this.head = 0
    }
  }

  isEmpty(minSequence: number) {
    return this.count(minSequence) === 0
  }

  clear() {
    this.sequences = []
    this.head = 0
  }
}

function normalizeList(values?: string[]) {
  return [...new Set(values?.map((value) => value.trim().toLowerCase()).filter(Boolean) ?? [])]
}

function normalizeLevels(levels?: LogLevel[]) {
  return [...new Set(levels ?? [])].filter(Boolean).sort()
}

function normalizeEpoch(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeQuery(query: Partial<LogQuery>): NormalizedLogQuery {
  return {
    levels: normalizeLevels(query.levels),
    includeText: query.includeText?.trim().toLowerCase() ?? '',
    excludeText: query.excludeText?.trim().toLowerCase() ?? '',
    tags: normalizeList(query.tags),
    pids: normalizeList(query.pids),
    tids: normalizeList(query.tids),
    sessions: normalizeList(query.sessions),
    devices: normalizeList(query.devices),
    crashOnly: Boolean(query.crashOnly),
    startEpochMs: normalizeEpoch(query.startEpochMs),
    endEpochMs: normalizeEpoch(query.endEpochMs),
  }
}

function queryKey(query: NormalizedLogQuery) {
  return JSON.stringify(query)
}

function queryFromFilter(filter: Partial<LogFilter>): NormalizedLogQuery {
  const level = filter.level ?? EMPTY_FILTER.level
  return normalizeQuery({
    levels: level === 'all' ? [] : [level],
    includeText: filter.query,
  })
}

function mergeSortedUnique(sequences: number[][]) {
  if (sequences.length === 0) {
    return []
  }
  if (sequences.length === 1) {
    return sequences[0]
  }

  const positions = new Array(sequences.length).fill(0) as number[]
  const result: number[] = []
  let last = 0
  let hasLast = false

  while (true) {
    let next = Number.POSITIVE_INFINITY
    for (let index = 0; index < sequences.length; index += 1) {
      const value = sequences[index][positions[index]]
      if (value !== undefined && value < next) {
        next = value
      }
    }
    if (!Number.isFinite(next)) {
      break
    }
    if (!hasLast || next !== last) {
      result.push(next)
      last = next
      hasLast = true
    }
    for (let index = 0; index < sequences.length; index += 1) {
      while (sequences[index][positions[index]] === next) {
        positions[index] += 1
      }
    }
  }

  return result
}

export class LogStore {
  private readonly capacity: number
  private readonly displayLimit: number
  private readonly entries: Array<LogEntry | undefined>
  private readonly subscribers = new Set<Subscriber>()
  private readonly levelIndex = new Map<string, SequenceBucket>()
  private readonly tagIndex = new Map<string, SequenceBucket>()
  private readonly pidIndex = new Map<string, SequenceBucket>()
  private readonly tidIndex = new Map<string, SequenceBucket>()
  private readonly sessionIndex = new Map<string, SequenceBucket>()
  private readonly deviceIndex = new Map<string, SequenceBucket>()
  private readonly crashIndex = new SequenceBucket()
  private activeQuery = EMPTY_QUERY
  private activeQueryKey = queryKey(EMPTY_QUERY)
  private filteredSequences: number[] = []
  private start = 0
  private size = 0
  private nextSequence = 1
  private droppedCount = 0
  private version = 0
  private cachedSnapshot?: LogStoreSnapshot
  private cachedSnapshotVersion = -1
  private cachedSnapshotQueryKey = ''

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
    this.pruneIndexes()
    this.trimStaleFilteredSequences()

    if (
      this.cachedSnapshot &&
      this.cachedSnapshotVersion === this.version &&
      this.cachedSnapshotQueryKey === this.activeQueryKey
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
      tagOptions: this.tagOptions(),
      visibleEntries,
    }
    this.cachedSnapshotVersion = this.version
    this.cachedSnapshotQueryKey = this.activeQueryKey
    return this.cachedSnapshot
  }

  appendRawBatch({ sessionId, lines, deviceSerial }: AppendRawBatchOptions) {
    if (lines.length === 0) {
      return
    }

    let evicted = false
    for (const line of lines) {
      evicted = this.appendEntry(
        parseLogcatLine(line, sessionId, this.nextSequence++, deviceSerial),
      ) || evicted
    }

    if (evicted) {
      this.pruneIndexes()
      this.trimStaleFilteredSequences()
    }
    this.commitChange()
  }

  setFilter(filter: Partial<LogFilter>) {
    this.setQuery(queryFromFilter(filter))
  }

  setQuery(query: Partial<LogQuery> | NormalizedLogQuery) {
    const nextQuery = normalizeQuery(query)
    const nextQueryKey = queryKey(nextQuery)
    if (nextQueryKey === this.activeQueryKey) {
      return
    }

    this.activeQuery = nextQuery
    this.activeQueryKey = nextQueryKey
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
    this.levelIndex.clear()
    this.tagIndex.clear()
    this.pidIndex.clear()
    this.tidIndex.clear()
    this.sessionIndex.clear()
    this.deviceIndex.clear()
    this.crashIndex.clear()
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
    let evicted = false
    if (this.size === this.capacity) {
      this.entries[this.start] = entry
      this.start = (this.start + 1) % this.capacity
      this.droppedCount += 1
      evicted = true
    } else {
      this.entries[(this.start + this.size) % this.capacity] = entry
      this.size += 1
    }

    this.indexEntry(entry)
    if (this.matchesQuery(entry, this.activeQuery)) {
      this.filteredSequences.push(entry.sequence)
    }
    return evicted
  }

  private indexEntry(entry: LogEntry) {
    this.indexValue(this.levelIndex, entry.level, entry.sequence)
    this.indexValue(this.sessionIndex, entry.sessionId, entry.sequence)
    this.indexValue(this.tagIndex, entry.tag, entry.sequence)
    this.indexValue(this.pidIndex, entry.pid, entry.sequence)
    this.indexValue(this.tidIndex, entry.tid, entry.sequence)
    this.indexValue(this.deviceIndex, entry.deviceSerial, entry.sequence)
    if (entry.isCrash) {
      this.crashIndex.append(entry.sequence)
    }
  }

  private indexValue(index: Map<string, SequenceBucket>, value: string | undefined, sequence: number) {
    const key = value?.trim().toLowerCase()
    if (!key) {
      return
    }

    let bucket = index.get(key)
    if (!bucket) {
      bucket = new SequenceBucket()
      index.set(key, bucket)
    }
    bucket.append(sequence)
  }

  private matchesQuery(entry: LogEntry, query: NormalizedLogQuery) {
    if (query.levels.length > 0 && !query.levels.includes(entry.level)) {
      return false
    }
    if (query.tags.length > 0 && !query.tags.includes(entry.tag.toLowerCase())) {
      return false
    }
    if (query.pids.length > 0 && !query.pids.includes(entry.pid)) {
      return false
    }
    if (query.tids.length > 0 && !query.tids.includes(entry.tid)) {
      return false
    }
    if (query.sessions.length > 0 && !query.sessions.includes(entry.sessionId.toLowerCase())) {
      return false
    }
    if (
      query.devices.length > 0 &&
      !query.devices.includes(entry.deviceSerial?.toLowerCase() ?? '')
    ) {
      return false
    }
    if (query.crashOnly && !entry.isCrash) {
      return false
    }
    if (query.startEpochMs !== undefined && (entry.timestampEpochMs ?? 0) < query.startEpochMs) {
      return false
    }
    if (
      query.endEpochMs !== undefined &&
      (entry.timestampEpochMs ?? Number.POSITIVE_INFINITY) > query.endEpochMs
    ) {
      return false
    }
    if (query.includeText && !entry.searchText.includes(query.includeText)) {
      return false
    }
    if (query.excludeText && entry.searchText.includes(query.excludeText)) {
      return false
    }
    return true
  }

  private rebuildFilteredSequences() {
    const candidates = this.selectCandidateSequences(this.activeQuery)
    const sequences: number[] = []

    for (const sequence of candidates) {
      const entry = this.getBySequence(sequence)
      if (entry && this.matchesQuery(entry, this.activeQuery)) {
        sequences.push(entry.sequence)
      }
    }
    this.filteredSequences = sequences
  }

  private selectCandidateSequences(query: NormalizedLogQuery) {
    const candidates: Array<{ field: IndexedField; sequences: number[] }> = []
    this.addCandidate(candidates, 'level', this.sequencesForValues(this.levelIndex, query.levels))
    this.addCandidate(candidates, 'tag', this.sequencesForValues(this.tagIndex, query.tags))
    this.addCandidate(candidates, 'pid', this.sequencesForValues(this.pidIndex, query.pids))
    this.addCandidate(candidates, 'tid', this.sequencesForValues(this.tidIndex, query.tids))
    this.addCandidate(candidates, 'session', this.sequencesForValues(this.sessionIndex, query.sessions))
    this.addCandidate(candidates, 'device', this.sequencesForValues(this.deviceIndex, query.devices))
    this.addCandidate(
      candidates,
      'crash',
      query.crashOnly ? this.crashIndex.values(this.oldestSequence()) : undefined,
    )

    if (candidates.length === 0) {
      return this.allSequences()
    }

    return candidates.reduce((smallest, candidate) =>
      candidate.sequences.length < smallest.sequences.length ? candidate : smallest,
    ).sequences
  }

  private addCandidate(
    candidates: Array<{ field: IndexedField; sequences: number[] }>,
    field: IndexedField,
    sequences: number[] | undefined,
  ) {
    if (sequences !== undefined) {
      candidates.push({ field, sequences })
    }
  }

  private sequencesForValues(index: Map<string, SequenceBucket>, values: string[]) {
    if (values.length === 0) {
      return undefined
    }

    const minSequence = this.oldestSequence()
    return mergeSortedUnique(
      values.map((value) => index.get(value.toLowerCase())?.values(minSequence) ?? []),
    )
  }

  private allSequences() {
    const sequences: number[] = []
    for (let index = 0; index < this.size; index += 1) {
      const entry = this.entries[(this.start + index) % this.capacity]
      if (entry) {
        sequences.push(entry.sequence)
      }
    }
    return sequences
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

  private pruneIndexes() {
    const minSequence = this.oldestSequence()
    this.pruneIndex(this.levelIndex, minSequence)
    this.pruneIndex(this.tagIndex, minSequence)
    this.pruneIndex(this.pidIndex, minSequence)
    this.pruneIndex(this.tidIndex, minSequence)
    this.pruneIndex(this.sessionIndex, minSequence)
    this.pruneIndex(this.deviceIndex, minSequence)
    this.crashIndex.pruneBefore(minSequence)
  }

  private pruneIndex(index: Map<string, SequenceBucket>, minSequence: number) {
    for (const [key, bucket] of index) {
      if (bucket.isEmpty(minSequence)) {
        index.delete(key)
      }
    }
  }

  private tagOptions() {
    const minSequence = this.oldestSequence()
    return [...this.tagIndex.entries()]
      .filter(([, bucket]) => !bucket.isEmpty(minSequence))
      .map(([key, bucket]) => {
        const entry = this.getBySequence(bucket.firstValue(minSequence) ?? 0)
        return entry?.tag || key
      })
      .sort((first, second) => first.localeCompare(second))
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
