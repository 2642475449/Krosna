// Reused by Claude and Codex UserPromptSubmit hooks; preserve their existing status reporting.
const krosnaContextEvent = typeof hookName === 'string' ? hookName : normalizedEvent;
const krosnaContextReady = (async () => {
  if (typeof agent === 'string' && !['claude', 'codex'].includes(agent)) return;
  if (krosnaContextEvent !== 'userpromptsubmit' || !process.env.KROSNA_RUNTIME_HELPER) return;
  try {
    const helper = require(process.env.KROSNA_RUNTIME_HELPER);
    const context = await helper.getContext({ prompt: input.prompt });
    if (context) await new Promise((resolve) => process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context.text },
    }) + '\n', resolve));
  } catch {}
})();
let krosnaHookFinished = false;
const finishKrosnaHook = () => {
  if (krosnaHookFinished) return;
  krosnaHookFinished = true;
  krosnaContextReady.finally(() => process.exit(0));
};
