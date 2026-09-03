# Releasing

This repository uses Changesets to version the application and create GitHub Releases. The package is private and is never published to npm. Releases are not coupled to Railway or any deployment.

## Contributors

1. Every normal pull request needs one changeset fragment. For user- or operator-visible changes, add a release-note fragment:
   ```bash
   npm run changeset
   ```
2. Commit the generated `.changeset/*.md` file with the pull request. For docs-only, internal, or other changes that should merge without a version bump, use an empty changeset instead:
   ```bash
   npm run changeset:empty
   ```

Empty changesets satisfy the CI check; `.changeset/README.md` is documentation, not a fragment.

## Maintainers

1. Merge the normal pull request into `main` after the existing CI checks pass.
2. A push to `main` with pending fragments runs Changesets in version mode. It creates or updates one pull request from `changeset-release/main` titled **Release**, using the generated commit message `release: version packages`. That pull request updates `package.json`, `package-lock.json`, and `CHANGELOG.md`.
3. Review and merge **Release**. The release workflow listens for that merged pull request, and publishes only when its head repository is this repository and its head ref is exactly `changeset-release/main`. Before tagging anything, it checks out and validates the exact merge commit, installs dependencies without implicit lifecycle scripts, explicitly rebuilds the required native dependencies, then runs `npm test`, `npm run type-check`, and `npm run build`.
4. After validation, the workflow checks whether the derived tag and GitHub Release already both exist. It no-ops when both exist, fails for a partial state that needs manual reconciliation, and otherwise Changesets creates a tag-only release for the private package and the corresponding GitHub Release (for example, `v0.1.1`) from the generated changelog. No npm publish or npm token is used.

The repository setting **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests** must be enabled for the version workflow to create or update **Release**.

The workflow intentionally uses only the automatically provided `GITHUB_TOKEN`. GitHub suppresses new workflow runs caused solely by actions performed with that token, so updates to the generated release branch may not automatically receive a fresh CI run. The changeset check skips `changeset-release/main` only when that branch belongs to this repository. If branch protection requires CI on the generated Release PR, use **Actions → CI → Run workflow**, select `changeset-release/main`, and run it manually before merging **Release**. The publish path always performs its own exact-merge-commit test, type-check, and build immediately before creating the tag and GitHub Release.
