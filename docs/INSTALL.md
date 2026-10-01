# In-app installation

The floating install card is shared by the login and dashboard views (including
attendance). It does not open a modal, take focus, or require a portal session.
Desktop visitors keep their browser's normal install UI.

## Browser behavior

| Environment | Card behavior |
|---|---|
| Android with `beforeinstallprompt` | **Install app** opens the browser's native dialog on a tap. The event is consumed once; the button is disabled while awaiting the choice. |
| Android without an install event, or a failed prompt | **How to install** explains the browser-menu fallback. A failed prompt reports an error instead of leaving a broken install button. |
| iPhone/iPad Safari in browser mode | Share and Add to Home Screen icons accompany the instructions. **How to install** expands two inline steps, including the final **Add** confirmation. |
| iOS in another browser | Asks the user to open the page in Safari before following the steps. |
| Standalone (`display-mode: standalone` or `navigator.standalone`) | No card or reserved layout space. |
| Accepted native prompt or `appinstalled` in the current page | Card disappears immediately. |

The controller starts before React mounts, so the deferred native event survives
login, logout, and navigation. It listens for display-mode changes and cleans up
listeners/timers on hot reload. Native dialogs and Safari's Share menu belong to
the browser/OS; the app cannot force install eligibility or automate those menus.

The card uses the existing Material tokens, safe-area insets, 48px touch targets,
and reduced-motion rules. It reserves its measured height at the end of the page
so footer actions can scroll above it. Expanded guidance is scrollable on short
screens. While a focused text field opens the virtual keyboard (detected via
`visualViewport`), the card temporarily hides without recording a dismissal.

## Dismissal and APK fallback

- Closing the card or cancelling the native dialog records an epoch-millisecond
  timestamp in `juet.portal.install.dismissedAt.v1`.
- The cooldown is **14 days**, not permanent. Reloads, login, and logout do not
  reset it. An expiry timer and focus/visibility checks handle long-lived tabs;
  storage events synchronize dismissal across tabs.
- Invalid, expired, or future timestamps do not suppress the card. If storage is
  blocked or full, dismissal still lasts for the current page's lifetime (up to
  14 days). No session keys are cleared or rewritten by the install controller.
- **Or download APK** opens
  <https://github.com/jitendradara12/lazyportal/releases> with `noopener noreferrer`.
  iOS labels this **Android only**. The release page is intentional: there is no
  published APK yet, and #5/#6 own Android packaging/release automation. This
  feature does not guess an asset name, download a binary automatically, or ask
  users to sideload on iOS.

To reset only the install cooldown during manual testing:

```js
localStorage.removeItem("juet.portal.install.dismissedAt.v1");
location.reload();
```

## Automated verification

Use Node 22 and run from the repository root:

```sh
npm ci
npm test
npm --workspace @juet/web run build
npx playwright install --with-deps chromium webkit
npm --workspace @juet/web run test:e2e
```

`npm test` uses mocked browsers, storage, and a clock for install-policy tests,
plus the existing protocol and manifest tests. Browser tests run the actual app
in Chromium/Android and WebKit/iPhone contexts, mock every portal API request,
and inject install events/choices. No real credentials or portal availability
are needed. They cover page transitions, native user activation and failures,
Safari/iPad guidance, standalone suppression, cooldown expiry, cross-tab state,
blocked storage, keyboard visibility, scroll space, narrow/short screens,
ResizeObserver fallback, and reduced motion.

The **Web checks** GitHub Actions workflow runs both suites and the production
build on pull requests and master. Failing browser tests retain traces and
screenshots for seven days.

## Real-device checklist

Browser tests exercise the app's response to install events, not the actual
Android installation UI or iOS Share menu. Before release, check those on an
HTTPS deployment with the #3 manifest/assets:

1. **Android Chrome, not already installed:** visit login and dashboard; wait
   for install eligibility. Tap **Install app**, verify the native dialog appears
   once, accept, and confirm the card disappears. Launch from the Home Screen
   and verify it is completely absent. Repeat with cancellation to check the
   cooldown. If Chrome does not emit the event, verify the manual guide/APK link
   instead; eligibility depends on the browser, not on this card.
2. **iPhone/iPad Safari:** expand the guide, follow Share → Add to Home Screen →
   Add, and launch the new icon. Verify no card in standalone, including iPadOS
   desktop-site mode. In iOS Chrome, verify the instruction to open Safari.
3. **Non-intrusive layout:** open the login keyboard, rotate the phone, increase
   text size, and scroll to the last footer action with guidance expanded. Check
   safe-area clearance, keyboard hiding, no focus trap, and reduced motion.
4. **Dismissal:** close the card, reload, log in/out, and open a second tab. The
   card should stay hidden without affecting the session. Reset just its key
   with the snippet above to repeat the test.
5. **APK link:** verify GitHub Releases opens in a separate tab. Once #5/#6
   publish an Android build, verify its APK is available there.
