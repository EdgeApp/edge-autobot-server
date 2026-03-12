#!/usr/bin/env node

import {
  asArray,
  asBoolean,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { Client } from 'ssh2'

import { config } from '../config'

// ============================================================================
// Password Storage (populated at runtime via prompt)
// ============================================================================

let sudoPassword: string = ''

// ============================================================================
// Secure Password Prompt (hides input like SSH)
// ============================================================================

async function promptPassword(prompt: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    process.stdout.write(prompt)

    // Switch stdin to raw mode to capture each keypress without echo
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
    }
    process.stdin.resume()
    process.stdin.setEncoding('utf8')

    let password = ''

    const onData = (char: string): void => {
      // Handle Ctrl+C
      if (char === '\u0003') {
        process.stdout.write('\n')
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false)
        }
        process.stdin.pause()
        process.stdin.removeListener('data', onData)
        reject(new Error('Password entry cancelled'))
        return
      }

      // Handle Enter key
      if (char === '\r' || char === '\n') {
        process.stdout.write('\n')
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false)
        }
        process.stdin.pause()
        process.stdin.removeListener('data', onData)
        resolve(password)
        return
      }

      // Handle Backspace (DEL character or backspace)
      if (char === '\u007F' || char === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1)
        }
        return
      }

      // Add character to password (don't echo it)
      password += char
    }

    process.stdin.on('data', onData)
  })
}

// ============================================================================
// Cleaners for Asana API Responses
// ============================================================================

const asAsanaProject = asObject({
  gid: asString,
  name: asString,
  resource_type: asOptional(asString)
})

const asAsanaEnumValue = asObject({
  gid: asString,
  name: asString,
  resource_type: asOptional(asString),
  color: asOptional(asString),
  enabled: asOptional(asBoolean)
})

const asAsanaCustomFieldValue = asObject({
  gid: asString,
  name: asString,
  resource_type: asOptional(asString),
  resource_subtype: asOptional(asString),
  display_value: asOptional(asString),
  date_value: asOptional(asString),
  text_value: asOptional(asString),
  number_value: asOptional(asNumber),
  enum_value: asOptional(asAsanaEnumValue)
})

const asAsanaTask = asObject({
  gid: asString,
  name: asString,
  resource_type: asOptional(asString),
  completed: asOptional(asBoolean),
  due_on: asOptional(asString),
  custom_fields: asOptional(asArray(asAsanaCustomFieldValue)),
  projects: asOptional(asArray(asAsanaProject))
})

const asAsanaTaskList = asObject({
  data: asArray(asAsanaTask)
})

const asAsanaProjectList = asObject({
  data: asArray(asAsanaProject)
})

const asAsanaWorkspace = asObject({
  gid: asString,
  name: asString,
  resource_type: asString
})

const asAsanaWorkspaceList = asObject({
  data: asArray(asAsanaWorkspace)
})

// Types derived from cleaners
type AsanaTask = ReturnType<typeof asAsanaTask>
type AsanaProject = ReturnType<typeof asAsanaProject>

// ============================================================================
// Asana API Client
// ============================================================================

const ASANA_API_BASE = 'https://app.asana.com/api/1.0'

