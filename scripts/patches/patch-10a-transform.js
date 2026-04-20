'use strict';

/**
 * Patch 10A: Transform MCP tool names to built-in names for webview rendering.
 * Two parts:
 *  1. Insert the _transformForWebview function before the for-await loop
 *  2. Replace the loop body to use _transformForWebview
 */

const patch10aFunc = {
    id: 'patch-10a',
    name: 'io_message MCP→builtin name transform',

    appliedCheck: /_transformForWebview/,

    anchor: {
        // The for-await loop that sends io_messages in launchClaude.
        // v2.1.71 style: `for await (let G of q) this.send({...` (single line)
        // v2.1.112 style: `for await (let L of z) {` (block body with if/continue branches)
        // Match just the for-await header; context filter picks the right loop.
        pattern: /for await \(let \w+ of \w+\)/,
        context: /io_message/,
        // Widen range so the context check reaches past any intervening if-block
        // (v2.1.112 has a `bridge_state` branch before the io_message send).
        contextRange: 25,
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
            iterVar: forMatch ? forMatch[1] : 'D',
            queryVar: forMatch ? forMatch[2] : 'J',
            channelVar: chMatch ? chMatch[1] : 'v'
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

    // Generic applied-check: any `var _X = _transformForWebview(...)` line.
    // (Previously hardcoded `_D`, but iterVar varies by version.)
    appliedCheck: /var _\w+ = _transformForWebview\(\w+\)/,

    anchor: {
        // Same anchor as patch-10a: the for-await header. Context filter picks
        // the io_message loop regardless of v2.1.71 (inline) or v2.1.112 (block) style.
        pattern: /for await \(let \w+ of \w+\)/,
        context: /io_message/,
        contextRange: 25,
        hint: 'for-await loop sending io_messages'
    },

    insertAt: {
        // Find the `this.send({` that starts the io_message send, regardless of
        // whether it's inline with for-await (v2.1.71) or on its own line
        // inside a block body (v2.1.112). Replace 6 lines starting there.
        //   v2.1.71:   matches the `for await (...) this.send({` line directly
        //              → replaceLines=6 rewrites the whole single-statement loop.
        //   v2.1.112:  matches the standalone `this.send({` line inside the block
        //              → replaceLines=6 rewrites just the send sub-block, leaving
        //                the enclosing for-await + bridge_state branch untouched.
        searchRange: 30,
        pattern: /this\.send\(\{/,
        relation: 'replace',
        replaceLines: 6
    },

    detectVars: (ctx) => {
        const forMatch = ctx.match(/for await \(let (\w+) of (\w+)\)/);
        const chMatch = ctx.match(/channelId:\s*(\w+)/);
        // Post-processor function call: matches both
        //   v2.1.71:   `), jP(G);`
        //   v2.1.112:  `}), _a(L)`
        const postMatch = ctx.match(/\}?\),\s*(\w+)\(\w+\)/);
        // Version discriminator (string, per test-patches.js contract that all
        // detectVars outputs be non-empty strings):
        //   "block"  — v2.1.112 style: for-await block body with bridge_state branch
        //   "inline" — v2.1.71 style:  for-await header and this.send({ on same line
        const loopStyle = (/bridge_state/.test(ctx)
            || !/for await \(let \w+ of \w+\) this\.send\(/.test(ctx)) ? 'block' : 'inline';
        return {
            iterVar: forMatch ? forMatch[1] : 'G',
            queryVar: forMatch ? forMatch[2] : 'q',
            channelVar: chMatch ? chMatch[1] : 'z',
            postFn: postMatch ? postMatch[1] : 'jP',
            loopStyle: loopStyle
        };
    },

    generate: (vars) => {
        if (vars.loopStyle === 'block') {
            // v2.1.112: replace only the 6-line `this.send({...}), postFn(L)` sub-block.
            // The enclosing `for await (let L of z) {` and any `bridge_state`
            // branch above remain untouched.
            return `                            var _${vars.iterVar} = _transformForWebview(${vars.iterVar});
                            this.send({
                                type: "io_message",
                                channelId: ${vars.channelVar},
                                message: _${vars.iterVar},
                                done: !1
                            }), ${vars.postFn}(_${vars.iterVar})`;
        }
        // v2.1.71: replace the whole 6-line single-statement loop, re-emit as block body.
        return `                    for await (let ${vars.iterVar} of ${vars.queryVar}) {
                        var _${vars.iterVar} = _transformForWebview(${vars.iterVar});
                        this.send({
                            type: "io_message",
                            channelId: ${vars.channelVar},
                            message: _${vars.iterVar},
                            done: !1
                        });
                        ${vars.postFn}(_${vars.iterVar});
                    }`;
    }
};

module.exports = [patch10aFunc, patch10aLoop];
