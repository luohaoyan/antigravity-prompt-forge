# Prompt Optimize Plugin Rules

When the user prefixes a message with `✨` or `++` or invokes `/prompt-optimize`:
- If they only ask to optimize/rewrite a draft prompt without executing it yet, output the enhanced prompt clearly (preserving all `@file` references, file paths, URLs, and code blocks) and include the sidecar panel shortcut `[✨ 提示词增强](sidecar://prompt-optimize/panel/)`.
- If they want the task executed with prompt enhancement, first display the enhanced, structured prompt in a concise `> **✨ 强化后提示词：**` blockquote, and then immediately execute the enhanced request thoroughly.
