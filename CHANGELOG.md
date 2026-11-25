# certified-organization-labeler

## 0.1.2

### Patch Changes

- [#10](https://github.com/hypercerts-org/orglabeler/pull/10) [`fdf885d`](https://github.com/hypercerts-org/orglabeler/commit/fdf885d8d9f916ccf8ea859adb1216aba655f250) Thanks [@holkexyz](https://github.com/holkexyz)! - - License the project and its agent skill under MIT OR Apache-2.0.

- [#14](https://github.com/hypercerts-org/orglabeler/pull/14) [`d31d526`](https://github.com/hypercerts-org/orglabeler/commit/d31d526e2d5f6b6a24787a2875b5fe958a46a3f6) Thanks [@holkexyz](https://github.com/holkexyz)! - - Purge a deleted account. When Tap reports an account `deleted`, the labeler removes its profile and organization snapshots, scores, PDS cache entry, and queued jobs, and negates its quality labels. In-flight PDS lookups and startup label sync cannot undo the purge. Deactivated, taken-down, and suspended accounts keep their state and labels.

## 0.1.1

### Patch Changes

- [#7](https://github.com/hypercerts-org/orglabeler/pull/7) [`7d920ba`](https://github.com/hypercerts-org/orglabeler/commit/7d920bab1a5bc59e521b75ca2e0e865008aee7b9) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Add automated release notes and GitHub Releases, with hardened workflow dependency execution, for maintainers and operators.
