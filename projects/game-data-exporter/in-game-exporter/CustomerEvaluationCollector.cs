using Il2CppInterop.Runtime;

namespace NeonSchedule1.GameDataExporter;

internal static partial class GameDataCollector
{
    private static void CollectCustomerProductEvaluations(
        Il2CppScheduleOne.Economy.Customer customer,
        CustomerSnapshot customerSnapshot,
        IReadOnlyList<Il2CppScheduleOne.Product.ProductDefinition> products)
    {
        foreach (var product in products)
        {
            try
            {
                var instance = product.GetDefaultInstance(1)
                    .TryCast<Il2CppScheduleOne.Product.ProductItemInstance>();
                var packaging = SmallestPackaging(product);
                if (instance is null || packaging is null)
                {
                    customerSnapshot.ProductEvaluationErrors.Add(
                        $"{product.ID}:offer:InvalidOperationException:No packaged product instance.");
                    continue;
                }

                instance.SetPackaging(packaging);
                var offeredProducts = new Il2CppSystem.Collections.Generic.List<
                    Il2CppScheduleOne.ItemFramework.ItemInstance>();
                offeredProducts.Add(instance);
                var price = instance.GetMonetaryValue();
                var evaluation = new CustomerProductEvaluationSnapshot
                {
                    ProductId = product.ID,
                    Quantity = instance.Quantity * instance.Amount,
                    Price = price,
                    OfferQuality = instance.Quality.ToString(),
                };
                CaptureEvaluation(customer, product, offeredProducts, evaluation);
                CaptureOfferCases(customer, product, packaging, evaluation);
                foreach (var error in evaluation.Errors)
                {
                    customerSnapshot.ProductEvaluationErrors.Add($"{product.ID}:{error}");
                }
                foreach (var offerCase in evaluation.OfferCases)
                {
                    foreach (var error in offerCase.Errors)
                    {
                        customerSnapshot.ProductEvaluationErrors.Add(
                            $"{product.ID}:offer-case:{offerCase.Id}:{error}");
                    }
                }
                customerSnapshot.ProductEvaluationBaseline.Add(evaluation);
            }
            catch (Exception exception)
            {
                customerSnapshot.ProductEvaluationErrors.Add(
                    $"{product.ID}:{exception.GetType().Name}:{exception.Message}");
            }
        }
    }

    private static void CaptureEvaluation(
        Il2CppScheduleOne.Economy.Customer customer,
        Il2CppScheduleOne.Product.ProductDefinition product,
        Il2CppSystem.Collections.Generic.List<Il2CppScheduleOne.ItemFramework.ItemInstance>
            offeredProducts,
        CustomerProductEvaluationSnapshot evaluation)
    {
        Capture(
            "offer",
            () => evaluation.OfferSuccessChance = customer.GetOfferSuccessChance(
                offeredProducts,
                evaluation.Price),
            evaluation.Errors);
        Capture(
            "sample",
            () => evaluation.SampleSuccessChance = customer.GetSampleSuccess(
                offeredProducts,
                evaluation.Price),
            evaluation.Errors);
        Capture(
            "enjoyment",
            () => evaluation.ProductEnjoyment = customer.GetProductEnjoyment(product),
            evaluation.Errors);
        Capture(
            "value-proposition",
            () => evaluation.ValueProposition =
                Il2CppScheduleOne.Economy.Customer.GetValueProposition(
                    product,
                    evaluation.Price / evaluation.Quantity),
            evaluation.Errors);

        foreach (var quality in Enum.GetValues<Il2CppScheduleOne.ItemFramework.EQuality>())
        {
            Capture(
                $"quality-enjoyment:{quality}",
                () => evaluation.QualityEnjoyment.Add(
                    new CustomerProductQualityEvaluationSnapshot
                    {
                        Quality = quality.ToString(),
                        QualityValue = (int)quality,
                        Enjoyment = customer.GetProductEnjoyment(product, quality),
                    }),
                evaluation.Errors);
        }
    }

