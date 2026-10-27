---
description: "Create the GitHub release, announce the version on Discord and commit and push the version bump"
---

Publish a new pi-adhd version.

1. Run `git status --short` and tell me if there are uncommitted changes before publishing.
3. Bumps `version` in the root `package.json`, creates the `v<version>` GitHub release with `gh release create --generate-notes` (requires `gh` authenticated), then posts to the `PICOBU_DISCORD_WEBHOOK_URL` Discord webhook. The Discord message lists new features and bug fixes, taken from the commit subjects since the previous GitHub release (subjects mentioning fix/bug are bug fixes, the rest are features).

   Post to Discord with `curl` and a browser `User-Agent` — Python's `urllib` (and other non-browser TLS signatures) get rejected by Discord's Cloudflare with `403 Forbidden` / error code 1010. Write the JSON payload to a temp file and send:

   ```sh
   curl -s -o /dev/null -w "%{http_code}" -X POST \
     -H "Content-Type: application/json" \
     -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" \
     -d @/tmp/discord-msg.json "$PICOBU_DISCORD_WEBHOOK_URL"
   ```

   Success is HTTP `204` (Discord returns an empty body). Retry once with the browser `User-Agent` if a first attempt fails with 403.
4. Commit and push the version bump: run `git add package.json`, then `git commit -m "Bump version to <version>"` followed by the commit attribution lines, then `git push`. Stage only `package.json`; leave any other uncommitted changes alone. If the commit or push fails, report the exact error and do not force-push.
5. Report the published version, or the exact error if any step failed. Do not retry a failed publish without asking me.