async function asanaRequest(
  endpoint: string,
  options: {
    method?: string
    params?: Record<string, string>
    body?: unknown
  } = {}
): Promise<unknown> {
  const { method = 'GET', params, body } = options

  const url = new URL(`${ASANA_API_BASE}${endpoint}`)
  if (params != null) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.append(key, value)
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.pluginConfig.loginPackage.asanaApiKey}`,
    Accept: 'application/json'
  }

  if (body != null) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `Asana API error ${response.status}: ${response.statusText} - ${errorText}`
    )
  }

  return await response.json()
}

// ============================================================================
// Helper Functions
// ============================================================================

async function findProjectByName(projectName: string): Promise<AsanaProject> {
  const allProjectNames: string[] = []
  const normalizedSearchName = projectName.toLowerCase().trim()

  // First, try to get user's projects (includes projects user is a member of)
  try {
    const userProjectsJson = await asanaRequest('/users/me/projects', {
      params: {
        opt_fields: 'gid,name,resource_type',
        archived: 'false',
        limit: '100'
      }
    })
    const userProjects = asAsanaProjectList(userProjectsJson)

    for (const project of userProjects.data) {
      allProjectNames.push(project.name)
      if (
        project.name === projectName ||
        project.name.toLowerCase().trim() === normalizedSearchName
      ) {
        return project
      }
    }
  } catch (error) {
    // If user projects endpoint fails, continue with workspace search
  }

  // Also search in workspaces
  const workspacesJson = await asanaRequest('/workspaces')
  const workspaces = asAsanaWorkspaceList(workspacesJson)

  if (workspaces.data.length === 0) {
    throw new Error('No workspaces found')
  }

  // Search for project in all workspaces
  for (const workspace of workspaces.data) {
    let offset: string | undefined
    do {
      const params: Record<string, string> = {
        workspace: workspace.gid,
        opt_fields: 'gid,name,resource_type',
        archived: 'false',
        limit: '100'
      }
      if (offset != null) {
        params.offset = offset
      }

      const projectsJson = await asanaRequest('/projects', { params })
      const projects = asAsanaProjectList(projectsJson)

      for (const project of projects.data) {
        // Avoid duplicates
        if (!allProjectNames.includes(project.name)) {
          allProjectNames.push(project.name)
        }
        if (
          project.name === projectName ||
          project.name.toLowerCase().trim() === normalizedSearchName
        ) {
          return project
        }
      }

      // Check for pagination
      const response = projectsJson as { next_page?: { offset?: string } }
      offset = response.next_page?.offset
    } while (offset != null)
  }

  // If not found, show available projects for debugging
  const errorMessage =
    `Project "${projectName}" not found. Available projects:\n` +
    allProjectNames.map(name => `  - "${name}"`).join('\n')
  throw new Error(errorMessage)
}

async function getTasksInProject(projectGid: string): Promise<AsanaTask[]> {
  const tasks: AsanaTask[] = []
  let offset: string | undefined

  do {
    const params: Record<string, string> = {
      opt_fields:
        'gid,name,resource_type,completed,due_on,custom_fields.gid,custom_fields.name,custom_fields.resource_subtype,custom_fields.display_value,custom_fields.date_value,custom_fields.text_value,custom_fields.number_value,custom_fields.enum_value.gid,custom_fields.enum_value.name,projects.gid,projects.name',
      limit: '100'
    }
    if (offset != null) {
      params.offset = offset
    }

    const tasksJson = await asanaRequest(`/projects/${projectGid}/tasks`, {
      params
    })
    const taskList = asAsanaTaskList(tasksJson)

    tasks.push(...taskList.data)

    // Check for pagination
    const response = tasksJson as { next_page?: { offset?: string } }
    offset = response.next_page?.offset
  } while (offset != null)

  return tasks
}

// ============================================================================
// SSH Functions
// ============================================================================

interface SshShell {
  write: (data: string) => void
  onData: (callback: (data: string) => void) => void
  close: () => void
}

async function createSshConnection(host: string): Promise<Client> {
  return await new Promise((resolve, reject) => {
    const conn = new Client()

    conn.on('ready', () => {
      resolve(conn)
    })

    conn.on('error', err => {
      reject(err)
    })

    // Use SSH agent for authentication (handles keys with passphrases)
    const sshAuthSock = process.env.SSH_AUTH_SOCK
    if (sshAuthSock != null && sshAuthSock !== '') {
      conn.connect({
        host,
        port: 22,
        username: process.env.USER ?? 'paul',
        agent: sshAuthSock
      })
    } else {
      // Fallback to reading key files directly
      const privateKeyPath = join(homedir(), '.ssh', 'id_rsa')
      let privateKey: Buffer
      try {
        privateKey = readFileSync(privateKeyPath)
      } catch (error) {
        // Try id_ed25519 as fallback
        try {
          privateKey = readFileSync(join(homedir(), '.ssh', 'id_ed25519'))
        } catch {
          reject(
            new Error(
              `SSH_AUTH_SOCK not set and could not read SSH private key from ${privateKeyPath} or id_ed25519`
            )
          )
          return
        }
      }

      conn.connect({
        host,
        port: 22,
        username: process.env.USER ?? 'paul',
        privateKey
      })
    }
  })
}

async function createShell(conn: Client): Promise<SshShell> {
  return await new Promise((resolve, reject) => {
    conn.shell({ term: 'xterm' }, (err, stream) => {
      if (err != null) {
        reject(err)
        return
      }

      const dataCallbacks: Array<(data: string) => void> = []

      stream.on('data', (data: Buffer) => {
        const str = data.toString()
        for (const cb of dataCallbacks) {
          cb(str)
        }
      })

      stream.on('close', () => {
        conn.end()
      })

      resolve({
        write: (data: string) => stream.write(data),
        onData: (callback: (data: string) => void) => {
          dataCallbacks.push(callback)
        },
        close: () => stream.end()
      })
    })
  })
}

async function waitForPrompt(
  shell: SshShell,
  timeout: number = 30000
): Promise<string> {
  return await new Promise((resolve, reject) => {
    let buffer = ''
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout waiting for shell prompt. Buffer: ${buffer}`))
    }, timeout)

    const onData = (data: string): void => {
      buffer += data

      // Check for common shell prompts ($ or # or >)
      // Also check for password prompt
      if (
        /[$#>]\s*$/.test(buffer) ||
        /password.*:/i.test(buffer) ||
        /\[sudo\].*:/i.test(buffer)
      ) {
        clearTimeout(timeoutId)
        resolve(buffer)
      }
    }

    shell.onData(onData)
  })
}

