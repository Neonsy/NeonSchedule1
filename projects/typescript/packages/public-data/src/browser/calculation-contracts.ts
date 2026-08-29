import {
    recipeSearchObjectives,
    type RecipeSearchObjective,
} from '@neonschedule1/core';
import {
    liveSearchPolicy,
    type LiveSearchMode,
} from '@neonschedule1/solver/search-policy';

import { requireUnique } from '#public-data/browser/public-key';
import {
    PublicCalculationContractsSchema,
    type PublicCalculationContracts,
    type PublicCalculationProofKey,
} from '#public-data/browser/calculation-contracts-schema';

type CalculationFamily = PublicCalculationContracts['families'][number];
type CalculationInput = CalculationFamily['requestInputs'][number];
type CalculationOutcome = CalculationFamily['outcomes'][number];
type CalculationGap = CalculationFamily['gaps'][number];
type CalculationLimit = CalculationFamily['limits'][number];

const liveModeContent: Readonly<Record<LiveSearchMode, {
    readonly label: string;
    readonly explanation: string;
}>> = {
    quick: {
        label: 'Quick',
        explanation:
            'Uses the shortest live-search budget after a verified package coverage miss.',
    },
    balanced: {
        label: 'Balanced',
        explanation:
            'Uses a medium live-search budget after a verified package coverage miss.',
    },
    precise: {
        label: 'Precise',
        explanation:
            'Uses the largest live-search budget after a verified package coverage miss.',
    },
};

const objectiveContent: Readonly<Record<RecipeSearchObjective, {
    readonly label: string;
    readonly direction: 'highest-first' | 'lowest-first';
    readonly explanation: string;
}>> = {
    productValue: {
        label: 'Highest product value',
        direction: 'highest-first',
        explanation: 'Ranks the final product value from highest to lowest.',
    },
    netValue: {
        label: 'Highest net value',
        direction: 'highest-first',
        explanation: 'Ranks product value minus base-product and ingredient cost.',
    },
    fewestSteps: {
        label: 'Fewest mixing steps',
        direction: 'lowest-first',
        explanation: 'Ranks recipes with fewer added ingredients first.',
    },
    lowestCost: {
        label: 'Lowest total cost',
        direction: 'lowest-first',
        explanation: 'Ranks base-product and ingredient cost from lowest to highest.',
    },
    returnOnCost: {
        label: 'Highest return on cost',
        direction: 'highest-first',
        explanation: 'Ranks product value divided by total cost. Zero-cost recipes do not rank.',
    },
};

export function compilePublicCalculationContracts(): PublicCalculationContracts {
    const searchModes: PublicCalculationContracts['controls']['searchModes'] = (
        ['quick', 'balanced', 'precise'] as const
    ).map((key) => {
        const policy = liveSearchPolicy(key);
        return {
            key,
            ...liveModeContent[key],
            execution: 'live-bounded-after-coverage-miss',
            maximumIngredients: policy.maximumIngredients,
            advisoryDuration: policy.advisoryDuration,
            possibleOutcomeKeys: [
                'precomputed-exact',
                'live-exact',
                'live-incomplete',
            ],
        };
    });
    searchModes.push({
        key: 'exhaustive',
        label: 'Exhaustive',
        explanation:
            'Returns exact precomputed evidence only when the verified package covers the request.',
        execution: 'verified-precomputed-only',
        maximumIngredients: null,
        advisoryDuration: null,
        possibleOutcomeKeys: ['precomputed-exact', 'coverage-miss'],
    });

    const proofClasses = [
        proof(
            'exact',
            'Exact',
            'complete',
            'The result is complete for the declared request, inputs, and evidence scope.'
        ),
        proof(
            'conditional',
            'Conditional',
            'condition-dependent',
            'The result is complete only if its named caller-supplied condition remains true.'
        ),
        proof(
            'incomplete',
            'Incomplete',
            'partial-only',
            'The result contains useful evidence but does not support a complete claim.'
        ),
        proof(
            'unsupported',
            'Unsupported',
            'none',
            'The calculator does not support the requested behavior or proof.'
        ),
        proof(
            'unavailable',
            'Unavailable',
            'none',
            'Required state or evidence is missing, so no supported result is available.'
        ),
        proof(
            'not-applicable',
            'Not applicable',
            'none',
            'The calculation does not apply to this input and makes no result claim.'
        ),
    ];
    const recipeObjectives = recipeSearchObjectives.map((key) => ({
        key: publicObjectiveKey(key),
        ...objectiveContent[key],
    }));
    const stateSources = [
        {
            key: 'manual-state',
            label: 'Manual planner state',
            explanation: 'Uses the user-owned manual state as the selected source of truth.',
        },
        {
            key: 'latest-observation',
            label: 'Latest read-only observation',
            explanation:
                'Uses the latest compatible observation without applying it to manual state.',
        },
    ];
    const inventorySources = [
        {
            key: 'no-inventory',
            label: 'No inventory',
            explanation: 'Runs without inventory facts and keeps inventory-dependent results open.',
        },
        {
            key: 'selected-manual-inventories',
            label: 'Selected manual inventories',
            explanation: 'Uses only the compatible manual inventories chosen for this request.',
        },
        {
            key: 'latest-observation-inventories',
            label: 'Latest observed inventories',
            explanation: 'Uses the complete compatible inventories from the latest observation.',
        },
    ];
    const families = calculationFamilies();
    const result = {
        schema: 'neonschedule1-public-calculation-contracts-1' as const,
        requestPolicy: {
            compatibility: 'matching-game-and-dataset-required' as const,
            persistence: 'request-local-not-stored' as const,
            sourceSelection: 'explicit-no-automatic-merge' as const,
            unknownValues: 'preserved-not-assumed' as const,
            invalidRequests: 'rejected-before-calculation' as const,
            identifiers: 'opaque-public-keys-only' as const,
            applicationTransport: 'not-defined' as const,
        },
        proofClasses,
        controls: { searchModes, recipeObjectives, stateSources, inventorySources },
        families,
        counts: {
            proofClasses: proofClasses.length,
            searchModes: searchModes.length,
            recipeObjectives: recipeObjectives.length,
            stateSources: stateSources.length,
            inventorySources: inventorySources.length,
            families: families.length,
            requestInputs: count(families, ({ requestInputs }) => requestInputs.length),
            outcomes: count(families, ({ outcomes }) => outcomes.length),
            gaps: count(families, ({ gaps }) => gaps.length),
            limits: count(families, ({ limits }) => limits.length),
        },
    };
    validatePublicCalculationContracts(result);
    return PublicCalculationContractsSchema.assert(result);
}

