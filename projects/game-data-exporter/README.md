# Export and validate Schedule I game data

This manual covers NeonSchedule1's local acquisition, extraction, and native-validation tools.
It is for contributors who need a verified input for the TypeScript data compiler.

Start with the [short exporter setup guide](/docs/exporter-development-setup.md) when you only need the normal path.
Return to the [TypeScript workspace guide](/projects/typescript/README.md) after the acquisition passes every completion check.

## Tool boundary

This directory contains two source-only C# tools:

- `in-game-exporter` builds a MelonLoader mod that writes a versioned JSON report and directly readable assets
- `offline-asset-extractor` builds a console program that recovers mesh geometry Unity marks as CPU-unreadable

Contributors build both tools locally and provide their own game, mod loader, API, .NET, and AssetRipper installations.
NeonSchedule1 does not publish compiled copies of either tool.

Exporter `0.0.23` targets *Schedule I* `0.4.6f13`, MelonLoader `0.7.3`, S1API `3.1.6`, and AssetRipper `1.3.14`.
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

AssetRipper is a separate third-party dependency and is not included in this repository.

## Build the in-game exporter

Run the commands in this section from `projects/game-data-exporter`.
Set the game directory before building:

```powershell
$env:NEONSCHEDULE1_GAME_DIR = 'C:\Program Files (x86)\Steam\steamapps\common\Schedule I'
dotnet build '.\in-game-exporter\NeonSchedule1.GameDataExporter.csproj' -c Release
```

You can pass the directory to MSBuild instead:

```powershell
dotnet build '.\in-game-exporter\NeonSchedule1.GameDataExporter.csproj' -c Release -p:GameDirectory='C:\Program Files (x86)\Steam\steamapps\common\Schedule I'
```

The build writes:

```text
in-game-exporter/bin/Release/net6.0/NeonSchedule1.GameDataExporter.dll
```

The build fails when the supplied game directory does not contain MelonLoader or the IL2CPP S1API DLL.
Game assemblies use local non-copying references and do not enter the build output.

## Install and run the exporter

1. Close *Schedule I*
2. Remove or disable any other copy of `NeonSchedule1.GameDataExporter.dll`
3. Copy the new DLL into the game's `Mods` directory
4. Start the game and load a save that is past character creation and the tutorial
5. Watch `MelonLoader/Latest.log` for progress
6. Wait for the final `Export complete` message before closing the game

A post-tutorial save is sufficient for data enumeration.
Progression unlocks are not required.

A full export requires a save with randomized mixing maps disabled because normalized datasets contain profile-neutral standard mixing rules.
Seeded saves remain supported by recipe-validation mode.

The default output directory is:

```text
<Schedule I>/UserData/NeonSchedule1/exports
```

Set `NEONSCHEDULE1_EXPORT_OUTPUT` before Steam starts to use another directory.
Restart Steam after changing a persistent user environment variable so the game inherits it.

Each full-export run creates:

```text
neonschedule1-game-data-<UTC run id>.json
neonschedule1-game-data-<UTC run id>.json.sha256
neonschedule1-assets-<UTC run id>/
```

The report schema is `neonschedule1-game-data-export-1`.
The report records game, exporter, MelonLoader, and S1API versions.

## Exported data

The exporter records the data required by NeonSchedule1's current calculations:

- Products, ingredients, effects, mixing maps, and validation cases
- Recipes, stations, seeds, growing, packaging, additives, soils, quality, and oven transformations
- Items, prices, shops, suppliers, unlocks, properties, businesses, employee roles, and logistics rules
- People, customers, preferences, relationships, schedules, and presentation references
- Map regions, locations, services, access zones, employee navigation, and shop positions
- Buildables, footprints, colliders, surfaces, storage, interactions, Cleaner eligibility, and placement data
- Mesh, material, texture, sprite, icon, and other visual references

The report's `discovery` object owns advanced world, layout, navigation, schedule, and visual observations.
Directly readable textures and images are written as PNG files.
Directly readable meshes are written as OBJ files.

Navigation evidence records the relevant agent configuration.
Static graph and path observations do not prove live traversal through doors, scripts, dynamic obstacles, or collision behavior.

## Run native validation

The DLL performs one operation when a save finishes loading:

- With no validation request, it performs a full export
- With `native-recipe-validation-request.json`, it evaluates requested recipes in the game
- With `native-convex-validation-request.json`, it raycasts requested convex surface colliders

Place exactly one request file in the configured exporter output directory before the save loads.
If both request files exist, the exporter reports an error and performs neither operation.

The TypeScript commands create requests, verify response hashes and dataset identity, retain local evidence, and remove staged files after a successful comparison.

### Validate recipes

