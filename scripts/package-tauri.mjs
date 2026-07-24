#!/usr/bin/env node
import { spawn } from 'node:child_process'
import process from 'node:process'

const args = process.argv.slice(2)
const platform = getArgValue('--platform') ?? currentBuildPlatform()
const target = getArgValue('--target')
const WINDOWS_NSIS_ATTEMPTS = 3
const WINDOWS_NSIS_RETRY_DELAY_MS = 15_000

function getArgValue(name) {
  const equalPrefix = `${name}=`
  const equalValue = args.find((arg) => arg.startsWith(equalPrefix))
  if (equalValue) {
    return equalValue.slice(equalPrefix.length)
  }

  const index = args.indexOf(name)
  if (index >= 0) {
    return args[index + 1]
  }

  return undefined
}

function currentBuildPlatform() {
  if (process.platform === 'darwin') {
    return 'macos'
  }
  if (process.platform === 'win32') {
    return 'windows'
  }
  return process.platform
}

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} ${commandArgs.join(' ')} exited with code ${code}`))
      }
    })
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function positiveIntegerEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

async function runWithRetries(command, commandArgs, options) {
  const attempts = options?.attempts ?? 1
  const delayMs = options?.delayMs ?? 0
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await run(command, commandArgs)
      return
    } catch (error) {
      lastError = error
      if (attempt >= attempts) {
        break
      }

      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[package] Attempt ${attempt}/${attempts} failed: ${message}`)
      console.warn(`[package] Retrying in ${Math.round(delayMs / 1000)}s...`)
      await sleep(delayMs)
    }
  }

  throw lastError
}

function tauriBuildArgs(bundles) {
  const buildArgs = ['tauri', 'build', '--bundles', bundles]
  if (target) {
    buildArgs.push('--target', target)
  }
  return buildArgs
}

async function packageMacos() {
  if (process.platform !== 'darwin') {
    throw new Error('macOS packages must be built on macOS.')
  }
  await run('npx', tauriBuildArgs('app,dmg'))
}

async function packageWindows() {
  if (process.platform !== 'win32') {
    throw new Error(
      'Windows NSIS packages must be built on Windows or a CI runner with the Windows Tauri toolchain.',
    )
  }
  await runWithRetries('npx', tauriBuildArgs('nsis'), {
    attempts: positiveIntegerEnv('TAURI_WINDOWS_NSIS_ATTEMPTS', WINDOWS_NSIS_ATTEMPTS),
    delayMs: positiveIntegerEnv('TAURI_WINDOWS_NSIS_RETRY_DELAY_MS', WINDOWS_NSIS_RETRY_DELAY_MS),
  })
}

async function packageLinux() {
  if (process.platform !== 'linux') {
    throw new Error('Linux packages must be built on Linux or a Linux CI runner.')
  }
  await run('npx', tauriBuildArgs('appimage,deb'))
}

try {
  if (platform === 'macos') {
    await packageMacos()
  } else if (platform === 'windows') {
    await packageWindows()
  } else if (platform === 'linux') {
    await packageLinux()
  } else {
    throw new Error(`Unsupported package platform: ${platform}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