function calculationFamilies(): CalculationFamily[] {
    return [
        {
            key: 'recipe-search',
            label: 'Recipe calculation and search',
            featureKeys: ['recipe-calculator-search'],
            calculatorOwner: 'solver-and-core',
            requestInputs: [
                input('base-products', 'Base products', 'user-choice', 'required',
                    'Selects one or more published base products.'),
                input('available-ingredients', 'Available ingredients', 'user-choice', 'required',
                    'Limits the published mixing ingredients the search may use.'),
                input('mixing-rule-profile', 'Mixing rule profile', 'local-user-state',
                    'required', 'Selects the standard or explicit seeded mixing rules.'),
                input('recipe-constraints', 'Recipe constraints', 'user-choice', 'optional',
                    'Sets effect, ingredient, count, and total-cost filters.'),
                input('result-limit', 'Result limit', 'user-choice', 'required',
                    'Sets the maximum number of ranked results returned.'),
            ],
            controlKeys: ['search-mode', 'recipe-objective'],
            outcomes: [
                outcome('direct-exact', 'Calculated recipe', 'exact', 'complete',
                    'A directly evaluated recipe has complete mixing and value results.'),
                outcome('precomputed-exact', 'Exact package result', 'exact', 'complete',
                    'A verified package covered the request and returned an exact ranked result.'),
                outcome('live-exact', 'Completed live result', 'exact', 'complete',
                    'The bounded live search completed its declared search space.'),
                outcome('live-incomplete', 'Best result found', 'incomplete', 'partial',
                    'The live search stopped at a declared limit and returns only the best found.'),
                outcome('coverage-miss', 'Exact result unavailable', 'unavailable', 'none',
                    'Exhaustive mode has no matching verified exact package for this request.'),
            ],
            gaps: [
                gap('rule-profile-not-covered', 'Mixing profile not covered', 'unavailable',
                    'The exact package was built for another mixing rule profile.'),
                gap('product-outside-package', 'Product not covered', 'unavailable',
                    'At least one selected base product is outside the exact package.'),
                gap('ingredient-set-not-covered', 'Ingredient set not covered', 'unavailable',
                    'The selected ingredients differ from the exact package.'),
                gap('ingredient-depth-not-covered', 'Ingredient depth not covered', 'unavailable',
                    'The requested ingredient depth differs from the exact package.'),
                gap('state-limit', 'Search state limit reached', 'incomplete',
                    'The live search stopped after reaching its state limit.'),
                gap('work-limit', 'Search work limit reached', 'incomplete',
                    'The live search stopped after reaching its transition-work limit.'),
                gap('time-limit', 'Search time limit reached', 'incomplete',
                    'The live search stopped after reaching its time limit.'),
                gap('profit-over-time-unsupported', 'Profit over time is unsupported',
                    'unsupported',
                    'Recipe search does not establish the complete production duration needed.'),
            ],
            limits: [
                limit('exact-package-match', 'Exhaustive requires a matching package',
                    'Exhaustive never falls back to a bounded live result.'),
                limit('bounded-mode-result', 'Live modes may stop early',
                    'Quick, Balanced, and Precise preserve incomplete evidence when a limit stops them.'),
            ],
        },
        customerFamily(),
        dealerFamily(),
        progressionFamily(),
        productionFamily(),
        inventoryFamily(),
        propertyBusinessFamily(),
        blueprintFamily(),
        routeTravelFamily(),
        evidenceFamily(),
    ];
}

