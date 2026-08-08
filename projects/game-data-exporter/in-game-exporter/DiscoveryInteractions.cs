using System.Reflection;
using UnityEngine;

namespace NeonSchedule1.GameDataExporter;

internal static partial class DiscoveryCollector
{
    private static List<DiscoveryInteractionPointSnapshot> CollectInteractionPoints(
        GameObject root)
    {
        var result = new List<DiscoveryInteractionPointSnapshot>();
        var keys = new HashSet<string>(StringComparer.Ordinal);
        var memberNames = new HashSet<string>(new[]
        {
            "AccessPoint",
            "AccessPoints",
            "accessPoint",
            "accessPoints",
            "BuildPoint",
            "CameraPosition",
            "CameraPositions",
            "CameraPosition_CombineIngredients",
            "CameraPosition_StartMachine",
            "InteractionPoint",
            "LinkOrigin",
            "StandPoint",
            "TaskBounds",
            "TaskCameraTransform",
            "TaskContainer",
            "UIPoint",
            "uiPoint",
        }, StringComparer.Ordinal);

        var components = root.GetComponentsInChildren<Component>(true);
        for (var componentIndex = 0; componentIndex < components.Length; componentIndex++)
        {
            var component = components[componentIndex];
            if (component is null)
            {
                continue;
            }

            var type = component.GetType();
            foreach (var memberName in memberNames)
            {
                object? value = null;
                try
                {
                    value = type.GetProperty(
                            memberName,
                            BindingFlags.Instance | BindingFlags.Public)
                        ?.GetValue(component);
                    value ??= type.GetField(
                            memberName,
                            BindingFlags.Instance | BindingFlags.Public)
                        ?.GetValue(component);
                }
                catch
                {
                    continue;
                }

                void AddTransform(Transform? transform)
                {
                    if (transform is null)
                    {
                        return;
                    }

                    var componentType = DiscoveryReflection.RuntimeTypeName(component);
                    var path = DiscoveryReflection.ObjectPath(transform);
                    var key = $"{componentType}\u001f{memberName}\u001f{path}";
                    if (keys.Add(key))
                    {
                        result.Add(new DiscoveryInteractionPointSnapshot
                        {
                            ComponentType = componentType,
                            Member = memberName,
                            Role = InteractionPointRole(memberName),
                            Transform = TransformSnapshot.FromTransform(transform),
                        });
                    }
                }

                AddTransform(DiscoveryReflection.TransformFromValue(value));
                if (value is System.Collections.IEnumerable values && value is not string)
                {
                    foreach (var entry in values)
                    {
                        AddTransform(DiscoveryReflection.TransformFromValue(entry));
                    }
                }
            }
        }

        void AddTypedValue(Component component, string member, object? value)
        {
            void Add(Transform? transform)
            {
                if (transform is null)
                {
                    return;
                }
                var componentType = DiscoveryReflection.RuntimeTypeName(component);
                var path = DiscoveryReflection.ObjectPath(transform);
                var key = $"{componentType}\u001f{member}\u001f{path}";
                if (keys.Add(key))
                {
                    result.Add(new DiscoveryInteractionPointSnapshot
                    {
                        ComponentType = componentType,
                        Member = member,
                        Role = InteractionPointRole(member),
                        Transform = TransformSnapshot.FromTransform(transform),
                    });
                }
            }

            Add(DiscoveryReflection.TransformFromValue(value));
            if (value is System.Collections.IEnumerable values && value is not string)
            {
                foreach (var entry in values)
                {
                    Add(DiscoveryReflection.TransformFromValue(entry));
                }
            }
        }

        var cauldron = root.GetComponentInChildren<Il2CppScheduleOne.ObjectScripts.Cauldron>(true);
        if (cauldron is not null)
        {
            AddTypedValue(cauldron, "AccessPoints", cauldron.AccessPoints);
            AddTypedValue(cauldron, "CameraPosition", cauldron.CameraPosition);
            AddTypedValue(cauldron, "CameraPosition_CombineIngredients", cauldron.CameraPosition_CombineIngredients);
            AddTypedValue(cauldron, "CameraPosition_StartMachine", cauldron.CameraPosition_StartMachine);
            AddTypedValue(cauldron, "LinkOrigin", cauldron.LinkOrigin);
            AddTypedValue(cauldron, "StandPoint", cauldron.StandPoint);
            AddTypedValue(cauldron, "UIPoint", cauldron.UIPoint);
        }

        var dryingRack = root.GetComponentInChildren<Il2CppScheduleOne.ObjectScripts.DryingRack>(true);
        if (dryingRack is not null)
        {
            AddTypedValue(dryingRack, "AccessPoints", dryingRack.AccessPoints);
            AddTypedValue(dryingRack, "CameraPositions", dryingRack.CameraPositions);
            AddTypedValue(dryingRack, "HangAlignments", dryingRack.HangAlignments);
            AddTypedValue(dryingRack, "LinkOrigin", dryingRack.LinkOrigin);
            AddTypedValue(dryingRack, "UIPoint", dryingRack.UIPoint);
        }

        var brickPress = root.GetComponentInChildren<Il2CppScheduleOne.ObjectScripts.BrickPress>(true);
        if (brickPress is not null)
        {
            AddTypedValue(brickPress, "AccessPoints", brickPress.AccessPoints);
            AddTypedValue(brickPress, "CameraPosition", brickPress.CameraPosition);
            AddTypedValue(brickPress, "CameraPosition_Pouring", brickPress.CameraPosition_Pouring);
            AddTypedValue(brickPress, "CameraPosition_Raising", brickPress.CameraPosition_Raising);
            AddTypedValue(brickPress, "ContainerSpawnPoint", brickPress.ContainerSpawnPoint);
            AddTypedValue(brickPress, "LinkOrigin", brickPress.LinkOrigin);
            AddTypedValue(brickPress, "StandPoint", brickPress.StandPoint);
            AddTypedValue(brickPress, "UIPoint", brickPress.UIPoint);
        }

        var mixingStation = root.GetComponentInChildren<Il2CppScheduleOne.ObjectScripts.MixingStation>(true);
        if (mixingStation is not null)
        {
            AddTypedValue(mixingStation, "AccessPoints", mixingStation.AccessPoints);
            AddTypedValue(mixingStation, "CameraPosition", mixingStation.CameraPosition);
            AddTypedValue(mixingStation, "CameraPosition_CombineIngredients", mixingStation.CameraPosition_CombineIngredients);
            AddTypedValue(mixingStation, "CameraPosition_StartMachine", mixingStation.CameraPosition_StartMachine);
            AddTypedValue(mixingStation, "IngredientTransforms", mixingStation.IngredientTransforms);
            AddTypedValue(mixingStation, "JugAlignment", mixingStation.JugAlignment);
            AddTypedValue(mixingStation, "LinkOrigin", mixingStation.LinkOrigin);
            AddTypedValue(mixingStation, "UIPoint", mixingStation.UIPoint);
        }

        var labOven = root.GetComponentInChildren<Il2CppScheduleOne.ObjectScripts.LabOven>(true);
        if (labOven is not null)
        {
            AddTypedValue(labOven, "AccessPoints", labOven.AccessPoints);
            AddTypedValue(labOven, "CameraPosition_Default", labOven.CameraPosition_Default);
            AddTypedValue(labOven, "CameraPosition_Breaking", labOven.CameraPosition_Breaking);
            AddTypedValue(labOven, "CameraPosition_PlaceItems", labOven.CameraPosition_PlaceItems);
            AddTypedValue(labOven, "CameraPosition_Pour", labOven.CameraPosition_Pour);
            AddTypedValue(labOven, "LinkOrigin", labOven.LinkOrigin);
            AddTypedValue(labOven, "ShardSpawnPoints", labOven.ShardSpawnPoints);
            AddTypedValue(labOven, "SolidIngredientSpawnPoints", labOven.SolidIngredientSpawnPoints);
            AddTypedValue(labOven, "UIPoint", labOven.UIPoint);
        }

        var packaging = root.GetComponentInChildren<Il2CppScheduleOne.ObjectScripts.PackagingStation>(true);
        if (packaging is not null)
        {
            AddTypedValue(packaging, "AccessPoints", packaging.AccessPoints);
            AddTypedValue(packaging, "ActiveProductAlignments", packaging.ActiveProductAlignments);
            AddTypedValue(packaging, "CameraPosition", packaging.CameraPosition);
            AddTypedValue(packaging, "CameraPosition_Task", packaging.CameraPosition_Task);
            AddTypedValue(packaging, "LinkOrigin", packaging.LinkOrigin);
            AddTypedValue(packaging, "OutputSlotPosition", packaging.OutputSlotPosition);
            AddTypedValue(packaging, "PackagingAlignments", packaging.PackagingAlignments);
            AddTypedValue(packaging, "ProductAlignments", packaging.ProductAlignments);
            AddTypedValue(packaging, "StandPoint", packaging.StandPoint);
            AddTypedValue(packaging, "UIPoint", packaging.UIPoint);
        }

        var pot = root.GetComponentInChildren<Il2CppScheduleOne.ObjectScripts.Pot>(true);
        if (pot is not null)
        {
            AddTypedValue(pot, "LeafDropPoint", pot.LeafDropPoint);
            AddTypedValue(pot, "LookAtPoint", pot.LookAtPoint);
            AddTypedValue(pot, "SeedStartPoint", pot.SeedStartPoint);
            AddTypedValue(pot, "TaskBounds", pot.TaskBounds);
            AddTypedValue(pot, "UIPoint", pot.UIPoint);
        }

        var spawnStation = root.GetComponentInChildren<
            Il2CppScheduleOne.StationFramework.MushroomSpawnStation>(true);
        if (spawnStation is not null)
        {
            AddTypedValue(spawnStation, "AccessPoints", spawnStation.AccessPoints);
            AddTypedValue(spawnStation, "CameraTransform", spawnStation.CameraTransform);
            AddTypedValue(spawnStation, "LinkOrigin", spawnStation.LinkOrigin);
            AddTypedValue(spawnStation, "TaskCameraTransform", spawnStation.TaskCameraTransform);
            AddTypedValue(spawnStation, "TaskContainer", spawnStation.TaskContainer);
            AddTypedValue(spawnStation, "UIPoint", spawnStation.UIPoint);
        }


        var transformNameFragments = new[]
        {
            "accesspoint", "alignment", "buildpoint", "cameraposition",
            "container", "dragprojectionplane", "droppoint", "hangalignment",
            "ingredienttransform", "linkorigin", "lookatpoint", "outputslotposition",
            "seedpoint", "shardspawn", "spawnpoint", "standpoint", "taskbounds",
            "taskcamera", "taskcontainer", "tray", "uipoint",
        };
        var transforms = root.GetComponentsInChildren<Transform>(true);
        for (var index = 0; index < transforms.Length; index++)
        {
            var transform = transforms[index];
            if (transform is null)
            {
                continue;
            }

            var normalizedName = NormalizeName(transform.name ?? string.Empty);
            if (!transformNameFragments.Any(fragment =>
                    normalizedName.Contains(fragment, StringComparison.Ordinal)))
            {
                continue;
            }

            var path = DiscoveryReflection.ObjectPath(transform);
            var key = $"hierarchy\u001f{normalizedName}\u001f{path}";
            if (keys.Add(key))
            {
                result.Add(new DiscoveryInteractionPointSnapshot
                {
                    ComponentType = "hierarchy-transform",
                    Member = transform.name ?? string.Empty,
                    Role = InteractionPointRole(transform.name ?? string.Empty),
                    Transform = TransformSnapshot.FromTransform(transform),
                });
            }
        }

        return result;
    }

