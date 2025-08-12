import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { snooze } from '../../../common/utils'
import type { Autobot, AutobotEngineArgs } from '../../types'

const execFileAsync = promisify(execFile)

const REPO_SSH_URL = 'git@github.com:EdgeApp/edge-tester.git'
const TEN_MINUTES = 10 * 60 * 1000

async function runGit(
  args: string[],
  log: (...args: unknown[]) => void,
  cwd?: string
): Promise<string> {
  log('git', args.join(' '))
  const { stdout } = await execFileAsync('git', args, {
    maxBuffer: 10 * 1024 * 1024,
    cwd
  })
  return stdout
}

function parseHeads(output: string): Map<string, string> {
  const nameToHash = new Map<string, string>()
  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const [hash, ref] = trimmed.split(/\s+/)
    if (hash == null || ref == null) continue
    const match = /^refs\/heads\/(.+)$/.exec(ref)
    if (match != null) {
      const name = match[1]
      nameToHash.set(name, hash)
    }
  }
  return nameToHash
}

function isTargetBranch(name: string): boolean {
  return name.endsWith('/ios') || name.endsWith('/android')
}

export async function edgeTesterEngine({
  log
}: AutobotEngineArgs): Promise<void> {
  // List all remote heads once
  const headsOut = await runGit(['ls-remote', '--heads', REPO_SSH_URL], log)
  const nameToHash = parseHeads(headsOut)

  // Prepare a temporary local repository to fetch and push from
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'edge-tester-'))
  try {
    await runGit(['init'], log, tempDir)
    await runGit(['remote', 'add', 'origin', REPO_SSH_URL], log, tempDir)

    for (const [branchName, hash] of Array.from(nameToHash.entries())) {
      if (!isTargetBranch(branchName)) continue

      const mirrorName = `${branchName}-mirror`
      const currentMirrorHash = nameToHash.get(mirrorName)

      if (currentMirrorHash === hash) {
        log(`Mirror up-to-date: ${mirrorName} -> ${hash.slice(0, 12)}`)
        continue
      }

      try {
        // Fetch the exact branch tip into FETCH_HEAD (shallow)
        await runGit(['fetch', '--depth=1', 'origin', branchName], log, tempDir)
        // Force-push FETCH_HEAD to mirror ref on remote
        const refspec = `FETCH_HEAD:refs/heads/${mirrorName}`
        await runGit(['push', '--force', 'origin', refspec], log, tempDir)
        const action = currentMirrorHash == null ? 'Created' : 'Updated'
        log(`${action} mirror: ${mirrorName} -> ${hash.slice(0, 12)}`)
      } catch (e: unknown) {
        log(`Failed to update mirror ${mirrorName}:`, e)
      }
      // Wait for 10 minutes before updating the next branch to give time
      // for the previous branch to be tested. A bug in the test runner
      // sometimes causes duplicate tests to be queued.
      await snooze(TEN_MINUTES)
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export const edgeTesterBot: Autobot = {
  botId: 'edgeTester',
  engines: [
    {
      engine: edgeTesterEngine,
      // Run every day at 12:05am
      cron: '5 0 * * *'
    }
  ]
}