function customerFamily(): CalculationFamily {
    return {
        key: 'customer-planner',
        label: 'Customer planning',
        featureKeys: ['customer-planner'],
        calculatorOwner: 'solver-and-core',
        requestInputs: [
            input('customer', 'Customer', 'user-choice', 'required',
                'Selects one published customer profile.'),
            input('customer-state', 'Current customer state', 'local-user-state', 'conditional',
                'Provides addiction, order-limit, affinity, and eligibility facts when known.'),
            input('candidate-products', 'Candidate products', 'generated-plan', 'required',
                'Provides directly calculated or searched product candidates.'),
            input('offer', 'Offer', 'user-choice', 'required',
                'Sets quality, quantity, price, and the allowed production cost.'),
            input('production-evidence', 'Production evidence', 'generated-plan', 'conditional',
                'Provides inventory, cost, and duration evidence for composition planning.'),
        ],
        controlKeys: ['search-mode', 'state-source', 'inventory-source'],
        outcomes: [
            outcome('resolved', 'Plan resolved', 'exact', 'complete',
                'Every selected customer decision has complete supporting evidence.'),
            outcome('partial', 'Partial plan', 'incomplete', 'partial',
                'Some candidates are usable while others retain explicit evidence gaps.'),
            outcome('ineligible', 'Customer ineligible', 'exact', 'complete',
                'Known progression and relationship facts prove the customer is ineligible.'),
            outcome('unknown', 'Eligibility unknown', 'unavailable', 'none',
                'Missing user state prevents an eligibility decision.'),
            outcome('allocation-exact', 'Exact allocation', 'exact', 'complete',
                'The allocation search completed and proved the selected allocation.'),
            outcome('allocation-incomplete', 'Best allocation found', 'incomplete', 'partial',
                'The allocation search reached a declared state limit.'),
        ],
        gaps: [
            gap('current-addiction-missing', 'Current addiction unknown', 'unavailable',
                'The selected state does not contain the customer\'s current addiction.'),
            gap('order-limit-missing', 'Order limit unknown', 'unavailable',
                'The selected state does not establish the current order-limit multiplier.'),
            gap('affinities-incomplete', 'Drug affinities incomplete', 'incomplete',
                'The selected state contains partial or unknown customer affinities.'),
            gap('eligibility-unknown', 'Eligibility unknown', 'unavailable',
                'Required rank, unlock, or relationship facts are missing.'),
            gap('finished-inventory-missing', 'Finished inventory unavailable', 'unavailable',
                'No complete selected inventory establishes finished product quantities.'),
            gap('production-plan-missing', 'Production plan unavailable', 'unavailable',
                'No supported production plan exists for the candidate.'),
            gap('production-plan-incomplete', 'Production plan incomplete', 'incomplete',
                'The production plan has an explicit cost, timing, or feasibility gap.'),
            gap('production-cost-limit', 'Production cost exceeds the limit', 'exact',
                'Known production cost exceeds the caller\'s maximum.'),
            gap('production-time-limit', 'Production time exceeds the limit', 'exact',
                'Known production duration exceeds the caller\'s maximum.'),
        ],
        limits: [
            limit('partial-state-not-negative', 'Missing state is not a negative fact',
                'Partial collections never prove that an unlock, relationship, or inventory is absent.'),
        ],
    };
}

function dealerFamily(): CalculationFamily {
    return {
        key: 'dealer-planner',
        label: 'Dealer planning',
        featureKeys: ['dealer-planner'],
        calculatorOwner: 'core',
        requestInputs: [
            input('dealer-state', 'Dealer state', 'local-user-state', 'required',
                'Provides recruitment, recommendation, signing-fee, and assignment facts.'),
            input('customer-demand', 'Customer demand', 'generated-plan', 'required',
                'Provides eligible customers and the demand assigned to each dealer.'),
            input('dealer-capacity', 'Dealer capacity', 'static-game-data', 'required',
                'Uses published customer limits and dealer mechanics.'),
            input('current-dealer-origin', 'Current dealer position', 'live-runtime-evidence',
                'conditional', 'Provides the current origin for travel feasibility.'),
            input('delivery-window', 'Delivery window', 'user-choice', 'conditional',
                'Sets the target region, start time, and minutes until the window.'),
        ],
        controlKeys: ['state-source'],
        outcomes: [
            outcome('assignment-exact', 'Exact assignment', 'exact', 'complete',
                'The assignment search evaluated every supported dealer subset.'),
            outcome('assignment-subset-limit', 'Best assignment found', 'incomplete', 'partial',
                'The assignment search stopped at its declared subset limit.'),
            outcome('allocation-exact', 'Exact customer allocation', 'exact', 'complete',
                'The allocation search completed its declared state space.'),
            outcome('allocation-incomplete', 'Best customer allocation found', 'incomplete',
                'partial', 'The allocation search stopped at a declared limit.'),
            outcome('travel-feasible', 'Travel feasible', 'exact', 'complete',
                'Every regional delivery location fits within the available travel time.'),
            outcome('travel-infeasible', 'Travel infeasible', 'exact', 'complete',
                'The worst regional delivery location exceeds the available travel time.'),
            outcome('travel-unknown', 'Travel feasibility unknown', 'unavailable', 'none',
                'A current position, delivery location, or time input is missing.'),
        ],
        gaps: [
            gap('dealer-recruitment-unknown', 'Recruitment unknown', 'unavailable',
                'The selected state does not establish whether the dealer is recruited.'),
            gap('dealer-recommendation-unknown', 'Recommendation unknown', 'unavailable',
                'The selected state does not establish the required recommendation.'),
            gap('dealer-origin-missing', 'Current position missing', 'unavailable',
                'Travel feasibility needs the dealer\'s current position.'),
            gap('delivery-locations-missing', 'Delivery locations missing', 'unavailable',
                'The selected region has no supported delivery locations.'),
            gap('delivery-time-missing', 'Available travel time missing', 'unavailable',
                'The request does not establish the time before the delivery window.'),
            gap('assignment-limit', 'Assignment search limit reached', 'incomplete',
                'The assignment result is the best found before its subset limit.'),
            gap('allocation-limit', 'Allocation search limit reached', 'incomplete',
                'The customer allocation is the best found before its state limit.'),
        ],
        limits: [
            limit('static-home-reference', 'Static homes are reference-only',
                'A published dealer home is not treated as the current dealer position.'),
            limit('straight-line-travel', 'Dealer travel is a straight-line estimate',
                'Dealer travel does not use pathfinding.'),
        ],
    };
}

