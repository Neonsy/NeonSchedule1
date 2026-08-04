# Export and validate Schedule I game data

This manual covers NeonSchedule1's local acquisition and extraction tools.
It is for contributors who need a verified input for the TypeScript data compiler.

## Tool boundary

This directory contains two source-only C# tools:

- `in-game-exporter` builds a MelonLoader mod that writes a versioned JSON report and directly readable assets
- `offline-asset-extractor` builds a console program that recovers mesh geometry Unity marks as CPU-unreadable

Contributors build both tools locally and provide their own game, mod loader, API, .NET, and AssetRipper installations.
NeonSchedule1 does not publish compiled copies of either tool.

Exporter `0.0.1` targets *Schedule I* `0.4.6f11`, MelonLoader `0.7.3`, S1API `3.1.6`, and AssetRipper `1.3.14`.
A newer game or dependency version requires a new build and acquisition audit.

## Requirements

- Windows x64
- A locally installed and licensed copy of *Schedule I*
- MelonLoader installed in the game directory
- The IL2CPP S1API DLL at `Mods/S1API.Il2Cpp.MelonLoader.dll`
- .NET 10 SDK
- AssetRipper `1.3.14` for the offline mesh pass

Download `AssetRipper_win_x64.zip` from the [AssetRipper 1.3.14 release](https://github.com/AssetRipper/AssetRipper/releases/tag/1.3.14).
Verify this SHA-256 before use:

```text
808cddf66dd0357ad6b36b97de3a2aef5e3552e63af3ee0610f9a03a0378101c
```

## Build and install the exporter

Run these commands from `projects/game-data-exporter`:

```powershell
$env:NEONSCHEDULE1_GAME_DIR = 'C:\Program Files (x86)\Steam\steamapps\common\Schedule I'
dotnet build '.\in-game-exporter\NeonSchedule1.GameDataExporter.csproj' -c Release
```

Copy `in-game-exporter/bin/Release/net6.0/NeonSchedule1.GameDataExporter.dll` into the game's `Mods` directory.
Start the game, load a post-tutorial save, and wait for `Export complete` in `MelonLoader/Latest.log`.

Each run writes a report, SHA-256 sidecar, and matching direct-asset directory under `UserData/NeonSchedule1/exports` by default.

## Exported data

- Products, ingredients, effects, mixing maps, and validation cases
- Recipes, stations, growing, packaging, additives, soils, quality, and production rules
- Items, prices, shops, suppliers, unlocks, properties, businesses, and logistics
- People, customers, preferences, relationships, schedules, and presentation references
- Map regions, locations, services, access zones, and shop positions
- Buildables, footprints, colliders, surfaces, storage, interactions, and placement data
- Mesh, material, texture, sprite, icon, and other visual references

The schema is explicit and versioned.
It is not an unrestricted Unity object or save dump.

## Build and run the offline extractor

Close *Schedule I*, then publish the Windows x64 executable:

```powershell
dotnet publish '.\offline-asset-extractor\NeonSchedule1.OfflineAssetExtractor.csproj' -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:DebugType=None -p:DebugSymbols=false
```

Run it with the report, AssetRipper executable, game-data directory, and a dedicated output directory.
Repeat the same command to resume an interrupted run.

The extractor accepts only a manifest for the same report SHA-256.
It verifies each completed GLB's length, header, and SHA-256 before reuse.

## Verify completion

The in-game stage is complete only when the report hash matches its sidecar and every direct asset passes verification.
The offline stage is complete only when every requested mesh has a terminal success status and every GLB passes verification.

Do not combine files from different runs.

## Keep generated data private

Do not commit or publish compiled tools, third-party binaries, game binaries, assemblies, decompiled code, saves, identifiers, raw reports, normalized production data, or native-validation evidence.
