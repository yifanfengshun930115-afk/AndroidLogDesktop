import { describe, expect, it } from 'vitest'
import {
  buildAndroidStudioLogcatFile,
  parseAndroidStudioLogcatText,
  stringifyAndroidStudioLogcatFile,
} from './androidStudioLogcat'
import { parseLogcatLine } from './logcat'

describe('Android Studio logcat format', () => {
  it('exports filtered entries as Android Studio JSON logcat messages', () => {
    const entry = parseLogcatLine(
      '07-24 17:11:59.489  1619  2231 D DemoTag: debug message',
      'session-a',
      1,
      'RFCR301L2JN',
    )

    const file = buildAndroidStudioLogcatFile([entry], {
      devices: [
        {
          serial: 'RFCR301L2JN',
          state: 'device',
          description: 'product:r11q model:SM_G991B device:r11q',
        },
      ],
      selectedSerials: ['RFCR301L2JN'],
      processes: [{ serial: 'RFCR301L2JN', pid: '1619', name: 'system_server' }],
      selectedPackages: [],
      selectedTags: ['DemoTag'],
      selectedLevels: ['D'],
      searchText: 'debug',
    })

    expect(file.metadata.device?.physicalDevice).toMatchObject({
      serialNumber: 'RFCR301L2JN',
      model: 'SM G991B',
    })
    expect(file.metadata.filter).toContain('tag:DemoTag')
    expect(file.logcatMessages[0]).toMatchObject({
      header: {
        logLevel: 'DEBUG',
        pid: 1619,
        tid: 2231,
        applicationId: 'system_server',
        processName: 'system_server',
        tag: 'DemoTag',
      },
      message: 'debug message',
    })
    expect(file.logcatMessages[0]?.header.timestamp.seconds).toBeGreaterThan(0)
  })

  it('imports Android Studio JSON while preserving parsed fields', () => {
    const imported = parseAndroidStudioLogcatText(
      stringifyAndroidStudioLogcatFile({
        metadata: {
          device: {
            physicalDevice: {
              serialNumber: 'RFCR301L2JN',
              isOnline: true,
              release: '13',
              apiLevel: { majorVersion: 33, minorVersion: 0 },
              featureLevel: 33,
              manufacturer: 'samsung',
              model: 'SM-G991B',
              type: 'HANDHELD',
            },
          },
          filter: 'tag:DemoTag',
          projectApplicationIds: ['system_server'],
        },
        logcatMessages: [
          {
            header: {
              logLevel: 'INFO',
              pid: 0,
              tid: 0,
              applicationId: '',
              processName: '',
              tag: '',
              timestamp: { seconds: 0, nanos: 0 },
            },
            message: '--------- beginning of main',
          },
          {
            header: {
              logLevel: 'WARN',
              pid: 1619,
              tid: 2231,
              applicationId: 'system_server',
              processName: 'system_server',
              tag: 'DemoTag',
              timestamp: { seconds: 1784884319, nanos: 489000000 },
            },
            message: 'warn message',
          },
        ],
      }),
      'samsung-SM-G991B.logcat',
    )

    expect(imported.title).toBe('导入 - samsung-SM-G991B')
    expect(imported.deviceSerials).toEqual(['RFCR301L2JN'])
    expect(imported.devices[0]).toMatchObject({
      serial: 'RFCR301L2JN',
      state: 'device',
    })
    expect(imported.filters).toMatchObject({
      selectedSerials: ['RFCR301L2JN'],
      selectedPackages: [],
      selectedTags: ['DemoTag'],
      selectedLevels: [],
      searchText: '',
    })
    expect(imported.entries[0]).toMatchObject({
      level: 'I',
      message: '--------- beginning of main',
      raw: '--------- beginning of main',
    })
    expect(imported.entries[1]).toMatchObject({
      deviceSerial: 'RFCR301L2JN',
      timestampEpochMs: 1784884319489,
      pid: '1619',
      tid: '2231',
      level: 'W',
      tag: 'DemoTag',
      message: 'warn message',
      applicationId: 'system_server',
      processName: 'system_server',
    })
  })

  it('maps Android Studio package:mine filters into imported tab filters', () => {
    const imported = parseAndroidStudioLogcatText(
      stringifyAndroidStudioLogcatFile({
        metadata: {
          device: {
            physicalDevice: {
              serialNumber: 'RFCR301L2JN',
              isOnline: true,
              release: '13',
              apiLevel: { majorVersion: 33, minorVersion: 0 },
              featureLevel: 33,
              manufacturer: 'samsung',
              model: 'SM-G991B',
              type: 'HANDHELD',
            },
          },
          filter: 'package:mine tag:TAG_PushManager level:INFO message:"push ok"',
          projectApplicationIds: [
            'com.bulletin.common.test',
            'com.anynews.global.any.any',
          ],
        },
        logcatMessages: [
          {
            header: {
              logLevel: 'INFO',
              pid: 30864,
              tid: 11455,
              applicationId: 'com.anynews.global.any.any',
              processName: 'com.anynews.global.any.any',
              tag: 'TAG_PushManager',
              timestamp: { seconds: 1784903405, nanos: 384000000 },
            },
            message: 'push ok',
          },
        ],
      }),
      'android-studio.logcat',
    )

    expect(imported.filters).toEqual({
      selectedSerials: ['RFCR301L2JN'],
      selectedPackages: [
        'com.bulletin.common.test',
        'com.anynews.global.any.any',
      ],
      selectedTags: ['TAG_PushManager'],
      selectedLevels: ['I'],
      searchText: 'push ok',
    })
  })
})