function progressionFamily(): CalculationFamily {
    return {
        key: 'progression-eligibility',
        label: 'Progression and eligibility',
        featureKeys: ['relationships-progression'],
        calculatorOwner: 'core',
        requestInputs: [
            input('current-rank', 'Current rank', 'local-user-state', 'conditional',
                'Provides the current rank when known.'),
            input('unlocks-and-access', 'Unlocks and access', 'local-user-state', 'conditional',
                'Provides product unlocks, person unlocks, and accessible shops.'),
            input('property-ownership', 'Property ownership', 'local-user-state', 'conditional',
                'Provides owned properties when known.'),
            input('relationships', 'Relationships', 'local-user-state', 'conditional',
                'Provides current relationship values when known.'),
            input('dealer-state', 'Dealer state', 'local-user-state', 'conditional',
                'Provides recommendation and recruitment facts when known.'),
        ],
        controlKeys: ['state-source'],
        outcomes: [
            outcome('eligible', 'Eligible', 'exact', 'complete',
                'Known state satisfies every requirement.'),
            outcome('ineligible', 'Ineligible', 'exact', 'complete',
                'Known state fails at least one requirement.'),
            outcome('unknown', 'Eligibility unknown', 'unavailable', 'none',
                'Required user state is unknown or only partially covered.'),
        ],
        gaps: [
            gap('rank-unknown', 'Current rank unknown', 'unavailable',
                'A rank requirement exists but the current rank is unknown.'),
            gap('unlock-coverage-partial', 'Unlock coverage partial', 'incomplete',
                'The selected state does not completely cover unlocks.'),
            gap('shop-access-partial', 'Shop access partial', 'incomplete',
                'The selected state does not completely cover accessible shops.'),
            gap('property-ownership-partial', 'Property ownership partial', 'incomplete',
                'The selected state does not completely cover property ownership.'),
            gap('relationships-partial', 'Relationships partial', 'incomplete',
                'The selected state does not completely cover relationships.'),
            gap('dealer-state-partial', 'Dealer state partial', 'incomplete',
                'Recommendation or recruitment coverage is partial.'),
            gap('unsupported-dealer-type', 'Dealer type unsupported', 'unsupported',
                'The calculator has no eligibility rule for this dealer type.'),
        ],
        limits: [
            limit('unknown-is-not-ineligible', 'Unknown is not ineligible',
                'Missing facts remain unknown and never become a failed requirement.'),
        ],
    };
}

