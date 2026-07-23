export interface LogSearchOptions {
  matchCase: boolean
  wholeWords: boolean
  regex: boolean
}

export interface TextMatchRange {
  start: number
  end: number
}

export interface CompiledSearchMatcher {
  pattern: string
  normalizedPattern: string
  options: LogSearchOptions
  regex?: RegExp
  globalRegex?: RegExp
  error?: string
}

const WORD_CHAR_PATTERN = /[A-Za-z0-9_]/
const DEFAULT_SEARCH_OPTIONS: LogSearchOptions = {
  matchCase: false,
  wholeWords: false,
  regex: false,
}

export function normalizeSearchOptions(options?: Partial<LogSearchOptions>): LogSearchOptions {
  return {
    matchCase: Boolean(options?.matchCase),
    wholeWords: Boolean(options?.wholeWords),
    regex: Boolean(options?.regex),
  }
}

export function compileSearchMatcher(
  pattern: string | undefined,
  options?: Partial<LogSearchOptions>,
): CompiledSearchMatcher {
  const normalizedOptions = normalizeSearchOptions(options ?? DEFAULT_SEARCH_OPTIONS)
  const trimmedPattern = pattern?.trim() ?? ''
  const normalizedPattern = normalizedOptions.matchCase ? trimmedPattern : trimmedPattern.toLowerCase()

  if (!trimmedPattern || !normalizedOptions.regex) {
    return {
      pattern: trimmedPattern,
      normalizedPattern,
      options: normalizedOptions,
    }
  }

  const flags = normalizedOptions.matchCase ? '' : 'i'
  try {
    return {
      pattern: trimmedPattern,
      normalizedPattern,
      options: normalizedOptions,
      regex: new RegExp(trimmedPattern, flags),
      globalRegex: new RegExp(trimmedPattern, `${flags}g`),
    }
  } catch (error) {
    return {
      pattern: trimmedPattern,
      normalizedPattern,
      options: normalizedOptions,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function matchesSearchText(
  text: string,
  matcher: CompiledSearchMatcher,
  normalizedText?: string,
) {
  if (!matcher.pattern) {
    return true
  }
  if (matcher.error) {
    return false
  }

  if (matcher.options.regex) {
    if (!matcher.options.wholeWords) {
      return Boolean(matcher.regex?.test(text))
    }
    return findSearchMatchRanges(text, matcher, 1).length > 0
  }

  const haystack = matcher.options.matchCase ? text : normalizedText ?? text.toLowerCase()
  const needle = matcher.normalizedPattern
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    const end = index + needle.length
    if (!matcher.options.wholeWords || isWholeWordMatch(haystack, index, end)) {
      return true
    }
    index = haystack.indexOf(needle, index + 1)
  }
  return false
}

export function findSearchMatchRanges(
  text: string,
  matcher: CompiledSearchMatcher,
  limit = 100,
): TextMatchRange[] {
  if (!matcher.pattern || matcher.error || limit <= 0) {
    return []
  }

  if (matcher.options.regex) {
    return findRegexRanges(text, matcher, limit)
  }
  return findLiteralRanges(text, matcher, limit)
}

function findLiteralRanges(text: string, matcher: CompiledSearchMatcher, limit: number) {
  const haystack = matcher.options.matchCase ? text : text.toLowerCase()
  const needle = matcher.normalizedPattern
  const ranges: TextMatchRange[] = []
  let index = haystack.indexOf(needle)

  while (index !== -1 && ranges.length < limit) {
    const end = index + needle.length
    if (!matcher.options.wholeWords || isWholeWordMatch(haystack, index, end)) {
      ranges.push({ start: index, end })
    }
    index = haystack.indexOf(needle, end)
  }
  return ranges
}

function findRegexRanges(text: string, matcher: CompiledSearchMatcher, limit: number) {
  const regex = matcher.globalRegex
  if (!regex) {
    return []
  }

  const ranges: TextMatchRange[] = []
  regex.lastIndex = 0

  let match = regex.exec(text)
  while (match && ranges.length < limit) {
    const matchedText = match[0]
    if (matchedText.length > 0) {
      const start = match.index
      const end = start + matchedText.length
      if (!matcher.options.wholeWords || isWholeWordMatch(text, start, end)) {
        ranges.push({ start, end })
      }
    }

    if (matchedText.length === 0) {
      regex.lastIndex += 1
    }
    match = regex.exec(text)
  }
  return ranges
}

function isWholeWordMatch(text: string, start: number, end: number) {
  return !isWordChar(text[start - 1]) && !isWordChar(text[end])
}

function isWordChar(char: string | undefined) {
  return Boolean(char && WORD_CHAR_PATTERN.test(char))
}
