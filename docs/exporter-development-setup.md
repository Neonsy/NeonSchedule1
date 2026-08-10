# Set up the game-data exporter

This guide builds and runs NeonSchedule1's local game-data tools.
It is for contributors who have a licensed Windows installation of *Schedule I*.

The in-game exporter writes a versioned report and directly readable assets after a save loads.
The offline extractor recovers required mesh geometry that Unity does not expose to CPU code.
Both tools are development utilities, not player releases.

## Prerequisites

- Windows x64
- .NET 10 SDK
- A locally installed and licensed copy of *Schedule I*
- MelonLoader installed in the game directory
- The IL2CPP S1API DLL at `Mods/S1API.Il2Cpp.MelonLoader.dll`
- AssetRipper `1.3.14` when the export needs the offline mesh pass

## Build and run the exporter

1. Set `NEONSCHEDULE1_GAME_DIR` to the game installation directory
2. Build `projects/game-data-exporter/in-game-exporter/NeonSchedule1.GameDataExporter.csproj` in Release configuration
3. Copy `NeonSchedule1.GameDataExporter.dll` from `bin/Release/net6.0` into the game's `Mods` directory
4. Start the game and load a save that is past character creation and the tutorial
5. Wait for `Export complete` in `MelonLoader/Latest.log`
6. Verify that the report, its SHA-256 sidecar, and the matching asset directory exist

Use a save with randomized mixing maps disabled for a full data export.
Seeded saves remain supported by the recipe-validation mode.

## Complete the offline mesh pass

Close the game before AssetRipper reads the installation.
Publish and run the offline extractor only when the report contains CPU-unreadable mesh references.
Reuse the same report and output directory to resume an interrupted run.

The offline stage is complete when every requested mesh reference has a terminal success status and every output hash passes verification.

## Continue the workflow

Use the [complete exporter manual](/projects/game-data-exporter/README.md) for commands, output formats, recovery, and cleanup.
