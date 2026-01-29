import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import simpleGit, { type SimpleGit } from 'simple-git'

import type { LogFunction } from '../../types'

/**
 * Git repository object with methods
 */
export interface GitRepo {
  // Methods
  init: (configId: string) => Promise<string>
  resetToRemote: () => Promise<void>
  readFile: (filePath: string) => Promise<string | null>
  writeFile: (filePath: string, content: string) => Promise<void>
  getLastCommitHash: (filePath: string) => Promise<string | null>
  commitAndPush: (filePath: string, commitMessage: string) => Promise<void>
  cleanup: () => Promise<void>
}

/**
 * Get deterministic work directory path for a config
 */
function getWorkDir(configId: string): string {
  // Use a deterministic path so restarts can reuse existing clones
  const baseDir = path.join(os.tmpdir(), 'sync-git-couch')
  return path.join(baseDir, configId)
}

/**
 * Check if a directory exists
 */
async function dirExists(dirPath: string): Promise<boolean> {
  try {
    await access(dirPath)
    return true
  } catch {
    return false
  }
}

/**
 * Create a new GitRepo object with methods
 */
export function makeRepo(repoUrl: string, log: LogFunction): GitRepo {
  // Private scope variables - not accessible externally
  let workDir: string | null = null
  let git: SimpleGit | null = null
  let isInitialized: boolean = false

  const repo: GitRepo = {
    init: async function (configId: string): Promise<string> {
      if (isInitialized && workDir != null) {
        return workDir
      }

      const workDirPath = getWorkDir(configId)
      const exists = await dirExists(workDirPath)

      try {
        if (exists) {
          // Directory exists, use it
          log(`Using existing repo at: ${workDirPath}`)
          const gitInstance = simpleGit(workDirPath)
          git = gitInstance
          workDir = workDirPath
          isInitialized = true

          // Verify it's a valid git repo
          try {
            await gitInstance.status()
          } catch {
            // Not a valid repo, remove and reclone
            log(`Invalid repo at ${workDirPath}, removing and recloning`)
            await rm(workDirPath, { recursive: true, force: true })
            return await cloneRepo(workDirPath)
          }

          return workDirPath
        } else {
          // Directory doesn't exist, clone
          return await cloneRepo(workDirPath)
        }
      } catch (error) {
        // Cleanup on failure
        await rm(workDirPath, { recursive: true, force: true }).catch(() => {})
        throw error
      }
    },

    resetToRemote: async function (): Promise<void> {
      if (!isInitialized || git == null) {
        throw new Error('Repo not initialized')
      }
      log('Resetting to remote master')
      await git.fetch()
      await git.reset(['--hard', 'origin/master'])
    },

    readFile: async function (filePath: string): Promise<string | null> {
      if (!isInitialized || workDir == null) {
        throw new Error('Repo not initialized')
      }
      const fullPath = path.join(workDir, filePath)
      try {
        const content = await readFile(fullPath, 'utf8')
        return content
      } catch (error: unknown) {
        if (
          error != null &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          return null
        }
        throw error
      }
    },

    writeFile: async function (
      filePath: string,
      content: string
    ): Promise<void> {
      if (!isInitialized || workDir == null) {
        throw new Error('Repo not initialized')
      }
      const fullPath = path.join(workDir, filePath)

      // Ensure directory exists
      const dirPath = path.dirname(fullPath)
      await mkdir(dirPath, { recursive: true })

      await writeFile(fullPath, content, 'utf8')
    },

    getLastCommitHash: async function (
      filePath: string
    ): Promise<string | null> {
      if (!isInitialized || git == null) {
        throw new Error('Repo not initialized')
      }

      try {
        // Get the last commit that modified this file
        const result = await git.log({
          file: filePath,
          maxCount: 1,
          format: { hash: '%H' }
        })

        return result.latest?.hash ?? null
      } catch (error) {
        // File might not exist in git yet, or other error
        return null
      }
    },

    commitAndPush: async function (
      filePath: string,
      commitMessage: string
    ): Promise<void> {
      if (!isInitialized || git == null) {
        throw new Error('Repo not initialized')
      }

      // Add the file
      await git.add(filePath)

      // Check if there are changes to commit
      const status = await git.status()
      if (status.files.length === 0) {
        log('No changes to commit')
        return
      }

      // Commit
      await git.commit(commitMessage)
      log(`Committed: ${commitMessage}`)

      // Try to push
      try {
        await git.push('origin', 'master')
        log('Successfully pushed to remote')
      } catch (error: unknown) {
        log('Push failed, resetting and retrying...')
        // Reset to remote and reapply changes
        await this.resetToRemote()
        // Re-write the file (caller's content is still valid)
        // Note: The caller will need to re-write after this throws
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Push conflict - need to reapply changes: ${message}`)
      }
    },

    cleanup: async function (): Promise<void> {
      if (workDir != null && workDir !== '') {
        await rm(workDir, { recursive: true, force: true })
        log(`Cleaned up temp dir: ${workDir}`)
        workDir = null
        git = null
        isInitialized = false
      }
    }
  }

  /**
   * Clone repository to work directory
   */
  async function cloneRepo(workDirPath: string): Promise<string> {
    log(`Cloning repository to: ${workDirPath}`)

    // Ensure parent directory exists
    await mkdir(path.dirname(workDirPath), { recursive: true })

    // Clone the repository
    await simpleGit().clone(repoUrl, workDirPath)

    // Create git instance for the cloned repo
    const gitInstance = simpleGit(workDirPath)
    git = gitInstance

    // Checkout master branch
    await gitInstance.checkout('master')
    log('Checked out master branch')

    workDir = workDirPath
    isInitialized = true
    return workDirPath
  }

  return repo
}
