'use strict';

/**
 * Patch 15: Webview mode badge — CSS + variables + MutationObserver script.
 * Three insertions in the getHtmlForWebview template:
 *  1. CSS after :root { } block
 *  2. Variables after window.IS_SIDEBAR line
 *  3. Badge injection script after the variables
 */
module.exports = [
    {
        id: 'patch-15a',
        name: 'Badge CSS in webview HTML',

        appliedCheck: /force-local-badge/,

        anchor: {
            pattern: /--vscode-chat-font-family:/,
            // v2.1.112 has extra CSS rules between `:root` and `</style>`,
            // pushing `</style>` outside the default 15-line context window.
            // Accept any of the nearby structural markers.
            context: /<style>|<\/style>|getHtmlForWebview|:root/,
            contextRange: 25,
            hint: ':root CSS variables in getHtmlForWebview template'
        },

        insertAt: {
            // Widened so `</style>` is reachable past intervening CSS rules.
            searchRange: 30,
            pattern: /<\/style>/,
            relation: 'before'
        },

        detectVars: () => ({}),

        generate: () => `          .force-local-badge {
            display: inline-flex;
            align-items: center;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            font-size: 11px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            padding: 1px 6px;
            border-radius: 3px;
            margin-right: 4px;
            height: 20px;
            line-height: 20px;
            white-space: nowrap;
            user-select: none;
            pointer-events: none;
          }`
    },
    {
        id: 'patch-15b',
        name: 'Badge variables in webview HTML',

        appliedCheck: /window\.FORCE_LOCAL_MODE/,

        anchor: {
            pattern: /window\.IS_SIDEBAR/,
            // v2.1.71 had `initialConfiguration`/`initialPrompt` nearby.
            // v2.1.112 uses `data-initial-prompt` (with dash) and sibling
            // `window.IS_FULL_EDITOR` / `window.IS_SESSION_LIST_ONLY` flags.
            // Accept any of these markers.
            context: /initial[-_]?[Cc]onfiguration|initial[-_]?[Pp]rompt|IS_FULL_EDITOR|IS_SESSION_LIST_ONLY/,
            hint: 'window.IS_SIDEBAR in webview script block'
        },

        insertAt: {
            searchRange: 3,
            pattern: /window\.IS_SIDEBAR\s*=/,
            relation: 'after'
        },

        detectVars: () => ({}),

        generate: () =>
            '          window.FORCE_LOCAL_MODE = ${isForceLocalMode()?"true":"false"}\n' +
            '          window.IS_REMOTE_ENV = ${(function(){var _v=require("vscode");return !!(_v.env.remoteAuthority||_v.env.remoteName||(_v.workspace.workspaceFolders&&_v.workspace.workspaceFolders.length>0&&_v.workspace.workspaceFolders[0].uri.scheme!=="file"))})()?"true":"false"}'
    },
    {
        id: 'patch-15c',
        name: 'Badge injection script in webview HTML',

        appliedCheck: /__force-local-badge/,

        // Note: depends on patch-15b being applied first (dry-run may report failure)
        dependsOn: 'patch-15b',

        anchor: {
            pattern: /window\.FORCE_LOCAL_MODE/,
            context: /IS_SIDEBAR/,
            hint: 'After window.FORCE_LOCAL_MODE variable injection (from patch-15b)'
        },

        insertAt: {
            searchRange: 10,
            // After the closing </script> of the variables block
            pattern: /<\/script>/,
            relation: 'after'
        },

        detectVars: (ctx) => {
            // Find the nonce variable
            const nonceMatch = ctx.match(/nonce="\$\{(\w+)\}"/);
            return {
                nonceVar: nonceMatch ? nonceMatch[1] : 'B'
            };
        },

        generate: (vars) => `        <script nonce="\${${vars.nonceVar}}">
          (function() {
            if (!window.IS_REMOTE_ENV) return;
            var badgeText = window.FORCE_LOCAL_MODE ? 'UI' : 'Workspace';
            var BADGE_ID = '__force-local-badge';
            function injectBadge() {
              if (document.getElementById(BADGE_ID)) return true;
              var btn = document.querySelector('button[aria-label="New session"]');
              if (!btn) return false;
              var badge = document.createElement('span');
              badge.id = BADGE_ID;
              badge.className = 'force-local-badge';
              badge.textContent = badgeText;
              btn.parentNode.insertBefore(badge, btn);
              return true;
            }
            var root = document.getElementById('root');
            if (!root) return;
            var observer = new MutationObserver(function() {
              injectBadge();
            });
            observer.observe(root, { childList: true, subtree: true });
            injectBadge();
          })();
        </script>`
    }
];
