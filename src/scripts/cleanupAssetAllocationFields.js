import mongoose from "mongoose";
import { connectdb } from "../db.js";
import Asset from "../models/asset.model.js";

await connectdb();

try {
  const removedAllocatedCapital = await Asset.updateMany(
    { allocatedCapital: { $exists: true } },
    { $unset: { allocatedCapital: "" } }
  );

  const cleanedFiatAssets = await Asset.updateMany(
    { type: "fiat" },
    {
      $unset: {
        allocationPercentage: "",
        totalCapitalWhenLastAdded: "",
      },
    }
  );

  console.log("allocatedCapital removido:", removedAllocatedCapital.modifiedCount);
  console.log("fiat limpiados:", cleanedFiatAssets.modifiedCount);
} finally {
  await mongoose.disconnect();
}
