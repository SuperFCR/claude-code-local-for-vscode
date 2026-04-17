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
            // In v2.1.112 the closing </style> is ~20 lines below the anchor,
            // outside the default ±15 window. Widen contextRange and rely on a
            // neighbouring CSS variable (4 lines above) for disambiguation.
            context: /--vscode-editor-font-family|<\/style>/,
            contextRange: 25,
            hint: ':root CSS variables in getHtmlForWebview template'
        },

        insertAt: {
            // In v2.1.112 the </style> closing tag is ~20 lines below the anchor
            // (extra CSS blocks for #claude-error were added). Widen the search.
            searchRange: 30,
            // The </style> closing tag after :root CSS
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
            // In v2.1.112 the `initialPrompt` / `initialConfiguration` camelCase
            // strings were replaced by hyphenated `data-initial-prompt` etc.
            // Match either the old camelCase or a neighbouring script-block
            // sibling (`IS_FULL_EDITOR`) which is always present.
            context: /IS_FULL_EDITOR|initialConfiguration|initialPrompt|data-initial-prompt/,
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

        dependsOn: 'patch-15b',

        anchor: {
            // Anchor on the always-present `window.IS_SIDEBAR` line instead of the
            // patch-15b-injected `window.FORCE_LOCAL_MODE` line, so dry-run (which
            // doesn't actually apply patch-15b) can still locate the site.
            pattern: /window\.IS_SIDEBAR/,
            context: /IS_FULL_EDITOR/,
            hint: 'Script block containing window.IS_SIDEBAR / window.FORCE_LOCAL_MODE'
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