async function executeCommand(
  shell: SshShell,
  command: string,
  timeout: number = 30000
): Promise<string> {
  return await new Promise((resolve, reject) => {
    let buffer = ''
    let collecting = false
    const timeoutId = setTimeout(() => {
      reject(
        new Error(
          `Timeout executing command "${command}". Buffer: ${buffer.slice(-500)}`
        )
      )
    }, timeout)

    const onData = (data: string): void => {
      buffer += data
      collecting = true

      // Check for shell prompt indicating command completed
      // Look for prompt at the end of the buffer
      if (collecting && /[$#>]\s*$/.test(buffer)) {
        clearTimeout(timeoutId)
        resolve(buffer)
      }
    }

    shell.onData(onData)
    shell.write(command + '\n')
  })
}

async function executeSudoSu(
  shell: SshShell,
  password: string
): Promise<string> {
  return await new Promise((resolve, reject) => {
    let buffer = ''
    let passwordSent = false
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout during sudo su. Buffer: ${buffer.slice(-500)}`))
    }, 30000)

    const onData = (data: string): void => {
      buffer += data

      // Check for authentication failure
      if (passwordSent && /sorry.*try again/i.test(buffer)) {
        clearTimeout(timeoutId)
        reject(new Error('Sudo authentication failed - incorrect password'))
        return
      }

      // Check for password prompt
      if (!passwordSent && /password.*:/i.test(buffer)) {
        passwordSent = true
        // Small delay to ensure TTY is ready
        setTimeout(() => {
          shell.write(password + '\n')
        }, 100)
        return
      }

      // Check for shell prompt after sudo succeeds
      if (passwordSent && /[$#>]\s*$/.test(buffer)) {
        clearTimeout(timeoutId)
        resolve(buffer)
      }
    }

    shell.onData(onData)
    shell.write('sudo su edgy\n')
  })
}

// ============================================================================
// Main Functions
// ============================================================================

interface LoginTask {
  gid: string
  name: string
  loginId: string
  dueOn: string | null
}

interface LoginTasksResult {
  tasks: LoginTask[]
  projectGid: string
}

// Known GID for the loginId custom field
const LOGIN_ID_FIELD_GID = '1212917788838859'

async function getLoginTasks(): Promise<LoginTasksResult> {
  // Find "Paul's tasks" project
  const project = await findProjectByName("Paul's tasks")

  // Get all tasks in the project
  const tasks = await getTasksInProject(project.gid)

  // Filter tasks that have a non-empty loginId
  // The loginId field may not be in project settings but can exist on individual tasks
  const loginTasks: LoginTask[] = []

  for (const task of tasks) {
    if (task.custom_fields == null) {
      continue
    }

    // Look for loginId field by GID or by name
    const loginIdField = task.custom_fields.find(cf => {
      if (cf.gid === LOGIN_ID_FIELD_GID) return true
      const normalizedName = cf.name.toLowerCase().trim()
      return (
        normalizedName === 'loginid' ||
        normalizedName === 'login id' ||
        normalizedName === 'login_id'
      )
    })

    if (loginIdField != null) {
      const loginIdValue = loginIdField.text_value ?? loginIdField.display_value

      // Only include tasks with non-empty loginId
      if (loginIdValue != null && loginIdValue.trim() !== '') {
        loginTasks.push({
          gid: task.gid,
          name: task.name,
          loginId: loginIdValue.trim(),
          dueOn: task.due_on ?? null
        })
      }
    }
  }

  // Sort by due date: oldest first, tasks without due date at the end
  loginTasks.sort((a, b) => {
    if (a.dueOn == null && b.dueOn == null) return 0
    if (a.dueOn == null) return 1 // a goes after b
    if (b.dueOn == null) return -1 // b goes after a
    return new Date(a.dueOn).getTime() - new Date(b.dueOn).getTime()
  })

  return { tasks: loginTasks, projectGid: project.gid }
}

interface SshSession {
  conn: Client
  shell: SshShell
}

async function connectAndAuthenticate(): Promise<SshSession> {
  const host = 'login-wusa1.edge.app'

  console.log(`\nConnecting to ${host}...`)
  const conn = await createSshConnection(host)
  console.log('Connected.')

  const shell = await createShell(conn)

  // Wait for initial shell prompt
  console.log('Waiting for shell prompt...')
  await waitForPrompt(shell)

  // Execute sudo su edgy to verify password
  console.log('Executing: sudo su edgy')
  await executeSudoSu(shell, sudoPassword)
  console.log('Switched to edgy user. Authentication successful.\n')

  return { conn, shell }
}

function closeSession(session: SshSession): void {
  session.shell.close()
  session.conn.end()
  console.log('SSH connection closed.')
}

interface LoginPackageResult {
  task: LoginTask
  success: boolean
  jsonOutput: Record<string, unknown> | null
}

function parseAndValidateJson(output: string): Record<string, unknown> | null {
  // Try to find JSON in the output (it might be surrounded by other text)
  const jsonMatch = /\{[\s\S]*\}/.exec(output)
  if (jsonMatch == null) {
    return null
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    // Validate it has at least 5 keys
    if (Object.keys(parsed).length >= 5) {
      return parsed
    }
    console.log(
      `  ⚠ JSON has only ${Object.keys(parsed).length} keys (need at least 5)`
    )
    return null
  } catch {
    return null
  }
}

async function executeLoginPackageCommands(
  session: SshSession,
  loginTasks: LoginTask[]
): Promise<LoginPackageResult[]> {
  const results: LoginPackageResult[] = []

  for (const task of loginTasks) {
    console.log('='.repeat(60))
    console.log(`Task: ${task.name}`)
    console.log(`Login ID: ${task.loginId}`)
    console.log(`Asana: https://app.asana.com/0/0/${task.gid}`)
    console.log('='.repeat(60))

    const command = `glp ${task.loginId}`
    console.log(`Executing: ${command}\n`)

    try {
      const output = await executeCommand(session.shell, command, 60000)
      // Print the output (strip the command echo and final prompt)
      const lines = output.split('\n')
      // Skip the first line (command echo) and clean up
      const cleanOutput = lines.slice(1).join('\n').trim()
      console.log(cleanOutput)

      // Parse and validate JSON
      const jsonOutput = parseAndValidateJson(cleanOutput)
      if (jsonOutput != null) {
        console.log('  ✓ Valid JSON response with 5+ keys')
        results.push({ task, success: true, jsonOutput })
      } else {
        console.log('  ✗ Invalid or missing JSON response')
        results.push({ task, success: false, jsonOutput: null })
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      console.log(`Error: ${errMsg}`)
      results.push({ task, success: false, jsonOutput: null })
    }

    console.log('\n')
  }

  return results
}

// ============================================================================
// User Input Helper
// ============================================================================

async function waitForConfirmation(prompt: string): Promise<boolean> {
  return await new Promise((resolve, reject) => {
    process.stdout.write(prompt)

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
    }
    process.stdin.resume()
    process.stdin.setEncoding('utf8')

    const onData = (char: string): void => {
      // Handle Ctrl+C
      if (char === '\u0003') {
        process.stdout.write('\n')
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false)
        }
        process.stdin.pause()
        process.stdin.removeListener('data', onData)
        reject(new Error('Cancelled'))
        return
      }

      // Echo the character and resolve
      process.stdout.write(char + '\n')
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false)
      }
      process.stdin.pause()
      process.stdin.removeListener('data', onData)
      resolve(char.toUpperCase() === 'Y')
    }

    process.stdin.on('data', onData)
  })
}

