'use strict';

/**
 * Patch 10A: Transform MCP tool names to built-in names for webview rendering.
 *
 * Two parts:
 *  1. patch-10a        — insert the `_transformForWebview` helper just before the
 *                        io_message for-await loop in launchClaude.
 *  2. patch-10a-loop   — replace the `this.send({ type: "io_message", ... })` emit
 *                        block so it sends the transformed message and passes the
 *                        transformed message to the post-processor.
 *
 * Notes on version compatibility:
 *   In v2.1.112 the for-await loop was expanded into a block and a `bridge_state`
 *   branch was added before the `this.send({...})` call:
 *
 *     for await (let L of z) {
 *       if (L.type === "system" && L.subtype === "bridge_state") { ... continue }
 *       this.send({ type: "io_message", channelId: K, message: L, done: !1 }), _a(L)
 *     }
 *
 *   We therefore anchor patch-10a-loop on the `this.send({` line (not the for-await
 *   line as in earlier versions), use the surrounding `io_message` context to
 *   disambiguate from the unrelated speech-to-text and request emitters, and
 *   replace only the 6 send lines while leaving the for-await / bridge_state code
 *   untouched.
 */

const patch10aFunc = {
    id: 'patch-10a',
    name: 'io_message MCP→builtin name transform',

    appliedCheck: /_transformForWebview/,

    anchor: {
        // The for-await loop that drives io_message emission in launchClaude.
        pattern: /for await \(let \w+ of \w+\)/,
        context: /io_message/,
        // In v2.1.112 the `type: "io_message"` line sits ~16 lines below the
        // for-await line (because of the new bridge_state branch), so the default
        // ±15 context window is too tight — widen it.
        contextRange: 30,
        hint: 'for-await loop in launchClaude that sends io_messages'
    },

    insertAt: {
        searchRange: 5,
        pattern: /for await \(let \w+ of \w+\)/,
        relation: 'before'
    },

    detectVars: (ctx) => {
        const forMatch = ctx.match(/for await \(let (\w+) of (\w+)\)/);
        const chMatch = ctx.match(/channelId:\s*(\w+)/);
        return {
            iterVar: forMatch ? forMatch[1] : 'L',
            queryVar: forMatch ? forMatch[2] : 'z',
            channelVar: chMatch ? chMatch[1] : 'K'
        };
    },

    generate: (vars) => `                // --- forceLocal: transform MCP tool names to built-in names for webview rendering ---
                var _mcpToBuiltinName = {
                    "mcp__claude-vscode__read_file": "Read",
                    "mcp__claude-vscode__write_file": "Write",
                    "mcp__claude-vscode__edit_file": "Edit",
                    "mcp__claude-vscode__glob": "Glob",
                    "mcp__claude-vscode__grep": "Grep",
                    "mcp__claude-vscode__bash": "Bash"
                };
                var _transformForWebview = function(${vars.iterVar}) {
                    if (!isForceLocalMode()) return ${vars.iterVar};
                    // Primary path: transform assistant messages with tool_use content blocks
                    if (${vars.iterVar}.type === "assistant" && ${vars.iterVar}.message && Array.isArray(${vars.iterVar}.message.content)) {
                        var _changed = false;
                        var _newContent = ${vars.iterVar}.message.content.map(function(c) {
                            if (c.type === "tool_use" && c.name && _mcpToBuiltinName[c.name]) {
                                _changed = true;
                                var _transformed = Object.assign({}, c, { name: _mcpToBuiltinName[c.name] });
                                if (_transformed.input && _transformed.input.file_path) {
                                    try {
                                        var _rt_xf = require("./src/remote-tools");
                                        _transformed.input = Object.assign({}, _transformed.input, {
                                            file_path: _rt_xf.toRemotePath(_transformed.input.file_path)
                                        });
                                    } catch (_) {}
                                }
                                return _transformed;
                            }
                            return c;
                        });
                        if (_changed) return Object.assign({}, ${vars.iterVar}, { message: Object.assign({}, ${vars.iterVar}.message, { content: _newContent }) });
                    }
                    return ${vars.iterVar};
                };`
};

const patch10aLoop = {
    id: 'patch-10a-loop',
    name: 'io_message loop body transform',

    // Match any iterVar (e.g. _D in v2.1.71, _L in v2.1.112).
    appliedCheck: /var _\w+ = _transformForWebview\(\w+\)/,

    anchor: {
        // The `this.send({` call inside the io_message for-await loop body.
        // Only one of the 20 `this.send({` sites in extension.js has `io_message`
        // nearby, so the context check uniquely disambiguates it.
        pattern: /this\.send\(\{/,
        context: /io_message/,
        hint: 'this.send({type:"io_message",...}) inside launchClaude for-await loop'
    },

    insertAt: {
        searchRange: 5,
        pattern: /this\.send\(\{/,
        relation: 'replace',
        // Six lines: `this.send({`, `type:`, `channelId:`, `message:`, `done:`, `}), _a(L)`.
        replaceLines: 6
    },

    detectVars: (ctx) => {
        const forMatch = ctx.match(/for await \(let (\w+) of (\w+)\)/);
        const chMatch = ctx.match(/channelId:\s*(\w+)/);
        // Post-processor call after the send, e.g. `}), _a(L)` in v2.1.112 or
        // `}), jP(D);` in older minifications. Trailing semicolon is optional.
        const postMatch = ctx.match(/\), (\w+)\(\w+\);?/);
        return {
            iterVar: forMatch ? forMatch[1] : 'L',
            queryVar: forMatch ? forMatch[2] : 'z',
            channelVar: chMatch ? chMatch[1] : 'K',
            postFn: postMatch ? postMatch[1] : '_a'
        };
    },

    generate: (vars) => `                            var _${vars.iterVar} = _transformForWebview(${vars.iterVar});
                            this.send({
                                type: "io_message",
                                channelId: ${vars.channelVar},
                                message: _${vars.iterVar},
                                done: !1
                            }), ${vars.postFn}(_${vars.iterVar})`
};

module.exports = [patch10aFunc, patch10aLoop];