    private static string InteractionPointRole(string member)
    {
        var normalized = NormalizeName(member);
        if (normalized.Contains("camera", StringComparison.Ordinal) ||
            normalized.Contains("lookat", StringComparison.Ordinal))
        {
            return "camera";
        }
        if (normalized.Contains("access", StringComparison.Ordinal) ||
            normalized.Contains("stand", StringComparison.Ordinal))
        {
            return "operator-access";
        }
        if (normalized.Contains("ui", StringComparison.Ordinal))
        {
            return "ui";
        }
        if (normalized.Contains("link", StringComparison.Ordinal))
        {
            return "automation-link";
        }
        if (normalized.Contains("alignment", StringComparison.Ordinal) ||
            normalized.Contains("spawn", StringComparison.Ordinal) ||
            normalized.Contains("ingredient", StringComparison.Ordinal) ||
            normalized.Contains("container", StringComparison.Ordinal) ||
            normalized.Contains("tray", StringComparison.Ordinal))
        {
            return "item-placement";
        }
        if (normalized.Contains("task", StringComparison.Ordinal) ||
            normalized.Contains("projection", StringComparison.Ordinal))
        {
            return "task-area";
        }
        return "placement";
    }

    private static void AddComponentsAndColliders(
        GameObject root,
        string source,
        DiscoveryBuildableSnapshot snapshot,
        DiscoveryVisualAssetRegistry visualAssets)
    {
        var components = root.GetComponentsInChildren<Component>(true);
        for (var index = 0; index < components.Length; index++)
        {
            var component = components[index];
            if (component is not null)
            {
                snapshot.ComponentTypes.Add(component.GetType().FullName ?? string.Empty);
            }
        }

        var colliders = root.GetComponentsInChildren<Collider>(true);
        for (var index = 0; index < colliders.Length; index++)
        {
            var collider = ColliderSnapshot.FromCollider(colliders[index]);
            if (collider is not null)
            {
                collider.Source = source;
                snapshot.Colliders.Add(collider);
            }

            var meshCollider = colliders[index]?.TryCast<MeshCollider>();
            if (meshCollider?.sharedMesh is not null)
            {
                visualAssets.RegisterMesh(meshCollider.sharedMesh);
            }
        }
    }

}
