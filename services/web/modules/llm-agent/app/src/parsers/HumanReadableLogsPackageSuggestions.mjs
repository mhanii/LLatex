// @ts-check
//
// Ported from services/web/frontend/js/ide/human-readable-logs/HumanReadableLogsPackageSuggestions.ts
// Upstream sha: 1b5887d97f9b4360cd338ff603cedcb624040749
//
// Refresh procedure:
//   git diff <old-sha>..<new-sha> -- services/web/frontend/js/ide/human-readable-logs/HumanReadableLogsPackageSuggestions.ts
// Re-apply changes here, bump the sha above.
//
// Backend port: types stripped, runtime identical to upstream.

const commandSuggestions = [
  [
    '\\includegraphics',
    { name: 'graphicx', command: '\\usepackage{graphicx}' },
  ],
  ['\\toprule', { name: 'booktabs', command: '\\usepackage{booktabs}' }],
  ['\\midrule', { name: 'booktabs', command: '\\usepackage{booktabs}' }],
  ['\\bottomrule', { name: 'booktabs', command: '\\usepackage{booktabs}' }],
  ['\\cmidrule', { name: 'booktabs', command: '\\usepackage{booktabs}' }],
  ['\\multirow', { name: 'multirow', command: '\\usepackage{multirow}' }],
  ['\\justifying', { name: 'ragged2e', command: '\\usepackage{ragged2e}' }],
  ['\\tag', { name: 'amsmath', command: '\\usepackage{amsmath}' }],
  ['\\notag', { name: 'amsmath', command: '\\usepackage{amsmath}' }],
  ['\\text', { name: 'amsmath', command: '\\usepackage{amsmath}' }],
  ['\\boldsymbol', { name: 'amsmath', command: '\\usepackage{amsmath}' }],
  ['\\eqref', { name: 'amsmath', command: '\\usepackage{amsmath}' }],
  ['\\iint', { name: 'amsmath', command: '\\usepackage{amsmath}' }],
  ['\\iiint', { name: 'amsmath', command: '\\usepackage{amsmath}' }],
  ['\\nmid', { name: 'amssymb', command: '\\usepackage{amssymb}' }],
  ['\\varnothing', { name: 'amssymb', command: '\\usepackage{amssymb}' }],
  ['\\Box', { name: 'amssymb', command: '\\usepackage{amssymb}' }],
  ['\\citep', { name: 'natbib', command: '\\usepackage{natbib}' }],
  ['\\citet', { name: 'natbib', command: '\\usepackage{natbib}' }],
  ['\\citepalias', { name: 'natbib', command: '\\usepackage{natbib}' }],
  ['\\citetalias', { name: 'natbib', command: '\\usepackage{natbib}' }],
  ['\\url', { name: 'url', command: '\\usepackage{url}' }],
  ['\\href', { name: 'hyperref', command: '\\usepackage{hyperref}' }],
  ['\\texorpdfstring', { name: 'hyperref', command: '\\usepackage{hyperref}' }],
  ['\\phantomsection', { name: 'hyperref', command: '\\usepackage{hyperref}' }],
  ['\\arraybackslash', { name: 'array', command: '\\usepackage{array}' }],
  ['\\includesvg', { name: 'svg', command: '\\usepackage{svg}' }],
]

const environmentSuggestions = [
  ['justify', { name: 'ragged2e', command: '\\usepackage{ragged2e}' }],
  ['align', { name: 'amsmath', command: '\\usepackage{amsmath}' }],
  ['align*', { name: 'amsmath', command: '\\usepackage{amsmath}' }],
  ['split', { name: 'amsmath', command: '\\usepackage{amsmath}' }],
  ['gather', { name: 'amsmath', command: '\\usepackage{amsmath}' }],
  ['cases', { name: 'amsmath', command: '\\usepackage{amsmath}' }],
  ['matrix', { name: 'amsmath', command: '\\usepackage{amsmath}' }],
  ['pmatrix', { name: 'amsmath', command: '\\usepackage{amsmath}' }],
  ['bmatrix', { name: 'amsmath', command: '\\usepackage{amsmath}' }],
  ['subequations', { name: 'amsmath', command: '\\usepackage{amsmath}' }],
]

export const packageSuggestionsForCommands = new Map(commandSuggestions)
export const packageSuggestionsForEnvironments = new Map(environmentSuggestions)
