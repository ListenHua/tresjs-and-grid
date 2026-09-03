import { readonly, shallowReactive } from 'vue'

export type MapLogLevel = 'debug' | 'info' | 'warn' | 'error'

export type MapLogEvent =
  | 'map.initialize'
  | 'map.position.change'
  | 'map.view.change'
  | 'map.zoom.change'
  | 'map.opacity.change'
  | 'map.command'
  | 'map.dispose'
  | 'source.change'
  | 'tile.range.change'
  | 'tile.load.start'
  | 'tile.load.success'
  | 'tile.load.error'
  | 'tile.cache.remove'

export type MapLogData = Record<string, unknown>

export interface MapLogRecord {
  level: MapLogLevel
  event: MapLogEvent
  message: string
  scope: string
  timestamp: number
  data?: MapLogData
}

export interface MapLoggerOptions {
  enabled: boolean
  level: MapLogLevel
  maxRecords: number
}

export interface MapLogger {
  debug(event: MapLogEvent, message: string, data?: MapLogData): void
  info(event: MapLogEvent, message: string, data?: MapLogData): void
  warn(event: MapLogEvent, message: string, data?: MapLogData): void
  error(event: MapLogEvent, message: string, data?: MapLogData): void
}

const LEVEL_WEIGHT: Record<MapLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export function useMapLogger(options: MapLoggerOptions) {
  const logs = shallowReactive<MapLogRecord[]>([])

  function write(
    scope: string,
    level: MapLogLevel,
    event: MapLogEvent,
    message: string,
    data?: MapLogData,
  ) {
    if (!options.enabled || LEVEL_WEIGHT[level] < LEVEL_WEIGHT[options.level]) return

    const record: MapLogRecord = {
      level,
      event,
      message,
      scope,
      timestamp: Date.now(),
      ...(data ? { data } : {}),
    }
    logs.push(record)
    if (logs.length > options.maxRecords) logs.splice(0, logs.length - options.maxRecords)

    const prefix = `[Map][${scope}][${level.toUpperCase()}][${event}]`
    if (data) console[level](prefix, message, data)
    else console[level](prefix, message)
  }

  function createLogger(scope: string): MapLogger {
    return {
      debug: (event, message, data) => write(scope, 'debug', event, message, data),
      info: (event, message, data) => write(scope, 'info', event, message, data),
      warn: (event, message, data) => write(scope, 'warn', event, message, data),
      error: (event, message, data) => write(scope, 'error', event, message, data),
    }
  }

  function clear() {
    logs.splice(0, logs.length)
  }

  return {
    logs: readonly(logs),
    createLogger,
    clear,
  }
}
