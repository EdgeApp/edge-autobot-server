#!/usr/bin/env node

import {
  asArray,
  asBoolean,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'
import nano from 'nano'

import { config } from '../config'

// ============================================================================
// Password Storage (populated at runtime via prompt)
// ============================================================================

let couchPassword: string = ''

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

const asAsanaCustomFieldSetting = asObject({
  gid: asString,
  custom_field: asObject({
    gid: asString,
    name: asString,
    resource_type: asString,
    resource_subtype: asString
  }),
  project: asOptional(asAsanaProject),
  is_important: asOptional(asBoolean)
})

const asAsanaCustomFieldSettingsList = asObject({
  data: asArray(asAsanaCustomFieldSetting)
})

// Cleaner for CouchDB document
const asCouchDoc = asObject({
  _id: asString,
  _rev: asString,
  activates: asOptional(asString)
}).withRest

// Types derived from cleaners
type AsanaTask = ReturnType<typeof asAsanaTask>
type AsanaProject = ReturnType<typeof asAsanaProject>
type AsanaCustomFieldSetting = ReturnType<typeof asAsanaCustomFieldSetting>
type CouchDoc = ReturnType<typeof asCouchDoc>

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
    Authorization: `Bearer ${config.pluginConfig.vouchers.asanaApiKey}`,
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
// CouchDB API Client (using Nano)
// ============================================================================

interface VoucherLinkParts {
  database: string
  docId: string
}

function parseVoucherLink(voucherLink: string): VoucherLinkParts {
  // Example: https://logindb-wusa1.edge.app:6984/_utils/#database/login-vouchers-2025-q4/PHWMdG7qUiISCDB0iSgIva7FYmcfrIkUxRgzxHq6C0k%3D:W4gtFeLJqocxjycmHjkX5pucQtAwOh0GL6t2idUfjUQ%3D
  const url = new URL(voucherLink)
  const hash = url.hash // #database/login-vouchers-2025-q4/docId
  const regex = /#database\/([^/]+)\/(.+)$/
  const match = regex.exec(hash)
  if (match == null) {
    throw new Error(`Invalid voucher link format: ${voucherLink}`)
  }
  const database = match[1]
  const docId = decodeURIComponent(match[2])
  return { database, docId }
}

function createCouchConnection(): nano.ServerScope {
  if (config.pluginConfig.vouchers.couchDbUrl === '') {
    throw new Error(
      'pluginConfig.vouchers.couchDbUrl is not configured in serverConfig.json'
    )
  }
  if (config.pluginConfig.vouchers.couchUsername === '') {
    throw new Error(
      'pluginConfig.vouchers.couchUsername is not configured in serverConfig.json'
    )
  }
  if (couchPassword === '') {
    throw new Error('CouchDB password not set. Call promptPassword first.')
  }

  // Parse the URL and inject credentials
  const url = new URL(config.pluginConfig.vouchers.couchDbUrl)
  url.username = config.pluginConfig.vouchers.couchUsername
  url.password = couchPassword

  return nano(url.toString())
}

async function verifyCouchCredentials(): Promise<void> {
  const couch = createCouchConnection()
  // Request session info - this will fail if credentials are invalid
  const session = await couch.session()
  if (session.userCtx?.name == null || session.userCtx.name === '') {
    throw new Error('Authentication failed: Invalid credentials')
  }
}

async function getCouchDocument(
  database: string,
  docId: string
): Promise<CouchDoc> {
  const couch = createCouchConnection()
  const db = couch.use<CouchDoc>(database)
  const doc = await db.get(docId)
  return asCouchDoc(doc)
}

async function updateCouchDocument(
  database: string,
  docId: string,
  doc: CouchDoc
): Promise<void> {
  const couch = createCouchConnection()
  const db = couch.use<CouchDoc>(database)
  await db.insert(doc, docId)
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
// Constants for Asana Custom Fields
// ============================================================================

// Status custom field - verified via Asana MCP typeahead search
const STATUS_CUSTOM_FIELD_GID = '1190660107346181'
const CHANGES_NEEDED_ENUM_GID = '1199619251729194'

// ============================================================================
// ISO Date Validation
// ============================================================================

/**
 * Validates that a date string is a valid full ISO 8601 format with milliseconds
 * and Z timezone suffix (e.g., "2024-01-15T00:00:00.000Z").
 * Returns true if the date is valid, false otherwise.
 */
function isValidIsoDate(dateString: string): boolean {
  // Check format matches YYYY-MM-DDTHH:MM:SS.sssZ
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
  if (!isoDateRegex.test(dateString)) {
    return false
  }

  // Parse the date and verify it's a real date
  const date = new Date(dateString)
  if (isNaN(date.getTime())) {
    return false
  }

  // Verify the date can be serialized back to the same format
  return date.toISOString() === dateString
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
        'gid,name,resource_type,completed,custom_fields.gid,custom_fields.name,custom_fields.resource_subtype,custom_fields.display_value,custom_fields.date_value,custom_fields.text_value,custom_fields.number_value,custom_fields.enum_value.gid,custom_fields.enum_value.name,projects.gid,projects.name',
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

async function getCustomFieldSettings(
  projectGid: string
): Promise<AsanaCustomFieldSetting[]> {
  const params: Record<string, string> = {
    opt_fields:
      'gid,custom_field.gid,custom_field.name,custom_field.resource_type,custom_field.resource_subtype,project.gid,project.name,is_important'
  }

  const settingsJson = await asanaRequest(
    `/projects/${projectGid}/custom_field_settings`,
    { params }
  )
  const settings = asAsanaCustomFieldSettingsList(settingsJson)

  return settings.data
}

async function updateTaskCustomField(
  taskGid: string,
  customFieldGid: string,
  value: string | number
): Promise<AsanaTask> {
  const body = {
    data: {
      custom_fields: {
        [customFieldGid]: value
      }
    }
  }

  const taskResponse = await asanaRequest(`/tasks/${taskGid}`, {
    method: 'PUT',
    body
  })
  // The API returns { data: {...} } for single resource
  const taskData = taskResponse as { data?: unknown }
  return asAsanaTask(taskData.data ?? taskResponse)
}

/**
 * Handles a task with an invalid reset date:
 * 1. Sets the task status to "Changes Needed"
 * 2. Adds a comment "invalid reset date"
 * 3. Unassigns the task
 */
async function handleInvalidResetDate(taskGid: string): Promise<void> {
  // 1. Set status to "Changes Needed"
  await updateTaskCustomField(
    taskGid,
    STATUS_CUSTOM_FIELD_GID,
    CHANGES_NEEDED_ENUM_GID
  )
  console.log('  ✓ Task status set to "Changes Needed"')

  // 2. Add comment "invalid reset date"
  await asanaRequest(`/tasks/${taskGid}/stories`, {
    method: 'POST',
    body: {
      data: {
        text: 'invalid reset date'
      }
    }
  })
  console.log('  ✓ Added comment "invalid reset date"')

  // 3. Unassign the task (set assignee to null)
  await asanaRequest(`/tasks/${taskGid}`, {
    method: 'PUT',
    body: {
      data: {
        assignee: null
      }
    }
  })
  console.log('  ✓ Task unassigned')
}

// ============================================================================
// Main Functions
// ============================================================================

interface VoucherTask {
  gid: string
  name: string
  unlockDate: string | null
  voucherLink: string | null
}

async function getVouchers(): Promise<VoucherTask[]> {
  // Find "Paul's tasks" project
  const project = await findProjectByName("Paul's tasks")

  // Get all tasks in the project
  const tasks = await getTasksInProject(project.gid)

  // Get custom field settings to find field names
  const customFieldSettings = await getCustomFieldSettings(project.gid)

  // Find the custom field GIDs for "Unlock Date" and "Voucher Link"
  let unlockDateFieldGid: string | null = null
  let voucherLinkFieldGid: string | null = null

  for (const setting of customFieldSettings) {
    const fieldName = setting.custom_field.name
    const normalizedFieldName = fieldName.toLowerCase().trim()

    // Match "Unlock Date" or "Unlock date" or "Unlock date (isoDate)" etc.
    if (
      normalizedFieldName.includes('unlock date') ||
      normalizedFieldName === 'unlock date'
    ) {
      unlockDateFieldGid = setting.custom_field.gid
    } else if (
      normalizedFieldName === 'voucher link' ||
      normalizedFieldName === 'voucher url'
    ) {
      voucherLinkFieldGid = setting.custom_field.gid
    }
  }

  if (unlockDateFieldGid == null) {
    throw new Error(
      'Could not find "Unlock Date" custom field in project. Available fields: ' +
        customFieldSettings.map(s => s.custom_field.name).join(', ')
    )
  }

  // Filter tasks that have a non-empty unlock date
  const voucherTasks: VoucherTask[] = []

  for (const task of tasks) {
    // Find unlock date field
    if (task.custom_fields == null) {
      continue
    }

    const unlockDateField = task.custom_fields.find(
      cf => cf.gid === unlockDateFieldGid
    )

    if (unlockDateField != null) {
      const unlockDateValue =
        unlockDateField.date_value ??
        unlockDateField.display_value ??
        unlockDateField.text_value

      // Only include tasks with non-empty unlock date
      if (unlockDateValue != null && unlockDateValue.trim() !== '') {
        // Find voucher link field
        const voucherLinkField =
          voucherLinkFieldGid != null
            ? task.custom_fields.find(cf => cf.gid === voucherLinkFieldGid)
            : null

        const voucherLinkValue =
          voucherLinkField != null
            ? (voucherLinkField.text_value ??
              voucherLinkField.display_value ??
              null)
            : null

        voucherTasks.push({
          gid: task.gid,
          name: task.name,
          unlockDate: unlockDateValue,
          voucherLink: voucherLinkValue
        })
      }
    }
  }

  return voucherTasks
}

async function setVoucherVerified(taskGid: string): Promise<void> {
  // First, get the task to find which project it's in
  // We need to get projects to find which project the task belongs to
  const taskResponse = await asanaRequest(`/tasks/${taskGid}`, {
    params: {
      opt_fields:
        'gid,name,resource_type,projects.gid,projects.name,projects.resource_type'
    }
  })
  // The API returns { data: {...} } for single resource
  const taskData = taskResponse as { data?: unknown }
  const rawTask = taskData.data ?? taskResponse
  const task = asAsanaTask(rawTask)

  if (task.projects == null || task.projects.length === 0) {
    throw new Error(`Task ${taskGid} is not in any project`)
  }

  // Use the first project to find custom field settings
  const projectGid = task.projects[0].gid
  const customFieldSettings = await getCustomFieldSettings(projectGid)

  // Find the "Verified", "Verification Status", or "Status" custom field
  let verifiedFieldGid: string | null = null
  let verifiedFieldType: string | null = null

  for (const setting of customFieldSettings) {
    const fieldName = setting.custom_field.name
    const normalizedFieldName = fieldName.toLowerCase().trim()
    if (
      normalizedFieldName === 'verified' ||
      normalizedFieldName === 'verification status' ||
      normalizedFieldName === 'status' ||
      normalizedFieldName.includes('verification')
    ) {
      verifiedFieldGid = setting.custom_field.gid
      verifiedFieldType = setting.custom_field.resource_subtype
      break
    }
  }

  if (verifiedFieldGid == null) {
    throw new Error(
      'Could not find "Verified", "Verification Status", or "Status" custom field. Available fields: ' +
        customFieldSettings.map(s => s.custom_field.name).join(', ')
    )
  }

  // Determine the value to set based on field type
  let fieldValue: string | number

  if (verifiedFieldType === 'enum') {
    // For enum fields, we need to find the enum option for "verified" or "yes"
    // First, get the custom field details to see available enum options
    const customFieldResponse = await asanaRequest(
      `/custom_fields/${verifiedFieldGid}`,
      {
        params: { opt_fields: 'gid,name,enum_options.gid,enum_options.name' }
      }
    )

    // The API returns { data: {...} } for single resource
    const fieldResponseData = customFieldResponse as { data?: unknown }
    const customFieldJson = fieldResponseData.data ?? customFieldResponse

    // Try to find a "verified" or "yes" option
    const fieldData = customFieldJson as {
      enum_options?: Array<{ gid: string; name: string }>
    }

    if (fieldData.enum_options != null && fieldData.enum_options.length > 0) {
      const verifiedOption = fieldData.enum_options.find(
        opt =>
          opt.name.toLowerCase() === 'verified' ||
          opt.name.toLowerCase() === 'yes' ||
          opt.name.toLowerCase() === 'complete' ||
          opt.name.toLowerCase() === 'verification needed'
      )

      if (verifiedOption != null) {
        // For enum fields, pass the GID string directly
        fieldValue = verifiedOption.gid
      } else {
        // Use the first option if we can't find a match
        fieldValue = fieldData.enum_options[0].gid
      }
    } else {
      throw new Error('Enum field has no options available')
    }
  } else if (verifiedFieldType === 'number') {
    fieldValue = 1
  } else {
    // For text or boolean fields, use a string
    fieldValue = 'verified'
  }

  // Update the task
  await updateTaskCustomField(taskGid, verifiedFieldGid, fieldValue)

  console.log('  ✓ Task marked as verified in Asana')
}

async function processVoucher(voucher: VoucherTask): Promise<boolean> {
  console.log('\n' + '='.repeat(60))
  console.log(`Processing: ${voucher.name}`)
  console.log(`Unlock Date: ${voucher.unlockDate}`)
  console.log('='.repeat(60))

  if (voucher.voucherLink == null) {
    console.log('  ⚠ Skipping: No voucher link')
    return false
  }

  if (voucher.unlockDate == null) {
    console.log('  ⚠ Skipping: No unlock date')
    return false
  }

  // Validate that the unlock date is a valid ISO date
  if (!isValidIsoDate(voucher.unlockDate)) {
    console.log(`  ⚠ Invalid ISO date format: "${voucher.unlockDate}"`)
    console.log('  → Marking task as "Changes Needed"...')
    try {
      await handleInvalidResetDate(voucher.gid)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      console.log(`  ✗ Error handling invalid reset date: ${errMsg}`)
    }
    return false
  }

  // Parse the voucher link to get database and document ID
  let database: string
  let docId: string
  try {
    const parsed = parseVoucherLink(voucher.voucherLink)
    database = parsed.database
    docId = parsed.docId
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.log(`  ⚠ Skipping: ${errMsg}`)
    return false
  }

  console.log(`  Database: ${database}`)
  console.log(`  Document ID: ${docId}`)

  // Fetch the current CouchDB document
  let currentDoc: CouchDoc
  try {
    currentDoc = await getCouchDocument(database, docId)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.log(`  ✗ Error fetching document: ${errMsg}`)
    return false
  }

  const currentActivates = currentDoc.activates ?? '(not set)'
  console.log(`\n  Current 'activates': ${currentActivates}`)
  console.log(`  New 'activates':     ${voucher.unlockDate}`)

  // Create the updated document
  const updatedDoc: CouchDoc = {
    ...currentDoc,
    activates: voucher.unlockDate
  }

  // Show the full updated JSON
  console.log('\n  Updated document JSON:')
  console.log('  ' + '-'.repeat(50))
  const jsonLines = JSON.stringify(updatedDoc, null, 2).split('\n')
  for (const line of jsonLines) {
    console.log(`  ${line}`)
  }
  console.log('  ' + '-'.repeat(50))

  // Wait for user confirmation
  const confirmed = await waitForConfirmation(
    '\n  Update this document? (y/n): '
  )

  if (!confirmed) {
    console.log('  ⚠ Skipped by user')
    return false
  }

  // Update the CouchDB document
  try {
    await updateCouchDocument(database, docId, updatedDoc)
    console.log('  ✓ CouchDB document updated successfully')
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.log(`  ✗ Error updating document: ${errMsg}`)
    return false
  }

  // Mark the Asana task as verified
  try {
    await setVoucherVerified(voucher.gid)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.log(`  ⚠ Warning: Could not mark task as verified: ${errMsg}`)
    // Don't return false here - the CouchDB update succeeded
  }

  return true
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  // Prompt for CouchDB password securely
  console.log('CouchDB Authentication Required')
  console.log(`URL: ${config.pluginConfig.vouchers.couchDbUrl}`)
  console.log(`Username: ${config.pluginConfig.vouchers.couchUsername}`)
  couchPassword = await promptPassword('Password: ')

  if (couchPassword === '') {
    console.error('Error: Password cannot be empty')
    process.exit(1)
  }

  // Verify CouchDB credentials work before proceeding
  console.log('Verifying CouchDB credentials...')
  try {
    await verifyCouchCredentials()
    console.log('Authentication successful.\n')
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error(`\nError: CouchDB authentication failed: ${errMsg}`)
    process.exit(1)
  }

  console.log('Fetching vouchers from Asana...')

  const vouchers = await getVouchers()

  if (vouchers.length === 0) {
    console.log('No vouchers found with unlock dates.')
    return
  }

  // Sort by unlock date (oldest first)
  vouchers.sort((a, b) => {
    const dateA =
      a.unlockDate != null && a.unlockDate !== ''
        ? new Date(a.unlockDate).getTime()
        : Infinity
    const dateB =
      b.unlockDate != null && b.unlockDate !== ''
        ? new Date(b.unlockDate).getTime()
        : Infinity
    return dateA - dateB
  })

  console.log(
    `Found ${vouchers.length} vouchers to process (sorted by oldest unlock date first)`
  )

  let processed = 0
  let skipped = 0

  for (const voucher of vouchers) {
    const success = await processVoucher(voucher)
    if (success) {
      processed++
    } else {
      skipped++
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log(`Complete! Processed: ${processed}, Skipped: ${skipped}`)
  console.log('='.repeat(60))
}

main().catch((error: unknown) => {
  console.error('Unhandled error:', error)
  process.exit(1)
})
