# GitHub Actions workflow template

GitHub only discovers workflow files stored under the project root at:

```text
.github/workflows/
```

This pack is deliberately isolated in a separate folder. After copying the pack into the original Lunex project, copy `ci/lunex-ci.yml` into:

```text
.github/workflows/lunex-ci.yml
```

The workflow runs TypeScript, lint, and production-build checks on pushes and pull requests. Its live Horizons integration job is manually triggered because it depends on external NASA/JPL availability.

This template does not modify the existing workflow. Review the current workflow and combine the checks deliberately when moving it into the original project.
