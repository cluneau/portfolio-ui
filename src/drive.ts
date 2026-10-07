/**
 * Loading a database out of the user's Google Drive.
 *
 * The site is a static page with no server of its own, so the whole exchange
 * runs in the browser: Google Identity Services hands out an access token,
 * Google's own Picker turns that token into a chosen file, and the file's bytes
 * come back over one authenticated fetch.
 *
 * The scope is `drive.file`, not `drive.readonly`. The page is served publicly,
 * and a token that can read the whole of someone's Drive is far more than
 * opening one database needs; `drive.file` reaches the files the user picks and
 * nothing else. That is also why the Picker is not a cosmetic choice here —
 * under this scope there is no listing to browse, and picking a file is the act
 * that grants access to it.
 *
 * Google's two scripts are fetched on demand rather than from the page's
 * markup, so someone who only ever loads a local file never talks to Google.
 */

import { API_KEY, APP_ID, CLIENT_ID } from './google-config'

const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const GIS_SRC = 'https://accounts.google.com/gsi/client'
const GAPI_SRC = 'https://apis.google.com/js/api.js'

/** Whether `google-config.ts` has been filled in. */
const configured = Boolean(CLIENT_ID && API_KEY && APP_ID)

/** The user closed the sign-in window or the Picker. Not a failure. */
class Cancelled extends Error {}

const scripts = new Map<string, Promise<void>>()

function loadScript(src: string): Promise<void> {
  let pending = scripts.get(src)
  if (!pending) {
    pending = new Promise<void>((resolve, reject) => {
      const element = document.createElement('script')
      element.src = src
      element.async = true
      element.addEventListener('load', () => resolve())
      element.addEventListener('error', () => {
        // Dropped from the cache so a later attempt can retry: the usual cause
        // is a dead connection, not a bad URL.
        scripts.delete(src)
        element.remove()
        reject(new Error('Could not reach Google. Check your connection and try again.'))
      })
      document.head.append(element)
    })
    scripts.set(src, pending)
  }
  return pending
}

/**
 * Fetches Google's scripts ahead of the click that needs them. Starting on the
 * way to the button rather than on the button keeps the sign-in window inside
 * the gesture that asked for it, which is what browsers require before they
 * allow a pop-up.
 */
export function prefetchDrive(): void {
  if (!configured) return
  // A failure here is not worth reporting; the click retries and can explain
  // itself then.
  void loadScript(GIS_SRC).catch(() => {})
  void loadScript(GAPI_SRC).catch(() => {})
}

interface Token {
  value: string
  expiresAt: number
}

let token: Token | null = null
/** Whether consent has already been given, so a refresh can stay silent. */
let granted = false

function requestToken(): Promise<Token> {
  return new Promise<Token>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (response) => {
        if (!response.access_token) {
          reject(
            new Error(
              response.error_description ??
                response.error ??
                'Google did not return an access token.',
            ),
          )
          return
        }
        granted = true
        resolve({
          value: response.access_token,
          // A minute short of the stated lifetime, so a token cannot expire
          // between the check that accepts it and the request that uses it.
          expiresAt: Date.now() + (Number(response.expires_in) || 3600) * 1000 - 60_000,
        })
      },
      error_callback: (error) => {
        if (error.type === 'popup_closed') {
          reject(new Cancelled('Sign-in closed.'))
        } else if (error.type === 'popup_failed_to_open') {
          reject(
            new Error(
              'The browser blocked Google’s sign-in window. Allow pop-ups for this site, then try again.',
            ),
          )
        } else {
          reject(new Error(`Google sign-in failed: ${error.message ?? error.type}`))
        }
      },
    })
    client.requestAccessToken(granted ? { prompt: '' } : {})
  })
}

async function accessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now()) return token.value
  await loadScript(GIS_SRC)
  token = await requestToken()
  return token.value
}

async function loadPicker(): Promise<void> {
  await loadScript(GAPI_SRC)
  await new Promise<void>((resolve, reject) => {
    gapi.load('picker', {
      callback: () => resolve(),
      onerror: () => reject(new Error('Could not load the Google Picker.')),
    })
  })
}

