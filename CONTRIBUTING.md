# Contributing

Shop CLI is maintained by Shopify. Contributions are welcome when they fit the project's personal-use scope and keep the CLI safe for shoppers, merchants, and contributors.

## Before You Start

- Search existing issues and pull requests before opening a new one.
- Open an issue for significant user-facing behavior changes before implementation.
- Keep pull requests focused and include tests for behavior changes.
- Do not commit secrets, credentials, private hostnames, internal-only Shopify details, merchant PII, shopper PII, or data copied from private systems.
- Do not copy code from another project unless its license allows it and the attribution requirements are understood.

## Contributor License Agreement

External contributors must sign Shopify's Contributor License Agreement before their pull request can be merged. The CLA check runs automatically on pull requests and will tell you what to do if a signature is required.

## Development

Requirements:

- Node.js 20 or newer
- pnpm 10.28.0

Set up the project:

```bash
pnpm install
```

Run the standard checks:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Run the CLI locally after building:

```bash
pnpm build
pnpm shop --help
```

## Changesets

User-facing changes that should be released need a changeset:

```bash
pnpm changeset
```

Choose the package, select the appropriate semver bump, and write a concise release note.

## Pull Requests

- Include a clear description of the problem and solution.
- Link related issues when applicable.
- Update README or skill documentation when command behavior changes.
- Keep generated output, build artifacts, package tarballs, local environment files, and credentials out of the repository.

## Code of Conduct

All contributors are expected to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
