# NeonSchedule1

NeonSchedule1 is an unofficial open-source project for building an accurate *Schedule I* mixing calculator and planning tool.
It is intended for players who want to compare recipes by ingredients, effects, cost, value, profit, and customer fit.

> [!IMPORTANT]
> NeonSchedule1 does not have a public website or player-ready application yet.

## What exists today

The repository contains working calculation libraries and local development tools.
Contributors can:

- Evaluate ordered mixes under standard and seeded mixing profiles
- Search and rank recipes with ingredient, effect, cost, and length constraints
- Calculate customer, dealer, production, inventory, shopping, and property-planning results
- Collect, verify, normalize, and validate game data from a local game installation
- Generate and query exact precomputed recipe data

These capabilities require a source checkout and local development setup.
The web workspace contains no application code.

The [development overview](/docs/development.md) describes the implemented scope and its proof limits.

## Planned player features

- Interactive mix building and reverse search
- Quick, Balanced, Precise, and Exhaustive search modes
- Ingredient, effect, cost, value, profit, and recipe-length filters
- Customer and dealer planning
- Production, inventory, shopping, property, and route guidance
- Versioned share links with game-data and mixing-profile identity

Plans are not release promises.
The source and tests define current behavior.

## Choose a path

- [Understand the repository and start contributing](/docs/development.md)
- [Work on the TypeScript calculations and solver](/projects/typescript/README.md)
- [Set up the local game-data tools](/docs/exporter-development-setup.md)
- [Use the complete exporter manual](/projects/game-data-exporter/README.md)

## Data boundary

The public repository contains original source code, tests, fixtures, and documentation.
Do not commit or publish game binaries, assemblies, decompiled code, saves, player or organization names, Steam identifiers, unrelated save state, raw exports, normalized production data, or solver artifacts.

## License

Original NeonSchedule1 source code is licensed under the [Apache License 2.0](/LICENSE).
The license contains the complete warranty disclaimer and limitation of liability.

## Disclaimer

NeonSchedule1 is an unofficial fan project and is not affiliated with or endorsed by TVGS.
*Schedule I* and its related names and assets belong to their respective owners.
