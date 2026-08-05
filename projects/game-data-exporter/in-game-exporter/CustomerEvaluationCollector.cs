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
                foreach (var error in evaluation.Errors)
                {
                    customerSnapshot.ProductEvaluationErrors.Add($"{product.ID}:{error}");
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
            evaluation);
        Capture(
            "sample",
            () => evaluation.SampleSuccessChance = customer.GetSampleSuccess(
                offeredProducts,
                evaluation.Price),
            evaluation);
        Capture(
            "enjoyment",
            () => evaluation.ProductEnjoyment = customer.GetProductEnjoyment(product),
            evaluation);
        Capture(
            "value-proposition",
            () => evaluation.ValueProposition =
                Il2CppScheduleOne.Economy.Customer.GetValueProposition(
                    product,
                    evaluation.Price / evaluation.Quantity),
            evaluation);

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
                evaluation);
        }
    }

    private static void Capture(
        string operation,
        Action capture,
        CustomerProductEvaluationSnapshot evaluation)
    {
        try
        {
            capture();
        }
        catch (Exception exception)
        {
            evaluation.Errors.Add(
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
