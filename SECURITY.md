# Security policy

## Reporting a vulnerability

Please report security issues **privately** using GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Please don't open a public issue for a security problem.

> Note for the maintainer: private vulnerability reporting must be switched on in **Settings → Code security** for that button to appear.

Please include what you found, how to reproduce it and what it could affect. You'll get an acknowledgement as soon as possible; this is a one-person project, so no fixed response time is promised.

## Scope

CurioTrail is a static website: there is no server, account system or database of players. Progress is kept in the player's own browser storage. Useful reports include:

- script injection through quest content, saved progress or URLs
- the SQL or Python sandboxes reaching the page's JavaScript
- a dependency with a known vulnerability that affects the game

## Supported versions

Only the version currently published at https://denilthaks.github.io/CURIO/ is supported.