// ============================================================================
// Asana Task Update Functions
// ============================================================================

// Known GID for Asana Status field
const STATUS_FIELD_GID = '1190660107346181'

async function getVerificationNeededGid(): Promise<string> {
  // Fetch the Status custom field to find the "Verification Needed" enum option
  const fieldResponse = await asanaRequest(
    `/custom_fields/${STATUS_FIELD_GID}`,
    {
      params: { opt_fields: 'gid,name,enum_options.gid,enum_options.name' }
    }
  )

  const fieldData = fieldResponse as {
    data?: { enum_options?: Array<{ gid: string; name: string }> }
  }
  const enumOptions = fieldData.data?.enum_options ?? []

  const verificationNeeded = enumOptions.find(
    opt => opt.name.toLowerCase() === 'verification needed'
  )

  if (verificationNeeded == null) {
    throw new Error(
      'Could not find "Verification Needed" status option. Available options: ' +
        enumOptions.map(o => o.name).join(', ')
    )
  }

  return verificationNeeded.gid
}

async function updateTaskForVerification(
  taskGid: string,
  projectGid: string,
  statusOptionGid: string
): Promise<void> {
  // Update task: set status to Verification Needed, remove assignee
  const updateBody = {
    data: {
      assignee: null,
      custom_fields: {
        [STATUS_FIELD_GID]: statusOptionGid
      }
    }
  }

  await asanaRequest(`/tasks/${taskGid}`, {
    method: 'PUT',
    body: updateBody
  })

  // Remove task from Paul's tasks project
  const removeProjectBody = {
    data: {
      project: projectGid
    }
  }

  await asanaRequest(`/tasks/${taskGid}/removeProject`, {
    method: 'POST',
    body: removeProjectBody
  })
}