Run these commands from `projects/typescript`:

```powershell
pnpm solver:native prepare --game-directory 'C:\Program Files (x86)\Steam\steamapps\common\Schedule I'
# Start the game and load the matching save.
pnpm solver:native compare --game-directory 'C:\Program Files (x86)\Steam\steamapps\common\Schedule I'
```

Pass `--mixing-seed NUMBER` to `prepare` for a seeded save.
Omit the option for the standard profile.
The loaded save must use the requested profile.

### Validate convex colliders

Run these commands from `projects/typescript`:

```powershell
pnpm data:validate-convex prepare --game-directory 'C:\Program Files (x86)\Steam\steamapps\common\Schedule I'
# Start the game and load a save.
pnpm data:validate-convex compare --game-directory 'C:\Program Files (x86)\Steam\steamapps\common\Schedule I'
```

The validation schemas contain only the requested cases and their evidence.
They do not expose an unrestricted Unity object graph or save dump.

## Build the offline extractor

Close *Schedule I* before the offline pass so AssetRipper reads a stable installation.
Publish a self-contained Windows x64 executable:

```powershell
dotnet publish '.\offline-asset-extractor\NeonSchedule1.OfflineAssetExtractor.csproj' -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:DebugType=None -p:DebugSymbols=false
```

The command writes:

```text
offline-asset-extractor/bin/Release/net10.0/win-x64/publish/NeonSchedule1.OfflineAssetExtractor.exe
```

The published executable includes its .NET runtime.

## Run the offline extractor

Use the JSON report created by the in-game exporter and a dedicated output directory:

```powershell
& '.\offline-asset-extractor\bin\Release\net10.0\win-x64\publish\NeonSchedule1.OfflineAssetExtractor.exe' --report 'D:\NeonSchedule1\exports\neonschedule1-game-data-<run id>.json' --assetripper 'D:\Tools\AssetRipper-1.3.14\AssetRipper.GUI.Free.exe' --game-data 'C:\Program Files (x86)\Steam\steamapps\common\Schedule I\Schedule I_Data' --output 'D:\NeonSchedule1\offline-assets\<run id>' --checkpoint 5
```

The command accepts:

```text
--report <report.json>                   Required in-game report
--assetripper <AssetRipper executable>   Required AssetRipper executable
--game-data <Schedule I_Data>            Required Unity data directory
--output <directory>                     Required output directory
--port <0-65535>                         Optional fixed loopback port
--limit <count>                          Optional smoke-test target limit
--checkpoint <count>                     Optional manifest checkpoint interval
--no-resume                              Ignore an existing manifest
```

The extractor starts one hidden AssetRipper process on a loopback-only port.
It stops only the process it started.

The manifest schema is `neonschedule1-offline-mesh-export-1`.
The output contains:

```text
offline-mesh-manifest.json
offline-extractor.log
assetripper.log
meshes/*.glb
```

Repeat the same command to resume an interrupted run.
Resume requires the existing manifest to name the same report SHA-256.
Before reusing a completed GLB, the extractor verifies its length, `glTF` header, and SHA-256.

The process uses these exit codes:

```text
0    All mesh signatures resolved
1    Fatal startup or extraction failure
2    Pass completed with unresolved entries
64   Invalid command line
130  Canceled after saving a checkpoint
```

Success statuses are `matched`, `matched-identical-duplicates`, and `ambiguous-variants-preserved`.
The extractor preserves distinct matching variants instead of choosing one without evidence.
`not-found`, `signature-mismatch`, and `error` require investigation or another run.

## Verify completion

The in-game stage is complete only when:

- The JSON report, SHA-256 sidecar, and matching direct-asset directory exist
- The report hash matches the sidecar
- The report records zero direct-asset verification errors

The offline stage is complete only when:

- The manifest names the exact in-game report hash
- Every CPU-unreadable report reference appears in the manifest
- No unresolved status remains
- Every GLB passes length, header, and SHA-256 verification

Keep each report, asset directory, manifest, and hash together during verification.
Do not combine files from different runs.

## Normalize the acquisition

After both required stages pass, run the data compiler from `projects/typescript`:

```powershell
pnpm data:normalize -- --acquisition <directory> --output <directory>
```

The compiler verifies the acquisition again before it writes a normalized dataset.
See [Normalize an acquisition](/projects/typescript/README.md#normalize-an-acquisition) for the current contract.

## Keep generated data private

Do not commit or publish:

- Compiled DLL or executable files
- AssetRipper binaries
- Game binaries or assemblies
- Decompiled code
- Saves, player or organization names, Steam identifiers, or unrelated save state
- Raw reports or logs
- Normalized production data
- Native-validation evidence
