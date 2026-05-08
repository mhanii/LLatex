// @ts-check
//
// Ported from services/web/frontend/js/ide/human-readable-logs/HumanReadableLogs.ts
// Upstream sha: 1b5887d97f9b4360cd338ff603cedcb624040749
//
// Refresh procedure:
//   git diff <old-sha>..<new-sha> -- services/web/frontend/js/ide/human-readable-logs/HumanReadableLogs.ts
// Re-apply non-type-annotation changes here, bump the sha above.
//
// Backend port: types stripped. Because the ported Rules return only the
// string form of `improvedTitle` (no JSX), the `Array.isArray` branch below
// can never fire — kept for parity with upstream so future refreshes are
// trivial.

import LatexLogParser from './latex-log-parser.mjs'
import ruleset from './HumanReadableLogsRules.mjs'

export default {
  parse(rawLog, options) {
    const parsedLogEntries =
      typeof rawLog === 'string'
        ? new LatexLogParser(rawLog, options).parse()
        : rawLog

    const seenErrorTypes = {}

    for (const entry of parsedLogEntries.all) {
      const ruleDetails = ruleset.find(rule =>
        rule.regexToMatch.test(entry.message)
      )

      if (ruleDetails) {
        if (ruleDetails.ruleId) {
          entry.ruleId = ruleDetails.ruleId
        }

        if (ruleDetails.newMessage) {
          entry.message = entry.message.replace(
            ruleDetails.regexToMatch,
            ruleDetails.newMessage
          )
        }

        if (ruleDetails.contentRegex) {
          if (entry.content != null) {
            const match = entry.content.match(ruleDetails.contentRegex)
            if (match) {
              entry.contentDetails = match.slice(1)
            }
          }
        }

        if (entry.contentDetails && ruleDetails.improvedTitle) {
          const message = ruleDetails.improvedTitle(
            entry.message,
            entry.contentDetails
          )

          if (Array.isArray(message)) {
            entry.message = message[0]
          } else {
            entry.message = message
          }
        }

        if (entry.contentDetails && ruleDetails.highlightCommand) {
          entry.command = ruleDetails.highlightCommand(entry.contentDetails)
        }

        if (ruleDetails.cascadesFrom) {
          for (const type of ruleDetails.cascadesFrom) {
            if (seenErrorTypes[type]) {
              entry.suppressed = true
            }
          }
        }

        if (ruleDetails.types) {
          for (const type of ruleDetails.types) {
            seenErrorTypes[type] = true
          }
        }
      }
    }

    for (const type of ['errors', 'warnings', 'typesetting']) {
      const errors = parsedLogEntries[type]
      if (Array.isArray(errors) && errors.length > 0) {
        parsedLogEntries[type] = Array.from(errors).filter(
          err => !err.suppressed
        )
      }
    }
    return parsedLogEntries
  },
}