function productionFamily(): CalculationFamily {
    return {
        key: 'production-planner',
        label: 'Production planning',
        featureKeys: ['production-planner'],
        calculatorOwner: 'core',
        requestInputs: [
            input('recipe', 'Finished recipe', 'generated-plan', 'required',
                'Provides the selected product and mixing sequence.'),
            input('finished-quantity', 'Finished quantity', 'user-choice', 'required',
                'Sets the required finished quantity.'),
            input('production-property', 'Production property', 'user-choice', 'required',
                'Selects the property used for the plan.'),
            input('equipment-and-process', 'Equipment and process choices', 'user-choice',
                'conditional', 'Selects supported growing, drying, mixing, and packaging options.'),
            input('production-evidence', 'Production evidence', 'live-runtime-evidence',
                'conditional', 'Provides execution, timing, sale, revenue, and attributed costs.'),
        ],
        controlKeys: ['state-source', 'inventory-source'],
        outcomes: [
            outcome('plan-complete', 'Production plan complete', 'exact', 'complete',
                'All modeled steps, quantities, costs, and durations are established.'),
            outcome('plan-conditional', 'Production plan conditional', 'conditional', 'complete',
                'The plan is complete only under its named mutable-state condition.'),
            outcome('plan-incomplete', 'Production plan incomplete', 'incomplete', 'partial',
                'The plan contains useful steps but lacks complete evidence.'),
            outcome('plan-unavailable', 'Production plan unavailable', 'unavailable', 'none',
                'Required equipment, state, inventory, or evidence is missing.'),
            outcome('realized-profit-exact', 'Realized profit calculated', 'exact', 'complete',
                'Complete elapsed time, revenue, and attributed costs establish realized profit.'),
        ],
        gaps: [
            gap('inventory-incomplete', 'Inventory incomplete', 'incomplete',
                'Selected inventory does not completely establish usable quantities.'),
            gap('equipment-missing', 'Compatible equipment missing', 'unavailable',
                'No compatible equipment selection supports the requested process.'),
            gap('mutable-moisture', 'Moisture remains conditional', 'conditional',
                'Mutable soil moisture and replenishment are not recorded.'),
            gap('execution-not-established', 'Execution timing missing', 'unavailable',
                'The request does not establish exclusive sequential execution.'),
            gap('sale-not-established', 'Sale completion missing', 'unavailable',
                'The request does not establish the completed sale and its timing.'),
            gap('revenue-incomplete', 'Revenue evidence incomplete', 'incomplete',
                'Recorded realized revenue has partial coverage.'),
            gap('costs-incomplete', 'Cost evidence incomplete', 'incomplete',
                'Attributed costs do not cover every required cost category.'),
            gap('elapsed-time-unavailable', 'Elapsed time unavailable', 'unavailable',
                'Production readiness, execution, or sale timing is incomplete.'),
        ],
        limits: [
            limit('exclusive-execution-input', 'Execution timing is caller-supplied',
                'Elapsed production timing needs explicit exclusive-execution evidence.'),
            limit('realized-profit-input', 'Realized profit uses recorded evidence',
                'The calculator does not invent revenue or unrecorded costs.'),
        ],
    };
}

function inventoryFamily(): CalculationFamily {
    return {
        key: 'inventory-logistics',
        label: 'Inventory and logistics',
        featureKeys: ['inventory-logistics'],
        calculatorOwner: 'core',
        requestInputs: [
            input('inventory', 'Selected inventory', 'local-user-state', 'conditional',
                'Provides complete non-negative whole-item quantities when available.'),
            input('property-transfers', 'Property transfers', 'generated-plan', 'conditional',
                'Provides transfer supplies, candidates, movement, and arrival evidence.'),
            input('shopping-plan', 'Shopping plan', 'generated-plan', 'conditional',
                'Provides purchases, movement, directed travel, and remote delivery evidence.'),
            input('logistics-configuration', 'Logistics configuration', 'user-choice',
                'conditional', 'Provides routes, filters, employees, stations, and priorities.'),
            input('runtime-task-state', 'Runtime task state', 'live-runtime-evidence', 'optional',
                'Provides mutable readiness and employee state when the result requires it.'),
        ],
        controlKeys: ['inventory-source'],
        outcomes: [
            outcome('ready', 'Inputs ready', 'exact', 'complete',
                'Complete evidence establishes when every production input is ready.'),
            outcome('not-ready', 'Inputs not ready', 'exact', 'complete',
                'Complete evidence proves at least one required input is not ready.'),
            outcome('unavailable', 'Readiness unavailable', 'unavailable', 'none',
                'A transfer, purchase, shopping, or arrival dependency is unresolved.'),
            outcome('logistics-complete', 'Logistics plan complete', 'exact', 'complete',
                'Every supported transfer and movement decision has complete evidence.'),
            outcome('logistics-partial', 'Logistics plan partial', 'incomplete', 'partial',
                'Some movement decisions retain explicit route, filter, or state gaps.'),
            outcome('logistics-unavailable', 'Logistics plan unavailable', 'unavailable', 'none',
                'Required assignments, filters, endpoints, or movement evidence are missing.'),
        ],
        gaps: [
            gap('inventory-not-selected', 'Inventory not selected', 'unavailable',
                'The request has no selected inventory source.'),
            gap('inventory-coverage-partial', 'Inventory coverage partial', 'incomplete',
                'The selected inventory does not completely cover its owner.'),
            gap('inventory-quantity-unknown', 'Inventory quantity unknown', 'unavailable',
                'At least one selected item quantity is unknown or not a whole item count.'),
            gap('transfer-arrival-unavailable', 'Transfer arrival unavailable', 'unavailable',
                'Selected transfer movement does not establish an arrival time.'),
            gap('shopping-route-not-planned', 'Shopping route not planned', 'unavailable',
                'No supported shopping route was established.'),
            gap('shopping-attribution-incomplete', 'Shopping attribution incomplete', 'incomplete',
                'Purchased inputs cannot all be attributed to the production property.'),
            gap('filter-evidence-unavailable', 'Filter evidence unavailable', 'unavailable',
                'A logistics filter cannot be evaluated from the published facts.'),
            gap('route-endpoints-unavailable', 'Route endpoints unavailable', 'unavailable',
                'A required employee movement endpoint is missing.'),
            gap('runtime-task-state-missing', 'Runtime task state missing', 'conditional',
                'Live task readiness remains conditional without mutable runtime state.'),
        ],
        limits: [
            limit('no-automatic-inventory-merge', 'Inventories are never merged automatically',
                'Only the explicitly selected compatible inventory source is used.'),
            limit('movement-evidence-is-planning-data', 'Movement legs are planning evidence',
                'Caller-supplied movement does not become native or live navigation.'),
        ],
    };
}

