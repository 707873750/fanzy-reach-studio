# Changelog

## Native Chrome login handoff
- All platforms log in through ordinary Chrome with isolated profiles and no automation/debugging flags.
- Finish Login closes only that dedicated browser normally, then captures an encrypted snapshot through headless Playwright without restoring stale state first.
- Keeps profile locks until login is saved; failed closure or snapshot can be retried. Publishing visibility and X scheduling remain available.
- Added local native Chrome-to-headless transfer and stale-session/closure regression tests.

## Instagram accessibility controls
- Prioritizes visible control text over decorative SVG labels.
- Waits for asynchronously expanded alt-text inputs, supports summary accordions and already-expanded sections, and verifies one filled field per image.
- Added full caption + nonempty alt-text + submission-checkpoint regressions for one and multiple images.

## Instagram caption labels
- Recognizes 添加配文 and aria-placeholder/data-placeholder fields, including empty contenteditable attributes.
- Failed control waits include field-label diagnostics without input values.
- Loads the page adapter at the start of each new job so subsequent adapter fixes do not require restarting the worker.

## Instagram creation readiness
- Waits for a stable creation entry and uses a Playwright actionable click rather than a DOM click.
- Confirms the upload dialog before loading/uploading images. A no-op click can retry up to three times, with five-second observation windows; visible menus/dialogs suspend retries.
- Logs each click and confirmation; failures stop before upload and preserve a screenshot.

## Instagram continue-button fix
- Added Continue / 继续 / 繼續 for Instagram crop and edit steps, based on the captured failure screen.
- Added stage logs and isolated regressions for all three labels, including conflicting controls outside the composer.

## Python + Playwright publishing
- Replaced the extension/pairing production flow with persistent browser profiles and headless Playwright publishing.
- Added Edge/Chrome/Chromium selection, a saved visible-browser switch, and explicit login/open/save-close controls.
- Windows DPAPI login snapshots preserve cookies, LocalStorage and IndexedDB across browser restarts.
- Retained X native scheduling and the durable checkpoint before final submission; login and publishing cannot share an active profile.
- Preserved step/error logs and added failure screenshots (latest 50 retained).
- Added isolated real-browser regressions for profiles, login snapshot encryption, all platforms, scheduling, checkpoints and screenshots.

## Extension 0.3.2
- X drafts can specify a native scheduled publication time, separate from local reminders.
- The extension fills the schedule dialog and requires a Schedule button and scheduling confirmation; it never falls back to immediate posting.
- Accepted schedules have a distinct scheduled state and cannot be submitted twice. Manage cancellation or changes on X.
- Added a real-extension fixture regression for date/time conversion, persisted-checkpoint-before-scheduling, and scheduling confirmation.

## Extension 0.3.1
- Fixed upload validation when X clears its file input after consuming the files; image previews still must appear before submission.
- Added Instagram Traditional Chinese controls and icon labels; upload, caption, Next and Share are scoped to the creation dialog.
- Detects X account-suspension headings and stops before preparing/submitting a post with an actionable error.
- Page initialization logs include the loaded extension version. Reload the unpacked extension after updating.
- Added intercepted-browser regressions for cleared upload inputs, Traditional Chinese Instagram with conflicting background controls, and suspended X accounts. No real posts are sent by these tests.

## 0.2.0
- Added user-initiated native OS file drag from prepared draft cards.
- Supports dragging prepared image files to compatible platform composers (up to 10 Instagram images, 4 X images, 1 Pinterest image).
- X draft preparation opens a Share Intent URL with caption text prefilled. Local images must still be dragged by the user.
- Added explicit UI guidance that the user completes upload and final publication.
- No browser scripting, simulated mouse control, or automated clicking is included.
