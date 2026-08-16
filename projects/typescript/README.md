# Work in the TypeScript workspace

This workspace contains NeonSchedule1's portable data contracts, calculations, data compiler, solver, tests, and future web package.
It is contributor tooling and does not provide a public calculator.

Read the [development overview](/docs/development.md) for repository architecture and current capability.

## Packages

| Package | Responsibility | Interface |
| --- | --- | --- |
| `@neonschedule1/core` | Versioned schemas and deterministic calculations | Private library |
| `@neonschedule1/data-compiler` | Acquisition verification and normalization | Private command-line tool |
| `@neonschedule1/solver` | Search, allocation, precomputation, runtime queries, benchmarks, and verification | Private library and command-line tools |
| `@neonschedule1/web` | Future player interface | Manifest-only placeholder |

## Install and validate

Install Node.js `24.19.0` and pnpm `11.x`.
Run these commands from this directory:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

`pnpm check` runs every package type check.
`pnpm test` runs the data-compiler and solver Vitest projects.
`pnpm build` builds every package that defines a build script.

## Normalize an acquisition

Create an acquisition with the [game-data exporter](/docs/exporter-development-setup.md), then run:

```powershell
pnpm data:normalize -- --acquisition <directory> --output <directory>
```

The compiler verifies report and asset hashes, parses required meshes, checks schemas and references, applies domain integrity rules, and writes a content-addressed dataset.
If `--output` is omitted, the compiler infers a sibling `normalized` directory for acquisitions stored under an `acquisitions` directory.

Normalizer `0.0.38` writes the current content-addressed normalized dataset contract.

## Run solver workflows

| Goal | Command |
| --- | --- |
| Benchmark recipe search | `pnpm solver:benchmark` |
| Benchmark customer allocation | `pnpm solver:benchmark:allocation` |
| Benchmark joint customer and dealer allocation | `pnpm solver:benchmark:joint-allocation` |
| Verify reverse search | `pnpm solver:verify` |
| Prepare or compare in-game recipe validation | `pnpm solver:native` |
| Generate a recipe corpus | `pnpm solver:precompute` |
| Refresh the selected corpus | `pnpm solver:precompute:refresh` |
| Verify a corpus | `pnpm solver:precompute:verify` |
| Package a verified runtime artifact | `pnpm solver:precompute:package` |
| Prepare or compare convex-collider validation | `pnpm data:validate-convex` |

The workspace scripts build the required packages before they run a command-line tool.
Most solver commands select a normalized dataset from `.local/normalized` unless you pass another path.
Run a command with `--help` for its current options.

## Understand solver evidence

The solver returns exact results only when it completes the search or uses matching exact corpus coverage.
Quick, Balanced, and Precise live searches can return valid best-found results with a recorded state, work, or time limit.
Exhaustive mode returns an exact corpus result or a coverage miss.

## Local outputs

Build output under `dist` is generated and ignored.
The ignored `.local` directory contains acquisitions, normalized datasets, benchmarks, validation evidence, precomputed corpora, verification reports, and runtime packages.

Do not commit raw game exports, normalized production data, or generated solver artifacts.
The [development overview](/docs/development.md#local-and-public-files) defines the repository-wide publication boundary.