function propertyBusinessFamily(): CalculationFamily {
    return {
        key: 'property-business',
        label: 'Property and business planning',
        featureKeys: ['properties-businesses'],
        calculatorOwner: 'core',
        requestInputs: [
            input('property', 'Property', 'user-choice', 'required',
                'Selects one published property and its calculation geometry.'),
            input('blueprint', 'Blueprint', 'generated-plan', 'required',
                'Provides the placed equipment, storage, employees, and production links.'),
            input('production-plan', 'Production plan', 'generated-plan', 'conditional',
                'Provides quantities, schedules, transfers, and logistics results.'),
            input('business-evidence', 'Business evidence', 'local-user-state', 'conditional',
                'Provides ownership, capacity, balances, and recorded economic facts.'),
        ],
        controlKeys: ['state-source', 'inventory-source'],
        outcomes: [
            outcome('capacity-exact', 'Capacity calculated', 'exact', 'complete',
                'Published property and blueprint facts establish the modeled capacity.'),
            outcome('business-exact', 'Business result calculated', 'exact', 'complete',
                'Complete production and economic evidence establishes the result.'),
            outcome('business-conditional', 'Business result conditional', 'conditional',
                'complete', 'The result depends on its named mutable-state condition.'),
            outcome('business-incomplete', 'Business result incomplete', 'incomplete', 'partial',
                'The result lacks complete production, transfer, logistics, or economic proof.'),
            outcome('business-unavailable', 'Business result unavailable', 'unavailable', 'none',
                'Required property, blueprint, or economic evidence is missing.'),
        ],
        gaps: [
            gap('ownership-unknown', 'Property ownership unknown', 'unavailable',
                'The selected state does not establish ownership.'),
            gap('capacity-input-incomplete', 'Capacity input incomplete', 'incomplete',
                'Placement or environment facts do not completely establish capacity.'),
            gap('production-proof-incomplete', 'Production proof incomplete', 'incomplete',
                'The linked production plan retains an explicit proof gap.'),
            gap('logistics-proof-incomplete', 'Logistics proof incomplete', 'incomplete',
                'The linked logistics plan retains an explicit proof gap.'),
            gap('economic-evidence-missing', 'Economic evidence missing', 'unavailable',
                'Revenue, costs, timing, or business balances are not established.'),
        ],
        limits: [
            limit('modeled-business-scope', 'Only modeled business rules are included',
                'The result does not invent unrecorded operating costs or live market behavior.'),
        ],
    };
}

function blueprintFamily(): CalculationFamily {
    return {
        key: 'blueprint-builder',
        label: 'Blueprint analysis',
        featureKeys: ['blueprint-builder'],
        calculatorOwner: 'core',
        requestInputs: [
            input('property-layout', 'Property layout', 'static-game-data', 'required',
                'Provides published grids, surfaces, colliders, docks, and access points.'),
            input('placements', 'Blueprint placements', 'local-user-state', 'required',
                'Provides user-owned placed items and transforms.'),
            input('production-links', 'Production links', 'local-user-state', 'conditional',
                'Provides routes, assignments, filters, and station links.'),
            input('environment-state', 'Environment state', 'live-runtime-evidence', 'optional',
                'Provides mutable moisture, temperature, and task facts when required.'),
            input('equipment-selections', 'Equipment selections', 'user-choice', 'conditional',
                'Selects equipment when more than one compatible choice exists.'),
        ],
        controlKeys: [],
        outcomes: [
            outcome('analyzed-exact', 'Analysis exact', 'exact', 'complete',
                'Published geometry and selected facts completely support the result.'),
            outcome('analyzed-conditional', 'Analysis conditional', 'conditional', 'complete',
                'The result is complete under its named mutable-state condition.'),
            outcome('analyzed-incomplete', 'Analysis incomplete', 'incomplete', 'partial',
                'Useful findings exist, but unsupported geometry or missing evidence remains.'),
            outcome('rejected', 'Blueprint input rejected', 'not-applicable', 'none',
                'Invalid projection or configuration prevents the requested analysis.'),
            outcome('unsupported', 'Analysis unsupported', 'unsupported', 'none',
                'The published calculator has no proof for the requested geometry or behavior.'),
            outcome('not-applicable', 'Analysis not applicable', 'not-applicable', 'none',
                'The selected item or property does not require this analysis.'),
        ],
        gaps: [
            gap('unsupported-fixed-geometry', 'Fixed geometry unsupported', 'incomplete',
                'A fixed obstacle cannot be evaluated with the supported geometry.'),
            gap('unsupported-placement-geometry', 'Placement geometry unsupported', 'incomplete',
                'A placed item lacks supported collision geometry.'),
            gap('transit-points-missing', 'Transit access points missing', 'unavailable',
                'A transit entity has no published access point.'),
            gap('access-evidence-incomplete', 'Access evidence incomplete', 'incomplete',
                'Published geometry cannot prove every required access path.'),
            gap('temperature-conditional', 'Temperature remains conditional', 'conditional',
                'The result depends on a named temperature or placement condition.'),
            gap('moisture-conditional', 'Moisture remains conditional', 'conditional',
                'Mutable soil moisture and replenishment are not recorded.'),
            gap('employee-assignment-missing', 'Employee assignment missing', 'unavailable',
                'A required production or logistics movement has no compatible employee.'),
            gap('movement-route-incomplete', 'Movement route incomplete', 'incomplete',
                'A physical route or endpoint has incomplete evidence.'),
            gap('filter-evidence-missing', 'Filter evidence missing', 'unavailable',
                'A configured logistics filter cannot be evaluated.'),
        ],
        limits: [
            limit('not-engine-perfect', 'Blueprint proof is not engine-perfect',
                'Incomplete results must not be presented as native placement or reachability proof.'),
            limit('saved-with-incomplete-proof', 'Incomplete blueprints remain saveable',
                'A blueprint may retain explicit incomplete findings without hiding them.'),
        ],
    };
}

