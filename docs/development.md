# Develop NeonSchedule1

This page explains the repository's current behavior, ownership boundaries, and contributor workflow.
Read the [project README](/README.md) first for the player-facing purpose and availability.

## Current state

NeonSchedule1 has a working calculation engine, game-data pipeline, solver, and validation toolchain.
It does not have a website, installable calculator, published package, or supported player workflow.

In this page, **implemented** means that source and tests exercise the named behavior.
**Partial** means that useful calculations exist but require caller-provided state, local game data, or further integration.
**Tooling** means that the code supports development and validation.
**Planned** means that the repository reserves ownership but contains no usable implementation.

## Repository ownership

| Area | Responsibility | Status |
| --- | --- | --- |
| [`projects/typescript/packages/core`](/projects/typescript/packages/core) | Versioned data contracts and deterministic calculations | Implemented private workspace package |
| [`projects/typescript/packages/data-compiler`](/projects/typescript/packages/data-compiler) | Verification and normalization of local exporter acquisitions | Implemented command-line tool |
| [`projects/typescript/packages/solver`](/projects/typescript/packages/solver) | Search, allocation, precomputation, runtime artifacts, benchmarks, and verification | Implemented private package and command-line tools |
| [`projects/typescript/web`](/projects/typescript/web) | Future player-facing application | Manifest-only placeholder |
| [`projects/game-data-exporter`](/projects/game-data-exporter) | In-game acquisition, native validation, and offline mesh extraction | Implemented source-only Windows tools |

Every TypeScript package is private.
No package is published to a registry.

## Data flow

1. The in-game exporter writes a versioned report and directly readable assets from a local *Schedule I* installation
2. The offline extractor recovers required mesh geometry that Unity does not expose to CPU code
3. The data compiler verifies the acquisition and writes a normalized dataset identified by its content
4. The core package applies deterministic calculations to normalized data and explicit caller state
5. The solver searches recipes, allocates constrained resources, builds precomputed corpora, and verifies runtime packages
6. A future web application can expose those operations as player workflows

The exporter owns observations from the installed game.
The data compiler is the trust boundary between those observations and portable calculations.
The core package has no game-process or file-system dependency.
The solver owns expensive work and private generated artifacts.

Versioned schemas and content identities prevent incompatible acquisitions, datasets, and solver artifacts from being combined silently.

## Capability status

| Area | Status | Current behavior | Current limit |
| --- | --- | --- | --- |
| Mixing and recipes | Implemented | Ordered mixing, standard and seeded profiles, profile inference, enumeration, reverse search, constraints, and deterministic ranking | Library code only |
| Search | Implemented | Quick, Balanced, Precise, and Exhaustive routing, bounded live fallback, exact corpora, binary indexes, runtime loading, and proof evidence | Requires normalized data and is not hosted |
| Customers and dealers | Partial | Demand, enjoyment, offers, recommendations, eligibility, assignment, shared-resource allocation, and conservative travel feasibility | Requires explicit progression, relationship, stock, cash, and timing state |
| Production and inventory | Partial | Production plans, equipment, additives, packaging, inventory, transfers, purchases, shopping, lifecycle timing, and realized-profit evidence | Exact results require complete movement, sale, revenue, and cost inputs |
| Property blueprints | Partial | Placement, construction order, cost, storage, collision, access, temperature, lighting, sprinklers, capacity, schedules, employee logistics, movement, and business assessment | Mutable storage, moisture, trash, task order, live positions, dynamic obstacles, and unsupported collider proof remain outside the static model |
| People and world | Partial | People, relationships, schedules, map projection, shops, properties, services, and employee navigation | Normalized data and calculations exist without a live map or game connection |
| Data pipeline | Tooling | Hash verification, schema checks, integrity checks, normalization, stable dataset identity, and corruption detection | Requires a private local acquisition |
| Game-data tools | Tooling | In-game export, recipe validation, convex-collider validation, direct asset export, and offline mesh extraction | Requires Windows, the game, and third-party prerequisites |
| Website | Planned | Workspace ownership only | No source application or deployment exists |

Exact and incomplete results are separate contracts.
Code does not label a bounded or evidence-limited result as exact.

## TypeScript workflow

The TypeScript workspace requires Node.js `24.19.0` and pnpm `11.x`.
Run the canonical checks from `projects/typescript`:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

The [TypeScript workspace guide](/projects/typescript/README.md) documents normalization, solver commands, and generated outputs.

## Exporter workflow

Exporter development requires Windows, a licensed local copy of *Schedule I*, .NET 10, MelonLoader, S1API, and AssetRipper for the offline mesh pass.
Start with [Set up the game-data exporter](/docs/exporter-development-setup.md).
Use the [complete exporter manual](/projects/game-data-exporter/README.md) for build commands, output verification, native validation, recovery, and cleanup.

## Compatibility

Exporter `0.0.23` targets *Schedule I* `0.4.6f13`, MelonLoader `0.7.3`, S1API `3.1.6`, and AssetRipper `1.3.14`.
Normalizer `0.0.38` defines the current normalized output contract.
A newer game or dependency version requires a new build and acquisition audit.

NeonSchedule1 has no backward-compatibility commitment before version 1.
Pre-version-1 schemas and artifacts may change when the replacement has a clearer or more accurate contract.

## Local and public files

The TypeScript workspace ignores `.local`, `node_modules`, `dist`, and TypeScript build information.
The exporter workspace ignores `.local`, `bin`, and `obj`.

Raw acquisitions, normalized datasets, benchmark reports, native-validation evidence, precomputed corpora, verification reports, and runtime packages are private local outputs.
The ability to generate a file does not make that file suitable for publication.

Public source must not contain game binaries, assemblies, decompiled code, saves, player or organization names, Steam identifiers, unrelated save state, raw exporter reports, or normalized production data.

## Documentation ownership

- The [project README](/README.md) owns purpose, availability, and reader navigation
- This page owns current capability, architecture, and repository boundaries
- The [TypeScript workspace guide](/projects/typescript/README.md) owns package and solver commands
- The [exporter setup page](/docs/exporter-development-setup.md) owns the short onboarding path
- The [exporter manual](/projects/game-data-exporter/README.md) owns acquisition, extraction, validation, and recovery procedures
