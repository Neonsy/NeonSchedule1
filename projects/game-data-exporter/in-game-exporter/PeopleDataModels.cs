namespace NeonSchedule1.GameDataExporter;

internal sealed class PeopleCollection
{
    public PeopleSourceSnapshot Sources { get; init; } = new();
    public List<PersonSnapshot> People { get; set; } = new();
    public List<CustomerSnapshot> Customers { get; set; } = new();
    public List<RelationshipEdgeSnapshot> RelationshipEdges { get; set; } = new();
    public CustomerConstantsSnapshot CustomerConstants { get; init; } = new();
}

internal sealed class PeopleSourceSnapshot
{
    public int NpcRegistryCount { get; set; }
    public int LockedCustomerCount { get; set; }
    public int UnlockedCustomerCount { get; set; }
    public int UniquePersonCount { get; set; }
    public int UniqueCustomerCount { get; set; }
    public int DirectedConnectionCount { get; set; }
    public int UniqueRelationshipEdgeCount { get; set; }
}

internal sealed class PersonSnapshot
{
    public string Id { get; init; } = string.Empty;
    public string FirstName { get; init; } = string.Empty;
    public string LastName { get; init; } = string.Empty;
    public string FullName { get; init; } = string.Empty;
    public string Region { get; init; } = string.Empty;
    public List<string> Roles { get; init; } = new();
    public float? DefaultRelationship { get; init; }
    public bool? DisplayRelationship { get; init; }
    public float? RelationshipInLoadedSave { get; init; }
    public bool? UnlockedInLoadedSave { get; init; }
    public string? UnlockTypeInLoadedSave { get; init; }
}

internal sealed class CustomerSnapshot
{
    public string PersonId { get; init; } = string.Empty;
    public string Standards { get; init; } = string.Empty;
    public List<string> PreferredEffectIds { get; init; } = new();
    public List<DrugAffinitySnapshot> DrugAffinities { get; init; } = new();
    public List<DrugAffinitySnapshot> CurrentDrugAffinitiesInLoadedSave { get; init; } = new();
    public float BaseAddiction { get; init; }
    public float CurrentAddictionInLoadedSave { get; init; }
    public float DependenceMultiplier { get; init; }
    public float CallPoliceChance { get; init; }
    public bool CanBeDirectlyApproached { get; init; }
    public bool GuaranteeFirstSampleSuccess { get; init; }
    public float MinimumWeeklySpend { get; init; }
    public float MaximumWeeklySpend { get; init; }
    public int MinimumOrdersPerWeek { get; init; }
    public int MaximumOrdersPerWeek { get; init; }
    public string PreferredOrderDay { get; init; } = string.Empty;
    public int OrderTime { get; init; }
    public float MinimumMutualRelationshipRequirement { get; init; }
    public float MaximumMutualRelationshipRequirement { get; init; }
    public float SampleRequestSuccessChanceInLoadedSave { get; init; }
    public List<CustomerProductEvaluationSnapshot> ProductEvaluationBaseline { get; init; } = new();
    public List<string> ProductEvaluationErrors { get; init; } = new();
}

internal sealed class CustomerProductEvaluationSnapshot
{
    public string ProductId { get; init; } = string.Empty;
    public int Quantity { get; init; }
    public float Price { get; init; }
    public string OfferQuality { get; init; } = string.Empty;
    public float? OfferSuccessChance { get; set; }
    public float? SampleSuccessChance { get; set; }
    public float? ProductEnjoyment { get; set; }
    public float? ValueProposition { get; set; }
    public List<CustomerProductQualityEvaluationSnapshot> QualityEnjoyment { get; init; } = new();
    public List<string> Errors { get; init; } = new();
}

internal sealed class CustomerProductQualityEvaluationSnapshot
{
    public string Quality { get; init; } = string.Empty;
    public int QualityValue { get; init; }
    public float Enjoyment { get; init; }
}

internal sealed class DrugAffinitySnapshot
{
    public string DrugType { get; init; } = string.Empty;
    public float Affinity { get; init; }
}

internal sealed class RelationshipEdgeSnapshot
{
    public string SourceId { get; init; } = string.Empty;
    public string TargetId { get; init; } = string.Empty;
    public bool Bidirectional { get; init; }
}

