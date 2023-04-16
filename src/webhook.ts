import * as core from '@actions/core'
import {createReadStream, readFileSync} from 'fs'
import FormData from 'form-data'
import {HttpClient} from '@actions/http-client'
import {TypedResponse} from '@actions/http-client/lib/interfaces'

const WEBHOOK_URL = 'webhook-url'
const CONTENT = 'content'
const USERNAME = 'username'
const AVATAR_URL = 'avatar-url'
const RAW_DATA = 'raw-data'
const RAW_CONTENT = 'raw-content'
const TITLE = 'title'
const DESCRIPTION = 'description'
const TIMESTAMP = 'timestamp'
const COLOR = 'color'
const NAME = 'name'
const URL = 'url'
const ICON_URL = 'icon-url'
const TEXT = 'text'
const FILENAME = 'filename'
const THREAD_ID = 'thread-id'
const SPLIT_LONG_CONTENT = 'split-long-content'

const TOP_LEVEL_WEBHOOK_KEYS = [CONTENT, USERNAME, AVATAR_URL]
const EMBED_KEYS = [TITLE, DESCRIPTION, TIMESTAMP, COLOR, URL]
const EMBED_AUTHOR_KEYS = [NAME, URL, ICON_URL]
const EMBED_FOOTER_KEYS = [TEXT, ICON_URL]
const EMBED_IMAGE_KEYS = [URL]
const EMBED_THUMBNAIL_KEYS = [URL]

const CONTENT_LIMIT = 2000
const DESCRIPTION_LIMIT = 4096

function createPayload(): Record<string, unknown> {
  // If raw-data provided, load the file and ignore the other parameters
  const rawData = core.getInput(RAW_DATA)
  if (rawData.length > 0) {
    return JSON.parse(readFileSync(rawData, 'utf-8'))
  }

  let webhookPayloadMap: Map<string, unknown>

  // If raw-content is provided, use it in place of content
  const rawContentPath = core.getInput(RAW_CONTENT)
  if (rawContentPath.length > 0) {
    if (core.getInput(CONTENT).length > 0) {
      throw new Error("content and raw-content can't be used at the same time.")
    }
    webhookPayloadMap = parseMapFromParameters([
      RAW_CONTENT,
      USERNAME,
      AVATAR_URL
    ])
  } else {
    webhookPayloadMap = parseMapFromParameters(TOP_LEVEL_WEBHOOK_KEYS)
  }
  const embedPayloadMap = createEmbedObject()
  if (embedPayloadMap.size > 0) {
    webhookPayloadMap.set('embeds', [Object.fromEntries(embedPayloadMap)])
  }
  const webhookPayload = Object.fromEntries(webhookPayloadMap)
  core.info(JSON.stringify(webhookPayload))
  return webhookPayload
}

function createEmbedObject(): Map<string, unknown> {
  const embedPayloadMap = parseMapFromParameters(EMBED_KEYS, 'embed')

  if (embedPayloadMap.size > 0) {
    const embedAuthorMap = parseMapFromParameters(
      EMBED_AUTHOR_KEYS,
      'embed-author'
    )
    if (embedAuthorMap.size > 0) {
      embedPayloadMap.set('author', Object.fromEntries(embedAuthorMap))
    }
    const embedFooterMap = parseMapFromParameters(
      EMBED_FOOTER_KEYS,
      'embed-footer'
    )
    if (embedFooterMap.size > 0) {
      embedPayloadMap.set('footer', Object.fromEntries(embedFooterMap))
    }
    const embedImageMap = parseMapFromParameters(
      EMBED_IMAGE_KEYS,
      'embed-image'
    )
    if (embedImageMap.size > 0) {
      embedPayloadMap.set('image', Object.fromEntries(embedImageMap))
    }
    const embedThumbnailMap = parseMapFromParameters(
      EMBED_THUMBNAIL_KEYS,
      'embed-thumbnail'
    )
    if (embedThumbnailMap.size > 0) {
      embedPayloadMap.set('thumbnail', Object.fromEntries(embedThumbnailMap))
    }
  }

  return embedPayloadMap
}

function parseMapFromParameters(
  parameters: string[],
  inputObjectKey = ''
): Map<string, unknown> {
  // Parse action inputs into discord webhook execute payload
  const parameterMap = new Map<string, unknown>()
  core.info(`inputObjectKey: ${inputObjectKey}`)

  for (let parameter of parameters) {
    const inputKey =
      inputObjectKey !== '' ? `${inputObjectKey}-${parameter}` : parameter
    let value = core.getInput(inputKey)
    if (value === '') {
      continue
    }

    if (parameter === RAW_CONTENT) {
      const rawContentPath = core.getInput(RAW_CONTENT)

      if (rawContentPath.length > 0) {
        parameter = 'content'
        value = readFileSync(rawContentPath, 'utf-8')
      } else {
        throw new Error(`${rawContentPath} is empty.`)
      }
    }

    if (parameter === TIMESTAMP) {
      const parsedDate = new Date(value)
      value = parsedDate.toISOString()
    }

    if (parameter === DESCRIPTION) {
      if (value.length > DESCRIPTION_LIMIT) {
        value = value.substring(0, DESCRIPTION_LIMIT)
      }
    }

    core.info(`${inputKey}: ${value}`)
    if (value.length > 0) parameterMap.set(parameter.replace('-', '_'), value)
  }

  return parameterMap
}

async function handleResponse(response: TypedResponse<unknown>): Promise<void> {
  core.info(
    `Webhook returned ${response.statusCode} with message: ${response.result}. Please see discord documentation at https://discord.com/developers/docs/resources/webhook#execute-webhook for more information`
  )
  if (response.statusCode >= 400) {
    core.error(
      'Discord Webhook Action failed to execute webhook. Please see logs above for details. Error printed below:'
    )
    core.error(JSON.stringify(response))
  }
}

export async function executeWebhook(
  payload: Record<string, unknown>,
  filename: string
): Promise<void> {
  const client = new HttpClient()
  let webhookUrl = core.getInput(WEBHOOK_URL)
  const threadId = core.getInput(THREAD_ID)

  if (core.getBooleanInput(SPLIT_LONG_CONTENT)) {
    const content = payload.content as string

    if (content.length > CONTENT_LIMIT) {
      let remainingContent

      // Start from the end since recursion will cause the base case to run first.
      if (content.length % CONTENT_LIMIT === 0) {
        remainingContent = content.substring(0, content.length - CONTENT_LIMIT)
      } else {
        remainingContent = content.substring(
          0,
          content.length - (content.length % CONTENT_LIMIT)
        )
      }

      payload.content = content.substring(
        remainingContent.length,
        content.length
      )

      await executeWebhook({content: `${remainingContent}`}, '')
    }
  }

  if (threadId !== '') {
    webhookUrl = `${webhookUrl}?thread_id=${threadId}`
  }

  if (filename !== '') {
    const formData = new FormData()
    formData.append('upload-file', createReadStream(filename))
    formData.append('payload_json', JSON.stringify(payload))
    formData.submit(webhookUrl, function (error, response) {
      if (error != null) {
        core.error(`failed to upload file: ${error.message}`)
      } else {
        core.info(
          `successfully uploaded file with status code: ${response.statusCode}`
        )
      }
    })
  } else {
    const response = await client.postJson(webhookUrl, payload)
    await handleResponse(response)
  }
}

async function run(): Promise<void> {
  try {
    core.info('Running discord webhook action...')
    await executeWebhook(createPayload(), core.getInput(FILENAME))
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