function pickDoc(active: string): Promise<PickedDoc> {
  return new Promise<PickedDoc>((resolve, reject) => {
    // No MIME filter: Drive has no type for a DuckDB file, so it is stored as
    // whatever the uploading client guessed. Filtering would hide the very file
    // the user came for; a wrong pick is caught when the database is opened.
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setMode(google.picker.DocsViewMode.LIST)

    let picker: PickerInstance | null = null
    picker = new google.picker.PickerBuilder()
      .setTitle('Choose a database file')
      .setAppId(APP_ID)
      .setDeveloperKey(API_KEY)
      .setOAuthToken(active)
      .addView(view)
      .setCallback((data) => {
        // The Picker also reports its own loading; only the two outcomes below
        // end the wait.
        if (data.action === google.picker.Action.PICKED) {
          picker?.dispose()
          const doc = data.docs?.[0]
          if (!doc) {
            reject(new Error('Google Drive returned no file.'))
          } else if (doc.mimeType?.startsWith('application/vnd.google-apps')) {
            // A Doc or a Sheet has no bytes to download, only an export.
            reject(new Error(`“${doc.name}” is a Google Docs file, not a database.`))
          } else {
            resolve(doc)
          }
        } else if (data.action === google.picker.Action.CANCEL) {
          picker?.dispose()
          reject(new Cancelled('Picker closed.'))
        }
      })
      .build()
    picker.setVisible(true)
  })
}

export interface DriveProgress {
  loaded: number
  /** Total bytes, or 0 when Drive did not say how big the file is. */
  total: number
}

/**
 * The file's bytes, as a `File` the rest of the app cannot tell apart from a
 * locally picked one. Unlike a local file, this one is held in memory in full:
 * duckdb-wasm reads a local handle by random access, and an authenticated Drive
 * download has no equivalent — the bearer token has nowhere to live in a range
 * request the worker would make on its own.
 */
async function download(
  doc: PickedDoc,
  active: string,
  onProgress: (progress: DriveProgress) => void,
): Promise<File> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${active}` } },
  )
  if (!response.ok) {
    throw new Error(
      `Google Drive refused the download (${response.status} ${response.statusText}).`,
    )
  }

  const total = Number(doc.sizeBytes ?? response.headers.get('content-length') ?? 0)
  const body = response.body
  if (!body) return new File([await response.blob()], doc.name)

  // Read in chunks rather than awaiting a blob, so a multi-megabyte database
  // can report progress instead of leaving the page looking stalled.
  const reader = body.getReader()
  const chunks: BlobPart[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    // A stream chunk is typed as possibly backed by a SharedArrayBuffer, which
    // `Blob` will not take. A fetch body never is.
    chunks.push(value as BlobPart)
    loaded += value.byteLength
    onProgress({ loaded, total })
  }
  return new File(chunks, doc.name)
}

/**
 * Signs in if needed, shows the Picker and downloads what was chosen. Returns
 * null when the user backs out, which is not an error worth reporting.
 */
export async function pickFromDrive(
  onProgress: (progress: DriveProgress) => void,
): Promise<File | null> {
  if (!configured) {
    throw new Error(
      'Google Drive needs a one-time setup first. See .env.example, which lists the steps.',
    )
  }
  try {
    const active = await accessToken()
    await loadPicker()
    const doc = await pickDoc(active)
    return await download(doc, active, onProgress)
  } catch (err) {
    if (err instanceof Cancelled) return null
    // A token can be rejected after it was cached — revoked, or the clock was
    // wrong — so it is dropped here and the next attempt asks for a fresh one.
    token = null
    throw err
  }
}

/* --- the parts of Google's two globals this module uses ---
   Full typings ship as separate dependency packages; the handful of members
   below keep the app's dependencies to duckdb and Arrow. */

interface TokenResponse {
  access_token?: string
  expires_in?: string | number
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
}

interface PickedDoc {
  id: string
  name: string
  mimeType?: string
  sizeBytes?: string | number
}

interface PickerData {
  action: string
  docs?: PickedDoc[]
}

interface PickerInstance {
  setVisible(visible: boolean): void
  dispose(): void
}

interface DocsView {
  setIncludeFolders(include: boolean): DocsView
  setSelectFolderEnabled(enabled: boolean): DocsView
  setMode(mode: string): DocsView
}

interface PickerBuilder {
  setTitle(title: string): PickerBuilder
  setAppId(appId: string): PickerBuilder
  setDeveloperKey(key: string): PickerBuilder
  setOAuthToken(token: string): PickerBuilder
  addView(view: DocsView): PickerBuilder
  setCallback(callback: (data: PickerData) => void): PickerBuilder
  build(): PickerInstance
}

declare global {
  var gapi: {
    load(name: string, callbacks: { callback: () => void; onerror: () => void }): void
  }
  var google: {
    accounts: {
      oauth2: {
        initTokenClient(config: {
          client_id: string
          scope: string
          callback: (response: TokenResponse) => void
          error_callback?: (error: { type: string; message?: string }) => void
        }): TokenClient
      }
    }
    picker: {
      Action: { PICKED: string; CANCEL: string }
      ViewId: { DOCS: string }
      DocsViewMode: { LIST: string }
      DocsView: new (viewId: string) => DocsView
      PickerBuilder: new () => PickerBuilder
    }
  }
}
