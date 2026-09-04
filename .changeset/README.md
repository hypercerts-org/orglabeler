# Changesets

Every normal pull request needs one `.changeset/*.md` fragment. Add a release-note changeset for application or operator-workflow changes:

```bash
npm run changeset
```

For docs-only, internal, or other changes that should merge without changing the application version, create an empty changeset:

```bash
npm run changeset:empty
```

The release workflow turns pending changesets into a `Release` pull request. Merging that pull request updates the application version and changelog; a release workflow run for that merged pull request then creates a Git tag and GitHub Release. The private application package is never published to npm.
