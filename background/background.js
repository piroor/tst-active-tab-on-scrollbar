/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

import {
  configs
} from '/common/common.js';

const TST_ID = 'treestyletab@piro.sakura.ne.jp';

const stylesForWindow = new Map();

async function registerToTST() {
  try {
    await browser.runtime.sendMessage(TST_ID, {
      type: 'register-self' ,
      name: browser.i18n.getMessage('extensionName'),
      //icons: browser.runtime.getManifest().icons,
      listeningTypes: [
        'sidebar-show',
        'tree-attached',
        'tree-detached',
        'tree-collapsed-state-changed',
      ],
    });
    tryReset();
  }
  catch(_error) {
    // TST is not available
  }
}
configs.$loaded.then(registerToTST);

configs.$addObserver(key => {
  switch (key) {
    case 'colorMode':
    case 'colorCode':
    case 'colorCSSValue':
    case 'opacity':
    case 'width':
      applyStyles();
      return;
  }
});

browser.runtime.onMessageExternal.addListener((message, sender) => {
  switch (sender.id) {
    case TST_ID:
      switch (message.type) {
        case 'ready':
          registerToTST();
          break;

        case 'sidebar-show':
          reserveToUpdateActiveTabMarker(message.windowId);
          break;

        case 'tree-attached':
        case 'tree-detached':
        case 'tree-collapsed-state-changed':
          reserveToUpdateActiveTabMarker(message.tab.windowId);
          break;
      }
      break;
  }
});

browser.tabs.onCreated.addListener(tab => {
  reserveToUpdateActiveTabMarker(tab.windowId);
});

browser.tabs.onActivated.addListener(activeInfo => {
  reserveToUpdateActiveTabMarker(activeInfo.windowId);
});

browser.tabs.onRemoved.addListener((_tabId, removeInfo) => {
  reserveToUpdateActiveTabMarker(removeInfo.windowId);
});

browser.tabs.onMoved.addListener((_tabId, moveInfo) => {
  reserveToUpdateActiveTabMarker(moveInfo.windowId);
});

browser.tabs.onAttached.addListener((_tabId, attachInfo) => {
  reserveToUpdateActiveTabMarker(attachInfo.newWindowId);
});

browser.tabs.onDetached.addListener((_tabId, detachInfo) => {
  reserveToUpdateActiveTabMarker(detachInfo.oldWindowId);
});

browser.tabs.onUpdated.addListener((_tabId, _changeInfo, tab) => {
  reserveToUpdateActiveTabMarker(tab.windowId);
}, { properties: ['pinned'] });

browser.windows.onRemoved.addListener(windowId => {
  stylesForWindow.delete(windowId);
  applyStyles();
});

function reserveToUpdateActiveTabMarker(windowId) {
  const timer = reserveToUpdateActiveTabMarker.timers.get(windowId);
  if (timer)
    clearTimeout(timer);
  reserveToUpdateActiveTabMarker.timers.set(windowId, setTimeout(async () => {
    reserveToUpdateActiveTabMarker.timers.delete(windowId);

    const [regularTabs, treeItems] = await Promise.all([
      browser.tabs.query({ pinned: false, hidden: false, windowId }),
      browser.runtime.sendMessage(TST_ID, {
        type: 'get-tree',
        tabs: '*',
        windowId,
      }),
    ]);

    let activeTabId;
    const regularTabIds = new Set();
    for (const tab of regularTabs) {
      regularTabIds.add(tab.id);
      if (tab.active)
        activeTabId = tab.id;
    }

    if (activeTabId) {
      const visibleItems = treeItems.filter(item => (!item.states.includes('collapsed') && regularTabIds.has(item.id)) || item.id == activeTabId);
      const position = visibleItems.findIndex(item => item.id == activeTabId);
      stylesForWindow.set(windowId, `
        .tabs#window-${windowId}::after {
          height: calc(
            (100%
             - var(--tabbar-top-area-size, 0px)
             - var(--pinned-tabs-area-size)
             - var(--subpanel-area-size)
             - var(--after-tabs-area-size)
             - var(--tabbar-bottom-area-size, 0px)) / ${visibleItems.length}
          );
          top: calc(
            var(--tabbar-top-area-size, 0px)
            + var(--pinned-tabs-area-size)
            + ((100%
                - var(--tabbar-top-area-size, 0px)
                - var(--pinned-tabs-area-size)
                - var(--subpanel-area-size)
                - var(--after-tabs-area-size)
                - var(--tabbar-bottom-area-size, 0px))
               / ${visibleItems.length} * ${position})
          );
        }
      `);
    }
    else {
      stylesForWindow.delete(windowId);
    }

    applyStyles();
  }, 100));
}
reserveToUpdateActiveTabMarker.timers = new Map();

function applyStyles() {
  const color = configs.colorMode == 'CSSValue' ? configs.colorCSSValue : configs.colorCode;
  browser.runtime.sendMessage(TST_ID, {
    type: 'register-self' ,
    style: `
      #tabbar.overflow .tabs::after {
        background: ${color};
        content: " ";
        display: inline-block;
        opacity: ${configs.opacity};
        pointer-events: none;
        position: fixed;
        /*transition: top var(--collapse-animation);*/
        width: ${configs.width};
      }
      :root.left .tabs::after {
        left: 0;
      }
      :root.right .tabs::after {
        right: 0;
      }
      ${Array.from(stylesForWindow.values()).join('\n')}
    `
  });
}

function tryReset() {
  if (tryReset.reserved)
    clearTimeout(tryReset.reserved);
  tryReset.reserved = setTimeout(() => {
    tryReset.reserved = null;
    browser.windows.getAll({}).then(windows => {
      for (const window of windows) {
        reserveToUpdateActiveTabMarker(window.id);
      }
    });
  }, 100);
}
tryReset.reserved = null;