function routeTravelFamily(): CalculationFamily {
    return {
        key: 'route-travel',
        label: 'Route and travel planning',
        featureKeys: ['routes-travel'],
        calculatorOwner: 'core',
        requestInputs: [
            input('property-and-shop', 'Property and shop', 'user-choice', 'conditional',
                'Selects the endpoints for a static vehicle estimate.'),
            input('vehicle-layer', 'Vehicle graph layer', 'user-choice', 'conditional',
                'Selects the general or road estimate without combining layers.'),
            input('dealer-origin', 'Current dealer position', 'live-runtime-evidence', 'conditional',
                'Provides the current origin for dealer travel.'),
            input('delivery-region-and-time', 'Delivery region and time', 'user-choice',
                'conditional', 'Selects the regional destinations and available travel time.'),
        ],
        controlKeys: [],
        outcomes: [
            outcome('estimate-available', 'Static estimate available', 'incomplete', 'partial',
                'A selected-layer graph route exists with the published exclusions.'),
            outcome('estimate-unavailable', 'Static estimate unavailable', 'unavailable', 'none',
                'The selected layer has an unmapped endpoint or directed disconnection.'),
            outcome('dealer-travel-feasible', 'Dealer travel feasible', 'exact', 'complete',
                'Every regional destination fits within the available travel time.'),
            outcome('dealer-travel-infeasible', 'Dealer travel infeasible', 'exact', 'complete',
                'The worst regional destination exceeds the available travel time.'),
            outcome('dealer-travel-unknown', 'Dealer travel unknown', 'unavailable', 'none',
                'Required current position or time evidence is missing.'),
        ],
        gaps: [
            gap('endpoint-unmapped', 'Endpoint not mapped', 'unavailable',
                'The selected vehicle layer has no mapped source or destination endpoint.'),
            gap('directed-disconnection', 'No directed connection', 'unavailable',
                'No directed path connects the mapped endpoints in the selected layer.'),
            gap('endpoint-access-unproven', 'Endpoint access unproven', 'incomplete',
                'The graph route does not prove travel to and from the real endpoints.'),
            gap('layer-composition-excluded', 'Layer composition excluded', 'incomplete',
                'The estimate never combines general and road graph layers.'),
            gap('native-path-choice-unproven', 'Native path choice unproven', 'incomplete',
                'The geometric route is not claimed to match native path selection.'),
            gap('current-dealer-origin-missing', 'Current dealer position missing', 'unavailable',
                'Dealer travel needs the current runtime position.'),
        ],
        limits: [
            limit('static-estimate-only', 'Vehicle routes are static estimates',
                'They do not model parking, traffic, collision avoidance, or dynamic obstacles.'),
            limit('no-live-navigation', 'Live navigation is outside scope',
                'The planner neither tracks the player nor controls the game.'),
        ],
    };
}

