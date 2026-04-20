'use strict';

/**
 * Patch 08: Register remote tools on in-process MCP server in launchClaude().
 * Includes _reviewEdit callback for review mode.
 * Inserted after AS() server creation and before getAdditionalMcpServers().
 */
module.exports = {
    id: 'patch-08',
    name: 'launchClaude in-process MCP + _reviewEdit',

    appliedCheck: /forceLocal: registered remote tools on in-process MCP server/,

    anchor: {
        // getAdditionalMcpServers() call in launchClaude — right after MCP server creation
        pattern: /\w+ = this\.getAdditionalMcpServers\(\)/,
        context: /file_updated|onExperimentGatesUpdated/,
        hint: 'getAdditionalMcpServers() call in launchClaude, after WP()/AS() MCP server creation'
    },

    insertAt: {
        searchRange: 5,
        // Find the }),  line (end of WP() call) that precedes getAdditionalMcpServers
        // Replace it + the getAdditionalMcpServers line to break the let chain
        pattern: /\}\),\s*$/,
        relation: 'replace',
        replaceLines: 2,
        // Enlarge detectVars context so zodVar detection can reach the zod
        // definition / usage sites, which live in Ri() ~3.5k lines away from
        // this patch's anchor in launchClaude. A value larger than the file
        // length effectively hands the entire source to detectVars.
        contextRange: 100000
    },

    detectVars: (ctx) => {
        // Detect the MCP server variable (x in v2.1.71, j in v2.1.42)
        const serverMatch = ctx.match(/(\w+) = \w+\(\(\w+\) => \{\s*\n\s*this\.onExperimentGatesUpdated/);
        // Detect channelId variable (z in v2.1.71, v in v2.1.42)
        const channelMatch = ctx.match(/channelId:\s*(\w+)/);
        // Detect markdown plan check function (ev in v2.1.71, Dz in v2.1.42)
        const mdCheckMatch = ctx.match(/if \((\w+)\(\w+\)\)[\s\S]*?openMarkdownPreview/);
        // Detect permission mode param — 4th parameter of launchClaude().
        //   v2.1.71:  async launchClaude(W, V, j, U, H) → U
        //   v2.1.112: async launchClaude(K, V, j, G, H) → G
        // Primary: match the function signature directly (authoritative).
        // Fallback: the old spawnClaude() callsite heuristic (kept for out-of-range contexts).
        // Safety net: literal 'undefined' — guarantees the generated code never
        //   throws ReferenceError even if both detections miss. `undefined || x || y`
        //   is a valid JS expression that falls through to the next operand.
        const launchSigMatch = ctx.match(/async\s+launchClaude\s*\(\s*\w+\s*,\s*\w+\s*,\s*\w+\s*,\s*(\w+)\s*,/);
        const spawnMatch = ctx.match(/spawnClaude\(\w+,\s*\w+,[\s\S]*?,\s*\w+,\s*(\w+),/);
        const permVar = (launchSigMatch && launchSigMatch[1])
            || (spawnMatch && spawnMatch[1])
            || 'undefined';
        // Detect the getAdditionalMcpServers result var (O in v2.1.71)
        const addMcpMatch = ctx.match(/([\w$]+) = this\.getAdditionalMcpServers\(\)/);
        // Detect the module-level zod schema variable name. Minifier renames it
        // across versions (s→e→j4). Identify by its usage pattern
        // `<var>.string().describe(...)` — stable across all versions.
        // `ctx` here is limited to ~±100 lines around the anchor, so `.describe()`
        // calls from nearby tool definitions are what we match. If none appear
        // in range, fall back to the full-file scan (done by the caller pipeline
        // via `globalCtx` if provided; else use 'e' as legacy default).
        const zodMatch = ctx.match(/(\w+)\.string\(\)\.describe\(/);
        return {
            serverVar: serverMatch ? serverMatch[1] : 'x',
            channelVar: channelMatch ? channelMatch[1] : 'z',
            mdCheckFn: mdCheckMatch ? mdCheckMatch[1] : 'ev',
            permVar: permVar,
            addMcpVar: addMcpMatch ? addMcpMatch[1] : 'O',
            zodVar: zodMatch ? zodMatch[1] : 'e'
        };
    },

    generate: (vars) => `                });
            // --- forceLocal: register remote file proxy tools on in-process MCP server ---
            if (isForceLocalMode()) {
                try {
                    var _remoteTools2 = require("./src/remote-tools");
                    var _fileUpdatedCb = (D, A, w) => {
                        if (${vars.mdCheckFn}(D)) return;
                        this.send({
                            type: "file_updated",
                            channelId: ${vars.channelVar},
                            filePath: D,
                            oldContent: A,
                            newContent: w
                        });
                    };
                    // --- forceLocal: _reviewEdit callback for review mode ---
                    // Sends tool_permission_request to webview, which triggers dialog + open_diff.
                    // RY() handles the diff tab natively (blocks until Accept/Reject).
                    // User modifications stored via setEditOverride() in RY(), consumed here.
                    var _selfIJ = this;
                    var _forceLocalAcceptAll = false;
                    // Track runtime permission mode (permVar = initial mode from launch_claude)
                    var _forceLocalPermMode = ${vars.permVar} || _selfIJ.settings.getInitialPermissionMode() || "default";
                    var _origSetPermissionMode = _selfIJ.setPermissionMode.bind(_selfIJ);
                    _selfIJ.setPermissionMode = async function(_v, _z) {
                        if (_v === ${vars.channelVar}) _forceLocalPermMode = _z;
                        return _origSetPermissionMode(_v, _z);
                    };
                    var _reviewEdit = async function(mcpToolName, toolInput, oldContent, newContent) {
                        var vsc = require("vscode");
                        var config = vsc.workspace.getConfiguration("claudeCode");
                        var diffMode = config.get("forceLocalDiffMode", "auto");
                        if (diffMode !== "review") return { accepted: true, finalContent: newContent };

                        // Bypass review if permission mode is "bypassPermissions" or "acceptEdits"
                        if (_forceLocalPermMode === "bypassPermissions" || _forceLocalPermMode === "acceptEdits") return { accepted: true, finalContent: newContent };
                        // Bypass review if user chose "allow all edits this session" (button 2)
                        if (_forceLocalAcceptAll) return { accepted: true, finalContent: newContent };

                        var _rt = require("./src/remote-tools");
                        var remotePath = _rt.toRemotePath(toolInput.file_path);

                        // Send tool_permission_request — triggers webview dialog AND open_diff → RY().
                        // RY() handles the diff tab natively (blocks until Accept/Reject).
                        var webviewToolName = mcpToolName === "edit_file" ? "Edit" : "Write";
                        var webviewInputs = Object.assign({}, toolInput, { file_path: remotePath });

                        try {
                            var response = await _selfIJ.sendRequest(${vars.channelVar}, {
                                type: "tool_permission_request",
                                toolName: webviewToolName,
                                inputs: webviewInputs,
                                suggestions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }]
                            }, null);

                            var accepted = response.result.behavior === "allow";

                            if (accepted) {
                                // Check if user chose "allow all edits this session"
                                var perms = response.result.updatedPermissions;
                                if (perms && perms.length > 0) {
                                    for (var _p = 0; _p < perms.length; _p++) {
                                        if (perms[_p].type === "setMode" && perms[_p].mode === "acceptEdits") {
                                            _forceLocalAcceptAll = true;
                                            break;
                                        }
                                    }
                                }
                                // RY() stores user-modified content via setEditOverride() on Accept.
                                // Consume it here; falls back to original newContent if no override.
                                var override = _rt.consumeEditOverride(remotePath);
                                var finalContent = override !== null ? override : newContent;
                                return { accepted: true, finalContent: finalContent };
                            } else {
                                return { accepted: false };
                            }
                        } catch (e) {
                            (_selfIJ.output || _selfIJ.logger).warn("forceLocal: reviewEdit error", e.message || e);
                            return { accepted: false };
                        }
                    };
                    // zodVar is the module-level zod schema — renamed across versions:
                    //   v2.1.42: 's'   v2.1.71: 'e'   v2.1.112: 'j4'
                    // Detected dynamically by detectVars via the .string().describe(...) usage
                    // pattern (same discriminator Patch 04 uses).
                    _remoteTools2.registerTools(${vars.serverVar}.instance, ${vars.zodVar}, this.output || this.logger, _fileUpdatedCb, _reviewEdit);
                    (this.output || this.logger).info("forceLocal: registered remote tools on in-process MCP server. Tools: " + Object.keys(${vars.serverVar}.instance._registeredTools).length);
                } catch (_rtErr2) {
                    (this.output || this.logger).error("forceLocal: FAILED to register remote tools on in-process MCP server: " + (_rtErr2.message || _rtErr2));
                }
            }
            let ${vars.addMcpVar} = this.getAdditionalMcpServers(),`
};