internal sealed class CustomerConstantsSnapshot
{
    public float AddictionDrainPerDay { get; init; }
    public float AffinityMaxEffect { get; init; }
    public float ApproachChancePerDayMax { get; init; }
    public float ApproachMinimumAddiction { get; init; }
    public float ApproachMinimumCooldown { get; init; }
    public float ApproachMaximumCooldown { get; init; }
    public int DealCooldown { get; init; }
    public int MinimumTravelTime { get; init; }
    public int MaximumTravelTime { get; init; }
    public float MinimumNormalizedRelationshipForRecommendation { get; init; }
    public float MinimumOrderAppeal { get; init; }
    public float PropertyMaxEffect { get; init; }
    public float QualityMaxEffect { get; init; }
    public float GuaranteedDealerRecommendationRelationship { get; init; }
    public float GuaranteedSupplierRecommendationRelationship { get; init; }
    public float MinimumRelationship { get; init; }
    public float MaximumRelationship { get; init; }
    public int MaximumOrderQuantityPerProduct { get; init; }
    public int QualityTierTolerance { get; init; }
    public bool SampleRequiresRecommendation { get; init; }
    public int AttackDealCooldown { get; init; }
    public float CustomerUnlockedCartelInfluenceChange { get; init; }
    public int DealAttendanceTolerance { get; init; }
    public float DealRejectedRelationshipChange { get; init; }
    public int OfferExpiryTimeMinutes { get; init; }
    public float RelationshipThresholdToGiveDealToCartel { get; init; }

    internal static CustomerConstantsSnapshot FromGame() => new()
    {
        AddictionDrainPerDay = Il2CppScheduleOne.Economy.Customer.ADDICTION_DRAIN_PER_DAY,
        AffinityMaxEffect = Il2CppScheduleOne.Economy.Customer.AFFINITY_MAX_EFFECT,
        ApproachChancePerDayMax =
            Il2CppScheduleOne.Economy.Customer.APPROACH_CHANCE_PER_DAY_MAX,
        ApproachMinimumAddiction =
            Il2CppScheduleOne.Economy.Customer.APPROACH_MIN_ADDICTION,
        ApproachMinimumCooldown =
            Il2CppScheduleOne.Economy.Customer.APPROACH_MIN_COOLDOWN,
        ApproachMaximumCooldown =
            Il2CppScheduleOne.Economy.Customer.APPROACH_MAX_COOLDOWN,
        DealCooldown = Il2CppScheduleOne.Economy.Customer.DEAL_COOLDOWN,
        MinimumTravelTime = Il2CppScheduleOne.Economy.Customer.MIN_TRAVEL_TIME,
        MaximumTravelTime = Il2CppScheduleOne.Economy.Customer.MAX_TRAVEL_TIME,
        MinimumNormalizedRelationshipForRecommendation =
            Il2CppScheduleOne.Economy.Customer.MIN_NORMALIZED_RELATIONSHIP_FOR_RECOMMENDATION,
        MinimumOrderAppeal = Il2CppScheduleOne.Economy.Customer.MIN_ORDER_APPEAL,
        PropertyMaxEffect = Il2CppScheduleOne.Economy.Customer.PROPERTY_MAX_EFFECT,
        QualityMaxEffect = Il2CppScheduleOne.Economy.Customer.QUALITY_MAX_EFFECT,
        GuaranteedDealerRecommendationRelationship =
            Il2CppScheduleOne.Economy.Customer
                .RELATIONSHIP_FOR_GUARANTEED_DEALER_RECOMMENDATION,
        GuaranteedSupplierRecommendationRelationship =
            Il2CppScheduleOne.Economy.Customer
                .RELATIONSHIP_FOR_GUARANTEED_SUPPLIER_RECOMMENDATION,
        MinimumRelationship =
            Il2CppScheduleOne.NPCs.Relation.NPCRelationData.MinRelationship,
        MaximumRelationship =
            Il2CppScheduleOne.NPCs.Relation.NPCRelationData.MaxRelationship,
        MaximumOrderQuantityPerProduct =
            Il2CppScheduleOne.Economy.Customer.MaxOrderQuantityPerProduct,
        QualityTierTolerance = Il2CppScheduleOne.Economy.Customer.QualityTierTolerance,
        SampleRequiresRecommendation =
            Il2CppScheduleOne.Economy.Customer.SAMPLE_REQUIRES_RECOMMENDATION,
        AttackDealCooldown = Il2CppScheduleOne.Economy.Customer.ATTACK_DEAL_COOLDOWN,
        CustomerUnlockedCartelInfluenceChange =
            Il2CppScheduleOne.Economy.Customer.CUSTOMER_UNLOCKED_CARTEL_INFLUENCE_CHANGE,
        DealAttendanceTolerance =
            Il2CppScheduleOne.Economy.Customer.DEAL_ATTENDANCE_TOLERANCE,
        DealRejectedRelationshipChange =
            Il2CppScheduleOne.Economy.Customer.DEAL_REJECTED_RELATIONSHIP_CHANGE,
        OfferExpiryTimeMinutes =
            Il2CppScheduleOne.Economy.Customer.OFFER_EXPIRY_TIME_MINS,
        RelationshipThresholdToGiveDealToCartel =
            Il2CppScheduleOne.Economy.Customer.RELATIONSHIP_THRESHOLD_TO_GIVE_DEAL_TO_CARTEL,
    };
}
