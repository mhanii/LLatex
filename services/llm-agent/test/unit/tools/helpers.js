// @ts-check

/**
 * Build a minimal fake Response for globalThis.fetch stubs.
 * @param {number} status
 * @param {unknown} [body]
 */
export function fakeResponse(status, body) {
  const text =
    typeof body === 'string' ? body : body != null ? JSON.stringify(body) : ''
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => text,
  }
}

/** A RunContext with two files already resolved. */
export const CTX = {
  projectId: 'proj123',
  userId: 'user123',
  runId: 'run123',
  context: {
    projectName: 'Test Project',
    compiler: 'pdflatex',
    files: [
      { path: 'main.tex', docId: 'doc111' },
      { path: 'chapters/intro.tex', docId: 'doc222' },
    ],
  },
}

/** Fresh, deep-cloned RunContext — use when a test mutates ctx.context.files. */
export function makeCtx() {
  return {
    projectId: 'proj123',
    userId: 'user123',
    runId: 'run123',
    context: {
      projectName: 'Test Project',
      compiler: 'pdflatex',
      files: [
        { path: 'main.tex', docId: 'doc111' },
        { path: 'chapters/intro.tex', docId: 'doc222' },
      ],
    },
  }
}

let savedFetch

export function stubFetch(handler) {
  savedFetch = globalThis.fetch
  globalThis.fetch = handler
}

export function restoreFetch() {
  if (savedFetch !== undefined) {
    globalThis.fetch = savedFetch
    savedFetch = undefined
  }
}
