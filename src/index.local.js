process.env.BACKGROUND_JOBS_ENABLED = "false";
process.env.PORT = process.env.PORT || "3000";

await import("./index.js");
