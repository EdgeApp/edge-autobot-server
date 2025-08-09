import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { Autobot, AutobotEngineArgs } from '../../types'

const execFileAsync = promisify(execFile)

const REPO_SSH_URL = 'git@github.com:EdgeApp/edge-tester.git'

async function runGit(
  args: string[],
  log: (...args: unknown[]) => void
): Promise<string> {
  log('git', args.join(' '))
  const { stdout } = await execFileAsync('git', args, {
    maxBuffer: 10 * 1024 * 1024
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

  for (const [branchName, hash] of Array.from(nameToHash.entries())) {
    if (!isTargetBranch(branchName)) continue

    const mirrorName = `${branchName}-mirror`
    const currentMirrorHash = nameToHash.get(mirrorName)

    if (currentMirrorHash == null) {
      // Create mirror branch at the target hash
      const refspec = `${hash}:refs/heads/${mirrorName}`
      try {
        await runGit(['push', '--force', REPO_SSH_URL, refspec], log)
        log(`Created mirror: ${mirrorName} -> ${hash.slice(0, 12)}`)
      } catch (e: unknown) {
        log(`Failed to create mirror ${mirrorName}:`, e)
      }
      continue
    }

    if (currentMirrorHash === hash) {
      log(`Mirror up-to-date: ${mirrorName} -> ${hash.slice(0, 12)}`)
      continue
    }

    // Update mirror to the target hash
    const refspec = `${hash}:refs/heads/${mirrorName}`
    try {
      await runGit(['push', '--force', REPO_SSH_URL, refspec], log)
      log(`Updated mirror: ${mirrorName} -> ${hash.slice(0, 12)}`)
    } catch (e: unknown) {
      log(`Failed to update mirror ${mirrorName}:`, e)
    }
  }
}

export const edgeTesterBot: Autobot = {
  botId: 'edgeTester',
  engines: [
    {
      engine: edgeTesterEngine,
      // Run tester at 1am every day
      cron: '0 1 * * *'
    }
  ]
}
