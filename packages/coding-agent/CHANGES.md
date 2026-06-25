# Agent Session — = Prefix Interceptor & Inline Template Substitution

## What Was Done
1. Added an interceptor to the `AgentSession.prompt()` method that detects user inputs starting with the `=` prefix. When detected, the interceptor converts the input (minus the prefix) to uppercase and routes the result to the appropriate output channel based on the input source, followed by an early return to bypass the LLM pipeline.
2. Added inline `{=...}` template substitution to `AgentSession.prompt()`. After the bare `=` interceptor check, a regex replace pass finds any `{=EXPR}` tokens, trims and uppercases the inner expression, and substitutes it in-place before passing the text to the LLM pipeline.

## Files Modified
| File | Line(s) Changed | Description |
|------|----------------|-------------|
| packages/coding-agent/src/core/extensions/types.ts | 557 | Added 'print' to InputSource type. |
| packages/coding-agent/src/modes/print-mode.ts | 121, 125 | Pass { source: 'print' } to prompt calls. |
| packages/coding-agent/src/core/agent-session.ts | 83, 985-1007 | Imported writeRawStdout; implemented interceptor logic and `{=...}` regex substitution. |

## Logic Summary
### 1. Bare `=` Interceptor
1. Check if the `text` input starts with `=`.
2. If it does:
   - Strip the `=` prefix and trim whitespace.
   - Convert the remaining string to UPPERCASE.
   - Determine the input source from `options.source` (defaults to "interactive").
   - Route the result:
     - If source is "rpc": Send via `this.sendCustomMessage` with `customType: 'intercept'`.
     - Otherwise: Print directly to stdout using `writeRawStdout`.
   - Call `options.preflightResult(true)` if provided.
   - Perform an early `return` to skip all LLM processing.

### 2. Inline Template Substitution
If the input does not start with `=`, the following substitution is performed:
```typescript
text = text.replace(/\{=([^}]+)\}/g, (_match, inner: string) => {
    return inner.trim().toUpperCase();
});
```
The modified text is then passed to the LLM pipeline as normal.

## Routing Behavior (Bare `=` only)
- **CLI Interactive Mode**: Uses the default source "interactive". The result is printed directly to the terminal via `writeRawStdout`.
- **RPC Mode**: Uses source "rpc". The result is emitted as a session event via `sendCustomMessage`, which is then forwarded to the RPC client/host.
- **Print Mode**: Uses source "print". The result is written directly to the print output stream via `writeRawStdout`.

## Substitution Behavior
- **Transformation**: `'this is the {=nice}, right?'` → LLM receives `'this is the NICE, right?'`
- **Multiplicity**: Multiple `{=...}` tokens in one prompt are all substituted.
- **Priority**: Bare `=` interceptor still bypasses the LLM entirely (unchanged).
- **Passthrough**: Prompts with no tokens pass through untouched.

## What Was NOT Changed
- The bare `=` interceptor logic, RPC routing, and print mode routing.
- The existing LLM flow remains completely untouched for the final processed text (after substitution).
- All other files in the workspace (beyond the initial interceptor setup).

## How to Test
- **CLI (Interceptor)**: Run `pi` and type `=hello`. You should see `HELLO` printed to the terminal, and the agent should not trigger a turn.
- **CLI (Substitution)**: Type `this is the {=nice}, right?`. The LLM should receive `this is the NICE, right?` and the agent turn should fire normally.
- **RPC**: Send a `prompt` command with message `=test` via RPC. The host should receive a `message_start`/`message_end` event with role `custom` and content `TEST`.
- **Print**: Run `pi -p "=echo"`. The output should be `ECHO`.