    private static void CaptureOfferCases(
        Il2CppScheduleOne.Economy.Customer customer,
        Il2CppScheduleOne.Product.ProductDefinition product,
        Il2CppScheduleOne.Product.Packaging.PackagingDefinition packaging,
        CustomerProductEvaluationSnapshot evaluation)
    {
        var unitPrice = evaluation.Price / evaluation.Quantity;
        CaptureOfferCase(customer, product, packaging, evaluation, "discount-25-percent", 1,
            Il2CppScheduleOne.ItemFramework.EQuality.Standard, unitPrice * 0.75f);
        CaptureOfferCase(customer, product, packaging, evaluation, "markup-50-percent", 1,
            Il2CppScheduleOne.ItemFramework.EQuality.Standard, unitPrice * 1.5f);
        CaptureOfferCase(customer, product, packaging, evaluation, "market-three-units", 3,
            Il2CppScheduleOne.ItemFramework.EQuality.Standard, unitPrice * 3f);
        CaptureOfferCase(customer, product, packaging, evaluation, "premium-market", 1,
            Il2CppScheduleOne.ItemFramework.EQuality.Premium, unitPrice);
        CaptureOfferCase(customer, product, packaging, evaluation, "high-price-4x", 1,
            Il2CppScheduleOne.ItemFramework.EQuality.Standard, unitPrice * 4f);
    }

    private static void CaptureOfferCase(
        Il2CppScheduleOne.Economy.Customer customer,
        Il2CppScheduleOne.Product.ProductDefinition product,
        Il2CppScheduleOne.Product.Packaging.PackagingDefinition packaging,
        CustomerProductEvaluationSnapshot evaluation,
        string id,
        int stackQuantity,
        Il2CppScheduleOne.ItemFramework.EQuality quality,
        float price)
    {
        var offerCase = new CustomerOfferCaseSnapshot
        {
            Id = id,
            Price = price,
            Quality = quality.ToString(),
        };
        evaluation.OfferCases.Add(offerCase);
        try
        {
            var instance = product.GetDefaultInstance(stackQuantity)
                .TryCast<Il2CppScheduleOne.Product.ProductItemInstance>();
            if (instance is null)
            {
                throw new InvalidOperationException("No product item instance.");
            }

            instance.SetPackaging(packaging);
            instance.SetQuality(quality);
            offerCase.Quantity = instance.Quantity * instance.Amount;
            var offeredProducts = new Il2CppSystem.Collections.Generic.List<
                Il2CppScheduleOne.ItemFramework.ItemInstance>();
            offeredProducts.Add(instance);
            Capture(
                "offer",
                () => offerCase.SuccessChance = customer.GetOfferSuccessChance(
                    offeredProducts,
                    price),
                offerCase.Errors);
        }
        catch (Exception exception)
        {
            offerCase.Errors.Add($"setup:{exception.GetType().Name}:{exception.Message}");
        }
    }

    private static void Capture(
        string operation,
        Action capture,
        List<string> errors)
    {
        try
        {
            capture();
        }
        catch (Exception exception)
        {
            errors.Add(
                $"{operation}:{exception.GetType().Name}:{exception.Message}");
        }
    }

    private static Il2CppScheduleOne.Product.Packaging.PackagingDefinition? SmallestPackaging(
        Il2CppScheduleOne.Product.ProductDefinition product)
    {
        Il2CppScheduleOne.Product.Packaging.PackagingDefinition? smallest = null;
        var candidates = product.ValidPackaging;
        if (candidates is null)
        {
            return null;
        }

        for (var index = 0; index < candidates.Length; index++)
        {
            var candidate = candidates[index];
            if (candidate is not null &&
                (smallest is null || candidate.Quantity < smallest.Quantity))
            {
                smallest = candidate;
            }
        }
        return smallest;
    }
}