function evidenceFamily(): CalculationFamily {
    return {
        key: 'evidence-compatibility',
        label: 'Evidence and compatibility',
        featureKeys: ['evidence-compatibility'],
        calculatorOwner: 'solver-and-core',
        requestInputs: [
            input('compatibility', 'Compatibility identity', 'static-game-data', 'required',
                'Provides the game version and normalized dataset identity.'),
            input('calculation-request', 'Calculation request', 'user-choice', 'required',
                'Provides the declared inputs and selected modes.'),
            input('evidence', 'Calculation evidence', 'generated-plan', 'required',
                'Provides the result proof, coverage, limits, and source identity.'),
        ],
        controlKeys: [],
        outcomes: [
            outcome('compatible', 'Compatible evidence', 'exact', 'complete',
                'The evidence matches the selected game, dataset, request, and algorithm scope.'),
            outcome('coverage-limited', 'Coverage limited', 'incomplete', 'partial',
                'The evidence covers only the declared subset or completed work.'),
            outcome('incompatible', 'Evidence incompatible', 'unavailable', 'none',
                'The evidence belongs to another game version, dataset, request, or package.'),
            outcome('unsupported', 'Evidence unsupported', 'unsupported', 'none',
                'The requested proof is outside the calculator\'s supported claim.'),
        ],
        gaps: [
            gap('version-mismatch', 'Game version mismatch', 'unavailable',
                'The evidence does not match the selected game version.'),
            gap('dataset-mismatch', 'Dataset mismatch', 'unavailable',
                'The evidence does not match the selected normalized dataset.'),
            gap('request-mismatch', 'Request mismatch', 'unavailable',
                'The evidence does not match the declared calculation request.'),
            gap('coverage-miss', 'Coverage miss', 'unavailable',
                'The selected exact package does not cover the request.'),
            gap('partial-coverage', 'Partial coverage', 'incomplete',
                'The evidence covers a declared subset rather than the complete target.'),
            gap('proof-missing', 'Proof missing', 'unavailable',
                'No compatible proof accompanies the result.'),
        ],
        limits: [
            limit('selected-version-only', 'Compatibility is version-specific',
                'A result cannot be reused across versions or datasets without matching evidence.'),
        ],
    };
}

function proof(
    key: PublicCalculationProofKey,
    label: string,
    resultUse: 'complete' | 'condition-dependent' | 'partial-only' | 'none',
    explanation: string
): PublicCalculationContracts['proofClasses'][number] {
    return { key, label, resultUse, explanation };
}

function input(
    key: string,
    label: string,
    ownership: CalculationInput['ownership'],
    requirement: CalculationInput['requirement'],
    explanation: string
): CalculationInput {
    return { key, label, ownership, requirement, explanation };
}

function outcome(
    key: string,
    label: string,
    proofKey: PublicCalculationProofKey,
    resultAvailability: CalculationOutcome['resultAvailability'],
    explanation: string
): CalculationOutcome {
    return { key, label, proofKey, resultAvailability, explanation };
}

function gap(
    key: string,
    label: string,
    proofKey: PublicCalculationProofKey,
    explanation: string
): CalculationGap {
    return { key, label, proofKey, explanation };
}

function limit(key: string, label: string, explanation: string): CalculationLimit {
    return { key, label, explanation };
}

function publicObjectiveKey(value: RecipeSearchObjective): string {
    const content: Readonly<Record<RecipeSearchObjective, string>> = {
        productValue: 'product-value',
        netValue: 'net-value',
        fewestSteps: 'fewest-steps',
        lowestCost: 'lowest-cost',
        returnOnCost: 'return-on-cost',
    };
    return content[value];
}

function count(
    families: readonly CalculationFamily[],
    value: (family: CalculationFamily) => number
): number {
    return families.reduce((total, family) => total + value(family), 0);
}

function validatePublicCalculationContracts(
    contracts: Omit<PublicCalculationContracts, 'counts'> & {
        readonly counts: PublicCalculationContracts['counts'];
    }
): void {
    requireUnique(contracts.proofClasses.map(({ key }) => key), 'calculation proof keys');
    requireUnique(contracts.controls.searchModes.map(({ key }) => key), 'search mode keys');
    requireUnique(
        contracts.controls.recipeObjectives.map(({ key }) => key),
        'recipe objective keys'
    );
    requireUnique(contracts.controls.stateSources.map(({ key }) => key), 'state source keys');
    requireUnique(
        contracts.controls.inventorySources.map(({ key }) => key),
        'inventory source keys'
    );
    requireUnique(contracts.families.map(({ key }) => key), 'calculation family keys');
    requireUnique(
        contracts.families.flatMap(({ featureKeys }) => featureKeys),
        'calculation family feature keys'
    );
    const controlKeys = new Set([
        'search-mode',
        'recipe-objective',
        'state-source',
        'inventory-source',
    ]);
    for (const family of contracts.families) {
        requireUnique(family.featureKeys, `${family.key} feature keys`);
        requireUnique(family.requestInputs.map(({ key }) => key), `${family.key} input keys`);
        requireUnique(family.controlKeys, `${family.key} control keys`);
        requireUnique(family.outcomes.map(({ key }) => key), `${family.key} outcome keys`);
        requireUnique(family.gaps.map(({ key }) => key), `${family.key} gap keys`);
        requireUnique(family.limits.map(({ key }) => key), `${family.key} limit keys`);
        const unknownControl = family.controlKeys.find((key) => !controlKeys.has(key));
        if (unknownControl !== undefined) {
            throw new Error(`${family.key} references unknown control ${unknownControl}`);
        }
    }
    const recipeOutcomeKeys = new Set(
        contracts.families
            .find(({ key }) => key === 'recipe-search')
            ?.outcomes.map(({ key }) => key) ?? []
    );
    const unknownSearchOutcome = contracts.controls.searchModes
        .flatMap(({ possibleOutcomeKeys }) => possibleOutcomeKeys)
        .find((key) => !recipeOutcomeKeys.has(key));
    if (unknownSearchOutcome !== undefined) {
        throw new Error(`Search mode references unknown recipe outcome ${unknownSearchOutcome}`);
    }
}