async function updateSuccessfulTasks(
  results: LoginPackageResult[],
  projectGid: string
): Promise<void> {
  const successfulResults = results.filter(r => r.success)

  if (successfulResults.length === 0) {
    console.log('No tasks with valid JSON responses to update.')
    return
  }

  console.log(`\n${successfulResults.length} task(s) had valid JSON responses:`)
  for (const result of successfulResults) {
    console.log(`  - ${result.task.name}`)
  }

  const confirmed = await waitForConfirmation(
    '\nUpdate these tasks to "Verification Needed", remove assignee, and remove from Paul\'s Tasks? (y/n): '
  )

  if (!confirmed) {
    console.log('Skipped Asana updates.')
    return
  }

  // Get the Verification Needed enum option GID
  console.log('\nFetching Asana field configuration...')
  const statusOptionGid = await getVerificationNeededGid()

  // Update each successful task
  for (const result of successfulResults) {
    console.log(`Updating task: ${result.task.name}...`)
    try {
      await updateTaskForVerification(
        result.task.gid,
        projectGid,
        statusOptionGid
      )
      console.log(`  ✓ Updated successfully`)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      console.log(`  ✗ Error: ${errMsg}`)
    }
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  // Prompt for sudo password securely
  console.log('Sudo Password Required')
  console.log('This will be used for "sudo su edgy" on login-wusa1.edge.app')
  sudoPassword = await promptPassword('Password: ')

  if (sudoPassword === '') {
    console.error('Error: Password cannot be empty')
    process.exit(1)
  }

  // Connect and authenticate FIRST before querying Asana
  let session: SshSession
  try {
    session = await connectAndAuthenticate()
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error(`\nAuthentication failed: ${errMsg}`)
    process.exit(1)
  }

  try {
    // Now that we're authenticated, fetch tasks from Asana
    console.log('Fetching login tasks from Asana...')

    const { tasks: loginTasks, projectGid } = await getLoginTasks()

    if (loginTasks.length === 0) {
      console.log('No tasks found with loginId field.')
      return
    }

    console.log(
      `Found ${loginTasks.length} tasks with loginId (sorted by due date):`
    )
    for (const task of loginTasks) {
      const dueStr =
        task.dueOn != null ? `[due: ${task.dueOn}]` : '[no due date]'
      console.log(`  - ${task.name} ${dueStr}`)
    }
    console.log('')

    // Execute commands using the existing session
    const results = await executeLoginPackageCommands(session, loginTasks)

    // Close SSH session before prompting for Asana updates
    closeSession(session)

    // Prompt to update successful tasks in Asana
    await updateSuccessfulTasks(results, projectGid)

    console.log('\n' + '='.repeat(60))
    console.log('Complete!')
    console.log('='.repeat(60))
  } catch (error) {
    closeSession(session)
    throw error
  }
}

main().catch((error: unknown) => {
  console.error('Unhandled error:', error)
  process.exit(1)
})
