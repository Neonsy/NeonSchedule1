# Work in the TypeScript workspace

This workspace contains NeonSchedule1's portable data contracts, calculations, data compiler, solver, tests, and future web package.
It is contributor tooling and does not provide a public calculator.

Read the [development overview](/docs/development.md) for repository architecture and current capability.

## Packages

| Package | Responsibility | Interface |
| --- | --- | --- |
| `@neonschedule1/core` | Versioned schemas and deterministic calculations | Private library |
| `@neonschedule1/data-compiler` | Acquisition verification and normalization | Private command-line tool |
| `@neonschedule1/public-data` | Pre-website publication inputs and processed asset provenance | Private library and command-line tool |
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
`pnpm test` runs the data-compiler, public-data, and solver Vitest projects.
`pnpm build` builds every package that defines a build script.

## Normalize an acquisition

Create an acquisition with the [game-data exporter](/docs/exporter-development-setup.md), then run:

```powershell
pnpm data:normalize -- --acquisition <directory> --output <directory>
```

The compiler verifies report and asset hashes, parses required meshes, checks schemas and references, applies domain integrity rules, and writes a content-addressed dataset.
If `--output` is omitted, the compiler infers a sibling `normalized` directory for acquisitions stored under an `acquisitions` directory.

Normalizer `0.0.40` writes static vehicle graph and endpoint evidence to `world/vehicle-navigation.json`.
The document preserves native costs and independent geometric edge distances.
It does not claim that endpoint offsets are traversable or that the game composes the general and road layers.

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
| Prepare or compare a read-only planner observation | `pnpm data:observe` |

The workspace scripts build the required packages before they run a command-line tool.
Most solver commands select a normalized dataset from `.local/normalized` unless you pass another path.
Run a command with `--help` for its current options.

## Understand solver evidence

The solver returns exact results only when it completes the search or uses matching exact corpus coverage.
Quick, Balanced, and Precise live searches can return valid best-found results with a recorded state, work, or time limit.
Exhaustive mode returns an exact corpus result or a coverage miss.

Static vehicle route planning selects one minimum-distance estimate inside a caller-selected directed graph layer.
The result excludes endpoint offsets, cross-layer composition, native route selection, parking, collision avoidance, traffic, dynamic obstacles, and live driving behavior.

## Validate local planner data

`@neonschedule1/core` defines versioned schemas for a local profile manifest and separate manual-state, inventory, checklist, blueprint, and latest-observation documents.
Unknown values stay explicit, and known collections declare complete or partial coverage.
Each document carries the game version and normalized dataset identity.

`validatePlannerProfileBundle` rejects incompatible ownership, references, timestamps, ranges, and undeclared fields.
`validatePlannerProfileBundleForDataset` also rejects a profile that does not match the loaded dataset.
The latest observation is read-only, and the schema permits no retained raw save payload.

`resolvePlannerCalculationContext` selects manual or observed state and an explicit inventory source without merging them.
The progression, person, customer, and inventory projection helpers omit partial facts that an existing calculator would otherwise interpret as complete.
`neonschedule1-planner-production-evidence-request-1` records current positions, transfer and shopping movement, lifecycle timing, realized revenue, and attributed costs with explicit unknown and coverage states.
Its validator checks profile ownership, dataset compatibility, source references, canonical identities, movement endpoints, sale timing, and cost coverage before the evidence reaches production calculations.

`pnpm data:observe prepare --game-directory <path>` stages a one-shot request for the existing local exporter mod.
After the matching save loads, `pnpm data:observe compare --game-directory <path>` verifies the response hash, request identity, game version, strict schema, and explicit inventory coverage.

The repository still has no browser persistence adapter or automatic synchronization loop.

## Validate application data

`@neonschedule1/core` defines `neonschedule1-application-data-policy-1` and strict versioned contracts for private profile exports, recipe and blueprint shares, community entries, accounts, optional explicit profile synchronization, complete account exports, and observation application.
Private exports contain validated local profile data and require a canonical payload SHA-256.
Public shares contain only recipe or blueprint data through opaque public keys.
They are immutable copies with explicit compatibility and size limits.

`applyPlannerObservation` requires a user-reviewed request and the SHA-256 of the unchanged profile bundle.
It updates only selected state fields and inventory documents.
It rejects stale, incompatible, automatic, missing, and cross-owner application attempts.

These are portable schemas and pure validators.
The repository does not contain an account provider integration, community service, browser persistence adapter, hosted synchronization service, or automatic observation apply loop.

## Compile the map publication input

`@neonschedule1/public-data` owns the replaceable inputs for a future interactive map.
It does not choose a browser renderer or implement website behavior.

The checked-in input contains 229 public markers, 235 state-specific positions, 6 regions, and 20 explicit filter labels for game `0.4.6f13`.
Six recruitable dealers keep separate potential-dealer and dealer positions.
The compiler omits runtime markers, private player markers, canonical-record mirrors, unpositioned shops, and visual-only pay phones.

Run the deterministic OpenCV treatment before compiling the input:

```powershell
uv run --script packages/public-data/scripts/process-map.py `
  --main-source <main-map.png> `
  --tutorial-source <tutorial-map.png> `
  --output-directory packages/public-data/assets/map `
  --provenance packages/public-data/assets/map/provenance.json
```

The script verifies the approved source hashes, preserves alpha, writes lossless 4096 by 4096 PNG files, and records every operation and parameter.
Then compile the private input from the matching normalized dataset:

```powershell
pnpm --filter @neonschedule1/core build
pnpm --filter @neonschedule1/public-data build
pnpm --filter @neonschedule1/public-data map:compile -- --dataset <normalized-dataset>
```

`packages/public-data/inputs/map.json` retains source references for joins and audits.
It is not a browser-safe artifact.
A later publication step must remove source references before website code can consume the data.

## Local outputs

Build output under `dist` is generated and ignored.
The ignored `.local` directory contains acquisitions, normalized datasets, benchmarks, validation evidence, precomputed corpora, verification reports, and runtime packages.

Do not commit raw game exports, normalized production data, or generated solver artifacts.
The processed map files under `packages/public-data/assets/map` have checked-in provenance.
The [development overview](/docs/development.md#local-and-public-files) defines the repository-wide publication boundary.
