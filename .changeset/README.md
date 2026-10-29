# Changesets

A change that should reach npm needs a changeset in its pull request:

```bash
bunx changeset
```

Pick `patch`, `minor`, or `major` and write one line a user would understand. Commit the generated `.changeset/*.md` file with the rest of the change.

Merging to `main` opens or updates a **release: version packages** pull request. Merging that pull request publishes to npm, tags the version, and creates the GitHub Release.

Do not edit `version` in `package.json` by hand and do not publish from a laptop.

## When a change needs one

CI fails a pull request that changes shipped files (`src/`, `bin/`, `skills/`, `desktop/`, not tests or READMEs) without a changeset. Add the **`no changeset`** label when npm should not change, for example a refactor with no behavior change.

## Previews

There are no canary releases. Add the **`pr preview`** label to a pull request to get an installable preview from [pkg.pr.new](https://pkg.pr.new). It needs the pkg.pr.new GitHub App installed on this repo. Previews are not published to npm.

## Setup the repo needs

- **Settings, Actions, General:** enable **Allow GitHub Actions to create and approve pull requests**.
- **Checks on the version pull request.** A pull request opened with the workflow's own token does not start CI, so its required checks stay missing. Close and reopen the pull request once to run them, or open it with a GitHub App or personal access token instead.
- **npm trusted publishing** stays bound to the `release.yml` workflow file.
