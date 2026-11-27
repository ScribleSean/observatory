# Screen time

On a Mac, screen time comes from [ActivityWatch](https://activitywatch.net/) on 127.0.0.1:5600. Observatory reads its window and AFK watchers and counts the time you were active, per kind of app (AI apps, editors, browsers and so on) and, with your own rules, per app or site you name.

## Every watcher on the computer

ActivityWatch names each watcher after the computer's host name, and macOS changes that name when the network does, so one Mac's history can sit in several `aw-watcher-window_<name>` and `aw-watcher-afk_<name>` buckets. Observatory reads every local bucket that was running during the time it reads and counts time they share once, so the history stays continuous. Buckets synced from another computer are left out.

To read only some names, list them:

```json
"activity": { "hosts": ["old-name", "new-name.local"] }
```

## My apps

Rules name the apps and sites you care about. Observatory ships none: add yours under `activity.apps` in `observatory.config.json`. Each rule has a `label` and a regular expression (case-insensitive) for the window's `app` name, its `title`, or both. The first rule that matches a window wins.

```json
"activity": {
  "apps": [
    { "label": "Docs site", "title": "My Docs" },
    { "label": "Editor", "app": "^Code$" },
    { "label": "Editor notes", "app": "TextEdit", "title": "\\.notes$" }
  ]
}
```

- A rule with only `title` matches browser windows. A chat or a document named after a project is then not counted as time on that project's site.
- A rule with `app` matches that app's windows, and with `title` too, only the windows whose title also matches.
- Browsers show the page title, not the address, so a title rule matches the text the page puts in its `<title>`.

The Screen time view shows **My apps**: each label's time in the range, the change on the range before ("vs last week" on a week), a bar per day, week or month (the same buckets as the Hours chart), and its share of screen time. `browser` and `unmatched` are not allowed as labels. **By kind of app** stays beside it.

Labels are applied when screen time is read. The last 7 days are labeled on every run, and each run also labels 6 older days from ActivityWatch until its first recorded day, so the whole history uses the same rules. Changing the rules starts that again. Days ActivityWatch never recorded stay unlabeled, and the view counts them as "not labeled", never as zero.

## Browser time no rule matched

**Browser time** shows how much browser time your rules matched and how much they did not. Like My apps, it counts the labeled days only, and says so when the range has days that are not labeled. When some of the computers on the page have no rules, both name the computers they count, and the share is of those computers' screen time. The self-check lists **Browser time matched to my apps** as a problem when, over the last 7 labeled days, there was at least an hour of browser time and more than half of it matched no rule. Either the rules miss sites you use, or page titles are not enough to tell them apart.

### Hidden titles

ActivityWatch's window watcher can keep no titles at all: with `exclude_title = true` in its `aw-watcher-window.toml`, every window's title is recorded as `excluded`. Title rules then match nothing, and only `app` rules label time. Observatory counts that time apart: **Browser time** says when most of the unmatched time had no title, and the self-check reads `hidden` instead of `unmatched` when most of it did. Turning `exclude_title` off keeps titles from then on; it does not bring back the earlier ones.

## A URL watcher (optional)

When titles are not enough, ActivityWatch's browser extension, [aw-watcher-web](https://github.com/ActivityWatch/aw-watcher-web), records each tab's address. It is available for Chrome and Firefox (and browsers built on them). It does not run in Safari. Observatory does not install it.

1. Install the extension for your browser from its store page, linked from the aw-watcher-web README.
2. Keep ActivityWatch running. The extension creates an `aw-watcher-web-<browser>` bucket.
3. Observatory does not read that bucket yet: its rules match the window's `app` and `title`, and the addresses stay in ActivityWatch. The unmatched share above tells you whether adding it would be worth it.

## The raw archive

With `archive.folder` set (see [Raw archive](RAW-ARCHIVE.md)), each day's seconds per label are kept in the `activityHistory` day lines (`myApps`, `browserUnmatched`), and every ActivityWatch window event is kept once, with its app, its label (or `browser` or `unmatched`) and its times, as `activityEvents` lines. Window titles are not kept. The first run keeps every event the watchers hold.
